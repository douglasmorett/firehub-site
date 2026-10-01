/**
 * src/lib/previsao-da-entrega.ts — o horário que o CLIENTE espera receber o
 * pedido, para sair no topo da comanda impressa.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O dono, em 01/10/2026: "preciso que saia o horário de previsão de entrega
 * para o cliente nas notas impressas, próximo do topo". A comanda tinha a hora
 * em que o pedido ENTROU e nada sobre quando ele tem que CHEGAR — e é por esse
 * horário que a cozinha prioriza e o motoboy monta a rota.
 *
 * ── De onde vem o horário ───────────────────────────────────────────────────
 *
 *   1. MARKETPLACE (iFood, 99Food, Brendi...): `scheduledDatetime`. Apesar do
 *      nome, é ali que as integrações gravam o prazo do parceiro
 *      (`deliveryDateTime` / fim da janela estimada — ver customer-order/poll).
 *   2. AGENDAMENTO DE VERDADE (qualquer canal): `scheduledDatetime` mais de 3 h
 *      depois da criação. Sai como AGENDADO, com a data. É o mesmo corte do
 *      painel (AGENDAMENTO_DE_VERDADE_MS em StoreOrdersDashboard.tsx).
 *   3. ENTREGA DA PRÓPRIA LOJA (site, robô, balcão): criação + `tempoEntregaMin`,
 *      o tempo da área de entrega que o cliente viu no checkout ("chega em até
 *      ~40 min"), gravado no pedido na hora da venda. Gravado e não recalculado:
 *      a loja muda a tabela de entrega e a promessa feita ao cliente não muda.
 *
 * Sem nenhum dos três, não há linha. O papel não inventa prazo.
 *
 * SEM IMPORTS de propósito: roda no servidor (fila da nuvem) e no navegador
 * (lib/print.ts), e o teste carrega o arquivo sozinho.
 */

export type TipoDaPrevisao = "ENTREGA" | "RETIRADA" | "AGENDADO";

/** O que viaja para o Assistente. `em` é ISO: quem formata a hora é o PC da loja, no fuso dela. */
export type PrevisaoNaComanda = { em: string; tipo: TipoDaPrevisao };

/** O mesmo corte de AGENDAMENTO_DE_VERDADE_MS no painel. */
const AGENDAMENTO_DE_VERDADE_MS = 3 * 60 * 60 * 1000;

/** Acima de 6 h não é prazo de entrega, é erro de digitação (o mesmo teto de fatos-da-loja.ts). */
const TEMPO_MAXIMO_MIN = 360;

/**
 * Um prazo do parceiro ANTES da criação não existe; a folga cobre relógios
 * desencontrados entre o parceiro e o nosso servidor.
 */
const FOLGA_DO_RELOGIO_MS = 5 * 60 * 1000;

const data = (v: unknown): Date | null => {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** O tempo que vai para `CustomerOrder.tempoEntregaMin`: minutos inteiros, 1 a 360, ou nulo. */
export function tempoDeEntregaParaGravar(min: unknown): number | null {
  const n = typeof min === "number" ? min : typeof min === "string" && min.trim() !== "" ? Number(min) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > TEMPO_MAXIMO_MIN) return null;
  return Math.round(n);
}

export function previsaoDaEntrega(pedido: {
  createdAt?: unknown;
  scheduledDatetime?: unknown;
  tempoEntregaMin?: unknown;
  deliveryType?: unknown;
  kind?: unknown;
} | null | undefined): PrevisaoNaComanda | null {
  if (!pedido) return null;
  // A conta da mesa e a rodada da mesa não têm entrega nenhuma.
  const tipoDoPedido = String(pedido.deliveryType || "").toUpperCase();
  if (tipoDoPedido === "MESA" || pedido.kind) return null;
  const criado = data(pedido.createdAt);
  if (!criado) return null;
  const ehEntrega = tipoDoPedido === "DELIVERY";

  const agendado = data(pedido.scheduledDatetime);
  if (agendado && agendado.getTime() >= criado.getTime() - FOLGA_DO_RELOGIO_MS) {
    const tipo: TipoDaPrevisao = agendado.getTime() - criado.getTime() > AGENDAMENTO_DE_VERDADE_MS
      ? "AGENDADO"
      : ehEntrega ? "ENTREGA" : "RETIRADA";
    return { em: agendado.toISOString(), tipo };
  }

  const minutos = ehEntrega ? tempoDeEntregaParaGravar(pedido.tempoEntregaMin) : null;
  if (minutos) {
    return { em: new Date(criado.getTime() + minutos * 60_000).toISOString(), tipo: "ENTREGA" };
  }
  return null;
}

/**
 * Os campos da previsão para o payload do Assistente. Sem previsão, NADA — nem
 * a chave: a reimpressão parte de um payload antigo que pode já trazer a
 * previsão calculada, e um `undefined` aqui a apagaria no spread.
 */
export function camposDaPrevisaoParaImpressao(pedido: any): { previsaoEntrega?: PrevisaoNaComanda } {
  const p = previsaoDaEntrega(pedido);
  return p ? { previsaoEntrega: p } : {};
}
