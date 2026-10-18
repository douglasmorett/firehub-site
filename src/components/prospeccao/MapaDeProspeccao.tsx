"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import s from "./MapaDeProspeccao.module.css";
import {
  CAMPOS_DA_BUSCA, CAMPOS_DO_CONTATO, TERMOS_EXTRAS,
  linkComoChegar, linkDoWhatsapp, lojaDoLugar, nomeDaCidade,
  type CaixaDaCidade, type LojaDoMapa, type StatusDaMarcacao, type StatusDoPino,
} from "@/lib/prospeccao/regras";
import {
  HABITANTES_POR_LUGAR, SKUS, juntarLugares, lugarDoGoogle, seloDaCobertura, tetoDoMes,
  type LugarDoMapa, type ResumoDaVarredura, type Sku,
} from "@/lib/prospeccao/varredura";
import type { CelulaParaBuscar, Marcacao, PedidoDaVarredura, RespostaDaVarredura, UsoDoMes } from "@/lib/prospeccao/dados";

/**
 * Mapa de prospecção do vendedor: a cidade no filtro, TODOS os lugares de
 * comida dela no mapa, pintados por status (cliente do FireHub / em
 * negociação / não quis / oportunidade), o cartão com contato e "Como
 * chegar", e a anotação do vendedor, que fica para a equipe toda.
 *
 * Os lugares vêm da VARREDURA da cidade (lib/prospeccao/varredura.ts): feita
 * uma vez, guardada 30 dias no servidor e usada por todos. Quem abre uma
 * cidade nunca varrida vê a estimativa de buscas e começa; este navegador
 * chama o Google lote a lote e devolve ao servidor, que divide as células
 * cheias e controla o grátis do mês. Passar do grátis, só o admin autoriza.
 *
 * `api` existe para a prévia rodar sem banco; no portal, fica o padrão.
 */

export type CargaDoMapa = {
  chave: string | null;
  cidades: { nome: string; lojas: number }[];
  uso: UsoDoMes;
  souAdmin: boolean;
  cidade: { nome: string; caixa: CaixaDaCidade; varredura: ResumoDaVarredura } | null;
  lugares: LugarDoMapa[];
  lojas: LojaDoMapa[];
  marcacoes: Marcacao[];
  error?: string;
};

export type ApiDoMapa = {
  carregar: (cidade: string) => Promise<CargaDoMapa>;
  marcar: (d: { placeId: string; cidade: string; status: StatusDaMarcacao; nota: string }) => Promise<Marcacao>;
  varrer: (p: PedidoDaVarredura) => Promise<RespostaDaVarredura>;
  reservar: (sku: Exclude<Sku, "nearby">, qtd: number) => Promise<{ ok: boolean; uso: UsoDoMes }>;
  guardarLugares: (cidade: string, lugares: LugarDoMapa[]) => Promise<void>;
};

const URL_DA_API = "/api/vendedor/prospeccao";

