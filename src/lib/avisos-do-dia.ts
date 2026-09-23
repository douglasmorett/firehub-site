/**
 * Os avisos que TOCAM no painel da loja: pedido cancelado por quem não é a
 * loja, e disputa aberta pelo parceiro. Só os do dia.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O cancelamento não avisava ninguém. O pedido ia em silêncio para a coluna
 * "Cancelado" — que a loja pode até esconder — e a cozinha continuava fazendo
 * a esfirra que o cliente já tinha desistido de comprar. A disputa do iFood
 * abria uma janela, mas muda: sem som, ninguém olha para a tela a tempo. O
 * dono pediu (23/09/2026): som diferente do de pedido novo, janela com o
 * número nosso E o do parceiro (é por ele que se acha o pedido no portal),
 * o valor, e um botão "Ciente".
 *
 * ── As regras, decididas pelo dono ──────────────────────────────────────────
 *
 * • SÓ DO DIA. Vale o expediente da loja, que vira às 5h
 *   (`inicioDoExpedienteDaLoja`). Loja que não abriu ontem abre a tela sem
 *   aviso velho — pedido de ontem não se salva mais, e aviso que toca por
 *   coisa sem remédio ensina a loja a ignorar o som.
 * • SÓ OS DE FORA. Cliente, iFood, 99Food, Brendi, robô. Quem cancelou pela
 *   própria loja já sabe; tocar para ele é barulho.
 * • CIENTE VALE PARA TODAS AS TELAS. Um clique grava no pedido
 *   (`cancelCienteEm`) e as outras telas param na próxima consulta — como o
 *   som de pedido novo, que para em todas quando alguém aceita.
 *
 * ── O que não é aviso ───────────────────────────────────────────────────────
 *
 * Pedido sem número do dia nunca apareceu para a loja: é rascunho do robô ou
 * pedido do site com pagamento online que não foi pago (o número só nasce na
 * confirmação — api/customer-order). Cancelar isso não tira nada da cozinha.
 */
import { prisma } from "@/lib/prisma";
import { inicioDoExpedienteDaLoja } from "@/lib/fuso";
import { canalDoPedido } from "@/lib/canal-do-pedido";

export type AvisoDeCancelamento = {
  id: string;
  /** O nosso número do dia (#43). */
  numero: number | null;
  canal: string;
  /** O número no parceiro — iFood (4 dígitos), 99Food (6), Brendi... */
  referencia: string | null;
  cliente: string;
  valor: number;
  canceladoEm: string;
  /** "cliente", "iFood", "99Food"... null quando o parceiro não diz. */
  quem: string | null;
  motivo: string | null;
};

export type AvisoDeDisputa = {
  id: string;
  numero: number | null;
  canal: string;
  referencia: string | null;
  cliente: string;
  valor: number;
  /** CANCELLATION, DUE_DATE_CHANGE, PARTIAL_CANCELLATION... (o que o iFood mandou) */
  tipo: string | null;
  abertaEm: string | null;
  expiraEm: string | null;
};

/** Quem cancelou e NÃO gera aviso: a própria loja e o robô limpando rascunho. */
export const CANCELAMENTO_DA_LOJA = ["LOJA", "SYSTEM_INACTIVITY"];

const GRAFIAS_DE_CANCELADO = ["CANCELADO", "CANCELLED", "CANCELED"];

/** Quem cancelou, como o lojista fala. */
export function quemCancelouParaALoja(bruto: string | null | undefined): string | null {
  const q = String(bruto || "").toUpperCase().trim();
  if (!q) return null;
  if (q.includes("CUSTOMER") || q.includes("CLIENTE")) return "cliente";
  if (q.includes("IFOOD")) return "iFood";
  if (q.includes("99")) return "99Food";
  if (q.includes("BRENDI")) return "Brendi";
  if (q.includes("JOTAJA")) return "Jotajá";
  if (q.includes("API")) return "integração";
  return null;
}

const nomeDoCanal = (o: any) => {
  const c = canalDoPedido(o);
  return { nome: c.chave === "SITE" ? "Site" : c.nome, referencia: c.referencia };
};

/**
 * Os avisos em aberto das lojas desta conta, agora.
 *
 * `createdAt` limitado a 7 dias não é regra de negócio: é o que deixa a
 * consulta usar o índice por data em vez de varrer todo cancelado da história
 * da loja a cada poucos segundos. Um pedido agendado com mais de uma semana de
 * antecedência e cancelado hoje fica sem aviso — troca que vale.
 */
