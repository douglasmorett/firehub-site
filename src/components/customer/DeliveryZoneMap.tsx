"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { areasDeRisco as lerAreasDeRisco, areaDeRiscoDoPonto, dentroDoPoligono, type AreaDeRisco } from "@/lib/area-de-risco";
import { limitesDeAtendimento as lerLimites, foraDoLimiteDeAtendimento, type LimiteDeAtendimento } from "@/lib/limite-de-atendimento";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import {
  lerValorDigitado,
  normalizarCadastroDeEntrega,
  ehCobrancaPorDistancia,
  previaDaTabelaDaTela,
  lerZonasGravadas,
  escolhaDoRepasseParaGravar,
  mesmoCadastro,
  repasseDescontado,
  repasseNaTelaDepoisDeLer,
  repasseNaAbertura,
  listaDoAviso,
  formatarKm,
  formatarReais,
  type Problema,
} from "@/lib/cadastro-da-entrega";
import MandeSeusBairros from "@/components/customer/MandeSeusBairros";
import { MapPin, Search, Plus, Trash2, Check, Loader2, Navigation, Pencil } from "lucide-react";

const ZONE_COLORS = ["#C92E09", "#FB8C00", "#43A047", "#1E88E5", "#8E24AA", "#00ACC1"];

/**
 * Como a loja cobra a entrega. Três métodos, e cada um se explica em uma
 * linha — a loja escolhe um e é ele que vale para todo pedido.
 *
 * O "km percorrido" já existia no código (tipo ROTA), mas escondido num
 * sub-seletor dentro do modo raio: quem procurava não achava, e quem não
 * procurava nem sabia que existia.
 */
const METODOS_DE_COBRANCA: { chave: string; emoji: string; nome: string; ajuda: string; recomendado?: boolean }[] = [
  {
    chave: "KM", emoji: "📍", nome: "Por raio (linha reta)", recomendado: true,
    ajuda: "A distância em linha reta da loja até o cliente — é o círculo desenhado no mapa. Simples de explicar e o que quase toda loja usa.",
  },
  {
    chave: "ROTA", emoji: "🛣️", nome: "Por km percorrido",
    ajuda: "O caminho que a moto faz de verdade pelas ruas. Mais justo onde tem rio, linha de trem ou morro no meio: quem está do outro lado paga pelo trajeto real.",
  },
  {
    chave: "NEIGHBORHOOD", emoji: "🏙️", nome: "Por bairro",
    ajuda: "Você cadastra cada bairro que atende e o valor de cada um. O cliente escolhe o bairro na lista, sem depender do mapa.",
  },
  {
    chave: "POLIGONO", emoji: "✏️", nome: "Desenhar no mapa",
    ajuda: "Você liga os pontinhos no mapa até fechar o contorno de onde entrega, e dá a taxa de cada área. É o único método que não depende de o mapa conhecer o nome do bairro — a conta é geometria: o ponto do cliente está dentro do desenho ou não está.",
  },
];

/**
 * A cor da faixa do km percorrido: verde perto da loja, indo a vermelho na
 * mais longe — a leitura de "mais perto, mais barato" que o mapa do iFood dá.
 */
function corDaFaixaPelaRua(indice: number, total: number): string {
  const t = total <= 1 ? 0 : Math.max(0, indice) / (total - 1);
  const matiz = Math.round(150 - 145 * t);
  return `hsl(${matiz}, 70%, 40%)`;
}

const CORES_DA_AREA = ["#0F766E", "#1C1917", "#44403C", "#E8590C", "#0F766E", "#C92E09"];

// ── O QUE A TELA EDITA ──────────────────────────────────────────────────────
//
// Cada item tem um `id` que NUNCA muda enquanto a tela está aberta. Antes a
// lista era reordenada por km DURANTE o render e os cartões usavam o índice
// como chave: montando as 9 faixas da Divinos, "adicionar faixa" criava uma
// de 6 km; ao digitar "1" ela pulava para o topo, o campo com foco passava a
// mostrar a faixa de 5 km e o ".5" seguinte ia parar nela (virava 5,5). Agora
// a ordem só muda quando a pessoa SAI do campo de km, ou ao salvar.
//
// Os números são `number | null`: null é "não preenchido", que NÃO é zero. Para
// o valor do motoboy isso muda a regra (R6): zero é "ele não recebe nada
// nesta faixa", vazio é "a faixa não tem valor" — e aí vale o acerto de cada
// entregador.

/** Faixa de distância (modos KM e ROTA). */
type FaixaNaTela = { id: string; km: number | null; time: number | null; fee: number | null; motoboyFee: number | null };
/** Bairro atendido (modo NEIGHBORHOOD). */
type BairroNaTela = { id: string; name: string; time: number | null; fee: number | null; motoboyFee: number | null };
/** Área desenhada (modo POLIGONO; lib/area-de-entrega.ts lê `pontos`, `fee`, `time` e `repasse`). */
type AreaNaTela = { id: string; nome: string; pontos: [number, number][]; fee: number | null; time: number | null; repasse: number | null };

/**
 * A tabela de EXEMPLO de quem ainda não tem cadastro. É sugestão, não a tabela
 * da loja: o Salvar pergunta antes de gravá-la do jeito que veio (handleSave).
 */
const FAIXAS_DE_EXEMPLO = [{ km: 1, time: 30, fee: 5 }, { km: 3, time: 45, fee: 8 }, { km: 5, time: 60, fee: 12 }];
const BAIRROS_DE_EXEMPLO = [{ name: "Centro", time: 30, fee: 5 }, { name: "Bairro Vizinho", time: 45, fee: 8 }];

let contadorDeId = 0;
const novoId = (prefixo: string) => `${prefixo}${++contadorDeId}`;

const numeroOuNulo = (v: unknown): number | null => {
  const n = lerValorDigitado(v as any);
  return n == null ? null : n;
};

/** A confirmação "motoboy recebe mais que o cliente" vale para ESTA faixa com ESTES valores. */
const chaveDoRepasseAcima = (tipo: string, rotulo: string, fee: number, repasse: number) =>
  `acima:${tipo === "KM" || tipo === "ROTA" ? "KM" : tipo}:${rotulo}:${fee}:${repasse}`;

/** O que a tela manda ao servidor por faixa — o `id` e os vazios ficam de fora. */
function faixaParaSalvar(f: FaixaNaTela, comRepasse: boolean) {
  return {
    km: f.km, time: f.time, fee: f.fee,
    ...(comRepasse && f.motoboyFee != null ? { motoboyFee: f.motoboyFee } : {}),
  };
}

/** Em ordem crescente de km; faixa sem km vai para o fim (é a que está sendo digitada). */
function ordenarFaixas(lista: FaixaNaTela[]): FaixaNaTela[] {
  return [...lista].sort((a, b) => {
    if (a.km == null && b.km == null) return 0;
    if (a.km == null) return 1;
    if (b.km == null) return -1;
    return a.km - b.km;
  });
}

const mesmaOrdem = (a: FaixaNaTela[], b: FaixaNaTela[]) => a.length === b.length && a.every((f, i) => f.id === b[i].id);

/** O retrato do que está gravado, para o simulador saber se a tela mudou algo. */
function retratoDasFaixas(lista: FaixaNaTela[], comRepasse: boolean): string {
  return JSON.stringify(ordenarFaixas(lista).map((f) => faixaParaSalvar(f, comRepasse)));
}

/**
 * Resposta de /api/delivery-fee. Os campos novos (tempoMin, medida, faixaKm,
 * taxaDoEntregador, ponto, pedeConfirmacao, cotacao) chegam com o motor da
 * entrega por km; os antigos continuam. Tudo opcional: a tela mostra o que vier.
 */
type RespostaDaCotacao = {
  fee?: number;
  available?: boolean;
  unknown?: boolean;
  type?: string;
  distanceKm?: number | null;
  maxRadiusKm?: number | null;
  matchedAddress?: string | null;
  neighborhood?: string | null;
  tempoMin?: number | null;
  medida?: "rota" | "estimada" | "linha-reta" | null;
  faixaKm?: number | null;
  taxaDoEntregador?: number | null;
  ponto?: { lat: number; lng: number; origem?: string } | null;
  pedeConfirmacao?: boolean;
  precisaConfirmarNoMapa?: boolean;
  message?: string;
  error?: string;
};

type Simulacao = RespostaDaCotacao & {
  consulta: string;
  /**
   * Como a tela estava quando a simulação foi feita — para dizer se ela ainda
   * vale. `separado` é a escolha GRAVADA "o motoboy recebe um valor por faixa"
   * (null = a tela não conseguiu ler).
   */
  feitaCom: { tipoSalvo: string; alterada: boolean; separado: boolean | null };
};

type AvisoDoPainel = { tipo: "ok" | "erro" | "aviso"; texto: string; lista?: string[] } | null;

interface Props {
  initialAddress: string;
  initialLatLng: unknown;
  initialZones: unknown;
  zoneType: string;
  /** Não é mais usado: a sincronização de tempo com o iFood foi desligada (api/store-settings). */
  initialIfoodSyncDeliveryTime?: boolean;
  /** As áreas de risco já gravadas (User.deliveryConfig.areasDeRisco). */
  initialAreasDeRisco?: unknown;
  /** O contorno de onde a loja entrega, por cima do raio (User.deliveryConfig.limiteDeAtendimento). */
  initialLimiteDeAtendimento?: unknown;
  /**
   * O `separado` gravado (User.deliveryConfig.repasseDoEntregador.separado),
   * lido pela página com o resto do cadastro: a opção "Quanto o motoboy
   * recebe" já abre nele, sem o palpite até o GET voltar (repasseNaAbertura).
   */
  initialRepasseSeparado?: boolean | null;
  /** Nome da loja, para a mensagem pronta da tarja "mande seus bairros" (MandeSeusBairros). */
  nomeDaLoja?: string | null;
  /**
   * `storeAddress` só vem quando a loja marcou para TROCAR o endereço do
   * cadastro pelo do mapa — ausente, o servidor mantém o que está gravado.
   */
  onSave: (data: {
    storeLatLng: { lat: number; lng: number };
    deliveryZones: unknown[];
    deliveryZoneType: string;
    storeAddress?: string;
    ifoodSyncDeliveryTime?: boolean;
    areasDeRisco?: AreaDeRisco[];
    limiteDeAtendimento?: LimiteDeAtendimento[];
  }) => Promise<void>;
}

/** O cadastro de entrega que está no banco (GET /api/store-settings). */
type CadastroGravado = {
  deliveryZoneType: string | null;
  deliveryZones: unknown;
  storeLatLng: { lat: number; lng: number } | null;
  storeAddress: string | null;
  repasseDoEntregador?: { separado?: boolean } | null;
};

