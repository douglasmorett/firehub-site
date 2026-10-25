"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  MapPin,
  X,
  Search,
  Check,
  Navigation,
  Copy,
  Trash2,
  Loader2,
  RefreshCw,
  CheckCircle2,
  ExternalLink
} from "lucide-react";
import {
  calculateHaversineKm,
  isPointInSea,
  cleanAddressForGeocoding,
  dicionarioDeBairro,
  estadoPeloEndereco,
  criarGeocodificador,
  parseAddressDetails as parseEnderecoDaEntrega,
} from "@/lib/geocodificacao";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { lerRespostaDoLote, resumoDoLote, tirarDoPalpite, type AcaoDoLote } from "@/lib/lote-da-roteirizacao";
import {
  ESPERA_SEM_RESPOSTA_MS,
  NOME_DA_FONTE,
  fonteDaGeocodificacao,
  motivoForaDaArea,
  planoDosPontos,
  pontoPlausivel,
  raioDoPedido,
  type AreaDaLoja,
  type FonteDoPonto,
  type PedidoNoMapa,
  type Resolucao,
} from "@/lib/ponto-do-pedido";
import { rotaJaDespachada, rotasComLinha, pontosDaLinha, podarCoordenadas, pernasDaLinha, linhaPelaRua, PERNAS_POR_PEDIDO_DE_DESENHO } from "@/lib/rotas-no-mapa";
import TutorialDaTela from "@/components/TutorialDaTela";
import { linkDaRotaNoMaps } from "@/lib/link-da-rota";
import { bairroPeloEndereco, type ZonaComApelidos } from "@/lib/bairro-pelo-endereco";
import RotaAutomatica, { type PreviaDaRotaAutomatica, type RotaAutomaticaConfig, type RotaAutomaticaEstado } from "@/components/customer/RotaAutomatica";
import { pontoParaRotaAutomatica } from "@/lib/roteirizacao-automatica/ponto";
import { infoDaEntrega } from "@/lib/entrega-parceira";

// ── Aviso que desce do topo (no lugar do alert()) ─────────────────────────
// Mesma interface do components/AvisoNoTopo.tsx de outra frente, que ainda não
// está no master (MesasCelular e StoreTopNav têm a mesma cópia): quando
// estiver, troque este bloco pelo import. Aqui ele mora DENTRO da tela da
// roteirização (que já é uma camada fixa por cima de tudo), por isso o
// z-index alto: tem de ficar acima do modal de despacho.
//
// O alert() do despacho era o pior lugar para ele: o "OK" travava a página
// inteira — mapa, listas e as consultas de 4 e 8 s, que disparavam todas
// juntas ao fechar — e era o "aparece a mensagem em cima" do Lucas.
// `fixo`: não some sozinho (a senha do entregador recém-cadastrado precisa ser anotada).
type Aviso = { tipo: "ok" | "erro" | "atencao" | "info"; titulo: string; detalhe?: string; fixo?: boolean };
const COR_DO_AVISO: Record<Aviso["tipo"], { cor: string; fundo: string }> = {
  ok: { cor: "#059669", fundo: "#ECFDF5" },
  erro: { cor: "#DC2626", fundo: "#FEF2F2" },
  atencao: { cor: "#D97706", fundo: "#FFFBEB" },
  info: { cor: "#2563EB", fundo: "#EFF6FF" },
};
function AvisoNoTopo({ aviso, onFechar }: { aviso: Aviso | null; onFechar: () => void }) {
  const [parado, setParado] = useState(false);
  useEffect(() => {
    if (!aviso || parado || aviso.fixo) return;
    const t = setTimeout(onFechar, aviso.tipo === "erro" ? 12000 : 6000);
    return () => clearTimeout(t);
  }, [aviso, onFechar, parado]);
  if (!aviso) return null;
  const { cor, fundo } = COR_DO_AVISO[aviso.tipo];
  return (
    <div
      role={aviso.tipo === "erro" ? "alert" : "status"}
      onClick={onFechar}
      onMouseEnter={() => setParado(true)}
      onMouseLeave={() => setParado(false)}
      style={{
        position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 100002,
        width: "min(440px, calc(100vw - 24px))", background: fundo, borderLeft: `4px solid ${cor}`,
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 10px 30px rgba(15,23,42,.18)", cursor: "pointer",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A" }}>{aviso.titulo}</div>
      {aviso.detalhe && <div style={{ fontSize: 13, color: "#475569", marginTop: 2 }}>{aviso.detalhe}</div>}
    </div>
  );
}

interface Motoboy {
  id: string;
  name: string;
  phone?: string;
}

interface CustomerOrder {
  id: string;
  dailyOrderNumber?: number | string;
  orderNumber?: number | string;
  displayId?: string;
  ifoodReference?: string;
  openDeliveryReference?: string;
  customerName: string;
  customerPhone?: string;
  address?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  status: string;
  totalAmount?: number;
  itemsCount?: number;
  items?: any[];
  platform?: string;
  createdAt: string;
  motoboyId?: string;
  motoboy?: Motoboy;
  routeId?: string;
}

export const getOrderDisplayNumber = (order: any): string => {
  if (!order) return "—";
  if (order.dailyOrderNumber != null && order.dailyOrderNumber !== "") {
    return String(order.dailyOrderNumber);
  }
  if (order.ifoodReference) return String(order.ifoodReference);
  if (order.openDeliveryReference) return String(order.openDeliveryReference);
  if (order.orderNumber) return String(order.orderNumber);
  if (order.displayId) return String(order.displayId);
  return String(order.id || "").slice(-4).toUpperCase();
};

/**
 * O pedido já saiu da cozinha?
 *
 * Quatro lugares desta tela precisavam da resposta — a contagem do botão
 * "Mostrar Prontos", o filtro da lista, a cor do pino e o número da legenda —
 * e cada um carregava a sua própria cópia da regra, com listas de status que
 * já não batiam entre si. Agora a regra é uma só.
 */
export const pedidoJaEstaPronto = (order: any): boolean => {
  const s = String(order?.status || "").toUpperCase().trim();
  return (
    s === "PRONTO" ||
    s === "PRONTO_ENTREGA" ||
    s === "PREPARADO" ||
    s === "READY" ||
    s === "FINISHED" ||
    order?.kdsStage === "READY" ||
    order?.kdsStage === "FINISHED"
  );
};

/**
 * Quanto tempo o mouse fica parado no pino antes da caixa do pedido abrir.
 *
 * Imediato atrapalhava o clique; 3 s (a primeira ideia) faz a caixa parecer
 * quebrada — quem quer conferir desiste antes. 1 s separa "passei por cima"
 * de "parei para ler".
 */
const ESPERA_DA_CAIXA_DO_PINO_MS = 1000;

/**
 * O que aparece ao passar o mouse no pino do mapa.
 *
 * O lojista mostrou o que o outro sistema entrega aqui: número, cliente, taxa
 * de entrega, taxa do entregador, endereço com complemento, prazo, forma de
 * pagamento e — nos pedidos do 99Food — o localizador e o código de retirada.
 * O nosso mostrava três linhas e nenhum horário. Quem está montando rota às
 * 22h decide por estes dados; abrir o pedido no painel para ver o prazo é o
 * que fazia a rota sair errada.
 */
export const popupDoPedido = (
  order: any,
  jaDespachado: boolean,
  pronto: boolean,
  local?: { fonte: FonteDoPonto; aproximado: boolean },
): string => {
  const esc = (t: unknown) =>
    String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const num = getOrderDisplayNumber(order);
  const pag = getOrderPaymentInfo(order);
  const endereco = order.customerAddress || order.address || `${order.street || ""} ${order.number || ""} ${order.neighborhood || ""}`.trim();
  // O prazo real, quando existe: agendamento do cliente, prazo do parceiro ou
  // o tempo de entrega configurado pela loja. O fallback de 45 minutos só entra
  // quando não há nenhum dos três — e aí aparece marcado como estimativa, para
  // ninguém montar rota confiando num número que o sistema inventou.
  const prazo =
    order.scheduledDatetime || order.prazoEntrega || order.deliveryDeadline || order.ifoodDeliveryDateTime || null;
  const criado = order.createdAt ? new Date(order.createdAt) : null;
  const minutosDaLoja = Number(order.estimatedDeliveryMinutes || order.deliveryTimeMinutes || 0);
  const entregarAte = prazo
    ? new Date(prazo)
    : criado
    ? new Date(criado.getTime() + (minutosDaLoja > 0 ? minutosDaLoja : 45) * 60000)
    : null;
  const prazoEstimado = !prazo;
  const taxa = Number(order.deliveryFee || 0);
  const taxaMotoboy = Number(order.motoboyFee || 0);
  const estado = jaDespachado ? "🛵 saiu para entrega" : pronto ? "✅ pronto" : "👨‍🍳 na cozinha";
  const linhas: string[] = [
    `<b style="color:#0F172A;font-size:0.95rem;">Pedido #${esc(num)}</b> <span style="color:#64748B;">${estado}</span>`,
    `👤 ${esc(order.customerName || "Cliente")}`,
    order.customerPhone ? `📞 ${esc(order.customerPhone)}` : "",
    endereco ? `<span style="color:#334155;">📍 ${esc(endereco)}</span>` : "",
    // De onde saiu o ponto: quem monta a rota sabe quando desconfiar dele.
    local
      ? `<span style="color:${local.aproximado ? "#B45309" : "#64748B"};">🧭 Local: ${esc(NOME_DA_FONTE[local.fonte] || local.fonte)}${local.aproximado ? " — confira (botão direito no pino corrige)" : ""}</span>`
      : "",
    entregarAte
      ? `<b style="color:#B45309;">⏰ Entregar até ${entregarAte.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</b>${prazoEstimado ? ` <span style="color:#94A3B8;font-weight:400;">(estimado)</span>` : ""}`
      : "",
    `💰 R$ ${Number(order.totalAmount || 0).toFixed(2)}${taxa > 0 ? ` · entrega R$ ${taxa.toFixed(2)}` : ""}${taxaMotoboy > 0 ? ` · entregador R$ ${taxaMotoboy.toFixed(2)}` : ""}`,
    pag.methodRaw ? `💳 ${esc(pag.methodRaw)}${pag.changeNeeded > 0 ? ` — troco R$ ${pag.changeNeeded.toFixed(2)}` : ""}` : "",
    // O que o entregador precisa na porta do cliente, sem sair do mapa.
    (order as any).openDeliveryReference && /99/i.test(String(order.source || order.openDeliveryChannel || ""))
      ? `🔑 Localizador ${esc((order as any).food99Locator || (order as any).openDeliveryReference)}`
      : "",
    (order as any).ifoodPickupCode ? `🔑 Código de retirada ${esc((order as any).ifoodPickupCode)}` : "",
    order.notes ? `<span style="color:#92400E;">📝 ${esc(String(order.notes).slice(0, 160))}</span>` : "",
    (order as any).motoboy?.name ? `🛵 ${esc((order as any).motoboy.name)}` : "",
  ].filter(Boolean);
  return `<div style="font-family: sans-serif; font-size: 0.82rem; padding: 2px; line-height:1.5; max-width: 280px;">${linhas.join("<br/>")}</div>`;
};

export const getOrderPaymentInfo = (order: any) => {
  if (!order) return { isCash: false, isCardOnDelivery: false, changeNeeded: 0, methodRaw: "" };

  const methodRaw = String(order.paymentMethod || order.payment_method || order.paymentType || "").toUpperCase();
  const notesRaw = String(order.notes || "").toUpperCase();
  const total = Number(order.totalAmount || 0);

  const isCash = methodRaw.includes("DINHEIRO") || methodRaw.includes("CASH") || notesRaw.includes("DINHEIRO") || notesRaw.includes("TROCO");
  const isCardOnDelivery = methodRaw.includes("CARTAO") || methodRaw.includes("MAQUINA") || methodRaw.includes("MAQUININHA") || methodRaw.includes("DEBITO") || methodRaw.includes("CREDITO") || methodRaw.includes("VALE") || notesRaw.includes("LEVAR MAQUINA") || notesRaw.includes("MAQUININHA");

  let changeNeeded = 0;
  if (typeof order.changeAmount === "number" && order.changeAmount > 0) {
    changeNeeded = order.changeAmount > total ? (order.changeAmount - total) : order.changeAmount;
  } else {
    const match = notesRaw.match(/TROCO\s*(?:PARA)?\s*R?\$?\s*(\d+[\.,]?\d*)/i) || notesRaw.match(/TROCO\s*(\d+[\.,]?\d*)/i);
    if (match && match[1]) {
      const trocoPara = parseFloat(match[1].replace(",", "."));
      if (trocoPara > total) {
        changeNeeded = trocoPara - total;
      } else {
        changeNeeded = trocoPara;
      }
    }
  }

  return {
    isCash,
    isCardOnDelivery,
    changeNeeded,
    methodRaw
  };
};

interface RouteItem {
  id: string;
  routeNumber: number | string;
  motoboyName: string;
  motoboyPhone?: string;
  motoboyId?: string;
  color: string;
  orders: CustomerOrder[];
  createdAt: string;
  status: string;
  /** "AUTO" = criada pela Rota 100% automatizada (selo 🤖); nulo/"MANUAL" = montada pela loja. */
  origem?: string | null;
  /** Fase 2: quando a rota automática pronta chamou o motoboy, e quem. */
  chamadaEm?: string | null;
  chamadaMotoboyId?: string | null;
}

/**
 * A rota como o servidor manda (GET e POST de /api/store/routes) → o card da
 * aba ROTAS. Um lugar só: a lista que chega a cada 4 s e a rota recém-criada,
 * que entra na lista na hora sem esperar a próxima consulta.
 *
 * O número do pedido (`dailyOrderNumber`, ou a referência do parceiro) não
 * era repassado: o card e o COPIAR mostravam o fim do id.
 */
const rotaDaTela = (r: any): RouteItem => ({
  id: r.id,
  routeNumber: r.routeNumber,
  motoboyName: r.motoboy?.name || "Aguardando Motoboy",
  motoboyPhone: r.motoboy?.phone || "",
  motoboyId: r.motoboyId || null,
  color: r.color || "#1C1917",
  orders: (r.orders || []).map((o: any) => ({
    id: o.id,
    dailyOrderNumber: o.dailyOrderNumber,
    ifoodReference: o.ifoodReference,
    openDeliveryReference: o.openDeliveryReference,
    customerName: o.customerName || "Cliente",
    customerPhone: o.customerPhone,
    address: o.customerAddress,
    status: o.status,
    // O pronto do KDS, para o "2/3 prontos" da rota automática (pedidoJaEstaPronto).
    kdsStage: o.kdsStage,
    totalAmount: o.totalAmount,
  })),
  createdAt: new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  status: r.status === "DISPATCHED" ? "🚀 Despachada" : "⏳ Aguardando Despacho",
  origem: r.origem ?? null,
  chamadaEm: r.chamadaEm ?? null,
  chamadaMotoboyId: r.chamadaMotoboyId ?? null,
});

/**
 * A linha de estado do card da rota automática. Fase 1: a rota nasce, cresce
 * e espera a cozinha — "aguardando cozinha · 2/3 prontos". Fase 2: chamada
 * pelo servidor, "chamada · Maicon (há 2 min)" / "chamada · todos os
 * entregadores (há 2 min)" pelo `chamadaEm`/`chamadaMotoboyId`; e
 * "despachada · Maicon" quando saiu (puxada pelo QR, ou terminou sozinha).
 */
const estadoDaRotaAutomatica = (route: RouteItem, nomeDoMotoboy: (id: string) => string, agora = Date.now()): string | null => {
  if (route.origem !== "AUTO") return null;
  if (rotaJaDespachada(route)) {
    const quem = route.motoboyId ? nomeDoMotoboy(route.motoboyId) : "";
    return quem ? `despachada · ${quem}` : "despachada";
  }
  if (route.chamadaEm) {
    const min = Math.max(0, Math.floor((agora - new Date(route.chamadaEm).getTime()) / 60_000));
    const ha = min < 1 ? "agora" : `há ${min} min`;
    const quem = route.chamadaMotoboyId ? nomeDoMotoboy(route.chamadaMotoboyId) || "o entregador" : "todos os entregadores";
    return `chamada · ${quem} (${ha})`;
  }
  // O que já saiu (puxado sozinho pelo QR) também não espera mais a cozinha.
  const prontos = route.orders.filter((o) => pedidoJaEstaPronto(o) || o.status === "SAIU_ENTREGA" || o.status === "ENTREGUE").length;
  // Tudo pronto e ainda sem chamada: o cron chama no próximo ciclo (a rota de
  // 1 espera companhia até `esperaMaxMin`); até lá, e com a automática
  // desligada, quem despacha é a loja (o select do card).
  if (route.orders.length > 0 && prontos === route.orders.length) return "pronta · escolha o motoboy para despachar";
  return `aguardando cozinha · ${prontos}/${route.orders.length} pronto${route.orders.length > 1 ? "s" : ""}`;
};

interface RoteirizacaoModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: CustomerOrder[];
  storeAddress?: string;
  storeCity?: string;
  storeSlug?: string;
  storeId?: string;
  storeLatLng?: { lat: number; lng: number } | null;
  onRefreshOrders?: () => void;
  onUpdateOrderStatus?: (orderId: string, status: string, motoboyId?: string) => Promise<void>;
  /**
   * A roteirização aberta como PÁGINA (/store/roteirizacao), numa aba só dela.
   *
   * A loja deixa o mapa aberto a noite inteira num monitor e a aba de pedidos
   * em outro; sem isto, roteirizar era sempre um modal em cima do painel, e
   * fechar o painel (ou trocar de aba) fechava o mapa junto. Neste modo o
   * quadro ocupa a tela inteira, o botão "Abrir em aba separada" some (já
   * está nela) e "Fechar" fecha a própria aba.
   */
  modoIndependente?: boolean;
  /**
   * Os bairros cadastrados da loja que cobra por bairro (nome + apelidos;
   * lib/bairro-pelo-endereco.ts, `zonasDeBairro`). Com eles, o "Bairro:" do
   * cartão mostra o bairro DA LOJA que o endereço indica — o pedido de app
   * chega com "... - Sobradinho - Brasília" ou "- QUADRA 12 - Brasília/DF", e
   * o cartão mostrava "Bairro: Brasília/DF". Vazio = como sempre.
   */
  bairrosDaLoja?: ZonaComApelidos[];
  /**
   * Até onde um ponto ACHADO PELO TEXTO vale (km do pino da loja), para os
   * canais da loja e para marketplace — lib/ponto-do-pedido.ts, `areaDaLoja`.
   * Só vem quando a loja tem o pino salvo; sem ele, quem confere é o servidor.
   */
  areaDoMapa?: { raioKm: number; raioDoParceiroKm: number } | null;
  /**
   * A loja dona do mapa (o pino e a área acima). Em "Todas as lojas", pedido
   * de outra loja não é medido pela área desta — o servidor mede com a dele.
   * `storeId` não serve: é o usuário da sessão (o funcionário, quando é ele).
   */
  lojaDoMapaId?: string | null;
}

/**
 * As cores do ESTADO do pedido no mapa — ditadas pelo lojista, a mesma
 * convenção do outro sistema que ele usa: vermelho na cozinha, roxo pronto,
 * azul saiu para entrega, verde entregue agora.
 *
 * Não seguem a paleta do painel de propósito. A troca para a paleta Brasa
 * (23/09/2026) deixou o pronto cinza e o "saiu" quase preto, e a Frangoso
 * passou a ver "outra cor" onde esperava o azul (Lucas, 29/09).
 */
const COR_DO_ESTADO = {
  cozinha: "#EF4444",
  pronto: "#7C3AED",
  rota: "#2563EB",
  entregue: "#16A34A",
} as const;

/**
 * Cor da rota que está sendo montada. Nenhuma pode ser parecida com as do
 * estado: com "#C92E09" na lista, a rota pintava os pinos do mesmo vermelho
 * da cozinha e o mapa da Frangoso ficou inteiro vermelho (29/09/2026).
 */
const ROUTE_COLORS = [
  "#F59E0B", // Âmbar
  "#EC4899", // Rosa
  "#06B6D4", // Ciano
  "#F97316", // Laranja
  "#84CC16", // Lima
  "#92400E", // Marrom
  "#DB2777", // Pink escuro
  "#0891B2"  // Petróleo
];

