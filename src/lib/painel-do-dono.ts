/**
 * O retrato da loja que o robô entrega ao dono pelo WhatsApp.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 * O "modo dono" já existia, mas só sabia três coisas: caixa aberto, faturamento
 * do dia e quantidade de pedidos. Perguntar "quantas contas eu tenho para pagar
 * essa semana?" ou "tem pedido atrasado aí?" caía no vazio — e o robô, sem o
 * dado, respondia genérico, que é a mesma falha de atribuição que o fez inventar
 * uma ligação para o motoboy.
 *
 * Aqui os números são buscados no banco e entregues prontos ao prompt. O robô
 * não calcula nada: ele lê. O que não está nesta lista ele não sabe, e o prompt
 * manda dizer isso em vez de estimar.
 *
 * Tudo é lido de uma vez, em paralelo, porque isto roda no caminho da resposta
 * ao WhatsApp — o dono está esperando a mensagem.
 */
import { prisma } from "@/lib/prisma";
import { inicioDoDiaDaLoja } from "@/lib/fuso";

/**
 * Status que significam "ainda está na loja".
 *
 * `AGUARDANDO_PAGAMENTO` fica DE FORA de propósito: o pedido não começou porque
 * o cliente não pagou, e acusar a cozinha de atraso nesse caso é alarme falso.
 * `SAIU_ENTREGA`, `ENTREGUE` e `CANCELADO` também não entram — a partir daí o
 * atraso é estrada, e a loja não tem o que fazer com o aviso.
 */
export const STATUS_EM_ABERTO = ["NOVO", "ACEITO", "PREPARANDO"];

/** Prazo padrão quando a loja não cadastrou zona nenhuma. */
export const PRAZO_PADRAO_MIN = 45;

/**
 * Prazo de entrega prometido, em minutos.
 *
 * As zonas têm tempos diferentes; para julgar atraso vale o MAIOR, senão um
 * pedido do bairro mais distante seria acusado de atrasado dentro do prazo que
 * o próprio cardápio prometeu a ele.
 */
export function prazoDeEntregaMin(deliveryZones: unknown): number {
  const zonas = Array.isArray(deliveryZones) ? deliveryZones : [];
  const tempos = zonas
    .map((z: any) => Number(z?.time))
    .filter((t) => Number.isFinite(t) && t > 0);
  return tempos.length > 0 ? Math.max(...tempos) : PRAZO_PADRAO_MIN;
}

export type PedidoAtrasado = {
  id: string;
  numero: string;
  cliente: string;
  entrouEm: Date;
  minutosDeVida: number;
  prazoMin: number;
  minutosDeAtraso: number;
  status: string;
  canal: string;
};

/**
 * Pedidos que passaram do prazo e ainda NÃO saíram para entrega.
 *
 * "Não saiu" é o corte certo: depois que o motoboy pega, o atraso vira estrada,
 * que a loja não controla e sobre a qual o alerta não ajudaria em nada. Antes
 * disso é cozinha, e cozinha tem quem resolva.
 */
export async function pedidosAtrasados(
  franchiseeId: string,
  prazoMin: number,
  agora: Date = new Date()
): Promise<PedidoAtrasado[]> {
  const limite = new Date(agora.getTime() - prazoMin * 60_000);

  const pedidos = await prisma.customerOrder.findMany({
    where: {
      franchiseeId,
      status: { in: STATUS_EM_ABERTO },
      createdAt: { lt: limite },
      // Agendado para mais tarde não está atrasado: o cliente pediu assim.
      OR: [{ scheduledDatetime: null }, { scheduledDatetime: { lt: agora } }],
    },
    select: {
      id: true, dailyOrderNumber: true, customerName: true, createdAt: true,
      status: true, source: true, ifoodReference: true, openDeliveryReference: true,
    },
    orderBy: { createdAt: "asc" },
    take: 30,
  });

  return pedidos.map((p) => {
    const minutosDeVida = Math.floor((agora.getTime() - p.createdAt.getTime()) / 60_000);
    return {
      id: p.id,
      numero: p.dailyOrderNumber
        ? `#${p.dailyOrderNumber}`
        : p.ifoodReference || p.openDeliveryReference || `#${p.id.slice(-4)}`,
      cliente: p.customerName || "Sem nome",
      entrouEm: p.createdAt,
      minutosDeVida,
      prazoMin,
      minutosDeAtraso: minutosDeVida - prazoMin,
      status: p.status,
      canal: p.source || "SITE",
    };
  });
}