export async function avisosDoDia(
  lojaIds: string[],
  fuso: string,
  agora: Date = new Date()
): Promise<{ cancelamentos: AvisoDeCancelamento[]; disputas: AvisoDeDisputa[] }> {
  const inicio = inicioDoExpedienteDaLoja(fuso, agora);
  const semanaAtras = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const campos = {
    id: true, dailyOrderNumber: true, customerName: true, totalAmount: true, status: true,
    source: true, openDeliveryChannel: true, openDeliveryOrderId: true, openDeliveryReference: true,
    ifoodOrderId: true, ifoodReference: true, tableSessionId: true,
  } as const;

  const [cancelados, comDisputa] = await Promise.all([
    prisma.customerOrder.findMany({
      where: {
        franchiseeId: { in: lojaIds },
        status: { in: GRAFIAS_DE_CANCELADO },
        cancelledAt: { gte: inicio },
        cancelCienteEm: null,
        dailyOrderNumber: { not: null },
        createdAt: { gte: semanaAtras },
        // `notIn` sozinho deixaria de fora o cancelado SEM autor — e o 99Food
        // não grava quem cancelou. Nulo também é "de fora".
        OR: [{ cancelledBy: null }, { cancelledBy: { notIn: CANCELAMENTO_DA_LOJA } }],
      },
      select: { ...campos, cancelledAt: true, cancelledBy: true, cancelReason: true },
      orderBy: { cancelledAt: "asc" },
      take: 20,
    }),
    prisma.customerOrder.findMany({
      where: {
        franchiseeId: { in: lojaIds },
        createdAt: { gte: semanaAtras },
        status: { notIn: GRAFIAS_DE_CANCELADO },
        cancelDispute: { path: ["pending"], equals: true },
      },
      select: { ...campos, cancelDispute: true },
      take: 20,
    }),
  ]);

  const cancelamentos: AvisoDeCancelamento[] = cancelados.map((o) => {
    const c = nomeDoCanal(o);
    return {
      id: o.id,
      numero: o.dailyOrderNumber,
      canal: o.tableSessionId ? "Mesa" : c.nome,
      referencia: c.referencia,
      cliente: o.customerName || "",
      valor: Math.round((o.totalAmount || 0) * 100) / 100,
      canceladoEm: (o.cancelledAt || agora).toISOString(),
      quem: quemCancelouParaALoja(o.cancelledBy),
      motivo: o.cancelReason ? String(o.cancelReason).trim() || null : null,
    };
  });

  // A disputa conta do dia em que foi ABERTA, e só enquanto dá para responder:
  // vencida, quem decide é o iFood, e a janela só atrapalharia (09/09/2026: 12
  // disputas vencidas abrindo uma atrás da outra).
  const disputas: AvisoDeDisputa[] = [];
  for (const o of comDisputa) {
    const d = (o.cancelDispute || {}) as Record<string, any>;
    const aberta = d.requestedAt ? new Date(d.requestedAt) : null;
    if (!aberta || Number.isNaN(aberta.getTime()) || aberta < inicio) continue;
    const expira = d.expiresAt ? new Date(d.expiresAt) : null;
    if (expira && !Number.isNaN(expira.getTime()) && expira <= agora) continue;
    const c = nomeDoCanal(o);
    disputas.push({
      id: o.id,
      numero: o.dailyOrderNumber,
      canal: c.nome,
      referencia: c.referencia,
      cliente: o.customerName || "",
      valor: Math.round((o.totalAmount || 0) * 100) / 100,
      tipo: typeof d.type === "string" ? d.type : null,
      abertaEm: aberta.toISOString(),
      expiraEm: expira && !Number.isNaN(expira.getTime()) ? expira.toISOString() : null,
    });
  }

  return { cancelamentos, disputas };
}

/**
 * "Ciente": grava em cada pedido quem viu e quando. Só pedido cancelado das
 * lojas desta conta — o id vem do navegador.
 */
export async function marcarCiente(lojaIds: string[], ids: string[], quem: string): Promise<number> {
  const limpos = [...new Set(ids.filter((i) => typeof i === "string" && i.length > 0 && i.length < 64))].slice(0, 50);
  if (limpos.length === 0) return 0;
  const r = await prisma.customerOrder.updateMany({
    where: { id: { in: limpos }, franchiseeId: { in: lojaIds }, status: { in: GRAFIAS_DE_CANCELADO }, cancelCienteEm: null },
    data: { cancelCienteEm: new Date(), cancelCientePor: quem.slice(0, 120) || null },
  });
  return r.count;
}