async function lerJson(r: Response) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Erro ${r.status}`);
  return j;
}
const postar = async (corpo: object) => lerJson(await fetch(URL_DA_API, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
}));

export const apiDoServidor: ApiDoMapa = {
  carregar: async (cidade) => lerJson(await fetch(`${URL_DA_API}?cidade=${encodeURIComponent(cidade)}`, { cache: "no-store" })),
  marcar: async (d) => (await postar({ acao: "marcar", ...d })).marcacao,
  varrer: async (p) => postar({ acao: "varrer", ...p }),
  reservar: async (sku, qtd) => postar({ acao: "reservar", sku, qtd }),
  guardarLugares: async (cidade, lugares) => { await postar({ acao: "lugares", cidade, lugares }); },
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

/** Acima disto, o mapa desenha só os pinos da parte da cidade que está na tela (Goiânia tem milhares). */
const PINOS_DE_UMA_VEZ = 1500;
/** A lista do lado mostra até isto; o resto aparece com a procura ou o filtro. */
const ITENS_NA_LISTA = 400;

// ── Os dados da tela ────────────────────────────────────────────────────────

type Contato = {
  telefone: string | null;
  telefoneInternacional: string | null;
  site: string | null;
  nota: number | null;
  avaliacoes: number | null;
  horario: string[];
};

/** O que vira pino: um lugar (Google ou OpenStreetMap) ou uma loja nossa que nenhum dos dois trouxe. */
type Pino = {
  chave: string;
  placeId: string | null;
  nome: string;
  endereco: string;
  lat: number;
  lng: number;
  status: StatusDoPino;
  loja: LojaDoMapa | null;
  lugar: LugarDoMapa | null;
};

const ROTULO: Record<StatusDoPino, string> = {
  cliente: "Cliente FireHub",
  negociacao: "Em negociação",
  sem_interesse: "Não quis",
  oportunidade: "Oportunidade",
};
const ORDEM: StatusDoPino[] = ["oportunidade", "negociacao", "cliente", "sem_interesse"];

const TIPOS_EM_PORTUGUES: Record<string, string> = {
  restaurant: "Restaurante", pizza_restaurant: "Pizzaria", pizza_delivery: "Pizzaria", hamburger_restaurant: "Hamburgueria",
  fast_food_restaurant: "Lanchonete", snack_bar: "Lanchonete", meal_takeaway: "Para viagem", meal_delivery: "Delivery", bakery: "Padaria",
  cafe: "Café", coffee_shop: "Café", bar: "Bar", ice_cream_shop: "Sorveteria", japanese_restaurant: "Japonês", sushi_restaurant: "Sushi",
  brazilian_restaurant: "Comida brasileira", barbecue_restaurant: "Churrascaria", steak_house: "Churrascaria",
  sandwich_shop: "Lanchonete", acai_shop: "Açaí", confectionery: "Doceria", dessert_shop: "Doceria", cake_shop: "Doceria",
  chinese_restaurant: "Chinês", italian_restaurant: "Italiano", middle_eastern_restaurant: "Árabe",
  lebanese_restaurant: "Árabe", food_court: "Praça de alimentação", pub: "Bar", buffet_restaurant: "Self-service",
  seafood_restaurant: "Frutos do mar", chicken_restaurant: "Frango", hot_dog_restaurant: "Cachorro-quente",
};

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
const diaEMes = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const dinheiro = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;
const numero = (n: number) => n.toLocaleString("pt-BR");
const origemDoPino = (l: LugarDoMapa | null) =>
  !l ? "Cadastro do FireHub" : l.origem === "osm" ? "Só no OpenStreetMap" : l.tambemNoOsm ? "Google (também no OpenStreetMap)" : "Google";

export default function MapaDeProspeccao({ api = apiDoServidor, cidadeInicial = "" }: { api?: ApiDoMapa; cidadeInicial?: string }) {
  const [carga, setCarga] = useState<CargaDoMapa | null>(null);
  const [uso, setUso] = useState<UsoDoMes | null>(null);
  const [cidadeDigitada, setCidadeDigitada] = useState(cidadeInicial);
  const [cidade, setCidade] = useState<string>("");
  const [resumo, setResumo] = useState<ResumoDaVarredura | null>(null);
  const [lugares, setLugares] = useState<Map<string, LugarDoMapa>>(new Map());
  const [termosFeitos, setTermosFeitos] = useState<Set<string>>(new Set());
  const [marcacoes, setMarcacoes] = useState<Map<string, Marcacao>>(new Map());
  const [contatos, setContatos] = useState<Map<string, Contato>>(new Map());
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<StatusDoPino | "todos">("todos");
  const [procura, setProcura] = useState("");
  const [buscando, setBuscando] = useState<string | null>(null);
  const [varrendo, setVarrendo] = useState(false);
  const [precisaAutorizar, setPrecisaAutorizar] = useState(false);
  const [mostrarGrade, setMostrarGrade] = useState(true);
  const [celulasFeitas, setCelulasFeitas] = useState(0);
  const [aviso, setAviso] = useState<{ tipo: "erro" | "ok" | "info"; texto: string } | null>(null);
  const [erroDoMapa, setErroDoMapa] = useState<string | null>(null);
  const [limitesDaTela, setLimitesDaTela] = useState<CaixaDaCidade | null>(null);
  /** Sobe quando o mapa do Google fica pronto, para os efeitos dos pinos rodarem. */
  const [pronto, setPronto] = useState(0);

  const caixaDoMapa = useRef<HTMLDivElement>(null);
  const mapa = useRef<any>(null);
  const google = useRef<any>(null);
  const marcadores = useRef<Map<string, any>>(new Map());
  const grade = useRef<any[]>([]);
  const pausar = useRef(false);
  const cidadeAtual = useRef("");
  const lugaresAgora = useRef(lugares);
  lugaresAgora.current = lugares;

  const souAdmin = !!carga?.souAdmin;

  // ── Primeira carga: a chave, as cidades e o uso do mês ──
  useEffect(() => {
    let vivo = true;
    api.carregar("").then((c) => {
      if (!vivo) return;
      setCarga(c);
      setUso(c.uso);
      if (cidadeInicial) abrirCidade(cidadeInicial);
    }).catch((e) => setAviso({ tipo: "erro", texto: e.message }));
    return () => { vivo = false; pausar.current = true; };
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
      mapa.current.addListener("idle", () => {
        const b = mapa.current.getBounds();
        if (!b) return;
        const ne = b.getNorthEast(), sw = b.getSouthWest();
        setLimitesDaTela({ sul: sw.lat(), oeste: sw.lng(), norte: ne.lat(), leste: ne.lng() });
      });
      // Cada abertura do mapa é 1 "Dynamic Maps" (10 mil grátis por mês): só conta.
      api.reservar("mapa", 1).then((r) => setUso(r.uso)).catch(() => {});
      setPronto((n) => n + 1);
    }).catch((e) => setErroDoMapa(e.message));
  }, [carga?.chave, api]);

  // ── Os pinos ──
  const pinos = useMemo<Pino[]>(() => {
    const lojas = carga?.lojas || [];
    const lojasCasadas = new Set<string>();
    const saida: Pino[] = [];
    // Google antes do OpenStreetMap: a loja que já casou com um lugar do Google não casa de novo com o do OSM.
    const ordem = [...lugares.values()].sort((a, b) => (a.origem === b.origem ? 0 : a.origem === "google" ? -1 : 1));
    for (const l of ordem) {
      const loja = lojaDoLugar(l, l.origem === "osm" ? lojas.filter((x) => !lojasCasadas.has(x.id)) : lojas);
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
  const soNoOsm = useMemo(() => pinos.filter((p) => p.lugar?.origem === "osm").length, [pinos]);

  const visiveis = useMemo(() => {
    const q = nomeDaCidade(procura);
    return pinos
      .filter((p) => filtro === "todos" || p.status === filtro)
      .filter((p) => !q || nomeDaCidade(`${p.nome} ${p.endereco}`).includes(q))
      .sort((a, b) => ORDEM.indexOf(a.status) - ORDEM.indexOf(b.status) || a.nome.localeCompare(b.nome));
  }, [pinos, filtro, procura]);

  /** No mapa: todos, ou — cidade grande — só os da parte que está na tela. */
  const noMapa = useMemo(() => {
    if (visiveis.length <= PINOS_DE_UMA_VEZ || !limitesDaTela) return visiveis;
    const t = limitesDaTela;
    return visiveis.filter((p) => p.lat >= t.sul && p.lat <= t.norte && p.lng >= t.oeste && p.lng <= t.leste || p.chave === selecionado);
  }, [visiveis, limitesDaTela, selecionado]);

  // Sincroniza os marcadores com os pinos do mapa.
  useEffect(() => {
    const g = google.current;
    if (!g || !mapa.current) return;
    const PinoNoMapa = classeDoPino(g);
    const atuais = marcadores.current;
    const queremos = new Set(noMapa.map((p) => p.chave));
    for (const [k, m] of atuais) if (!queremos.has(k)) { m.setMap(null); atuais.delete(k); }
    for (const p of noMapa) {
      const conteudo = elementoDoPino(p, p.chave === selecionado, () => setSelecionado(p.chave));
      const existente = atuais.get(p.chave);
      if (existente) { existente.trocar(conteudo); continue; }
      const m = new PinoNoMapa({ lat: p.lat, lng: p.lng }, conteudo);
      m.setMap(mapa.current);
      atuais.set(p.chave, m);
    }
  }, [noMapa, selecionado, pronto]);

  // A grade da varredura (desenhada só nesta tela, enquanto varre): liga e desliga.
  useEffect(() => {
    for (const r of grade.current) r.setMap(mostrarGrade ? mapa.current : null);
  }, [mostrarGrade]);

  // Leva o mapa até a cidade: onde estão os lugares (a caixa do município pega a zona rural inteira).
  const enquadrar = useCallback((lista: { lat: number; lng: number }[], caixa: CaixaDaCidade | null) => {
    const g = google.current;
    if (!g || !mapa.current) return;
    if (lista.length >= 3) {
      const limites = new g.maps.LatLngBounds();
      for (const p of lista) limites.extend({ lat: p.lat, lng: p.lng });
      mapa.current.fitBounds(limites, 40);
    } else if (caixa) {
      mapa.current.fitBounds({ south: caixa.sul, west: caixa.oeste, north: caixa.norte, east: caixa.leste });
    }
  }, []);

  useEffect(() => {
    if (carga?.cidade) enquadrar(carga.lugares, carga.cidade.caixa);
  }, [carga?.cidade, pronto, enquadrar]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ações ──
  const reservar = useCallback(async (sku: Exclude<Sku, "nearby">, qtd: number) => {
    const r = await api.reservar(sku, qtd);
    setUso(r.uso);
    if (!r.ok) {
      setAviso({
        tipo: "erro",
        texto: sku === "contato"
          ? "Os contatos grátis deste mês acabaram para a equipe. Liberam de novo no dia 1º."
          : "As buscas por termo grátis deste mês acabaram. Liberam de novo no dia 1º.",
      });
    }
    return r.ok;
  }, [api]);

  const juntar = useCallback((novos: LugarDoMapa[]) => {
    if (novos.length) setLugares((antes) => juntarLugares(antes.values(), novos));
  }, []);

  function limparGrade() {
    for (const r of grade.current) r.setMap(null);
    grade.current = [];
    setCelulasFeitas(0);
  }

  function desenharCelula(c: CelulaParaBuscar, cheia: boolean) {
    const g = google.current;
    if (!g || !mapa.current) return;
    const r = new g.maps.Rectangle({
      bounds: { north: c.n, south: c.s, east: c.l, west: c.o },
      strokeColor: cheia ? "#DC2626" : "#2563EB", strokeOpacity: 0.7, strokeWeight: 1,
      fillColor: cheia ? "#DC2626" : "#2563EB", fillOpacity: cheia ? 0.06 : 0.03,
      clickable: false, map: mostrarGrade ? mapa.current : null,
    });
    grade.current.push(r);
    setCelulasFeitas((n) => n + 1);
  }

  function receber(r: RespostaDaVarredura) {
    setResumo(r.resumo);
    setUso(r.uso);
    setPrecisaAutorizar(!!r.precisaAutorizar);
    if (r.aviso) setAviso({ tipo: "info", texto: r.aviso });
  }

  /** Busca uma célula no Google (Nearby Search, campos Pro). */
  async function buscarCelula(c: CelulaParaBuscar) {
    const { Place } = await google.current.maps.importLibrary("places");
    const { places } = await Place.searchNearby({
      fields: [...CAMPOS_DA_BUSCA],
      locationRestriction: { center: c.centro, radius: c.raio },
      includedTypes: c.tiposDaBusca,
      maxResultCount: c.maximo,
      language: "pt-BR",
      region: "br",
    });
    const lista = (places || []) as any[];
    const achados = lista.map(lugarDoGoogle).filter((l): l is LugarDoMapa => !!l);
    return { celulaId: c.id, bruto: lista.length, lugares: achados, cheia: lista.length >= c.maximo };
  }

  /**
   * A varredura: pede um lote ao servidor, busca as células no Google (todas
   * ao mesmo tempo), devolve, e repete até o servidor não mandar mais.
   */
  async function varrer(opcoes: { continuar?: boolean; autorizar?: boolean; refazer?: boolean }) {
    const alvo = cidade;
    if (!alvo || !google.current || varrendo) return;
    pausar.current = false;
    setVarrendo(true);
    setAviso(null);
    if (opcoes.refazer) limparGrade();
    try {
      let r = await api.varrer({ cidade: alvo, ...opcoes });
      receber(r);
      while (r.lote.length && cidadeAtual.current === alvo) {
        let erro: string | undefined;
        const resultados: { celulaId: string; bruto: number; lugares: LugarDoMapa[] }[] = [];
        await Promise.all(r.lote.map(async (c) => {
          try {
            const res = await buscarCelula(c);
            resultados.push(res);
            juntar(res.lugares);
            desenharCelula(c, res.cheia);
          } catch (e: any) {
            erro = erro || String(e?.message || e || "erro do Google");
          }
        }));
        r = await api.varrer({ cidade: alvo, resultados, erro, pausar: pausar.current || cidadeAtual.current !== alvo });
        receber(r);
        if (erro) {
          setAviso({ tipo: "erro", texto: /quota|RESOURCE_EXHAUSTED|429|OVER_QUERY/i.test(erro)
            ? "O Google parou a varredura pela trava do dia (Google Cloud). O que já veio está salvo; toque em Continuar amanhã."
            : `O Google recusou uma busca: ${erro.slice(0, 140)}. O que já veio está salvo.` });
          break;
        }
      }
      if (r.resumo.estado === "completa" && cidadeAtual.current === alvo) {
        // Fecha o mapa onde ficaram os lugares (a caixa do município pega a zona rural inteira).
        enquadrar([...lugaresAgora.current.values()], carga?.cidade?.caixa || null);
        setAviso({ tipo: "ok", texto: `Varredura terminada: ${numero(r.resumo.lugares)} lugares do Google em ${numero(r.resumo.chamadas)} buscas.` });
      }
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e?.message || "Não deu para varrer agora." });
    } finally {
      setVarrendo(false);
    }
  }

  async function abrirCidade(nome: string) {
    const alvo = nome.trim();
    if (!alvo) return;
    pausar.current = true;
    setBuscando("cidade");
    setAviso({ tipo: "info", texto: "Abrindo a cidade… Na primeira vez ela é buscada no mapa aberto (limites, população, OpenStreetMap) e pode levar até 1 minuto." });
    setSelecionado(null);
    try {
      const c = await api.carregar(alvo);
      setCarga(c);
      setUso(c.uso);
      setAviso(null);
      if (c.error) { setAviso({ tipo: "erro", texto: c.error }); return; }
      cidadeAtual.current = alvo;
      setCidade(alvo);
      setResumo(c.cidade?.varredura || null);
      setPrecisaAutorizar(false);
      setLugares(juntarLugares([], c.lugares));
      setTermosFeitos(new Set());
      setContatos(new Map());
      setMarcacoes(new Map(c.marcacoes.map((m) => [m.placeId, m])));
      limparGrade();
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e?.message || "Não deu para abrir a cidade agora." });
    } finally {
      setBuscando(null);
    }
  }

  async function buscarExtra(termo: string) {
    const g = google.current;
    if (!cidade || !g) return;
    setBuscando(termo);
    try {
      if (!(await reservar("texto", 1))) return;
      const { Place } = await g.maps.importLibrary("places");
      const caixa = carga?.cidade?.caixa;
      const pedido: any = { textQuery: `${termo} em ${cidade}`, fields: [...CAMPOS_DA_BUSCA], maxResultCount: 20, language: "pt-BR", region: "br" };
      if (caixa) pedido.locationRestriction = { south: caixa.sul, west: caixa.oeste, north: caixa.norte, east: caixa.leste };
      const { places } = await Place.searchByText(pedido);
      const achados = ((places || []) as any[]).map(lugarDoGoogle).filter((l): l is LugarDoMapa => !!l);
      const novos = achados.filter((l) => !lugares.has(l.id)).length;
      juntar(achados);
      setTermosFeitos((t) => new Set(t).add(termo));
      setAviso({ tipo: "info", texto: `"${termo}": ${achados.length} lugares, ${novos} que a varredura não tinha.` });
      if (achados.length) api.guardarLugares(cidade, achados).catch(() => {});
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
  const contatosRestantes = uso ? Math.max(0, tetoDoMes("contato") - uso.contato) : null;

  return (
    <section className={s.mapa}>
      <header className={s.topo}>
        <div className={s.titulo}>
          <h2>Mapa de prospecção</h2>
          <p>Escolha a cidade: aparecem todos os lugares de comida dela, pintados por quem já é cliente e por quem a equipe já procurou.</p>
        </div>
        <form className={s.filtro} onSubmit={(e) => { e.preventDefault(); abrirCidade(cidadeDigitada); }}>
          <label htmlFor="mp-cidade">Cidade</label>
          <input id="mp-cidade" list="mp-cidades" value={cidadeDigitada} onChange={(e) => setCidadeDigitada(e.target.value)}
            placeholder="Ex.: Rio das Ostras - RJ" autoComplete="off" />
          <datalist id="mp-cidades">
            {(carga?.cidades || []).map((c) => <option key={c.nome} value={c.nome}>{c.lojas} {c.lojas === 1 ? "loja" : "lojas"} do FireHub</option>)}
          </datalist>
          <button type="submit" disabled={!!buscando || varrendo || !cidadeDigitada.trim() || !!semChave}>
            {buscando === "cidade" ? "Abrindo…" : "Abrir cidade"}
          </button>
        </form>
      </header>

      {cidade && resumo && (
        <PainelDaCobertura
          resumo={resumo} totalNaTela={lugares.size} souAdmin={souAdmin} varrendo={varrendo} celulasFeitas={celulasFeitas}
          precisaAutorizar={precisaAutorizar} mostrarGrade={mostrarGrade} temGrade={celulasFeitas > 0}
          onVarrer={(o) => varrer(o)} onPausar={() => { pausar.current = true; }}
          onGrade={() => setMostrarGrade((v) => !v)} onRecarregar={() => abrirCidade(cidade)}
        />
      )}

      {souAdmin && uso && <ConsumoDoMes uso={uso} />}

      {aviso && (
        <div className={`${s.aviso} ${s[`aviso_${aviso.tipo}`]}`} role="status">
          <span>{aviso.texto}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Fechar aviso">×</button>
        </div>
      )}

      <div className={s.legenda}>
        <button type="button" className={`${s.chip} ${filtro === "todos" ? s.chipAtivo : ""}`} onClick={() => setFiltro("todos")}>
          Todos <b>{numero(pinos.length)}</b>
        </button>
        {(["cliente", "negociacao", "oportunidade", "sem_interesse"] as StatusDoPino[]).map((st) => (
          <button key={st} type="button" className={`${s.chip} ${filtro === st ? s.chipAtivo : ""}`} onClick={() => setFiltro(filtro === st ? "todos" : st)}>
            <i className={`${s.bolinha} ${s[`cor_${st}`]}`} /> {ROTULO[st]} <b>{numero(contagem[st])}</b>
          </button>
        ))}
        {soNoOsm > 0 && (
          <span className={s.legendaOsm} title="Lugares que o OpenStreetMap tem e o Google não trouxe. O pino tem borda tracejada.">
            <i className={`${s.bolinha} ${s.bolinhaOsm}`} /> Só no OpenStreetMap <b>{numero(soNoOsm)}</b>
          </span>
        )}
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
          {visiveis.length > noMapa.length && (
            <div className={s.acoesDoMapa}><span className={s.dicaDoMapa}>Mostrando {numero(noMapa.length)} de {numero(visiveis.length)} pinos — aproxime ou arraste para ver os outros</span></div>
          )}
          {soNoOsm > 0 && <small className={s.creditoOsm}>Dados extras © colaboradores do OpenStreetMap</small>}
        </div>

        <aside className={s.lado}>
          {pinoAberto ? (
            <Cartao
              key={pinoAberto.chave}
              pino={pinoAberto}
              marcacao={pinoAberto.placeId ? marcacoes.get(pinoAberto.placeId) || null : null}
              contato={pinoAberto.placeId ? contatos.get(pinoAberto.placeId) || null : null}
              buscandoContato={buscando === `contato:${pinoAberto.placeId}`}
              contatosRestantes={contatosRestantes}
              onVerContato={() => pinoAberto.placeId && verContato(pinoAberto.placeId)}
              onSalvar={(st, nota) => pinoAberto.placeId && salvarMarcacao(pinoAberto.placeId, st, nota)}
              onFechar={() => setSelecionado(null)}
            />
          ) : (
            <>
              {cidade && resumo && resumo.estado !== "nova" && (
                <div className={s.extras}>
                  <span>Buscar também (pega o que o Google cadastrou fora da comida):</span>
                  <div>
                    {TERMOS_EXTRAS.map((t) => (
                      <button key={t} type="button" disabled={!!buscando || varrendo || termosFeitos.has(t)} onClick={() => buscarExtra(t)}
                        className={termosFeitos.has(t) ? s.extraFeito : ""}>
                        {buscando === t ? "…" : termosFeitos.has(t) ? `✓ ${t}` : t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <input className={s.procura} value={procura} onChange={(e) => setProcura(e.target.value)} placeholder="Procurar na lista por nome ou rua" />
              <ul className={s.lista}>
                {!cidade && <li className={s.dica}>Digite a cidade e toque em <b>Abrir cidade</b>.</li>}
                {cidade && !visiveis.length && !buscando && !varrendo && (
                  <li className={s.dica}>{resumo?.estado === "nova" ? "A cidade ainda não foi varrida: toque em Varrer a cidade inteira, lá em cima." : "Nada aqui com esse filtro."}</li>
                )}
                {visiveis.slice(0, ITENS_NA_LISTA).map((p) => {
                  const m = p.placeId ? marcacoes.get(p.placeId) : null;
                  return (
                    <li key={p.chave}>
                      <button type="button" onClick={() => focar(p)} className={s.item}>
                        <i className={`${s.bolinha} ${s[`cor_${p.status}`]} ${p.lugar?.origem === "osm" ? s.bolinhaOsm : ""}`} />
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
                {visiveis.length > ITENS_NA_LISTA && (
                  <li className={s.dica}>Mostrando {ITENS_NA_LISTA} de {numero(visiveis.length)}. Use a procura ou o filtro para achar os outros.</li>
                )}
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
  el.className = `${s.pino} ${s[`cor_${p.status}`]} ${aberto ? s.pinoAberto : ""} ${p.lugar?.origem === "osm" ? s.pinoOsm : ""}`;
  el.addEventListener("click", (e) => { e.stopPropagation(); onClicar(); });
  el.innerHTML = `<span class="${s.pinoLetra}">${p.status === "cliente" ? "F" : ""}</span>`;
  const balao = document.createElement("div");
  balao.className = s.balao;
  const nome = document.createElement("strong");
  nome.textContent = p.nome;
  const end = document.createElement("span");
  end.textContent = p.endereco;
  const st = document.createElement("em");
  st.textContent = ROTULO[p.status] + (p.loja?.semCardapio ? " · sem cardápio" : "") + (p.lugar?.origem === "osm" ? " · só no OpenStreetMap" : "");
  balao.append(nome, end, st);
  el.appendChild(balao);
  return el;
}

/** "N lugares encontrados · varrida em DD/MM", o selo da cobertura e os botões da varredura. */
function PainelDaCobertura({ resumo, totalNaTela, souAdmin, varrendo, celulasFeitas, precisaAutorizar, mostrarGrade, temGrade, onVarrer, onPausar, onGrade, onRecarregar }: {
  resumo: ResumoDaVarredura;
  totalNaTela: number;
  souAdmin: boolean;
  varrendo: boolean;
  celulasFeitas: number;
  precisaAutorizar: boolean;
  mostrarGrade: boolean;
  temGrade: boolean;
  onVarrer: (o: { continuar?: boolean; autorizar?: boolean; refazer?: boolean }) => void;
  onPausar: () => void;
  onGrade: () => void;
  onRecarregar: () => void;
}) {
  const selo = seloDaCobertura(varrendo ? { ...resumo, estado: "varrendo" } : resumo);
  const vaiEstourar = resumo.custoDoQueFalta > 0 && !resumo.liberadoPago;
  const custo = dinheiro(resumo.custoDoQueFalta);
  // As mesmas regras do servidor (passoDaVarredura): cidade nova só começa se a estimativa
  // cabe no grátis; pausada continua enquanto sobra grátis (e pausa de novo no fim dele).
  const pode = resumo.liberadoPago || (resumo.estado === "nova"
    ? (resumo.estimativa ?? 0) <= resumo.restanteGratis
    : resumo.restanteGratis > 0);

  let principal: string;
  if (resumo.estado === "nova") principal = "Esta cidade ainda não foi varrida";
  else if (resumo.varridaEm) principal = `${numero(totalNaTela)} lugares encontrados · varrida em ${diaEMes(resumo.varridaEm)}`;
  else principal = `${numero(totalNaTela)} lugares encontrados até agora`;

  const botoes: React.ReactNode[] = [];
  if (varrendo) {
    botoes.push(<button key="p" type="button" className={s.botaoClaro} onClick={onPausar}>Pausar</button>);
  } else if (resumo.ocupadaPorOutro) {
    botoes.push(<button key="r" type="button" className={s.botaoClaro} onClick={onRecarregar}>Ver o que já veio</button>);
  } else if (resumo.estado === "nova" || resumo.estado === "pausada") {
    const rotulo = resumo.estado === "nova" ? "Varrer a cidade inteira" : "Continuar a varredura";
    if (pode && !precisaAutorizar) botoes.push(<button key="v" type="button" className={s.botaoVarrer} onClick={() => onVarrer({ continuar: true })}>{rotulo}</button>);
    if (vaiEstourar && souAdmin) botoes.push(<button key="a" type="button" className={s.botaoPagar} onClick={() => onVarrer({ continuar: true, autorizar: true })}>Autorizar e {resumo.estado === "nova" ? "varrer" : "continuar"} (~{custo})</button>);
  } else if (resumo.estado === "completa" && souAdmin) {
    botoes.push(<button key="u" type="button" className={s.botaoClaro} onClick={() => {
      const previsto = resumo.estimativa ?? 0;
      const aviso = previsto > resumo.restanteGratis
        ? `Atualizar gasta ~${previsto} buscas e passa do grátis do mês (~${dinheiro((previsto - resumo.restanteGratis) * SKUS.nearby.dolarPorMil / 1000)}). Continuar?`
        : `Atualizar gasta ~${previsto} buscas do grátis do mês (restam ${numero(resumo.restanteGratis)}). Continuar?`;
      if (window.confirm(aviso)) onVarrer({ refazer: true, autorizar: previsto > resumo.restanteGratis });
    }}>Atualizar a cidade</button>);
  }
  if (temGrade) botoes.push(<button key="g" type="button" className={s.botaoClaro} onClick={onGrade}>{mostrarGrade ? "Esconder a grade" : "Mostrar a grade"}</button>);

  return (
    <div className={s.cobertura}>
      <div className={s.coberturaTexto}>
        <strong>{principal}</strong>
        <span className={`${s.selo} ${s[`selo_${selo.tipo}`]}`}>{selo.texto}</span>
        {resumo.estado === "nova" && (
          <small>
            {resumo.estimativa != null
              ? <>Estimativa: ~{numero(resumo.estimativa)} buscas no Google (restam {numero(resumo.restanteGratis)} grátis neste mês){resumo.populacao ? ` — ${numero(resumo.populacao)} habitantes` : ""}. Feita uma vez, vale 30 dias para a equipe toda.</>
              : <>Sem base para estimar (o mapa não trouxe a população). A varredura para sozinha no fim do grátis do mês.</>}
          </small>
        )}
        {varrendo && <small>{numero(celulasFeitas)} pedaços da cidade buscados nesta tela. A grade azul é o que já foi visto; vermelha, onde tinha mais de 20 e foi dividida.</small>}
        {!varrendo && vaiEstourar && (resumo.estado === "nova" || resumo.estado === "pausada") && !resumo.ocupadaPorOutro && (
          <small className={s.alertaCusto}>
            {`A cidade ${resumo.estado === "nova" ? "deve gastar" : "ainda precisa de"} ~${numero(resumo.faltamEstimadas)} buscas e restam ${numero(resumo.restanteGratis)} grátis neste mês`}
            {` — o que passar custaria ~${custo} (US$ ${SKUS.nearby.dolarPorMil} por mil). `}
            {pode ? "Sem autorização, a varredura para no fim do grátis. " : ""}
            {souAdmin ? "Você decide se paga." : "Passar do grátis, só o administrador autoriza."}
          </small>
        )}
        {resumo.estado === "completa" && souAdmin && resumo.populacao && resumo.lugares > 0 && (
          <small>Calibragem: 1 lugar do Google para cada {numero(Math.round(resumo.populacao / resumo.lugares))} habitantes (a estimativa usa 1 para {HABITANTES_POR_LUGAR}); gastou {numero(resumo.chamadas)} buscas; o OpenStreetMap tinha {numero(resumo.osm)}.</small>
        )}
      </div>
      {botoes.length > 0 && <div className={s.coberturaBotoes}>{botoes}</div>}
    </div>
  );
}

/** Só o admin: "X de N grátis neste mês" por SKU do Google. */
function ConsumoDoMes({ uso }: { uso: UsoDoMes }) {
  const [ano, mes] = uso.mes.split("-");
  return (
    <details className={s.consumo}>
      <summary>Consumo do Google em {mes}/{ano} (grátis do mês, por SKU) — Nearby {numero(uso.nearby)} de {numero(SKUS.nearby.gratis)}</summary>
      <div className={s.consumoGrade}>
        {(Object.keys(SKUS) as Sku[]).map((sku) => (
          <Medidor key={sku} rotulo={`${SKUS[sku].nome} — ${SKUS[sku].uso}`} usado={uso[sku]} limite={SKUS[sku].gratis}
            extra={`depois: US$ ${SKUS[sku].dolarPorMil} por mil`} />
        ))}
      </div>
      <small>Paramos 2% antes do grátis. As travas por dia do Google Cloud (SearchNearby 160/dia, contato 32/dia) continuam valendo: quando o Google para por elas, a varredura pausa e continua no dia seguinte.</small>
    </details>
  );
}

function Medidor({ rotulo, usado, limite, extra }: { rotulo: string; usado: number; limite: number; extra?: string }) {
  const pct = Math.min(100, Math.round((usado / limite) * 100));
  return (
    <div className={s.medidor}>
      <span>{rotulo}</span>
      <b>{numero(usado)} de {numero(limite)} grátis</b>
      <i><u style={{ width: `${pct}%`, background: pct >= 90 ? "#DC2626" : pct >= 70 ? "#D97706" : "#16A34A" }} /></i>
      {extra && <small>{extra}</small>}
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
  const doOsm = pino.lugar?.origem === "osm";
  const telefoneDoOsm = doOsm ? pino.lugar?.telefone || null : null;
  const whatsapp = linkDoWhatsapp(contato?.telefone || telefoneDoOsm);
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
      <p className={s.origem}>Fonte: {origemDoPino(pino.lugar)}</p>

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
        <a className={s.botaoPrincipal} href={linkComoChegar({ nome: pino.nome, lat: pino.lat, lng: pino.lng, placeId: doOsm ? null : pino.placeId })} target="_blank" rel="noreferrer">
          Como chegar
        </a>
        {pino.lugar?.mapsUrl && <a className={s.botaoClaro} href={pino.lugar.mapsUrl} target="_blank" rel="noreferrer">Abrir no Google Maps</a>}
      </div>

      {doOsm && (
        <div className={s.contato}>
          <h4>Telefone</h4>
          <dl>
            <dt>Telefone</dt>
            <dd>{telefoneDoOsm ? <><a href={`tel:${telefoneDoOsm}`}>{telefoneDoOsm}</a>{whatsapp && <> · <a href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a></>}</> : "O OpenStreetMap não tem"}</dd>
          </dl>
          <small>Lugar que só o OpenStreetMap tem (o Google não trouxe): sem telefone do Google.</small>
        </div>
      )}

      {pino.placeId && !doOsm && (
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
                  ? "Os contatos grátis deste mês acabaram para a equipe."
                  : `Usa 1 dos ${contatosRestantes ?? tetoDoMes("contato")} contatos grátis que ainda restam neste mês (a equipe toda).`}
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
