/**
 * POST /api/store/table-sessions/[id]/imprimir-conta
 *
 * Imprime a conta inteira da mesa — o papel que vai para o cliente na hora de
 * fechar. Corpo (opcional): { taxa?: number, gorjeta?: number }.
 *
 * A taxa de serviço padrão é a COMISSÃO CADASTRADA do garçom da mesa (aba
 * Garçons); sem garçom vinculado, 10%. A tela de fechamento pode mandar outra
 * (é o que o gerente ajustou no modal), e é essa que sai no papel.
 *
 * O cupom não é impresso daqui: fica em PrintRequest e a fila da nuvem
 * (GET /api/store/print-queue) entrega ao Assistente do caixa, que puxa a cada
 * 3 s — exatamente o caminho das comandas de mesa e balcão. O cupom montado
 * volta na resposta para o painel tentar a impressora local na hora.
 */
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa, rotuloDoOperador } from "@/lib/garcom-auth";
import { calcularContaDaMesa, montarCupomDaConta, sanearTaxa } from "@/lib/conta-da-mesa";
import { impressorasDaContaDaMesa } from "@/lib/impressao-da-conta";

export const dynamic = "force-dynamic";

const TAXA_PADRAO = 10;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
  const operador = await resolverOperadorDaMesa();
  if (!operador) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const lojaId = operador.franchiseeId;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const mesa = await prisma.tableSession.findUnique({
    where: { id },
    include: {
      // O dono vem da MESA (Table.franchiseeId é a relação de verdade), como
      // no fechamento e nos pagamentos.
      table: { select: { number: true, label: true, franchiseeId: true } },
      waiter: { select: { name: true, commissionRate: true } },
      orders: {
        select: {
          status: true,
          totalAmount: true,
          dailyOrderNumber: true,
          items: {
            select: {
              id: true, quantity: true, price: true, productName: true,
              tableGuestId: true,
              menuProduct: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!mesa || mesa.table.franchiseeId !== lojaId) {
    return NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 });
  }
  if (mesa.status !== "OPEN") {
    return NextResponse.json({ error: "Esta mesa já foi fechada" }, { status: 400 });
  }

  const pessoas = await prisma.tableGuest.findMany({
    where: { tableSessionId: id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  const taxaDoGarcom = mesa.waiter?.commissionRate;
  const taxaPadrao = taxaDoGarcom !== null && taxaDoGarcom !== undefined ? sanearTaxa(taxaDoGarcom, TAXA_PADRAO) : TAXA_PADRAO;
  const taxaPct = sanearTaxa(body?.taxa, taxaPadrao);
  const gorjeta =
    body?.gorjeta !== undefined && body?.gorjeta !== null && body?.gorjeta !== ""
      ? Number(body.gorjeta)
      : null;
  // Mesma régua do fechamento: negativa ou absurda é pedido malformado.
  if (gorjeta !== null && (!Number.isFinite(gorjeta) || gorjeta < 0 || gorjeta > 100_000)) {
    return NextResponse.json({ error: "Gorjeta inválida" }, { status: 400 });
  }

  // A loja pode ter desmarcado a conta em TODAS as impressoras (tela de
  // Impressoras). Aí o papel não sairia em lugar nenhum — nem na impressora
  // local, nem pela fila da nuvem — e o garçom ficaria esperando por ele.
  // Recusar aqui é o que faz aparecer o motivo na tela.
  const dono = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { printerConfig: true },
  });
  const impressorasDaLoja = (dono?.printerConfig as any)?.printers;
  if (impressorasDaContaDaMesa(Array.isArray(impressorasDaLoja) ? impressorasDaLoja : []) === null) {
    return NextResponse.json(
      { error: "Nenhuma impressora está marcada para imprimir a conta da mesa. Marque uma em Impressoras." },
      { status: 400 }
    );
  }

  const conta = calcularContaDaMesa(mesa, pessoas, taxaPct, gorjeta);
  if (conta.total <= 0) {
    return NextResponse.json({ error: "A mesa ainda não tem consumo para imprimir" }, { status: 400 });
  }

  const cupom = montarCupomDaConta(conta, {
    sessionId: id,
    garcom: mesa.waiter?.name || mesa.waiterName || null,
    cliente: mesa.customerName || null,
  });

  await prisma.printRequest.create({
    data: {
      franchiseeId: lojaId,
      kind: "CONTA_DA_MESA",
      payload: cupom as unknown as Prisma.InputJsonValue,
      requestedBy: rotuloDoOperador(operador),
      tableSessionId: id,
    },
  });

  return NextResponse.json({
    ok: true,
    cupom,
    taxaPct,
    total: conta.total,
    pessoas: conta.pessoas.length,
  });
}
