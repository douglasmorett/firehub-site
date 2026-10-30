import { pagoNaMaquininha } from "@/lib/pagamento-na-entrega";

/**
 * Estorno do pedido do totem pago na maquininha — a regra pura, sem banco.
 *
 * Fica separada de lib/estorno-na-maquininha.ts (que fala com o banco) porque o
 * painel (componente de cliente) usa os textos daqui, e o teste
 * (scripts/teste-estorno-na-maquininha.ts) roda sem banco nenhum.
 *
 * Só a Cielo Smart estorna sozinha: é a única adquirente com estorno pelo
 * mesmo deeplink da cobrança (lio://payment-reversal) e com os ids da venda
 * gravados no resultado (`idsDaAdquirente.orderId` e `cieloCode`). Nas outras
 * o lojista continua fazendo na maquininha, com o aviso do painel.
 */

export const PREFIXO_DO_ESTORNO = "estorno:";

/** Provedor do terminal que estorna sozinho. */
export const PROVEDOR_COM_ESTORNO_AUTOMATICO = "CIELO_APP";

/**
 * Situações do estorno, gravadas na tabela "EstornoNaMaquininha".
 *
 * Os dois primeiros são a fila, com os mesmos nomes da cobrança
 * (ESTADOS_DA_COBRANCA): AGUARDANDO_TERMINAL até o app perguntar, NO_TERMINAL
 * quando ele pegou. Os três seguintes são o fim. CANCELADO = o pedido foi
 * reaberto antes de a maquininha pegar o estorno.
 */
export const SITUACOES_DO_ESTORNO = {
  aguardando: "AGUARDANDO_TERMINAL",
  noTerminal: "NO_TERMINAL",
  estornado: "ESTORNADO",
  recusado: "RECUSADO",
  incerto: "INCERTO",
  cancelado: "CANCELADO",
} as const;
export type SituacaoDoEstorno = (typeof SITUACOES_DO_ESTORNO)[keyof typeof SITUACOES_DO_ESTORNO];

/**
 * O que o app devolve. NAO_ABRIU não é fim: o app da Cielo nem chegou a abrir
 * (a tela do FireHub estava atrás de outra), o dinheiro não mexeu, e o estorno
 * volta para a fila.
 */
export const RESPOSTAS_DO_APP = ["ESTORNADO", "RECUSADO", "INCERTO", "NAO_ABRIU"] as const;
export type RespostaDoApp = (typeof RESPOSTAS_DO_APP)[number];

/** Quantas vezes a maquininha pode pegar o mesmo estorno sem responder antes de ele virar "incerto". */
export const ENTREGAS_ATE_DESISTIR = 3;
/** Estorno preso "na maquininha" volta para a fila depois disto (o mesmo prazo da cobrança). */
export const MINUTOS_ATE_DESTRAVAR_O_ESTORNO = 5;

/** Primeira versão do app da maquininha que estorna (apps/maquininha, versionName). */
export const VERSAO_DO_APP_COM_ESTORNO = "1.0.6";

/**
 * O app desta maquininha já sabe estornar? A versão vem do `?versao=` do
 * polling (PosTerminal.appVersion). Sem versão gravada, não: a 1.0.5 ignora o
 * campo `estorno` e o cancelamento ficaria prometendo um estorno que não sai.
 */