export default function RoteirizacaoModal({
  isOpen,
  onClose,
  orders = [],
  storeAddress = "",
  // Vazio, nunca "Rio das Ostras": a cidade entra na busca de endereço e no
  // texto da rota que vai para o motoboy. Chutar a cidade de outra loja manda
  // o entregador para outro município — melhor não opinar.
  storeCity = "",
  storeSlug,
  storeId,
  storeLatLng = null,
  onRefreshOrders,
  onUpdateOrderStatus,
  bairrosDaLoja,
  areaDoMapa = null,
  lojaDoMapaId = null,
  modoIndependente = false
}: RoteirizacaoModalProps) {
  const [activeTab, setActiveTab] = useState<"PENDING" | "ROTAS">("PENDING");
  // A tela ainda está aberta? A busca dos endereços termina depois de quem a
  // começou ter saído, e não pode mexer em estado de quem já foi embora.
  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  // Motoboys no mapa: LIGADO por padrão. Quem não quiser ver desmarca — o
  // contrário (nascer desmarcado) esconderia informação de quem nem sabe que
  // ela existe.
  const [mostrarMotoboys, setMostrarMotoboys] = useState(true);

  /**
   * Quais estados de pedido aparecem no mapa.
   *
   * A cor sozinha é adivinhação: o lojista ditou o significado dela (vermelho
   * cozinha, roxo pronto, azul em entrega, verde entregue) mas quem abre o mapa
   * sem ter ouvido isso não tem como saber. A legenda diz o que é cada uma — e,
   * já que está ali, serve de interruptor: em noite cheia dá para esconder o que
   * já saiu e ficar só com o que falta despachar.
   */
  const [estadosNoMapa, setEstadosNoMapa] = useState({
    cozinha: true,
    pronto: true,
    rota: true,
    entregue: true,
  });
  const [hoveredOrderId, setHoveredOrderId] = useState<string | null>(null);
  const [motoboys, setMotoboys] = useState<Motoboy[]>([]);

  // Custom Created Routes State
  const [createdRoutes, setCreatedRoutes] = useState<RouteItem[]>([]);
  // Os pedidos que a loja tirou de uma rota automática (Desfazer ou tirados
  // dela): o cron não os agrupa até o "voltar". Vem com o GET das rotas.
  const [foraDaAutomatica, setForaDaAutomatica] = useState<Set<string>>(() => new Set());

  // Saipos Roteirização Configuration Settings
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [routeMode, setRouteMode] = useState<"Manual" | "Automatizada" | "Inteligente">("Inteligente");
  const [onlyProntoOrders, setOnlyProntoOrders] = useState(false); // Roteirizar só os prontos ou todos
  const [maxWaitMinutes, setMaxWaitMinutes] = useState(5);
  const [targetStatus, setTargetStatus] = useState("Cozinha");
  const [autoMoveStatus, setAutoMoveStatus] = useState("Não");
  const [autoPrint, setAutoPrint] = useState("Não");
  const [maxOrdersPerRoute, setMaxOrdersPerRoute] = useState(3);
  const [maxDistanceKm, setMaxDistanceKm] = useState(2);

  // Dispatch Modal
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [selectedMotoboyId, setSelectedMotoboyId] = useState("");
  const [customMotoboyName, setCustomMotoboyName] = useState("");
  const [customMotoboyPhone, setCustomMotoboyPhone] = useState("");
  const [sendWhatsAppToMotoboy, setSendWhatsAppToMotoboy] = useState(true);
  const [isDispatching, setIsDispatching] = useState(false);
  const [copiedRouteId, setCopiedRouteId] = useState<string | null>(null);

  // Retorno das ações (despachar, criar rota, trocar entregador…) no topo da
  // tela, sem o alert() que travava a página — ver AvisoNoTopo acima.
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const fecharAviso = useCallback(() => setAviso(null), []);

  // ✏️ Editar do card da rota (antes de despachar): `ids` é a rota como vai
  // ficar — tirar e incluir mexem só aqui; o Salvar manda para o PATCH.
  const [rotaEmEdicao, setRotaEmEdicao] = useState<{ routeId: string; ids: string[] } | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  // Trava do despacho que vale JÁ no clique. O `isDispatching` é estado do
  // React e só chega ao botão no próximo desenho — e na criação da rota ele
  // nem era ligado: o botão seguia clicável e sem "carregando" durante a
  // primeira chamada, o lojista apertava de novo, e cada clique criava uma
  // rota com os mesmos pedidos (e o motoboy recebia duas mensagens).
  const despachandoRef = useRef(false);

  // A rota que o lojista pediu para ver no mapa ("Ver no mapa" no card).
  // Rota despachada só vira linha assim — ver lib/rotas-no-mapa.ts.
  const [rotaEmFoco, setRotaEmFoco] = useState<string | null>(null);

  // Resumo de Troco Total e Maquininha para a Rota Selecionada
  const routePaymentSummary = useMemo(() => {
    let totalChangeToCarry = 0;
    let needsCardMachine = false;
    let cashOrdersCount = 0;
    let cardOrdersCount = 0;

    selectedOrderIds.forEach((id) => {
      const order = orders.find((o) => o.id === id);
      if (!order) return;

      const info = getOrderPaymentInfo(order);
      if (info.isCash) {
        cashOrdersCount++;
        totalChangeToCarry += info.changeNeeded;
      }
      if (info.isCardOnDelivery) {
        cardOrdersCount++;
        needsCardMachine = true;
      }
    });

    return {
      totalChangeToCarry,
      needsCardMachine,
      cashOrdersCount,
      cardOrdersCount,
    };
  }, [selectedOrderIds, orders]);

  // Map & Geocoding State
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const markersRef = useRef<Map<string, any>>(new Map());
  const polylinesRef = useRef<any[]>([]);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [geocodedMap, setGeocodedMap] = useState<Record<string, { lat: number; lng: number }>>({});
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  /** Força o redesenho do mapa para o pino verde sumir na hora certa. */
  const [tiqueDoMapa, setTiqueDoMapa] = useState(0);

  // ── DE ONDE O MAPA PARTE ────────────────────────────────────────────────
  //
  // Era Rio das Ostras fixo quando a loja não tinha `storeLatLng` — e é o caso
  // da maioria das lojas, porque o campo só é gravado por quem abre Minha Loja
  // → Área de entrega e salva o pino. Uma pizzaria de São Paulo abria a
  // roteirização e via o litoral fluminense, com a casinha dela a 400 km.
  //
  // Agora quem manda o ponto é o servidor (lib/ponto-da-loja-servidor): pino
  // salvo, senão o ENDEREÇO do cadastro geocodificado. Aqui só sobrou o caso de
  // a loja não ter nem endereço — e aí o mapa abre no Brasil e pede o endereço,
  // em vez de plantar a loja numa cidade que não é a dela.
  const pontoDaLoja = useMemo(() => lerPontoDaLoja(storeLatLng), [storeLatLng]);
  const temPontoDaLoja = pontoDaLoja !== null;
  /** Só para a matemática das rotas não precisar de um `null` em cada conta. */
  const defaultCenter = useMemo(
    () => pontoDaLoja || { lat: -14.235, lng: -51.925 }, // centro do Brasil
    [pontoDaLoja],
  );

  // UF da loja para as buscas (null = sem estado). Ver lib/geocodificacao.ts.
  const estadoDaLoja = useMemo(() => estadoPeloEndereco(storeAddress), [storeAddress]);

  // Load Leaflet CSS & Script dynamically
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as any).L) {
      setLeafletLoaded(true);
      return;
    }
    // O Leaflet é servido do NOSSO domínio (public/leaflet, copiado de
    // node_modules/leaflet/dist). Vinha do unpkg.com — e o CSP de 26/08 só
    // libera script de 'self' + os SDKs de pagamento/pixel, então o navegador
    // bloqueava o load em silêncio e o mapa da roteirização abria em branco,
    // com a lista de pedidos funcionando ao lado. Servir local conserta o mapa
    // SEM abrir o script-src para um CDN de terceiros inteiro.
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/leaflet/leaflet.css";
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = "/leaflet/leaflet.js";
    script.onload = () => setLeafletLoaded(true);
    document.head.appendChild(script);
  }, []);

  // Load Motoboys from API (Pré-carrega em background sem atrasar a abertura)
  useEffect(() => {
    const fetchMotoboys = async () => {
      try {
        const res = await fetch("/api/motoboys");
        if (res.ok) {
          const data = await res.json();
          setMotoboys(Array.isArray(data) ? data : data.motoboys || []);
        }
      } catch (err) {
        console.error("Erro ao buscar motoboys:", err);
      }
    };
    fetchMotoboys();
  }, []);

  // ── Posição dos motoboys AO VIVO ──────────────────────────────────────────
  //
  // A lista de motoboys era carregada UMA vez, na montagem — a posição no mapa
  // era a de quando a tela abriu, congelada. O app do entregador manda GPS a
  // cada ~12s; sem este poll, nada disso chegava ao mapa. Só as coordenadas
  // são mescladas (por id): o resto do objeto (ganhos do dia etc.) fica como
  // está, senão o poll apagaria campos que a listagem completa calculou.
  useEffect(() => {
    if (!isOpen) return;
    let vivo = true;

    const atualizarPosicoes = async () => {
      try {
        const res = await fetch("/api/motoboys/location");
        if (!res.ok) return;
        const data = await res.json();
        const posPorId: Record<string, any> = {};
        (data.motoboys || []).forEach((m: any) => { posPorId[m.id] = m; });
        if (!vivo) return;
        // Ninguém se mexeu → a MESMA lista. Lista nova a cada 10 s apagava e
        // recriava todos os pinos do mapa (e fechava a caixa do pino aberta)
        // sem nada ter mudado — e na loja que não usa o app do entregador (a
        // Frangoso) nenhuma posição muda a noite inteira.
        setMotoboys(prev => {
          let mudou = false;
          const proxima = prev.map(mb => {
            const pos = posPorId[(mb as any).id];
            if (!pos) return mb;
            const atual = mb as any;
            if (
              atual.lastLat === pos.lastLat &&
              atual.lastLng === pos.lastLng &&
              atual.lastLocationUpdate === pos.lastLocationUpdate
            ) return mb;
            mudou = true;
            return { ...mb, lastLat: pos.lastLat, lastLng: pos.lastLng, lastLocationUpdate: pos.lastLocationUpdate };
          });
          return mudou ? proxima : prev;
        });
      } catch {}
    };

    atualizarPosicoes();
    const id = setInterval(atualizarPosicoes, 10_000);
    return () => { vivo = false; clearInterval(id); };
  }, [isOpen]);

  // Forçar resize do mapa instantaneamente ao abrir a modal pré-carregada
  useEffect(() => {
    if (isOpen && leafletMapRef.current) {
      setTimeout(() => {
        try {
          leafletMapRef.current?.invalidateSize();
        } catch {}
      }, 100);
    }
  }, [isOpen]);

  // Load saved routes and config from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = localStorage.getItem("firehub_created_routes");
      if (saved) {
        setCreatedRoutes(JSON.parse(saved));
      }

      const savedConfig = localStorage.getItem("firehub_roteirizacao_config");
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        if (parsed.routeMode) setRouteMode(parsed.routeMode);
        if (typeof parsed.onlyProntoOrders === "boolean") setOnlyProntoOrders(parsed.onlyProntoOrders);
        if (parsed.maxWaitMinutes) setMaxWaitMinutes(parsed.maxWaitMinutes);
        if (parsed.targetStatus) setTargetStatus(parsed.targetStatus);
        if (parsed.autoMoveStatus) setAutoMoveStatus(parsed.autoMoveStatus);
        if (parsed.autoPrint) setAutoPrint(parsed.autoPrint);
        if (parsed.maxOrdersPerRoute) setMaxOrdersPerRoute(parsed.maxOrdersPerRoute);
        if (parsed.maxDistanceKm) setMaxDistanceKm(parsed.maxDistanceKm);
        if (parsed.estadosNoMapa && typeof parsed.estadosNoMapa === "object") {
          setEstadosNoMapa((atual) => ({ ...atual, ...parsed.estadosNoMapa }));
        }
      }
    } catch (e) {}
  }, []);

  // ── ROTA 100% AUTOMATIZADA (o botão roxo ao lado do seletor dos modos) ──
  //
  // O estado vem do servidor ao abrir o quadro de Configurações: loja fora da
  // liberação (hoje só a Hakim Centro) recebe `liberada: false` e o botão nem
  // aparece. Salvar é o PUT da mesma rota, que devolve o estado novo.
  // Plano: vault "FireHub - Plano despacho automático".
  const [rotaAuto, setRotaAuto] = useState<RotaAutomaticaEstado | null>(null);
  const [salvandoRotaAuto, setSalvandoRotaAuto] = useState(false);
  const carregarRotaAuto = useCallback(async () => {
    try {
      const r = await fetch("/api/store/roteirizacao-automatica", { cache: "no-store" });
      const d = await r.json().catch(() => null);
      setRotaAuto(r.ok && d?.liberada ? d : null);
    } catch {
      setRotaAuto(null);
    }
  }, []);
  // Também ao abrir a Roteirização (uma vez, não a cada consulta): ligada, a
  // lista de pendentes marca o pedido que a rota automática deixa de fora
  // por falta de localização.
  useEffect(() => {
    if (showConfigModal || isOpen) carregarRotaAuto();
  }, [showConfigModal, isOpen, carregarRotaAuto]);
  const rotaAutoLigada = !!rotaAuto?.config.ativo;
  /**
   * Ligada, o pedido sem ponto confiável (o centro do bairro não serve) fica
   * fora da rota automática — D3. A regra é a do servidor
   * (lib/roteirizacao-automatica/ponto.ts), medida aqui com a área da tela:
   * sem perguntar ao servidor a cada consulta. Entrega do parceiro e pedido
   * já com motoboy nem entram na rota automática: não ganham o aviso.
   */
  const semPontoParaRotaAuto = (order: any): boolean =>
    rotaAutoLigada &&
    !order?.motoboyId &&
    !infoDaEntrega(order).parceira &&
    !pontoParaRotaAutomatica(order?.customerLatLng, canalDoPedido(order).ehMarketplace, areaDaTela);
  const salvarRotaAuto = async (config: RotaAutomaticaConfig) => {
    const ligando = config.ativo && !rotaAuto?.config.ativo;
    const desligando = !config.ativo && !!rotaAuto?.config.ativo;
    setSalvandoRotaAuto(true);
    try {
      const r = await fetch("/api/store/roteirizacao-automatica", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roteirizacaoAutomatica: config }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        setAviso({ tipo: "erro", titulo: "A rota automática não foi salva", detalhe: d?.error || "Tente de novo." });
        return;
      }
      if (d?.liberada) setRotaAuto(d);
      else await carregarRotaAuto();
      setAviso({
        tipo: "ok",
        titulo: ligando ? "Roteirização automática ligada" : desligando ? "Roteirização automática desligada" : "Regras da rota automática salvas",
      });
    } catch (err: any) {
      setAviso({ tipo: "erro", titulo: "A rota automática não foi salva", detalhe: err?.message || String(err) });
    } finally {
      setSalvandoRotaAuto(false);
    }
  };
  const carregarPreviaRotaAuto = async (): Promise<PreviaDaRotaAutomatica> => {
    const r = await fetch("/api/store/roteirizacao-automatica/previa", { cache: "no-store" });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new Error(d?.error || "Não consegui montar a prévia agora.");
    return d;
  };

  // Save config to localStorage
  const handleSaveConfig = () => {
    try {
      const cfg = {
        routeMode,
        onlyProntoOrders,
        maxWaitMinutes,
        targetStatus,
        autoMoveStatus,
        autoPrint,
        maxOrdersPerRoute,
        maxDistanceKm
      };
      localStorage.setItem("firehub_roteirizacao_config", JSON.stringify(cfg));
    } catch (e) {}
    setShowConfigModal(false);
  };

  const handleToggleOnlyPronto = (val: boolean) => {
    setOnlyProntoOrders(val);
    try {
      const savedConfig = localStorage.getItem("firehub_roteirizacao_config");
      const parsed = savedConfig ? JSON.parse(savedConfig) : {};
      parsed.onlyProntoOrders = val;
      localStorage.setItem("firehub_roteirizacao_config", JSON.stringify(parsed));
    } catch (e) {}
  };

  // Save routes to API & localStorage
  const saveRoutes = (routes: RouteItem[]) => {
    setCreatedRoutes(routes);
    try {
      localStorage.setItem("firehub_created_routes", JSON.stringify(routes));
    } catch (e) {}
  };

  // ── A LISTA DE ROTAS SÓ MUDA QUANDO O SERVIDOR MUDA ─────────────────────
  //
  // A consulta roda a cada 4 s, e cada resposta virava uma lista NOVA mesmo
  // igual à anterior: o mapa apagava e recriava todos os pinos de 4 em 4 s
  // (e fechava a caixa do pino que o lojista estava lendo). Mesmo corpo de
  // resposta → nada muda na tela (o mesmo cuidado do feed de pedidos em
  // RoteirizacaoIndependente).
  const ultimoCorpoDasRotas = useRef("");
  // Uma rota criada ou despachada AQUI entra na lista na hora, sem esperar a
  // consulta. A geração impede que uma resposta que saiu ANTES dessa mudança
  // (e chega depois) apague a rota nova — os pedidos dela voltariam a
  // aparecer como pendentes por alguns segundos.
  const geracaoDasRotas = useRef(0);

  // Buscar rotas sincronizadas no banco de dados (multi-dispositivo)
  const fetchStoreRoutes = async () => {
    const geracao = geracaoDasRotas.current;
    try {
      const res = await fetch("/api/store/routes");
      if (res.ok) {
        const corpo = await res.text();
        if (geracao !== geracaoDasRotas.current) return;
        if (corpo === ultimoCorpoDasRotas.current) return;
        const data = JSON.parse(corpo);
        if (Array.isArray(data.routes)) {
          ultimoCorpoDasRotas.current = corpo;
          setCreatedRoutes(data.routes.map(rotaDaTela));
          setForaDaAutomatica(new Set(Array.isArray(data.foraDaAutomatica) ? data.foraDaAutomatica : []));
        }
      }
    } catch (err) {
      console.error("Erro ao buscar rotas da API:", err);
    }
  };

  /**
   * A rota que acabou de ser criada/despachada nesta tela, já na lista: os
   * pedidos dela saem dos pendentes no mesmo instante, e a próxima consulta
   * (que traz a versão do servidor) é aceita mesmo que pareça igual. Rota
   * que já estava na lista fica no mesmo lugar; rota nova entra no topo, como
   * o servidor ordena (mais nova primeiro).
   */
  const colocarRotaNaLista = (rota: RouteItem) => {
    geracaoDasRotas.current += 1;
    ultimoCorpoDasRotas.current = "";
    setCreatedRoutes((atual) =>
      atual.some((r) => r.id === rota.id) ? atual.map((r) => (r.id === rota.id ? rota : r)) : [rota, ...atual],
    );
  };

  /** Depois de mexer numa rota: só vale a resposta que sair daqui em diante. */
  const recarregarRotas = () => {
    geracaoDasRotas.current += 1;
    ultimoCorpoDasRotas.current = "";
    return fetchStoreRoutes();
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchStoreRoutes();
    const interval = setInterval(fetchStoreRoutes, 4000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Helper base de pedidos de entrega elegíveis (sem filtro da cozinha)
  const baseDeliveryOrders = useMemo(() => {
    return orders.filter((o: any) => {
      const statusUpper = String(o.status || "").toUpperCase().trim();
      if (statusUpper.includes("CANCEL")) return false;

      // ── ENTREGUE FICA VERDE POR 10 SEGUNDOS, DEPOIS SOME ────────────────
      //
      // Especificação do lojista, com as palavras dele (11/09/2026 21:21):
      // "Vermelho tá na cozinha, roxo tá pronto, azul tá em entrega, verde
      // quando foi entregue — some depois de 10 segundos". O sumiço imediato
      // tirava da tela justamente a confirmação que a loja procura: ela dá a
      // baixa e quer VER que aquele ponto fechou, antes de ele desaparecer.
      if (statusUpper === "ENTREGUE" || statusUpper === "ENCERRADO" || statusUpper === "FINISHED") {
        const quando = (o as any).deliveredAt || (o as any).updatedAt || (o as any).completedAt;
        const desde = quando ? Date.now() - new Date(quando).getTime() : Infinity;
        if (!(desde >= 0 && desde < 10_000)) return false;
        (o as any).__recemEntregue = true;
      }

      const isAlreadyDispatched =
        statusUpper === "SAIU_ENTREGA" ||
        statusUpper === "SAIU_PARA_ENTREGA" ||
        statusUpper === "OUT_FOR_DELIVERY" ||
        statusUpper === "EM_TRANSITO" ||
        statusUpper === "DISPATCHED" ||
        statusUpper === "EM_ROTA" ||
        Boolean(o.motoboyId) ||
        Boolean(o.dispatchedAt);

      // ── O PEDIDO DESPACHADO NÃO SOME MAIS DO MAPA ───────────────────
      //
      // Ele era removido aqui, e com isso a loja perdia de vista tudo que já
      // estava na rua: "o seu tá sumindo, a gente fica bem perdido no mapa,
      // não sabe onde o motoboy tá indo… o cara tá no Laranjal, eu não vi em
      // que lugar do Laranjal que era" (Lucas Pimenta, 11/09/2026).
      //
      // Agora ele fica, marcado como despachado: some da LISTA de quem falta
      // roteirizar (filteredPendingOrders continua ignorando), mas o pino
      // permanece, em azul, para a loja saber para onde o motoboy foi.
      if (isAlreadyDispatched) {
        (o as any).__jaDespachado = true;
      }

      const deliveryTypeUpper = String(o.deliveryType || o.orderType || o.type || "").toUpperCase().trim();
      const isPickupType =
        deliveryTypeUpper === "TAKEOUT" ||
        deliveryTypeUpper === "PICKUP" ||
        deliveryTypeUpper === "RETIRADA" ||
        deliveryTypeUpper === "BALCAO" ||
        deliveryTypeUpper === "MESA" ||
        deliveryTypeUpper === "PRESENCIAL" ||
        deliveryTypeUpper === "IN_STORE" ||
        o.isPickup === true ||
        Boolean(o.takeout);

      if (isPickupType) return false;

      // ── ENTREGADOR DO PARCEIRO NÃO É ROTA DA LOJA ──────────────────────
      // O iFood (ou o 99) manda o entregador dele buscar: o pedido não vai
      // para motoboy da loja e no mapa só confundia — com pino, aviso de "sem
      // localização" e na lista de pendentes (Douglas, 24/10/2026). A regra é
      // a do painel (lib/entrega-parceira.ts), a mesma do "ENTREGA PARCEIRA".
      if (infoDaEntrega(o).parceira) return false;

      const addrRaw = String(o.customerAddress || o.address || `${o.street || ""} ${o.number || ""} ${o.neighborhood || ""}`).toLowerCase();
      if (
        addrRaw.includes("retirada") ||
        addrRaw.includes("retirar") ||
        addrRaw.includes("retira em loja") ||
        addrRaw.includes("no balcao") ||
        addrRaw.includes("comer no local")
      ) {
        return false;
      }

      return addrRaw.trim().length > 2;
    });
  }, [orders]);

  // ── DAR O PEDIDO POR PRONTO SEM SAIR DO MAPA ──────────────────────────────
  //
  // Quem despacha à noite vive nesta aba, mas o "pronto" só existia no painel
  // de pedidos. Então ou se abria a outra tela a cada pedido que a cozinha
  // entregava no balcão, ou se montava rota com pedido que ninguém carimbou —
  // e o filtro "Mostrar Prontos", que existe justamente para isso, ficava
  // mentindo. O clique daqui é o MESMO do painel (/api/kds, `finish_order`):
  // é ele que carimba `readyAt`, avisa iFood, 99Food, Brendi e Wabiz e chama o
  // entregador do parceiro. Não há segundo caminho para o pronto.
  //
  // O feed volta a cada 8 s. Até ele voltar, o id espera aqui para o card e o
  // pino mudarem no clique — senão o lojista clica de novo achando que não
  // pegou, e o parceiro recebe dois "pronto". O valor é o prazo do palpite:
  // passou dele sem o servidor confirmar, manda quem veio do servidor.
  const [prontosOtimistas, setProntosOtimistas] = useState<Record<string, number>>({});
  const [marcandoPronto, setMarcandoPronto] = useState<string | null>(null);

  const estaPronto = useCallback(
    (o: any) => pedidoJaEstaPronto(o) || (prontosOtimistas[o?.id] || 0) > Date.now(),
    [prontosOtimistas]
  );

  // Palpite confirmado (ou vencido) sai da frente. Sem esta limpeza, desfazer
  // o pronto pelo painel deixava o card verde aqui para sempre.
  useEffect(() => {
    setProntosOtimistas((atual) => {
      const ids = Object.keys(atual);
      if (ids.length === 0) return atual;
      const agora = Date.now();
      const proximo: Record<string, number> = {};
      for (const id of ids) {
        const doServidor = orders.find((o: any) => o.id === id);
        if (doServidor && pedidoJaEstaPronto(doServidor)) continue;
        if (atual[id] <= agora) continue;
        proximo[id] = atual[id];
      }
      return Object.keys(proximo).length === ids.length ? atual : proximo;
    });
  }, [orders]);

  const marcarPedidoPronto = async (order: any) => {
    if (marcandoPronto) return;
    const id = order?.id;
    if (!id) return;

    setMarcandoPronto(id);
    setProntosOtimistas((a) => ({ ...a, [id]: Date.now() + 20000 }));
    const desfazerPalpite = () =>
      setProntosOtimistas((a) => {
        const n = { ...a };
        delete n[id];
        return n;
      });

    try {
      const res = await fetch("/api/kds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id, action: "finish_order" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        desfazerPalpite();
        setAviso({ tipo: "erro", titulo: "O pedido não foi marcado como pronto", detalhe: err?.error || "Tente de novo." });
        return;
      }
      if (onRefreshOrders) onRefreshOrders();
    } catch (err: any) {
      desfazerPalpite();
      setAviso({ tipo: "erro", titulo: "O pedido não foi marcado como pronto", detalhe: err?.message || String(err) });
    } finally {
      setMarcandoPronto(null);
    }
  };

  // ── PEDIR PRIORIDADE NO KDS SEM SAIR DO MAPA (Douglas, 21/10/2026) ────────
  //
  // "O cara viu no mapa que aquela podia ir junto": o pedido vai para a frente
  // da cozinha (`prioridadeNaCozinha`, a marca da reposição) sem precisar criar
  // a rota. Liga e desliga, então o palpite guarda o VALOR, não só o prazo —
  // mesmos 20 s do pronto, e cai quando o poll confirma.
  const [prioridadesOtimistas, setPrioridadesOtimistas] = useState<Record<string, { valor: boolean; ate: number }>>({});
  const [marcandoPrioridade, setMarcandoPrioridade] = useState<string | null>(null);

  const estaPriorizado = useCallback(
    (o: any) => {
      const palpite = prioridadesOtimistas[o?.id];
      if (palpite && palpite.ate > Date.now()) return palpite.valor;
      return Boolean(o?.prioridadeNaCozinha);
    },
    [prioridadesOtimistas]
  );

  useEffect(() => {
    setPrioridadesOtimistas((atual) => {
      const ids = Object.keys(atual);
      if (ids.length === 0) return atual;
      const agora = Date.now();
      const proximo: Record<string, { valor: boolean; ate: number }> = {};
      for (const id of ids) {
        const doServidor = orders.find((o: any) => o.id === id);
        if (doServidor && Boolean((doServidor as any).prioridadeNaCozinha) === atual[id].valor) continue;
        if (atual[id].ate <= agora) continue;
        proximo[id] = atual[id];
      }
      return Object.keys(proximo).length === ids.length ? atual : proximo;
    });
  }, [orders]);

  const pedirPrioridade = async (order: any, valor: boolean) => {
    if (marcandoPrioridade) return;
    const id = order?.id;
    if (!id) return;

    setMarcandoPrioridade(id);
    setPrioridadesOtimistas((a) => ({ ...a, [id]: { valor, ate: Date.now() + 20000 } }));
    const desfazerPalpite = () => setPrioridadesOtimistas((a) => tirarDoPalpite(a, [id]));
    const titulo = valor ? "A prioridade não foi pedida" : "A prioridade não foi desfeita";

    try {
      const res = await fetch(`/api/store/orders/${id}/prioridade`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prioridade: valor }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        desfazerPalpite();
        setAviso({ tipo: "erro", titulo, detalhe: err?.error || "Tente de novo." });
        return;
      }
      if (onRefreshOrders) onRefreshOrders();
    } catch (err: any) {
      desfazerPalpite();
      setAviso({ tipo: "erro", titulo, detalhe: err?.message || String(err) });
    } finally {
      setMarcandoPrioridade(null);
    }
  };

  // ── PRONTO E PRIORIDADE EM LOTE, PELA SELEÇÃO (Douglas, 21/10/2026) ───────
  //
  // "Selecionar mais de um pedido e dar pronto junto; só um aviso e faz tudo
  // de uma vez." Uma confirmação com os números, depois cada pedido pelo
  // caminho de sempre, em paralelo. O pronto vai com `forcar: true`: o
  // lojista acabou de confirmar, e sem ele o KDS pode responder
  // `precisaConfirmar` e o pedido ficar sem pronto. O aviso e o desfazer do
  // palpite saem de lib/lote-da-roteirizacao.ts (testado sem React).
  const [confirmacaoDoLote, setConfirmacaoDoLote] = useState<{ acao: AcaoDoLote; ids: string[] } | null>(null);
  const [executandoLote, setExecutandoLote] = useState(false);

  const executarLote = async () => {
    const lote = confirmacaoDoLote;
    if (!lote || executandoLote) return;
    setExecutandoLote(true);
    const prazo = Date.now() + 20000;
    if (lote.acao === "pronto") {
      setProntosOtimistas((a) => ({ ...a, ...Object.fromEntries(lote.ids.map((id) => [id, prazo])) }));
    } else {
      setPrioridadesOtimistas((a) => ({ ...a, ...Object.fromEntries(lote.ids.map((id) => [id, { valor: true, ate: prazo }])) }));
    }

    const respostas = await Promise.allSettled(
      lote.ids.map(async (id) => {
        const res =
          lote.acao === "pronto"
            ? await fetch("/api/kds", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderId: id, action: "finish_order", forcar: true }),
              })
            : await fetch(`/api/store/orders/${id}/prioridade`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prioridade: true }),
              });
        const corpo = await res.json().catch(() => ({}));
        return lerRespostaDoLote(res.ok, corpo);
      })
    );
    const resultados = respostas.map((r, i) => {
      const id = lote.ids[i];
      const numero = getOrderDisplayNumber(orders.find((o: any) => o.id === id) || { id });
      return r.status === "fulfilled"
        ? { id, numero, ...r.value }
        : { id, numero, ok: false, motivo: (r.reason as any)?.message || "sem conexão" };
    });
    const resumo = resumoDoLote(lote.acao, resultados);
    if (lote.acao === "pronto") setProntosOtimistas((a) => tirarDoPalpite(a, resumo.falharam));
    else setPrioridadesOtimistas((a) => tirarDoPalpite(a, resumo.falharam));
    setAviso({ tipo: resumo.tipo, titulo: resumo.titulo, detalhe: resumo.detalhe });
    setConfirmacaoDoLote(null);
    setExecutandoLote(false);
    if (onRefreshOrders) onRefreshOrders();
  };

  // Contagem de todos os pedidos elegíveis de entrega
  // Só o que falta roteirizar. Os despachados agora vivem no mapa, mas
  // contá-los aqui fazia o botão dizer "Mostrar Todos (14)" com 5 linhas na
  // lista — o número prometia trabalho que não existe.
  const naFilaDeRoteirizacao = (o: any) => !o.__jaDespachado && !o.__recemEntregue;
  const allDeliveryOrdersCount = useMemo(() => {
    return baseDeliveryOrders.filter(naFilaDeRoteirizacao).length;
  }, [baseDeliveryOrders]);

  // Contagem de pedidos prontos na cozinha
  const prontoOrdersCount = useMemo(() => {
    return baseDeliveryOrders.filter(naFilaDeRoteirizacao).filter(estaPronto).length;
  }, [baseDeliveryOrders, estaPronto]);

  // Filter Delivery Orders (Strictly exclude Pickup/Retirada, Dispatched/Out for delivery, and respect onlyProntoOrders setting)
  const deliveryOrders = useMemo(() => {
    return baseDeliveryOrders.filter((o: any) => {
      // "Mostrar só os prontos" é filtro da LISTA de quem falta roteirizar.
      // Aplicado ao mapa, ele apagava justamente os pinos azuis que a loja
      // pediu para manter à vista.
      if (o.__jaDespachado || o.__recemEntregue) return true;
      if (onlyProntoOrders && !estaPronto(o)) return false;
      return true;
    });
  }, [baseDeliveryOrders, onlyProntoOrders, estaPronto]);

  // Filtered Orders based on search term (ordenado do MENOR para o MAIOR número de pedido #137 -> #156)
  const filteredPendingOrders = useMemo(() => {
    const list = deliveryOrders.filter((o) => {
      // Quem já saiu não entra na lista de "para roteirizar" — só no mapa.
      if ((o as any).__jaDespachado) return false;
      const isInRoute = createdRoutes.some((r) => r.orders.some((ro) => ro.id === o.id));
      if (isInRoute) return false;

      if (!searchTerm.trim()) return true;
      const term = searchTerm.toLowerCase();
      const numStr = getOrderDisplayNumber(o).toLowerCase();
      const name = (o.customerName || "").toLowerCase();
      const addr = (o.address || `${o.street || ""} ${o.neighborhood || ""}`).toLowerCase();
      return numStr.includes(term) || name.includes(term) || addr.includes(term);
    });

    return list.sort((a, b) => {
      const idxA = selectedOrderIds.indexOf(a.id);
      const idxB = selectedOrderIds.indexOf(b.id);
      const isSelA = idxA !== -1;
      const isSelB = idxB !== -1;

      // 1. Se ambos estiverem selecionados, mantém a ordem de seleção (#1, #2, #3...)
      if (isSelA && isSelB) return idxA - idxB;
      // 2. Se apenas A estiver selecionado, fica no topo
      if (isSelA) return -1;
      // 3. Se apenas B estiver selecionado, fica no topo
      if (isSelB) return 1;

      // 4. Ordenação Ascendente: do MENOR número de pedido para o MAIOR (#137, #139, #140 ... #156)
      const numA = parseInt(getOrderDisplayNumber(a).replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(getOrderDisplayNumber(b).replace(/\D/g, ""), 10) || 0;
      if (numA !== numB) {
        return numA - numB;
      }

      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }, [deliveryOrders, createdRoutes, searchTerm, selectedOrderIds]);


  // Parser e limpeza de endereço vivem em lib/geocodificacao.ts (testáveis
  // fora do navegador). Aqui só a amarração com a cidade da loja.
  const parseAddressDetails = (rawAddr: string) => parseEnderecoDaEntrega(rawAddr, storeCity);

  // ── O PONTO DE CADA PEDIDO ─────────────────────────────────────────────
  //
  // A regra mora em lib/ponto-do-pedido.ts — a mesma do servidor e do cron:
  // o ponto que o pedido traz (loja, parceiro, cliente) vale; o que alguém
  // achou pelo texto só vale dentro da área da loja; o resto o SERVIDOR
  // resolve (/api/geocodificar: posição que a loja ensinou → CEP → texto →
  // centro do bairro, sempre dentro da área). Sem nada plausível o pedido fica
  // INCERTO: não vai para o mapa no lugar errado — vai para a lista "sem
  // localização", e o operador posiciona com um clique.
  //
  // O que saiu (NIK, 16/10/2026): a cópia deste navegador (localStorage
  // "firehub_geo_cache_v3") passava NA FRENTE do servidor e guardava para
  // sempre o ponto que o navegador achava sozinho, sem o CEP — foi assim que
  // dois pedidos de Sobradinho ficaram na Asa Sul, os pinos "2" e "3". O
  // servidor tem o cache do banco, para todas as lojas, e aprende com a loja.
  const resolucoesRef = useRef<Map<string, Resolucao>>(new Map());
  const emVooRef = useRef<Set<string>>(new Set());
  /** O que o operador posicionou nesta tela, antes de a lista de pedidos voltar do servidor. */
  const manuaisRef = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const [tiqueDosPontos, setTiqueDosPontos] = useState(0);
  const [infoDoPino, setInfoDoPino] = useState<Record<string, { fonte: FonteDoPonto; aproximado: boolean }>>({});
  const [incertos, setIncertos] = useState<Record<string, string>>({});
  /** A lista "sem localização" no canto do mapa pode ser recolhida (noite cheia). */
  const [incertosRecolhidos, setIncertosRecolhidos] = useState(false);

  const textoDoEndereco = (order: any): string =>
    String(order?.customerAddress || order?.address || `${order?.street || ""} ${order?.number || ""} ${order?.neighborhood || ""}`).trim();

  /** A área da loja para conferir ponto achado pelo texto (só com o pino da loja). */
  const areaDaTela = useMemo<AreaDaLoja | null>(
    () =>
      pontoDaLoja && areaDoMapa
        ? { centro: pontoDaLoja, raioKm: areaDoMapa.raioKm, raioDoParceiroKm: areaDoMapa.raioDoParceiroKm, base: "faixas" }
        : null,
    [pontoDaLoja, areaDoMapa?.raioKm, areaDoMapa?.raioDoParceiroKm],
  );

  // A cópia velha dos pontos neste navegador não volta mais (ver acima).
  useEffect(() => {
    try { localStorage.removeItem("firehub_geo_cache_v3"); } catch {}
  }, []);

  // Roda também com a janela fechada: no painel de pedidos o mapa fica montado
  // por trás e abre já com os pinos (como sempre foi).
  useEffect(() => {
    if (deliveryOrders.length === 0) return;

    const pedidos: (PedidoNoMapa & { jaDespachado: boolean })[] = deliveryOrders.map((o: any) => ({
      id: o.id,
      customerLatLng: manuaisRef.current.has(o.id) ? { ...manuaisRef.current.get(o.id), origem: "manual" } : o.customerLatLng,
      latitude: o.latitude ?? o.lat,
      longitude: o.longitude ?? o.lng,
      franchiseeId: o.franchiseeId,
      ehMarketplace: canalDoPedido(o).ehMarketplace,
      endereco: textoDoEndereco(o),
      jaDespachado: Boolean(o.__jaDespachado || o.__recemEntregue),
    }));
    const plano = planoDosPontos(pedidos, {
      area: areaDaTela,
      lojaDoMapa: lojaDoMapaId || null,
      resolucoes: resolucoesRef.current,
      agora: Date.now(),
      emVoo: emVooRef.current,
    });
    setGeocodedMap((atual) => (JSON.stringify(atual) === JSON.stringify(plano.pontos) ? atual : plano.pontos));
    setInfoDoPino((atual) => (JSON.stringify(atual) === JSON.stringify(plano.info) ? atual : plano.info));
    setIncertos((atual) => (JSON.stringify(atual) === JSON.stringify(plano.incertos) ? atual : plano.incertos));

    // Sem o ponto da loja não existe âncora: o servidor recusa (o raio e o
    // viés da busca saem dela). Pino nenhum é melhor que pino no meio do Brasil.
    if (!temPontoDaLoja || plano.perguntar.length === 0) {
      if (emVooRef.current.size === 0) setGeocodingLoading(false);
      return;
    }

    // Quem já está na rua vai para o fim da fila: as vagas do lote são dos
    // pedidos que a loja precisa roteirizar AGORA. 14 por vez (o teto da rota
    // é 15); o resto vai na volta seguinte.
    const porId = new Map(pedidos.map((p) => [p.id, p]));
    const lote = plano.perguntar
      .map((id) => porId.get(id)!)
      .sort((a, b) => Number(a.jaDespachado) - Number(b.jaDespachado))
      .slice(0, 14);
    lote.forEach((p) => emVooRef.current.add(p.id));
    setGeocodingLoading(true);

    void (async () => {
      let servidorFora = false;
      try {
        const r = await fetch("/api/geocodificar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enderecos: lote.map((p) => ({ id: p.id, endereco: p.endereco })) }),
        });
        const agora = Date.now();
        if (r.ok) {
          const { resultados, incertos: semPonto } = await r.json();
          const respondidos = new Set<string>();
          for (const x of resultados || []) {
            const fonte = (x.fonte as FonteDoPonto) || fonteDaGeocodificacao(x.origem);
            resolucoesRef.current.set(x.id, {
              ponto: { lat: x.lat, lng: x.lng },
              fonte,
              aproximado: typeof x.aproximado === "boolean" ? x.aproximado : fonte === "bairro",
              em: agora,
            });
            respondidos.add(x.id);
            console.log(`[Roteirização] pedido ${String(x.id).slice(-4)} → ${x.origem} (${NOME_DA_FONTE[fonte] || fonte})`);
          }
          for (const x of semPonto || []) {
            resolucoesRef.current.set(x.id, { ponto: null, motivo: String(x.motivo || "sem localização confiável"), em: agora });
            respondidos.add(x.id);
            console.warn(`[Roteirização] pedido ${String(x.id).slice(-4)} sem localização confiável: ${x.motivo}`);
          }
          // Sem resposta (prazo do lote, fila do mapa cheia): pergunta de novo em instantes.
          for (const p of lote) if (!respondidos.has(p.id)) resolucoesRef.current.set(p.id, { ponto: null, em: agora });
        } else if (r.status >= 500) {
          servidorFora = true;
        } else {
          console.warn("[Roteirização] servidor não localizou os endereços:", r.status);
          for (const p of lote) resolucoesRef.current.set(p.id, { ponto: null, em: agora });
        }
      } catch (e: any) {
        console.warn("[Roteirização] servidor indisponível:", e?.message);
        servidorFora = true;
      }

      // ── SERVIDOR FORA: O NAVEGADOR PROCURA, COM A MESMA RÉGUA ───────────
      // Só o mapa aberto e o texto (sem o CEP e sem a posição aprendida); o
      // que ficar fora da área da loja, ou sem achar nada, é incerto — nunca
      // o centro de outro lugar e nunca a porta da loja.
      if (servidorFora) {
        for (const p of lote) {
          if (!montadoRef.current) break;
          const lido = parseAddressDetails(p.endereco);
          const raioMaxKm = areaDaTela ? raioDoPedido(areaDaTela, p.ehMarketplace) : undefined;
          const geo = criarGeocodificador({ storeCity, estado: estadoDaLoja, centroDaLoja: defaultCenter, raioMaxKm });
          const { coords, origem, nivel, mapaFalhou } = await geo
            .geocodificarItem({
              idx: 0,
              neighborhood: lido.neighborhood,
              streetName: lido.streetName,
              houseNumber: lido.houseNumber,
              cleanedStreet: cleanAddressForGeocoding(p.endereco),
              dictFallback: dicionarioDeBairro(lido.neighborhood, defaultCenter),
            })
            .catch(() => ({ coords: defaultCenter, origem: "falhou", nivel: "nenhum" as const, mapaFalhou: true }));
          const agora = Date.now();
          if (nivel !== "nenhum" && pontoPlausivel(coords, areaDaTela, p.ehMarketplace)) {
            const fonte = fonteDaGeocodificacao(origem);
            resolucoesRef.current.set(p.id, { ponto: coords, fonte, aproximado: nivel === "bairro", em: agora });
          } else if (mapaFalhou) {
            // O mapa não respondeu: não é "incerto", é "ainda não sei".
            resolucoesRef.current.set(p.id, { ponto: null, em: agora });
          } else {
            resolucoesRef.current.set(p.id, {
              ponto: null,
              motivo: nivel === "nenhum" || !areaDaTela ? "o mapa não achou este endereço" : motivoForaDaArea(coords, areaDaTela, p.ehMarketplace),
              em: agora,
            });
          }
          console.log(`[Roteirização] (navegador) pedido ${p.id.slice(-4)} → ${origem}`);
        }
      }

      lote.forEach((p) => emVooRef.current.delete(p.id));
      if (!montadoRef.current) return;
      if (emVooRef.current.size === 0) setGeocodingLoading(false);
      setTiqueDosPontos((n) => n + 1);
    })();
  }, [isOpen, deliveryOrders, areaDaTela, lojaDoMapaId, temPontoDaLoja, tiqueDosPontos]);

  // Quem ficou sem resposta é perguntado de novo em 15 s, e o incerto de 5 em
  // 5 min (lib/ponto-do-pedido.ts) — mesmo numa noite parada, sem pedido novo
  // para mexer na lista.
  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(() => setTiqueDosPontos((n) => n + 1), ESPERA_SEM_RESPOSTA_MS + 1000);
    return () => clearInterval(t);
  }, [isOpen]);

  // ── O OPERADOR POSICIONA O PEDIDO ───────────────────────────────────────
  //
  // "📍 Posicionar" (lista de incertos e cartão do pedido) ou o botão direito
  // no pino: o mapa entra no modo de posicionar — clique onde fica a casa,
  // arraste o pino se precisar e salve. O ponto vai para o pedido (origem
  // "manual": o app do motoboy navega até ali e o cron mede dali) e para o
  // ENDEREÇO na loja (lib/ponto-aprendido.ts): o próximo pedido dele já nasce
  // no lugar certo. Clique solto em pino nunca move nada — só com o modo ligado.
  const [posicionando, setPosicionando] = useState<string | null>(null);
  const [pontoProvisorio, setPontoProvisorio] = useState<{ lat: number; lng: number } | null>(null);
  const [salvandoPonto, setSalvandoPonto] = useState(false);
  const posicionandoRef = useRef<string | null>(null);
  useEffect(() => {
    posicionandoRef.current = posicionando;
  }, [posicionando]);

  const iniciarPosicionamento = (id: string) => {
    setPosicionando(id);
    const atual = geocodedMap[id] || null;
    setPontoProvisorio(atual);
    if (atual && leafletMapRef.current) {
      try { leafletMapRef.current.panTo([atual.lat, atual.lng]); } catch {}
    }
  };
  const cancelarPosicionamento = () => {
    setPosicionando(null);
    setPontoProvisorio(null);
  };
  // Esc desiste de posicionar, como em qualquer mapa.
  useEffect(() => {
    if (!posicionando) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPosicionando(null);
        setPontoProvisorio(null);
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [posicionando]);
  const salvarPosicao = async () => {
    const id = posicionando;
    if (!id || !pontoProvisorio || salvandoPonto) return;
    setSalvandoPonto(true);
    try {
      const res = await fetch(`/api/store/orders/${encodeURIComponent(id)}/ponto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pontoProvisorio),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ponto) {
        setAviso({ tipo: "erro", titulo: "O ponto não foi salvo", detalhe: data?.error || "Tente de novo." });
        return;
      }
      manuaisRef.current.set(id, data.ponto);
      resolucoesRef.current.set(id, { ponto: data.ponto, fonte: "manual", aproximado: false, em: Date.now() });
      const pedido = orders.find((o) => o.id === id);
      const numero = pedido ? getOrderDisplayNumber(pedido) : "";
      setAviso({
        tipo: data.foraDaArea ? "atencao" : "ok",
        titulo: `📍 Pedido #${numero} posicionado`,
        detalhe: [
          data.aprendido
            ? data.vizinhanca
              ? "Os próximos pedidos deste endereço já vêm neste ponto, e os da mesma quadra e conjunto vêm perto (aproximado)."
              : "Os próximos pedidos deste endereço já vêm neste ponto."
            : null,
          data.foraDaArea ? "Atenção: o ponto fica fora da área de entrega cadastrada." : null,
          typeof data.distanciaKm === "number" ? `Distância da loja: ${String(data.distanciaKm).replace(".", ",")} km.` : null,
        ].filter(Boolean).join(" ") || undefined,
      });
      cancelarPosicionamento();
      setTiqueDosPontos((n) => n + 1);
      if (onRefreshOrders) onRefreshOrders();
    } catch (err: any) {
      setAviso({ tipo: "erro", titulo: "O ponto não foi salvo", detalhe: err?.message || String(err) });
    } finally {
      setSalvandoPonto(false);
    }
  };

  // Modo de posicionar: o clique no mapa marca o ponto provisório.
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!leafletLoaded || !map) return;
    const container = map.getContainer?.();
    if (!posicionando) return;
    if (container) container.style.cursor = "crosshair";
    const aoClicar = (e: any) => setPontoProvisorio({ lat: e.latlng.lat, lng: e.latlng.lng });
    map.on("click", aoClicar);
    return () => {
      map.off("click", aoClicar);
      if (container) container.style.cursor = "";
    };
  }, [leafletLoaded, posicionando]);

  // O pino provisório (📍, arrastável). Fora dos marcadores do redesenho:
  // a lista que volta a cada 8 s não o apaga no meio do arraste.
  const marcadorProvisorioRef = useRef<any>(null);
  useEffect(() => {
    const map = leafletMapRef.current;
    const L = (window as any).L;
    if (!leafletLoaded || !map || !L) return;
    if (!posicionando || !pontoProvisorio) {
      if (marcadorProvisorioRef.current) {
        try { marcadorProvisorioRef.current.remove(); } catch {}
        marcadorProvisorioRef.current = null;
      }
      return;
    }
    if (!marcadorProvisorioRef.current) {
      const icone = L.divIcon({
        html: `<div style="font-size:34px;line-height:34px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.45));cursor:grab;">📍</div>`,
        className: "pino-provisorio-do-pedido",
        iconSize: [34, 34],
        iconAnchor: [17, 32],
      });
      const m = L.marker([pontoProvisorio.lat, pontoProvisorio.lng], { icon: icone, draggable: true, zIndexOffset: 3000 }).addTo(map);
      m.on("dragend", () => {
        const p = m.getLatLng();
        setPontoProvisorio({ lat: p.lat, lng: p.lng });
      });
      marcadorProvisorioRef.current = m;
    } else {
      marcadorProvisorioRef.current.setLatLng([pontoProvisorio.lat, pontoProvisorio.lng]);
    }
  }, [leafletLoaded, posicionando, pontoProvisorio]);

  // ── COORDENADA SÓ PARA QUEM TEM PINO ─────────────────────────────────────
  //
  // O mapa de coordenadas só crescia durante a noite: pedido entregue, rota
  // que saiu da lista — o ponto ficava, e era nele que a linha da rota
  // terminava, num lugar sem pino. Agora fica só a coordenada de pedido que
  // ainda está no mapa (com ou sem o filtro "Mostrar Prontos"). Depende do
  // próprio mapa porque a geocodificação acima grava a cópia que tinha ao
  // começar, e ela pode trazer de volta o que já tinha saído.
  useEffect(() => {
    const ficam = new Set(baseDeliveryOrders.map((o) => o.id));
    setGeocodedMap((atual) => podarCoordenadas(atual, ficam));
  }, [baseDeliveryOrders, geocodedMap]);

  // A rota em foco saiu da lista (passou das 24 h, foi desfeita): sem foco.
  useEffect(() => {
    if (rotaEmFoco && !createdRoutes.some((r) => r.id === rotaEmFoco)) setRotaEmFoco(null);
  }, [rotaEmFoco, createdRoutes]);


  // Algoritmo TSP Nearest-Neighbor para Ordenação Inteligente do Trajeto a partir da Loja
  const optimizeRouteSequence = (
    orderIds: string[],
    storeCoords: { lat: number; lng: number }
  ): string[] => {
    if (orderIds.length <= 1) return orderIds;

    const validIds = orderIds.filter((id) => geocodedMap[id]);
    const unmappedIds = orderIds.filter((id) => !geocodedMap[id]);

    if (validIds.length <= 1) return orderIds;

    const result: string[] = [];
    let currentPos = storeCoords;
    let remaining = [...validIds];

    while (remaining.length > 0) {
      let nearestIndex = 0;
      let minDistance = Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const coords = geocodedMap[remaining[i]];
        if (!coords) continue;
        const dist = calculateHaversineKm(currentPos.lat, currentPos.lng, coords.lat, coords.lng);
        if (dist < minDistance) {
          minDistance = dist;
          nearestIndex = i;
        }
      }

      const nextId = remaining[nearestIndex];
      result.push(nextId);
      currentPos = geocodedMap[nextId];
      remaining.splice(nearestIndex, 1);
    }

    return [...result, ...unmappedIds];
  };

  const handleOptimizeSelectedRoute = () => {
    if (selectedOrderIds.length <= 1) return;
    const optimized = optimizeRouteSequence(selectedOrderIds, defaultCenter);
    setSelectedOrderIds(optimized);
  };

  // Smart Auto-Clustering Algorithm: Garante SEMPRE o pedido mais antigo/prioritário + busca pedidos no caminho (corredor) ou próximos
  const handleAutoClusterRoutes = () => {
    const unrouted = filteredPendingOrders.filter((o) => geocodedMap[o.id]);
    if (unrouted.length === 0) {
      setAviso({ tipo: "atencao", titulo: "Nenhum pedido pendente no mapa para agrupar", detalhe: "Espere os endereços aparecerem no mapa e tente de novo." });
      return;
    }

    // 1. O pedido mais antigo pendente (ex: #14) É OBRIGATORIAMENTE a semente da rota
    const oldestOrder = unrouted[0];
    const targetCoords = geocodedMap[oldestOrder.id];
    if (!targetCoords) return;

    const storeCoords = defaultCenter;
    const distStoreToTarget = calculateHaversineKm(storeCoords.lat, storeCoords.lng, targetCoords.lat, targetCoords.lng);

    // Lista de candidatos elegíveis com pontuação de menor desvio
    const candidatesWithScore: { id: string; detourKm: number; distToTargetKm: number; score: number }[] = [];

    for (let i = 1; i < unrouted.length; i++) {
      const candidate = unrouted[i];
      const candCoords = geocodedMap[candidate.id];
      if (!candCoords) continue;

      const distStoreToCand = calculateHaversineKm(storeCoords.lat, storeCoords.lng, candCoords.lat, candCoords.lng);
      const distCandToTarget = calculateHaversineKm(candCoords.lat, candCoords.lng, targetCoords.lat, targetCoords.lng);

      // Desvio de trajeto adicionado ao ir até o candidato a caminho do destino principal
      const detourKm = distStoreToCand + distCandToTarget - distStoreToTarget;

      // Critério 1: Está próximo do destino final (raio até maxDistanceKm)
      const isNearTarget = distCandToTarget <= maxDistanceKm;

      // Critério 2: Está "no caminho" (corredor da loja até o destino) com desvio baixo (ex: até 1.8km ou maxDistanceKm)
      const maxAllowedDetour = Math.min(1.8, Math.max(1.0, maxDistanceKm * 0.75));
      const isEnRoute = detourKm <= maxAllowedDetour && distStoreToCand <= (distStoreToTarget + 1.0);

      if (isNearTarget || isEnRoute) {
        const score = (detourKm * 0.6) + (distCandToTarget * 0.4);
        candidatesWithScore.push({
          id: candidate.id,
          detourKm,
          distToTargetKm: distCandToTarget,
          score
        });
      }
    }

    // Ordenar os candidatos pelo menor desvio / maior conveniência de percurso
    candidatesWithScore.sort((a, b) => a.score - b.score);

    const clusterIds = [oldestOrder.id];
    for (const cand of candidatesWithScore) {
      if (clusterIds.length >= maxOrdersPerRoute) break;
      clusterIds.push(cand.id);
    }

    // 3. Otimiza a sequência do trajeto a partir da Loja (Loja -> Parada 1 -> Parada 2 -> Destino) no sentido mais eficiente
    const optimizedCluster = optimizeRouteSequence(clusterIds, defaultCenter);
    setSelectedOrderIds(optimizedCluster);

    // O pedido sem localização confiável não entra no agrupamento (agrupar
    // pelo ponto errado é a rota errada): fica dito, para ninguém esquecê-lo.
    const semLocal = filteredPendingOrders.filter((o) => incertos[o.id] && !geocodedMap[o.id]);
    if (semLocal.length > 0) {
      setAviso({
        tipo: "atencao",
        titulo: `${semLocal.length} pedido(s) sem localização ficaram fora do agrupamento`,
        detalhe: `${semLocal.map((o) => `#${getOrderDisplayNumber(o)}`).join(", ")} — use "📍 Posicionar" no mapa para incluir.`,
      });
    }
  };

  // Dispersor Anti-Sobreposição (Anti-Overlap Spider / Offset Lateral)
  // Agrupa pedidos com coordenadas idênticas ou muito próximas (< 15 metros) e distribui lado a lado ou em leque
  // ── Anti-sobreposição em PIXELS, não em metros ────────────────────────────
  //
  // A versão anterior afastava pedidos empilhados deslocando a COORDENADA
  // (~24 metros). Só que 24 metros viram ~1 pixel quando o mapa mostra a
  // cidade inteira — dois pedidos no mesmo bairro continuavam um em cima do
  // outro e só um número aparecia.
  //
  // Agora o marcador fica na coordenada EXATA (é ela que a haste do pino
  // aponta) e o espalhamento acontece dentro do ícone: as bolas numeradas
  // abrem em leque, cada uma com sua haste inclinada até o ponto real.
  // Pixel não encolhe com zoom — em qualquer altura, todos os números
  // aparecem lado a lado.
  const { displayCoordinatesMap, clusterCentersMap, clusterFanMap } = useMemo(() => {
    const dispMap: Record<string, { lat: number; lng: number }> = {};
    const centersMap: Record<string, { lat: number; lng: number }> = {};
    const fanMap: Record<string, { angulo: number; haste: number }> = {};
    const clusters: { baseLat: number; baseLng: number; orderIds: string[] }[] = [];

    deliveryOrders.forEach((order) => {
      const rawCoords = geocodedMap[order.id];
      if (!rawCoords) return;

      // O marcador fica no ponto real do endereço, sempre.
      dispMap[order.id] = rawCoords;
      centersMap[order.id] = rawCoords;

      // ~50m de raio de agrupamento: pega o caso clássico (dois pedidos que a
      // geocodificação resolveu para o MESMO ponto do bairro) e também os da
      // mesma rua, que empilhavam quando o zoom afastava.
      let found = clusters.find((c) => {
        const dLat = Math.abs(c.baseLat - rawCoords.lat);
        const dLng = Math.abs(c.baseLng - rawCoords.lng);
        return dLat < 0.0005 && dLng < 0.0005;
      });

      if (found) {
        found.orderIds.push(order.id);
      } else {
        clusters.push({ baseLat: rawCoords.lat, baseLng: rawCoords.lng, orderIds: [order.id] });
      }
    });

    clusters.forEach((cluster) => {
      const total = cluster.orderIds.length;
      cluster.orderIds.forEach((oId, idx) => {
        if (total === 1) {
          // Sozinho: gota clássica, reta, ponta no endereço. Sem cabo nenhum.
          fanMap[oId] = { angulo: 0, haste: 0 };
          return;
        }
        // Empilhados: o leque inclina as gotas (-56° a +56°) e um pequeno cabo
        // afilado — da MESMA cor, contínuo com a gota — afasta as bolas o
        // suficiente para não se tocarem. Com 4+ no mesmo ponto, os cabos
        // alternam comprimento e as gotas intercalam em duas fileiras.
        const angulo = -56 + (112 * idx) / (total - 1);
        const haste = 14 + (total > 3 ? (idx % 2) * 18 : 0);
        fanMap[oId] = { angulo, haste };
      });
    });

    return { displayCoordinatesMap: dispMap, clusterCentersMap: centersMap, clusterFanMap: fanMap };
  }, [deliveryOrders, geocodedMap]);

  // ── A LINHA DA ROTA PELA RUA, COMO NO GOOGLE ──────────────────────────────
  //
  // Douglas, 22/10/2026 21h15: a linha reta passava "por cima de muros e
  // casas". As pernas das rotas que têm linha agora (lib/rotas-no-mapa.ts:
  // as que não saíram e a que o lojista pediu para ver) são pedidas ao
  // servidor (POST /api/store/routes/desenho), em lotes de 12, e guardadas
  // aqui pela chave da perna — a consulta de 4 s não pede de novo. Perna que
  // não veio fica reta e é pedida outra vez depois de 1 min.
  const [desenhosPelaRua, setDesenhosPelaRua] = useState<Record<string, [number, number][]>>({});
  const desenhoPedidoEm = useRef<Map<string, number>>(new Map());
  const [tiqueDoDesenho, setTiqueDoDesenho] = useState(0);
  const pernasVisiveis = useMemo(() => {
    if (!isOpen) return [];
    const loja = temPontoDaLoja ? defaultCenter : null;
    return rotasComLinha(createdRoutes, { aba: activeTab, rotaEmFoco })
      .flatMap((route) => pernasDaLinha(pontosDaLinha(route, displayCoordinatesMap, loja)));
  }, [isOpen, createdRoutes, activeTab, rotaEmFoco, displayCoordinatesMap, temPontoDaLoja, defaultCenter]);
  useEffect(() => {
    const agora = Date.now();
    const lote = [...new Map(pernasVisiveis.map((p) => [p.chave, p])).values()]
      .filter((p) => !desenhosPelaRua[p.chave] && agora - (desenhoPedidoEm.current.get(p.chave) || 0) > 60_000)
      .slice(0, PERNAS_POR_PEDIDO_DE_DESENHO);
    if (lote.length === 0) return;
    let vivo = true;
    const t = setTimeout(async () => {
      for (const p of lote) desenhoPedidoEm.current.set(p.chave, Date.now());
      try {
        const r = await fetch("/api/store/routes/desenho", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pernas: lote.map((p) => [p.de[0], p.de[1], p.para[0], p.para[1]]) }),
        });
        if (r.status === 429) {
          // Pediu cedo demais: pede o mesmo lote daqui a 2 s.
          for (const p of lote) desenhoPedidoEm.current.delete(p.chave);
          setTimeout(() => { if (vivo) setTiqueDoDesenho((n) => n + 1); }, 2000);
          return;
        }
        const d = await r.json().catch(() => null);
        const novos: Record<string, [number, number][]> = {};
        if (r.ok && Array.isArray(d?.pernas)) {
          lote.forEach((p, i) => {
            const pts = d.pernas[i];
            if (Array.isArray(pts) && pts.length >= 2) novos[p.chave] = pts;
          });
        }
        if (Object.keys(novos).length > 0) setDesenhosPelaRua((atual) => ({ ...atual, ...novos }));
        // Sobrou perna (mais de 12)? O tique pede o próximo lote.
        else setTiqueDoDesenho((n) => n + 1);
      } catch {}
    }, 600);
    return () => { vivo = false; clearTimeout(t); };
  }, [pernasVisiveis, desenhosPelaRua, tiqueDoDesenho]);

  // Ampliar e diminuir pelos botões. A roda do mouse continua funcionando —
  // mas ela não é óbvia, e em notebook com touchpad é briga. Pedido do lojista
  // em 19/09/2026: "coloca um + e um - para ampliar e diminuir o mapa".
  const aproximarMapa = () => { try { leafletMapRef.current?.zoomIn(); } catch {} };
  const afastarMapa = () => { try { leafletMapRef.current?.zoomOut(); } catch {} };

  // Helper para centralizar manualmente a visão do mapa sob demanda do usuário
  const handleFitAllBounds = () => {
    if (!leafletMapRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    const points: [number, number][] = temPontoDaLoja ? [[defaultCenter.lat, defaultCenter.lng]] : [];
    deliveryOrders.forEach((o) => {
      const coords = displayCoordinatesMap[o.id] || geocodedMap[o.id];
      if (coords) points.push([coords.lat, coords.lng]);
    });

    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      leafletMapRef.current.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  };

  /**
   * "Ver no mapa" do card da rota: a linha dela aparece (mesmo despachada) e
   * o mapa vai até ela — aqui sim, porque foi o lojista que pediu. Clicou de
   * novo, a linha sai e o mapa fica onde está.
   */
  const alternarFocoDaRota = (route: RouteItem) => {
    if (rotaEmFoco === route.id) {
      setRotaEmFoco(null);
      return;
    }
    const pontos = pontosDaLinha(route, displayCoordinatesMap, temPontoDaLoja ? defaultCenter : null);
    if (pontos.length === 0) {
      setAviso({
        tipo: "info",
        titulo: `${route.routeNumber}: nada dela no mapa`,
        detalhe: "Os pedidos desta rota já foram entregues ou ainda não têm o endereço localizado.",
      });
      return;
    }
    setRotaEmFoco(route.id);
    const L = (window as any).L;
    if (L && leafletMapRef.current) {
      try {
        leafletMapRef.current.fitBounds(L.latLngBounds(pontos), { padding: [50, 50], maxZoom: 16 });
      } catch {}
    }
  };

  // 1. Inicializa o Mapa Leaflet uma única vez (Pré-carregado em background)
  useEffect(() => {
    if (!leafletLoaded || !mapRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    if (!leafletMapRef.current) {
      const map = L.map(mapRef.current, {
        center: [defaultCenter.lat, defaultCenter.lng],
        // Sem o ponto da loja, aproximar em 13 seria apontar para um lugar
        // qualquer com cara de certeza. Abre no país e o lojista se situa.
        zoom: temPontoDaLoja ? 13 : 4,
        // Os + e − são NOSSOS (canto direito, do tamanho dos outros botões).
        // O controle nativo do Leaflet nasce pequeno no canto esquerdo e ficava
        // escondido atrás do painel de rotas — o lojista não achava como
        // aproximar e ficava no scroll do mouse.
        zoomControl: false,
        preferCanvas: true,
        updateWhenZooming: false,
        updateWhenIdle: true,
      });

      // ── AS IMAGENS DO MAPA VOLTARAM PARA O OPENSTREETMAP ────────────────
      //
      // Em 12/09/2026 troquei estas imagens para a CDN da CARTO, achando que
      // resolveria o engasgo em rede compartilhada. A CARTO passou a exigir
      // chave de API nesses mapas: o lojista abriu a roteirização e o mapa
      // inteiro veio coberto de "API KEY REQUIRED" escrito em diagonal, sem
      // ruas legíveis. Pior que o problema que eu queria resolver.
      //
      // O OpenStreetMap não pede chave e é o que a loja já usava. O peso que
      // a troca queria aliviar não estava aqui: o que travava a roteirização
      // no Wi-Fi era a BUSCA de endereço, e essa já saiu do navegador (ver
      // lib/geocodificacao-servidor.ts). Trocar o provedor de imagem de novo
      // só com um que funcione sem chave e testado na tela.
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap contributors',
        subdomains: "abc",
        maxZoom: 19,
        keepBuffer: 5,
      }).addTo(map);

      leafletMapRef.current = map;
    }

    return () => {
      // Limpa a instância APENAS se o componente for completamente desmontado da página
      if (leafletMapRef.current) {
        try {
          leafletMapRef.current.remove();
        } catch {}
        leafletMapRef.current = null;
      }
    };
  }, [leafletLoaded, defaultCenter, temPontoDaLoja]);

  // 2. Reajusta dimensões do container do mapa instantaneamente ao abrir o modal
  useEffect(() => {
    if (isOpen && leafletMapRef.current) {
      const t1 = setTimeout(() => {
        try { leafletMapRef.current?.invalidateSize(); } catch {}
      }, 50);
      const t2 = setTimeout(() => {
        try { leafletMapRef.current?.invalidateSize(); } catch {}
      }, 200);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [isOpen]);

  // 3. Desenha Pinos, Motoboys e Rotas reusando o mapa existente (SEM resetar o zoom do usuário)
  useEffect(() => {
    if (!leafletLoaded || !leafletMapRef.current) return;
    const L = (window as any).L;
    if (!L) return;

    const map = leafletMapRef.current;
    // O divIcon, o popup e o tooltip do Leaflet entram como HTML: nome do
    // entregador e endereço da loja são texto livre e saem escapados (XSS).
    const esc = (t: unknown) =>
      String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

    // Clear existing markers and polylines
    markersRef.current.forEach(m => m.remove());
    markersRef.current.clear();
    polylinesRef.current.forEach(p => p.remove());
    polylinesRef.current = [];

    // 1. Render Store Marker (Blue House Icon)
    //
    // Só com ponto de verdade. A casinha num lugar que ninguém marcou é pior
    // que casinha nenhuma: o lojista lê como "é aqui que o FireHub acha que eu
    // estou" e sai medindo distância a partir dali.
    if (temPontoDaLoja) {
      const storeHtml = `
        <div style="
          background: #1C1917; color: #fff; width: 38px; height: 38px; borderRadius: 50%;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 4px 12px rgba(28, 25, 23,0.5); border: 3px solid #fff;
          font-size: 1.2rem; cursor: pointer;
        " title="Sua Loja - ${esc(storeAddress || storeCity)}">
          🏠
        </div>
      `;
      const storeIcon = L.divIcon({
        html: storeHtml,
        className: "custom-store-pin",
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });

      const storeMarker = L.marker([defaultCenter.lat, defaultCenter.lng], { icon: storeIcon })
        .addTo(map)
        .bindPopup(`<b>🏠 ${esc(storeAddress || "Sua Loja")}</b><br/>Ponto Inicial de Entrega`);
      markersRef.current.set("STORE", storeMarker);
    }

    // 2. Render Orders Markers com Posição Anti-Sobreposição (Lado a Lado / Leque Circular)
    deliveryOrders.forEach(order => {
      const coords = displayCoordinatesMap[order.id] || geocodedMap[order.id];
      if (!coords) return;

      // O leque em pixels substituiu a "spider line": a haste inclinada do
      // próprio pino é a linha até o ponto real do endereço.
      const isSelected = selectedOrderIds.includes(order.id);
      const selectedIndex = selectedOrderIds.indexOf(order.id);
      const isHovered = hoveredOrderId === order.id;
      // De onde veio o ponto (lib/ponto-do-pedido.ts). Centro do bairro é
      // aproximado: a gota ganha a borda tracejada e a caixa diz para conferir.
      const local = infoDoPino[order.id];
      const aproximado = Boolean(local?.aproximado);

      const assignedRoute = createdRoutes.find(r => r.orders.some(ro => ro.id === order.id));

      // ── A COR DIZ EM QUE PÉ ESTÁ O PEDIDO ───────────────────────────
      //
      // Vermelho está na cozinha, roxo já ficou pronto, azul saiu com o
      // motoboy. É a leitura que o lojista pediu, e é a mesma convenção que
      // ele já usa no outro sistema — trocar as cores só o obrigaria a
      // aprender duas.
      const prontoNaCozinha = estaPronto(order);
      const jaDespachado = Boolean((order as any).__jaDespachado);
      // Mesma razão do bloco acima: a marca não expira sozinha, o relógio sim.
      const carimboEntrega = (order as any).deliveredAt || (order as any).updatedAt;
      const recemEntregue =
        Boolean((order as any).__recemEntregue) &&
        Boolean(carimboEntrega) &&
        Date.now() - new Date(carimboEntrega).getTime() < 10_000;
      if ((order as any).__recemEntregue && !recemEntregue) return; // passou dos 10 s: sai do mapa

      // Estado desmarcado na legenda não desenha pino. O pedido continua na
      // lista e na rota — é só a vista do mapa que fica mais limpa.
      const estadoDoPino = recemEntregue ? "entregue" : jaDespachado ? "rota" : prontoNaCozinha ? "pronto" : "cozinha";
      if (!estadosNoMapa[estadoDoPino as keyof typeof estadosNoMapa]) return;

      let bgColor: string = COR_DO_ESTADO[estadoDoPino];
      let labelText = getOrderDisplayNumber(order);
      let borderColor = "#ffffff";
      let scaleCss = "scale(1)";
      let zIdx = jaDespachado ? 80 : 100;
      let shadowCss = "0 4px 10px rgba(0,0,0,0.3)";

      if (isHovered) {
        bgColor = "#1C1917";
        borderColor = "#E7DDD3";
        scaleCss = "scale(1.4)";
        shadowCss = "0 0 20px rgba(28, 25, 23,0.8)";
        zIdx = 999;
      } else if (isSelected) {
        bgColor = "#1C1917"; // Bright blue for active route selection
        labelText = `${selectedIndex + 1}`; // Sequence 1, 2, 3
        borderColor = "#E7DDD3";
        scaleCss = "scale(1.2)";
        zIdx = 900;
      } else if (assignedRoute && !jaDespachado && !recemEntregue) {
        // Na rota montada o fundo CONTINUA dizendo o estado: vermelho na
        // cozinha, roxo pronto. Pintar com a cor da rota (o padrão é azul)
        // deixava o 36 e o 37 azuis, e azul na legenda é "Saiu para entrega"
        // (Douglas, 22/10/2026 21h35). A rota só marca a BORDA da gota — o
        // anel roxo da prioridade é outro, por fora dela (box-shadow).
        borderColor = assignedRoute.color || "#0F766E";
        zIdx = 500;
      }

      // Prioridade pedida no KDS: um anel roxo por fora da gota, por cima de
      // qualquer cor — o vermelho continua dizendo "na cozinha", o anel diz
      // "na frente da fila". Só enquanto está na cozinha, como o botão.
      if (!prontoNaCozinha && !jaDespachado && !recemEntregue && estaPriorizado(order)) {
        shadowCss = `0 0 0 3px #7C3AED, ${shadowCss}`;
      }

      // Gota clássica de mapa: a ponta toca o endereço e o número fica numa
      // bola branca dentro dela. Pedidos empilhados abrem em leque — a gota
      // inclina em torno da própria ponta, com um cabo afilado da mesma cor
      // quando precisa de distância. Tudo em PIXELS: nenhum zoom reempilha.
      // A bola interna contra-rotaciona para o número ficar sempre reto.
      const fan = clusterFanMap[order.id] || { angulo: 0, haste: 0 };
      const alturaCentro = 41 + fan.haste; // ponta→centro da gota (17 + 24 + cabo)

      const pinHtml = `
        <div style="position: relative; width: 0; height: 0;">
          <div style="
            position: absolute; left: 0; top: 0; width: 0; height: 0;
            transform: rotate(${fan.angulo}deg) ${scaleCss}; transition: transform 0.2s ease;
          ">
            ${fan.haste > 0 ? `
            <!-- cabo afilado, contínuo com a gota (só quando há leque) -->
            <div style="
              position: absolute; left: -4px; top: ${-(fan.haste + 6)}px; width: 0; height: 0;
              border-left: 4px solid transparent; border-right: 4px solid transparent;
              border-top: ${fan.haste + 6}px solid ${bgColor};
              filter: drop-shadow(0 1px 1px rgba(0,0,0,0.25));
            "></div>` : ""}
            <!-- a gota: quadrado com 3 cantos redondos, girado 45° -->
            <div style="
              position: absolute; left: -17px; top: ${-alturaCentro - 17}px;
              width: 34px; height: 34px; border-radius: 50% 50% 50% 0;
              transform: rotate(-45deg); background: ${bgColor};
              border: 2.5px ${aproximado ? "dashed" : "solid"} ${borderColor}; box-shadow: ${shadowCss};
              display: flex; align-items: center; justify-content: center;
              cursor: pointer; box-sizing: border-box;
            ">
              <div style="
                transform: rotate(${45 - fan.angulo}deg);
                background: #ffffff; color: #0F172A; min-width: 21px; height: 21px;
                padding: 0 3px; border-radius: 50%; font-size: 0.72rem; font-weight: 900;
                display: inline-flex; align-items: center; justify-content: center;
                white-space: nowrap; box-shadow: inset 0 1px 2px rgba(0,0,0,0.18);
                box-sizing: border-box;
              ">
                ${labelText}
              </div>
            </div>
          </div>
        </div>
      `;

      const orderIcon = L.divIcon({
        html: pinHtml,
        className: `custom-order-pin-${order.id}`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const orderMarker = L.marker([coords.lat, coords.lng], { icon: orderIcon, zIndexOffset: zIdx })
        .addTo(map);

      // ── A CAIXA NÃO PODE TAMPAR O PINO ───────────────────────────────
      //
      // O pino é desenhado ACIMA do ponto do endereço (a gota sobe
      // `alturaCentro` px a partir da ponta), e a caixa abria ancorada no
      // mesmo ponto, crescendo para cima: ela cobria o próprio pino, e o
      // clique para montar a rota caía na caixa. Abrindo sozinha ao passar o
      // mouse, ainda arrastava o mapa para caber (autoPan) e o pino fugia do
      // cursor. Só dava para selecionar pela lista do lado (Douglas,
      // 01/10/2026).
      //
      // Agora a ponta da caixa fica no TOPO da gota (seguindo o leque e a
      // escala do pino) e o mapa não se mexe.
      const escala = parseFloat(scaleCss.replace(/[^\d.]/g, "")) || 1;
      const angulo = (fan.angulo * Math.PI) / 180;
      const topoDoPino: [number, number] = [
        Math.round(Math.sin(angulo) * alturaCentro * escala),
        -Math.round((Math.cos(angulo) * alturaCentro + 26) * escala),
      ];
      const caixaDoPedido = L.popup({ autoPan: false, closeButton: false, offset: topoDoPino })
        .setLatLng([coords.lat, coords.lng])
        .setContent(popupDoPedido(order, jaDespachado, prontoNaCozinha, local));

      // ── O PEDIDO INTEIRO SÓ DE PASSAR O MOUSE ────────────────────────
      //
      // Quem monta rota precisa saber o que é cada pino — cliente, endereço,
      // prazo, pagamento — sem abrir um por um. O conteúdo já era este; só
      // exigia clique, e clique no pino também SELECIONA o pedido: para
      // conferir, o lojista tinha de selecionar e desmarcar em seguida.
      //
      // O Leaflet mantém um popup aberto por vez, então passar para o pino
      // vizinho troca o conteúdo sozinho, sem acumular caixas na tela.
      //
      // Abre só com o mouse PARADO no pino por um instante: quem só passa a
      // caminho do pino vizinho, ou vai direto clicar, não ganha caixa no
      // caminho. Saiu do pino, ela fecha.
      let esperaDaCaixa: ReturnType<typeof setTimeout> | null = null;
      const cancelarEspera = () => {
        if (esperaDaCaixa) clearTimeout(esperaDaCaixa);
        esperaDaCaixa = null;
      };
      const fecharCaixa = () => {
        cancelarEspera();
        if (map.hasLayer(caixaDoPedido)) map.closePopup(caixaDoPedido);
      };
      orderMarker.on("mouseover", () => {
        cancelarEspera();
        // Posicionando outro pedido: a caixa taparia o lugar do clique.
        if (posicionandoRef.current) return;
        esperaDaCaixa = setTimeout(() => caixaDoPedido.openOn(map), ESPERA_DA_CAIXA_DO_PINO_MS);
      });
      orderMarker.on("mouseout", fecharCaixa);
      // O mapa redesenha os pinos a cada seleção: pino que sai leva a caixa.
      orderMarker.on("remove", fecharCaixa);

      // Botão direito no pino: corrigir o lugar dele (o mesmo "📍 Corrigir
      // local" do cartão do pedido).
      orderMarker.on("contextmenu", (e: any) => {
        try { e?.originalEvent?.preventDefault?.(); } catch {}
        fecharCaixa();
        iniciarPosicionamento(order.id);
      });

      orderMarker.on("click", (e: any) => {
        fecharCaixa();
        // Modo de posicionar ligado: o clique no pino vizinho marca o ponto ali
        // (dois pedidos do mesmo prédio) e não mexe na rota.
        if (posicionandoRef.current) {
          if (e?.latlng) setPontoProvisorio({ lat: e.latlng.lat, lng: e.latlng.lng });
          return;
        }
        // ── PINO AZUL E VERDE SÃO INFORMATIVOS, NÃO SELECIONÁVEIS ────────
        //
        // Desde que o pedido despachado passou a ficar no mapa, o pino dele
        // aceitava clique como qualquer outro e entrava na próxima rota. Dali
        // em diante nada barrava: a rota gravava o motoboy novo por cima, o
        // despacho marcava SAIU_ENTREGA de novo, e o entregador que estava com
        // a comida na mão levava 404 ao tentar dar baixa — preso na porta do
        // cliente, que é exatamente o que passamos a noite consertando.
        //
        // Com o recém-entregue era pior: o despacho reescrevia ENTREGUE para
        // SAIU_ENTREGA e o pedido sumia do faturamento do dia.
        if (jaDespachado || recemEntregue) return;
        toggleOrderSelection(order.id);
      });

      markersRef.current.set(order.id, orderMarker);
    });

    // 3. Render Motoboys Markers with Helmets & Blue Name Badges (Saipos Style)
    (mostrarMotoboys ? motoboys : []).forEach(mb => {
      const mbLat = (mb as any).lastLat;
      const mbLng = (mb as any).lastLng;
      if (!mbLat || !mbLng) return;

      const atualizadoEm = (mb as any).lastLocationUpdate ? new Date((mb as any).lastLocationUpdate).getTime() : 0;
      const minAtras = atualizadoEm ? Math.round((Date.now() - atualizadoEm) / 60000) : null;

      // ── POSIÇÃO ANTIGA APARECE, MAS COM CARA DE ANTIGA ────────────────────
      //
      // Antes havia `if (minAtras > 30) return`: o entregador simplesmente
      // sumia do mapa. A intenção era certa — posição de 2h atrás não é
      // "tempo real" e não serve para montar rota — mas a execução jogava fora
      // justamente a informação de ONDE ELE FOI VISTO POR ÚLTIMO, que é o que
      // a loja procura depois que ele dá baixa e fecha o app.
      //
      // Agora a posição velha continua no mapa, apagada e sem cor de alerta,
      // com o horário em destaque. Some só quando nunca houve posição.
      const recente = minAtras !== null && minAtras <= 30;

      // ── COM ENTREGA OU VOLTANDO PARA A LOJA ────────────────────────────
      //
      // O lojista lê o mapa por cor: "o motoboy vermelho está em entrega;
      // quando não está, você sabe que ele está voltando para a loja". Todos
      // os capacetes eram vermelhos, então a informação não existia — dava
      // para ver ONDE cada um estava, nunca QUEM estava livre para a próxima
      // rota. Verde é quem pode receber pedido agora.
      const entregasNaRua = orders.filter((o: any) => {
        if (String(o.motoboyId || "") !== String(mb.id)) return false;
        const s = String(o.status || "").toUpperCase().trim();
        return s !== "ENTREGUE" && s !== "ENCERRADO" && !s.includes("CANCEL");
      }).length;
      const emEntrega = entregasNaRua > 0;
      const corCapacete = !recente ? "#94A3B8" : emEntrega ? "#C92E09" : "#0F766E";
      const corNome = !recente ? "#64748B" : emEntrega ? "#B71C1C" : "#0F766E";

      // Nome ABAIXO do capacete: em cima ele brigava com o pino de entrega
      // que costuma ficar logo acima, e o dono pediu embaixo.
      const mbHtml = `
        <div style="
          display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer;
          opacity: ${recente ? 1 : 0.75};
        ">
          <div style="
            background: ${corCapacete}; color: #FFFFFF; width: 30px; height: 30px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            border: 2px solid #FFFFFF; box-shadow: 0 3px 8px rgba(0,0,0,0.35); font-size: 0.95rem;
          ">
            ⛑️
          </div>
          <div style="
            background: ${corNome}; color: #FFFFFF; font-size: 0.72rem; font-weight: 900;
            padding: 2px 7px; border-radius: 4px; border: 1.5px solid #FFFFFF;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3); text-transform: uppercase; white-space: nowrap;
            margin-top: 2px;
          ">
            ${esc(mb.name)}${emEntrega ? ` · ${entregasNaRua}` : ""}
          </div>
        </div>
      `;

      // O capacete agora é o bloco de CIMA, então a âncora sobe junto: o ponto
      // do mapa é onde está o capacete, não onde está a etiqueta do nome.
      const mbIcon = L.divIcon({
        html: mbHtml,
        className: `custom-motoboy-pin-${mb.id}`,
        iconSize: [60, 48],
        iconAnchor: [30, 15],
      });

      // Data e hora COMPLETAS da última atualização: "há X min" sozinho não
      // diz se foi hoje — e uma posição de ontem lida como "de agora" faz a
      // loja esperar um entregador que nem está trabalhando.
      const dataHora = atualizadoEm
        ? new Date(atualizadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
        : null;
      const mbMarker = L.marker([mbLat, mbLng], { icon: mbIcon, zIndexOffset: 950 })
        .addTo(map)
        .bindPopup(`<b>🛵 Entregador ${esc(mb.name)}</b> <span style="color:${emEntrega ? "#B71C1C" : "#0F766E"};font-weight:700;">${emEntrega ? `${entregasNaRua} entrega(s) na rua` : "livre"}</span><br/>📍 ${
          minAtras === null ? "Localização GPS"
            : minAtras <= 1 ? "Atualizado agora"
            : recente ? `Atualizado há ${minAtras} min`
            // Posição velha não pode se anunciar como se fosse de agora: quem
            // lê tem que saber que está vendo o ÚLTIMO lugar onde ele apareceu.
            : `Visto por último há ${minAtras >= 60 ? `${Math.floor(minAtras / 60)}h${String(minAtras % 60).padStart(2, "0")}` : `${minAtras} min`}`
        }${dataHora ? `<br/><span style="color:#64748B;font-size:0.78rem;">🕒 ${dataHora}</span>` : ""}`)
        .bindTooltip(dataHora ? `${esc(mb.name)} · ${dataHora}` : esc(mb.name), { direction: "top", offset: [0, -12] });

      markersRef.current.set(`MOTOBOY_${mb.id}`, mbMarker);
    });

    // 4. Draw Polylines for Active Selection Sequence
    if (selectedOrderIds.length > 0) {
      // A linha da rota começa na loja — quando se sabe onde ela fica.
      const routePoints: [number, number][] = temPontoDaLoja ? [[defaultCenter.lat, defaultCenter.lng]] : [];

      selectedOrderIds.forEach(id => {
        const coords = displayCoordinatesMap[id] || geocodedMap[id];
        if (coords) {
          routePoints.push([coords.lat, coords.lng]);
        }
      });

      if (routePoints.length > 1) {
        const polyline = L.polyline(routePoints, {
          color: "#1C1917",
          weight: 4,
          dashArray: "8, 8",
          opacity: 0.95,
        }).addTo(map);

        polylinesRef.current.push(polyline);
      }
    }

    // 5. As linhas das rotas já criadas — só as que ainda não saíram e a que
    // o lojista pediu para ver (lib/rotas-no-mapa.ts). Era uma linha para
    // CADA rota das últimas 24 h, despachada ou não: "monte de linha, o
    // pedido fica embolado" (Lucas, 13/10/2026). A linha liga só pinos que
    // estão no mapa (`displayCoordinatesMap`), nunca ponto de pedido entregue.
    rotasComLinha(createdRoutes, { aba: activeTab, rotaEmFoco }).forEach(route => {
      // Pela rua onde já há desenho da perna; reta onde não há (ver acima).
      const points = linhaPelaRua(pontosDaLinha(route, displayCoordinatesMap, temPontoDaLoja ? defaultCenter : null), (k) => desenhosPelaRua[k]);
      if (points.length === 0) return;
      const emFoco = route.id === rotaEmFoco;
      const routePoly = L.polyline(points, {
        // A rota em foco ("Ver no mapa") fica roxa para se destacar das outras.
        color: emFoco ? "#7C3AED" : route.color || "#0F766E",
        weight: emFoco ? 6 : 4,
        opacity: emFoco ? 0.95 : 0.8,
      }).addTo(map);
      polylinesRef.current.push(routePoly);
    });
  }, [leafletLoaded, defaultCenter, temPontoDaLoja, deliveryOrders, geocodedMap, displayCoordinatesMap, clusterCentersMap, clusterFanMap, selectedOrderIds, createdRoutes, activeTab, rotaEmFoco, desenhosPelaRua, hoveredOrderId, motoboys, mostrarMotoboys, storeAddress, storeCity, tiqueDoMapa, estadosNoMapa, estaPronto, estaPriorizado, infoDoPino]);

  // O pino verde do recém-entregue precisa SUMIR sozinho ao completar os 10 s.
  // Sem um tique, ele só sairia no próximo evento que redesenhasse o mapa — e
  // ficaria lá parado, dizendo que a entrega acabou de acontecer.
  useEffect(() => {
    if (!isOpen) return;
    // A marca `__recemEntregue` é gravada no objeto do pedido e nunca é
    // limpa: decidir por ela deixava o timer se reagendando para sempre, o
    // mapa se redesenhando a cada 2,5 s (fechando popup e derrubando o hover
    // na tela que fica aberta a noite toda) e o pino verde eternizado dizendo
    // que uma entrega acabou de acontecer. Quem decide é o relógio.
    const aindaNaJanela = (o: any) => {
      const q = o?.deliveredAt || o?.updatedAt;
      return q ? Date.now() - new Date(q).getTime() < 10_000 : false;
    };
    const temRecente = deliveryOrders.some((o: any) => o.__recemEntregue && aindaNaJanela(o));
    if (!temRecente) return;
    const t = setTimeout(() => setTiqueDoMapa((n) => n + 1), 2500);
    return () => clearTimeout(t);
  }, [isOpen, deliveryOrders, tiqueDoMapa]);

  // Toggle order selection for forming a route
  const toggleOrderSelection = (id: string) => {
    setSelectedOrderIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(item => item !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  // Open Dispatch Modal
  const handleOpenDispatch = () => {
    if (selectedOrderIds.length === 0) return;
    setShowDispatchModal(true);
  };

  // ── DESPACHAR SEM TRAVAR A TELA ─────────────────────────────────────────
  //
  // "Seleciona os pedidos, coloca despachar, seleciona o motoboy, bota
  // despachar — trava toda hora; quando dá ok aparece a mensagem em cima, ele
  // atualiza e vai para aquele monte de rota" (Lucas, Frangoso, 13/10/2026).
  // O botão fazia, em fila e sem soltar a tela: criar a rota (sem
  // "carregando" e ainda clicável — o segundo clique criava outra rota com os
  // mesmos pedidos), despachar, esperar a lista de rotas inteira voltar do
  // servidor e um alert() que congelava a página até o OK. Depois do OK,
  // buscava os pedidos de novo e trocava para a aba ROTAS, com uma linha por
  // rota do dia.
  //
  // Agora: trava no primeiro clique (`despachandoRef`), "carregando" desde o
  // início, a rota entra na lista com o que o próprio servidor devolveu, o
  // aviso desce no topo sem bloquear nada, e a tela fica onde estava — a
  // lista do servidor e os pedidos chegam por trás, sem ninguém esperar.

  /** O fim de toda montagem: limpa a seleção e fecha o modal do despacho. */
  const limparMontagem = () => {
    setSelectedOrderIds([]);
    setShowDispatchModal(false);
    setSelectedMotoboyId("");
    setCustomMotoboyName("");
    setCustomMotoboyPhone("");
  };

  /** Rotas e pedidos frescos do servidor, em segundo plano. */
  const atualizarEmSegundoPlano = () => {
    void recarregarRotas();
    if (onRefreshOrders) onRefreshOrders();
  };

  const nomeDoMotoboy = (id: string) => motoboys.find((m) => m.id === id)?.name || "";

  /** POST /api/store/routes. Devolve a rota já na lista; lança com a frase do servidor. */
  const criarRotaNoServidor = async (orderIds: string[], motoboyId: string | null): Promise<RouteItem> => {
    const color = ROUTE_COLORS[createdRoutes.length % ROUTE_COLORS.length];
    const res = await fetch("/api/store/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderIds, motoboyId, color }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.route?.id) throw new Error(data?.error || "Não consegui criar a rota agora.");
    const rota = rotaDaTela(data.route);
    colocarRotaNaLista(rota);
    return rota;
  };

  /** POST /api/store/routes/dispatch. Lança com a frase do servidor. */
  const despacharNoServidor = async (routeId: string, motoboyId: string): Promise<void> => {
    const res = await fetch("/api/store/routes/dispatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeId, motoboyId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || "Não consegui despachar a rota agora.");
    }
  };

  // Criar Rota no Banco de Dados (Com ou Sem Motoboy)
  const handleCreateRouteToDB = async (motoboyIdToAssign?: string) => {
    if (selectedOrderIds.length === 0 || despachandoRef.current) return;
    despachandoRef.current = true;
    setIsDispatching(true);

    try {
      const rota = await criarRotaNoServidor([...selectedOrderIds], motoboyIdToAssign || selectedMotoboyId || null);
      limparMontagem();
      // Fica na aba em que estava (era jogado para ROTAS): quem cria rota sem
      // motoboy costuma seguir montando a próxima.
      setAviso({
        tipo: "ok",
        titulo: `${rota.routeNumber} criada, esperando o motoboy`,
        detalhe: "Quando ele chegar, escolha o entregador no card da rota, na aba ROTAS.",
      });
      atualizarEmSegundoPlano();
    } catch (err: any) {
      console.error("Erro ao criar rota no banco:", err);
      setAviso({ tipo: "erro", titulo: "A rota não foi criada", detalhe: err?.message || String(err) });
    } finally {
      despachandoRef.current = false;
      setIsDispatching(false);
    }
  };

  /**
   * Trocar o entregador de uma rota JÁ DESPACHADA.
   *
   * Sem isto, escolher o motoboy era decisão de uma vez só: o entregador
   * furava, passava mal, o pneu estourava — e a rota ficava travada no nome
   * dele, com os pedidos amarrados junto. A troca vai para o PATCH, que
   * atualiza a rota E todos os pedidos dela: se só a rota mudasse, o painel
   * mostraria um entregador e o app do motoboy outro.
   */
  const trocarEntregadorDaRota = async (routeId: string, novoMotoboyId: string) => {
    setIsDispatching(true);
    try {
      const res = await fetch("/api/store/routes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId, motoboyId: novoMotoboyId || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAviso({ tipo: "erro", titulo: "O entregador não foi trocado", detalhe: err.error || "Não consegui trocar o entregador desta rota." });
        return;
      }
      await recarregarRotas();
      if (onRefreshOrders) onRefreshOrders();
      const nome = nomeDoMotoboy(novoMotoboyId);
      setAviso({ tipo: "ok", titulo: nome ? `Rota agora com ${nome}` : "Entregador da rota trocado" });
    } catch (err: any) {
      setAviso({ tipo: "erro", titulo: "O entregador não foi trocado", detalhe: err?.message || String(err) });
    } finally {
      setIsDispatching(false);
    }
  };

  // ── ROTA AUTOMÁTICA: CHAMAR DE NOVO / TROCAR QUEM É CHAMADO ─────────────
  //
  // POST /api/store/routes/chamar, NUNCA o PATCH acima: o PATCH grava o
  // motoboy nos pedidos, e na rota automática o pedido só ganha dono quando o
  // entregador escaneia o QR (o puxar decide quem leva). `null` = todos os
  // livres ("quem chegar primeiro sai com ela").
  const chamarEntregadorDaRota = async (route: RouteItem, motoboyId: string | null, deNovo: boolean) => {
    setIsDispatching(true);
    const titulo = deNovo ? "O entregador não foi chamado de novo" : "O entregador não foi trocado";
    try {
      const res = await fetch("/api/store/routes/chamar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId: route.id, motoboyId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ tipo: "erro", titulo, detalhe: d?.error || "Tente de novo." });
        return;
      }
      await recarregarRotas();
      const quem = motoboyId ? nomeDoMotoboy(motoboyId) || "o entregador" : "todos os entregadores";
      setAviso({ tipo: "ok", titulo: `${route.routeNumber}: ${quem} ${motoboyId ? "chamado" : "chamados"}`, detalhe: "O aviso chega no app do entregador." });
    } catch (err: any) {
      setAviso({ tipo: "erro", titulo, detalhe: err?.message || String(err) });
    } finally {
      setIsDispatching(false);
    }
  };

  // ── "✋ FORA DA AUTOMÁTICA · VOLTAR" ─────────────────────────────────────
  //
  // O pedido que a loja tirou de rota automática volta a ser agrupado pelo
  // cron. O palpite some o selo na hora, por 20 s como o pronto e a
  // prioridade, e cai quando a próxima consulta das rotas confirma.
  const [voltasOtimistas, setVoltasOtimistas] = useState<Record<string, number>>({});
  const estaForaDaAutomatica = (id: string) => foraDaAutomatica.has(id) && !((voltasOtimistas[id] ?? 0) > Date.now());
  useEffect(() => {
    setVoltasOtimistas((atual) => {
      const ids = Object.keys(atual);
      if (ids.length === 0) return atual;
      const agora = Date.now();
      const proximo: Record<string, number> = {};
      for (const id of ids) if (foraDaAutomatica.has(id) && atual[id] > agora) proximo[id] = atual[id];
      return Object.keys(proximo).length === ids.length ? atual : proximo;
    });
  }, [foraDaAutomatica]);
  const voltarParaAutomatica = async (orderId: string) => {
    setVoltasOtimistas((a) => ({ ...a, [orderId]: Date.now() + 20000 }));
    const desfazerPalpite = () => setVoltasOtimistas((a) => tirarDoPalpite(a, [orderId]));
    try {
      const res = await fetch(`/api/store/orders/${orderId}/rota-automatica`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voltar: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        desfazerPalpite();
        setAviso({ tipo: "erro", titulo: "O pedido não voltou para a rota automática", detalhe: err?.error || "Tente de novo." });
        return;
      }
      recarregarRotas();
    } catch (err: any) {
      desfazerPalpite();
      setAviso({ tipo: "erro", titulo: "O pedido não voltou para a rota automática", detalhe: err?.message || String(err) });
    }
  };

  // Despachar Rota Existente (Move pedidos para SAIU_ENTREGA e notifica WhatsApp)
  const handleDispatchExistingRoute = async (routeId: string, assignedMotoboyId?: string) => {
    const finalMbId = assignedMotoboyId || selectedMotoboyId;
    if (!finalMbId) {
      setAviso({ tipo: "atencao", titulo: "Escolha o motoboy para despachar a rota" });
      return;
    }
    if (despachandoRef.current) return;
    despachandoRef.current = true;
    setIsDispatching(true);

    try {
      await despacharNoServidor(routeId, finalMbId);
      const rota = createdRoutes.find((r) => r.id === routeId);
      const nome = nomeDoMotoboy(finalMbId);
      if (rota) colocarRotaNaLista({ ...rota, status: "🚀 Despachada", motoboyId: finalMbId, motoboyName: nome || rota.motoboyName });
      setAviso({
        tipo: "ok",
        titulo: `🚀 ${rota?.routeNumber || "Rota"} despachada${nome ? ` com ${nome}` : ""}`,
        detalhe: `Pedidos em "Saiu para entrega".`,
      });
      atualizarEmSegundoPlano();
    } catch (err: any) {
      console.error("Erro ao despachar rota:", err);
      setAviso({ tipo: "erro", titulo: "A rota não foi despachada", detalhe: err?.message || String(err) });
    } finally {
      despachandoRef.current = false;
      setIsDispatching(false);
    }
  };

  // Confirm Dispatch & Create/Dispatch Route from Modal
  const handleConfirmDispatch = async () => {
    if (selectedOrderIds.length === 0) return;

    if (!selectedMotoboyId && !customMotoboyName.trim()) {
      // Se não escolheu motoboy, cria a rota como "Aguardando Motoboy" no banco!
      await handleCreateRouteToDB();
      return;
    }

    if (despachandoRef.current) return;
    despachandoRef.current = true;
    setIsDispatching(true);

    const idsDaRota = [...selectedOrderIds];
    let rota: RouteItem | null = null;

    try {
      // Se escolheu motoboy, cria a rota e despacha imediatamente!
      let motoboyId = selectedMotoboyId;
      let nome = nomeDoMotoboy(motoboyId);
      let senhaGerada: string | null = null;
      if (!motoboyId && customMotoboyName.trim()) {
        // Se digitou nome de motoboy customizado, cria o motoboy se necessário
        try {
          const mbRes = await fetch("/api/motoboys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: customMotoboyName.trim(),
              phone: customMotoboyPhone.trim(),
            }),
          });
          if (mbRes.ok) {
            const newMb = await mbRes.json();
            motoboyId = newMb.id;
            nome = newMb.name || customMotoboyName.trim();
            // Entregador novo nasce com senha sorteada (não é mais 123456).
            senhaGerada = newMb.senhaGerada || null;
          }
        } catch (e) {}
      }

      // 1. Cria a rota no banco
      rota = await criarRotaNoServidor(idsDaRota, motoboyId || null);

      // 2. Se informou motoboy, despacha a rota imediatamente
      if (motoboyId) {
        await despacharNoServidor(rota.id, motoboyId);
        colocarRotaNaLista({ ...rota, status: "🚀 Despachada", motoboyId, motoboyName: nome || rota.motoboyName });
        setAviso({
          tipo: "ok",
          titulo: `🚀 ${rota.routeNumber} despachada${nome ? ` com ${nome}` : ""}`,
          detalhe: `${idsDaRota.length} pedido(s) em "Saiu para entrega".`
            + (senhaGerada ? ` Senha do app de ${nome}: ${senhaGerada} — passe para ele (toque para fechar).` : ""),
          fixo: !!senhaGerada,
        });
      } else {
        // O entregador digitado não foi cadastrado: a rota existe, sem ele.
        setAviso({
          tipo: "atencao",
          titulo: `${rota.routeNumber} criada sem motoboy`,
          detalhe: "Não consegui cadastrar o entregador digitado. Escolha o motoboy no card da rota, na aba ROTAS.",
        });
      }

      // A tela fica onde estava: mesma aba, mesmo mapa. Era aqui que ela
      // pulava para ROTAS e desenhava uma linha para cada rota do dia.
      limparMontagem();
      atualizarEmSegundoPlano();
    } catch (err: any) {
      console.error("Erro ao criar rota:", err);
      if (rota) {
        // A rota nasceu mas não saiu: os pedidos já estão nela (saíram dos
        // pendentes) e o despacho se refaz pelo card.
        limparMontagem();
        atualizarEmSegundoPlano();
        setAviso({
          tipo: "erro",
          titulo: `${rota.routeNumber} foi criada, mas não saiu`,
          detalhe: `${err?.message || err} Ela está na aba ROTAS, esperando o despacho.`,
        });
      } else {
        setAviso({ tipo: "erro", titulo: "A rota não foi despachada", detalhe: err?.message || "Tente novamente." });
      }
    } finally {
      despachandoRef.current = false;
      setIsDispatching(false);
    }
  };

  // Copy Formatted Route Text for WhatsApp
  const handleCopyRouteText = (route: RouteItem) => {
    let text = `🚀 *ROTA DE ENTREGA #${route.routeNumber}*\n`;
    text += `🛵 *Motoboy:* ${route.motoboyName}\n`;
    text += `📦 *Total de Pedidos:* ${route.orders.length}\n\n`;

    const enderecos: string[] = [];

    route.orders.forEach((o, idx) => {
      const addr = o.address || `${o.street || ""}, ${o.number || ""} - ${o.neighborhood || ""}`;
      // O número que o lojista e o motoboy conhecem (#41, ou o do parceiro) —
      // saía o id interno inteiro, que ninguém reconhece no balcão.
      text += `*${idx + 1}º Parada:* Pedido #${getOrderDisplayNumber(o)}
`;
      text += `👤 *Cliente:* ${o.customerName}
`;
      text += `📍 *Endereço:* ${addr}
`;
      if (o.customerPhone) text += `📞 *Tel:* ${o.customerPhone}
`;
      text += `------------------------------
`;
      enderecos.push(addr);
    });

    // O mesmo link do WhatsApp que o despacho manda ao motoboy (lib/link-da-rota.ts):
    // cidade da LOJA só se cadastrada, sem ponto de partida fixo.
    const mapsUrl = linkDaRotaNoMaps(enderecos, storeCity);
    if (mapsUrl) text += `🗺️ *GPS Rota no Google Maps:*
${mapsUrl}`;

    navigator.clipboard.writeText(text);
    setCopiedRouteId(route.id);
    setTimeout(() => setCopiedRouteId(null), 3000);
  };

  // Delete Route (Remove do Banco de Dados)
  const handleDeleteRoute = async (routeId: string) => {
    // O aviso diz o que REALMENTE acontece: o pedido sai do celular do
    // entregador junto com a rota. Antes prometia só "voltam para pendentes",
    // e o pedido continuava no app dele.
    if (!confirm("Desfazer esta rota?\n\nOs pedidos voltam para pendentes e SAEM do aplicativo do entregador.")) return;
    try {
      const res = await fetch(`/api/store/routes?routeId=${encodeURIComponent(routeId)}`, { method: "DELETE" });
      if (!res.ok) {
        // 409 = rota já despachada: não se apaga, mas dá para trocar o
        // entregador. O servidor manda a frase pronta; a tela só mostra.
        const d = await res.json().catch(() => ({}));
        setAviso({ tipo: "atencao", titulo: "A rota não foi desfeita", detalhe: d?.error || "Não consegui desfazer esta rota agora." });
        return;
      }
      await recarregarRotas();
      if (onRefreshOrders) onRefreshOrders();
      setAviso({ tipo: "ok", titulo: "Rota desfeita", detalhe: "Os pedidos voltaram para os pendentes." });
    } catch (e) {
      console.error("Erro ao deletar rota:", e);
      setAviso({ tipo: "erro", titulo: "A rota não foi desfeita", detalhe: "Não consegui desfazer esta rota agora. Tente de novo." });
    }
  };

  // ── ✏️ EDITAR A ROTA: TIRAR OU INCLUIR PEDIDO ANTES DE DESPACHAR ────────
  //
  // PATCH /api/store/routes com a lista nova. O servidor confere tudo (rota
  // desta loja, ainda não despachada, não vazia, quem entra está livre) e
  // tira do app do entregador quem saiu. Quem sai de rota AUTOMÁTICA fica
  // "✋ fora da automática" na lista até o "voltar".
  const salvarEdicaoDaRota = async () => {
    if (!rotaEmEdicao || salvandoEdicao) return;
    const rota = createdRoutes.find((r) => r.id === rotaEmEdicao.routeId);
    if (!rota) { setRotaEmEdicao(null); return; }
    const { ids } = rotaEmEdicao;
    if (ids.length === 0) {
      setAviso({ tipo: "atencao", titulo: "A rota não pode ficar vazia", detalhe: "Para desfazer a rota inteira, use a lixeira 🗑️ do card." });
      return;
    }
    const antes = rota.orders.map((o) => o.id);
    const numero = (id: string) => `#${getOrderDisplayNumber(orders.find((o: any) => o.id === id) || rota.orders.find((o) => o.id === id) || { id })}`;
    const sairam = antes.filter((id) => !ids.includes(id));
    const entraram = ids.filter((id) => !antes.includes(id));
    if (sairam.length === 0 && entraram.length === 0) { setRotaEmEdicao(null); return; }
    setSalvandoEdicao(true);
    try {
      const res = await fetch("/api/store/routes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId: rota.id, orderIds: ids }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAviso({ tipo: "erro", titulo: "A rota não foi alterada", detalhe: err.error || "Não consegui salvar a rota agora. Tente de novo." });
        return;
      }
      setRotaEmEdicao(null);
      await recarregarRotas();
      if (onRefreshOrders) onRefreshOrders();
      const partes = [
        sairam.length ? `Saíram: ${sairam.map(numero).join(", ")}.` : "",
        entraram.length ? `Entraram: ${entraram.map(numero).join(", ")}.` : "",
        sairam.length && rota.origem === "AUTO" ? "Quem saiu não volta para a rota automática sozinho: use “voltar” na lista de pendentes." : "",
      ];
      setAviso({ tipo: "ok", titulo: `${rota.routeNumber} atualizada`, detalhe: partes.filter(Boolean).join(" ") });
    } catch (err: any) {
      setAviso({ tipo: "erro", titulo: "A rota não foi alterada", detalhe: err?.message || String(err) });
    } finally {
      setSalvandoEdicao(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999, background: "rgba(15, 23, 42, 0.75)",
      backdropFilter: "blur(4px)", display: isOpen ? "flex" : "none", alignItems: "center", justifyContent: "center",
      padding: modoIndependente ? 0 : "1rem"
    }}>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />
      {/* ─── ✏️ EDITAR A ROTA (tirar / incluir pedido antes de despachar) ─── */}
      {rotaEmEdicao && (() => {
        const rota = createdRoutes.find((r) => r.id === rotaEmEdicao.routeId);
        // A lista chega a cada 4 s: a rota pode ter saído (QR, outro aparelho)
        // ou sido desfeita enquanto o editar estava aberto.
        const travada = !rota || rotaJaDespachada(rota);
        const { ids } = rotaEmEdicao;
        // Os que podem entrar: os mesmos pendentes da lista (de entrega, sem
        // rota, não saíram), mais os que acabaram de ser tirados desta rota.
        const livres = deliveryOrders.filter(
          (o: any) => !o.__jaDespachado && !createdRoutes.some((r) => r.orders.some((ro) => ro.id === o.id)),
        );
        const candidatos = [...(rota?.orders || []), ...livres].filter((o) => !ids.includes(o.id));
        const pedido = (id: string): any => orders.find((o: any) => o.id === id) || rota?.orders.find((o) => o.id === id) || { id };
        const linha = (o: any, botao: React.ReactNode) => {
          const addr = o.customerAddress || o.address || `${o.street || ""} ${o.number || ""} ${o.neighborhood || ""}`.trim();
          const bairro = (bairrosDaLoja?.length
            ? bairroPeloEndereco(addr, bairrosDaLoja, { cidades: [storeCity] })?.name
            : null) || (addr ? parseAddressDetails(addr).neighborhood : "");
          const min = o.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60000)) : null;
          return (
            <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid #F1F5F9" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: "0.86rem", color: "#0F172A" }}>
                  #{getOrderDisplayNumber(o)}
                  {bairro ? <span style={{ fontWeight: 700, color: "#92400E" }}> · {bairro}</span> : null}
                  {min !== null ? <span style={{ fontWeight: 700, color: "#64748B" }}> · há {min} min</span> : null}
                </div>
                <div style={{ fontSize: "0.74rem", color: "#64748B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  📍 {addr || "Endereço a confirmar"}
                </div>
              </div>
              {botao}
            </div>
          );
        };
        const estiloDoBotao = (cor: string, fundo: string): React.CSSProperties => ({
          padding: "5px 10px", borderRadius: "6px", border: `1.5px solid ${cor}`, background: fundo, color: cor,
          fontWeight: 800, fontSize: "0.76rem", cursor: travada ? "not-allowed" : "pointer", fontFamily: "inherit", flexShrink: 0,
        });
        const mudar = (proximos: string[]) => setRotaEmEdicao({ routeId: rotaEmEdicao.routeId, ids: proximos });
        return (
          <div
            onClick={() => !salvandoEdicao && setRotaEmEdicao(null)}
            style={{ position: "fixed", inset: 0, zIndex: 100001, background: "rgba(15, 23, 42, 0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}
          >
            <div
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              style={{ width: "min(480px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column", background: "#FFFFFF", borderRadius: 14, boxShadow: "0 20px 50px rgba(15,23,42,.3)", overflow: "hidden" }}
            >
              <div style={{ padding: "14px 16px", borderBottom: "1px solid #E2E8F0" }}>
                <div style={{ fontWeight: 900, fontSize: "1rem", color: "#0F172A" }}>✏️ Editar {rota?.routeNumber || "rota"}</div>
                {travada ? (
                  <div style={{ fontSize: "0.78rem", color: "#B45309", marginTop: 4, fontWeight: 700 }}>
                    Esta rota já saiu com o entregador (ou foi desfeita) e não dá mais para mexer nos pedidos dela.
                  </div>
                ) : rota?.origem === "AUTO" ? (
                  <div style={{ fontSize: "0.76rem", color: "#5B21B6", marginTop: 4 }}>
                    Quem você tirar fica ✋ fora da rota automática até você tocar em “voltar” na lista de pendentes.
                  </div>
                ) : null}
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
                <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 6 }}>
                  Na rota ({ids.length})
                </div>
                {ids.length === 0 ? (
                  <p style={{ fontSize: "0.78rem", color: "#B45309", margin: "6px 0" }}>A rota não pode ficar vazia. Para desfazer a rota inteira, use a lixeira 🗑️.</p>
                ) : (
                  ids.map((id) => linha(pedido(id), (
                    <button type="button" disabled={travada || salvandoEdicao} onClick={() => mudar(ids.filter((x) => x !== id))} style={estiloDoBotao("#DC2626", "#FEF2F2")}>
                      Tirar
                    </button>
                  )))
                )}

                <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 14 }}>
                  Podem entrar ({candidatos.length})
                </div>
                {candidatos.length === 0 ? (
                  <p style={{ fontSize: "0.78rem", color: "#94A3B8", margin: "6px 0" }}>Nenhum pedido pendente sem rota agora.</p>
                ) : (
                  candidatos.map((o) => linha(pedido(o.id), (
                    <button type="button" disabled={travada || salvandoEdicao} onClick={() => mudar([...ids, o.id])} style={estiloDoBotao("#0F766E", "#F0FDFA")}>
                      Incluir
                    </button>
                  )))
                )}
              </div>

              <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid #E2E8F0", background: "#F8FAFC" }}>
                <button
                  type="button"
                  disabled={salvandoEdicao}
                  onClick={() => setRotaEmEdicao(null)}
                  style={{ flex: 1, padding: "9px", borderRadius: "8px", border: "1.5px solid #CBD5E1", background: "#FFFFFF", color: "#334155", fontWeight: 800, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={travada || salvandoEdicao}
                  onClick={salvarEdicaoDaRota}
                  style={{
                    flex: 2, padding: "9px", borderRadius: "8px", border: "none", background: travada ? "#94A3B8" : "#0F766E",
                    color: "#FFFFFF", fontWeight: 900, fontSize: "0.82rem", cursor: travada ? "not-allowed" : "pointer", fontFamily: "inherit",
                  }}
                >
                  {salvandoEdicao ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* ─── CONFIRMAÇÃO DO LOTE (no topo, sem confirm() do navegador) ─── */}
      {confirmacaoDoLote && (() => {
        const n = confirmacaoDoLote.ids.length;
        const numeros = confirmacaoDoLote.ids
          .map((id) => `#${getOrderDisplayNumber(orders.find((o: any) => o.id === id) || { id })}`)
          .join(", ");
        const pergunta = confirmacaoDoLote.acao === "pronto"
          ? `${n === 1 ? "Será dado como pronto este pedido" : `Serão dados como prontos estes ${n} pedidos`}: ${numeros}. Ok?`
          : `Será pedida prioridade no KDS para ${n === 1 ? "este pedido" : `estes ${n} pedidos`}: ${numeros}. Ok?`;
        const cor = confirmacaoDoLote.acao === "pronto" ? "#0F766E" : "#7C3AED";
        return (
          <div
            role="dialog"
            aria-modal="false"
            style={{
              position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 100001,
              width: "min(460px, calc(100vw - 24px))", background: "#FFFFFF", borderLeft: `4px solid ${cor}`,
              borderRadius: 12, padding: "14px 16px", boxShadow: "0 10px 30px rgba(15,23,42,.25)",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 14, color: "#0F172A", lineHeight: 1.4 }}>{pergunta}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button
                type="button"
                disabled={executandoLote}
                onClick={() => setConfirmacaoDoLote(null)}
                style={{
                  background: "#F1F5F9", color: "#334155", border: "1px solid #E2E8F0", borderRadius: 8,
                  padding: "7px 14px", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={executandoLote}
                onClick={executarLote}
                style={{
                  background: cor, color: "#FFFFFF", border: "none", borderRadius: 8,
                  padding: "7px 14px", fontWeight: 800, fontSize: "0.82rem", fontFamily: "inherit",
                  cursor: executandoLote ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                {executandoLote ? <><Loader2 size={13} className="animate-spin" /> Enviando...</> : "Sim, todos"}
              </button>
            </div>
          </div>
        );
      })()}
      <div style={{
        background: "#F8FAFC", width: "100%", maxWidth: modoIndependente ? "none" : "1400px", height: modoIndependente ? "100vh" : "92vh",
        borderRadius: modoIndependente ? 0 : "16px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
        display: "flex", flexDirection: "column", overflow: "hidden", border: modoIndependente ? "none" : "1px solid #CBD5E1"
      }}>

        {/* ─── HEADER BAR ─── */}
        <div style={{
          background: "#FFFFFF", padding: "0.85rem 1.5rem", borderBottom: "1px solid #E2E8F0",
          display: "flex", alignItems: "center", justifyContent: "space-between"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <div style={{ background: "#FAF6F2", color: "#1C1917", padding: "8px 12px", borderRadius: "10px", display: "flex", alignItems: "center", gap: 8, fontWeight: 800 }}>
              <MapPin size={20} />
              <span style={{ fontSize: "1.1rem" }}>Módulo de Roteirização</span>
            </div>
            <span style={{ fontSize: "0.85rem", color: "#64748B" }}>
              Monte rotas inteligentes por proximidade no mapa para seus motoboys
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {!modoIndependente && (
              <a
                href="/store/roteirizacao"
                target="_blank"
                rel="noopener"
                title="Abre a roteirização numa aba só dela, para ficar aberta a noite toda separada da aba de pedidos"
                style={{
                  padding: "8px 14px", background: "#F0FDFA", border: "1px solid #99F6E4",
                  borderRadius: "8px", fontSize: "0.85rem", fontWeight: 800, color: "#0F766E",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 6, textDecoration: "none"
                }}
              >
                <ExternalLink size={16} /> Abrir em aba separada
              </a>
            )}

            {/* Esta tela abre por cima da barra do topo, que é onde o botão Tutorial mora. */}
            <TutorialDaTela rota="/store/roteirizacao" tom="claro" />

            <button
              onClick={() => setShowConfigModal(true)}
              style={{
                padding: "8px 14px", background: "#FAF6F2", border: "1px solid #E7DDD3",
                borderRadius: "8px", fontSize: "0.85rem", fontWeight: 800, color: "#1C1917",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6
              }}
            >
              ⚙️ Configurações
            </button>

            <button
              onClick={onClose}
              style={{
                padding: "8px 12px", background: "#FEF2F2", border: "1px solid #FCA5A5",
                borderRadius: "8px", fontSize: "0.85rem", fontWeight: 800, color: "#C92E09",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 4
              }}
            >
              <X size={18} /> {modoIndependente ? "Fechar aba" : "Fechar"}
            </button>
          </div>
        </div>

        {/* ─── MAIN CONTENT CONTAINER (2-COLUMNS: SIDEBAR + MAP) ─── */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>

          {/* ─── LEFT SIDEBAR PANEL (390px) ─── */}
          <div style={{
            width: "390px", background: "#FFFFFF", borderRight: "1px solid #E2E8F0",
            display: "flex", flexDirection: "column", flexShrink: 0, zIndex: 10
          }}>

            {/* TAB SELECTOR HEADER */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "2px solid #E2E8F0" }}>
              <button
                onClick={() => setActiveTab("PENDING")}
                style={{
                  padding: "12px 16px", border: "none", background: activeTab === "PENDING" ? "#FFFFFF" : "#F8FAFC",
                  borderBottom: activeTab === "PENDING" ? "3px solid #1C1917" : "none",
                  fontWeight: 800, fontSize: "0.88rem", color: activeTab === "PENDING" ? "#1C1917" : "#64748B",
                  cursor: "pointer", transition: "all 0.2s"
                }}
              >
                {filteredPendingOrders.length} PEDIDOS PENDENTES
              </button>

              <button
                onClick={() => setActiveTab("ROTAS")}
                style={{
                  padding: "12px 16px", border: "none", background: activeTab === "ROTAS" ? "#FFFFFF" : "#F8FAFC",
                  borderBottom: activeTab === "ROTAS" ? "3px solid #1C1917" : "none",
                  fontWeight: 800, fontSize: "0.88rem", color: activeTab === "ROTAS" ? "#1C1917" : "#64748B",
                  cursor: "pointer", transition: "all 0.2s"
                }}
              >
                {createdRoutes.length} ROTAS
              </button>
            </div>

            {/* TAB 1: PEDIDOS PENDENTES */}
            {activeTab === "PENDING" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                
                {/* Search Bar & Smart Auto-Cluster */}
                <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid #F1F5F9", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  
                  {/* Seletor de Filtro: Mostrar Todos vs Mostrar Prontos */}
                  <div style={{ display: "flex", gap: "4px", background: "#F1F5F9", padding: "4px", borderRadius: "10px", border: "1px solid #E2E8F0" }}>
                    <button
                      type="button"
                      onClick={() => handleToggleOnlyPronto(false)}
                      style={{
                        flex: 1, padding: "6px 10px", borderRadius: "7px", border: "none",
                        background: !onlyProntoOrders ? "#FFFFFF" : "transparent",
                        color: !onlyProntoOrders ? "#0F172A" : "#64748B",
                        fontWeight: !onlyProntoOrders ? 900 : 700,
                        fontSize: "0.78rem", cursor: "pointer",
                        boxShadow: !onlyProntoOrders ? "0 2px 5px rgba(0,0,0,0.08)" : "none",
                        transition: "all 0.15s ease",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
                      }}
                    >
                      📋 Mostrar Todos ({allDeliveryOrdersCount})
                    </button>

                    <button
                      type="button"
                      onClick={() => handleToggleOnlyPronto(true)}
                      style={{
                        flex: 1, padding: "6px 10px", borderRadius: "7px", border: "none",
                        background: onlyProntoOrders ? "linear-gradient(135deg, #0F766E, #0F766E)" : "transparent",
                        color: onlyProntoOrders ? "#FFFFFF" : "#64748B",
                        fontWeight: onlyProntoOrders ? 900 : 700,
                        fontSize: "0.78rem", cursor: "pointer",
                        boxShadow: onlyProntoOrders ? "0 2px 6px rgba(15, 118, 110,0.3)" : "none",
                        transition: "all 0.15s ease",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
                      }}
                    >
                      🍳 Mostrar Prontos ({prontoOrdersCount})
                    </button>
                  </div>
                  <div style={{
                    display: "flex", alignItems: "center", background: "#F8FAFC",
                    border: "1px solid #CBD5E1", borderRadius: "8px", padding: "6px 10px"
                  }}>
                    <Search size={16} color="#94A3B8" />
                    <input
                      type="text"
                      placeholder="Buscar por número do pedido ou cliente"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{
                        border: "none", background: "transparent", outline: "none",
                        width: "100%", marginLeft: "8px", fontSize: "0.82rem", fontFamily: "inherit"
                      }}
                    />
                  </div>

                  {(routeMode === "Inteligente" || routeMode === "Automatizada") && (
                    <button
                      onClick={handleAutoClusterRoutes}
                      style={{
                        width: "100%", padding: "10px 14px",
                        background: "linear-gradient(135deg, #0F766E 0%, #0F766E 100%)",
                        border: "none",
                        borderRadius: "10px", fontSize: "0.85rem", fontWeight: 900, color: "#FFFFFF",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        boxShadow: "0 4px 12px rgba(15, 118, 110, 0.35)",
                        transition: "transform 0.1s ease"
                      }}
                      onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.98)")}
                      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
                    >
                      ⚡ 🤖 Auto-Agrupar Rota {routeMode} (Máx: {maxOrdersPerRoute} pedidos / {maxDistanceKm}km)
                    </button>
                  )}
                </div>

                {/* Orders List Scroll Area */}
                <div style={{ flex: 1, overflowY: "auto", padding: "0.75rem" }}>

                  {geocodingLoading && (
                    <div style={{ background: "#FAF6F2", color: "#1C1917", padding: "8px 12px", borderRadius: "8px", fontSize: "0.78rem", fontWeight: 600, marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: 6 }}>
                      <Loader2 size={14} className="animate-spin" /> Mapeando endereços no GPS...
                    </div>
                  )}

                  {filteredPendingOrders.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94A3B8" }}>
                      <CheckCircle2 size={40} style={{ margin: "0 auto 0.5rem", opacity: 0.5 }} />
                      <p style={{ fontWeight: 700, fontSize: "0.9rem" }}>Nenhum pedido pendente</p>
                      <p style={{ fontSize: "0.78rem" }}>Todos os pedidos já foram roteirizados ou entregues!</p>
                    </div>
                  ) : (
                    filteredPendingOrders.map((order) => {
                      const isSelected = selectedOrderIds.includes(order.id);
                      const isHovered = hoveredOrderId === order.id;
                      const seqIndex = selectedOrderIds.indexOf(order.id);
                      const displayNum = getOrderDisplayNumber(order);
                      const prontoNaCozinha = estaPronto(order);
                      const marcandoEste = marcandoPronto === order.id;
                      const priorizado = estaPriorizado(order);
                      const priorizandoEste = marcandoPrioridade === order.id;
                      const addrText = (order as any).customerAddress || order.address || `${order.street || ""} ${order.number || ""} ${order.neighborhood || ""}` || "Endereço a confirmar";

                      return (
                        <div
                          key={order.id}
                          onClick={() => toggleOrderSelection(order.id)}
                          onMouseEnter={() => setHoveredOrderId(order.id)}
                          onMouseLeave={() => setHoveredOrderId(null)}
                          style={{
                            border: isHovered ? "2px solid #1C1917" : isSelected ? "2px solid #1C1917" : "1px solid #E2E8F0",
                            background: isHovered ? "#FAF6F2" : isSelected ? "#F0F6FF" : "#FFFFFF",
                            boxShadow: isHovered ? "0 4px 14px rgba(28, 25, 23,0.25)" : "none",
                            transform: isHovered ? "translateX(4px)" : "none",
                            borderRadius: "10px", padding: "0.75rem 0.85rem", marginBottom: "0.6rem",
                            cursor: "pointer", transition: "all 0.15s ease", position: "relative"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>

                            {/* Sequence Badge / Checkbox */}
                            <div style={{
                              width: "30px", height: "30px", borderRadius: "50%",
                              background: isSelected ? "linear-gradient(135deg, #1C1917, #1C1917)" : "#F1F5F9",
                              color: isSelected ? "#FFFFFF" : "#64748B",
                              border: isSelected ? "none" : "1.5px solid #CBD5E1",
                              boxShadow: isSelected ? "0 3px 8px rgba(28, 25, 23,0.4)" : "none",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontWeight: 900, fontSize: "0.82rem", flexShrink: 0, marginTop: 2
                            }}>
                              {isSelected ? `#${seqIndex + 1}` : ""}
                            </div>

                            {/* Order Details */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                                <span style={{ fontWeight: 900, fontSize: "0.95rem", color: "#0F172A" }}>
                                  Pedido #{displayNum}
                                </span>
                                <span style={{
                                  background: "#F1F5F9", color: "#475569", fontSize: "0.7rem",
                                  fontWeight: 700, padding: "2px 6px", borderRadius: "4px"
                                }}>
                                  {order.platform || "Direto"}
                                </span>
                              </div>

                              {/* Bairro em Destaque & Endereço Completo sem cortes */}
                              {(() => {
                                const lido = parseAddressDetails(addrText);
                                const { fullAddress } = lido;
                                // Só o RÓTULO: a busca no mapa continua com o bairro lido do texto.
                                const neighborhood = (bairrosDaLoja?.length
                                  ? bairroPeloEndereco(addrText, bairrosDaLoja, { cidades: [storeCity] })?.name
                                  : null) || lido.neighborhood;
                                const isMapped = Boolean(geocodedMap[order.id]);
                                const motivoIncerto = !isMapped ? incertos[order.id] : undefined;
                                const local = infoDoPino[order.id];
                                return (
                                  <div style={{ margin: "3px 0 5px 0" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                                      {neighborhood ? (
                                        <span style={{
                                          background: "#FFF7E6", color: "#92400E", border: "1px solid #FDE68A",
                                          padding: "2px 7px", borderRadius: "5px", fontWeight: 800, fontSize: "0.78rem"
                                        }}>
                                          🏘️ Bairro: {neighborhood}
                                        </span>
                                      ) : null}

                                      {/* Sem localização confiável: o pedido NÃO está no
                                          mapa (nem no agrupamento). O botão posiciona. */}
                                      {motivoIncerto ? (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); iniciarPosicionamento(order.id); }}
                                          title={`Sem localização confiável: ${motivoIncerto}. Clique e marque no mapa onde fica.`}
                                          style={{
                                            background: "#FFF7ED", color: "#9A3412", border: "1px solid #FDBA74",
                                            padding: "2px 7px", borderRadius: "5px", fontWeight: 800, fontSize: "0.72rem",
                                            cursor: "pointer", fontFamily: "inherit",
                                          }}
                                        >
                                          ⚠️ Sem localização · 📍 Posicionar
                                        </button>
                                      ) : !isMapped ? (
                                        <span style={{
                                          background: "#FAF6F2", color: "#1C1917", border: "1px solid #E7DDD3",
                                          padding: "2px 7px", borderRadius: "5px", fontWeight: 700, fontSize: "0.72rem"
                                        }}>
                                          📍 Localizando GPS...
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); iniciarPosicionamento(order.id); }}
                                          title={`Local: ${local ? NOME_DA_FONTE[local.fonte] : "mapa"}. Clique para corrigir no mapa.`}
                                          style={{
                                            background: local?.aproximado ? "#FFFBEB" : "#F8FAFC",
                                            color: local?.aproximado ? "#B45309" : "#64748B",
                                            border: `1px solid ${local?.aproximado ? "#FDE68A" : "#E2E8F0"}`,
                                            padding: "2px 7px", borderRadius: "5px", fontWeight: 700, fontSize: "0.7rem",
                                            cursor: "pointer", fontFamily: "inherit",
                                          }}
                                        >
                                          {local?.aproximado ? "≈ centro do bairro · corrigir" : "📍 Corrigir local"}
                                        </button>
                                      )}

                                      {/* Rota automática ligada: este a loja monta à mão (D3).
                                          Posicionar no mapa grava o ponto e ele entra no ciclo seguinte. */}
                                      {semPontoParaRotaAuto(order) && (
                                        <span
                                          title="A Rota 100% automatizada só junta pedido com localização confiável no mapa. Posicione o pedido ou monte esta rota à mão."
                                          style={{
                                            background: "#F5F3FF", color: "#5B21B6", border: "1px solid #DDD6FE",
                                            padding: "2px 7px", borderRadius: "5px", fontWeight: 800, fontSize: "0.72rem",
                                          }}
                                        >
                                          📍 sem localização — rota manual
                                        </span>
                                      )}

                                      {/* A loja tirou este de uma rota automática: o cron não o
                                          junta de novo. "voltar" devolve ele ao agrupamento. */}
                                      {rotaAutoLigada && estaForaDaAutomatica(order.id) && (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.stopPropagation(); voltarParaAutomatica(order.id); }}
                                          title="A loja tirou este pedido de uma rota automática, e a Rota 100% automatizada não o junta mais. Clique para ele voltar a ser agrupado."
                                          style={{
                                            background: "#F5F3FF", color: "#5B21B6", border: "1px solid #DDD6FE",
                                            padding: "2px 7px", borderRadius: "5px", fontWeight: 800, fontSize: "0.72rem",
                                            cursor: "pointer", fontFamily: "inherit",
                                          }}
                                        >
                                          ✋ fora da automática · voltar
                                        </button>
                                      )}
                                    </div>

                                    <p style={{ fontWeight: 700, fontSize: "0.82rem", color: "#1E293B", margin: 0, lineHeight: 1.35, wordBreak: "break-word" }}>
                                      📍 {fullAddress}
                                    </p>
                                  </div>
                                );
                              })()}

                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.76rem", color: "#64748B" }}>
                                <span>👤 {order.customerName}</span>
                                <span>{order.itemsCount || order.items?.length || 1} itens</span>
                              </div>

                              {/* ── O PRONTO MORA AQUI, AO LADO DO PEDIDO ────────────────
                                  O clique no card monta rota; este botão não pode herdar
                                  isso, senão dar pronto selecionava o pedido junto. Já
                                  pronto vira selo — a mesma cor roxa do pino no mapa, para
                                  a lista e o mapa contarem a mesma história. */}
                              <div style={{ marginTop: 7, display: "flex", flexWrap: "wrap", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                                {prontoNaCozinha ? (
                                  <span style={{
                                    display: "inline-flex", alignItems: "center", gap: 5,
                                    background: "#F8FAFC", color: "#334155", border: "1px solid #E2E8F0",
                                    padding: "3px 9px", borderRadius: "6px", fontWeight: 800, fontSize: "0.74rem"
                                  }}>
                                    <CheckCircle2 size={13} /> Pronto na cozinha
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={marcandoEste}
                                    onClick={() => marcarPedidoPronto(order)}
                                    title="Marca o pedido como pronto na cozinha e avisa o cliente e o marketplace — o mesmo botão do painel de pedidos"
                                    style={{
                                      display: "inline-flex", alignItems: "center", gap: 6,
                                      background: marcandoEste ? "#99F6E4" : "linear-gradient(135deg, #0F766E, #0F766E)",
                                      color: "#FFFFFF", border: "none", borderRadius: "7px",
                                      padding: "5px 11px", fontWeight: 800, fontSize: "0.76rem",
                                      fontFamily: "inherit",
                                      cursor: marcandoEste ? "wait" : "pointer",
                                      boxShadow: marcandoEste ? "none" : "0 2px 6px rgba(15, 118, 110,0.30)",
                                      transition: "all 0.15s ease"
                                    }}
                                  >
                                    {marcandoEste ? (
                                      <><Loader2 size={13} className="animate-spin" /> Marcando...</>
                                    ) : (
                                      <><Check size={13} /> Dar como pronto</>
                                    )}
                                  </button>
                                )}
                                {/* Prioridade só faz sentido enquanto o pedido está na
                                    cozinha: pronto, o botão some. Roxo como a faixa que
                                    o KDS mostra (kds/tela, "PRIORIDADE · pedida pela loja"). */}
                                {!prontoNaCozinha && (
                                  <button
                                    type="button"
                                    disabled={priorizandoEste}
                                    onClick={() => pedirPrioridade(order, !priorizado)}
                                    title={priorizado
                                      ? "Tira o pedido da frente da fila da cozinha (KDS)"
                                      : "Manda o pedido para a frente da fila da cozinha (KDS), com a faixa roxa"}
                                    style={{
                                      display: "inline-flex", alignItems: "center", gap: 6,
                                      background: priorizado ? "#F5F3FF" : "linear-gradient(135deg, #7C3AED, #5B21B6)",
                                      color: priorizado ? "#5B21B6" : "#FFFFFF",
                                      border: priorizado ? "1px solid #C4B5FD" : "none", borderRadius: "7px",
                                      padding: "5px 11px", fontWeight: 800, fontSize: "0.76rem",
                                      fontFamily: "inherit",
                                      cursor: priorizandoEste ? "wait" : "pointer",
                                      opacity: priorizandoEste ? 0.7 : 1,
                                      boxShadow: priorizado || priorizandoEste ? "none" : "0 2px 6px rgba(124, 58, 237,0.30)",
                                      transition: "all 0.15s ease"
                                    }}
                                  >
                                    {priorizandoEste ? (
                                      <><Loader2 size={13} className="animate-spin" /> Salvando...</>
                                    ) : priorizado ? (
                                      <>⏫ Prioridade pedida · desfazer</>
                                    ) : (
                                      <>⏫ Pedir prioridade no KDS</>
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>

                          </div>
                        </div>
                      );
                    })
                  )}

                </div>

                {/* Saipos Plan Footer Info Banner */}
                <div style={{ padding: "0.75rem 1rem", borderTop: "1px solid #E2E8F0", background: "#F8FAFC" }}>
                  <div style={{ fontSize: "0.75rem", color: "#64748B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>ROTEIRIZAÇÃO FIREHUB</span>
                    <span style={{ fontWeight: 800, color: "#0F766E" }}>ILIMITADO</span>
                  </div>
                </div>

              </div>
            )}

            {/* TAB 2: ROTAS CRIADAS */}
            {activeTab === "ROTAS" && (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", padding: "0.75rem" }}>
                {createdRoutes.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94A3B8" }}>
                    <Navigation size={40} style={{ margin: "0 auto 0.5rem", opacity: 0.5 }} />
                    <p style={{ fontWeight: 700, fontSize: "0.9rem" }}>Nenhuma rota despachada ainda</p>
                    <p style={{ fontSize: "0.78rem" }}>Selecione os pedidos pendentes no mapa e clique em Criar Rota!</p>
                  </div>
                ) : (
                  <>
                  {/* O que a linha no mapa quer dizer, escrito: "pra que serve
                      a rota da roteirização? deixa a gente perdido" (Lucas,
                      12/10/2026). */}
                  <p style={{ margin: "0 0 0.6rem 0", fontSize: "0.74rem", color: "#64748B", lineHeight: 1.4 }}>
                    No mapa, só as rotas esperando motoboy ganham linha. Para olhar uma que já saiu, toque em <b>🗺️ Ver no mapa</b>.
                  </p>
                  {createdRoutes.map(route => {
                    const isDispatched = rotaJaDespachada(route);
                    const emFoco = rotaEmFoco === route.id;
                    return (
                      <div
                        key={route.id}
                        style={{
                          border: isDispatched ? "1.5px solid #99F6E4" : "1.5px solid #FFD3C2",
                          background: isDispatched ? "#F0FDFA" : "#FFF7E6",
                          borderRadius: "12px", padding: "0.85rem", marginBottom: "0.75rem",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.03)"
                        }}
                      >
                        {/* flex-wrap nas duas linhas: com "🤖 Automática" e "Ver no
                            mapa" ao lado, o selo "⏳ Aguardando Despacho" estourava
                            o card à direita na largura da lista. Agora desce. */}
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 6, marginBottom: "0.5rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                            {/* Route Color Marker */}
                            <div style={{
                              width: "16px", height: "16px", borderRadius: "50%",
                              background: route.color, border: "2px solid #fff",
                              boxShadow: "0 0 0 1px #CBD5E1"
                            }} />
                            <span style={{ fontWeight: 900, fontSize: "1rem", color: "#0F172A" }}>
                              {route.routeNumber}
                            </span>
                            {/* Criada pelo servidor (Rota 100% automatizada), não pela loja. */}
                            {route.origem === "AUTO" && (
                              <span
                                title="Rota criada pela Rota 100% automatizada. Dá para desfazer ou despachar à mão como qualquer rota."
                                style={{
                                  padding: "2px 7px", borderRadius: "6px", background: "#F5F3FF", color: "#5B21B6",
                                  border: "1px solid #DDD6FE", fontSize: "0.7rem", fontWeight: 900, whiteSpace: "nowrap",
                                }}
                              >
                                🤖 Automática
                              </span>
                            )}
                            {/* Ver a rota é escolha de quem olha, não o padrão da tela. */}
                            <button
                              type="button"
                              onClick={() => alternarFocoDaRota(route)}
                              title={emFoco ? "Tirar a linha desta rota do mapa" : "Mostrar a linha desta rota no mapa"}
                              style={{
                                padding: "3px 8px", borderRadius: "6px", fontFamily: "inherit",
                                border: emFoco ? "1.5px solid #1C1917" : "1px solid #CBD5E1",
                                background: emFoco ? "#1C1917" : "#FFFFFF", color: emFoco ? "#FFFFFF" : "#334155",
                                fontSize: "0.72rem", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap",
                              }}
                            >
                              🗺️ {emFoco ? "Esconder do mapa" : "Ver no mapa"}
                            </button>
                          </div>

                          <span style={{
                            fontSize: "0.74rem",
                            color: isDispatched ? "#0F766E" : "#B45309",
                            fontWeight: 900,
                            background: isDispatched ? "#F0FDFA" : "#FFF7E6",
                            padding: "3px 8px",
                            borderRadius: "6px",
                            border: isDispatched ? "1px solid #99F6E4" : "1px solid #FDE68A",
                          }}>
                            {route.status || (isDispatched ? "🚀 Despachada" : "⏳ Aguardando Despacho")}
                          </span>
                        </div>

                        <div style={{ fontSize: "0.8rem", color: "#475569", marginBottom: "0.75rem" }}>
                          <p style={{ margin: "0 0 4px 0", fontWeight: 700 }}>📦 {route.orders.length} {route.orders.length > 1 ? "Pedidos" : "Pedido"}: {route.orders.map(o => getOrderDisplayNumber(o)).join(", ")}</p>
                          {estadoDaRotaAutomatica(route, nomeDoMotoboy) && (
                            <p style={{ margin: "0 0 4px 0", fontWeight: 800, color: "#5B21B6" }}>🤖 {estadoDaRotaAutomatica(route, nomeDoMotoboy)}</p>
                          )}

                          {/* Rota automática já chamada: a loja chama de novo ou troca
                              quem é chamado — sem dar o pedido a ninguém (o dono é quem
                              escaneia o QR). Despachar à mão segue no select abaixo. */}
                          {!isDispatched && route.origem === "AUTO" && route.chamadaEm && (
                            <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "6px 0 8px 0", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                disabled={isDispatching}
                                onClick={() => chamarEntregadorDaRota(route, route.chamadaMotoboyId || null, true)}
                                style={{
                                  padding: "6px 10px", borderRadius: "6px", border: "1.5px solid #DDD6FE", background: "#F5F3FF",
                                  color: "#5B21B6", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit",
                                }}
                              >
                                🔔 Chamar de novo
                              </button>
                              <select
                                value=""
                                disabled={isDispatching}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (!val) return;
                                  chamarEntregadorDaRota(route, val === "__todos__" ? null : val, false);
                                }}
                                title="Chama outro entregador para esta rota (ele recebe o aviso no app)."
                                style={{
                                  flex: 1, minWidth: 150, padding: "6px 8px", borderRadius: "6px", border: "1.5px solid #DDD6FE",
                                  fontSize: "0.76rem", fontWeight: 700, background: "#FFFFFF", color: "#5B21B6", fontFamily: "inherit",
                                }}
                              >
                                <option value="">Trocar entregador…</option>
                                {route.chamadaMotoboyId && <option value="__todos__">Todos os entregadores (quem chegar primeiro)</option>}
                                {motoboys
                                  .filter((m) => (m as any).active !== false && m.id !== route.chamadaMotoboyId)
                                  .map((m) => (
                                    <option key={m.id} value={m.id}>🛵 {m.name}</option>
                                  ))}
                              </select>
                            </div>
                          )}
                          <p style={{ margin: "0 0 8px 0" }}>🛵 Entregador: <b>{route.motoboyName || "ainda não escolhido"}</b></p>

                          {/* ── TROCAR O ENTREGADOR DE UMA ROTA JÁ DESPACHADA ──
                              O plano muda depois do despacho: o entregador furou,
                              passou mal, o pneu estourou. Sem isto, a rota ficava
                              travada no nome dele — e os pedidos junto. */}
                          {isDispatched && (
                            <div style={{ marginTop: "6px", marginBottom: "8px" }}>
                              <label style={{ display: "block", fontSize: "0.68rem", fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>
                                Trocar entregador
                              </label>
                              <select
                                value={route.motoboyId || ""}
                                disabled={isDispatching}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val && val !== route.motoboyId) trocarEntregadorDaRota(route.id, val);
                                }}
                                style={{
                                  width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1.5px solid #CBD5E1",
                                  fontSize: "0.8rem", fontWeight: 700, background: "#FFFFFF", fontFamily: "inherit",
                                }}
                              >
                                <option value="">-- Sem entregador --</option>
                                {motoboys.map(m => (
                                  <option key={m.id} value={m.id}>🛵 {m.name} {m.phone ? `(${m.phone})` : ""}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* Se ainda não foi despachada, permite selecionar motoboy na hora */}
                          {!isDispatched && (
                            <div style={{ marginTop: "6px", marginBottom: "8px" }}>
                              <select
                                defaultValue={route.motoboyId || ""}
                                disabled={isDispatching}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val) {
                                    handleDispatchExistingRoute(route.id, val);
                                  }
                                }}
                                style={{
                                  width: "100%", padding: "6px 8px", borderRadius: "6px", border: "1.5px solid #CBD5E1",
                                  fontSize: "0.8rem", fontWeight: 700, background: "#FFFFFF"
                                }}
                              >
                                <option value="">-- Selecione o Motoboy para Despachar --</option>
                                {motoboys.map(m => (
                                  <option key={m.id} value={m.id}>🛵 {m.name} {m.phone ? `(${m.phone})` : ""}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>

                        {/* Os botões do card: em cima Editar, COPIAR e a lixeira (cabendo
                            na coluna de ~280 px — a lixeira saía para fora da caixa com
                            os quatro numa linha só); embaixo o Despachar, na largura toda
                            (Douglas, 22/10/2026: "o despacho pode ficar na parte de
                            baixo, mais compridinho, fica até mais bonito"). */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        <div style={{ display: "flex", alignItems: "stretch", gap: "0.5rem", minWidth: 0 }}>
                          {/* Tirar ou incluir pedido: só antes de despachar (depois
                              dela sair, a rota é o histórico do acerto). */}
                          {!isDispatched && (
                            <button
                              type="button"
                              onClick={() => setRotaEmEdicao({ routeId: route.id, ids: route.orders.map((o) => o.id) })}
                              title="Tirar ou incluir pedido nesta rota"
                              style={{
                                flex: 1, minWidth: 0, padding: "8px 6px", border: "1.5px solid #1C1917",
                                borderRadius: "8px", background: "#FFFFFF", color: "#1C1917",
                                fontWeight: 800, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 4, boxSizing: "border-box"
                              }}
                            >
                              ✏️ Editar
                            </button>
                          )}

                          <button
                            onClick={() => handleCopyRouteText(route)}
                            style={{
                              flex: 1, minWidth: 0, padding: "8px 6px", border: "1.5px solid #1C1917",
                              borderRadius: "8px", background: copiedRouteId === route.id ? "#F0FDFA" : "#FFFFFF",
                              color: copiedRouteId === route.id ? "#0F766E" : "#1C1917",
                              fontWeight: 800, fontSize: "0.78rem", cursor: "pointer", whiteSpace: "nowrap",
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 4, boxSizing: "border-box"
                            }}
                          >
                            {copiedRouteId === route.id ? <Check size={14} /> : <Copy size={14} />}
                            {copiedRouteId === route.id ? "COPIADO!" : "COPIAR"}
                          </button>

                          <button
                            onClick={() => handleDeleteRoute(route.id)}
                            style={{
                              flex: "0 0 auto", padding: "8px 10px", border: "1px solid #CBD5E1",
                              borderRadius: "8px", background: "#F8FAFC", color: "#64748B",
                              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box"
                            }}
                            title="Desfazer/Excluir rota"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                          {!isDispatched && (
                            <button
                              onClick={() => {
                                const mbId = route.motoboyId || selectedMotoboyId;
                                if (!mbId) {
                                  setAviso({ tipo: "atencao", titulo: "Escolha o motoboy para despachar a rota" });
                                  return;
                                }
                                handleDispatchExistingRoute(route.id, mbId);
                              }}
                              disabled={isDispatching}
                              style={{
                                width: "100%", padding: "10px 8px", border: "none",
                                borderRadius: "8px", background: "linear-gradient(135deg, #0F766E, #0F766E)",
                                color: "#FFFFFF", fontWeight: 900, fontSize: "0.86rem", cursor: "pointer",
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                                boxShadow: "0 2px 8px rgba(15, 118, 110,0.3)", boxSizing: "border-box"
                              }}
                            >
                              <Navigation size={14} /> 🚀 Despachar Rota
                            </button>
                          )}
                        </div>

                      </div>
                    );
                  })}
                  </>
                )}
              </div>
            )}

          </div>

          {/* ─── RIGHT MAP PANEL (FULL FLEX) ─── */}
          <div style={{ flex: 1, height: "100%", position: "relative" }}>
            <div ref={mapRef} style={{ width: "100%", height: "100%", zIndex: 1 }} />

            {/* FLOATING MAP CONTROLS (TOP RIGHT) */}
            <div style={{
              position: "absolute", top: "16px", right: "16px", zIndex: 999,
              display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px"
            }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={handleFitAllBounds}
                  style={{
                    background: "#FFFFFF", color: "#0F172A", border: "1.5px solid #CBD5E1",
                    borderRadius: "8px", padding: "8px 12px", fontSize: "0.82rem", fontWeight: 800,
                    cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                    display: "flex", alignItems: "center", gap: "6px"
                  }}
                  title="Centralizar visão em todos os pinos de entrega"
                >
                  <Navigation size={15} style={{ transform: "rotate(45deg)", color: "#1C1917" }} />
                  Centralizar Visão
                </button>

                {/* Filtro de motoboys — nasce MARCADO. Com muitos entregadores o
                    mapa fica poluído na hora de montar rota, então quem quiser
                    ver só os pinos de entrega desmarca aqui. */}
                <label
                  title="Mostrar ou esconder os entregadores no mapa"
                  style={{
                    background: "#FFFFFF", color: "#0F172A", border: "1.5px solid #CBD5E1",
                    borderRadius: "8px", padding: "8px 12px", fontSize: "0.82rem", fontWeight: 800,
                    cursor: "pointer", boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                    display: "flex", alignItems: "center", gap: "6px", userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={mostrarMotoboys}
                    onChange={(e) => setMostrarMotoboys(e.target.checked)}
                    style={{ width: 15, height: 15, accentColor: "#1C1917", cursor: "pointer" }}
                  />
                  ⛑️ Motoboys
                </label>
              </div>

              {/* ── AMPLIAR / DIMINUIR ──────────────────────────────────────
                  O controle nativo do Leaflet nasce miúdo no canto esquerdo e
                  some atrás do painel de rotas. Estes ficam do tamanho dos
                  outros botões, no mesmo canto onde a loja já olha. */}
              <div style={{
                display: "flex", flexDirection: "column", background: "#FFFFFF",
                border: "1.5px solid #CBD5E1", borderRadius: "10px", overflow: "hidden",
                boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              }}>
                <button
                  type="button"
                  onClick={aproximarMapa}
                  title="Ampliar o mapa (aproximar)"
                  aria-label="Ampliar o mapa"
                  style={{
                    width: "42px", height: "40px", border: "none", borderBottom: "1px solid #E2E8F0",
                    background: "#FFFFFF", color: "#0F172A", fontSize: "1.35rem", fontWeight: 800,
                    lineHeight: 1, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={afastarMapa}
                  title="Diminuir o mapa (afastar)"
                  aria-label="Diminuir o mapa"
                  style={{
                    width: "42px", height: "40px", border: "none",
                    background: "#FFFFFF", color: "#0F172A", fontSize: "1.35rem", fontWeight: 800,
                    lineHeight: 1, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  −
                </button>
              </div>
            </div>

            {/* ── A LOJA NÃO TEM ENDEREÇO NO CADASTRO ─────────────────────
                O mapa só cai aqui quando não há NADA de onde tirar o ponto:
                nem pino salvo, nem endereço. Antes disso ele abria em Rio das
                Ostras, calado, e a loja achava que o mapa é assim mesmo. */}
            {!temPontoDaLoja && (
              <div style={{
                position: "absolute", top: "16px", left: "16px", zIndex: 999, maxWidth: "340px",
                background: "#FFF7E6", border: "1.5px solid #B45309", borderRadius: "10px",
                padding: "10px 12px", boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
                fontSize: "0.8rem", color: "#92400E", fontWeight: 600, lineHeight: 1.45,
              }}>
                <strong style={{ display: "block", fontWeight: 800, marginBottom: "3px" }}>
                  📍 Falta dizer onde fica sua loja
                </strong>
                O mapa não tem de onde partir e as entregas não aparecem. Abra{" "}
                <a
                  href="/store/minha-loja"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#B45309", fontWeight: 800, textDecoration: "underline" }}
                >
                  Minha loja → Área de entrega
                </a>
                , arraste o pino até a sua porta e salve.
              </div>
            )}

            {/* ── PEDIDOS SEM LOCALIZAÇÃO CONFIÁVEL ─────────────────────────
                O mapa não achou um ponto DENTRO da área da loja (CEP que os
                Correios não conhecem, endereço de quadra e conjunto, bairro de
                outro lugar). Antes o pino ia assim mesmo para onde o mapa
                achava — o #30 da NIK, de Sobradinho, na Asa Sul. Agora ele fica
                fora do mapa e do agrupamento, aqui, até alguém posicionar. */}
            {(() => {
              const semLocal = deliveryOrders.filter((o) => incertos[o.id] && !geocodedMap[o.id]);
              if (semLocal.length === 0 || posicionando) return null;
              return (
                <div style={{
                  // Abaixo da linha de botões do canto direito ("Centralizar
                  // Visão", "Motoboys"), que em tela estreita encostaria nela.
                  position: "absolute", top: temPontoDaLoja ? "64px" : "150px", left: "16px", zIndex: 999,
                  width: "min(320px, calc(100% - 90px))", maxHeight: "45%", overflowY: "auto",
                  background: "#FFF7ED", border: "1.5px solid #F59E0B", borderRadius: "10px",
                  padding: "10px 12px", boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <strong style={{ fontSize: "0.84rem", fontWeight: 800, color: "#9A3412" }}>
                      ⚠️ {semLocal.length} {semLocal.length > 1 ? "pedidos" : "pedido"} sem localização
                    </strong>
                    <button
                      type="button"
                      onClick={() => setIncertosRecolhidos((v) => !v)}
                      style={{ background: "transparent", border: "none", color: "#9A3412", fontWeight: 800, fontSize: "0.75rem", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      {incertosRecolhidos ? "mostrar" : "recolher"}
                    </button>
                  </div>
                  {!incertosRecolhidos && (
                    <>
                      <p style={{ margin: "3px 0 6px 0", fontSize: "0.74rem", color: "#9A3412", lineHeight: 1.4 }}>
                        O mapa não achou o endereço dentro da sua área, então o pedido não aparece no mapa nem no agrupamento.
                        Posicione uma vez: o próximo pedido do mesmo endereço já vem no lugar certo.
                      </p>
                      {semLocal.map((o) => (
                        <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #FED7AA" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 800, fontSize: "0.8rem", color: "#0F172A" }}>
                              #{getOrderDisplayNumber(o)} · {o.customerName || "Cliente"}
                            </div>
                            <div
                              title={textoDoEndereco(o)}
                              style={{ fontSize: "0.74rem", color: "#7C2D12", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                            >
                              {textoDoEndereco(o) || "sem endereço"}
                            </div>
                            <div style={{ fontSize: "0.7rem", color: "#A16207" }}>{incertos[o.id]}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => iniciarPosicionamento(o.id)}
                            style={{
                              flexShrink: 0, background: "#EA580C", color: "#FFFFFF", border: "none", borderRadius: "7px",
                              padding: "6px 10px", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit",
                            }}
                          >
                            📍 Posicionar
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              );
            })()}

            {/* ── POSICIONANDO UM PEDIDO ───────────────────────────────────── */}
            {posicionando && (() => {
              const pedido: any = deliveryOrders.find((o) => o.id === posicionando) || orders.find((o) => o.id === posicionando);
              return (
                <div style={{
                  // No canto esquerdo (a lista de incertos some neste modo): o
                  // + e − e "Centralizar Visão" ficam livres para achar a casa.
                  position: "absolute", top: "16px", left: "16px", zIndex: 1000,
                  width: "min(380px, calc(100% - 340px))", minWidth: "240px", background: "#1E293B", color: "#FFFFFF",
                  borderRadius: "12px", padding: "10px 14px", boxShadow: "0 10px 25px rgba(0,0,0,0.35)",
                }}>
                  <div style={{ fontWeight: 900, fontSize: "0.9rem" }}>
                    📍 Posicionando o pedido #{pedido ? getOrderDisplayNumber(pedido) : "?"}
                  </div>
                  {pedido && (
                    <div style={{ fontSize: "0.78rem", color: "#CBD5E1", marginTop: 2, wordBreak: "break-word" }}>{textoDoEndereco(pedido)}</div>
                  )}
                  <div style={{ fontSize: "0.78rem", marginTop: 6, color: "#E2E8F0" }}>
                    {pontoProvisorio
                      ? "Arraste o 📍 até a porta do cliente, se precisar, e salve. Esc cancela."
                      : "Clique no mapa onde fica a casa do cliente. Esc cancela."}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      disabled={!pontoProvisorio || salvandoPonto}
                      onClick={salvarPosicao}
                      style={{
                        background: !pontoProvisorio || salvandoPonto ? "#475569" : "#EA580C", color: "#FFFFFF", border: "none",
                        borderRadius: "8px", padding: "7px 14px", fontWeight: 800, fontSize: "0.82rem", fontFamily: "inherit",
                        cursor: !pontoProvisorio || salvandoPonto ? "default" : "pointer",
                      }}
                    >
                      {salvandoPonto ? "Salvando..." : "Salvar este ponto"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelarPosicionamento}
                      style={{
                        background: "transparent", color: "#CBD5E1", border: "1px solid #475569", borderRadius: "8px",
                        padding: "7px 12px", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* ─── LEGENDA DAS CORES, QUE TAMBÉM FILTRA ────────────────────
                O significado das cores foi ditado pelo lojista e até agora só
                existia na cabeça de quem ouviu. Aqui ele fica escrito, com a
                contagem de cada estado — e cada linha liga e desliga aquele
                grupo no mapa, para a tela não virar um amontoado de pinos em
                noite cheia. A escolha fica salva neste navegador. */}
            <div style={{
              position: "absolute", bottom: "16px", left: "16px", zIndex: 999,
              background: "#FFFFFF", border: "1.5px solid #CBD5E1", borderRadius: "10px",
              padding: "9px 11px", boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
              display: "flex", flexDirection: "column", gap: "5px", minWidth: "172px",
            }}>
              <div style={{ fontSize: "0.68rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "1px" }}>
                O que aparece no mapa
              </div>
              {([
                { chave: "cozinha" as const, cor: COR_DO_ESTADO.cozinha, rotulo: "Na cozinha" },
                { chave: "pronto" as const, cor: COR_DO_ESTADO.pronto, rotulo: "Pronto" },
                { chave: "rota" as const, cor: COR_DO_ESTADO.rota, rotulo: "Saiu para entrega" },
                { chave: "entregue" as const, cor: COR_DO_ESTADO.entregue, rotulo: "Entregue agora" },
              ]).map((e) => {
                const quantos = deliveryOrders.filter((o: any) => {
                  const pronto = estaPronto(o);
                  const estado = o.__recemEntregue ? "entregue" : o.__jaDespachado ? "rota" : pronto ? "pronto" : "cozinha";
                  return estado === e.chave;
                }).length;
                const ligado = estadosNoMapa[e.chave];
                return (
                  <label
                    key={e.chave}
                    title={ligado ? `Esconder os pedidos em "${e.rotulo}"` : `Mostrar os pedidos em "${e.rotulo}"`}
                    style={{
                      display: "flex", alignItems: "center", gap: "7px", cursor: "pointer",
                      fontSize: "0.78rem", fontWeight: 700, userSelect: "none",
                      color: ligado ? "#0F172A" : "#94A3B8",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={ligado}
                      onChange={(ev) => {
                        const novo = { ...estadosNoMapa, [e.chave]: ev.target.checked };
                        setEstadosNoMapa(novo);
                        try {
                          const salvo = localStorage.getItem("firehub_roteirizacao_config");
                          const cfg = salvo ? JSON.parse(salvo) : {};
                          cfg.estadosNoMapa = novo;
                          localStorage.setItem("firehub_roteirizacao_config", JSON.stringify(cfg));
                        } catch {}
                      }}
                      style={{ width: 14, height: 14, accentColor: e.cor, cursor: "pointer", flexShrink: 0 }}
                    />
                    <span style={{
                      width: 13, height: 13, borderRadius: "50% 50% 50% 0",
                      transform: "rotate(-45deg)", background: e.cor, flexShrink: 0,
                      border: "1.5px solid #FFFFFF", boxShadow: "0 0 0 1px #CBD5E1",
                      opacity: ligado ? 1 : 0.35,
                    }} />
                    <span style={{ flex: 1 }}>{e.rotulo}</span>
                    <span style={{ color: "#64748B", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{quantos}</span>
                  </label>
                );
              })}
            </div>

            {/* ─── FLOATING ROUTE SELECTION ACTION BAR (OVER MAP BOTTOM) ─── */}
            {selectedOrderIds.length > 0 && (
              <div style={{
                position: "absolute", bottom: "24px", left: "50%", transform: "translateX(-50%)",
                zIndex: 999, background: "#1E293B", color: "#FFFFFF", padding: "0.75rem 1.25rem",
                borderRadius: "30px", boxShadow: "0 10px 25px rgba(0,0,0,0.35)",
                display: "flex", alignItems: "center", gap: "1rem"
              }}>
                <span style={{ fontWeight: 800, fontSize: "0.9rem" }}>
                  {selectedOrderIds.length} selecionado(s)
                </span>

                <button
                  onClick={() => setSelectedOrderIds([])}
                  style={{
                    background: "transparent", border: "none", color: "#94A3B8",
                    fontWeight: 700, fontSize: "0.85rem", cursor: "pointer"
                  }}
                >
                  Cancelar
                </button>

                {selectedOrderIds.length > 1 && (
                  <button
                    type="button"
                    onClick={handleOptimizeSelectedRoute}
                    style={{
                      background: "linear-gradient(135deg, #0F766E, #0F766E)", color: "#FFFFFF", border: "none",
                      padding: "8px 14px", borderRadius: "20px", fontWeight: 800,
                      fontSize: "0.82rem", cursor: "pointer", display: "flex",
                      alignItems: "center", gap: 6, boxShadow: "0 4px 12px rgba(15, 118, 110,0.3)"
                    }}
                    title="Reordenar sequência pela menor distância a partir da loja sem idas e voltas"
                  >
                    ⚡ Otimizar Trajeto
                  </button>
                )}

                {/* Lote pela seleção: o número é de quem AINDA falta — pronto
                    não é dado de novo (o parceiro receberia dois "pronto"), e
                    prioritário ou já pronto não entra na prioridade. Zero, o
                    botão some. */}
                {(() => {
                  const selecionados = selectedOrderIds
                    .map((id) => deliveryOrders.find((o) => o.id === id))
                    .filter(Boolean) as any[];
                  const paraPronto = selecionados.filter((o) => !estaPronto(o)).map((o) => o.id);
                  const paraPrioridade = selecionados.filter((o) => !estaPronto(o) && !estaPriorizado(o)).map((o) => o.id);
                  const estilo = (fundo: string, sombra: string) => ({
                    background: fundo, color: "#FFFFFF", border: "none",
                    padding: "8px 14px", borderRadius: "20px", fontWeight: 800,
                    fontSize: "0.82rem", cursor: executandoLote ? "wait" : "pointer", display: "flex",
                    alignItems: "center", gap: 6, boxShadow: `0 4px 12px ${sombra}`,
                    opacity: executandoLote ? 0.7 : 1,
                  });
                  return (
                    <>
                      {paraPronto.length > 0 && (
                        <button
                          type="button"
                          disabled={executandoLote}
                          onClick={() => setConfirmacaoDoLote({ acao: "pronto", ids: paraPronto })}
                          style={estilo("linear-gradient(135deg, #0F766E, #0F766E)", "rgba(15, 118, 110,0.3)")}
                          title="Dá como prontos na cozinha os pedidos selecionados que ainda não estão — o mesmo pronto do botão de cada pedido"
                        >
                          ✓ Dar pronto ({paraPronto.length})
                        </button>
                      )}
                      {paraPrioridade.length > 0 && (
                        <button
                          type="button"
                          disabled={executandoLote}
                          onClick={() => setConfirmacaoDoLote({ acao: "prioridade", ids: paraPrioridade })}
                          style={estilo("linear-gradient(135deg, #7C3AED, #5B21B6)", "rgba(124, 58, 237,0.3)")}
                          title="Manda para a frente da fila da cozinha (KDS) os pedidos selecionados que ainda estão na cozinha"
                        >
                          ⏫ Pedir prioridade ({paraPrioridade.length})
                        </button>
                      )}
                    </>
                  );
                })()}

                <button
                  onClick={handleOpenDispatch}
                  style={{
                    background: "#1C1917", color: "#FFFFFF", border: "none",
                    padding: "8px 18px", borderRadius: "20px", fontWeight: 800,
                    fontSize: "0.88rem", cursor: "pointer", display: "flex",
                    alignItems: "center", gap: 6, boxShadow: "0 4px 12px rgba(28, 25, 23,0.4)"
                  }}
                >
                  <Navigation size={16} /> Criar rota
                </button>
              </div>
            )}

          </div>

        </div>

      </div>

      {/* ─── DISPATCH MODAL (DESPACHAR COM MOTOBOY) ─── */}
      {showDispatchModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem"
        }}>
          {/* Mesma trava de altura do modal de configuração: a lista de motoboys
              cresce com a equipe, e numa loja com muitos entregadores o fim do
              modal — onde ficam os botões — sairia da tela. */}
          <div style={{
            background: "#FFFFFF", borderRadius: "14px", width: "100%", maxWidth: "480px",
            padding: "1.5rem", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)",
            maxHeight: "90vh", overflowY: "auto",
          }}>
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.2rem", fontWeight: 900, color: "#0F172A" }}>
              🛵 Despachar Rota de Entrega
            </h3>
            <p style={{ fontSize: "0.85rem", color: "#64748B", marginBottom: "1.25rem" }}>
              Selecione o motoboy para enviar esta rota com <b>{selectedOrderIds.length} pedido(s)</b>.
            </p>

            {/* Route Sequence Preview */}
            <div style={{ background: "#F8FAFC", borderRadius: "10px", padding: "0.75rem", marginBottom: "1rem", border: "1px solid #E2E8F0" }}>
              <span style={{ fontSize: "0.75rem", fontWeight: 800, color: "#475569" }}>SEQUÊNCIA DE PARADAS:</span>
              <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {selectedOrderIds.map((id, idx) => {
                  const o = deliveryOrders.find(item => item.id === id);
                  if (!o) return null;
                  const pInfo = getOrderPaymentInfo(o);
                  return (
                    <div key={id} style={{ fontSize: "0.8rem", color: "#1E293B", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ background: "#1C1917", color: "#fff", width: "18px", height: "18px", borderRadius: "50%", fontSize: "0.7rem", fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          {idx + 1}
                        </span>
                        <b>#{getOrderDisplayNumber(o)}</b> — {o.customerName} ({o.neighborhood || "Centro"})
                      </div>
                      <span style={{ fontSize: "0.72rem", fontWeight: 700, color: pInfo.isCash ? "#C92E09" : pInfo.isCardOnDelivery ? "#1C1917" : "#0F766E" }}>
                        {pInfo.isCash ? `💵 Troco: R$ ${pInfo.changeNeeded.toFixed(2)}` : pInfo.isCardOnDelivery ? "💳 Cartão" : "✅ Pago Online"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Resumo de Logística de Pagamento (Troco & Maquininha) */}
            <div style={{ background: "#F0FDFA", border: "1.5px solid #99F6E4", borderRadius: "10px", padding: "0.85rem", marginBottom: "1.25rem" }}>
              <div style={{ fontSize: "0.78rem", fontWeight: 900, color: "#0F766E", marginBottom: "0.4rem", display: "flex", alignItems: "center", gap: "6px" }}>
                💼 RESUMO DE LOGÍSTICA DE PAGAMENTO:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.82rem", color: "#0F766E" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>💵 Troco Total a Levar no Caixa:</span>
                  <b style={{ fontSize: "0.95rem", color: routePaymentSummary.totalChangeToCarry > 0 ? "#C92E09" : "#0F766E" }}>
                    {routePaymentSummary.totalChangeToCarry > 0 ? `R$ ${routePaymentSummary.totalChangeToCarry.toFixed(2)}` : "Sem troco (R$ 0,00)"}
                  </b>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>💳 Levar Maquininha de Cartão:</span>
                  <b style={{ color: routePaymentSummary.needsCardMachine ? "#1C1917" : "#475569" }}>
                    {routePaymentSummary.needsCardMachine ? "✅ SIM (Cobrar Cartão na Entrega)" : "❌ NÃO (Pago Online / Dinheiro)"}
                  </b>
                </div>
              </div>
            </div>

            {/* Motoboy Selector */}
            <div style={{ marginBottom: "1.25rem" }}>
              <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#334155", marginBottom: 6 }}>
                SELECIONE O MOTOBOY:
              </label>

              {motoboys.length > 0 ? (
                <select
                  value={selectedMotoboyId}
                  onChange={(e) => setSelectedMotoboyId(e.target.value)}
                  style={{
                    width: "100%", padding: "10px", borderRadius: "8px", border: "1.5px solid #CBD5E1",
                    fontSize: "0.9rem", fontWeight: 700, background: "#FFFFFF", outline: "none"
                  }}
                >
                  <option value="">-- Escolha um Motoboy Cadastrado --</option>
                  {motoboys.map(m => (
                    <option key={m.id} value={m.id}>🛵 {m.name} {m.phone ? `(${m.phone})` : ""}</option>
                  ))}
                </select>
              ) : null}

              {!selectedMotoboyId && (
                <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Ou digite o nome e telefone do motoboy:</span>
                  <input
                    type="text"
                    placeholder="Nome ex: MATHEUS, MARCOS CEBOLA, FRED..."
                    value={customMotoboyName}
                    onChange={(e) => setCustomMotoboyName(e.target.value)}
                    style={{
                      width: "100%", padding: "10px", borderRadius: "8px", border: "1.5px solid #CBD5E1",
                      fontSize: "0.9rem", outline: "none", fontFamily: "inherit"
                    }}
                  />
                  <input
                    type="text"
                    placeholder="WhatsApp do Motoboy (ex: 22999998888)"
                    value={customMotoboyPhone}
                    onChange={(e) => setCustomMotoboyPhone(e.target.value)}
                    style={{
                      width: "100%", padding: "10px", borderRadius: "8px", border: "1.5px solid #CBD5E1",
                      fontSize: "0.9rem", outline: "none", fontFamily: "inherit"
                    }}
                  />
                </div>
              )}

              {/* Opção de Envio por WhatsApp */}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", fontWeight: 700, color: "#1E293B", cursor: "pointer", marginTop: "0.85rem" }}>
                <input
                  type="checkbox"
                  checked={sendWhatsAppToMotoboy}
                  onChange={(e) => setSendWhatsAppToMotoboy(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "#1C1917" }}
                />
                📱 Disparar rota automaticamente no WhatsApp do Motoboy
              </label>
            </div>

            {/* Action Buttons */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <button
                onClick={() => setShowDispatchModal(false)}
                style={{
                  flex: 1, padding: "10px", background: "#F1F5F9", border: "1px solid #CBD5E1",
                  borderRadius: "8px", fontWeight: 700, fontSize: "0.85rem", color: "#475569", cursor: "pointer"
                }}
              >
                Voltar
              </button>

              {/* O "carregando" vale desde o clique (antes só aparecia na segunda
                  das chamadas, e o botão seguia clicável na primeira). */}
              <button
                onClick={handleConfirmDispatch}
                disabled={isDispatching}
                style={{
                  flex: 2, padding: "10px", background: "#1C1917", border: "none",
                  borderRadius: "8px", fontWeight: 800, fontSize: "0.88rem", color: "#FFFFFF",
                  cursor: isDispatching ? "wait" : "pointer", opacity: isDispatching ? 0.8 : 1,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6
                }}
              >
                {isDispatching ? <Loader2 size={16} className="animate-spin" /> : <Navigation size={16} />}
                {isDispatching ? "Despachando…" : "Despachar Rota agora"}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ─── CONFIGURAÇÃO DE MODALIDADES (ESTILO SAIPOS) ─── */}
      {showConfigModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem"
        }}>
          {/* Altura limitada + rolagem própria.
              Sem isto o modal crescia com o conteúdo e passava da tela: na
              modalidade Inteligente são oito campos, e o notebook do lojista
              cortava justamente o fim — onde fica o botão SALVAR. A tela não
              ficava só feia, ficava inutilizável, porque não havia como guardar
              a configuração que a pessoa tinha acabado de escolher. */}
          <div style={{
            background: "#FFFFFF", borderRadius: "14px", width: "100%", maxWidth: "560px",
            padding: "1.75rem", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)",
            maxHeight: "90vh", overflowY: "auto",
          }}>
            <h3 style={{ margin: "0 0 0.25rem 0", fontSize: "1.2rem", fontWeight: 900, color: "#0F172A" }}>
              ⚙️ Configurações da Roteirização
            </h3>
            <p style={{ fontSize: "0.82rem", color: "#64748B", marginBottom: "1.25rem" }}>
              Escolha e configure as regras de agrupamento de pedidos.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
              
              {/* Modalidade */}
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#334155", marginBottom: 4 }}>
                  Escolha a modalidade de roteirização que deseja habilitar:
                </label>
                {/* O seletor dos três modos à esquerda e a Rota 100% automatizada
                    à direita, na mesma linha (Douglas, 21/10/2026); em tela
                    estreita o botão desce para a linha de baixo. */}
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={routeMode}
                    onChange={(e: any) => setRouteMode(e.target.value)}
                    style={{
                      flex: "1 1 200px", minWidth: 0, padding: "10px", borderRadius: "8px", border: "1.5px solid #1C1917",
                      fontSize: "0.9rem", fontWeight: 800, color: "#1C1917", background: "#FAF6F2"
                    }}
                  >
                    <option value="Manual">Manual</option>
                    <option value="Automatizada">Automatizada</option>
                    <option value="Inteligente">Inteligente</option>
                  </select>
                  {rotaAuto && (
                    <RotaAutomatica
                      estado={rotaAuto}
                      salvando={salvandoRotaAuto}
                      onSalvar={salvarRotaAuto}
                      carregarPrevia={carregarPreviaRotaAuto}
                    />
                  )}
                </div>
              </div>

              {routeMode !== "Manual" && (
                <>
                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#334155", marginBottom: 4 }}>
                      ⏱️ Janela Máxima de Espera para Agrupar Pedidos (em minutos - máx 15):
                    </label>
                    <input
                      type="number"
                      max={15}
                      min={1}
                      value={maxWaitMinutes}
                      onChange={(e) => setMaxWaitMinutes(Math.min(15, Math.max(1, Number(e.target.value))))}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }}
                    />
                    <p style={{ margin: "4px 0 0 0", fontSize: "0.74rem", color: "#64748B", lineHeight: 1.3 }}>
                      💡 <b>O que significa:</b> É o tempo máximo que um pedido antigo pode esperar na loja por outros pedidos da mesma região antes de sair na entrega. Evita que o pedido fique esperando tempo demais e chegue frio.
                    </p>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                      Em qual status os pedidos deverão ser roteirizados?
                    </label>
                    <select
                      value={targetStatus}
                      onChange={(e) => setTargetStatus(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }}
                    >
                      <option value="Cozinha">Cozinha</option>
                      <option value="Pronto">Pronto</option>
                      <option value="Aceito">Aceito</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                      Depois de roteirizados, os pedidos deverão ser movimentados automaticamente ao próximo status?
                    </label>
                    <select
                      value={autoMoveStatus}
                      onChange={(e) => setAutoMoveStatus(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }}
                    >
                      <option value="Não">Não</option>
                      <option value="Sim">Sim</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                      Quais pedidos exibir na Roteirização?
                    </label>
                    <select
                      value={onlyProntoOrders ? "PRONTOS" : "TODOS"}
                      onChange={(e) => setOnlyProntoOrders(e.target.value === "PRONTOS")}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1.5px solid #1C1917", background: "#FAF6F2", fontWeight: 800, color: "#1C1917" }}
                    >
                      <option value="TODOS">Todos os pedidos pendentes (Cozinha, Aceito, Pronto)</option>
                      <option value="PRONTOS">Roteirizar APENAS pedidos com status "Pronto"</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 700, color: "#334155", marginBottom: 4 }}>
                      Imprimir automaticamente os pedidos após roteirizar?
                    </label>
                    <select
                      value={autoPrint}
                      onChange={(e) => setAutoPrint(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1px solid #CBD5E1" }}
                    >
                      <option value="Não">Não</option>
                      <option value="Sim">Sim</option>
                    </select>
                  </div>
                </>
              )}

              {routeMode === "Inteligente" && (
                <>
                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#1C1917", marginBottom: 4 }}>
                      Número máximo de pedidos a serem inseridos em uma mesma rota:
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={maxOrdersPerRoute}
                      onChange={(e) => setMaxOrdersPerRoute(Number(e.target.value))}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1.5px solid #E7DDD3", background: "#FAF6F2", fontWeight: 800 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 800, color: "#1C1917", marginBottom: 4 }}>
                      Distância máxima entre pedidos de uma mesma rota (em quilômetros):
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={maxDistanceKm}
                      onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: "8px", border: "1.5px solid #E7DDD3", background: "#FAF6F2", fontWeight: 800 }}
                    />
                  </div>
                </>
              )}

            </div>

            {/* O botão fica GRUDADO no rodapé do modal, não no fim da lista de
                campos. Com a rolagem acima, ele continuaria existindo — mas só
                para quem descobrisse que precisa rolar até o fim. O lojista abre
                isto para mudar uma opção e salvar; o salvar tem que estar à
                vista o tempo todo.

                As margens negativas compensam o padding do modal, para a faixa
                branca cobrir a largura inteira e o conteúdo não passar por trás
                do botão ao rolar. */}
            <div style={{
              position: "sticky", bottom: "-1.75rem",
              margin: "1.5rem -1.75rem -1.75rem", padding: "1rem 1.75rem 1.75rem",
              background: "#FFFFFF", borderTop: "1px solid #E2E8F0",
              display: "flex", justifyContent: "flex-end", gap: "0.75rem",
            }}>
              <button
                onClick={handleSaveConfig}
                style={{
                  padding: "10px 20px", background: "#1C1917", color: "#FFFFFF",
                  border: "none", borderRadius: "8px", fontWeight: 800, fontSize: "0.9rem",
                  cursor: "pointer"
                }}
              >
                💾 SALVAR CONFIGURAÇÃO
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
