/**
 * GET /api/store/table-sessions/[id]/conta
 *
 * A conta da mesa, já dividida por pessoa. É o que o garçom abre na hora de
 * fechar: quanto é o total, quanto cada um consumiu, e quanto falta receber.
 *
 * A conta em si é calculada em src/lib/conta-da-mesa.ts — a mesma função que
 * monta o cupom impresso (rota imprimir-conta), para o papel e a tela nunca
 * dizerem totais diferentes.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import { calcularContaDaMesa, sanearTaxa } from "@/lib/conta-da-mesa";
import { normalizarConfigFiscal } from "@/lib/fiscal-config";
import { documentoNoPedido } from "@/lib/fiscal-modo";
import { contaSemTaxa, gravacaoDaTaxa } from "@/lib/taxa-da-mesa";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
  const operador = await resolverOperadorDaMesa();
  if (!operador) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const lojaId = operador.franchiseeId;

  const { id } = await params;

  const mesa = await prisma.tableSession.findUnique({
    where: { id },
    include: {
      table: { select: { number: true, label: true } },
      orders: {
        select: {
          status: true,
          totalAmount: true,
          dailyOrderNumber: true,
          items: {
            select: {
              id: true, quantity: true, price: true, productName: true,
              tableGuestId: true,
              // As escolhas do combo: é nelas que mora "2 pastéis" na Pastel
              // da Paulista. Sem elas a conta diz "1x" onde há dois.
              comboSelections: true,
              menuProduct: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!mesa || mesa.franchiseeId !== lojaId) {
    return NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 });
  }

  const pessoas = await prisma.tableGuest.findMany({
    where: { tableSessionId: id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });

  // A tela de fechamento manda a taxa e a gorjeta que o garçom escolheu na
  // hora. Sem isso, o rateio usaria os valores salvos na sessão e a soma das
  // partes não bateria com o total que o fechamento vai exigir — a mesa
  // mostraria uma conta e recusaria fechar por outra.
  //
  // O fallback da taxa é 0, não `mesa.serviceFee`: o fechamento grava ali o
  // VALOR em reais da taxa, não o percentual. Ler aquele campo como "%"
  // transformaria uma taxa de R$ 24 em 24% e inflaria a conta inteira.
  const taxaPct = sanearTaxa(req.nextUrl.searchParams.get("taxa"), 0);
  const gorjetaParam = req.nextUrl.searchParams.get("gorjeta");
  const gorjeta =
    gorjetaParam !== null && gorjetaParam !== "" ? Math.max(0, Number(gorjetaParam) || 0) : null;

  // O desconto vem por querystring para a conta por pessoa bater com o
  // fechamento: sem ele aqui, a tela dividiria o valor CHEIO e o servidor
  // recusaria o fechamento por sobra.
  const tipoDesconto = req.nextUrl.searchParams.get("descontoTipo") === "valor" ? "valor" : "percent";
  const valorDesconto = Number(req.nextUrl.searchParams.get("descontoValor")) || 0;
  const desconto = valorDesconto > 0
    ? { tipo: tipoDesconto as "percent" | "valor", valor: valorDesconto, motivo: req.nextUrl.searchParams.get("descontoMotivo") || "" }
    : null;

  // "CPF na nota?" no fechamento (lib/fiscal-modo): só a regra, lida da loja —
  // o garçom pelo link também fecha conta, e a pergunta vale para ele.
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { fiscalConfig: true } }).catch(() => null);
  const notaFiscal = documentoNoPedido(normalizarConfigFiscal(loja?.fiscalConfig));

  // `semTaxa`: a conta foi marcada "sem taxa de serviço" (POST abaixo). Só
  // informa; a conta acima segue a `taxa` pedida, como sempre.
  return NextResponse.json({ ...calcularContaDaMesa(mesa, pessoas, taxaPct, gorjeta, desconto), notaFiscal, semTaxa: contaSemTaxa(mesa) });
}

/**
 * POST /api/store/table-sessions/[id]/conta  { semTaxa: boolean }
 *
 * O cliente pediu para pagar sem a taxa de serviço (ou mudou de ideia). A
 * escolha fica na conta aberta (lib/taxa-da-mesa.ts) para o fechamento do
 * painel e do garçom pelo link já abrirem sem a taxa. O app da maquininha usa
 * esta rota: o HttpURLConnection do Android não manda PATCH.
 *
 * Mesma trava do fechamento: garçom sem "pode tirar a taxa" não tira.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operador = await resolverOperadorDaMesa();
  if (!operador) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const corpo = await req.json().catch(() => ({}));
  const gravar = gravacaoDaTaxa(corpo?.semTaxa);
  if (!gravar) return NextResponse.json({ error: "Mande semTaxa: true ou false" }, { status: 400 });

  if (gravar.serviceFee === 0 && operador.tipo === "garcom" && !operador.garcom.podeTirarTaxa) {
    return NextResponse.json(
      { error: "Este garçom não tira a taxa de serviço. Peça ao caixa para tirar pelo painel." },
      { status: 403 },
    );
  }

  const mesa = await prisma.tableSession.findUnique({
    where: { id },
    select: { status: true, table: { select: { franchiseeId: true } } },
  });
  if (!mesa || mesa.table?.franchiseeId !== operador.franchiseeId) {
    return NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 });
  }
  // Só a conta aberta: na fechada o campo é o valor da taxa cobrada.
  const r = await prisma.tableSession.updateMany({ where: { id, status: "OPEN" }, data: gravar });
  if (r.count !== 1) return NextResponse.json({ error: "Esta mesa já foi fechada." }, { status: 409 });

  return NextResponse.json({ ok: true, semTaxa: gravar.serviceFee === 0 });
}