/** Hora local da loja, para o dono ler "20:15" e não um UTC qualquer. */
export function horaLocal(data: Date, timezone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit", minute: "2-digit",
      timeZone: timezone || "America/Sao_Paulo",
    }).format(data);
  } catch {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(data);
  }
}

export type ResumoGerencial = {
  prazoMin: number;
  caixaAberto: boolean;
  faturamentoHoje: number;
  pedidosHoje: number;
  ticketMedio: number;
  porCanal: Record<string, number>;
  emAberto: number;
  atrasados: PedidoAtrasado[];
  contasVencidas: { qtd: number; total: number };
  contasHoje: { qtd: number; total: number };
  contasSemana: { qtd: number; total: number };
  insumosAbaixoDoMinimo: Array<{ nome: string; quantidade: number; minimo: number; unidade: string }>;
};

/**
 * Tudo que o dono pode perguntar, medido de uma vez.
 *
 * `franchiseeId` é sempre o da LOJA (o `ownerId` quando quem fala é um
 * funcionário) — número de outra loja aqui vazaria faturamento alheio.
 */
export async function montarResumoGerencial(
  franchiseeId: string,
  opts: { deliveryZones?: unknown; caixaAberto?: boolean; timezone?: string | null } = {}
): Promise<ResumoGerencial> {
  const agora = new Date();
  // Meia-noite DA LOJA, não do container (UTC). Com setHours(0,0,0,0) o "hoje"
  // do dono virava às 21:00 de Brasília: o faturamento zerava no meio do
  // jantar e as contas que vencem hoje já apareciam como vencidas.
  const inicioDoDia = inicioDoDiaDaLoja(opts.timezone, agora);
  const fimDoDia = new Date(inicioDoDia.getTime() + 24 * 60 * 60_000 - 1);
  const daquiUmaSemana = new Date(agora.getTime() + 7 * 24 * 60 * 60_000);

  const prazoMin = prazoDeEntregaMin(opts.deliveryZones);

  const [pedidosDoDia, emAberto, atrasados, vencidas, hojeVence, naSemana, insumos] =
    await Promise.all([
      prisma.customerOrder.findMany({
        where: { franchiseeId, createdAt: { gte: inicioDoDia }, status: { not: "CANCELADO" } },
        select: { totalAmount: true, source: true },
      }),
      prisma.customerOrder.count({ where: { franchiseeId, status: { in: STATUS_EM_ABERTO } } }),
      pedidosAtrasados(franchiseeId, prazoMin, agora),
      prisma.payable.aggregate({
        where: { franchiseeId, status: "PENDING", dueDate: { lt: inicioDoDia } },
        _count: true, _sum: { value: true },
      }),
      prisma.payable.aggregate({
        where: { franchiseeId, status: "PENDING", dueDate: { gte: inicioDoDia, lte: fimDoDia } },
        _count: true, _sum: { value: true },
      }),
      prisma.payable.aggregate({
        where: { franchiseeId, status: "PENDING", dueDate: { gt: fimDoDia, lte: daquiUmaSemana } },
        _count: true, _sum: { value: true },
      }),
      prisma.stockItem.findMany({
        where: { franchiseeId, active: true, minQuantity: { not: null } },
        select: { name: true, quantity: true, minQuantity: true, unit: true },
      }),
    ]);

  const faturamentoHoje = pedidosDoDia.reduce((acc, o) => acc + (o.totalAmount || 0), 0);
  const porCanal: Record<string, number> = {};
  for (const p of pedidosDoDia) {
    const canal = p.source || "SITE";
    porCanal[canal] = (porCanal[canal] || 0) + 1;
  }

  return {
    prazoMin,
    caixaAberto: Boolean(opts.caixaAberto),
    faturamentoHoje,
    pedidosHoje: pedidosDoDia.length,
    ticketMedio: pedidosDoDia.length > 0 ? faturamentoHoje / pedidosDoDia.length : 0,
    porCanal,
    emAberto,
    atrasados,
    contasVencidas: { qtd: vencidas._count || 0, total: vencidas._sum.value || 0 },
    contasHoje: { qtd: hojeVence._count || 0, total: hojeVence._sum.value || 0 },
    contasSemana: { qtd: naSemana._count || 0, total: naSemana._sum.value || 0 },
    insumosAbaixoDoMinimo: insumos
      .filter((i) => i.minQuantity != null && i.quantity <= i.minQuantity)
      .slice(0, 12)
      .map((i) => ({
        nome: i.name,
        quantidade: i.quantity,
        minimo: i.minQuantity as number,
        unidade: i.unit,
      })),
  };
}