export function appFazEstorno(versao: string | null | undefined): boolean {
  const partes = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
  if (!versao || !/^\d+(\.\d+)*$/.test(versao.trim())) return false;
  const a = partes(versao.trim());
  const b = partes(VERSAO_DO_APP_COM_ESTORNO);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

const FINAIS: readonly string[] = [SITUACOES_DO_ESTORNO.estornado, SITUACOES_DO_ESTORNO.recusado, SITUACOES_DO_ESTORNO.incerto];
export const ehFinal = (s: string) => FINAIS.includes(s);

type PedidoPagoNaMaquininha = Parameters<typeof pagoNaMaquininha>[0] & { gatewayProvider?: string | null };

/** Cancelar este pedido manda o estorno sozinho para a maquininha? */
export function estornoAutomatico(pedido: PedidoPagoNaMaquininha): boolean {
  return pagoNaMaquininha(pedido) && pedido?.gatewayProvider === PROVEDOR_COM_ESTORNO_AUTOMATICO;
}

export type DadosDoEstorno = {
  valorCentavos: number;
  /** id da ordem na Cielo (`id` do JSON do payment-reversal). */
  ordem: string;
  cieloCode: string | null;
  autorizacao: string | null;
};

/**
 * O que vai no deeplink do estorno, tirado do comprovante que o app gravou no
 * aprovado (api/pos/terminal/resultado → posDadosTransacao). Sem o id da ordem
 * da Cielo não há o que estornar: devolve o motivo, e o painel manda fazer na
 * maquininha.
 */
export function dadosDoEstorno(
  posDadosTransacao: unknown,
  totalAmount: unknown,
): { ok: true; dados: DadosDoEstorno } | { ok: false; motivo: string } {
  const d = (posDadosTransacao && typeof posDadosTransacao === "object" ? posDadosTransacao : {}) as Record<string, any>;
  const ids = (d.idsDaAdquirente && typeof d.idsDaAdquirente === "object" ? d.idsDaAdquirente : {}) as Record<string, unknown>;
  const texto = (v: unknown) => (v == null ? null : String(v).trim() || null);
  const ordem = texto(ids.orderId);
  const valorCentavos = Math.round((Number(totalAmount) || 0) * 100);
  if (!ordem) return { ok: false, motivo: "a maquininha não guardou o código da venda na Cielo" };
  if (!(valorCentavos > 0)) return { ok: false, motivo: "pedido sem valor" };
  return {
    ok: true,
    dados: { valorCentavos, ordem, cieloCode: texto(ids.cieloCode), autorizacao: texto(d.autorizacao) },
  };
}

/**
 * O app mandou um resultado. O que gravar?
 *
 *  - `null` = nada muda (repetição, ou resultado que chega depois de outro
 *    final) — a rota responde ok, para o app tirar da fila dele;
 *  - ESTORNADO é prova e vale sempre que ainda não estava estornado: um
 *    "incerto" seguido do estorno feito vira feito;
 *  - NAO_ABRIU só conta para o estorno que está com a maquininha: volta para a
 *    fila, ou vira RECUSADO quando já foi entregue vezes demais.
 */
export function proximaSituacao(
  atual: string,
  resposta: RespostaDoApp,
  entregas: number,
): SituacaoDoEstorno | null {
  if (atual === SITUACOES_DO_ESTORNO.estornado) return null;
  if (resposta === "ESTORNADO") return SITUACOES_DO_ESTORNO.estornado;
  if (ehFinal(atual)) return null;
  if (resposta === "NAO_ABRIU") {
    if (atual !== SITUACOES_DO_ESTORNO.noTerminal) return null;
    return entregas >= ENTREGAS_ATE_DESISTIR ? SITUACOES_DO_ESTORNO.recusado : SITUACOES_DO_ESTORNO.aguardando;
  }
  return resposta === "RECUSADO" ? SITUACOES_DO_ESTORNO.recusado : SITUACOES_DO_ESTORNO.incerto;
}

export function ehRespostaDoApp(v: unknown): v is RespostaDoApp {
  return typeof v === "string" && (RESPOSTAS_DO_APP as readonly string[]).includes(v);
}

/** O que o card do pedido cancelado mostra. */
export type EstornoNoPainel = { situacao: string; motivo?: string | null; terminal?: string | null };

export function textoDoEstorno(e: EstornoNoPainel): { texto: string; tom: "ok" | "andando" | "erro" } {
  const onde = e.terminal ? ` (${e.terminal})` : "";
  switch (e.situacao) {
    case SITUACOES_DO_ESTORNO.estornado:
      return { texto: `✓ Estorno feito na maquininha${onde}`, tom: "ok" };
    case SITUACOES_DO_ESTORNO.aguardando:
    case SITUACOES_DO_ESTORNO.noTerminal:
      return { texto: `↩ Estorno enviado para a maquininha${onde} — aguardando`, tom: "andando" };
    case SITUACOES_DO_ESTORNO.incerto:
      return {
        texto: `⚠ A maquininha${onde} não confirmou o estorno${e.motivo ? `: ${e.motivo}` : ""}. Confira no histórico de vendas da Cielo e, se não saiu, faça o cancelamento na maquininha.`,
        tom: "erro",
      };
    case SITUACOES_DO_ESTORNO.cancelado:
      return { texto: "Estorno desistido: o pedido foi reaberto.", tom: "andando" };
    default:
      return {
        texto: `✕ Estorno não feito${e.motivo ? `: ${e.motivo}` : ""}. Faça o cancelamento da venda na maquininha${onde}.`,
        tom: "erro",
      };
  }
}
