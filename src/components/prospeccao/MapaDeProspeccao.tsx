"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import s from "./MapaDeProspeccao.module.css";
import {
  CAMPOS_DA_BUSCA, CAMPOS_DO_CONTATO, LIMITES_DO_DIA, TERMOS_DA_CIDADE, TERMOS_EXTRAS, TIPOS_DA_AREA,
  areaParaVarrer, celulaDaCaixa, dentroDaCaixa, dividirCelula, gradeDaArea,
  linkComoChegar, linkDoWhatsapp, lojaDoLugar, nomeDaCidade,
  type CaixaDaCidade, type Celula, type LojaDoMapa, type StatusDaMarcacao, type StatusDoPino, type TipoDeUso,
} from "@/lib/prospeccao/regras";
import type { Marcacao, UsoDoDia } from "@/lib/prospeccao/dados";

/**
 * Mapa de prospecção do vendedor: a cidade no filtro, os restaurantes do
 * Google no mapa, pintados por status (cliente do FireHub / em negociação /
 * não quis / oportunidade), o cartão com contato e "Como chegar", e a anotação
 * do vendedor, que fica para a equipe toda.
 *
 * Do Google, só o place_id fica no nosso banco; o resto é buscado na tela.
 * Cada consulta passa antes pelo contador do dia (POST reservar) — a cota do
 * Google está travada na faixa grátis (lib/prospeccao/regras.ts).
 *
 * `api` existe para a prévia rodar sem banco; no portal, fica o padrão.
 */

export type CargaDoMapa = {
  chave: string | null;
  cidades: { nome: string; lojas: number }[];
  uso: UsoDoDia;
  cidade: { nome: string; caixa: CaixaDaCidade | null } | null;
  lojas: LojaDoMapa[];
  marcacoes: Marcacao[];
};

export type ApiDoMapa = {
  carregar: (cidade: string) => Promise<CargaDoMapa>;
  marcar: (d: { placeId: string; cidade: string; status: StatusDaMarcacao; nota: string }) => Promise<Marcacao>;
  reservar: (tipo: TipoDeUso, qtd: number) => Promise<{ ok: boolean; uso: UsoDoDia }>;
};

const URL_DA_API = "/api/vendedor/prospeccao";

async function lerJson(r: Response) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Erro ${r.status}`);
  return j;
}

export const apiDoServidor: ApiDoMapa = {
  carregar: async (cidade) => lerJson(await fetch(`${URL_DA_API}?cidade=${encodeURIComponent(cidade)}`, { cache: "no-store" })),
  marcar: async (d) => (await lerJson(await fetch(URL_DA_API, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "marcar", ...d }),
  }))).marcacao,
  reservar: async (tipo, qtd) => lerJson(await fetch(URL_DA_API, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "reservar", tipo, qtd }),
  })),
};

// ── O Google Maps no navegador ─────────────────────────────────────────────

let carregandoGoogle: Promise<any> | null = null;
function carregarGoogle(chave: string): Promise<any> {
  const w = window as any;
  if (w.google?.maps?.importLibrary) return Promise.resolve(w.google);
  if (carregandoGoogle) return carregandoGoogle;
  carregandoGoogle = new Promise((resolve, reject) => {
    w.__fhMapaDeProspeccaoPronto = () => resolve(w.google);
    const tag = document.createElement("script");
    tag.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(chave)}&v=weekly&loading=async&language=pt-BR&region=BR&libraries=places&callback=__fhMapaDeProspeccaoPronto`;
    tag.async = true;
    tag.onerror = () => { carregandoGoogle = null; reject(new Error("Não deu para carregar o Google Maps.")); };
    document.head.appendChild(tag);
  });
  return carregandoGoogle;
}

/** Sem os ícones de comércio do Google: no mapa, restaurante é só o nosso pino. */
const ESTILO_SEM_COMERCIOS = [
  { featureType: "poi.business", stylers: [{ visibility: "off" }] },
  { featureType: "poi", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
];

/** Área buscada: "cheia" voltou com 20 (pode ter mais); "aprofundada" já virou 4. */
type CelulaBuscada = { celula: Celula; estado: "feita" | "cheia" | "aprofundada"; qtd: number };

/** Os retângulos da varredura: cinza = falta buscar, verde = buscada, laranja = cheia. */
const ESTILO_DA_AREA = {
  pendente: { strokeColor: "#64748B", strokeOpacity: 0.5, strokeWeight: 1, fillColor: "#64748B", fillOpacity: 0.06 },
  feita: { strokeColor: "#16A34A", strokeOpacity: 0.45, strokeWeight: 1, fillColor: "#16A34A", fillOpacity: 0.03 },
  cheia: { strokeColor: "#F97316", strokeOpacity: 0.8, strokeWeight: 2, fillColor: "#F97316", fillOpacity: 0.07 },
  aprofundada: { strokeOpacity: 0, fillOpacity: 0 },
};

/** O Google traz até 20 lugares por busca. */
const MAXIMO_DA_BUSCA = 20;

/**
 * O pino é uma camada nossa (OverlayView) com HTML, não o marcador do Google:
 * assim o mapa não precisa de Map ID e o estilo acima vale (com Map ID, `styles`
 * é ignorado). O balão do mouse e as cores vêm do CSS.
 */
let ClasseDoPino: any = null;
function classeDoPino(g: any) {
  if (ClasseDoPino) return ClasseDoPino;
  ClasseDoPino = class extends g.maps.OverlayView {
    posicao: any;
    el: HTMLElement;
    constructor(posicao: { lat: number; lng: number }, el: HTMLElement) {
      super();
      this.posicao = new g.maps.LatLng(posicao.lat, posicao.lng);
      this.el = el;
      g.maps.OverlayView.preventMapHitsAndGesturesFrom(el);
    }
    onAdd() { this.getPanes().overlayMouseTarget.appendChild(this.el); }
    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(this.posicao);
      if (!p) return;
      this.el.style.left = `${p.x}px`;
      this.el.style.top = `${p.y}px`;
    }
    onRemove() { this.el.remove(); }
    trocar(el: HTMLElement) {
      g.maps.OverlayView.preventMapHitsAndGesturesFrom(el);
      this.el.replaceWith(el);
      this.el = el;
      this.draw();
    }
  };
  return ClasseDoPino;
}

