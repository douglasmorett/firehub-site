import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import { recusaSeCaixaFechado } from "@/lib/caixa-aberto-servidor";
import { lancarNaMesa } from "@/lib/lancar-na-mesa";
import { balancaEstaLigada, produtosDaBalanca } from "@/lib/balanca/assinatura";
import { TIPO_COMANDA, numeroLidoDoCartao } from "@/lib/comanda";

/**
 * POST { comanda: 155, produtoId, pesoKg: 0.452 } — o prato pesado na tela da
 * balança (/store/balanca/pesar) entra na comanda 155.
 *
 * A comanda abre sozinha na primeira pesagem (o cliente pegou o cartão na
 * entrada; não há garçom para "ocupar a mesa"). O preço é o do produto por
 * quilo, calculado aqui (lib/itens-do-salao.ts) — da tela só vêm o número, o
 * produto e o peso que a balança informou. O pedido nasce ENTREGUE (fora do
 * KDS) e não imprime na cozinha: o prato já está na mão do cliente.
 */
export async function POST(req: NextRequest) {
  const operador = await resolverOperadorDaMesa();
  if (!operador) return NextResponse.json({ error: "Faça login de novo." }, { status: 401 });
  const franchiseeId = operador.franchiseeId;

  if (!(await balancaEstaLigada(franchiseeId))) {
    return NextResponse.json({ error: "O módulo Balança está desligado. O dono liga em Balança no menu." }, { status: 403 });
  }
  const semCaixa = await recusaSeCaixaFechado(franchiseeId, "lançar o item");
  if (semCaixa) return semCaixa;

  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const numero = numeroLidoDoCartao(corpo?.comanda);
  if (!numero) return NextResponse.json({ error: "Passe o cartão de novo (número não lido)." }, { status: 400 });

  const comanda = await prisma.table.findFirst({
    where: { franchiseeId, number: numero },
    select: { id: true, number: true, tipo: true, isActive: true },
  });
  if (!comanda || comanda.tipo !== TIPO_COMANDA) {
    return NextResponse.json({ error: `A comanda ${numero} não está cadastrada. Cadastre os cartões em Mesas → ⚙️ → Comandas.` }, { status: 404 });
  }
  if (!comanda.isActive) return NextResponse.json({ error: `A comanda ${numero} está desativada.` }, { status: 400 });

  // A sessão aberta do cartão, ou uma nova. Serializável, como a abertura de
  // mesa: duas balanças lendo o mesmo cartão no mesmo instante abririam duas contas.
  let sessaoId: string | null = null;
  let abriuAgora = false;
  try {
    sessaoId = await prisma.$transaction(async (tx) => {
      const aberta = await tx.tableSession.findFirst({ where: { tableId: comanda.id, status: "OPEN" }, select: { id: true } });
      if (aberta) return aberta.id;
      const nova = await tx.tableSession.create({
        data: { tableId: comanda.id, franchiseeId, status: "OPEN", openedAt: new Date() },
        select: { id: true },
      });
      abriuAgora = true;
      return nova.id;
    }, { isolationLevel: "Serializable" });
  } catch {
    // Conflito da transação: a outra pesagem abriu primeiro — usa a dela.
    sessaoId = (await prisma.tableSession.findFirst({ where: { tableId: comanda.id, status: "OPEN" }, select: { id: true } }))?.id ?? null;
  }
  if (!sessaoId) return NextResponse.json({ error: "Não deu para abrir a comanda. Tente de novo." }, { status: 503 });

  const r = await lancarNaMesa({
    franchiseeId,
    tableSessionId: sessaoId,
    items: [{ menuProductId: corpo?.produtoId, quantity: 1, pesoKg: corpo?.pesoKg }],
    origemDaImpressao: "FIREHUB",
    comoTentarDeNovo: "Confira os produtos por quilo em Balança no menu.",
    pesaveis: await produtosDaBalanca(franchiseeId),
    jaEntregue: true,
  });
  if (!r.ok) {
    // A pesagem recusada não deixa a comanda aberta e vazia no salão.
    if (abriuAgora) {
      await prisma.tableSession.deleteMany({ where: { id: sessaoId, orders: { none: {} } } }).catch(() => {});
    }
    return NextResponse.json({ error: r.error }, { status: r.status });
  }

  const totalDaComanda = await prisma.customerOrder.aggregate({
    where: { tableSessionId: sessaoId, status: { not: "CANCELADO" } },
    _sum: { totalAmount: true },
  });
  return NextResponse.json({
    ok: true,
    comanda: numero,
    valor: r.order.totalAmount,
    totalDaComanda: totalDaComanda._sum.totalAmount ?? r.order.totalAmount,
  });
}
