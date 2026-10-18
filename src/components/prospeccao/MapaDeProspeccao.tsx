"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import s from "./MapaDeProspeccao.module.css";
import {
  CAMPOS_DA_BUSCA, CAMPOS_DO_CONTATO, TERMOS_EXTRAS,
  linkComoChegar, linkDoWhatsapp, lojaDoLugar, metrosEntre, nomeDaCidade,
  type CaixaDaCidade, type LojaDoMapa, type StatusDaMarcacao, type StatusDoPino,
} from "@/lib/prospeccao/regras";
import {
  HABITANTES_POR_LUGAR, SKUS, TIPOS_DE_COMIDA, TRAVAS_DO_CLOUD, VARREDURA_POR_DIA,
  diasDaVarredura, juntarLugares, limiteDoDia, lugarDoGoogle, paraGuardar, planoDeNomes, seloDaCobertura, tetoDoMes, vagas,
  type CotaDoCloud, type LugarDoMapa, type ResumoDaVarredura, type Sku, type UsoDoGoogle,
} from "@/lib/prospeccao/varredura";
import type { CelulaParaBuscar, Marcacao, PedidoDaVarredura, RespostaDaVarredura } from "@/lib/prospeccao/dados";

/**
 * Mapa de prospecção do vendedor: a cidade no filtro, TODOS os lugares de
 * comida dela no mapa, pintados por status (cliente do FireHub / em
 * negociação / não quis / oportunidade), o cartão com contato e "Como
 * chegar", e a anotação do vendedor, que fica para a equipe toda.
 *
 * Os lugares vêm da VARREDURA da cidade (lib/prospeccao/varredura.ts): feita
 * uma vez, guardada 30 dias no servidor e usada por todos. Este navegador
 * chama o Google lote a lote e devolve ao servidor, que divide as células
 * cheias. CUSTO ZERO: sem vaga no dia ou no mês, a varredura pausa e continua
 * sozinha quando alguém abrir a cidade de novo.
 *
 * Termos do Google à risca: do Google o servidor só tem o place_id e o ponto.
 * O NOME do pino é buscado aqui, na hora, só para o que o vendedor está vendo
 * (ao tocar no pino ou "mostrar os nomes" da página da lista), e fica só na
 * memória desta tela.
 *
 * `api` existe para a prévia rodar sem banco; no portal, fica o padrão.
 */