// ── Os dados da tela ────────────────────────────────────────────────────────

type Lugar = {
  id: string;
  nome: string;
  endereco: string;
  lat: number;
  lng: number;
  tipo: string | null;
  mapsUrl: string | null;
};

type Contato = {
  telefone: string | null;
  telefoneInternacional: string | null;
  site: string | null;
  nota: number | null;
  avaliacoes: number | null;
  horario: string[];
};

/** O que vira pino: um lugar do Google ou uma loja nossa que o Google não trouxe. */
type Pino = {
  chave: string;
  placeId: string | null;
  nome: string;
  endereco: string;
  lat: number;
  lng: number;
  status: StatusDoPino;
  loja: LojaDoMapa | null;
  lugar: Lugar | null;
};

const ROTULO: Record<StatusDoPino, string> = {
  cliente: "Cliente FireHub",
  negociacao: "Em negociação",
  sem_interesse: "Não quis",
  oportunidade: "Oportunidade",
};
const ORDEM: StatusDoPino[] = ["oportunidade", "negociacao", "cliente", "sem_interesse"];

const TIPOS_EM_PORTUGUES: Record<string, string> = {
  restaurant: "Restaurante", pizza_restaurant: "Pizzaria", hamburger_restaurant: "Hamburgueria",
  fast_food_restaurant: "Lanchonete", meal_takeaway: "Para viagem", meal_delivery: "Delivery", bakery: "Padaria",
  cafe: "Café", bar: "Bar", ice_cream_shop: "Sorveteria", japanese_restaurant: "Japonês", sushi_restaurant: "Sushi",
  brazilian_restaurant: "Comida brasileira", barbecue_restaurant: "Churrascaria", steak_house: "Churrascaria",
  sandwich_shop: "Lanchonete", acai_shop: "Açaí", confectionery: "Doceria", dessert_shop: "Doceria",
  chinese_restaurant: "Chinês", italian_restaurant: "Italiano", middle_eastern_restaurant: "Árabe",
  lebanese_restaurant: "Árabe", food_court: "Praça de alimentação", pub: "Bar", buffet_restaurant: "Self-service",
};

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