const real = (v: number) => `R$ ${v.toFixed(2).replace(".", ",")}`;

/**
 * O resumo em texto, do jeito que entra no prompt.
 *
 * Escrito como fato consumado e sem rodeio: o modelo copia número, não
 * interpreta. Cada linha existe porque é uma pergunta que o dono faz.
 */
export function resumoEmTexto(r: ResumoGerencial, timezone?: string | null): string {
  const canais = Object.entries(r.porCanal)
    .map(([canal, qtd]) => `${canal} ${qtd}`)
    .join(", ") || "nenhum";

  const listaAtrasados = r.atrasados.length === 0
    ? "  - Nenhum pedido atrasado neste momento."
    : r.atrasados
        .map(
          (p) =>
            `  - ${p.numero} (${p.cliente}, ${p.canal}): entrou ${horaLocal(p.entrouEm, timezone)}, ` +
            `prazo ${p.prazoMin} min, já são ${p.minutosDeVida} min — ${p.minutosDeAtraso} min ALÉM do prazo. Status: ${p.status}.`
        )
        .join("\n");

  const listaInsumos = r.insumosAbaixoDoMinimo.length === 0
    ? "  - Nenhum insumo abaixo do mínimo."
    : r.insumosAbaixoDoMinimo
        .map((i) => `  - ${i.nome}: ${i.quantidade}${i.unidade} (mínimo ${i.minimo}${i.unidade})`)
        .join("\n");

  return `
DADOS AO VIVO DA LOJA (fonte: banco de dados, medidos agora):
- Caixa físico: ${r.caixaAberto ? "ABERTO 🟢" : "FECHADO 🔴"}
- Prazo de entrega prometido no cardápio: ${r.prazoMin} minutos
- Faturamento de hoje: ${real(r.faturamentoHoje)}
- Pedidos de hoje: ${r.pedidosHoje} (ticket médio ${real(r.ticketMedio)})
- Por canal hoje: ${canais}
- Pedidos em aberto agora (ainda não saíram para entrega): ${r.emAberto}
- PEDIDOS ATRASADOS (${r.atrasados.length}):
${listaAtrasados}
- CONTAS A PAGAR em aberto:
  - Vencidas: ${r.contasVencidas.qtd} conta(s), ${real(r.contasVencidas.total)}
  - Vencem hoje: ${r.contasHoje.qtd} conta(s), ${real(r.contasHoje.total)}
  - Próximos 7 dias: ${r.contasSemana.qtd} conta(s), ${real(r.contasSemana.total)}
- INSUMOS ABAIXO DO MÍNIMO (${r.insumosAbaixoDoMinimo.length}):
${listaInsumos}
`.trim();
}