export type CargaDoMapa = {
  chave: string | null;
  cidades: { nome: string; lojas: number }[];
  uso: UsoDoGoogle;
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
  reservar: (sku: Sku, qtd: number) => Promise<{ ok: boolean; trava?: "dia" | "mes"; uso: UsoDoGoogle }>;
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
/** A lista do lado anda de página em página (os mais perto do centro do mapa primeiro). */
const POR_PAGINA = 20;
/** "Mostrar os nomes desta página" gasta no máximo isto de Nearby. */
const BUSCAS_POR_PAGINA = 4;
/** O nome que a busca por perto não trouxe vem pelo Place Details (Pro) — só os campos de nome e endereço. */
const CAMPOS_DO_NOME = ["displayName", "formattedAddress", "googleMapsURI", "primaryType"] as const;

// ── Os dados da tela ────────────────────────────────────────────────────────

type Contato = {
  telefone: string | null;
  telefoneInternacional: string | null;
  site: string | null;
  nota: number | null;
  avaliacoes: number | null;
  horario: string[];
};

/** O que o Google disse do lugar — só na memória desta tela, nunca no banco. */
type NomeDoGoogle = { nome: string; endereco: string; tipo: string | null; mapsUrl: string | null };

/** O que vira pino: um lugar (Google ou OpenStreetMap) ou uma loja nossa que nenhum dos dois trouxe. */
type Pino = {
  chave: string;
  placeId: string | null;
  /** "" = nome do Google ainda não carregado. */
  nome: string;
  endereco: string;
  lat: number;
  lng: number;
  status: StatusDoPino;
  loja: LojaDoMapa | null;
  lugar: LugarDoMapa | null;
  /** De onde veio o nome mostrado. */
  fonteDoNome: "google" | "osm" | "loja" | null;
  tipo: string | null;
  mapsUrl: string | null;
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
const diaDoGoogle = (aaaaMmDd: string) => `${aaaaMmDd.slice(8, 10)}/${aaaaMmDd.slice(5, 7)}`;
const numero = (n: number) => n.toLocaleString("pt-BR");
const distancia = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);
const avisoDaTrava = (trava: "dia" | "mes" | undefined, oque: string) => trava === "mes"
  ? `O grátis do mês do Google para ${oque} acabou. Volta no dia 1º — sem custo.`
  : `As buscas grátis de hoje para ${oque} acabaram (trava do dia). Amanhã liberam de novo — sem custo.`;

export default function MapaDeProspeccao({ api = apiDoServidor, cidadeInicial = "" }: { api?: ApiDoMapa; cidadeInicial?: string }) {
  const [carga, setCarga] = useState<CargaDoMapa | null>(null);
  const [uso, setUso] = useState<UsoDoGoogle | null>(null);
  const [cidadeDigitada, setCidadeDigitada] = useState(cidadeInicial);
  const [sugerindo, setSugerindo] = useState(false);
  const campoCidade = useRef<HTMLInputElement>(null);
  const [cidade, setCidade] = useState<string>("");
  const [resumo, setResumo] = useState<ResumoDaVarredura | null>(null);
  const [lugares, setLugares] = useState<Map<string, LugarDoMapa>>(new Map());
  /** Os nomes do Google desta sessão (memória só desta tela). */
  const [nomes, setNomes] = useState<Map<string, NomeDoGoogle>>(new Map());
  const [termosFeitos, setTermosFeitos] = useState<Set<string>>(new Set());
  const [marcacoes, setMarcacoes] = useState<Map<string, Marcacao>>(new Map());
  const [contatos, setContatos] = useState<Map<string, Contato>>(new Map());
  const [selecionado, setSelecionado] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<StatusDoPino | "todos">("todos");
  const [procura, setProcura] = useState("");
  const [pagina, setPagina] = useState(0);
  const [buscando, setBuscando] = useState<string | null>(null);
  const [varrendo, setVarrendo] = useState(false);
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
  const nomesAgora = useRef(nomes);
  nomesAgora.current = nomes;

  const souAdmin = !!carga?.souAdmin;

  // ── Primeira carga: a chave, as cidades e o uso ──
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
    // Cada abertura do mapa é 1 "Dynamic Maps": sem vaga no dia ou no mês, o mapa não abre (custo zero).
    api.reservar("mapa", 1).then(async (r) => {
      setUso(r.uso);
      if (!r.ok) { setErroDoMapa(avisoDaTrava(r.trava, "abrir o mapa")); return; }
      const g = await carregarGoogle(carga.chave!);
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
      setPronto((n) => n + 1);
    }).catch((e) => setErroDoMapa(e.message));
  }, [carga?.chave, api]);

  // ── Os pinos ──
  const pinos = useMemo<Pino[]>(() => {
    const lojas = carga?.lojas || [];
    const porId = new Map(lojas.map((l) => [l.id, l]));
    const lojasCasadas = new Set<string>();
    const saida: Pino[] = [];
    // Google antes do OpenStreetMap: a loja que já casou com um lugar do Google não casa de novo com o do OSM.
    const ordem = [...lugares.values()].sort((a, b) => (a.origem === b.origem ? 0 : a.origem === "google" ? -1 : 1));
    for (const l of ordem) {
      const doGoogle = l.origem === "google" ? nomes.get(l.id) : undefined;
      const nome = l.origem === "osm" ? l.nome : doGoogle?.nome || l.nomeOsm || "";
      // A loja: a que o servidor casou na varredura; senão, pelo nome que já temos aqui.
      let loja = l.lojaId ? porId.get(l.lojaId) || null : null;
      if (!loja && nome) loja = lojaDoLugar({ nome, lat: l.lat, lng: l.lng }, l.origem === "osm" ? lojas.filter((x) => !lojasCasadas.has(x.id)) : lojas);
      if (loja) lojasCasadas.add(loja.id);
      const m = marcacoes.get(l.id);
      saida.push({
        chave: l.id, placeId: l.id, nome: nome || (loja ? loja.nome : ""), endereco: l.origem === "osm" ? l.endereco : doGoogle?.endereco || "",
        lat: l.lat, lng: l.lng, status: loja ? "cliente" : m?.status || "oportunidade", loja, lugar: l,
        fonteDoNome: l.origem === "osm" ? "osm" : doGoogle?.nome ? "google" : l.nomeOsm ? "osm" : loja ? "loja" : null,
        tipo: l.origem === "osm" ? l.tipo : doGoogle?.tipo || null,
        mapsUrl: doGoogle?.mapsUrl || null,
      });
    }
    for (const loja of lojas) {
      if (lojasCasadas.has(loja.id) || loja.lat == null || loja.lng == null) continue;
      saida.push({
        chave: `loja:${loja.id}`, placeId: null, nome: loja.nome, endereco: loja.endereco || "",
        lat: loja.lat, lng: loja.lng, status: "cliente", loja, lugar: null, fonteDoNome: "loja", tipo: null, mapsUrl: null,
      });
    }
    return saida;
  }, [lugares, nomes, marcacoes, carga?.lojas]);

  const contagem = useMemo(() => {
    const c: Record<StatusDoPino, number> = { cliente: 0, negociacao: 0, sem_interesse: 0, oportunidade: 0 };
    for (const p of pinos) c[p.status]++;
    return c;
  }, [pinos]);
  const soNoOsm = useMemo(() => pinos.filter((p) => p.lugar?.origem === "osm").length, [pinos]);
  const comNome = useMemo(() => pinos.filter((p) => p.nome).length, [pinos]);

  const centroDaTela = limitesDaTela
    ? { lat: (limitesDaTela.sul + limitesDaTela.norte) / 2, lng: (limitesDaTela.oeste + limitesDaTela.leste) / 2 }
    : null;

  /** Filtro e procura. A procura por nome só alcança os nomes já carregados (e os do OpenStreetMap). */
  const visiveis = useMemo(() => {
    const q = nomeDaCidade(procura);
    return pinos
      .filter((p) => filtro === "todos" || p.status === filtro)
      .filter((p) => !q || nomeDaCidade(`${p.nome} ${p.endereco}`).includes(q));
  }, [pinos, filtro, procura]);

  /** A lista: os mais perto do centro do mapa primeiro (é por onde o vendedor anda). */
  const listaOrdenada = useMemo(() => {
    if (!centroDaTela) return [...visiveis].sort((a, b) => ORDEM.indexOf(a.status) - ORDEM.indexOf(b.status) || a.nome.localeCompare(b.nome));
    return visiveis.map((p) => ({ p, m: metrosEntre(centroDaTela, p) })).sort((a, b) => a.m - b.m).map((x) => x.p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiveis, limitesDaTela]);
  const paginas = Math.max(1, Math.ceil(listaOrdenada.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, paginas - 1);
  const daPagina = listaOrdenada.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA);
  const semNomeNaPagina = daPagina.filter((p) => !p.nome && p.lugar?.origem === "google");

  useEffect(() => { setPagina(0); }, [filtro, procura, cidade]);

  /** No mapa: todos, ou — cidade grande — só os da parte que está na tela. */
  const noMapa = useMemo(() => {
    if (visiveis.length <= PINOS_DE_UMA_VEZ || !limitesDaTela) return visiveis;
    const t = limitesDaTela;
    return visiveis.filter((p) => (p.lat >= t.sul && p.lat <= t.norte && p.lng >= t.oeste && p.lng <= t.leste) || p.chave === selecionado);
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
      const conteudo = elementoDoPino(p, p.chave === selecionado, () => abrirPino(p));
      const existente = atuais.get(p.chave);
      if (existente) { existente.trocar(conteudo); continue; }
      const m = new PinoNoMapa({ lat: p.lat, lng: p.lng }, conteudo);
      m.setMap(mapa.current);
      atuais.set(p.chave, m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const reservar = useCallback(async (sku: Sku, qtd: number, oque: string) => {
    const r = await api.reservar(sku, qtd);
    setUso(r.uso);
    if (!r.ok) setAviso({ tipo: "erro", texto: avisoDaTrava(r.trava, oque) });
    return r.ok;
  }, [api]);

  const juntar = useCallback((novos: LugarDoMapa[]) => {
    if (novos.length) setLugares((antes) => juntarLugares(antes.values(), novos.map((l) => ({ ...(antes.get(l.id) || {}), ...paraGuardar(l) }))));
  }, []);
  /** Guarda os nomes do Google na memória desta tela (nunca no banco). */
  const lembrarNomes = useCallback((lista: LugarDoMapa[]) => {
    if (!lista.length) return;
    setNomes((antes) => {
      const novo = new Map(antes);
      for (const l of lista) if (l.nome) novo.set(l.id, { nome: l.nome, endereco: l.endereco, tipo: l.tipo, mapsUrl: l.mapsUrl });
      return novo;
    });
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
   * ao mesmo tempo), devolve, e repete até o servidor não mandar mais (acabou,
   * ou acabou a vaga do dia/mês — aí pausa e continua depois).
   */
  async function varrer(opcoes: { continuar?: boolean; refazer?: boolean }, alvo = cidadeAtual.current) {
    if (!alvo || !google.current || varrendo) return;
    pausar.current = false;
    setVarrendo(true);
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
            lembrarNomes(res.lugares);
            desenharCelula(c, res.cheia);
          } catch (e: any) {
            erro = erro || String(e?.message || e || "erro do Google");
          }
        }));
        // O nome vai junto só para o servidor casar com as lojas e o OpenStreetMap; ele não guarda.
        r = await api.varrer({ cidade: alvo, resultados, erro, pausar: pausar.current || cidadeAtual.current !== alvo });
        receber(r);
        if (erro) {
          setAviso({ tipo: "erro", texto: /quota|RESOURCE_EXHAUSTED|429|OVER_QUERY/i.test(erro)
            ? "O Google parou a varredura pela trava do dia (Google Cloud). O que já veio está salvo; continua amanhã, sem custo."
            : `O Google recusou uma busca: ${erro.slice(0, 140)}. O que já veio está salvo.` });
          break;
        }
      }
      if (cidadeAtual.current === alvo && r.resumo.estado === "completa") {
        enquadrar([...lugaresAgora.current.values()], carga?.cidade?.caixa || null);
        setAviso({ tipo: "ok", texto: `Varredura terminada: ${numero(r.resumo.lugares)} lugares do Google em ${numero(r.resumo.chamadas)} buscas, sem custo.` });
      }
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e?.message || "Não deu para varrer agora." });
    } finally {
      setVarrendo(false);
    }
  }

  /**
   * Os nomes do Google para estes pinos: Nearby por distância em volta deles
   * (1 busca traz os 20 mais perto, com nome). O que não vier e for um pino só
   * (o tocado) vai pelo Place Details Pro. Tudo dentro do teto do dia e do mês.
   */
  async function carregarNomes(alvos: Pino[], maximo: number) {
    const g = google.current;
    const faltam = alvos.filter((p) => p.placeId && p.lugar?.origem === "google" && !nomesAgora.current.has(p.placeId));
    if (!g || !faltam.length) return;
    const { Place } = await g.maps.importLibrary("places");
    const achadosNovos: LugarDoMapa[] = [];
    const vieram = new Set<string>();
    const tentados = new Set<string>();
    const todos = [...lugaresAgora.current.values()].filter((l) => l.origem === "google");
    // Replaneja a cada busca com o que já voltou (a previsão de "quem vem" pode errar um pouco).
    for (let i = 0; i < maximo; i++) {
      const resta = faltam.filter((p) => !vieram.has(p.placeId!) && !tentados.has(p.placeId!)).map((p) => ({ id: p.placeId!, lat: p.lat, lng: p.lng }));
      const passo = planoDeNomes(resta, todos, 1)[0];
      if (!passo) break;
      if (!(await reservar("nearby", 1, "os nomes dos lugares"))) return;
      const { places } = await Place.searchNearby({
        fields: [...CAMPOS_DA_BUSCA],
        locationRestriction: { center: passo.centro, radius: passo.raio },
        includedTypes: [...TIPOS_DE_COMIDA],
        maxResultCount: 20,
        rankPreference: "DISTANCE",
        language: "pt-BR",
        region: "br",
      });
      const lista = ((places || []) as any[]).map(lugarDoGoogle).filter((l): l is LugarDoMapa => !!l);
      lembrarNomes(lista);
      for (const l of lista) if (!lugaresAgora.current.has(l.id)) achadosNovos.push(l);
      for (const l of lista) vieram.add(l.id);
      // O centro não voltou (lotado ou fora dos tipos): não insiste nele.
      tentados.add(resta.find((p) => p.lat === passo.centro.lat && p.lng === passo.centro.lng)?.id || "");
    }
    // Lugar que a varredura não tinha: entra no cache (só id + ponto) para a equipe toda.
    if (achadosNovos.length) {
      juntar(achadosNovos);
      api.guardarLugares(cidadeAtual.current, achadosNovos).catch(() => {});
    }
    const sobrou = faltam.filter((p) => !vieram.has(p.placeId!));
    if (alvos.length === 1 && sobrou.length === 1) {
      if (!(await reservar("detalhes", 1, "os nomes dos lugares"))) return;
      const p = new Place({ id: sobrou[0].placeId! });
      await p.fetchFields({ fields: [...CAMPOS_DO_NOME] });
      lembrarNomes([{ id: p.id, nome: p.displayName || "Sem nome", endereco: p.formattedAddress || "", lat: 0, lng: 0, tipo: p.primaryType || null, mapsUrl: p.googleMapsURI || null, origem: "google" }]);
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
      setLugares(juntarLugares([], c.lugares));
      setTermosFeitos(new Set());
      setContatos(new Map());
      setMarcacoes(new Map(c.marcacoes.map((m) => [m.placeId, m])));
      limparGrade();
      // Pausada pela trava (ou pela tela fechada) e com vaga de novo: continua sozinha.
      const v = c.cidade?.varredura;
      if (v && v.estado === "pausada" && v.vagasAgora > 0 && !v.ocupadaPorOutro && v.motivo !== "teto_da_cidade") {
        for (let i = 0; i < 50 && !google.current; i++) await new Promise((r) => setTimeout(r, 200));
        setBuscando(null);
        varrer({ continuar: true }, alvo);
      }
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
      if (!(await reservar("texto", 1, "as buscas por termo"))) return;
      const { Place } = await g.maps.importLibrary("places");
      const caixa = carga?.cidade?.caixa;
      const pedido: any = { textQuery: `${termo} em ${cidade}`, fields: [...CAMPOS_DA_BUSCA], maxResultCount: 20, language: "pt-BR", region: "br" };
      if (caixa) pedido.locationRestriction = { south: caixa.sul, west: caixa.oeste, north: caixa.norte, east: caixa.leste };
      const { places } = await Place.searchByText(pedido);
      const achados = ((places || []) as any[]).map(lugarDoGoogle).filter((l): l is LugarDoMapa => !!l);
      const novos = achados.filter((l) => !lugares.has(l.id)).length;
      juntar(achados);
      lembrarNomes(achados);
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
      if (!(await reservar("contato", 1, "telefone e site"))) return;
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

  /** Tocar no pino: abre o cartão e, se o nome do Google não está aqui, busca (1 busca, dentro do grátis). */
  async function abrirPino(p: Pino) {
    setSelecionado(p.chave);
    if (p.lugar?.origem !== "google" || !p.placeId || nomesAgora.current.has(p.placeId)) return;
    setBuscando(`nome:${p.placeId}`);
    try { await carregarNomes([p], 1); }
    catch (e: any) { setAviso({ tipo: "erro", texto: e?.message || "Não deu para buscar o nome agora." }); }
    finally { setBuscando(null); }
  }

  async function nomesDaPagina() {
    setBuscando("nomes");
    try { await carregarNomes(semNomeNaPagina, BUSCAS_POR_PAGINA); }
    catch (e: any) { setAviso({ tipo: "erro", texto: e?.message || "Não deu para buscar os nomes agora." }); }
    finally { setBuscando(null); }
  }

  function focar(p: Pino) {
    abrirPino(p);
    if (mapa.current) {
      mapa.current.panTo({ lat: p.lat, lng: p.lng });
      if ((mapa.current.getZoom() || 0) < 15) mapa.current.setZoom(16);
    }
  }

  const pinoAberto = pinos.find((p) => p.chave === selecionado) || null;
  const semChave = carga && !carga.chave;
  const contatosRestantes = uso ? vagas(uso, "contato").qtd : null;
  const nomesHoje = uso ? vagas(uso, "nearby").qtd : null;
  const digitada = nomeDaCidade(cidadeDigitada);
  const sugestoes = digitada
    ? (carga?.cidades || []).filter((c) => { const n = nomeDaCidade(c.nome); return n.includes(digitada) && n !== digitada; }).slice(0, 5)
    : [];

  return (
    <section className={s.mapa}>
      <header className={s.topo}>
        <div className={s.titulo}>
          <h2>Mapa de prospecção</h2>
          <p>Escolha a cidade: aparecem todos os lugares de comida dela, pintados por quem já é cliente e por quem a equipe já procurou.</p>
        </div>
        <form className={s.filtro} onSubmit={(e) => { e.preventDefault(); abrirCidade(cidadeDigitada); }}>
          <label htmlFor="mp-cidade">Cidade</label>
          {/* Lista própria em vez de <datalist>: no iPad a sugestão do Safari travava o apagar (Victor, 18/10). */}
          <div className={s.campoCidade}>
            <input id="mp-cidade" ref={campoCidade} value={cidadeDigitada} onChange={(e) => { setCidadeDigitada(e.target.value); setSugerindo(true); }}
              onFocus={() => setSugerindo(true)} onBlur={() => setTimeout(() => setSugerindo(false), 150)}
              placeholder="Ex.: Rio das Ostras - RJ" autoComplete="off" />
            {cidadeDigitada && (
              <button type="button" className={s.limparCidade} aria-label="Apagar a cidade"
                onClick={() => { setCidadeDigitada(""); campoCidade.current?.focus(); }}>×</button>
            )}
            {sugerindo && sugestoes.length > 0 && (
              <ul className={s.sugestoes}>
                {sugestoes.map((c) => (
                  <li key={c.nome}>
                    <button type="button" onClick={() => { setCidadeDigitada(c.nome); setSugerindo(false); abrirCidade(c.nome); }}>
                      {c.nome} <small>{c.lojas} {c.lojas === 1 ? "loja" : "lojas"} do FireHub</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="submit" disabled={!!buscando || varrendo || !cidadeDigitada.trim() || !!semChave}>
            {buscando === "cidade" ? "Abrindo…" : "Abrir cidade"}
          </button>
        </form>
      </header>

      {cidade && resumo && (
        <PainelDaCobertura
          resumo={resumo} totalNaTela={lugares.size} souAdmin={souAdmin} varrendo={varrendo} celulasFeitas={celulasFeitas}
          mostrarGrade={mostrarGrade} temGrade={celulasFeitas > 0}
          onVarrer={(o) => varrer(o)} onPausar={() => { pausar.current = true; }}
          onGrade={() => setMostrarGrade((v) => !v)} onRecarregar={() => abrirCidade(cidade)}
        />
      )}

      {souAdmin && uso && <ConsumoDoGoogle uso={uso} />}

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
          {soNoOsm > 0 && <small className={s.creditoOsm}>Dados extras © colaboradores do OpenStreetMap (ODbL)</small>}
        </div>

        <aside className={s.lado}>
          {pinoAberto ? (
            <Cartao
              key={pinoAberto.chave}
              pino={pinoAberto}
              marcacao={pinoAberto.placeId ? marcacoes.get(pinoAberto.placeId) || null : null}
              contato={pinoAberto.placeId ? contatos.get(pinoAberto.placeId) || null : null}
              buscandoContato={buscando === `contato:${pinoAberto.placeId}`}
              buscandoNome={buscando === `nome:${pinoAberto.placeId}`}
              contatosRestantes={contatosRestantes}
              onVerContato={() => pinoAberto.placeId && verContato(pinoAberto.placeId)}
              onVerNome={() => abrirPino(pinoAberto)}
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
              <input className={s.procura} value={procura} onChange={(e) => setProcura(e.target.value)} placeholder="Procurar por nome ou rua (nos nomes já carregados)" />
              {cidade && pinos.length > 0 && comNome < pinos.length && (
                <p className={s.dicaDosNomes}>
                  O nome do Google não fica guardado (regra do Google): ele é buscado na hora. {numero(comNome)} de {numero(pinos.length)} com nome nesta tela;
                  a procura alcança esses e os do OpenStreetMap. Toque num pino para ver o nome dele.
                </p>
              )}
              {semNomeNaPagina.length > 0 && (
                <button type="button" className={s.botaoNomes} disabled={!!buscando || varrendo || nomesHoje === 0} onClick={nomesDaPagina}>
                  {buscando === "nomes" ? "Buscando os nomes…" : `Mostrar os nomes desta página (até ${BUSCAS_POR_PAGINA} buscas grátis)`}
                </button>
              )}
              <ul className={s.lista}>
                {!cidade && <li className={s.dica}>Digite a cidade e toque em <b>Abrir cidade</b>.</li>}
                {cidade && !visiveis.length && !buscando && !varrendo && (
                  <li className={s.dica}>{resumo?.estado === "nova" ? "A cidade ainda não foi varrida: toque em Varrer a cidade inteira, lá em cima." : "Nada aqui com esse filtro."}</li>
                )}
                {daPagina.map((p) => {
                  const m = p.placeId ? marcacoes.get(p.placeId) : null;
                  const longe = centroDaTela ? metrosEntre(centroDaTela, p) : null;
                  return (
                    <li key={p.chave}>
                      <button type="button" onClick={() => focar(p)} className={s.item}>
                        <i className={`${s.bolinha} ${s[`cor_${p.status}`]} ${p.lugar?.origem === "osm" ? s.bolinhaOsm : ""}`} />
                        <span className={s.itemTexto}>
                          <strong className={p.nome ? "" : s.semNome}>{p.nome || "Lugar do Google — toque para ver o nome"}</strong>
                          <small>{p.endereco || (longe != null ? `a ${distancia(longe)} do centro do mapa` : "Sem endereço")}</small>
                          {p.loja?.semCardapio && <em className={s.semCardapio}>Loja sem cardápio</em>}
                          {m?.nota && <small className={s.notaCurta}>“{m.nota.slice(0, 90)}{m.nota.length > 90 ? "…" : ""}” — {m.vendedor || "equipe"}</small>}
                        </span>
                        <span className={`${s.etiqueta} ${s[`et_${p.status}`]}`}>{ROTULO[p.status]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {paginas > 1 && (
                <div className={s.paginacao}>
                  <button type="button" className={s.botaoClaro} disabled={paginaAtual === 0} onClick={() => setPagina(paginaAtual - 1)}>← Mais perto</button>
                  <span>{paginaAtual + 1} de {numero(paginas)}</span>
                  <button type="button" className={s.botaoClaro} disabled={paginaAtual >= paginas - 1} onClick={() => setPagina(paginaAtual + 1)}>Mais longe →</button>
                </div>
              )}
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
  nome.textContent = p.nome || "Toque para ver o nome";
  const end = document.createElement("span");
  end.textContent = p.endereco;
  const st = document.createElement("em");
  st.textContent = ROTULO[p.status] + (p.loja?.semCardapio ? " · sem cardápio" : "") + (p.lugar?.origem === "osm" ? " · só no OpenStreetMap" : "");
  balao.append(nome, end, st);
  el.appendChild(balao);
  return el;
}

/** "N lugares encontrados · varrida em DD/MM", o selo da cobertura e os botões da varredura. */
function PainelDaCobertura({ resumo, totalNaTela, souAdmin, varrendo, celulasFeitas, mostrarGrade, temGrade, onVarrer, onPausar, onGrade, onRecarregar }: {
  resumo: ResumoDaVarredura;
  totalNaTela: number;
  souAdmin: boolean;
  varrendo: boolean;
  celulasFeitas: number;
  mostrarGrade: boolean;
  temGrade: boolean;
  onVarrer: (o: { continuar?: boolean; refazer?: boolean }) => void;
  onPausar: () => void;
  onGrade: () => void;
  onRecarregar: () => void;
}) {
  const selo = seloDaCobertura(varrendo ? { ...resumo, estado: "varrendo" } : resumo);

  let principal: string;
  if (resumo.estado === "nova") principal = "Esta cidade ainda não foi varrida";
  else if (resumo.varridaEm) principal = `${numero(totalNaTela)} lugares encontrados · varrida em ${diaEMes(resumo.varridaEm)}`;
  else principal = `${numero(totalNaTela)} lugares encontrados até agora · varrida ${resumo.percentual}%`;

  const botoes: React.ReactNode[] = [];
  if (varrendo) {
    botoes.push(<button key="p" type="button" className={s.botaoClaro} onClick={onPausar}>Pausar</button>);
  } else if (resumo.ocupadaPorOutro) {
    botoes.push(<button key="r" type="button" className={s.botaoClaro} onClick={onRecarregar}>Ver o que já veio</button>);
  } else if ((resumo.estado === "nova" || resumo.estado === "pausada") && resumo.vagasAgora > 0 && resumo.motivo !== "teto_da_cidade") {
    botoes.push(<button key="v" type="button" className={s.botaoVarrer} onClick={() => onVarrer({ continuar: true })}>
      {resumo.estado === "nova" ? "Varrer a cidade inteira" : "Continuar a varredura"}
    </button>);
  } else if (resumo.estado === "nova" && resumo.continuaEm) {
    // A busca grátis de hoje acabou: entra na fila e começa sozinha no dia que volta.
    botoes.push(<button key="f" type="button" className={s.botaoVarrer} onClick={() => onVarrer({ continuar: true })}>
      Varrer a partir de {diaDoGoogle(resumo.continuaEm)}
    </button>);
  } else if (resumo.estado === "completa" && souAdmin) {
    botoes.push(<button key="u" type="button" className={s.botaoClaro} onClick={() => {
      const previsto = resumo.estimativa ?? 0;
      if (window.confirm(`Atualizar gasta ~${numero(previsto)} buscas grátis (até ${VARREDURA_POR_DIA} por dia, ~${diasDaVarredura(previsto)} ${diasDaVarredura(previsto) === 1 ? "dia" : "dias"}). Nunca passa do grátis. Continuar?`)) onVarrer({ refazer: true });
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
              ? <>Estimativa: ~{numero(resumo.estimativa)} buscas no Google — cerca de {diasDaVarredura(resumo.estimativa)} {diasDaVarredura(resumo.estimativa) === 1 ? "dia" : "dias"} (até {VARREDURA_POR_DIA} por dia){resumo.populacao ? `; ${numero(resumo.populacao)} habitantes` : ""}. Sempre dentro do grátis: sem custo. Feita uma vez, vale 30 dias para a equipe toda.</>
              : <>Sem base para estimar (o mapa não trouxe a população). Vai até {VARREDURA_POR_DIA} buscas por dia, sempre dentro do grátis.</>}
          </small>
        )}
        {resumo.estado === "nova" && resumo.continuaEm && (
          <small>A busca grátis do Google já foi usada por agora (em outras cidades). Toque em <b>Varrer a partir de {diaDoGoogle(resumo.continuaEm)}</b>: a cidade entra na fila e a varredura começa sozinha nesse dia, quando alguém da equipe abrir a cidade.</small>
        )}
        {resumo.estado !== "completa" && resumo.estado !== "nova" && !varrendo && resumo.continuaEm && (
          <small>Volta sozinha a partir de {diaDoGoogle(resumo.continuaEm)}, quando alguém da equipe abrir esta cidade. Os lugares já achados estão no mapa.</small>
        )}
        {varrendo && <small>{numero(celulasFeitas)} pedaços da cidade buscados nesta tela. A grade azul é o que já foi visto; vermelha, onde tinha mais de 20 e foi dividida.</small>}
        {resumo.estado === "completa" && souAdmin && resumo.populacao && resumo.lugares > 0 && (
          <small>Calibragem: 1 lugar do Google para cada {numero(Math.round(resumo.populacao / resumo.lugares))} habitantes (a estimativa usa 1 para {HABITANTES_POR_LUGAR}); gastou {numero(resumo.chamadas)} buscas; o OpenStreetMap tinha {numero(resumo.osm)}.</small>
        )}
      </div>
      {botoes.length > 0 && <div className={s.coberturaBotoes}>{botoes}</div>}
    </div>
  );
}

/** Só o admin: o uso do Google hoje (contra a trava do Cloud) e no mês (contra o grátis), por SKU. */
function ConsumoDoGoogle({ uso }: { uso: UsoDoGoogle }) {
  const [ano, mes] = uso.mes.split("-");
  return (
    <details className={s.consumo}>
      <summary>Uso do Google em {mes}/{ano} — sem custo: nada passa do grátis · Nearby {numero(uso.noMes.nearby)} de {numero(SKUS.nearby.gratis)}</summary>
      <div className={s.consumoGrade}>
        {(Object.keys(SKUS) as Sku[]).map((sku) => {
          const cota = SKUS[sku].cota as CotaDoCloud;
          const junto = (TRAVAS_DO_CLOUD[cota].skus as readonly Sku[]).length > 1;
          return (
            <Medidor key={sku} rotulo={`${SKUS[sku].nome} — ${SKUS[sku].uso}`} usado={uso.noMes[sku]} limite={SKUS[sku].gratis}
              extra={`hoje ${numero(uso.hoje[sku])} · para em ${numero(limiteDoDia(cota))}/dia${junto ? ` (${cota}, junto com ${(TRAVAS_DO_CLOUD[cota].skus as readonly Sku[]).filter((k) => k !== sku).map((k) => SKUS[k].nome).join(", ")})` : ""} e em ${numero(tetoDoMes(sku))}/mês`} />
          );
        })}
      </div>
      <small>Trava do dia no Google Cloud × 31 abaixo do grátis do mês: mesmo com erro no app, o Google não cobra. A varredura usa até {VARREDURA_POR_DIA} Nearby por dia; o resto do dia fica para os nomes dos pinos.</small>
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

function Cartao({ pino, marcacao, contato, buscandoContato, buscandoNome, contatosRestantes, onVerContato, onVerNome, onSalvar, onFechar }: {
  pino: Pino;
  marcacao: Marcacao | null;
  contato: Contato | null;
  buscandoContato: boolean;
  buscandoNome: boolean;
  contatosRestantes: number | null;
  onVerContato: () => void;
  onVerNome: () => void;
  onSalvar: (status: StatusDaMarcacao, nota: string) => void;
  onFechar: () => void;
}) {
  const [status, setStatus] = useState<StatusDaMarcacao>(marcacao?.status || "oportunidade");
  const [nota, setNota] = useState(marcacao?.nota || "");
  const doOsm = pino.lugar?.origem === "osm";
  const doGoogle = pino.lugar?.origem === "google";
  const telefoneDoOsm = doOsm ? pino.lugar?.telefone || null : null;
  const whatsapp = linkDoWhatsapp(contato?.telefone || telefoneDoOsm);
  const tipo = pino.tipo ? TIPOS_EM_PORTUGUES[pino.tipo] || null : null;
  const mudou = status !== (marcacao?.status || "oportunidade") || nota !== (marcacao?.nota || "");
  const fonte = !pino.lugar ? "Cadastro do FireHub" : doOsm ? "Só no OpenStreetMap"
    : `Google${pino.lugar.tambemNoOsm ? " (também no OpenStreetMap)" : ""}${pino.fonteDoNome === "osm" ? " · nome do OpenStreetMap" : ""}`;

  return (
    <div className={s.cartao}>
      <div className={s.cartaoTopo}>
        <button type="button" className={s.voltar} onClick={onFechar}>← Lista</button>
        <span className={`${s.etiqueta} ${s[`et_${pino.status}`]}`}>{ROTULO[pino.status]}</span>
      </div>
      <h3>{pino.nome || (buscandoNome ? "Buscando o nome…" : "Lugar do Google")}</h3>
      {!pino.nome && doGoogle && !buscandoNome && (
        <button type="button" className={s.botaoClaro} onClick={onVerNome}>Ver o nome (1 busca grátis)</button>
      )}
      {tipo && <p className={s.tipo}>{tipo}</p>}
      {pino.endereco && <p className={s.endereco}>{pino.endereco}</p>}
      <p className={s.origem}>Fonte: {fonte}{doGoogle && pino.fonteDoNome === "google" ? " · nome buscado agora, não fica guardado" : ""}</p>

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
        {pino.mapsUrl && <a className={s.botaoClaro} href={pino.mapsUrl} target="_blank" rel="noreferrer">Abrir no Google Maps</a>}
      </div>

      {doOsm && (
        <div className={s.contato}>
          <h4>Telefone</h4>
          <dl>
            <dt>Telefone</dt>
            <dd>{telefoneDoOsm ? <><a href={`tel:${telefoneDoOsm}`}>{telefoneDoOsm}</a>{whatsapp && <> · <a href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a></>}</> : "O OpenStreetMap não tem"}</dd>
          </dl>
          <small>Lugar que só o OpenStreetMap tem (o Google não trouxe): sem telefone do Google. © colaboradores do OpenStreetMap (ODbL).</small>
        </div>
      )}

      {pino.placeId && doGoogle && (
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
                  ? "Os contatos grátis acabaram por agora (a trava do dia ou o grátis do mês). Sem custo: liberam sozinhos."
                  : `Usa 1 dos ${contatosRestantes ?? tetoDoMes("contato")} contatos grátis que restam agora (a equipe toda).`}
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
