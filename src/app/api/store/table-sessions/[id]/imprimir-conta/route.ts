/**
 * POST /api/store/table-sessions/[id]/imprimir-conta
 *
 * Imprime a conta inteira da mesa — o papel que vai para o cliente na hora de
 * fechar. Corpo (opcional): { taxa?: number, gorjeta?: number, desconto?: DescontoManual }.
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
import { versaoAtende } from "@/lib/campanha-converter";
import { VERSAO_ASSISTENTE_COM_TAXA_SEPARADA } from "@/lib/print";
import { descontoDoCorpo } from "@/lib/desconto-manual";

export const dynamic = "force-dynamic";

const TAXA_PADRAO = 10;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
  const operador = await resolverOperadorDaMesa();
  if (!operador) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const lojaId = operador.franchiseeId;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  // Garçom sem "pode dar desconto": a conta impressa por ele não leva desconto.
  if (operador.tipo === "garcom" && !operador.garcom.podeDarDesconto && Number(body?.desconto?.valor) > 0) {
    return NextResponse.json({ error: "Este garçom não dá desconto. A conta com desconto sai pelo painel da loja." }, { status: 403 });
  }

  const mesa = await prisma.tableSession.findUnique({
    where: { id },
    include: {
      // O dono vem da MESA (Table.franchiseeId é a relação de verdade), como
      // no fechamento e nos pagamentos.
      table: { select: { number: true, label: true, franchiseeId: true } },
      waiter: { select: { name: true } },
      orders: {
        select: {
          status: true,
          totalAmount: true,
          dailyOrderNumber: true,
          items: {
            select: {
              id: true, quantity: true, price: true, productName: true,
              tableGuestId: true,
              // As escolhas do combo entram na linha da conta: "Carne moida
              // com Catupiry (2x Tradicional)". Sem isso o papel dizia "1x".
              comboSelections: true,
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

  // Sem taxa no pedido, vale a da LOJA (User.taxaServicoPadrao), senão 10 —
  // a mesma da tela das mesas. A comissão do garçom não entra: é quanto a
  // loja repassa a ele, não o que o cliente paga.
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { taxaServicoPadrao: true } });
  const taxaDaLoja = sanearTaxa(loja?.taxaServicoPadrao, TAXA_PADRAO);
  const taxaPct = sanearTaxa(body?.taxa, taxaDaLoja);
  // Garçom sem "pode tirar a taxa": a conta impressa por ele sai com a taxa
  // da loja, nunca abaixo — o campo está travado na tela dele.
  if (operador.tipo === "garcom" && !operador.garcom.podeTirarTaxa && taxaPct < taxaDaLoja) {
    return NextResponse.json({ error: `Este garçom não tira a taxa de serviço (${taxaDaLoja}%). A conta sem taxa sai pelo painel da loja.` }, { status: 403 });
  }
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
    select: { printerConfig: true, printQueueEstado: true },
  });
  const impressorasDaLoja = (dono?.printerConfig as any)?.printers;
  if (impressorasDaContaDaMesa(Array.isArray(impressorasDaLoja) ? impressorasDaLoja : []) === null) {
    return NextResponse.json(
      { error: "Nenhuma impressora está marcada para imprimir a conta da mesa. Marque uma em Impressoras." },
      { status: 400 }
    );
  }

  // ── O DESCONTO DA MESA VAI PARA O PAPEL ──────────────────────────────────
  // A conta impressa ignorava o desconto: saía o consumo cheio e os 10% sobre
  // ele, enquanto o fechamento cobrava o consumo descontado e os 10% sobre o
  // que sobrou. O cliente conferia um papel que não batia com a cobrança.
  const conta = calcularContaDaMesa(mesa, pessoas, taxaPct, gorjeta, descontoDoCorpo(body?.desconto));
  if (conta.total <= 0) {
    return NextResponse.json({ error: "A mesa ainda não tem consumo para imprimir" }, { status: 400 });
  }

  // Taxa e gorjeta em linha própria só saem certo no Assistente que sabe
  // imprimir o rodapé da conta. No antigo elas continuam entrando como item —
  // feio, mas com o papel fechando, que é como ficou até 15/09/2026.
  const versaoDoAssistente = String((dono as any)?.printQueueEstado?.versao || "");

  const cupom = montarCupomDaConta(conta, {
    sessionId: id,
    garcom: mesa.waiter?.name || mesa.waiterName || null,
    cliente: mesa.customerName || null,
    taxaSeparada: versaoAtende(versaoDoAssistente, VERSAO_ASSISTENTE_COM_TAXA_SEPARADA),
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