async function lerCadastroGravado(): Promise<CadastroGravado | null> {
  try {
    const r = await fetch("/api/store-settings", { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    return d && typeof d.entrega === "object" ? (d.entrega as CadastroGravado) : null;
  } catch {
    return null;
  }
}

/** Nome do método para as mensagens. */
const nomeDoMetodo = (tipo: string) =>
  METODOS_DE_COBRANCA.find((m) => m.chave === (ehCobrancaPorDistancia(tipo) && tipo !== "ROTA" ? "KM" : tipo))?.nome || tipo;

/**
 * O método que a tela abre. RADIUS e DISTANCE são nomes antigos do raio: a
 * tela trabalha com KM. Sem tipo (ou com "KM", que é o padrão que o formulário
 * manda quando o banco não tem tipo), vale o que o CADASTRO é — a mesma leitura
 * de lib/area-de-entrega.ts (modoDaArea): contorno desenhado é área, lista só
 * de nomes é bairro. Abrir uma lista de bairros como faixas de km mostrava
 * cartões "Nova faixa" vazios, e o Salvar os gravava assim.
 */
const tipoDaTela = (t: string, zonas: any[]) => {
  const s = String(t || "").toUpperCase();
  if (s === "ROTA" || s === "NEIGHBORHOOD" || s === "POLIGONO") return s;
  const kmDe = (z: any) => Number(z?.km ?? z?.maxKm ?? z?.radius ?? 0) || 0;
  if (zonas.some((z: any) => Array.isArray(z?.pontos) && z.pontos.length >= 3)) return "POLIGONO";
  if (zonas.some((z: any) => kmDe(z) > 0)) return "KM";
  if (zonas.some((z: any) => z && (z.name || z.nome))) return "NEIGHBORHOOD";
  return "KM";
};

// ── Campo numérico que aceita "1,5" ─────────────────────────────────────────
//
// `type="number"` com `parseFloat(...) || 0` fazia o campo vazio virar "0" no
// mesmo instante (não dava para apagar e digitar de novo) e não aceitava a
// vírgula que todo brasileiro digita. Aqui o texto é da pessoa enquanto ela
// digita; o número é lido a cada tecla e o texto só é reformatado quando ela
// sai do campo.
function CampoNumerico({
  valor, onMudar, formato, rotulo, placeholder, invalido, autoFocus, onSair, semMoldura,
}: {
  valor: number | null;
  onMudar: (n: number | null) => void;
  formato: "km" | "reais" | "inteiro";
  rotulo: string;
  placeholder?: string;
  invalido?: boolean;
  autoFocus?: boolean;
  onSair?: (e: React.FocusEvent<HTMLInputElement>) => void;
  /** Dentro de uma caixa com unidade ("min", "R$"): a moldura e o vermelho são da caixa. */
  semMoldura?: boolean;
}) {
  const formatar = (n: number | null) =>
    n == null ? "" : formato === "reais" ? n.toFixed(2).replace(".", ",") : formato === "inteiro" ? String(Math.round(n)) : formatarKm(n);
  const [texto, setTexto] = useState(() => formatar(valor));
  const focado = useRef(false);
  useEffect(() => {
    if (focado.current) return;
    setTexto(formatar(valor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor, formato]);
  return (
    <input
      type="text"
      inputMode={formato === "inteiro" ? "numeric" : "decimal"}
      autoComplete="off"
      aria-label={rotulo}
      aria-invalid={invalido || undefined}
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={texto}
      onFocus={(e) => { focado.current = true; e.currentTarget.select(); }}
      onChange={(e) => { setTexto(e.target.value); onMudar(numeroOuNulo(e.target.value)); }}
      onBlur={(e) => {
        focado.current = false;
        const n = numeroOuNulo(texto);
        // Texto que não é número fica como está (e o campo, vermelho): apagar
        // o que a pessoa digitou esconderia o erro dela.
        if (n != null || !texto.trim()) setTexto(formatar(n));
        onSair?.(e);
      }}
      style={semMoldura
        ? { ...caixaDoCampo, border: "none", borderRadius: 0, background: "transparent", minWidth: 0 }
        : {
          ...caixaDoCampo,
          borderColor: invalido ? "#DC2626" : "#B8C2CF",
          background: invalido ? "#FEF2F2" : "#FFFFFF",
        }}
    />
  );
}

export default function DeliveryZoneMap({ initialAddress, initialLatLng, initialZones, zoneType, initialAreasDeRisco, initialLimiteDeAtendimento, initialRepasseSeparado, nomeDaLoja, onSave }: Props) {
  const pontoInicial = useMemo(() => lerPontoDaLoja(initialLatLng), [initialLatLng]);
  // O cadastro gravado, lido como o MOTOR lê (lib/cadastro-da-entrega.ts,
  // lerZonasGravadas): lista, ou a lista em TEXTO, com o contorno das áreas
  // também em texto. Lendo só lista, o cadastro em texto abria como as faixas
  // (ou os bairros) de fábrica, e o primeiro Salvar os gravava por cima do real.
  const gravadas = useMemo(() => lerZonasGravadas(initialZones), [initialZones]);
  const zonasIniciais: any[] = gravadas.zonas;
  const tipoInicial = tipoDaTela(zoneType, zonasIniciais);
  /**
   * Tinha ALGO gravado que não se lê (texto quebrado, objeto solto). A tela
   * abre com a tabela de exemplo, mas avisa, e o Salvar pergunta antes de
   * gravar por cima.
   */
  const cadastroIlegivel = gravadas.ilegivel;

  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circlesRef = useRef<any[]>([]);
  const simMarcadorRef = useRef<any>(null);
  /** O caminho pela rua até o cliente simulado (só no modo km percorrido). */
  const simCaminhoRef = useRef<any>(null);
  /**
   * O que o clique no mapa faz quando não está desenhando nem mexendo no
   * endereço: simular a entrega naquele ponto. Em ref porque o `map.on("click")`
   * é ligado uma vez só, na criação do mapa.
   */
  const simularNoPontoRef = useRef<((lat: number, lng: number) => void) | null>(null);
  const observadorDoTamanho = useRef<ResizeObserver | null>(null);
  const editingAddressRef = useRef(!pontoInicial);

  const [address, setAddress] = useState(initialAddress || "");
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(pontoInicial);
  const [currentZoneType, setCurrentZoneType] = useState<string>(tipoInicial);

  /**
   * Cobrança por DISTÂNCIA — as faixas em km. Vale para os dois jeitos de
   * medir: "KM" (linha reta, o círculo do mapa) e "ROTA" (o caminho que a moto
   * faz pelas ruas). As faixas cadastradas são as mesmas; muda só o número que
   * entra na comparação.
   */
  const porDistancia = currentZoneType === "KM" || currentZoneType === "ROTA";
  const porRota = currentZoneType === "ROTA";
  const porDesenho = currentZoneType === "POLIGONO";
  const porBairro = currentZoneType === "NEIGHBORHOOD";
  const metodoAtivo = currentZoneType;

  /**
   * Onde a loja NÃO entrega, por mais perto que seja.
   *
   * Raio e bairro não sabem dizer "aqui não": a rua do outro lado da avenida
   * está a 900 m e cai dentro do raio de 3 km. Sem isto, a loja descobre na
   * hora de despachar, com a comida pronta, e liga para cancelar.
   */
  const [areasDeRisco, setAreasDeRisco] = useState<AreaDeRisco[]>(() => lerAreasDeRisco(initialAreasDeRisco));
  /**
   * Onde a loja ENTREGA, desenhado por cima do raio/rota/bairro
   * (lib/limite-de-atendimento.ts). Mora no deliveryConfig, ao lado das áreas
   * de risco — e não em `deliveryZones`, que é o que faz ele conviver com as
   * faixas de km. A R&D Pizzaria (27/09/2026) queria "um mapa por km e outro
   * por desenho, os dois juntos": desenhava, trocava de método e perdia o
   * desenho, porque as áreas desenhadas e as faixas dividem o mesmo campo.
   * No método "Desenhar no mapa" o contorno não vale (as áreas já são ele),
   * mas fica guardado.
   */
  const [limites, setLimites] = useState<LimiteDeAtendimento[]>(() => lerLimites(initialLimiteDeAtendimento));
  /**
   * As áreas de ENTREGA desenhadas. Moram em `deliveryZones`, como as faixas
   * de km e os bairros: é um cadastro só, e a modalidade escolhida diz qual
   * deles vale.
   */
  const [areasDeEntrega, setAreasDeEntrega] = useState<AreaNaTela[]>(() =>
    tipoInicial === "POLIGONO"
      ? zonasIniciais
          .filter((z: any) => Array.isArray(z?.pontos) && z.pontos.length >= 3)
          .map((z: any) => ({
            id: novoId("a"),
            nome: String(z.nome || z.name || "Área"),
            pontos: z.pontos as [number, number][],
            fee: numeroOuNulo(z.fee),
            time: numeroOuNulo(z.time) ?? 45,
            repasse: numeroOuNulo(z.repasse ?? z.motoboyFee),
          }))
      : []
  );
  /** Pontos sendo clicados agora. `null` = não está desenhando. */
  const [desenhando, setDesenhando] = useState<[number, number][] | null>(null);
  /**
   * O que está sendo desenhado: a área que a loja ATENDE ou a que ela RECUSA.
   * O clique no mapa é o mesmo; só o destino do contorno muda — e sem isto o
   * contorno de entrega acabaria na lista de áreas de risco.
   */
  const [alvoDoDesenho, setAlvoDoDesenho] = useState<"RISCO" | "ENTREGA" | "LIMITE">("RISCO");

  /**
   * Trocar de método SEM perder o desenho. As áreas de entrega desenhadas e
   * as faixas de km dividem o mesmo campo, então sair de "Desenhar no mapa"
   * deixa as áreas de fora do próximo Salvar. Antes isso acontecia calado —
   * o lojista voltava para o raio e "sumia tudo". Agora ele escolhe: levar o
   * desenho como CONTORNO de onde entrega (a taxa passa a ser a do método
   * novo; fora do contorno a loja não atende) ou deixar para lá.
   */
  const trocarMetodo = (novo: string) => {
    if (novo === currentZoneType) return;
    if (currentZoneType === "POLIGONO" && areasDeEntrega.length > 0) {
      const quantas = areasDeEntrega.length === 1 ? "a área desenhada deixa" : `as ${areasDeEntrega.length} áreas desenhadas deixam`;
      const levar = window.confirm(
        `Trocando para "${nomeDoMetodo(novo)}", ${quantas} de ser a área de entrega: a taxa passa a ser a do novo método.\n\n` +
        `Quer MANTER o desenho como o contorno de onde você entrega? Dentro dele vale a tabela nova; fora dele a loja não atende. ` +
        `(Clique em Cancelar para trocar sem manter o desenho.)`,
      );
      if (levar) {
        setLimites((atual) => [...atual, ...areasDeEntrega.map((a) => ({ nome: a.nome, pontos: a.pontos, ativa: true }))]);
      }
    }
    if (desenhando) setDesenhando(null);
    setCurrentZoneType(novo);
  };
  // O clique do mapa é registrado uma vez só, no início; ele lê estes refs
  // para saber o que fazer AGORA, em vez de capturar o estado de então.
  const desenhandoRef = useRef<[number, number][] | null>(null);
  useEffect(() => { desenhandoRef.current = desenhando; }, [desenhando]);
  const riscoRef = useRef<any[]>([]);

  // As faixas de km. ROTA e os nomes antigos (RADIUS/DISTANCE) são cadastros
  // de FAIXA DE DISTÂNCIA, iguais ao raio — só muda como a distância é medida.
  // Faltando aqui, a loja que cobra por km percorrido abria a tela com as
  // faixas de fábrica (1/3/5 km) e o primeiro Salvar — mesmo só para arrastar
  // o pino — gravava essas por cima das dela, sem aviso e sem volta.
  const [faixas, setFaixas] = useState<FaixaNaTela[]>(() => {
    const salvas = tipoInicial === "KM" || tipoInicial === "ROTA"
      ? zonasIniciais.filter((z: any) => z && typeof z === "object" && !Array.isArray(z.pontos))
      : [];
    const lidas = salvas.map((z: any) => ({
      id: novoId("f"),
      km: numeroOuNulo(z.km ?? z.maxKm ?? z.radius),
      time: numeroOuNulo(z.time),
      fee: numeroOuNulo(z.fee),
      motoboyFee: numeroOuNulo(z.motoboyFee),
    }));
    return lidas.length
      ? ordenarFaixas(lidas)
      : FAIXAS_DE_EXEMPLO.map((f) => ({ id: novoId("f"), ...f, motoboyFee: null }));
  });

  const [bairros, setBairros] = useState<BairroNaTela[]>(() => {
    const salvos = tipoInicial === "NEIGHBORHOOD" ? zonasIniciais.filter((z: any) => z && typeof z === "object") : [];
    return salvos.length
      ? salvos.map((z: any) => ({
          id: novoId("b"),
          name: String(z.name ?? z.nome ?? ""),
          time: numeroOuNulo(z.time),
          fee: numeroOuNulo(z.fee),
          motoboyFee: numeroOuNulo(z.motoboyFee),
        }))
      : BAIRROS_DE_EXEMPLO.map((b) => ({ id: novoId("b"), ...b, motoboyFee: null }));
  });

  // ── AS ABAS DO PAINEL ─────────────────────────────────────────────────────
  //
  // "Tempo e taxa" é o que a loja mexe no dia a dia, no desenho do iFood: o
  // ajuste rápido e uma linha por faixa/bairro/área. O cadastro (nome, km,
  // motoboy, apagar) fica na aba ao lado, e o método e os contornos em
  // "Configurar". Antes era tudo uma coluna só: a Showrrascão, com 55 bairros,
  // rolava 55 cartões para achar onde mudar o tempo — e mudava um por um.
  // Loja sem cadastro abre em "Configurar": a primeira decisão é o método.
  const [aba, setAba] = useState<"tempo" | "cadastro" | "configurar">(() => (zonasIniciais.length > 0 ? "tempo" : "configurar"));
  const [buscaDoBairro, setBuscaDoBairro] = useState("");
  const [focarNoBairro, setFocarNoBairro] = useState<string | null>(null);
  const [tempoParaTodos, setTempoParaTodos] = useState<number | null>(null);

  /**
   * A tabela da tela num texto, para dizer "não salvo" depois de um ajuste.
   * Sem o motoboy (a leitura do GET pode ligar/desligar o campo sozinha) e sem
   * o bairro em branco (o salvar o descarta) — senão a tela acusaria mudança
   * que a loja não fez.
   */
  const retratoDaTabela = currentZoneType + JSON.stringify(
    porDistancia
      ? ordenarFaixas(faixas).map((f) => [f.km, f.time, f.fee])
      : porBairro
        ? bairros.filter((b) => b.name.trim()).map((b) => [b.name.trim(), b.time, b.fee])
        : areasDeEntrega.map((a) => [a.nome, a.time, a.fee, a.pontos.length]),
  );
  const [tabelaGravada, setTabelaGravada] = useState(retratoDaTabela);

  // ── QUANTO O MOTOBOY RECEBE ───────────────────────────────────────────────
  //
  // "Um valor por faixa" = `deliveryConfig.repasseDoEntregador.separado`. Com
  // ele ligado, cada faixa/bairro/área tem o campo "Motoboy recebe", o valor é
  // gravado no pedido na hora da venda, e TODAS precisam dele: faixa sem valor
  // não pega o da faixa seguinte (R6), cai no acerto de cada entregador — e a
  // loja só descobriria no fechamento que pagou por duas regras.
  //
  // A tela ABRE no `separado` que a página já leu do banco
  // (initialRepasseSeparado → repasseNaAbertura). Só sem ele vale o palpite
  // "o cadastro já tem valores". A escolha gravada chega logo depois (GET
  // abaixo) e confere, se a pessoa ainda não mexeu. Se o GET falhar, a tela
  // fica na abertura — e o Salvar não grava o que a loja não clicou
  // (escolhaDoRepasseParaGravar).
  const temValorDeMotoboy =
    faixas.some((f) => f.motoboyFee != null) || bairros.some((b) => b.motoboyFee != null) || areasDeEntrega.some((a) => a.repasse != null);
  const [repassePorFaixa, setRepassePorFaixa] = useState<boolean>(() =>
    repasseNaAbertura({ gravadoNaPagina: initialRepasseSeparado, temValorNasFaixas: temValorDeMotoboy }),
  );
  const [separadoNoServidor, setSeparadoNoServidor] = useState<boolean | null>(null);
  const mexeuNoRepasse = useRef(false);
  const [descontoDoAtalho, setDescontoDoAtalho] = useState<number | null>(1);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const gravado = await lerCadastroGravado();
        if (!gravado) return;
        const separado = gravado.repasseDoEntregador?.separado === true;
        if (!vivo) return;
        setSeparadoNoServidor(separado);
        // A tela passa ao gravado, nos DOIS sentidos (repasseNaTelaDepoisDeLer).
        // Loja que NÃO separa, mas com valores antigos nas faixas: os valores
        // não valem hoje (lib/repasse-do-entregador.ts ignora sem `separado`) —
        // mostrar "ligado" seria dizer que vale o que não vale. Loja que separa
        // com as faixas ainda sem valor: mostrar "acerto" escondia o campo que
        // ela precisa preencher. Só o setter funcional lê o valor atual aqui.
        setRepassePorFaixa((naTela) => repasseNaTelaDepoisDeLer({ gravado: separado, naTela, lojaEscolheu: mexeuNoRepasse.current }));
      } catch {}
    })();
    return () => { vivo = false; };
  }, []);

  const [zonaEmFoco, setZonaEmFoco] = useState<string | null>(null);
  const [focarNaFaixa, setFocarNaFaixa] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(!!pontoInicial);
  const [msg, setMsg] = useState("");
  const [avisoDoPainel, setAvisoDoPainel] = useState<AvisoDoPainel>(null);
  /** Depois da primeira tentativa de salvar, os campos com problema ficam vermelhos enquanto a pessoa corrige. */
  const [mostrarErros, setMostrarErros] = useState(false);
  /**
   * O que a loja já confirmou (taxa zero, motoboy acima da taxa, avisos). O
   * repasse acima da taxa confirmado numa tela anterior vem gravado na zona
   * (`repasseAcimaDaTaxa`) e já entra aqui.
   */
  const confirmados = useRef<Set<string>>(new Set(
    zonasIniciais
      .filter((z: any) => z && z.repasseAcimaDaTaxa === true)
      .map((z: any) => {
        const repasse = numeroOuNulo(z.motoboyFee ?? z.repasse);
        const fee = numeroOuNulo(z.fee);
        const km = numeroOuNulo(z.km ?? z.maxKm ?? z.radius);
        const rotulo = tipoInicial === "NEIGHBORHOOD" ? String(z.name ?? "").trim()
          : tipoInicial === "POLIGONO" ? String(z.nome || z.name || "Área")
          : km != null ? `até ${formatarKm(km)} km` : "";
        return fee != null && repasse != null ? chaveDoRepasseAcima(tipoInicial, rotulo, fee, repasse) : "";
      })
      .filter(Boolean),
  ));
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  /**
   * O MAPA já existe? `leafletMapRef` é um ref: mudar não re-renderiza, então
   * o efeito que desenha os polígonos rodava ANTES do mapa nascer, via
   * `leafletMapRef.current` vazio e desistia. A loja abria a tela com as áreas
   * na lista e o mapa limpo — e redesenhava tudo por cima, achando que tinha
   * perdido o trabalho.
   */
  const [mapaPronto, setMapaPronto] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── O ENDEREÇO DA LOJA NÃO É O RÓTULO DO MAPA ─────────────────────────────
  //
  // O campo de busca serve para achar o ponto; o texto que o mapa devolve (o
  // reverse geocode) é o nome que o OpenStreetMap dá para aquele pedaço de
  // rua. Salvar o mapa gravava esse texto como endereço da loja: o da Divinos
  // ("Tv Liberdade 11") virou "Rua Beira Alta, Vila Monte Alegre, Cabo Frio,
  // Rio de Janeiro, Região Sudeste, 28922-000, Brasil" — no cardápio e na
  // comanda. Agora só troca se a loja marcar.
  const [enderecoSalvo, setEnderecoSalvo] = useState(initialAddress || "");
  useEffect(() => { setEnderecoSalvo(initialAddress || ""); }, [initialAddress]);
  const [usarEndereco, setUsarEndereco] = useState<boolean | null>(null);
  const limparEndereco = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const enderecoMudou = address.trim().length > 0 && limparEndereco(address) !== limparEndereco(enderecoSalvo);
  // Loja sem endereço nenhum no cadastro: o do mapa é melhor que nada, e não
  // sobrescreve coisa alguma.
  const trocarEndereco = enderecoMudou && (usarEndereco ?? !enderecoSalvo.trim());

  // ── O QUE ESTÁ GRAVADO (para o simulador dizer se a simulação vale) ───────
  //
  // `temCadastro`: o banco tem um cadastro do método `tipo`. A loja nova abre
  // em "Por raio" com a tabela de exemplo, e sem isto o Salvar em "Por bairro"
  // avisava que ia APAGAR "3 faixa(s) de distância" que nunca foram gravadas.
  const [salvo, setSalvo] = useState(() => ({
    tipo: tipoInicial,
    faixas: retratoDasFaixas(faixas, temValorDeMotoboy),
    ponto: pontoInicial,
    temCadastro: zonasIniciais.length > 0,
  }));
  const [ilegivelNoBanco, setIlegivelNoBanco] = useState(cadastroIlegivel);
  const pontoMudou = !!latLng && (!salvo.ponto || Math.abs(latLng.lat - salvo.ponto.lat) > 1e-5 || Math.abs(latLng.lng - salvo.ponto.lng) > 1e-5);
  const faixasMudaram = porDistancia && retratoDasFaixas(faixas, repassePorFaixa) !== salvo.faixas;

  // Load Leaflet CSS dynamically
  useEffect(() => {
    if (typeof window === "undefined") return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    // Do nosso domínio: o CSP bloqueia stylesheet do unpkg (style-src),
    // e sem o CSS do Leaflet os tiles do mapa viram um embaralhado.
    link.href = "/leaflet/leaflet.css";
    document.head.appendChild(link);
    setLeafletLoaded(true);
  }, []);

  // Helper to update location and reverse-geocode address
  const updateLocationAndAddress = async (lat: number, lng: number) => {
    setLatLng({ lat, lng });
    setConfirmed(false);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
        { headers: { "Accept-Language": "pt-BR" } }
      );
      const data = await res.json();
      if (data && data.display_name) {
        const addr = data.address || {};
        const road = addr.road || addr.street || addr.pedestrian || "";
        const houseNumber = addr.house_number ? `, ${addr.house_number}` : "";
        const suburb = addr.suburb || addr.neighbourhood || addr.quarter || "";
        const city = addr.city || addr.town || addr.village || addr.municipality || "";
        const state = addr.state ? ` - ${addr.state}` : "";

        let formatted = "";
        if (road) {
          formatted = `${road}${houseNumber}${suburb ? ` - ${suburb}` : ""}${city ? `, ${city}` : ""}${state}`;
        } else {
          formatted = data.display_name.split(",").slice(0, 4).join(",");
        }
        setAddress(formatted);
      }
    } catch {}
  };

  const iconeDaLoja = (L: any) => L.divIcon({
    className: "",
    html: `<div style="width:36px;height:36px;background:#1E293B;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
      <div style="transform:rotate(45deg);font-size:16px;">🏪</div>
    </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
  });

  const colocarPinoDaLoja = (lat: number, lng: number, reverso: boolean) => {
    const ref = leafletMapRef.current;
    if (!ref) return;
    const { map, L } = ref;
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng]);
      return;
    }
    markerRef.current = L.marker([lat, lng], { icon: iconeDaLoja(L), draggable: true }).addTo(map);
    markerRef.current.on("dragend", (e: any) => {
      if (!editingAddressRef.current) return;
      const p = e.target.getLatLng();
      if (reverso) updateLocationAndAddress(p.lat, p.lng);
      else { setLatLng({ lat: p.lat, lng: p.lng }); setConfirmed(false); }
    });
  };

  // Initialize map
  useEffect(() => {
    if (!leafletLoaded || !mapRef.current) return;
    if (leafletMapRef.current) return;

    import("leaflet").then((L) => {
      // Sem pino salvo, isto abria em Rio das Ostras — a coordenada que ficou
      // no código da primeira loja. A loja de São Paulo abria a área de entrega
      // e via o litoral fluminense. Agora o fallback é o país inteiro (o mapa
      // não finge saber) e, logo em seguida, o endereço do cadastro traz a
      // câmera para a cidade certa (ver o efeito "câmera no endereço").
      const defaultPos: [number, number] = latLng ? [latLng.lat, latLng.lng] : [-14.235, -51.925];

      const map = L.map(mapRef.current!, { zoomControl: false }).setView(defaultPos, latLng ? 13 : 4);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
        maxZoom: 19,
      }).addTo(map);

      // O controle nativo do Leaflet não entra aqui: ele fica no canto inferior
      // direito e o painel de configuração flutua POR CIMA dele (z-index maior,
      // ver .fh-entrega-painel) — o lojista ficava sem + e sem −, só com a roda
      // do mouse, que ninguém adivinha. Os botões desta tela são os da coluna
      // "fh-zoom", na borda esquerda do mapa, onde nada os cobre.

      leafletMapRef.current = { map, L };

      if (latLng) colocarPinoDaLoja(latLng.lat, latLng.lng, true);

      map.on("click", (e: any) => {
        // Desenhando área, o clique é vértice — e nunca mexe no endereço da
        // loja, que é a outra coisa que o clique faz aqui.
        if (desenhandoRef.current) {
          const p: [number, number] = [e.latlng.lat, e.latlng.lng];
          setDesenhando((atual) => [...(atual || []), p]);
          return;
        }
        if (!editingAddressRef.current) {
          // Com o endereço confirmado, tocar no mapa é perguntar "e se o
          // cliente morasse aqui?" — como no Google, sem digitar endereço.
          simularNoPontoRef.current?.(e.latlng.lat, e.latlng.lng);
          return;
        }
        const pos = e.latlng;
        colocarPinoDaLoja(pos.lat, pos.lng, true);
        updateLocationAndAddress(pos.lat, pos.lng);
      });

      // Avisa o React que o mapa existe: é o que faz o efeito dos polígonos
      // (áreas desenhadas e de risco) rodar DEPOIS que há onde desenhar.
      setMapaPronto(true);

      // ── O MAPA TEM QUE RECONHECER A LARGURA QUE TEM ──────────────────
      //
      // O Leaflet mede o container UMA vez, na criação, e depois só escuta
      // `window.resize`. Aqui o container muda de largura sem a janela mudar:
      // recolher o menu lateral, abrir a seção de entrega dentro de Minha
      // Loja, o CSS chegar depois do primeiro quadro. Em todos esses casos os
      // tiles ficavam desenhados na largura ANTIGA — o mapa aparecia como uma
      // faixa estreita com cinza à direita, que é o "mapa espremido" que o
      // dono viu duas vezes.
      const recalcular = () => { try { map.invalidateSize(); } catch {} };
      recalcular();
      // Um quadro depois, para o caso de o CSS do Leaflet ter chegado agora.
      requestAnimationFrame(recalcular);
      const observador = new ResizeObserver(recalcular);
      if (mapRef.current) observador.observe(mapRef.current);
      observadorDoTamanho.current = observador;
    });

    return () => {
      observadorDoTamanho.current?.disconnect();
      observadorDoTamanho.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leafletLoaded]);

  // ── CÂMERA NO ENDEREÇO DA LOJA ────────────────────────────────────────────
  //
  // Loja que nunca salvou o pino abria esta tela num mapa que não é o dela.
  // O endereço está no cadastro desde sempre; o servidor devolve o ponto dele
  // (e guarda no cache, então isto custa uma consulta, não uma busca).
  //
  // Move só a CÂMERA: não cria pino nem marca "localização confirmada". Quem
  // diz onde a loja fica — e é esse ponto que passa a valer para raio e taxa —
  // continua sendo o lojista, clicando no mapa ou buscando o endereço.
  const cameraJaMovida = useRef(false);
  useEffect(() => {
    if (!leafletLoaded || latLng || cameraJaMovida.current) return;
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/geocodificar/loja", { cache: "no-store" });
        if (!r.ok) return;
        const { ponto } = await r.json();
        // `vivo` cai quando o lojista busca o endereço enquanto isto volta —
        // aí quem manda na câmera é a busca dele, não este palpite.
        if (!vivo || !ponto || !leafletMapRef.current) return;
        cameraJaMovida.current = true;
        leafletMapRef.current.map.setView([ponto.lat, ponto.lng], 14);
      } catch {}
    })();
    return () => { vivo = false; };
  }, [leafletLoaded, latLng]);

  // ── A ÁREA PELAS RUAS (km percorrido) ─────────────────────────────────────
  //
  // Pedida ao servidor com as faixas e o pino que estão NA TELA, um instante
  // depois da última mudança — digitar "4,5" não pode virar três cálculos.
  const [areasPelaRua, setAreasPelaRua] = useState<{ km: number; poligonos: [number, number][][][] }[] | null>(null);
  const [areaStatus, setAreaStatus] = useState<"" | "carregando" | "erro">("");
  const kmsDaTela = porRota
    ? [...new Set(faixas.map((f) => f.km).filter((k): k is number => k != null && k > 0))].sort((a, b) => a - b).join(",")
    : "";
  const pinoDaTela = latLng ? `${latLng.lat.toFixed(5)},${latLng.lng.toFixed(5)}` : "";
  useEffect(() => {
    if (!porRota || !kmsDaTela || !pinoDaTela) {
      setAreasPelaRua(null);
      setAreaStatus("");
      return;
    }
    setAreaStatus("carregando");
    const controle = new AbortController();
    const [deLat, deLng] = pinoDaTela.split(",");
    const t = setTimeout(async () => {
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        try {
          const r = await fetch(`/api/store/area-pela-rua?km=${kmsDaTela}&deLat=${deLat}&deLng=${deLng}`, { signal: controle.signal, cache: "no-store" });
          const d = await r.json().catch(() => null);
          if (controle.signal.aborted) return;
          // 429: outro cálculo acabou de sair desta conta — espera e tenta de novo.
          if (r.status === 429) { await new Promise((res) => setTimeout(res, 4200)); continue; }
          if (r.ok && Array.isArray(d?.areas) && d.areas.length) {
            setAreasPelaRua(d.areas);
            setAreaStatus("");
          } else {
            setAreasPelaRua(null);
            setAreaStatus("erro");
          }
          return;
        } catch (e: any) {
          if (e?.name === "AbortError") return;
          setAreasPelaRua(null);
          setAreaStatus("erro");
          return;
        }
      }
      if (!controle.signal.aborted) { setAreasPelaRua(null); setAreaStatus("erro"); }
    }, 1200);
    return () => { clearTimeout(t); controle.abort(); };
  }, [porRota, kmsDaTela, pinoDaTela]);

  // ── OS CÍRCULOS DAS FAIXAS ────────────────────────────────────────────────
  const drawCircles = useCallback(() => {
    if (!leafletMapRef.current) return;
    const { map, L } = leafletMapRef.current;

    circlesRef.current.forEach(c => map.removeLayer(c));
    circlesRef.current = [];
    if (!latLng) return;

    if (porBairro) {
      const isHovered = zonaEmFoco !== null;
      const circle = L.circle([latLng.lat, latLng.lng], {
        radius: 6000,
        color: isHovered ? "#44403C" : "#64748B",
        fillColor: isHovered ? "#44403C" : "#64748B",
        fillOpacity: isHovered ? 0.28 : 0.12,
        weight: isHovered ? 4.5 : 2.5,
        dashArray: "6,4",
      }).addTo(map);
      circle.bindTooltip(
        `<div style="background:#fff; border-radius:10px; padding:8px 12px; box-shadow:0 6px 20px rgba(0,0,0,0.18); border:1.5px solid #E2E8F0; font-family:'Inter',sans-serif;">
          <div style="font-weight:800; font-size:0.84rem; color:#0F172A;">🏙️ Entrega por Bairro</div>
          <div style="font-size:0.76rem; color:#64748B;">${bairros.filter((b) => b.name.trim()).length} bairros cadastrados</div>
        </div>`,
        { permanent: true, direction: "center", className: "ifood-clean-tooltip" }
      );
      circlesRef.current.push(circle);
      return;
    }

    // Área desenhada não tem círculo: o contorno é a regra, e um círculo de
    // raio por cima faria a loja achar que o raio também vale.
    if (!porDistancia) return;

    const items = faixas
      .filter((z) => z.km != null && z.km > 0)
      .map((z) => ({ id: z.id, km: z.km as number, time: z.time ?? 0, fee: z.fee ?? 0 }));

    // ── KM PERCORRIDO: MANCHAS PELAS RUAS, NÃO CÍRCULOS ──────────────────
    //
    // O círculo é linha reta e atravessa rio, muro e mar. Aqui cada faixa é a
    // área até onde a moto chega pela rua (lib/area-pela-rua.ts), pintada
    // como as zonas do iFood: da mais longe para a mais perto, cada uma com
    // a sua cor. Enquanto calcula, nada de círculo — ele é justamente o que
    // confundia. Só se o cálculo falhar os círculos voltam, avisados.
    if (porRota && areasPelaRua) {
      const ordem = [...areasPelaRua].sort((a, b) => b.km - a.km);
      const kmsCrescentes = [...areasPelaRua].map((a) => a.km).sort((a, b) => a - b);
      ordem.forEach((area) => {
        const faixa = items.find((z) => Math.abs(z.km - area.km) < 0.005);
        const cor = corDaFaixaPelaRua(kmsCrescentes.indexOf(area.km), kmsCrescentes.length);
        const emFoco = !!faixa && zonaEmFoco === faixa.id;
        const algumEmFoco = zonaEmFoco !== null;
        const camada = L.polygon(area.poligonos, {
          color: cor,
          weight: emFoco ? 3.5 : 1.5,
          fillColor: cor,
          fillOpacity: emFoco ? 0.4 : algumEmFoco ? 0.06 : 0.16,
        }).addTo(map);
        camada.bindTooltip(
          `<div style="font-family:'Inter',sans-serif; line-height:1.35;">
            <div style="font-weight:800; color:#0F172A;">🛣️ até ${formatarKm(area.km)} km pela rua</div>
            ${faixa ? `<div style="color:#64748B; font-size:0.78rem;">⏱️ ${faixa.time} min · 💰 <b style="color:#0F172A">${formatarReais(faixa.fee)}</b></div>` : ""}
          </div>`,
          { sticky: true, direction: "top", className: "ifood-clean-tooltip" },
        );
        circlesRef.current.push(camada);
      });
      return;
    }
    if (porRota && areaStatus !== "erro") return;

    const sorted = [...items].sort((a, b) => b.km - a.km);
    const CIRCLE_COLORS = ["#C92E09", "#E8590C", "#B45309", "#0F766E", "#1C1917", "#475569"];

    sorted.forEach((zone, i) => {
      const isHovered = zonaEmFoco === zone.id;
      const anyHovered = zonaEmFoco !== null;
      const colorIdx = items.length - 1 - i;
      const strokeColor = isHovered ? "#C92E09" : CIRCLE_COLORS[colorIdx % CIRCLE_COLORS.length];

      const circle = L.circle([latLng.lat, latLng.lng], {
        radius: zone.km * 1000,
        color: strokeColor,
        fillColor: strokeColor,
        // No km percorrido o círculo é só referência: mancha fraca, para não
        // parecer que a área de entrega é ele.
        fillOpacity: isHovered ? 0.35 : anyHovered ? 0.04 : porRota ? 0.05 : 0.14,
        weight: isHovered ? 4.5 : 2.5,
        dashArray: isHovered ? undefined : "6,4",
      }).addTo(map);

      // No modo ROTA o círculo MENTE um pouco: ele é a linha reta, e a faixa é
      // em km de rua. A loja via "5 km (raio)" e achava que atendia o centro
      // de Cabo Frio (2,98 km em linha reta) — pela rua são 5,02 km.
      const titulo = porRota
        ? `até ${formatarKm(zone.km)} km pela rua`
        : `${formatarKm(zone.km)} km (raio)`;
      const cardHtml = `
        <div style="background:#fff; border-radius:10px; padding:8px 12px; box-shadow:0 6px 20px rgba(0,0,0,0.18); border:1.5px solid #E2E8F0; font-family:'Inter',sans-serif; min-width:105px; line-height:1.35;">
          <div style="display:flex; align-items:center; gap:6px; font-weight:800; font-size:0.84rem; color:#0F172A; margin-bottom:2px;">
            <span style="font-size:0.8rem;">${porRota ? "🛣️" : "📍"}</span> ${titulo}
          </div>
          <div style="display:flex; align-items:center; gap:6px; font-size:0.76rem; color:#64748B; margin-bottom:2px;">
            <span style="font-size:0.75rem;">⏱️</span> ${zone.time} min
          </div>
          <div style="display:flex; align-items:center; gap:6px; font-weight:800; font-size:0.84rem; color:#0F172A;">
            <span style="font-size:0.8rem;">💰</span> ${formatarReais(zone.fee)}
          </div>
          ${porRota ? `<div style="font-size:0.68rem; color:#B45309; margin-top:3px;">círculo = linha reta</div>` : ""}
        </div>
      `;

      circle.bindTooltip(cardHtml, {
        permanent: isHovered || (!anyHovered && i === sorted.length - 1),
        direction: "center",
        className: "ifood-clean-tooltip"
      });

      circlesRef.current.push(circle);
    });
  }, [latLng, faixas, bairros, porBairro, porDistancia, porRota, zonaEmFoco, areasPelaRua, areaStatus]);

  useEffect(() => {
    drawCircles();
  }, [drawCircles, mapaPronto]);

  // Os polígonos de exclusão, em vermelho tracejado — a única coisa vermelha
  // hachurada no mapa, para não se confundir com as faixas de entrega.
  useEffect(() => {
    const ref = leafletMapRef.current;
    if (!ref) return;
    const { map, L } = ref;
    riscoRef.current.forEach((c) => map.removeLayer(c));
    riscoRef.current = [];

    // As áreas de ENTREGA: contorno cheio e colorido, uma cor por área, para a
    // loja conferir de bater o olho o que desenhou e quanto cobra em cada uma.
    for (let i = 0; i < areasDeEntrega.length; i++) {
      const area = areasDeEntrega[i];
      const cor = CORES_DA_AREA[i % CORES_DA_AREA.length];
      const contorno = L.polygon(area.pontos, {
        color: cor, weight: 2, fillColor: cor, fillOpacity: 0.15,
      }).addTo(map);
      contorno.bindTooltip(
        `${area.nome} — ${formatarReais(area.fee ?? 0)} · ${area.time ?? "?"} min`,
        { sticky: true },
      );
      riscoRef.current.push(contorno);
    }

    // O contorno de onde a loja entrega: verde cheio, por cima do círculo do
    // raio. Fora do método de desenho ele é a regra; dentro dele, só um
    // lembrete apagado do que está guardado.
    for (const limite of limites) {
      const vale = !porDesenho && limite.ativa !== false;
      const contorno = L.polygon(limite.pontos, {
        color: vale ? "#0F766E" : "#94A3B8",
        weight: 3,
        fillColor: vale ? "#0F766E" : "#94A3B8",
        fillOpacity: vale ? 0.08 : 0.04,
      }).addTo(map);
      contorno.bindTooltip(
        `✅ ${limite.nome}${limite.ativa === false ? " (desligado)" : porDesenho ? " (não vale em 'Desenhar no mapa')" : " — a loja entrega só aqui dentro"}`,
        { sticky: true },
      );
      riscoRef.current.push(contorno);
    }

    for (const area of areasDeRisco) {
      const poligono = L.polygon(area.pontos, {
        color: area.ativa === false ? "#94A3B8" : "#C92E09",
        weight: 2,
        dashArray: "6 5",
        fillColor: area.ativa === false ? "#94A3B8" : "#C92E09",
        fillOpacity: area.ativa === false ? 0.08 : 0.2,
      }).addTo(map);
      poligono.bindTooltip(`🚫 ${area.nome}${area.ativa === false ? " (desligada)" : ""}`, { sticky: true });
      riscoRef.current.push(poligono);
    }

    // O que está sendo desenhado agora: os vértices já clicados e a linha
    // entre eles, para a loja ver o contorno enquanto clica.
    if (desenhando && desenhando.length > 0) {
      // Verde quando o contorno é de ENTREGA (ou o LIMITE de onde entrega),
      // vermelho quando é de recusa: a loja está clicando no mesmo mapa para
      // as duas coisas, e a cor é o que diz qual delas está desenhando agora.
      const corDoTracado = alvoDoDesenho === "RISCO" ? "#C92E09" : "#0F766E";
      for (const p of desenhando) {
        const bolinha = L.circleMarker(p, { radius: 5, color: corDoTracado, fillColor: "#fff", fillOpacity: 1, weight: 2 }).addTo(map);
        riscoRef.current.push(bolinha);
      }
      if (desenhando.length >= 2) {
        const linha = L.polyline(desenhando, { color: corDoTracado, weight: 2, dashArray: "6 5" }).addTo(map);
        riscoRef.current.push(linha);
      }
    }
  }, [areasDeRisco, areasDeEntrega, limites, porDesenho, desenhando, alvoDoDesenho, leafletLoaded, mapaPronto]);

  // Autocomplete live search as user types
  const handleAddressChange = (val: string) => {
    setAddress(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!val || val.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5&addressdetails=1`,
          { headers: { "Accept-Language": "pt-BR" } }
        );
        const data = await res.json();
        if (Array.isArray(data)) {
          setSuggestions(data);
          setShowSuggestions(data.length > 0);
        }
      } catch {}
    }, 300);
  };

  const selectSuggestion = (item: any) => {
    const newLatLng = { lat: parseFloat(item.lat), lng: parseFloat(item.lon) };
    setLatLng(newLatLng);
    setAddress(item.display_name);
    setSuggestions([]);
    setShowSuggestions(false);
    editingAddressRef.current = true;
    setConfirmed(false);
    setMsg("");

    if (leafletMapRef.current) {
      leafletMapRef.current.map.setView([newLatLng.lat, newLatLng.lng], 15);
      colocarPinoDaLoja(newLatLng.lat, newLatLng.lng, false);
    }
  };

  // Geocode address
  const geocodeAddress = async () => {
    if (!address.trim()) return;
    setSearching(true);
    setMsg("");
    setShowSuggestions(false);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1&addressdetails=1`,
        { headers: { "Accept-Language": "pt-BR" } }
      );
      const data = await res.json();
      if (data.length === 0) {
        setMsg("❌ Endereço não encontrado. Tente ser mais específico.");
        return;
      }
      const { lat, lon, display_name } = data[0];
      const newLatLng = { lat: parseFloat(lat), lng: parseFloat(lon) };
      setLatLng(newLatLng);
      setAddress(display_name.split(",").slice(0, 3).join(","));
      editingAddressRef.current = true;
      setConfirmed(false);

      if (leafletMapRef.current) {
        leafletMapRef.current.map.setView([newLatLng.lat, newLatLng.lng], 14);
        colocarPinoDaLoja(newLatLng.lat, newLatLng.lng, false);
      }
    } catch {
      setMsg("❌ Erro ao buscar endereço.");
    } finally {
      setSearching(false);
    }
  };

  const confirmLocation = () => {
    if (!latLng) return;
    setConfirmed(true);
    editingAddressRef.current = false;
    setMsg("✅ Localização confirmada! Os raios de entrega foram atualizados.");
    drawCircles();
  };

  const startEditingAddress = () => {
    editingAddressRef.current = true;
    setConfirmed(false);
    setMsg("");
  };

  // ── FAIXAS ────────────────────────────────────────────────────────────────

  /**
   * A faixa nova continua a tabela: o mesmo passo das duas últimas (a Divinos
   * usa 0,5 km), a mesma taxa e o mesmo repasse da última. O "adicionar"
   * antigo criava +1 km a R$ 10 — depois de uma faixa de R$ 12, uma entrega
   * MAIS LONGE saía mais barata e ninguém via.
   */
  const addZone = () => {
    const validas = ordenarFaixas(faixas).filter((f) => f.km != null && f.km > 0);
    const ultima = validas[validas.length - 1];
    const penultima = validas[validas.length - 2];
    const passo = ultima && penultima ? Math.round(((ultima.km as number) - (penultima.km as number)) * 100) / 100 : 1;
    const km = Math.round(((ultima?.km ?? 0) + (passo > 0 ? passo : 1)) * 100) / 100;
    const nova: FaixaNaTela = {
      id: novoId("f"),
      km,
      time: ultima?.time ?? 45,
      fee: ultima?.fee ?? 5,
      motoboyFee: repassePorFaixa ? (ultima?.motoboyFee ?? null) : null,
    };
    setFaixas((prev) => [...prev, nova]);
    setFocarNaFaixa(nova.id);
  };

  const removeZone = (id: string) => setFaixas((prev) => prev.filter((f) => f.id !== id));

  const updateZone = (id: string, campo: "km" | "time" | "fee" | "motoboyFee", valor: number | null) => {
    setFaixas((prev) => prev.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)));
  };

  /**
   * Ao SAIR do campo de km a lista entra em ordem — nunca durante a digitação.
   * Mover o cartão tira o foco do campo para onde a pessoa acabou de ir (o
   * navegador perde o foco de um nó reinserido); ele é devolvido no quadro
   * seguinte.
   */
  const ordenarAoSair = (e: React.FocusEvent<HTMLInputElement>) => {
    const destino = e.relatedTarget as HTMLElement | null;
    setFaixas((prev) => {
      const ordenadas = ordenarFaixas(prev);
      return mesmaOrdem(prev, ordenadas) ? prev : ordenadas;
    });
    requestAnimationFrame(() => {
      if (destino && destino.isConnected && document.activeElement !== destino) destino.focus();
    });
  };

  const aplicarAtalhoDoRepasse = () => {
    const desconto = descontoDoAtalho ?? 0;
    const aplicar = <T extends { fee: number | null }>(lista: T[], campo: "motoboyFee" | "repasse") =>
      lista.map((z) => (z.fee == null ? z : { ...z, [campo]: repasseDescontado(z.fee, desconto) }));
    if (porDistancia) setFaixas((prev) => aplicar(prev, "motoboyFee"));
    else if (porBairro) setBairros((prev) => aplicar(prev, "motoboyFee"));
    else if (porDesenho) setAreasDeEntrega((prev) => aplicar(prev, "repasse"));
  };

  /**
   * O "Ajuste rápido" do iFood: −5/+5 min e −R$ 1/+R$ 1 em TODAS as linhas do
   * método ativo de uma vez. Linha vazia continua vazia (vazio não é zero).
   * O tempo não desce de 5 min nem a taxa de zero. Vale para o cliente só
   * depois do Salvar, como qualquer outra mudança da tela.
   */
  const ajustarTodos = (campo: "time" | "fee", passo: number) => {
    const ajustar = <T extends { time: number | null; fee: number | null }>(lista: T[]): T[] =>
      lista.map((z) => {
        const atual = z[campo];
        if (atual == null) return z;
        const novo = campo === "time" ? Math.max(5, Math.round(atual + passo)) : Math.max(0, Math.round((atual + passo) * 100) / 100);
        return novo === atual ? z : { ...z, [campo]: novo };
      });
    if (porDistancia) setFaixas(ajustar);
    else if (porBairro) setBairros(ajustar);
    else if (porDesenho) setAreasDeEntrega(ajustar);
  };

  /** O mesmo tempo em todas as linhas — o ponto de partida de quem tem 55 bairros. */
  const aplicarTempoParaTodos = () => {
    if (tempoParaTodos == null || tempoParaTodos <= 0) return;
    const t = Math.round(tempoParaTodos);
    if (porDistancia) setFaixas((prev) => prev.map((z) => ({ ...z, time: t })));
    else if (porBairro) setBairros((prev) => prev.map((z) => ({ ...z, time: t })));
    else if (porDesenho) setAreasDeEntrega((prev) => prev.map((z) => ({ ...z, time: t })));
  };

  const adicionarBairro = () => {
    const novo: BairroNaTela = { id: novoId("b"), name: "", time: bairros[bairros.length - 1]?.time ?? 40, fee: null, motoboyFee: null };
    setBairros((prev) => [...prev, novo]);
    setBuscaDoBairro("");
    setFocarNoBairro(novo.id);
    setAba("cadastro");
  };

  /** Bairro bate com a busca? Sem acento e sem caixa; o bairro em branco (sendo digitado) aparece sempre. */
  const bairroNaBusca = (nome: string) => {
    const q = buscaDoBairro.trim();
    if (!q || !nome.trim()) return true;
    const limpar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return limpar(nome).includes(limpar(q));
  };

  /** Rótulo em cima do campo: é o que evita cabeçalho de coluna espremido. */
  // `maxWidth` para o campo que sobra na quebra de linha não esticar sozinho
  // até a largura toda, ficando gigante embaixo de campos pequenos.
  const campoDaFaixa: React.CSSProperties = { display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 3, flex: "1 1 70px", minWidth: 70, maxWidth: 150 };
  // O rótulo QUEBRA em vez de não quebrar: com `nowrap`, rótulo mais largo
  // que o campo vazava para fora do cartão.
  const rotuloDoCampo: React.CSSProperties = { fontSize: "0.72rem", fontWeight: 700, color: "#334155", lineHeight: 1.25, letterSpacing: "-0.01em" };

  // ── A LISTA DO MÉTODO ATIVO, COMO VAI PARA O SERVIDOR ─────────────────────
  //
  // A tela valida com a MESMA função que o servidor usa (lib/cadastro-da-
  // entrega.ts) — o que passa aqui passa lá. A única regra a mais é a do
  // repasse ligado: com "um valor por faixa", faixa em branco é erro mesmo que
  // todas estejam em branco.
  type ItemDaLista = { id: string; rotulo: string; fee: number | null; repasse: number | null };
  const itensDaLista: ItemDaLista[] = porDistancia
    ? faixas.map((f) => ({ id: f.id, rotulo: f.km != null ? `até ${formatarKm(f.km)} km` : "faixa sem km", fee: f.fee, repasse: f.motoboyFee }))
    : porBairro
      // Linha de bairro sem nome não é bairro: sai no salvar (com aviso) e não
      // conta para taxa zero nem para o valor do motoboy.
      ? bairros.filter((b) => b.name.trim()).map((b) => ({ id: b.id, rotulo: b.name.trim(), fee: b.fee, repasse: b.motoboyFee }))
      : areasDeEntrega.map((a) => ({ id: a.id, rotulo: a.nome, fee: a.fee, repasse: a.repasse }));

  const montarLista = (confirmarRepasseAcima: boolean): unknown[] => {
    const marcar = (fee: number | null, repasse: number | null) =>
      confirmarRepasseAcima && repassePorFaixa && fee != null && repasse != null && repasse > fee ? { repasseAcimaDaTaxa: true } : {};
    if (porDistancia) {
      return ordenarFaixas(faixas).map((f) => ({ ...faixaParaSalvar(f, repassePorFaixa), ...marcar(f.fee, f.motoboyFee) }));
    }
    if (porBairro) {
      return bairros.map((b) => ({
        name: b.name, time: b.time, fee: b.fee,
        ...(repassePorFaixa && b.motoboyFee != null ? { motoboyFee: b.motoboyFee } : {}),
        ...marcar(b.fee, b.motoboyFee),
      }));
    }
    return areasDeEntrega.map((a) => ({
      nome: a.nome, pontos: a.pontos, time: a.time, fee: a.fee,
      ...(repassePorFaixa && a.repasse != null ? { repasse: a.repasse } : {}),
      ...marcar(a.fee, a.repasse),
    }));
  };

  /** O id do item de cada índice da lista montada (faixas vão em ordem de km). */
  const idsDaLista = (): string[] =>
    porDistancia ? ordenarFaixas(faixas).map((f) => f.id) : porBairro ? bairros.map((b) => b.id) : areasDeEntrega.map((a) => a.id);

  const validacao = useMemo(() => {
    const resultado = normalizarCadastroDeEntrega(currentZoneType, montarLista(true));
    const ids = idsDaLista();
    const porId = new Map<string, Set<string>>();
    const marcar = (id: string | undefined, campo: string) => {
      if (!id) return;
      if (!porId.has(id)) porId.set(id, new Set());
      porId.get(id)!.add(campo);
    };
    const erros: string[] = [];
    for (const p of resultado.problemas as Problema[]) {
      if (p.nivel !== "erro") continue;
      erros.push(p.mensagem);
      marcar(ids[p.indice], p.campo);
    }
    // Repasse ligado: todas precisam de valor, inclusive quando todas estão vazias.
    const semRepasse = repassePorFaixa ? itensDaLista.filter((x) => x.repasse == null) : [];
    if (repassePorFaixa && semRepasse.length === itensDaLista.length && itensDaLista.length > 0) {
      for (const x of semRepasse) {
        erros.push(`${x.rotulo}: falta quanto o motoboy recebe (use 0 se ele não recebe nada).`);
        marcar(x.id, "motoboyFee");
      }
    }
    return { resultado, erros, porId, semRepasse: semRepasse.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentZoneType, faixas, bairros, areasDeEntrega, repassePorFaixa]);

  const campoComErro = (id: string, campo: string) => mostrarErros && !!validacao.porId.get(id)?.has(campo);

  // ── SALVAR ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setAvisoDoPainel(null);
    if (!latLng) {
      setAvisoDoPainel({ tipo: "aviso", texto: "Selecione a localização da sua loja no mapa primeiro." });
      return;
    }
    // A ordem da tela passa a ser a de verdade antes de qualquer pergunta.
    if (porDistancia) setFaixas((prev) => (mesmaOrdem(prev, ordenarFaixas(prev)) ? prev : ordenarFaixas(prev)));

    if (porDesenho && areasDeEntrega.length === 0) {
      setAvisoDoPainel({ tipo: "aviso", texto: "Desenhe pelo menos uma área de entrega no mapa antes de salvar." });
      return;
    }

    if (validacao.erros.length > 0) {
      setMostrarErros(true);
      // Até 8 linhas, e o que não coube é contado (listaDoAviso): cortar
      // calado escondia a 9ª faixa da Divinos.
      setAvisoDoPainel({ tipo: "erro", texto: "Não salvei. Corrija os campos em vermelho:", lista: listaDoAviso(validacao.erros, 8) });
      // O campo vermelho tem que estar à vista: tempo e taxa estão nas duas
      // abas; nome, km e motoboy só no cadastro. E a busca não pode escondê-lo.
      const soTempoETaxa = [...validacao.porId.values()].every((campos) => [...campos].every((c) => c === "time" || c === "fee"));
      if (!soTempoETaxa) setAba("cadastro");
      else if (aba === "configurar") setAba("tempo");
      setBuscaDoBairro("");
      return;
    }
    const cadastro = validacao.resultado;
    const rotuloDoItem = porDistancia ? "faixas" : porBairro ? "bairros" : "áreas";
    // "Estes bairros", "Estas faixas/áreas".
    const estas = porBairro ? "Estes" : "Estas";

    // ── Taxa ZERO é a armadilha que originou esta tela ────────────────────
    //
    // A R&D Pizzaria tinha as três faixas de KM cadastradas com R$ 0,00 e
    // descobriu entregando de graça a 10 km. A confirmação existia só para a
    // área desenhada; agora vale para faixa, bairro e área. Zero de propósito
    // existe (entrega grátis) — mas tem que ser dito em voz alta.
    //
    // Cada confirmação vale uma vez por situação: a loja que disse "sim, até
    // 1 km é grátis" não precisa dizer de novo a cada Salvar. Muda a faixa ou
    // o valor, a pergunta volta.
    const perguntar = (chaves: string[], texto: string): boolean => {
      if (chaves.every((k) => confirmados.current.has(k))) return true;
      if (!window.confirm(texto)) return false;
      chaves.forEach((k) => confirmados.current.add(k));
      return true;
    };
    const deGraca = itensDaLista.filter((x) => x.fee === 0);
    if (deGraca.length > 0 && !perguntar(
      deGraca.map((x) => `zero:${currentZoneType}:${x.rotulo}`),
      `${estas} ${rotuloDoItem} estão com taxa R$ 0,00 (entrega grátis para o cliente):\n\n• ${deGraca.map((x) => x.rotulo).join("\n• ")}\n\n` +
      `Se for de propósito, tudo bem. Se não, cancele e preencha a taxa. Salvar assim?`,
    )) return;

    // Motoboy recebendo mais do que o cliente paga: a loja cobre a diferença
    // em cada entrega. Comum com entrega grátis; perigoso quando é um "14"
    // digitado no lugar de "4".
    if (repassePorFaixa) {
      const acima = itensDaLista.filter((x) => x.fee != null && x.repasse != null && x.repasse > x.fee);
      if (acima.length > 0 && !perguntar(
        acima.map((x) => chaveDoRepasseAcima(currentZoneType, x.rotulo, x.fee as number, x.repasse as number)),
        `N${estas.toLowerCase()} ${rotuloDoItem} o motoboy recebe MAIS do que o cliente paga — a loja cobre a diferença:\n\n` +
        acima.map((x) => `• ${x.rotulo}: cliente ${formatarReais(x.fee as number)}, motoboy ${formatarReais(x.repasse as number)}`).join("\n") +
        `\n\nÉ de propósito (por exemplo, entrega grátis com o motoboy pago)? Salvar assim?`,
      )) return;
    }

    // Avisos que não bloqueiam, mas quase sempre são engano (faixa mais longe
    // mais barata, bairro em branco que vai sumir).
    if (cadastro.avisos.length > 0 && !perguntar(
      cadastro.avisos.map((a) => `aviso:${a}`),
      `Confira antes de salvar:\n\n• ${cadastro.avisos.join("\n• ")}\n\nSalvar assim?`,
    )) return;

    // ── Trocar de método APAGA o cadastro do outro ────────────────────────
    //
    // `deliveryZones` é uma coluna só: salvar em raio grava as faixas por cima
    // dos contornos (ou dos bairros), e o outro cadastro some do banco sem
    // cópia em lugar nenhum. Quem clicou em "Por raio" só para ver como ficaria
    // perdia as 4 áreas — ou os 44 bairros.
    //
    // Só avisa a perda do que está GRAVADO (`salvo.temCadastro`): a tabela de
    // exemplo da loja nova não é cadastro de ninguém. As áreas desenhadas
    // contam mesmo sem salvar — são o trabalho que a pessoa fez nesta tela.
    const perdas: string[] = [];
    // O desenho que a loja levou como contorno de onde entrega (trocarMetodo)
    // não se perde: continua no mapa, agora como limite por cima da tabela.
    const desenhoVirouContorno = areasDeEntrega.length > 0 && areasDeEntrega.every((a) => limites.some((l) => l.pontos === a.pontos));
    if (!porDesenho && areasDeEntrega.length > 0 && !desenhoVirouContorno) perdas.push(`${areasDeEntrega.length} área(s) desenhada(s) no mapa`);
    if (!porBairro && salvo.temCadastro && salvo.tipo === "NEIGHBORHOOD" && bairros.some((b) => b.name.trim())) perdas.push(`${bairros.filter((b) => b.name.trim()).length} bairro(s) cadastrado(s)`);
    if (!porDistancia && salvo.temCadastro && (salvo.tipo === "KM" || salvo.tipo === "ROTA") && faixas.length > 0) perdas.push(`${faixas.length} faixa(s) de distância`);
    if (perdas.length > 0) {
      const ok = window.confirm(
        `Você tem ${perdas.join(" e ")}.\n\n` +
        `Salvar em "${nomeDoMetodo(currentZoneType)}" APAGA esse cadastro. Continuar?`
      );
      if (!ok) return;
    }

    // ── O que está no banco não se lê: gravar por cima só com o sim da loja ──
    if (ilegivelNoBanco && !window.confirm(
      "O cadastro de entrega gravado da sua loja está num formato que esta tela não consegue ler — por isso ela abriu com uma tabela de exemplo.\n\n" +
      `Salvar agora GRAVA as ${rotuloDoItem} desta tela no lugar do que está no banco. Se a sua loja já cobrava a entrega por uma tabela, cancele e fale com o suporte antes.\n\nContinuar?`,
    )) return;

    // ── A tabela de EXEMPLO não vira a da loja sem ela dizer ─────────────
    //
    // Loja sem cadastro abre com 1/3/5 km a R$ 5/8/12 (ou "Centro"/"Bairro
    // Vizinho"). Quem só marcou o pino e salvou publicava esses valores como
    // a taxa dela, sem nunca ter olhado.
    //
    // Vale também para quem troca de método: a loja de bairros que passa para
    // "Por raio" recebe as faixas de exemplo, não as dela.
    const gravadoNesteMetodo = salvo.temCadastro && (porDistancia ? salvo.tipo === "KM" || salvo.tipo === "ROTA" : salvo.tipo === currentZoneType);
    const aindaOExemplo = !gravadoNesteMetodo && !ilegivelNoBanco && (
      porDistancia
        ? JSON.stringify(ordenarFaixas(faixas).map((f) => [f.km, f.fee, f.time])) === JSON.stringify(FAIXAS_DE_EXEMPLO.map((f) => [f.km, f.fee, f.time]))
        : porBairro
          ? JSON.stringify(bairros.filter((b) => b.name.trim()).map((b) => [b.name.trim(), b.fee, b.time])) === JSON.stringify(BAIRROS_DE_EXEMPLO.map((b) => [b.name, b.fee, b.time]))
          : false
    );
    if (aindaOExemplo && !perguntar(
      [`exemplo:${currentZoneType}`],
      `${estas} ${rotuloDoItem} são o EXEMPLO que a tela trouxe, não valores da sua loja:\n\n` +
      `• ${itensDaLista.map((x) => `${x.rotulo}: ${x.fee != null ? formatarReais(x.fee) : "sem taxa"}`).join("\n• ")}\n\n` +
      `É isso que o cliente vai pagar. Salvar com esses valores?`,
    )) return;

    setSaving(true);
    try {
      await onSave({
        storeLatLng: latLng,
        deliveryZones: cadastro.zonas,
        deliveryZoneType: cadastro.tipo || currentZoneType,
        ...(trocarEndereco ? { storeAddress: address.trim() } : {}),
        areasDeRisco,
        limiteDeAtendimento: limites,
      });

      // ── CONFERÊNCIA NO BANCO ──────────────────────────────────────────
      //
      // O salvar passa pelo formulário da loja, que não olha o status da
      // resposta: um "não salvei" do servidor (400, ou 500 com JSON) voltava
      // aqui como sucesso. O que vale é o que ficou gravado.
      const gravado = await lerCadastroGravado();
      if (gravado) {
        const tipoGravado = String(gravado.deliveryZoneType || "").toUpperCase();
        const tipoMandado = String(cadastro.tipo || currentZoneType).toUpperCase();
        if (tipoGravado !== tipoMandado || !mesmoCadastro(gravado.deliveryZones, cadastro.zonas)) {
          setAvisoDoPainel({
            tipo: "erro",
            texto: "O servidor não gravou a área de entrega — para os clientes nada mudou. Confira os campos e salve de novo; se continuar, recarregue a página.",
          });
          return;
        }
      }

      // A escolha "um valor por faixa" mora no deliveryConfig, que a rota
      // mescla campo a campo — manda só o `separado`, sem mexer na regra do
      // app que a aba Motoboys decide. Vai DEPOIS da conferência: sem as
      // faixas gravadas, ligar o repasse por faixa não teria valor nenhum.
      //
      // Só vai o que a loja ESCOLHEU (clicou numa das opções). O palpite com
      // que a tela abre (ligada quando há valores nas faixas) nunca é gravado:
      // com o GET do carregamento fora do ar, ele ligava o repasse por faixa
      // de uma loja que tinha desligado (lib/cadastro-da-entrega.ts,
      // escolhaDoRepasseParaGravar).
      let avisoDoRepasse = "";
      const escolha = escolhaDoRepasseParaGravar({
        lidaAoAbrir: separadoNoServidor,
        lidaAgora: gravado?.repasseDoEntregador ? gravado.repasseDoEntregador.separado === true : null,
        naTela: repassePorFaixa,
        lojaEscolheu: mexeuNoRepasse.current,
      });
      if (escolha.gravada !== null) setSeparadoNoServidor(escolha.gravada);
      if (escolha.mandar !== null) {
        try {
          const r = await fetch("/api/store-settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repasseDoEntregador: { separado: escolha.mandar } }),
          });
          if (!r.ok) throw new Error(String(r.status));
          setSeparadoNoServidor(escolha.mandar);
        } catch {
          avisoDoRepasse = " Mas não consegui gravar a escolha de como o motoboy recebe — salve de novo.";
        }
      } else if (escolha.naoLida) {
        avisoDoRepasse = " Não consegui ler como o motoboy recebe hoje, então essa escolha ficou como estava gravada.";
      } else if (escolha.telaPassaA !== repassePorFaixa) {
        setRepassePorFaixa(escolha.telaPassaA);
        // A tela agora segue o gravado nos dois sentidos: o aviso diz qual.
        avisoDoRepasse = escolha.telaPassaA
          ? " Como o motoboy recebe ficou como estava gravado (um valor por faixa) — preencha \"Motoboy recebe\" em cada faixa e salve de novo."
          : " Como o motoboy recebe ficou como estava gravado (pelo acerto de cada entregador) — confira acima e salve de novo se quiser mudar.";
      }

      if (trocarEndereco) {
        setEnderecoSalvo(address.trim());
        setUsarEndereco(null);
      }
      setSalvo({ tipo: currentZoneType, faixas: retratoDasFaixas(faixas, repassePorFaixa), ponto: latLng, temCadastro: true });
      setIlegivelNoBanco(false);
      setMostrarErros(false);
      setTabelaGravada(retratoDaTabela);
      // A linha de bairro em branco não foi gravada: some da tela também.
      if (porBairro) setBairros((prev) => (prev.some((b) => !b.name.trim()) ? prev.filter((b) => b.name.trim()) : prev));
      if (!repassePorFaixa) {
        // Os valores escondidos foram embora no salvar; a tela passa a refletir isso.
        setFaixas((prev) => prev.map((f) => (f.motoboyFee == null ? f : { ...f, motoboyFee: null })));
        setBairros((prev) => prev.map((b) => (b.motoboyFee == null ? b : { ...b, motoboyFee: null })));
        setAreasDeEntrega((prev) => prev.map((a) => (a.repasse == null ? a : { ...a, repasse: null })));
      }
      setAvisoDoPainel(avisoDoRepasse
        ? { tipo: "aviso", texto: `Área de entrega salva.${avisoDoRepasse}` }
        : { tipo: "ok", texto: "Configurações de entrega salvas." });
    } catch (err: any) {
      setAvisoDoPainel({ tipo: "erro", texto: `Não consegui salvar${err?.message ? `: ${err.message}` : "."}` });
    } finally {
      setSaving(false);
    }
  };

  // ── SIMULADOR ─────────────────────────────────────────────────────────────
  //
  // A loja que troca de raio para km percorrido não tem como saber, olhando
  // círculos, que o centro de Cabo Frio fica a 3,43 km em linha reta e a 5,69
  // pela rua — e que a tabela 1/3/5 km dela passa a dizer "FORA" para metade
  // da cidade. O simulador pergunta ao MESMO /api/delivery-fee que o cardápio
  // usa (sem franchiseeId, a rota resolve a loja pela sessão do painel): o que
  // aparece aqui é o que o cliente veria.
  const [simRua, setSimRua] = useState("");
  const [simNumero, setSimNumero] = useState("");
  const [simBairro, setSimBairro] = useState("");
  const [simulando, setSimulando] = useState(false);
  const [simulacao, setSimulacao] = useState<Simulacao | null>(null);
  const [simErro, setSimErro] = useState("");
  const simControle = useRef<AbortController | null>(null);
  const simuladorRef = useRef<HTMLDivElement>(null);

  const simular = async () => {
    const rua = simRua.trim(), numero = simNumero.trim(), bairro = simBairro.trim();
    if (!rua && !bairro) { setSimErro("Digite pelo menos a rua ou o bairro."); return; }
    const consulta = [rua && `${rua}${numero ? `, ${numero}` : ""}`, bairro].filter(Boolean).join(" - ");
    await pedirCotacao(new URLSearchParams({ street: rua, number: numero, neighborhood: bairro, address: consulta }), consulta);
  };

  // Tocar no mapa: o ponto vai como pino do cliente — o mesmo que o cliente
  // faz no cardápio ao arrastar o pino —, sem passar pela busca de endereço.
  const simularNoPonto = async (lat: number, lng: number) => {
    // O resultado mora na aba "Tempo e taxa": tocar no mapa com outra aberta
    // simulava sem mostrar nada.
    setAba("tempo");
    if (typeof window !== "undefined" && window.innerWidth > 1080) {
      requestAnimationFrame(() => simuladorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    }
    await pedirCotacao(
      new URLSearchParams({ lat: String(lat), lng: String(lng), origem: "pino" }),
      "Ponto marcado no mapa",
    );
  };
  simularNoPontoRef.current = porBairro ? null : (lat, lng) => { simularNoPonto(lat, lng); };

  const pedirCotacao = async (qs: URLSearchParams, consulta: string) => {
    simControle.current?.abort();
    const controle = new AbortController();
    simControle.current = controle;
    setSimulando(true);
    setSimErro("");
    const alterada = currentZoneType !== salvo.tipo || pontoMudou || faixasMudaram;
    try {
      const r = await fetch(`/api/delivery-fee?${qs.toString()}`, { signal: controle.signal, cache: "no-store" });
      if (controle.signal.aborted) return;
      if (r.status === 429) { setSimErro("Muitas simulações seguidas. Espere alguns segundos e tente de novo."); return; }
      const dados: RespostaDaCotacao | null = await r.json().catch(() => null);
      if (controle.signal.aborted) return;
      if (!r.ok || !dados) { setSimErro(dados?.error || "Não consegui simular agora. Tente de novo."); return; }
      setSimulacao({ ...dados, consulta, feitaCom: { tipoSalvo: salvo.tipo, alterada, separado: separadoNoServidor } });
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setSimErro("Não consegui simular agora (sem conexão?).");
    } finally {
      if (simControle.current === controle) setSimulando(false);
    }
  };

  // O ponto que decidiu a taxa, no mapa: é o jeito de a loja ver que "Braga"
  // caiu numa praia a 351 m da rua, ou que o mapa achou a rua homônima do
  // outro lado do canal.
  useEffect(() => {
    const ref = leafletMapRef.current;
    if (!ref) return;
    const { map, L } = ref;
    if (simMarcadorRef.current) { map.removeLayer(simMarcadorRef.current); simMarcadorRef.current = null; }
    const p = simulacao?.ponto;
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
    const marcador = L.circleMarker([p.lat, p.lng], { radius: 9, color: "#1D4ED8", weight: 3, fillColor: "#60A5FA", fillOpacity: 0.9 }).addTo(map);
    const dist = simulacao?.distanceKm != null ? ` · ${formatarKm(simulacao.distanceKm)} km${simulacao.medida === "rota" ? " pela rua" : simulacao.medida === "estimada" ? " (estimada)" : ""}` : "";
    marcador.bindTooltip(`🧪 Cliente simulado${dist}`, { permanent: true, direction: "top", offset: [0, -8] });
    simMarcadorRef.current = marcador;
    try {
      const alvo = L.latLng(p.lat, p.lng);
      if (!map.getBounds().contains(alvo)) {
        const pontos = latLng ? [[latLng.lat, latLng.lng], [p.lat, p.lng]] : [[p.lat, p.lng]];
        const largo = typeof window !== "undefined" && window.innerWidth > 1080;
        map.fitBounds(pontos, { paddingTopLeft: [60, 60], paddingBottomRight: [largo ? 440 : 40, 60], maxZoom: 15 });
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulacao, mapaPronto]);

  // ── O CAMINHO PELA RUA, COMO NO GOOGLE ────────────────────────────────────
  //
  // No km percorrido os círculos são linha reta: atravessam rio, muro e mar, e
  // a loja não tinha como ver por onde a moto passa. A Deeds (Londrina,
  // 01/10/2026) achou "3 km no raio muito longo" porque o Google dava 4,7 km
  // pela rua. Aqui o simulador desenha o caminho da loja até o cliente.
  // O número que vale continua sendo o da cotação (mesma régua do cardápio);
  // o desenho é para ver por onde.
  const [caminho, setCaminho] = useState<{ pontos: [number, number][]; km: number } | null>(null);
  const [caminhoErro, setCaminhoErro] = useState("");
  useEffect(() => {
    setCaminho(null);
    setCaminhoErro("");
    const p = simulacao?.ponto;
    if (!porRota || !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
    const controle = new AbortController();
    fetch(`/api/store/desenho-da-rota?lat=${p.lat}&lng=${p.lng}`, { signal: controle.signal, cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (controle.signal.aborted) return;
        if (r.ok && Array.isArray(d?.pontos) && d.pontos.length >= 2) setCaminho({ pontos: d.pontos, km: Number(d.km) });
        else setCaminhoErro(d?.error || "Não consegui desenhar o caminho agora.");
      })
      .catch((e) => { if (e?.name !== "AbortError") setCaminhoErro("Não consegui desenhar o caminho agora."); });
    return () => controle.abort();
  }, [simulacao, porRota]);

  useEffect(() => {
    const ref = leafletMapRef.current;
    if (!ref) return;
    const { map, L } = ref;
    if (simCaminhoRef.current) { map.removeLayer(simCaminhoRef.current); simCaminhoRef.current = null; }
    if (!caminho) return;
    // Contorno branco por baixo da linha azul: aparece em cima de qualquer
    // mancha de faixa, como a rota do Google.
    const grupo = L.layerGroup([
      L.polyline(caminho.pontos, { color: "#ffffff", weight: 9, opacity: 0.95, interactive: false }),
      L.polyline(caminho.pontos, { color: "#1D4ED8", weight: 5, opacity: 0.95, interactive: false }),
    ]).addTo(map);
    simCaminhoRef.current = grupo;
    try {
      const largo = typeof window !== "undefined" && window.innerWidth > 1080;
      map.fitBounds(L.latLngBounds(caminho.pontos), { paddingTopLeft: [60, 60], paddingBottomRight: [largo ? 440 : 40, 60], maxZoom: 16 });
    } catch {}
  }, [caminho, mapaPronto]);

  const limparSimulacao = () => {
    simControle.current?.abort();
    setSimulacao(null);
    setSimErro("");
    setSimulando(false);
  };

  /** A faixa da tabela que está NA TELA (ainda não salva), para a mesma distância. */
  const previaComATabelaDaTela = (() => {
    if (!simulacao || simulacao.distanceKm == null || !porDistancia) return null;
    // Só compara quando a distância que voltou é a mesma que valeria com a
    // tela: mesmo método e mesmo pino. Trocar raio por rota muda a distância,
    // não só a faixa.
    if (simulacao.feitaCom.tipoSalvo !== currentZoneType || pontoMudou || !faixasMudaram) return null;
    const lista = ordenarFaixas(faixas)
      .filter((f) => f.km != null && f.fee != null)
      .map((f) => ({ km: f.km as number, fee: f.fee as number, time: f.time ?? undefined, motoboyFee: repassePorFaixa ? f.motoboyFee : null }));
    // A distância só vale para outra tabela quando foi medida sem depender da
    // salva (em ROTA o servidor só vai à rua até a última faixa SALVA), e o
    // ponto tem que decidir alguma coisa: palpite do mapa e área de risco não
    // têm faixa (lib/cadastro-da-entrega.ts, previaDaTabelaDaTela). A área de
    // risco é a desta tela, que é a que valerá depois de salvar.
    const naAreaDeRisco = !!areaDeRiscoDoPonto(simulacao.ponto ?? null, areasDeRisco);
    // O contorno de onde a loja entrega, também o desta tela.
    const foraDoLimite = !!foraDoLimiteDeAtendimento(simulacao.ponto ?? null, limites);
    return previaDaTabelaDaTela(currentZoneType, simulacao, lista, naAreaDeRisco, foraDoLimite);
  })();

  // ── Textos que dependem do método ─────────────────────────────────────────
  const unidade = porDistancia ? "faixa" : porBairro ? "bairro" : "área";
  const unidades = porDistancia ? "faixas" : porBairro ? "bairros" : "áreas";
  const valoresEscondidos = !repassePorFaixa && itensDaLista.some((x) => x.repasse != null);
  const faixasComKm = faixas.filter((z) => z.km != null && z.km > 0);
  const numerosDasFaixas = (campo: "km" | "time" | "fee") => faixasComKm.map((z) => z[campo]).filter((n): n is number => n != null);

  const naoSalvo = retratoDaTabela !== tabelaGravada || pontoMudou;

  const corDoAviso = (tipo: "ok" | "erro" | "aviso") =>
    tipo === "ok" ? { bg: "#F0FDFA", fg: "#0F766E", bd: "#99F6E4" } : tipo === "aviso" ? { bg: "#FFF7E6", fg: "#B45309", bd: "#FDE68A" } : { bg: "#FEF2F2", fg: "#B71C1C", bd: "#FECACA" };

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      <h3 style={{ fontWeight: 800, fontSize: "1.3rem", marginBottom: "4px" }}>🗺️ Configurações de Entrega</h3>
      <p style={{ color: "#64748B", fontSize: "0.88rem", marginBottom: "0.8rem" }}>
        Defina onde fica sua loja no mapa e escolha a regra de cobrança da entrega.
      </p>

      {/* Entrega por bairros: a equipe cadastra a lista no mesmo dia. */}
      <MandeSeusBairros temAreaCadastrada={zonasIniciais.length > 0} nomeDaLoja={nomeDaLoja} />

      {msg && (
        <div style={{ padding: "10px 14px", borderRadius: "8px", marginBottom: "1rem",
          background: msg.startsWith("✅") ? "#F0FDFA" : msg.startsWith("⚠") ? "#FFF7E6" : "#fef2f2",
          color: msg.startsWith("✅") ? "#0F766E" : msg.startsWith("⚠") ? "#b45309" : "#C92E09",
          border: `1px solid ${msg.startsWith("✅") ? "#99F6E4" : msg.startsWith("⚠") ? "#fde68a" : "#fecaca"}`,
          fontSize: "0.85rem" }}>
          {msg}
        </div>
      )}

      {/* Address search with autocomplete */}
      <div style={{ display: "flex", gap: "8px", marginBottom: enderecoMudou ? "0.5rem" : "1rem", position: "relative" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <MapPin size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }} />
          <input
            value={address}
            onChange={e => handleAddressChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onKeyDown={e => e.key === "Enter" && geocodeAddress()}
            placeholder="Digite o endereço da sua loja (ex: Rua, Número, Bairro, Cidade)"
            style={{ width: "100%", padding: "10px 14px 10px 36px", borderRadius: "10px", border: "1px solid #E2E8F0", fontSize: "0.85rem", outline: "none", boxSizing: "border-box" }}
          />
          {showSuggestions && suggestions.length > 0 && (
            <div style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              background: "#fff",
              borderRadius: "10px",
              border: "1px solid #E2E8F0",
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              zIndex: 2000,
              maxHeight: "220px",
              overflowY: "auto"
            }}>
              {suggestions.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => selectSuggestion(item)}
                  style={{
                    padding: "10px 14px",
                    fontSize: "0.83rem",
                    color: "#1E293B",
                    cursor: "pointer",
                    borderBottom: idx < suggestions.length - 1 ? "1px solid #F1F5F9" : "none",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
                  onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
                >
                  <MapPin size={14} style={{ color: "#C92E09", flexShrink: 0 }} />
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.display_name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={geocodeAddress} disabled={searching}
          style={{ padding: "10px 16px", borderRadius: "10px", background: "#1E293B", color: "#fff", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, fontSize: "0.85rem", fontFamily: "inherit", flexShrink: 0 }}>
          {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {searching ? "Buscando..." : "Localizar"}
        </button>
      </div>

      {/* O texto do campo acima é a BUSCA do ponto. Ele só vira o endereço da
          loja (cardápio e comanda) quando a loja marca aqui. */}
      {enderecoMudou && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: "1rem", padding: "8px 11px", borderRadius: 9, background: "#F8FAFC", border: "1px solid #E2E8F0", fontSize: "0.78rem", color: "#334155", lineHeight: 1.45, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={trocarEndereco}
            onChange={(e) => setUsarEndereco(e.target.checked)}
            style={{ width: 16, height: 16, marginTop: 1, accentColor: "#0F766E", flexShrink: 0 }}
          />
          <span>
            Usar este texto como <b>endereço da loja</b> (aparece no cardápio e na comanda).
            {enderecoSalvo.trim()
              ? <> Hoje está: <i>“{enderecoSalvo}”</i>. Desmarcado, o salvar muda só o ponto no mapa.</>
              : <> A loja ainda não tem endereço no cadastro.</>}
          </span>
        </label>
      )}

      {/* ── MAPA ABERTO COM O PAINEL FLUTUANDO ───────────────────────────
          O desenho que o lojista já conhece do iFood. O mapa espremido numa
          coluna de 420px não mostrava a área de entrega inteira, que é
          justamente o que esta tela existe para mostrar. */}
      <div className="fh-entrega-area">
        <div className="fh-entrega-mapa">
          <div ref={mapRef} style={{ width: "100%", height: "100%" }} />

          {/* ── AMPLIAR / DIMINUIR ────────────────────────────────────────
              Na borda esquerda, longe do painel que flutua à direita. */}
          <div className="fh-zoom">
            <button
              type="button"
              onClick={() => { try { leafletMapRef.current?.map.zoomIn(); } catch {} }}
              title="Ampliar o mapa (aproximar)"
              aria-label="Ampliar o mapa"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => { try { leafletMapRef.current?.map.zoomOut(); } catch {} }}
              title="Diminuir o mapa (afastar)"
              aria-label="Diminuir o mapa"
            >
              −
            </button>
          </div>

          {/* Confirm button & address preview overlay */}
          {latLng && !confirmed && (
            <div className="fh-confirmar-pino">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "0.68rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px" }}>
                  📍 Endereço no pino:
                </div>
                <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#0F172A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {address || "Localização selecionada"}
                </div>
              </div>
              <button onClick={confirmLocation}
                style={{ padding: "8px 14px", background: "#C92E09", color: "#fff", border: "none", borderRadius: "8px", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", fontFamily: "inherit", flexShrink: 0 }}>
                <Check size={14} /> Confirmar local
              </button>
            </div>
          )}

          {/* Os dois selos ficam juntos à ESQUERDA: com o painel flutuando à
              direita, o "Editar Endereço" ia parar atrás dele. */}
          {confirmed && (
            <div style={{ position: "absolute", top: "12px", left: "12px", zIndex: 1000, display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <div style={{ background: "#fff", borderRadius: "8px", padding: "6px 12px", fontSize: "0.8rem", fontWeight: 700, color: "#0F766E", border: "1px solid #99F6E4", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
                <Check size={14} /> Localização confirmada
              </div>
              <button onClick={startEditingAddress}
                style={{ background: "#fff", borderRadius: "8px", padding: "6px 12px", fontSize: "0.78rem", fontWeight: 700, color: "#C92E09", border: "1px solid #FCA5A5", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)", fontFamily: "inherit" }}>
                <Pencil size={13} /> Editar Endereço
              </button>
            </div>
          )}

          {/* ── O QUE FAZER NESTE MAPA ─────────────────────────────────────
              Tocar no mapa para simular era uma linha perdida no simulador;
              o dono pediu "algo em cima bem claro" (01/10/2026). */}
          {confirmed && porDistancia && (
            <div className="fh-dica-do-mapa">
              👆 <b>Clique no mapa</b> onde mora o cliente para ver {porRota ? "o km pela rua, o caminho" : "a distância"} e a taxa
              {porRota && areaStatus === "carregando" && <span className="fh-dica-calculando"> · calculando a área pelas ruas…</span>}
            </div>
          )}

          {/* Map instructions */}
          {!latLng && (
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 1000, background: "rgba(255,255,255,0.92)", borderRadius: "12px", padding: "16px 20px", textAlign: "center", fontSize: "0.85rem", color: "#475569", pointerEvents: "none" }}>
              <Navigation size={24} style={{ margin: "0 auto 8px", color: "#C92E09" }} />
              <strong>Busque o endereço acima</strong><br />
              ou clique no mapa para posicionar o pin
            </div>
          )}

          {/* Rodapé do mapa: a legenda do modo ROTA e o resumo das faixas. */}
          {porDistancia && faixasComKm.length > 0 && (
            <div className="fh-mapa-rodape">
              {porRota && areasPelaRua && (() => {
                // A legenda das manchas, da faixa mais perto para a mais longe,
                // com a taxa de cada uma — o que o mapa do iFood mostra ao lado
                // das zonas.
                const kms = areasPelaRua.map((a) => a.km).sort((a, b) => a - b);
                return (
                  <div className="fh-legenda-manchas">
                    <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>🛣️ Até onde a moto chega pela rua</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
                      {kms.map((km, i) => {
                        const faixa = faixas.find((f) => f.km != null && Math.abs(f.km - km) < 0.005);
                        return (
                          <span key={km} style={{ display: "inline-flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                            <span style={{ width: 11, height: 11, borderRadius: 3, background: corDaFaixaPelaRua(i, kms.length), display: "inline-block" }} />
                            até {formatarKm(km)} km{faixa?.fee != null ? ` · ${formatarReais(faixa.fee)}` : ""}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
              {porRota && areaStatus === "erro" && (
                <div className="fh-legenda-rota">
                  🛣️ <b>Não consegui calcular a área pelas ruas agora</b> — os círculos são em linha reta, só referência.
                  A taxa continua sendo pelo caminho da rua: clique no mapa para conferir.
                </div>
              )}
              <div className="fh-resumo-faixas">
                <span>📍 {formatarKm(Math.min(...numerosDasFaixas("km")))} km → {formatarKm(Math.max(...numerosDasFaixas("km")))} km{porRota ? " pela rua" : ""}</span>
                {numerosDasFaixas("time").length > 0 && <span>⏱️ {Math.min(...numerosDasFaixas("time"))} → {Math.max(...numerosDasFaixas("time"))} min</span>}
                {numerosDasFaixas("fee").length > 0 && <span>💰 {formatarReais(Math.min(...numerosDasFaixas("fee")))} → {formatarReais(Math.max(...numerosDasFaixas("fee")))}</span>}
              </div>
            </div>
          )}

          {/* O mesmo resumo para bairro e área desenhada: de quanto a quanto
              vão o tempo e a taxa, sem abrir a lista. */}
          {(porBairro || porDesenho) && (() => {
            const lista: { time: number | null; fee: number | null }[] = porBairro ? bairros.filter((b) => b.name.trim()) : areasDeEntrega;
            if (lista.length === 0) return null;
            const tempos = lista.map((z) => z.time).filter((n): n is number => n != null);
            const taxas = lista.map((z) => z.fee).filter((n): n is number => n != null);
            return (
              <div className="fh-mapa-rodape">
                <div className="fh-resumo-faixas">
                  <span>{porBairro ? "🏙️" : "✏️"} {lista.length} {porBairro ? (lista.length === 1 ? "bairro" : "bairros") : (lista.length === 1 ? "área" : "áreas")}</span>
                  {tempos.length > 0 && <span>⏱️ {Math.min(...tempos)} → {Math.max(...tempos)} min</span>}
                  {taxas.length > 0 && <span>💰 {formatarReais(Math.min(...taxas))} → {formatarReais(Math.max(...taxas))}</span>}
                </div>
              </div>
            );
          })()}
        </div>

        {/* ── PAINEL FLUTUANTE ──────────────────────────────────────────
            Cabeçalho com o Salvar sempre à vista, corpo rolando por dentro e
            rodapé com a ação principal — o padrão que o iFood usa e que a
            Brendi copiou, e que é o que o lojista espera encontrar. */}
        <aside className="fh-entrega-painel">
          <div className="fh-painel-topo">
            <div>
              <b>Entrega</b>
              {naoSalvo
                ? <span className="fh-nao-salvo">● Mudanças não salvas — clique em Salvar</span>
                : <span>{porBairro ? "Cobrança por bairro" : porDesenho ? "Cobrança por área desenhada" : porRota ? "Cobrança por km percorrido" : "Cobrança por raio"}</span>}
            </div>
            {/* Compacto e sempre à vista, no canto do cabeçalho: o que o
                lojista procura quando termina de mexer. */}
            <button onClick={handleSave} disabled={saving || !latLng}
              title={latLng ? "Salvar a configuração de entrega" : "Escolha o local da loja no mapa primeiro"}
              style={{ padding: "9px 15px", borderRadius: 10, border: "none", whiteSpace: "nowrap", flexShrink: 0,
                background: !latLng ? "#E2E8F0" : porBairro ? "#475569" : "#0F766E",
                color: !latLng ? "#94A3B8" : "#fff",
                fontWeight: 800, fontSize: "0.86rem", cursor: !latLng ? "not-allowed" : "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 6,
                boxShadow: !latLng ? "none" : "0 3px 12px rgba(15, 118, 110,0.28)" }}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>

          {/* O resultado do salvar fica no painel, junto do botão: no desktop o
              topo da página pode estar fora da tela. */}
          {avisoDoPainel && (
            <div role={avisoDoPainel.tipo === "erro" ? "alert" : "status"} className="fh-painel-aviso"
              style={{ background: corDoAviso(avisoDoPainel.tipo).bg, color: corDoAviso(avisoDoPainel.tipo).fg, borderColor: corDoAviso(avisoDoPainel.tipo).bd }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ flex: 1 }}>{avisoDoPainel.texto}</span>
                <button type="button" onClick={() => setAvisoDoPainel(null)} aria-label="Fechar aviso"
                  style={{ border: "none", background: "transparent", color: "inherit", cursor: "pointer", fontSize: "1rem", lineHeight: 1, padding: 0 }}>×</button>
              </div>
              {avisoDoPainel.lista && avisoDoPainel.lista.length > 0 && (
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {avisoDoPainel.lista.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* O cadastro gravado não se lê: a tabela abaixo é exemplo, não a da
              loja — e dizer isso antes de ela mexer em qualquer coisa. */}
          {ilegivelNoBanco && (
            <div role="alert" className="fh-painel-aviso" data-cadastro-ilegivel=""
              style={{ background: corDoAviso("aviso").bg, color: corDoAviso("aviso").fg, borderColor: corDoAviso("aviso").bd }}>
              <b>Não consegui ler o cadastro de entrega gravado.</b> A tabela abaixo é um exemplo, não a da sua loja.
              Salvar grava o que está nesta tela no lugar — se a loja já cobrava por uma tabela, fale com o suporte antes.
            </div>
          )}

          {/* As abas não trocam no meio de um desenho: os botões de fechar e
              desfazer moram na aba em que ele começou. */}
          <div className="fh-abas" role="tablist" aria-label="Partes da configuração de entrega">
            {([
              { chave: "tempo", nome: "Tempo e taxa" },
              { chave: "cadastro", nome: `${porBairro ? "Bairros" : porDesenho ? "Áreas" : "Faixas"} (${porBairro ? bairros.length : porDesenho ? areasDeEntrega.length : faixas.length})` },
              { chave: "configurar", nome: "Configurar" },
            ] as const).map((a) => (
              <button key={a.chave} type="button" role="tab" aria-selected={aba === a.chave}
                className={aba === a.chave ? "ativa" : ""}
                disabled={!!desenhando && aba !== a.chave}
                title={desenhando && aba !== a.chave ? "Termine ou cancele o desenho primeiro" : undefined}
                onClick={() => setAba(a.chave)}>
                {a.nome}
              </button>
            ))}
          </div>

          <div className={`fh-painel-corpo${aba === "cadastro" ? " fh-corpo-lista" : ""}`}>
        {/* ── MÉTODO DE COBRANÇA ────────────────────────────────────────── */}
        {aba === "configurar" && (
        <div style={{ marginBottom: "1rem" }}>
          <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Método de cobrança
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {METODOS_DE_COBRANCA.map((m) => {
              const ativo = metodoAtivo === m.chave;
              return (
                <button
                  key={m.chave}
                  type="button"
                  onClick={() => trocarMetodo(m.chave)}
                  aria-pressed={ativo}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 10, width: "100%", textAlign: "left",
                    padding: "11px 13px", borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
                    border: `2px solid ${ativo ? "#C92E09" : "#E2E8F0"}`,
                    background: ativo ? "#FEF2F2" : "#FFFFFF",
                    boxShadow: ativo ? "0 3px 12px rgba(220,38,38,0.10)" : "none",
                    transition: "all .15s ease",
                  }}
                >
                  <span style={{ fontSize: "1.1rem", lineHeight: 1.2, flexShrink: 0 }}>{m.emoji}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <b style={{ fontSize: "0.88rem", color: ativo ? "#B71C1C" : "#1E293B" }}>{m.nome}</b>
                      {m.recomendado && (
                        <span style={{ fontSize: "0.62rem", fontWeight: 800, color: "#0F766E", background: "#F0FDFA", borderRadius: 999, padding: "2px 7px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                          Recomendado
                        </span>
                      )}
                    </span>
                    <span style={{ display: "block", fontSize: "0.74rem", color: "#64748B", lineHeight: 1.45, marginTop: 3 }}>
                      {m.ajuda}
                    </span>
                  </span>
                  {ativo && <Check size={16} style={{ color: "#C92E09", flexShrink: 0, marginTop: 3 }} />}
                </button>
              );
            })}
          </div>
          <p style={{ margin: "8px 0 0", fontSize: "0.72rem", color: "#92400E", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8, padding: "7px 10px", lineHeight: 1.45 }}>
            Faixa de distância e lista de bairros são cadastros diferentes: ao trocar entre eles, os valores
            não são transferidos — confira a tabela antes de salvar.
          </p>
        </div>
        )}

          {aba === "cadastro" && (<>

          {/* ── QUANTO O MOTOBOY RECEBE ──────────────────────────────────
              A regra que decide o pagamento do entregador nos pedidos do
              site, balcão e robô. Dita aqui, em voz alta, porque a outra
              opção (o acerto de cada entregador) mora em outra aba. */}
          <div className="fh-repasse">
            <div style={{ fontSize: "0.84rem", fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>🛵 Quanto o motoboy recebe</div>
            <div className="fh-repasse-opcoes" role="radiogroup" aria-label="Quanto o motoboy recebe">
              {[
                { v: false, t: "Pelo acerto de cada entregador" },
                { v: true, t: `Um valor por ${unidade}` },
              ].map((op) => (
                <button key={String(op.v)} type="button" role="radio" aria-checked={repassePorFaixa === op.v}
                  onClick={() => { mexeuNoRepasse.current = true; setRepassePorFaixa(op.v); }}
                  className={repassePorFaixa === op.v ? "ativo" : ""}>
                  {op.t}
                </button>
              ))}
            </div>
            {repassePorFaixa ? (
              <>
                <p className="fh-repasse-ajuda">
                  Cada {unidade} tem o campo <b>🛵 Motoboy recebe</b>, gravado no pedido na hora da venda. Preencha
                  em todas — use 0 onde ele não recebe nada. {unidade === "área" ? "Área" : unidade === "bairro" ? "Bairro" : "Faixa"} em
                  branco não pega o valor da vizinha: cai no acerto do entregador.
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: "0.76rem", color: "#334155" }}>
                  <span>Preencher todas: motoboy recebe a taxa −</span>
                  <span style={{ width: 70 }}>
                    <CampoNumerico valor={descontoDoAtalho} onMudar={setDescontoDoAtalho} formato="reais" rotulo="Desconto sobre a taxa (R$)" placeholder="1,00" />
                  </span>
                  <button type="button" onClick={aplicarAtalhoDoRepasse} style={adjBtn}>Aplicar</button>
                </div>
                <div style={{ marginTop: 7, fontSize: "0.74rem", fontWeight: 700, color: validacao.semRepasse > 0 ? "#B45309" : "#0F766E" }}>
                  {validacao.semRepasse > 0
                    ? `${validacao.semRepasse} ${validacao.semRepasse === 1 ? unidade : unidades} sem o valor do motoboy.`
                    : `Todas as ${unidades} com valor.`}
                </div>
              </>
            ) : (
              <p className="fh-repasse-ajuda">
                Vale o que está cadastrado em cada entregador na aba <b>Motoboys</b> (diária, valor por entrega ou
                faixa de km dele). Sem acerto cadastrado, ele recebe a taxa que o cliente pagou.
                {valoresEscondidos && (
                  <b style={{ display: "block", marginTop: 5, color: "#B45309" }}>
                    Há valores de motoboy salvos nas {unidades} de antes. Ao salvar assim, eles são apagados.
                  </b>
                )}
              </p>
            )}
          </div>

          {/* O título repete o método escolhido: quem rolou a tela até aqui
              precisa saber qual cadastro está editando. */}
          <h4 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "4px" }}>
            {porBairro
              ? `Bairros atendidos (${bairros.length})`
              : porDesenho
                ? `Áreas desenhadas (${areasDeEntrega.length})`
                : `${porRota ? "Faixas por km percorrido" : "Faixas por raio"} (${faixas.length})`}
          </h4>
          <p style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: "12px", lineHeight: 1.45 }}>
            {porBairro
              ? "Cada bairro que sua loja atende, com o tempo e o valor da entrega."
              : porDesenho
                ? "Cada área desenhada tem a sua taxa e o seu tempo. Fora de todas, a loja não entrega."
                : porRota
                  ? "O pedido cai na primeira faixa que alcança o trajeto pelas ruas (\"até X km\", contando o X)."
                  : "O pedido cai na primeira faixa que alcança a distância em linha reta (\"até X km\", contando o X)."}
          </p>
          {porRota && (
            <p style={{ fontSize: "0.74rem", color: "#92400E", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 8, padding: "7px 10px", margin: "-4px 0 12px", lineHeight: 1.45 }}>
              Cadastre as faixas em <b>km de rua</b>. Faixas pensadas para raio encolhem a área: o bairro a 3,4 km em
              linha reta pode estar a 5,7 km pela rua — e passa a ficar fora da faixa de 5 km.
            </p>
          )}

          {/* Mode 1: KM / ROTA */}
          {porDistancia && (
            <>
              {/* ── AS FAIXAS, UMA POR CARTÃO ──────────────────────────────
                  Chave = id estável da faixa. O rótulo "De X a Y km" sai da
                  faixa de km imediatamente menor, não da posição na lista —
                  então fica certo mesmo antes de a lista entrar em ordem. */}
              {faixas.map((zona, i) => {
                const anterior = zona.km == null ? null : faixas
                  .filter((o) => o.id !== zona.id && o.km != null && (o.km as number) < (zona.km as number))
                  .reduce<number | null>((m, o) => (m == null || (o.km as number) > m ? (o.km as number) : m), null);
                const titulo = zona.km == null ? "Nova faixa" : anterior == null ? `Até ${formatarKm(zona.km)} km` : `De ${formatarKm(anterior)} a ${formatarKm(zona.km)} km`;
                const sobra = repassePorFaixa && zona.fee != null && zona.motoboyFee != null ? Math.round((zona.fee - zona.motoboyFee) * 100) / 100 : null;
                const emFoco = zonaEmFoco === zona.id;
                return (
                  <div
                    key={zona.id}
                    onMouseEnter={() => setZonaEmFoco(zona.id)}
                    onMouseLeave={() => setZonaEmFoco(null)}
                    style={{
                      border: `1px solid ${emFoco ? "#FCA5A5" : "#AEB9C7"}`,
                      background: emFoco ? "#FEF2F2" : "#FFFFFF",
                      boxShadow: "0 1px 2px rgba(15,23,42,0.10), 0 3px 8px rgba(15,23,42,0.07)",
                      borderRadius: 12, padding: "10px 12px", marginBottom: 8, transition: "all .15s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
                      <span style={{ width: 10, height: 10, borderRadius: "50%", background: ZONE_COLORS[i % ZONE_COLORS.length], flexShrink: 0 }} />
                      <b style={{ fontSize: "0.84rem", color: "#0F172A" }}>{titulo}{porRota && zona.km != null ? " pela rua" : ""}</b>
                      <button
                        type="button"
                        onClick={() => removeZone(zona.id)}
                        title="Remover esta faixa"
                        aria-label={`Remover a faixa ${titulo}`}
                        style={{ marginLeft: "auto", width: 28, height: 28, borderRadius: 7, border: "1px solid #FCA5A5", background: "#fff", color: "#C92E09", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <label style={campoDaFaixa}>
                        <span style={rotuloDoCampo}>Até quantos km</span>
                        <CampoNumerico valor={zona.km} formato="km" rotulo="Até quantos km" placeholder="ex.: 1,5"
                          autoFocus={focarNaFaixa === zona.id}
                          invalido={campoComErro(zona.id, "km")}
                          onMudar={(n) => updateZone(zona.id, "km", n)}
                          onSair={ordenarAoSair} />
                      </label>
                      <label style={campoDaFaixa}>
                        <span style={rotuloDoCampo}>Tempo (min)</span>
                        <CampoNumerico valor={zona.time} formato="inteiro" rotulo="Tempo de entrega em minutos"
                          invalido={campoComErro(zona.id, "time")}
                          onMudar={(n) => updateZone(zona.id, "time", n)} />
                      </label>
                      <label style={campoDaFaixa}>
                        <span style={rotuloDoCampo}>👤 Cliente paga</span>
                        <CampoNumerico valor={zona.fee} formato="reais" rotulo="Cliente paga (R$)"
                          invalido={campoComErro(zona.id, "fee")}
                          onMudar={(n) => updateZone(zona.id, "fee", n)} />
                      </label>
                      {repassePorFaixa && (
                        <label style={campoDaFaixa}>
                          <span style={rotuloDoCampo}>🛵 Motoboy recebe</span>
                          <CampoNumerico valor={zona.motoboyFee} formato="reais" rotulo="Motoboy recebe (R$)" placeholder="—"
                            invalido={campoComErro(zona.id, "motoboyFee")}
                            onMudar={(n) => updateZone(zona.id, "motoboyFee", n)} />
                        </label>
                      )}
                    </div>
                    {sobra != null && (
                      <div style={{ marginTop: 6, fontSize: "0.7rem", fontWeight: 600, color: sobra < 0 ? "#B45309" : "#64748B" }}>
                        {sobra < 0 ? `A loja paga ${formatarReais(-sobra)} do bolso em cada entrega.` : `Fica ${formatarReais(sobra)} com a loja.`}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {/* Mode 2: NEIGHBORHOOD (Por Bairro) */}
          {porBairro && (
            <>
              {bairros.length > 8 && (
                <input type="search" value={buscaDoBairro} onChange={(e) => setBuscaDoBairro(e.target.value)}
                  placeholder={`Buscar entre os ${bairros.length} bairros`} aria-label="Buscar bairro" className="fh-busca" />
              )}
              {bairros.filter((b) => bairroNaBusca(b.name)).map((zona) => {
                const mudar = (patch: Partial<BairroNaTela>) => setBairros(prev => prev.map((z) => z.id === zona.id ? { ...z, ...patch } : z));
                const emFoco = zonaEmFoco === zona.id;
                const nomeComErro = campoComErro(zona.id, "name");
                return (
                  <div
                    key={zona.id}
                    onMouseEnter={() => setZonaEmFoco(zona.id)}
                    onMouseLeave={() => setZonaEmFoco(null)}
                    style={{
                      border: `1px solid ${emFoco ? "#64748B" : "#AEB9C7"}`,
                      background: "#FFFFFF",
                      boxShadow: emFoco ? "0 4px 14px rgba(15,23,42,0.16)" : "0 1px 2px rgba(15,23,42,0.10), 0 3px 8px rgba(15,23,42,0.07)",
                      borderRadius: 12, padding: "10px 12px", marginBottom: 8, transition: "all .15s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
                      <input
                        type="text"
                        value={zona.name}
                        onChange={e => mudar({ name: e.target.value })}
                        placeholder="Nome do bairro"
                        aria-label="Nome do bairro"
                        autoFocus={focarNoBairro === zona.id}
                        aria-invalid={nomeComErro || undefined}
                        style={{ flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 8, border: `1px solid ${nomeComErro ? "#DC2626" : "#B8C2CF"}`, background: nomeComErro ? "#FEF2F2" : "#fff", fontSize: "0.86rem", fontWeight: 700, color: "#0F172A", outline: "none", fontFamily: "inherit" }}
                      />
                      <button
                        type="button"
                        onClick={() => setBairros(prev => prev.filter((z) => z.id !== zona.id))}
                        title="Remover este bairro"
                        aria-label={`Remover o bairro ${zona.name}`}
                        style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid #FCA5A5", background: "#fff", color: "#C92E09", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <label style={campoDaFaixa}>
                        <span style={rotuloDoCampo}>Tempo (min)</span>
                        <CampoNumerico valor={zona.time} formato="inteiro" rotulo="Tempo de entrega em minutos"
                          invalido={campoComErro(zona.id, "time")} onMudar={(n) => mudar({ time: n })} />
                      </label>
                      <label style={campoDaFaixa}>
                        <span style={rotuloDoCampo}>👤 Cliente paga</span>
                        <CampoNumerico valor={zona.fee} formato="reais" rotulo="Cliente paga (R$)"
                          invalido={campoComErro(zona.id, "fee")} onMudar={(n) => mudar({ fee: n })} />
                      </label>
                      {repassePorFaixa && (
                        <label style={campoDaFaixa}>
                          <span style={rotuloDoCampo}>🛵 Motoboy recebe</span>
                          <CampoNumerico valor={zona.motoboyFee} formato="reais" rotulo="Motoboy recebe (R$)" placeholder="—"
                            invalido={campoComErro(zona.id, "motoboyFee")} onMudar={(n) => mudar({ motoboyFee: n })} />
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {/* ── ÁREA DE ENTREGA DESENHADA ─────────────────────────────────
              A loja liga os pontinhos até fechar o contorno. É o único método
              em que a resposta não depende de o mapa conhecer o nome do bairro
              ou a rua: a conta é geometria sobre o ponto do cliente. O preço
              disso é que o pedido PRECISA ter ponto — endereço que o mapa não
              acha não fecha entrega, e a vitrine pede a confirmação no mapa. */}
          {porDesenho && (
            <>
              <div style={{ background: "#F0FDFA", border: "1.5px solid #99F6E4", borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
                <p style={{ margin: 0, fontSize: "0.84rem", fontWeight: 800, color: "#134E4A" }}>
                  ✏️ Desenhe onde você entrega
                </p>
                <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#0F766E", lineHeight: 1.45 }}>
                  Clique no mapa ponto a ponto até fechar o contorno. Cada área tem a sua taxa e o
                  seu tempo — e quem ficar fora de todos os contornos não consegue fechar pedido de
                  entrega.
                </p>
              </div>

              {desenhando && alvoDoDesenho === "ENTREGA" && (
                <div style={{ background: "#F0FDFA", border: "1.5px solid #99F6E4", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
                  <p style={{ margin: 0, fontSize: "0.84rem", fontWeight: 800, color: "#134E4A" }}>
                    Clique no mapa para marcar os cantos da área
                  </p>
                  <p style={{ margin: "3px 0 10px", fontSize: "0.76rem", color: "#0F766E" }}>
                    {desenhando.length} {desenhando.length === 1 ? "ponto marcado" : "pontos marcados"} — são necessários pelo menos 3.
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      disabled={desenhando.length < 3}
                      onClick={() => {
                        const nome = (prompt("Nome desta área (ex.: Centro, Até a BR):", "Área " + (areasDeEntrega.length + 1)) || "").trim();
                        if (!nome) return;
                        // Nasce SEM taxa (campo vazio, em vermelho), não com R$ 0,00:
                        // zero é entrega grátis, e tem que ser digitado de propósito.
                        setAreasDeEntrega((atual) => [...atual, { id: novoId("a"), nome, pontos: desenhando, fee: null, time: 45, repasse: null }]);
                        setDesenhando(null);
                        setAlvoDoDesenho("RISCO");
                      }}
                      style={{ padding: "8px 14px", borderRadius: 9, border: "none", background: desenhando.length < 3 ? "#99F6E4" : "#0F766E", color: "#fff", fontWeight: 800, fontSize: "0.82rem", cursor: desenhando.length < 3 ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                    >
                      ✓ Fechar área
                    </button>
                    <button type="button" onClick={() => setDesenhando(desenhando.slice(0, -1))} disabled={desenhando.length === 0}
                      style={{ padding: "8px 14px", borderRadius: 9, border: "1.5px solid #99F6E4", background: "#fff", color: "#0F766E", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}>
                      ↶ Desfazer ponto
                    </button>
                    <button type="button" onClick={() => { setDesenhando(null); setAlvoDoDesenho("RISCO"); }}
                      style={{ padding: "8px 14px", borderRadius: 9, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {areasDeEntrega.length === 0 && (
                <p style={{ fontSize: "0.78rem", color: "#B45309", background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 9, padding: "9px 11px", margin: "0 0 12px", lineHeight: 1.45 }}>
                  ⚠️ Nenhuma área desenhada. Enquanto não houver ao menos uma, a loja não recebe
                  pedido de entrega pelo cardápio — só retirada.
                </p>
              )}

              {areasDeEntrega.map((area, i) => {
                const mudar = (patch: Partial<AreaNaTela>) => setAreasDeEntrega((atual) => atual.map((a) => (a.id === area.id ? { ...a, ...patch } : a)));
                return (
                  <div key={area.id} style={{ border: "1px solid #AEB9C7", boxShadow: "0 1px 2px rgba(15,23,42,0.10), 0 3px 8px rgba(15,23,42,0.07)", borderLeft: "4px solid " + CORES_DA_AREA[i % CORES_DA_AREA.length], borderRadius: 10, padding: "10px 12px", marginBottom: 8, background: "#fff" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <input
                        value={area.nome}
                        aria-label="Nome da área"
                        onChange={(e) => mudar({ nome: e.target.value })}
                        style={{ flex: 1, minWidth: 0, padding: "6px 8px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: "0.86rem", fontWeight: 700, fontFamily: "inherit", outline: "none" }}
                      />
                      <span style={{ fontSize: "0.72rem", color: "#94A3B8", whiteSpace: "nowrap" }}>{area.pontos.length} pontos</span>
                      <button
                        type="button"
                        onClick={() => setAreasDeEntrega((atual) => atual.filter((a) => a.id !== area.id))}
                        title="Apagar esta área"
                        aria-label={`Apagar a área ${area.nome}`}
                        style={{ border: "none", background: "#FEE2E2", color: "#B71C1C", borderRadius: 7, width: 28, height: 28, cursor: "pointer" }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <label style={campoDaFaixa}>
                        <span style={rotuloDoCampo}>Taxa (R$)</span>
                        <CampoNumerico valor={area.fee} formato="reais" rotulo="Taxa da área (R$)" placeholder="—"
                          invalido={campoComErro(area.id, "fee")} onMudar={(n) => mudar({ fee: n })} />
                      </label>
                      <label style={campoDaFaixa}>
                        <span style={rotuloDoCampo}>Tempo (min)</span>
                        <CampoNumerico valor={area.time} formato="inteiro" rotulo="Tempo de entrega em minutos"
                          invalido={campoComErro(area.id, "time")} onMudar={(n) => mudar({ time: n })} />
                      </label>
                      {repassePorFaixa && (
                        <label style={campoDaFaixa}>
                          <span style={rotuloDoCampo}>🛵 Motoboy recebe</span>
                          <CampoNumerico valor={area.repasse} formato="reais" rotulo="Motoboy recebe (R$)" placeholder="—"
                            invalido={campoComErro(area.id, "motoboyFee")} onMudar={(n) => mudar({ repasse: n })} />
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}

          </>)}

          {aba === "tempo" && (<>
          {/* ── TEMPO E TAXA, NO DESENHO DO iFOOD ───────────────────────────
              Ajuste rápido em cima e uma linha por faixa/bairro/área com o
              tempo e a taxa. São os mesmos números do cadastro: mudar aqui é
              mudar lá. O bairro tem o seu próprio tempo, como tem a sua taxa —
              tempo por distância precisaria do ponto do cliente no mapa, e a
              entrega por bairro existe justamente para não depender dele. */}
          <div className="fh-tt-metodo">
            {nomeDoMetodo(currentZoneType)}
            <button type="button" onClick={() => setAba("configurar")}>Mudar</button>
          </div>

          <div className="fh-tt-rotulo">Ajuste rápido</div>
          <div className="fh-tt-ajustes">
            <button type="button" onClick={() => ajustarTodos("time", -5)} aria-label="Diminuir 5 minutos em todas">− 5 min</button>
            <button type="button" onClick={() => ajustarTodos("time", 5)} aria-label="Aumentar 5 minutos em todas">+ 5 min</button>
            <button type="button" onClick={() => ajustarTodos("fee", -1)} aria-label="Diminuir R$ 1 em todas">− R$ 1</button>
            <button type="button" onClick={() => ajustarTodos("fee", 1)} aria-label="Aumentar R$ 1 em todas">+ R$ 1</button>
          </div>
          <p className="fh-tt-ajuda">
            Muda {porBairro ? `os ${bairros.length} bairros` : porDesenho ? `as ${areasDeEntrega.length} áreas` : `as ${faixas.length} faixas`} de uma vez. Vale para o cliente depois de <b>Salvar</b>.
          </p>

          {porBairro && bairros.length > 8 && (
            <input type="search" value={buscaDoBairro} onChange={(e) => setBuscaDoBairro(e.target.value)}
              placeholder={`Buscar entre os ${bairros.length} bairros`} aria-label="Buscar bairro" className="fh-busca" />
          )}

          {(() => {
            type Linha = { id: string; rotulo: string; dica?: string; time: number | null; fee: number | null; mudar: (campo: "time" | "fee", n: number | null) => void };
            const linhas: Linha[] = porDistancia
              ? ordenarFaixas(faixas).map((f) => ({
                  id: f.id,
                  rotulo: f.km != null ? `${formatarKm(f.km)} km` : "Nova faixa",
                  dica: f.km != null ? `Até ${formatarKm(f.km)} km${porRota ? " pela rua" : " em linha reta"}` : undefined,
                  time: f.time, fee: f.fee,
                  mudar: (campo, n) => updateZone(f.id, campo, n),
                }))
              : porBairro
                // Em ordem alfabética só aqui: no cadastro a ordem é a da loja,
                // e o bairro novo aparece no fim, onde ela está digitando.
                ? bairros
                    .filter((b) => bairroNaBusca(b.name))
                    .sort((a, b) => a.name.trim().localeCompare(b.name.trim(), "pt-BR"))
                    .map((b) => ({
                      id: b.id, rotulo: b.name.trim() || "(sem nome)", time: b.time, fee: b.fee,
                      mudar: (campo, n) => setBairros((prev) => prev.map((z) => (z.id === b.id ? { ...z, [campo]: n } : z))),
                    }))
                : areasDeEntrega.map((a) => ({
                    id: a.id, rotulo: a.nome, time: a.time, fee: a.fee,
                    mudar: (campo, n) => setAreasDeEntrega((prev) => prev.map((z) => (z.id === a.id ? { ...z, [campo]: n } : z))),
                  }));
            if (linhas.length === 0) {
              return (
                <p className="fh-tt-vazio">
                  {porBairro && buscaDoBairro.trim()
                    ? <>Nenhum bairro com &quot;{buscaDoBairro.trim()}&quot;.</>
                    : porDesenho
                      ? <>Nenhuma área desenhada ainda. Use o botão abaixo para desenhar a primeira no mapa.</>
                      : <>Nenhuma {unidade} cadastrada ainda.</>}
                </p>
              );
            }
            return (
              <div className="fh-tt-tabela" role="table" aria-label="Tempo e taxa de entrega">
                <div className="fh-tt-cab" role="row">
                  <span role="columnheader">{porBairro ? "Bairro" : porDesenho ? "Área" : porRota ? "Pela rua" : "Raio"}</span>
                  <span role="columnheader">Tempo</span>
                  <span role="columnheader">Taxa</span>
                </div>
                {linhas.map((l) => (
                  <div key={l.id} role="row" className={`fh-tt-linha${zonaEmFoco === l.id ? " foco" : ""}`}
                    onMouseEnter={() => setZonaEmFoco(l.id)} onMouseLeave={() => setZonaEmFoco(null)}>
                    <span role="cell" className="fh-tt-nome" title={l.dica || l.rotulo}>{l.rotulo}</span>
                    <span role="cell" className={`fh-tt-campo${campoComErro(l.id, "time") ? " invalido" : ""}`}>
                      <CampoNumerico semMoldura valor={l.time} formato="inteiro" rotulo={`Tempo de entrega — ${l.rotulo} (min)`}
                        invalido={campoComErro(l.id, "time")} onMudar={(n) => l.mudar("time", n)} />
                      <i>min</i>
                    </span>
                    <span role="cell" className={`fh-tt-campo${campoComErro(l.id, "fee") ? " invalido" : ""}`}>
                      <i>R$</i>
                      <CampoNumerico semMoldura valor={l.fee} formato="reais" rotulo={`Taxa de entrega — ${l.rotulo} (R$)`}
                        invalido={campoComErro(l.id, "fee")} onMudar={(n) => l.mudar("fee", n)} />
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* O ponto de partida de quem tem muitos bairros (ou faixas) sem tempo. */}
          {(porBairro ? bairros.length : porDesenho ? areasDeEntrega.length : faixas.length) > 1 && (
            <div className="fh-tt-todos">
              <span>Todos com o mesmo tempo:</span>
              <span className="fh-tt-campo" style={{ width: 92 }}>
                <CampoNumerico semMoldura valor={tempoParaTodos} onMudar={setTempoParaTodos} formato="inteiro" rotulo="Mesmo tempo para todos (min)" placeholder="40" />
                <i>min</i>
              </span>
              <button type="button" onClick={aplicarTempoParaTodos} disabled={tempoParaTodos == null || tempoParaTodos <= 0} style={adjBtn}>Aplicar</button>
            </div>
          )}

          {/* ── SIMULAR UM ENDEREÇO ───────────────────────────────────────
              Pergunta ao mesmo /api/delivery-fee do cardápio. Mostra a
              distância (pela rua, estimada ou em linha reta), a faixa, a taxa,
              o repasse e o tempo — e o ponto no mapa. */}
          <div className="fh-simulador" ref={simuladorRef}>
            <div style={{ fontSize: "0.9rem", fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>🧪 Simular um endereço</div>
            <p style={{ margin: "0 0 9px", fontSize: "0.74rem", color: "#64748B", lineHeight: 1.45 }}>
              Digite como o cliente digitaria no cardápio{!porBairro && <>, ou <b>toque no mapa</b> onde mora o cliente</>}. A resposta é a mesma que ele veria, com a configuração <b>salva</b>.
              {porRota && <> O caminho pela rua aparece em azul no mapa.</>}
            </p>
            <form
              onSubmit={(e) => { e.preventDefault(); simular(); }}
              style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
            >
              <input value={simRua} onChange={(e) => setSimRua(e.target.value)} placeholder="Rua" aria-label="Rua para simular"
                style={{ ...caixaDoCampo, textAlign: "left", flex: "3 1 140px", minWidth: 0 }} />
              <input value={simNumero} onChange={(e) => setSimNumero(e.target.value)} placeholder="Nº" aria-label="Número para simular"
                style={{ ...caixaDoCampo, flex: "0 1 60px", minWidth: 50 }} />
              <input value={simBairro} onChange={(e) => setSimBairro(e.target.value)} placeholder="Bairro" aria-label="Bairro para simular"
                style={{ ...caixaDoCampo, textAlign: "left", flex: "2 1 120px", minWidth: 0 }} />
              <button type="submit" disabled={simulando}
                style={{ flex: "1 0 100%", padding: "9px 12px", borderRadius: 9, border: "none", background: "#1D4ED8", color: "#fff", fontWeight: 800, fontSize: "0.84rem", cursor: simulando ? "wait" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                {simulando ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                {simulando ? "Medindo…" : "Simular"}
              </button>
            </form>
            {simErro && <p role="alert" style={{ margin: "8px 0 0", fontSize: "0.76rem", color: "#B71C1C" }}>{simErro}</p>}

            {simulacao && (() => {
              const s = simulacao;
              const naoAchou = s.precisaConfirmarNoMapa || (s.unknown && s.distanceKm == null);
              const atende = s.available === true && !naoAchou;
              const cabecalho = atende
                ? { t: "✅ Entrega atendida", c: "#0F766E" }
                : naoAchou
                  ? { t: "📍 O mapa não achou esse endereço", c: "#B45309" }
                  : { t: "⛔ Fora da área de entrega", c: "#B71C1C" };
              const medida = s.medida === "rota" ? "pela rua"
                : s.medida === "estimada" ? "estimada — o roteador não respondeu; linha reta × desvio da loja"
                : s.medida === "linha-reta" ? "em linha reta" : "";
              return (
                <div className="fh-sim-resultado">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ flex: 1, color: cabecalho.c, fontSize: "0.86rem" }}>{cabecalho.t}</b>
                    <button type="button" onClick={limparSimulacao} style={{ ...adjBtn, padding: "3px 8px" }}>Limpar</button>
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "2px 0 7px" }}>{s.consulta}</div>
                  {porRota && s.ponto && (caminho || caminhoErro) && (
                    <div style={{ fontSize: "0.72rem", color: caminho ? "#1D4ED8" : "#B45309", fontWeight: 700, margin: "-3px 0 7px" }}>
                      {caminho ? "🛣️ O caminho pela rua está desenhado em azul no mapa." : `🛣️ ${caminhoErro}`}
                    </div>
                  )}
                  <dl className="fh-sim-linhas">
                    {s.distanceKm != null && (<><dt>Distância</dt><dd>{formatarKm(s.distanceKm)} km {medida && <span style={{ color: s.medida === "estimada" ? "#B45309" : "#64748B", fontWeight: 600 }}>({medida})</span>}</dd></>)}
                    {s.faixaKm != null && (<><dt>Faixa</dt><dd>até {formatarKm(s.faixaKm)} km</dd></>)}
                    {s.neighborhood && (<><dt>{s.type === "poligono" ? "Área" : "Bairro"}</dt><dd>{s.neighborhood}</dd></>)}
                    {atende && s.fee != null && (<><dt>Cliente paga</dt><dd>{formatarReais(s.fee)}</dd></>)}
                    {/* O valor da faixa só vai para o pedido com o repasse por faixa
                        LIGADO no servidor (lib/entrega-do-pedido.ts, repasseDaEntrega).
                        /api/delivery-fee devolve o da faixa de qualquer jeito: mostrar
                        "Motoboy recebe R$ 4" com ele desligado era afirmar uma regra
                        que o pedido não aplica. */}
                    {atende && s.feitaCom.separado === true && (s.taxaDoEntregador != null
                      ? (<><dt>Motoboy recebe</dt><dd>{formatarReais(s.taxaDoEntregador)}</dd></>)
                      : s.taxaDoEntregador === null
                        ? (<><dt>Motoboy recebe</dt><dd style={{ color: "#B45309" }}>sem valor nesta {unidade} — vale o acerto do entregador</dd></>)
                        : null)}
                    {atende && s.feitaCom.separado === false && (<><dt>Motoboy recebe</dt><dd>pelo acerto de cada entregador</dd></>)}
                    {s.tempoMin != null && (<><dt>Tempo</dt><dd>{s.tempoMin} min</dd></>)}
                    {s.matchedAddress && (<><dt>O mapa entendeu</dt><dd style={{ fontWeight: 500 }}>{s.matchedAddress}</dd></>)}
                  </dl>
                  {s.pedeConfirmacao && (
                    <p className="fh-sim-nota">⚠️ Ponto aproximado. No cardápio, o cliente confirma o pino no mapa antes de fechar o pedido.</p>
                  )}
                  {s.message && !atende && <p className="fh-sim-nota" style={{ background: "#F8FAFC", color: "#475569", borderColor: "#E2E8F0" }}>{s.message}</p>}
                  {s.feitaCom.alterada && (
                    <p className="fh-sim-nota">
                      Você tem mudanças não salvas{s.feitaCom.tipoSalvo !== currentZoneType ? ` (o método salvo é "${nomeDoMetodo(s.feitaCom.tipoSalvo)}")` : pontoMudou ? " (o pino da loja mudou)" : ""}: o resultado acima é o que vale HOJE. Salve para simular com a tela.
                    </p>
                  )}
                  {previaComATabelaDaTela && (() => {
                    const p = previaComATabelaDaTela;
                    return (
                      <p className="fh-sim-nota" data-previa={p.tipo === "faixa" ? p.resultado : p.motivo}
                        style={{ background: "#EFF6FF", color: "#1E3A8A", borderColor: "#BFDBFE" }}>
                        Com a tabela desta tela (ainda não salva):{" "}
                        {p.tipo === "sem-previa"
                          ? p.motivo === "SEM_MEDIDA_PELA_RUA"
                            ? <>esse endereço passa da última faixa <b>salva</b>, e a rua só é medida até ela — aqui só voltou a linha reta. <b>Salve e simule de novo</b> para medir pela rua com a tabela nova.</>
                            : p.motivo === "AREA_DE_RISCO"
                              ? <>o ponto cai numa área onde você não entrega — fica <b>fora</b> com qualquer tabela.</>
                            : p.motivo === "FORA_DO_LIMITE"
                              ? <>o ponto cai fora do contorno de onde você entrega — fica <b>fora</b> com qualquer tabela.</>
                              : <>sem prévia — o mapa só achou um ponto aproximado, e a faixa de um palpite não é resposta. Simule com rua e número que o mapa ache com certeza.</>
                          : p.resultado === "FORA" || !p.faixa
                            ? <><b>fora da última faixa</b>{p.foraJaEmLinhaReta ? " — já em linha reta; pela rua é ainda mais longe" : ""}.</>
                            : <>faixa até <b>{formatarKm(p.faixa.km)} km</b> — cliente paga <b>{formatarReais(p.faixa.fee)}</b>
                                {repassePorFaixa && <>, motoboy recebe <b>{p.faixa.motoboyFee != null ? formatarReais(p.faixa.motoboyFee) : "sem valor"}</b></>}.</>}
                      </p>
                    );
                  })()}
                </div>
              );
            })()}
          </div>

          </>)}

          {aba === "configurar" && (<>
          {/* ── ONDE VOCÊ ENTREGA (contorno por cima do raio/rota/bairro) ──
              O círculo do raio atravessa a rodovia; o contorno diz até onde a
              moto vai. Dentro dele vale a tabela de sempre; fora, a loja não
              atende. Não aparece em "Desenhar no mapa": ali as áreas já são o
              contorno (lib/limite-de-atendimento.ts). */}
          {!porDesenho ? (
            <div style={{ marginTop: "18px", paddingTop: "16px", borderTop: "1.5px solid #E2E8F0" }}>
              <h4 style={{ fontWeight: 800, fontSize: "1rem", margin: "0 0 4px" }}>✅ Onde você entrega (contorno no mapa)</h4>
              <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "0 0 12px", lineHeight: 1.45 }}>
                O raio é um círculo e atravessa rodovia, rio e linha de trem. Desenhe o contorno de onde a moto vai:
                <b> dentro dele</b> a taxa é a {porBairro ? "do bairro" : "da faixa de km"} de sempre; <b>fora dele</b> a loja não atende, mesmo perto.
                Sem contorno, vale só {porBairro ? "a lista de bairros" : "o raio"}, como hoje.
              </p>

              {desenhando && alvoDoDesenho === "LIMITE" ? (
                <div style={{ background: "#F0FDFA", border: "1.5px solid #99F6E4", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
                  <p style={{ margin: 0, fontSize: "0.84rem", fontWeight: 800, color: "#134E4A" }}>
                    Clique no mapa para marcar os cantos de onde você entrega
                  </p>
                  <p style={{ margin: "3px 0 10px", fontSize: "0.76rem", color: "#0F766E" }}>
                    {desenhando.length} {desenhando.length === 1 ? "ponto marcado" : "pontos marcados"} — são necessários pelo menos 3. Contorne a área inteira, com a loja dentro.
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      disabled={desenhando.length < 3}
                      onClick={() => {
                        const nome = (prompt("Nome deste contorno (ex.: Lado de cá da Dutra):", limites.length === 0 ? "Onde eu entrego" : `Onde eu entrego ${limites.length + 1}`) || "").trim();
                        if (!nome) return;
                        setLimites((atual) => [...atual, { nome, pontos: desenhando, ativa: true }]);
                        setDesenhando(null);
                        setAlvoDoDesenho("RISCO");
                      }}
                      style={{ padding: "8px 14px", borderRadius: 9, border: "none", background: desenhando.length < 3 ? "#99F6E4" : "#0F766E", color: "#fff", fontWeight: 800, fontSize: "0.82rem", cursor: desenhando.length < 3 ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                    >
                      ✓ Fechar contorno
                    </button>
                    <button type="button" onClick={() => setDesenhando(desenhando.slice(0, -1))} disabled={desenhando.length === 0}
                      style={{ padding: "8px 14px", borderRadius: 9, border: "1.5px solid #99F6E4", background: "#fff", color: "#0F766E", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}>
                      ↶ Desfazer ponto
                    </button>
                    <button type="button" onClick={() => { setDesenhando(null); setAlvoDoDesenho("RISCO"); }}
                      style={{ padding: "8px 14px", borderRadius: 9, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setAlvoDoDesenho("LIMITE"); setDesenhando([]); }}
                  disabled={!!desenhando}
                  style={{ width: "100%", padding: "9px", borderRadius: 9, border: "1.5px dashed #5EEAD4", background: "#F0FDFA", color: "#0F766E", fontWeight: 700, fontSize: "0.84rem", cursor: desenhando ? "not-allowed" : "pointer", fontFamily: "inherit", marginBottom: 12, opacity: desenhando ? 0.6 : 1 }}
                >
                  + Desenhar no mapa onde você entrega
                </button>
              )}

              {limites.length === 0 && !desenhando && (
                <p style={{ fontSize: "0.76rem", color: "#94A3B8", margin: 0, textAlign: "center" }}>
                  Nenhum contorno — vale só {porBairro ? "a lista de bairros" : "o raio"}.
                </p>
              )}

              {limites.map((limite, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, border: "1px solid #E2E8F0", marginBottom: 6, background: limite.ativa === false ? "#F8FAFC" : "#fff" }}>
                  <input
                    type="checkbox"
                    checked={limite.ativa !== false}
                    title={limite.ativa === false ? "Voltar a limitar por este contorno" : "Parar de limitar, sem apagar o desenho"}
                    onChange={(e) => setLimites((atual) => atual.map((a, j) => (j === i ? { ...a, ativa: e.target.checked } : a)))}
                    style={{ width: 16, height: 16, accentColor: "#0F766E", cursor: "pointer", flexShrink: 0 }}
                  />
                  <input
                    value={limite.nome}
                    onChange={(e) => setLimites((atual) => atual.map((a, j) => (j === i ? { ...a, nome: e.target.value } : a)))}
                    style={{ flex: 1, minWidth: 0, padding: "5px 8px", borderRadius: 7, border: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, fontFamily: "inherit", color: limite.ativa === false ? "#94A3B8" : "#0F172A" }}
                  />
                  <span style={{ fontSize: "0.72rem", color: "#94A3B8", whiteSpace: "nowrap" }}>{limite.pontos.length} pontos</span>
                  <button type="button" title="Apagar este contorno"
                    onClick={() => { if (confirm(`Apagar o contorno "${limite.nome}"?`)) setLimites((atual) => atual.filter((_, j) => j !== i)); }}
                    style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #99F6E4", background: "#fff", color: "#0F766E", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {limites.some((l) => l.ativa !== false) && latLng && limites.every((l) => l.ativa === false || !dentroDoPoligono(latLng, l.pontos)) && (
                <p style={{ fontSize: "0.76rem", color: "#B45309", margin: "6px 0 0", fontWeight: 700, lineHeight: 1.4 }}>
                  ⚠️ A própria loja está fora de todos os contornos ligados. Confira o desenho: o contorno deve envolver a loja e os bairros que ela atende.
                </p>
              )}
            </div>
          ) : limites.length > 0 ? (
            <p style={{ marginTop: "14px", fontSize: "0.76rem", color: "#64748B", lineHeight: 1.45 }}>
              {limites.length === 1 ? "O contorno de onde você entrega fica guardado" : `Os ${limites.length} contornos de onde você entrega ficam guardados`}, mas não vale{limites.length === 1 ? "" : "m"} em
              &quot;Desenhar no mapa&quot;: aqui as próprias áreas desenhadas são o contorno.
            </p>
          ) : null}

          {/* ── ÁREAS DE RISCO ────────────────────────────────────────────
              Vale para todos os modos: raio, rota, bairro ou desenho. É a
              única regra que recusa um endereço mesmo estando dentro da área
              de entrega — e tem que ser assim, senão a loja desenha a área e
              continua recebendo o pedido. */}
          <div style={{ marginTop: "18px", paddingTop: "16px", borderTop: "1.5px solid #E2E8F0" }}>
            <h4 style={{ fontWeight: 800, fontSize: "1rem", margin: "0 0 4px" }}>🚫 Onde você não entrega</h4>
            <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "0 0 12px", lineHeight: 1.45 }}>
              Desenhe no mapa as áreas que a loja não atende. Endereço que cair dentro é recusado
              <b> antes de o cliente pagar</b>, mesmo estando perto e dentro do raio.
            </p>

            {desenhando && alvoDoDesenho === "RISCO" ? (
              <div style={{ background: "#FEF2F2", border: "1.5px solid #FCA5A5", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
                <p style={{ margin: 0, fontSize: "0.84rem", fontWeight: 800, color: "#B71C1C" }}>
                  Clique no mapa para marcar os cantos da área
                </p>
                <p style={{ margin: "3px 0 10px", fontSize: "0.76rem", color: "#B71C1C" }}>
                  {desenhando.length} {desenhando.length === 1 ? "ponto marcado" : "pontos marcados"} — são necessários pelo menos 3.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    disabled={desenhando.length < 3}
                    onClick={() => {
                      const nome = (prompt("Nome desta área (ex.: Morro do Cemitério, Rua sem saída):", "Área de risco") || "").trim();
                      if (!nome) return;
                      setAreasDeRisco((atual) => [...atual, { nome, pontos: desenhando, ativa: true }]);
                      setDesenhando(null);
                      setAlvoDoDesenho("RISCO");
                    }}
                    style={{ padding: "8px 14px", borderRadius: 9, border: "none", background: desenhando.length < 3 ? "#FCA5A5" : "#C92E09", color: "#fff", fontWeight: 800, fontSize: "0.82rem", cursor: desenhando.length < 3 ? "not-allowed" : "pointer", fontFamily: "inherit" }}
                  >
                    ✓ Fechar área
                  </button>
                  <button type="button" onClick={() => setDesenhando(desenhando.slice(0, -1))} disabled={desenhando.length === 0}
                    style={{ padding: "8px 14px", borderRadius: 9, border: "1.5px solid #FCA5A5", background: "#fff", color: "#B71C1C", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}>
                    ↶ Desfazer ponto
                  </button>
                  <button type="button" onClick={() => setDesenhando(null)}
                    style={{ padding: "8px 14px", borderRadius: 9, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}>
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setAlvoDoDesenho("RISCO"); setDesenhando([]); }}
                disabled={!!desenhando}
                style={{ width: "100%", padding: "9px", borderRadius: 9, border: "1.5px dashed #FCA5A5", background: "#FEF2F2", color: "#B71C1C", fontWeight: 700, fontSize: "0.84rem", cursor: desenhando ? "not-allowed" : "pointer", fontFamily: "inherit", marginBottom: 12, opacity: desenhando ? 0.6 : 1 }}
              >
                + Desenhar área de risco no mapa
              </button>
            )}

            {areasDeRisco.length === 0 && !desenhando && (
              <p style={{ fontSize: "0.76rem", color: "#94A3B8", margin: 0, textAlign: "center" }}>
                Nenhuma área cadastrada — a loja atende toda a área de entrega.
              </p>
            )}

            {areasDeRisco.map((area, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, border: "1px solid #E2E8F0", marginBottom: 6, background: area.ativa === false ? "#F8FAFC" : "#fff" }}>
                <input
                  type="checkbox"
                  checked={area.ativa !== false}
                  title={area.ativa === false ? "Voltar a recusar esta área" : "Parar de recusar, sem apagar o desenho"}
                  onChange={(e) => setAreasDeRisco((atual) => atual.map((a, j) => (j === i ? { ...a, ativa: e.target.checked } : a)))}
                  style={{ width: 16, height: 16, accentColor: "#C92E09", cursor: "pointer", flexShrink: 0 }}
                />
                <input
                  value={area.nome}
                  onChange={(e) => setAreasDeRisco((atual) => atual.map((a, j) => (j === i ? { ...a, nome: e.target.value } : a)))}
                  style={{ flex: 1, minWidth: 0, padding: "5px 8px", borderRadius: 7, border: "1px solid #E2E8F0", fontSize: "0.82rem", fontWeight: 700, fontFamily: "inherit", color: area.ativa === false ? "#94A3B8" : "#0F172A" }}
                />
                <span style={{ fontSize: "0.72rem", color: "#94A3B8", whiteSpace: "nowrap" }}>{area.pontos.length} pontos</span>
                <button type="button" title="Apagar esta área"
                  onClick={() => { if (confirm(`Apagar a área "${area.nome}"?`)) setAreasDeRisco((atual) => atual.filter((_, j) => j !== i)); }}
                  style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid #FCA5A5", background: "#fff", color: "#C92E09", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          </>)}

          </div>

          <div className="fh-painel-rodape">
            {!latLng && (
              <p style={{ margin: "0 0 8px", fontSize: "0.74rem", color: "#B71C1C", lineHeight: 1.4 }}>
                Escolha o local da loja no mapa (busque o endereço acima) para poder salvar.
              </p>
            )}
            {/* Em "Configurar" o rodapé fica só com o aviso: lá os botões de
                desenho são os de contorno e de área de risco. Adicionar leva
                ao cadastro, onde se dá nome (e km) ao item novo. */}
            {aba === "configurar" ? null : porBairro ? (
              <button type="button" onClick={adicionarBairro} className="fh-add-principal">
                <Plus size={15} /> Adicionar bairro
              </button>
            ) : porDesenho ? (
              <button type="button" disabled={!!desenhando}
                onClick={() => { setAba("cadastro"); setAlvoDoDesenho("ENTREGA"); setDesenhando([]); }}
                className="fh-add-principal" style={desenhando ? { opacity: 0.6, cursor: "not-allowed" } : undefined}>
                <Plus size={15} /> Desenhar área de entrega no mapa
              </button>
            ) : (
              <button type="button" onClick={() => { addZone(); setAba("cadastro"); }} className="fh-add-principal">
                <Plus size={15} /> Adicionar faixa
              </button>
            )}
          </div>
        </aside>
      </div>
      <style jsx global>{`
        /* ── MAPA ABERTO COM PAINEL FLUTUANTE ─────────────────────────────
           O mapa ocupa a área toda e o painel flutua por cima, à direita. No
           celular o painel desce para baixo do mapa: painel flutuante em tela
           estreita cobriria o mapa inteiro, que é o que a tela existe para
           mostrar. */
        .fh-entrega-area {
          position: relative;
          border-radius: 16px;
          overflow: hidden;
          border: 2px solid #E2E8F0;
          box-shadow: 0 4px 20px rgba(0,0,0,0.08);
        }
        .fh-entrega-mapa { position: relative; width: 100%; height: min(78vh, 880px); min-height: 580px; }
        /* Os + e − da tela. Acima do mapa (1000 é a faixa do Leaflet) e fora do
           caminho do painel, que mora do outro lado. */
        .fh-zoom {
          position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
          z-index: 1001; display: flex; flex-direction: column;
          background: #fff; border: 1.5px solid #CBD5E1; border-radius: 10px;
          overflow: hidden; box-shadow: 0 4px 14px rgba(15,23,42,0.18);
        }
        .fh-zoom button {
          width: 42px; height: 40px; border: none; background: #fff; color: #0F172A;
          font-size: 1.35rem; font-weight: 800; line-height: 1; cursor: pointer;
          font-family: inherit;
        }
        .fh-zoom button:first-child { border-bottom: 1px solid #E2E8F0; }
        .fh-zoom button:hover { background: #F1F5F9; }
        .fh-confirmar-pino {
          position: absolute; top: 12px; left: 12px; right: 430px; z-index: 1000;
          background: rgba(255,255,255,0.96); backdrop-filter: blur(6px);
          padding: 10px 14px; border-radius: 12px; border: 1.5px solid #FCA5A5;
          box-shadow: 0 6px 20px rgba(0,0,0,0.15);
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
        }
        /* Rodapé do mapa: legenda do ROTA em cima do resumo das faixas, à
           esquerda — o painel ocupa a direita. */
        .fh-mapa-rodape {
          position: absolute; left: 12px; bottom: 12px; z-index: 1000;
          right: 430px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
          pointer-events: none;
        }
        .fh-legenda-rota {
          max-width: 380px; background: rgba(255,247,230,0.97); border: 1px solid #FDE68A; color: #92400E;
          border-radius: 9px; padding: 7px 10px; font-size: 0.72rem; line-height: 1.4;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .fh-legenda-manchas {
          max-width: 520px; background: rgba(255,255,255,0.97); border: 1px solid #E2E8F0; color: #334155;
          border-radius: 9px; padding: 8px 11px; font-size: 0.74rem; line-height: 1.4;
          box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        }
        /* A dica do mapa: escura e no alto, para ninguém deixar de ver. */
        .fh-dica-do-mapa {
          position: absolute; top: 58px; left: 12px; right: 430px; z-index: 1000;
          margin: 0 auto; width: fit-content;
          background: #0F172A; color: #fff; border-radius: 999px;
          padding: 9px 16px; font-size: 0.86rem; line-height: 1.35; text-align: center;
          box-shadow: 0 6px 18px rgba(15,23,42,0.3); pointer-events: none;
        }
        .fh-dica-calculando { color: #93C5FD; font-weight: 600; }
        /* Clicar numa mancha (ou num círculo) dava foco ao desenho, e o Chrome
           pintava o retângulo preto de foco em volta dele — o "quadrado" que
           aparecia no meio do mapa depois de simular. */
        .fh-entrega-mapa path.leaflet-interactive:focus,
        .fh-entrega-mapa path.leaflet-interactive:focus-visible { outline: none; }
        .fh-resumo-faixas {
          background: rgba(255,255,255,0.94); border-radius: 8px; padding: 6px 12px; font-size: 0.75rem; color: #334155;
          display: flex; gap: 12px; flex-wrap: wrap; box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .fh-entrega-painel {
          position: absolute;
          top: 14px; right: 14px; bottom: 14px;
          width: 402px;
          display: flex;
          flex-direction: column;
          background: #fff;
          border-radius: 14px;
          box-shadow: 0 12px 44px rgba(15,23,42,0.24);
          overflow: hidden;
          /* Acima dos controles do Leaflet, que ficam em 1000. */
          z-index: 1100;
        }
        .fh-painel-topo {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          padding: 12px 14px; border-bottom: 1px solid #F1F5F9; background: #fff; flex-shrink: 0;
        }
        .fh-painel-topo b { display: block; font-size: 0.95rem; font-weight: 800; color: #0F172A; }
        .fh-painel-topo span { display: block; font-size: 0.74rem; color: #64748B; margin-top: 1px; }
        .fh-painel-aviso {
          flex-shrink: 0; margin: 10px 14px 0; padding: 9px 11px; border-radius: 9px; border: 1px solid;
          font-size: 0.78rem; line-height: 1.45; max-height: 38%; overflow-y: auto;
        }
        .fh-painel-corpo { flex: 1; overflow-y: auto; padding: 14px; }
        /* A lista do cadastro em fundo cinza claro: cartão branco sobre branco
           sumia, e não dava para ver onde um bairro acabava e o outro começava. */
        .fh-painel-corpo.fh-corpo-lista { background: #E6EBF1; }
        .fh-corpo-lista .fh-repasse { background: #fff; border-color: #AEB9C7; box-shadow: 0 1px 2px rgba(15,23,42,0.08); }
        .fh-corpo-lista .fh-busca { border-color: #AEB9C7; background: #fff; }
        .fh-corpo-lista > p, .fh-corpo-lista > h4 { color: #1E293B !important; }
        .fh-painel-topo .fh-nao-salvo { color: #B45309; font-weight: 700; }
        /* ── ABAS (o "Operação atual | Pré-configurações" do iFood) ─────── */
        .fh-abas {
          display: flex; gap: 2px; padding: 0 10px; border-bottom: 1px solid #E2E8F0;
          background: #fff; flex-shrink: 0; overflow-x: auto; scrollbar-width: none;
        }
        .fh-abas::-webkit-scrollbar { display: none; }
        .fh-abas button {
          flex: 1 0 auto; padding: 10px 8px 9px; border: none; background: transparent; cursor: pointer;
          font-family: inherit; font-size: 0.8rem; font-weight: 700; color: #64748B; white-space: nowrap;
          border-bottom: 2.5px solid transparent; margin-bottom: -1px;
        }
        .fh-abas button:hover:not(:disabled) { color: #0F172A; }
        .fh-abas button.ativa { color: #C92E09; border-bottom-color: #C92E09; }
        .fh-abas button:disabled { opacity: 0.45; cursor: not-allowed; }
        .fh-busca {
          width: 100%; box-sizing: border-box; padding: 8px 11px; margin-bottom: 10px; border-radius: 9px;
          border: 1px solid #E2E8F0; font-size: 0.82rem; font-family: inherit; outline: none;
        }
        .fh-busca:focus { border-color: #94A3B8; }
        /* ── TEMPO E TAXA ───────────────────────────────────────────────── */
        .fh-tt-metodo {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          font-size: 0.76rem; color: #475569; font-weight: 600; margin-bottom: 14px;
          padding: 7px 10px; border-radius: 9px; background: #F8FAFC; border: 1px solid #F1F5F9;
        }
        .fh-tt-metodo button {
          border: none; background: transparent; color: #C92E09; font-weight: 800; font-size: 0.76rem;
          cursor: pointer; font-family: inherit; padding: 0;
        }
        .fh-tt-rotulo { font-size: 0.82rem; font-weight: 700; color: #0F172A; margin-bottom: 8px; }
        .fh-tt-ajustes { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
        .fh-tt-ajustes button {
          min-width: 0; padding: 7px 4px; border-radius: 999px; border: 1px solid #D4D4D8;
          background: #fff; color: #27272A; font-weight: 600; font-size: 0.78rem; cursor: pointer;
          font-family: inherit; white-space: nowrap; transition: background .12s ease, border-color .12s ease;
        }
        .fh-tt-ajustes button:hover { background: #F4F4F5; border-color: #A1A1AA; }
        .fh-tt-ajustes button:active { transform: scale(0.97); }
        .fh-tt-ajuda { margin: 7px 0 14px; font-size: 0.74rem; color: #334155; line-height: 1.4; }
        .fh-tt-tabela { display: flex; flex-direction: column; }
        .fh-tt-cab, .fh-tt-linha {
          display: grid; grid-template-columns: minmax(0, 1fr) 96px 104px; gap: 8px; align-items: center;
        }
        .fh-tt-cab {
          padding: 0 4px 8px; margin-bottom: 4px; border-bottom: 1px solid #E4E4E7;
          font-size: 0.8rem; font-weight: 700; color: #3F3F46;
        }
        .fh-tt-linha { padding: 5px 4px; border-radius: 8px; }
        .fh-tt-linha.foco { background: #FEF2F2; }
        .fh-tt-nome {
          font-size: 0.84rem; font-weight: 600; color: #18181B; min-width: 0;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .fh-tt-campo {
          display: flex; align-items: stretch; height: 36px; border: 1px solid #D4D4D8; border-radius: 8px;
          overflow: hidden; background: #fff; box-sizing: border-box;
        }
        .fh-tt-campo:focus-within { border-color: #71717A; box-shadow: 0 0 0 3px rgba(113,113,122,0.15); }
        .fh-tt-campo.invalido { border-color: #DC2626; background: #FEF2F2; }
        .fh-tt-campo input { flex: 1; padding: 0 6px !important; }
        .fh-tt-campo i {
          display: flex; align-items: center; padding: 0 8px; font-style: normal; font-size: 0.74rem;
          color: #71717A; background: #F4F4F5; flex-shrink: 0;
        }
        .fh-tt-campo i:first-child { border-right: 1px solid #E4E4E7; }
        .fh-tt-campo i:last-child { border-left: 1px solid #E4E4E7; }
        .fh-tt-todos {
          display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 12px; padding-top: 12px;
          border-top: 1px dashed #E4E4E7; font-size: 0.76rem; color: #334155;
        }
        .fh-tt-vazio { font-size: 0.8rem; color: #64748B; text-align: center; padding: 14px 6px; margin: 0; }
        .fh-painel-rodape { padding: 10px 14px 12px; border-top: 1px solid #F1F5F9; background: #fff; flex-shrink: 0; }
        .fh-add-principal {
          width: 100%; padding: 11px; border-radius: 10px; border: none; cursor: pointer;
          background: #C92E09; color: #fff; font-weight: 800; font-size: 0.88rem;
          display: flex; align-items: center; justify-content: center; gap: 7px;
          font-family: inherit; box-shadow: 0 4px 14px rgba(220,38,38,0.28);
        }
        .fh-add-principal:hover { background: #B71C1C; }
        .fh-repasse {
          border: 1.5px solid #E2E8F0; border-radius: 12px; padding: 11px 12px; margin-bottom: 16px; background: #FCFCFD;
        }
        .fh-repasse-opcoes { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
        .fh-repasse-opcoes button {
          flex: 1 1 140px; padding: 8px 10px; border-radius: 9px; cursor: pointer; font-family: inherit;
          font-size: 0.78rem; font-weight: 700; color: #334155; background: #fff; border: 1.5px solid #E2E8F0;
        }
        .fh-repasse-opcoes button.ativo { border-color: #0F766E; background: #F0FDFA; color: #0F766E; }
        .fh-repasse-ajuda { margin: 0 0 8px; font-size: 0.76rem; color: #334155; line-height: 1.45; }
        .fh-simulador {
          margin-top: 16px; border: 1.5px solid #BFDBFE; background: #F8FBFF; border-radius: 12px; padding: 12px;
        }
        .fh-sim-resultado {
          margin-top: 10px; background: #fff; border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px 11px;
        }
        .fh-sim-linhas { display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; margin: 0; font-size: 0.78rem; }
        .fh-sim-linhas dt { color: #94A3B8; font-weight: 700; }
        .fh-sim-linhas dd { margin: 0; color: #0F172A; font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
        .fh-sim-nota {
          margin: 8px 0 0; font-size: 0.74rem; line-height: 1.45; padding: 7px 9px; border-radius: 8px;
          background: #FFF7E6; color: #92400E; border: 1px solid #FDE68A;
        }
        @media (max-width: 1080px) {
          .fh-entrega-area { border: none; box-shadow: none; border-radius: 0; overflow: visible; }
          .fh-entrega-mapa {
            height: 340px; min-height: 0; border-radius: 14px; overflow: hidden;
            border: 2px solid #E2E8F0; box-shadow: 0 4px 20px rgba(0,0,0,0.08);
          }
          .fh-entrega-painel {
            position: static; width: auto; margin-top: 12px;
            border: 1.5px solid #E2E8F0; box-shadow: 0 4px 20px rgba(0,0,0,0.06);
          }
          .fh-painel-corpo { overflow-y: visible; }
          .fh-confirmar-pino, .fh-mapa-rodape { right: 12px; }
          .fh-dica-do-mapa { right: 12px; max-width: none; font-size: 0.76rem; padding: 7px 12px; border-radius: 12px; }
          .fh-legenda-manchas { max-width: none; font-size: 0.68rem; padding: 6px 9px; }
          /* No celular o mapa tem 340 px: a legenda inteira cobriria metade dele. */
          .fh-legenda-rota { max-width: none; font-size: 0.68rem; padding: 5px 8px; }
          .fh-legenda-longa { display: none; }
        }

        .custom-map-tooltip {
          background: rgba(15, 23, 42, 0.9) !important;
          border: 1px solid rgba(255, 255, 255, 0.25) !important;
          color: #ffffff !important;
          font-weight: 700 !important;
          font-size: 0.76rem !important;
          border-radius: 8px !important;
          padding: 4px 8px !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25) !important;
          font-family: 'Inter', sans-serif !important;
        }
        .custom-map-tooltip::before {
          border-top-color: rgba(15, 23, 42, 0.9) !important;
        }
        .ifood-clean-tooltip {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        .ifood-clean-tooltip::before {
          display: none !important;
        }
      `}</style>
    </div>
  );
}

const caixaDoCampo: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "7px 8px", borderRadius: 8, border: "1px solid #E2E8F0", fontSize: "0.84rem", textAlign: "center", outline: "none", fontFamily: "inherit" };

const adjBtn: React.CSSProperties = {
  padding: "5px 10px", borderRadius: "6px", border: "1px solid #E2E8F0",
  background: "#fff", color: "#334155", fontWeight: 600, fontSize: "0.75rem",
  cursor: "pointer", fontFamily: "inherit",
};