export default function MapaDeProspeccao({ api = apiDoServidor, cidadeInicial = "" }: { api?: ApiDoMapa; cidadeInicial?: string }) {
  const [carga, setCarga] = useState<CargaDoMapa | null>(null);
  const [uso, setUso] = useState<UsoDoDia | null>(null);
  const [cidadeDigitada, setCidadeDigitada] = useState(cidadeInicial);
  const [cidade, setCidade] = useState<string>("");
  const [lugares, setLugares] = useState<Map<string, Lugar>>(new Map());
  const [termosFeitos, setTermosFeitos] = useState<Set<string>>(new Set());
  const [marcacoes, setMarcacoes] = useState<Map<string, Marcacao>>(new Map());
  const [contatos, setContatos] = useState<Map<string, Contato>>(new Map());
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<StatusDoPino | "todos">("todos");
  const [procura, setProcura] = useState("");
  const [buscando, setBuscando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "erro" | "ok" | "info"; texto: string } | null>(null);
  const [erroDoMapa, setErroDoMapa] = useState<string | null>(null);
  /** Sobe quando o mapa do Google fica pronto, para os efeitos dos pinos rodarem. */
  const [pronto, setPronto] = useState(0);
  /** A varredura por áreas: onde a cidade tem restaurante e as células já buscadas. */
  const [areaDaCidade, setAreaDaCidade] = useState<CaixaDaCidade | null>(null);
  const [celulas, setCelulas] = useState<Map<string, CelulaBuscada>>(new Map());
  const [varrendo, setVarrendo] = useState<{ feitas: number; total: number } | null>(null);
  const [mostrarAreas, setMostrarAreas] = useState(true);
  const pararVarredura = useRef(false);

  const caixaDoMapa = useRef<HTMLDivElement>(null);
  const mapa = useRef<any>(null);
  const google = useRef<any>(null);
  const marcadores = useRef<Map<string, any>>(new Map());
  const retangulos = useRef<Map<string, any>>(new Map());

  // ── Primeira carga: a chave, as cidades e o uso do dia ──
  useEffect(() => {
    let vivo = true;
    api.carregar("").then((c) => {
      if (!vivo) return;
      setCarga(c);
      setUso(c.uso);
      if (cidadeInicial) abrirCidade(cidadeInicial);
    }).catch((e) => setAviso({ tipo: "erro", texto: e.message }));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── O mapa, quando a chave chega ──
  useEffect(() => {
    if (!carga?.chave || !caixaDoMapa.current || mapa.current) return;
    (window as any).gm_authFailure = () => setErroDoMapa("O Google recusou a chave do mapa neste endereço. Avise o administrador.");
    carregarGoogle(carga.chave).then(async (g) => {
      google.current = g;
      const { Map: MapaDoGoogle } = await g.maps.importLibrary("maps");
      mapa.current = new MapaDoGoogle(caixaDoMapa.current, {
        center: { lat: -15.78, lng: -47.93 }, zoom: 4, styles: ESTILO_SEM_COMERCIOS,
        streetViewControl: false, mapTypeControl: false, fullscreenControl: true, clickableIcons: false,
      });
      setPronto((n) => n + 1);
    }).catch((e) => setErroDoMapa(e.message));
  }, [carga?.chave]);

  // ── Os pinos ──
  const pinos = useMemo<Pino[]>(() => {
    const lojas = carga?.lojas || [];
    const lojasCasadas = new Set<string>();
    const saida: Pino[] = [];
    for (const l of lugares.values()) {
      const loja = lojaDoLugar(l, lojas);
      if (loja) lojasCasadas.add(loja.id);
      const m = marcacoes.get(l.id);
      saida.push({
        chave: l.id, placeId: l.id, nome: l.nome, endereco: l.endereco, lat: l.lat, lng: l.lng,
        status: loja ? "cliente" : m?.status || "oportunidade", loja, lugar: l,
      });
    }
    for (const loja of lojas) {
      if (lojasCasadas.has(loja.id) || loja.lat == null || loja.lng == null) continue;
      saida.push({
        chave: `loja:${loja.id}`, placeId: null, nome: loja.nome, endereco: loja.endereco || "",
        lat: loja.lat, lng: loja.lng, status: "cliente", loja, lugar: null,
      });
    }
    return saida;
  }, [lugares, marcacoes, carga?.lojas]);

  const contagem = useMemo(() => {
    const c: Record<StatusDoPino, number> = { cliente: 0, negociacao: 0, sem_interesse: 0, oportunidade: 0 };
    for (const p of pinos) c[p.status]++;
    return c;
  }, [pinos]);

  const visiveis = useMemo(() => {
    const q = nomeDaCidade(procura);
    return pinos
      .filter((p) => filtro === "todos" || p.status === filtro)
      .filter((p) => !q || nomeDaCidade(`${p.nome} ${p.endereco}`).includes(q))
      .sort((a, b) => ORDEM.indexOf(a.status) - ORDEM.indexOf(b.status) || a.nome.localeCompare(b.nome));
  }, [pinos, filtro, procura]);

  // Sincroniza os marcadores com os pinos visíveis.
  useEffect(() => {
    const g = google.current;
    if (!g || !mapa.current) return;
    const PinoNoMapa = classeDoPino(g);
    const atuais = marcadores.current;
    const queremos = new Set(visiveis.map((p) => p.chave));
    for (const [k, m] of atuais) if (!queremos.has(k)) { m.setMap(null); atuais.delete(k); }
    for (const p of visiveis) {
      const conteudo = elementoDoPino(p, p.chave === selecionado, () => setSelecionado(p.chave));
      const existente = atuais.get(p.chave);
      if (existente) { existente.trocar(conteudo); continue; }
      const m = new PinoNoMapa({ lat: p.lat, lng: p.lng }, conteudo);
      m.setMap(mapa.current);
      atuais.set(p.chave, m);
    }
  }, [visiveis, selecionado, pronto]);

  // ── A varredura: o que falta, o que encheu e os retângulos no mapa ──
  const celulasPendentes = useMemo(() => {
    if (!areaDaCidade) return [];
    const todos = [...lugares.values()];
    // Primeiro onde não tem pino nenhum: é ali que faltam lugares.
    // A grade da cidade + os pedaços das áreas aprofundadas que ainda não foram buscados
    // (a varredura parada no meio não perde nada).
    const filhas = [...celulas.values()].filter((x) => x.estado === "aprofundada").flatMap((x) => dividirCelula(x.celula));
    return [...gradeDaArea(areaDaCidade), ...filhas]
      .filter((c) => !celulas.has(c.id))
      .map((c) => ({ c, n: todos.filter((l) => dentroDaCaixa(l, c)).length }))
      .sort((a, b) => a.n - b.n)
      .map((x) => x.c);
  }, [areaDaCidade, celulas, lugares]);

  const celulasCheias = useMemo(
    () => [...celulas.values()].filter((x) => x.estado === "cheia" && x.celula.nivel < 3).map((x) => x.celula),
    [celulas],
  );

  useEffect(() => {
    const g = google.current;
    if (!g || !mapa.current) return;
    const atuais = retangulos.current;
    const queremos = new Map<string, { celula: Celula; estilo: any }>();
    if (mostrarAreas) {
      for (const c of celulasPendentes) queremos.set(c.id, { celula: c, estilo: ESTILO_DA_AREA.pendente });
      for (const x of celulas.values()) if (x.estado !== "aprofundada") queremos.set(x.celula.id, { celula: x.celula, estilo: ESTILO_DA_AREA[x.estado] });
    }
    for (const [k, r] of atuais) if (!queremos.has(k)) { r.setMap(null); atuais.delete(k); }
    for (const [k, { celula: c, estilo }] of queremos) {
      const r = atuais.get(k);
      if (r) { r.setOptions(estilo); continue; }
      atuais.set(k, new g.maps.Rectangle({
        map: mapa.current, clickable: false, zIndex: 1,
        bounds: { south: c.sul, west: c.oeste, north: c.norte, east: c.leste }, ...estilo,
      }));
    }
  }, [celulasPendentes, celulas, mostrarAreas, pronto]);

  // Leva o mapa até a cidade.
  useEffect(() => {
    const g = google.current;
    const caixa = carga?.cidade?.caixa;
    if (!g || !mapa.current || !caixa) return;
    mapa.current.fitBounds({ south: caixa.sul, west: caixa.oeste, north: caixa.norte, east: caixa.leste });
  }, [carga?.cidade, pronto]);

  // ── Ações ──
  const reservar = useCallback(async (tipo: TipoDeUso, qtd: number) => {
    const r = await api.reservar(tipo, qtd);
    setUso(r.uso);
    if (!r.ok) {
      setAviso({
        tipo: "erro",
        texto: `${tipo === "texto" ? "As buscas por nome" : tipo === "area" ? "As buscas por área" : "Os contatos"} grátis de hoje acabaram para a equipe. Amanhã liberam de novo (vira às 4h/5h da manhã).`,
      });
    }
    return r.ok;
  }, [api]);

  const juntarLugares = useCallback((lista: any[]) => {
    setLugares((antes) => {
      const novo = new Map(antes);
      for (const p of lista) {
        if (!p?.id || !p.location || p.businessStatus === "CLOSED_PERMANENTLY") continue;
        novo.set(p.id, {
          id: p.id,
          nome: p.displayName || "Sem nome",
          endereco: p.formattedAddress || "",
          lat: p.location.lat(),
          lng: p.location.lng(),
          tipo: p.primaryType || null,
          mapsUrl: p.googleMapsURI || null,
        });
      }
      return novo;
    });
  }, []);

  async function buscarTermo(termo: string, nomeDaCidadeAtual: string, caixa: CaixaDaCidade | null) {
    const g = google.current;
    if (!g) return null;
    if (!(await reservar("texto", 1))) return null;
    const { Place } = await g.maps.importLibrary("places");
    const pedido: any = {
      textQuery: `${termo} em ${nomeDaCidadeAtual}`,
      fields: [...CAMPOS_DA_BUSCA],
      maxResultCount: 20,
      language: "pt-BR",
      region: "br",
    };
    if (caixa) pedido.locationRestriction = { south: caixa.sul, west: caixa.oeste, north: caixa.norte, east: caixa.leste };
    const { places } = await Place.searchByText(pedido);
    juntarLugares(places || []);
    setTermosFeitos((t) => new Set(t).add(termo));
    return (places || []) as any[];
  }

  async function abrirCidade(nome: string) {
    const alvo = nome.trim();
    if (!alvo) return;
    setBuscando("cidade");
    setAviso(null);
    setSelecionado(null);
    try {
      const c = await api.carregar(alvo);
      setCarga(c);
      setUso(c.uso);
      setCidade(alvo);
      setLugares(new Map());
      setCelulas(new Map());
      setAreaDaCidade(null);
      setTermosFeitos(new Set());
      setContatos(new Map());
      setMarcacoes(new Map(c.marcacoes.map((m) => [m.placeId, m])));
      // Espera o Google, se a primeira carga ainda está trazendo o mapa.
      for (let i = 0; i < 50 && !google.current; i++) await new Promise((r) => setTimeout(r, 200));
      if (!google.current) return;
      const achados: any[] = [];
      for (const termo of TERMOS_DA_CIDADE) {
        setBuscando(termo);
        const lista = await buscarTermo(termo, alvo, c.cidade?.caixa || null);
        if (!lista) break;
        achados.push(...lista);
      }
      // A caixa do município pega a zona rural inteira: o mapa fecha onde estão os restaurantes.
      if (achados.length >= 3 && mapa.current) {
        const limites = new google.current.maps.LatLngBounds();
        for (const p of achados) if (p?.location) limites.extend(p.location);
        mapa.current.fitBounds(limites, 40);
      }
      // Onde a cidade tem restaurante: é essa área que a varredura corta em células.
      setAreaDaCidade(areaParaVarrer(
        achados.filter((p) => p?.location).map((p) => ({ lat: p.location.lat(), lng: p.location.lng() })),
        c.cidade?.caixa || null,
      ));
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e?.message || "Não deu para buscar agora." });
    } finally {
      setBuscando(null);
    }
  }

  async function buscarExtra(termo: string) {
    if (!cidade) return;
    setBuscando(termo);
    try { await buscarTermo(termo, cidade, carga?.cidade?.caixa || null); }
    catch (e: any) { setAviso({ tipo: "erro", texto: e?.message || "Não deu para buscar agora." }); }
    finally { setBuscando(null); }
  }

  /**
   * Uma célula = uma busca por perto, do mais próximo do centro para fora
   * (rankPreference DISTANCE): cobre a célula inteira, não só os famosos.
   * Devolve null quando a cota do dia acabou.
   */
  async function buscarCelula(c: Celula): Promise<any[] | null> {
    const g = google.current;
    if (!g) return null;
    if (!(await reservar("area", 1))) return null;
    const { Place, SearchNearbyRankPreference } = await g.maps.importLibrary("places");
    const { places } = await Place.searchNearby({
      fields: [...CAMPOS_DA_BUSCA],
      locationRestriction: { center: c.centro, radius: c.raio },
      includedTypes: [...TIPOS_DA_AREA],
      rankPreference: SearchNearbyRankPreference?.DISTANCE ?? "DISTANCE",
      maxResultCount: MAXIMO_DA_BUSCA,
      language: "pt-BR",
      region: "br",
    });
    const lista = (places || []) as any[];
    juntarLugares(lista);
    setCelulas((antes) => new Map(antes).set(c.id, {
      celula: c, estado: lista.length >= MAXIMO_DA_BUSCA ? "cheia" : "feita", qtd: lista.length,
    }));
    return lista;
  }

  /** Busca as células uma a uma; para quando a cota acaba ou o vendedor toca em "Parar". */
  async function varrer(lista: Celula[], aprofundando: Celula[] = []) {
    if (!lista.length) return;
    pararVarredura.current = false;
    setBuscando("varredura");
    setAviso(null);
    if (aprofundando.length) {
      setCelulas((antes) => {
        const novo = new Map(antes);
        for (const c of aprofundando) {
          const x = novo.get(c.id);
          if (x) novo.set(c.id, { ...x, estado: "aprofundada" });
        }
        return novo;
      });
    }
    const vistos = new Set(lugares.keys());
    let feitas = 0;
    let novos = 0;
    try {
      for (const c of lista) {
        if (pararVarredura.current) break;
        setVarrendo({ feitas, total: lista.length });
        const achados = await buscarCelula(c);
        if (!achados) return;
        feitas++;
        for (const p of achados) if (p?.id && !vistos.has(p.id)) { vistos.add(p.id); novos++; }
      }
      setAviso({ tipo: "info", texto: `${feitas} áreas buscadas: ${novos} lugares novos no mapa.` });
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e?.message || "Não deu para buscar agora." });
    } finally {
      setVarrendo(null);
      setBuscando(null);
    }
  }

  /** "Buscar nesta área": o que está na tela vira uma célula (e entra na cobertura). */
  async function buscarNaArea() {
    const m = mapa.current;
    const limites = m?.getBounds();
    if (!limites) return;
    const ne = limites.getNorthEast();
    const so = limites.getSouthWest();
    const c = celulaDaCaixa({ sul: so.lat(), oeste: so.lng(), norte: ne.lat(), leste: ne.lng() }, 0);
    setBuscando("area");
    try {
      const achados = await buscarCelula(c);
      if (!achados) return;
      const n = achados.length;
      setAviso({
        tipo: "info",
        texto: n >= MAXIMO_DA_BUSCA && c.raio > 3000
          ? `${n} lugares (o máximo de uma busca). Aproxime o mapa e busque de novo para ver os que faltam aqui.`
          : `${n} lugares nesta área.`,
      });
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e?.message || "Não deu para buscar agora." });
    } finally {
      setBuscando(null);
    }
  }

  async function verContato(placeId: string) {
    const g = google.current;
    if (!g) return;
    setBuscando(`contato:${placeId}`);
    try {
      if (!(await reservar("contato", 1))) return;
      const { Place } = await g.maps.importLibrary("places");
      const p = new Place({ id: placeId });
      await p.fetchFields({ fields: [...CAMPOS_DO_CONTATO] });
      setContatos((antes) => new Map(antes).set(placeId, {
        telefone: p.nationalPhoneNumber || null,
        telefoneInternacional: p.internationalPhoneNumber || null,
        site: p.websiteURI || null,
        nota: typeof p.rating === "number" ? p.rating : null,
        avaliacoes: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        horario: p.regularOpeningHours?.weekdayDescriptions || [],
      }));
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e?.message || "Não deu para buscar o contato agora." });
    } finally {
      setBuscando(null);
    }
  }

  async function salvarMarcacao(placeId: string, status: StatusDaMarcacao, nota: string) {
    if (!cidade) return;
    try {
      const m = await api.marcar({ placeId, cidade, status, nota });
      setMarcacoes((antes) => new Map(antes).set(placeId, m));
      setAviso({ tipo: "ok", texto: "Anotação salva. A equipe toda vê." });
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e?.message || "Não deu para salvar." });
    }
  }

  function focar(p: Pino) {
    setSelecionado(p.chave);
    if (mapa.current) {
      mapa.current.panTo({ lat: p.lat, lng: p.lng });
      if ((mapa.current.getZoom() || 0) < 15) mapa.current.setZoom(16);
    }
  }

  const pinoAberto = pinos.find((p) => p.chave === selecionado) || null;
  const semChave = carga && !carga.chave;

  return (
    <section className={s.mapa}>
      <header className={s.topo}>
        <div className={s.titulo}>
          <h2>Mapa de prospecção</h2>
          <p>Escolha a cidade: aparecem os restaurantes do Google, pintados por quem já é cliente e por quem a equipe já procurou.</p>
        </div>
        <form className={s.filtro} onSubmit={(e) => { e.preventDefault(); abrirCidade(cidadeDigitada); }}>
          <label htmlFor="mp-cidade">Cidade</label>
          <input id="mp-cidade" list="mp-cidades" value={cidadeDigitada} onChange={(e) => setCidadeDigitada(e.target.value)}
            placeholder="Ex.: Trindade - GO" autoComplete="off" />
          <datalist id="mp-cidades">
            {(carga?.cidades || []).map((c) => <option key={c.nome} value={c.nome}>{c.lojas} {c.lojas === 1 ? "loja" : "lojas"} do FireHub</option>)}
          </datalist>
          <button type="submit" disabled={!!buscando || !cidadeDigitada.trim() || !!semChave}>
            {buscando === "cidade" || TERMOS_DA_CIDADE.includes(buscando as any) ? "Buscando…" : "Buscar restaurantes"}
          </button>
        </form>
        {uso && (
          <div className={s.cota} title="A cota é da equipe toda e é grátis. Vira de madrugada.">
            <Medidor rotulo="Buscas por nome hoje" usado={uso.texto} limite={LIMITES_DO_DIA.texto} />
            <Medidor rotulo="Buscas por área hoje" usado={uso.area} limite={LIMITES_DO_DIA.area} />
            <Medidor rotulo="Contatos hoje" usado={uso.contato} limite={LIMITES_DO_DIA.contato} />
          </div>
        )}
      </header>

      {aviso && (
        <div className={`${s.aviso} ${s[`aviso_${aviso.tipo}`]}`} role="status">
          <span>{aviso.texto}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso">×</button>
        </div>
      )}

      <div className={s.legenda}>
        <button type="button" className={`${s.chip} ${filtro === "todos" ? s.chipAtivo : ""}`} onClick={() => setFiltro("todos")}>
          Todos <b>{pinos.length}</b>
        </button>
        {(["cliente", "negociacao", "oportunidade", "sem_interesse"] as StatusDoPino[]).map((st) => (
          <button key={st} type="button" className={`${s.chip} ${filtro === st ? s.chipAtivo : ""}`} onClick={() => setFiltro(filtro === st ? "todos" : st)}>
            <i className={`${s.bolinha} ${s[`cor_${st}`]}`} /> {ROTULO[st]} <b>{contagem[st]}</b>
          </button>
        ))}
      </div>

      <div className={s.corpo}>
        <div className={s.areaDoMapa}>
          <div ref={caixaDoMapa} className={s.google} />
          {semChave && (
            <div className={s.vazio}>
              <strong>O mapa ainda não foi ligado no servidor.</strong>
              <span>Falta a chave GOOGLE_MAPS_NAVEGADOR_KEY. Avise o administrador.</span>
            </div>
          )}
          {erroDoMapa && <div className={s.vazio}><strong>{erroDoMapa}</strong></div>}
          {cidade && !semChave && (
            <div className={s.acoesDoMapa}>
              <button type="button" onClick={buscarNaArea} disabled={!!buscando}>
                {buscando === "area" ? "Buscando…" : "Buscar nesta área"}
              </button>
            </div>
          )}
        </div>

        <aside className={s.lado}>
          {pinoAberto ? (
            <Cartao
              key={pinoAberto.chave}
              pino={pinoAberto}
              marcacao={pinoAberto.placeId ? marcacoes.get(pinoAberto.placeId) || null : null}
              contato={pinoAberto.placeId ? contatos.get(pinoAberto.placeId) || null : null}
              buscandoContato={buscando === `contato:${pinoAberto.placeId}`}
              contatosRestantes={uso ? LIMITES_DO_DIA.contato - uso.contato : null}
              onVerContato={() => pinoAberto.placeId && verContato(pinoAberto.placeId)}
              onSalvar={(st, nota) => pinoAberto.placeId && salvarMarcacao(pinoAberto.placeId, st, nota)}
              onFechar={() => setSelecionado(null)}
            />
          ) : (
            <>
              {cidade && areaDaCidade && (
                <Cobertura
                  pendentes={celulasPendentes}
                  cheias={celulasCheias}
                  buscadas={[...celulas.values()].filter((x) => x.estado !== "aprofundada").length}
                  restantes={uso ? LIMITES_DO_DIA.area - uso.area : 0}
                  varrendo={varrendo}
                  ocupado={!!buscando}
                  mostrarAreas={mostrarAreas}
                  onMostrarAreas={setMostrarAreas}
                  onVarrer={(n) => varrer(celulasPendentes.slice(0, n))}
                  onAprofundar={(n) => {
                    const cheias = celulasCheias.slice(0, n / 4);
                    varrer(cheias.flatMap(dividirCelula), cheias);
                  }}
                  onParar={() => { pararVarredura.current = true; }}
                />
              )}
              {cidade && (
                <div className={s.extras}>
                  <span>Buscar também:</span>
                  <div>
                    {TERMOS_EXTRAS.map((t) => (
                      <button key={t} type="button" disabled={!!buscando || termosFeitos.has(t)} onClick={() => buscarExtra(t)}
                        className={termosFeitos.has(t) ? s.extraFeito : ""}>
                        {buscando === t ? "…" : termosFeitos.has(t) ? `✓ ${t}` : t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <input className={s.procura} value={procura} onChange={(e) => setProcura(e.target.value)} placeholder="Procurar na lista por nome ou rua" />
              <ul className={s.lista}>
                {!cidade && <li className={s.dica}>Digite a cidade e toque em <b>Buscar restaurantes</b>.</li>}
                {cidade && !visiveis.length && !buscando && <li className={s.dica}>Nada aqui com esse filtro.</li>}
                {visiveis.map((p) => {
                  const m = p.placeId ? marcacoes.get(p.placeId) : null;
                  return (
                    <li key={p.chave}>
                      <button type="button" onClick={() => focar(p)} className={s.item}>
                        <i className={`${s.bolinha} ${s[`cor_${p.status}`]}`} />
                        <span className={s.itemTexto}>
                          <strong>{p.nome}</strong>
                          <small>{p.endereco || "Sem endereço"}</small>
                          {p.loja?.semCardapio && <em className={s.semCardapio}>Loja sem cardápio</em>}
                          {m?.nota && <small className={s.notaCurta}>“{m.nota.slice(0, 90)}{m.nota.length > 90 ? "…" : ""}” — {m.vendedor || "equipe"}</small>}
                        </span>
                        <span className={`${s.etiqueta} ${s[`et_${p.status}`]}`}>{ROTULO[p.status]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function elementoDoPino(p: Pino, aberto: boolean, onClicar: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = `${s.pino} ${s[`cor_${p.status}`]} ${aberto ? s.pinoAberto : ""}`;
  el.addEventListener("click", (e) => { e.stopPropagation(); onClicar(); });
  el.innerHTML = `<span class="${s.pinoLetra}">${p.status === "cliente" ? "F" : ""}</span>`;
  const balao = document.createElement("div");
  balao.className = s.balao;
  const nome = document.createElement("strong");
  nome.textContent = p.nome;
  const end = document.createElement("span");
  end.textContent = p.endereco;
  const st = document.createElement("em");
  st.textContent = ROTULO[p.status] + (p.loja?.semCardapio ? " · sem cardápio" : "");
  balao.append(nome, end, st);
  el.appendChild(balao);
  return el;
}

/**
 * A caixa da varredura: o Google traz no máximo 20 por busca, então a cidade é
 * buscada por áreas. Cinza no mapa = falta buscar; laranja = área cheia, que
 * pode ser aprofundada (vira 4 menores).
 */
function Cobertura({ pendentes, cheias, buscadas, restantes, varrendo, ocupado, mostrarAreas, onMostrarAreas, onVarrer, onAprofundar, onParar }: {
  pendentes: Celula[];
  cheias: Celula[];
  buscadas: number;
  restantes: number;
  varrendo: { feitas: number; total: number } | null;
  ocupado: boolean;
  mostrarAreas: boolean;
  onMostrarAreas: (v: boolean) => void;
  onVarrer: (n: number) => void;
  onAprofundar: (n: number) => void;
  onParar: () => void;
}) {
  const varrer = Math.min(pendentes.length, restantes);
  // Aprofunda só área inteira: cada uma vira 4 buscas.
  const aprofundar = Math.min(cheias.length, Math.floor(restantes / 4)) * 4;
  return (
    <div className={s.cobertura}>
      <strong>Achar todos os restaurantes</strong>
      {varrendo ? (
        <>
          <p>Buscando área {varrendo.feitas + 1} de {varrendo.total}…</p>
          <button type="button" className={s.botaoClaro} onClick={onParar}>Parar</button>
        </>
      ) : (
        <>
          <p>
            O Google traz no máximo 20 lugares por busca, os do centro primeiro. Para os bairros de fora aparecerem,
            busque a cidade por áreas{buscadas > 0 && <> — {buscadas} já buscadas</>}.
          </p>
          {pendentes.length > 0 && (
            <button type="button" className={s.botaoPrincipal} disabled={ocupado || varrer === 0} onClick={() => onVarrer(varrer)}>
              Buscar {varrer === pendentes.length ? "as" : `${varrer} das`} {pendentes.length} áreas cinzas · usa {varrer} {varrer === 1 ? "busca" : "buscas"}
            </button>
          )}
          {cheias.length > 0 && (
            <button type="button" className={s.botaoClaro} disabled={ocupado || aprofundar === 0} onClick={() => onAprofundar(aprofundar)}>
              Aprofundar {cheias.length} {cheias.length === 1 ? "área laranja" : "áreas laranjas"} (podem ter mais) · usa {aprofundar} {aprofundar === 1 ? "busca" : "buscas"}
            </button>
          )}
          {!pendentes.length && !cheias.length && <p className={s.coberturaOk}>Cidade toda buscada.</p>}
          {restantes === 0 && <small>As buscas por área de hoje acabaram. Amanhã liberam de novo.</small>}
          <label className={s.mostrarAreas}>
            <input type="checkbox" checked={mostrarAreas} onChange={(e) => onMostrarAreas(e.target.checked)} /> Mostrar as áreas no mapa
          </label>
        </>
      )}
    </div>
  );
}

function Medidor({ rotulo, usado, limite }: { rotulo: string; usado: number; limite: number }) {
  const pct = Math.min(100, Math.round((usado / limite) * 100));
  return (
    <div className={s.medidor}>
      <span>{rotulo}</span>
      <b>{usado} de {limite}</b>
      <i><u style={{ width: `${pct}%`, background: pct >= 90 ? "#DC2626" : pct >= 70 ? "#D97706" : "#16A34A" }} /></i>
    </div>
  );
}

function Cartao({ pino, marcacao, contato, buscandoContato, contatosRestantes, onVerContato, onSalvar, onFechar }: {
  pino: Pino;
  marcacao: Marcacao | null;
  contato: Contato | null;
  buscandoContato: boolean;
  contatosRestantes: number | null;
  onVerContato: () => void;
  onSalvar: (status: StatusDaMarcacao, nota: string) => void;
  onFechar: () => void;
}) {
  const [status, setStatus] = useState<StatusDaMarcacao>(marcacao?.status || "oportunidade");
  const [nota, setNota] = useState(marcacao?.nota || "");
  const whatsapp = linkDoWhatsapp(contato?.telefone);
  const tipo = pino.lugar?.tipo ? TIPOS_EM_PORTUGUES[pino.lugar.tipo] || null : null;
  const mudou = status !== (marcacao?.status || "oportunidade") || nota !== (marcacao?.nota || "");

  return (
    <div className={s.cartao}>
      <div className={s.cartaoTopo}>
        <button type="button" className={s.voltar} onClick={onFechar}>← Lista</button>
        <span className={`${s.etiqueta} ${s[`et_${pino.status}`]}`}>{ROTULO[pino.status]}</span>
      </div>
      <h3>{pino.nome}</h3>
      {tipo && <p className={s.tipo}>{tipo}</p>}
      <p className={s.endereco}>{pino.endereco || "Sem endereço"}</p>

      {pino.loja && (
        <div className={s.blocoCliente}>
          <strong>Já é cliente do FireHub</strong>
          {pino.loja.semCardapio
            ? <span className={s.semCardapio}>Loja sem cardápio — vale ligar e ajudar a montar</span>
            : <span className={s.comCardapio}>Cardápio no ar</span>}
          {pino.loja.vendedor && <span>Vendedor: {pino.loja.vendedor}</span>}
          {pino.loja.slug && <a href={`/loja/${pino.loja.slug}`} target="_blank" rel="noreferrer">Ver o cardápio da loja ↗</a>}
        </div>
      )}

      <div className={s.botoes}>
        <a className={s.botaoPrincipal} href={linkComoChegar({ nome: pino.nome, lat: pino.lat, lng: pino.lng, placeId: pino.placeId })} target="_blank" rel="noreferrer">
          Como chegar
        </a>
        {pino.lugar?.mapsUrl && <a className={s.botaoClaro} href={pino.lugar.mapsUrl} target="_blank" rel="noreferrer">Abrir no Google Maps</a>}
      </div>

      {pino.placeId && (
        <div className={s.contato}>
          <h4>Telefone e site</h4>
          {contato ? (
            <dl>
              <dt>Telefone</dt>
              <dd>
                {contato.telefone
                  ? <><a href={`tel:${contato.telefoneInternacional || contato.telefone}`}>{contato.telefone}</a>{whatsapp && <> · <a href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a></>}</>
                  : "O Google não tem"}
              </dd>
              <dt>Site</dt>
              <dd>{contato.site ? <a href={contato.site} target="_blank" rel="noreferrer">{contato.site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a> : "O Google não tem"}</dd>
              {contato.nota != null && (<><dt>Nota no Google</dt><dd>★ {contato.nota.toFixed(1)} ({contato.avaliacoes ?? 0} avaliações)</dd></>)}
              {contato.horario.length > 0 && (<><dt>Horário</dt><dd className={s.horario}>{contato.horario.map((h) => <span key={h}>{h}</span>)}</dd></>)}
            </dl>
          ) : (
            <>
              <button type="button" className={s.botaoClaro} onClick={onVerContato} disabled={buscandoContato || contatosRestantes === 0}>
                {buscandoContato ? "Buscando…" : "Ver telefone e site"}
              </button>
              <small>
                {contatosRestantes === 0
                  ? "Os contatos grátis de hoje acabaram para a equipe."
                  : `Usa 1 dos ${contatosRestantes ?? LIMITES_DO_DIA.contato} contatos grátis que ainda restam hoje (a equipe toda).`}
              </small>
            </>
          )}
        </div>
      )}

      {pino.placeId && !pino.loja && (
        <div className={s.anotar}>
          <h4>Anotação da equipe</h4>
          <div className={s.status}>
            {(["oportunidade", "negociacao", "sem_interesse"] as StatusDaMarcacao[]).map((st) => (
              <label key={st} className={status === st ? s.statusAtivo : ""}>
                <input type="radio" name="mp-status" checked={status === st} onChange={() => setStatus(st)} />
                <i className={`${s.bolinha} ${s[`cor_${st}`]}`} /> {ROTULO[st]}
              </label>
            ))}
          </div>
          <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={4} maxLength={2000}
            placeholder="Ex.: falei com o dono, usa o Anota AI; voltar na terça depois das 15h." />
          <button type="button" className={s.botaoPrincipal} disabled={!mudou} onClick={() => onSalvar(status, nota)}>Salvar anotação</button>
          {marcacao && marcacao.historico.length > 0 && (
            <ol className={s.historico}>
              {marcacao.historico.slice(0, 8).map((h, i) => (
                <li key={i}>
                  <span>{dataCurta(h.em)} · {h.por || "equipe"} · {ROTULO[h.status]}</span>
                  {h.nota && <p>{h.nota}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
