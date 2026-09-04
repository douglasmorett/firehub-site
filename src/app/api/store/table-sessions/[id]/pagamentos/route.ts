/**
 * /api/store/table-sessions/[id]/pagamentos
 *
 * Pagamentos da mesa, registrados UM A UM, enquanto a mesa ainda está aberta.
 *
 * Antes, o dinheiro só existia na tela: o garçom digitava as linhas de
 * pagamento no modal de fechamento e tudo ia junto no POST de `close`. Se ele
 * fechasse o modal, se o tablet reiniciasse, se outro garçom assumisse a mesa —
 * o que já tinha sido recebido sumia, e a única cópia era a memória de quem
 * estava lá. Numa mesa de oito pessoas que vão pagando aos poucos, isso é a
 * diferença entre fechar o caixa certo e discutir com o cliente.
 *
 * Agora cada baixa é gravada na hora. A mesa vai zerando de verdade, e o
 * fechamento só confere o que já está no banco.
 *
 * ONDE ISSO É GUARDADO, e por que não tem tabela nova:
 * `TableSession.paymentMethods` já é uma coluna Json, e no projeto inteiro
 * quem a lê é só o fechamento da mesa — que espera uma lista de
 * `{ method, amount }`. Cada entrada continua tendo exatamente esses dois
 * campos; o resto (uid, dono, hora) é acréscimo que o leitor antigo ignora.
 * Migração aqui é passo manual em produção (scripts/aplicar-schema.md), e não
 * fazia sentido pedir uma para guardar uma lista que já cabe onde está.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import {
  lerPagamentos,
  somarPagamentos,
  emCentavos,
  emReais,
  type PagamentoDaMesa,
} from "@/lib/pagamentos-da-mesa";

export const dynamic = "force-dynamic";

/** Resolve a loja da sessão e confere que a mesa é dela. */
async function abrirContexto(req: NextRequest, id: string) {
  // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
  const operador = await resolverOperadorDaMesa();
  if (!operador) {
    return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  const lojaId = operador.franchiseeId;

  // O dono vem da MESA, não do campo solto da sessão.
  //
  // `TableSession.franchiseeId` é uma String sem chave estrangeira; quem tem a
  // relação de verdade é `Table.franchiseeId`. O fechamento (close) sempre
  // conferiu pela mesa, e esta rota conferia pela sessão — dois caminhos para o
  // mesmo dono. Divergindo, daria para registrar dinheiro numa mesa que o
  // fechamento depois recusa fechar, e o valor ficaria preso no meio.
  const mesa = await prisma.tableSession.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      paymentMethods: true,
      table: { select: { franchiseeId: true } },
    },
  });
  if (!mesa || mesa.table?.franchiseeId !== lojaId) {
    return { erro: NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 }) };
  }

  return { mesa };
}

/** Grava a lista e mantém `totalPaid` igual à soma — os dois nunca divergem. */
async function gravar(id: string, lista: PagamentoDaMesa[]) {
  const total = somarPagamentos(lista);
  await prisma.tableSession.update({
    where: { id },
    data: { paymentMethods: lista as any, totalPaid: total },
  });
  return { pagamentos: lista, totalPago: total };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await abrirContexto(_req, id);
  if (ctx.erro) return ctx.erro;

  const lista = lerPagamentos(ctx.mesa!.paymentMethods);
  return NextResponse.json({ pagamentos: lista, totalPago: somarPagamentos(lista) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await abrirContexto(req, id);
  if (ctx.erro) return ctx.erro;

  if (ctx.mesa!.status !== "OPEN") {
    return NextResponse.json(
      { error: "mesa_fechada", mensagem: "Esta mesa já foi fechada." },
      { status: 400 }
    );
  }

  const corpo = await req.json().catch(() => ({}));
  const valor = Number(corpo?.valor ?? corpo?.amount) || 0;
  if (valor <= 0) {
    return NextResponse.json(
      { error: "valor_invalido", mensagem: "Informe um valor maior que zero." },
      { status: 400 }
    );
  }

  const metodo = String(corpo?.metodo ?? corpo?.method ?? "Dinheiro").trim() || "Dinheiro";

  // O dono do pagamento é conferido contra as pessoas DESTA mesa. Um guestId de
  // outra mesa gravaria um pagamento em nome de quem não está sentado aqui, e o
  // rateio da conta passaria a mentir.
  let guestId: string | null = null;
  let guestName: string | null = null;
  const pedido = typeof corpo?.guestId === "string" ? corpo.guestId : null;
  if (pedido) {
    const pessoa = await prisma.tableGuest.findFirst({
      where: { id: pedido, tableSessionId: id },
      select: { id: true, name: true },
    });
    if (!pessoa) {
      return NextResponse.json(
        { error: "pessoa_invalida", mensagem: "Essa pessoa não está nesta mesa." },
        { status: 400 }
      );
    }
    guestId = pessoa.id;
    guestName = pessoa.name;
  }

  const lista = lerPagamentos(ctx.mesa!.paymentMethods);
  lista.push({
    uid: crypto.randomUUID(),
    method: metodo,
    amount: emReais(emCentavos(valor)),
    guestId,
    guestName,
    at: new Date().toISOString(),
  });

  return NextResponse.json(await gravar(id, lista));
}

/**
 * Apaga uma baixa. Existe porque garçom digita errado, e sem isto a única saída
 * seria fechar a mesa com um valor que ninguém pagou.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await abrirContexto(req, id);
  if (ctx.erro) return ctx.erro;

  if (ctx.mesa!.status !== "OPEN") {
    return NextResponse.json(
      { error: "mesa_fechada", mensagem: "Esta mesa já foi fechada." },
      { status: 400 }
    );
  }

  const uid = req.nextUrl.searchParams.get("uid");
  if (!uid) {
    return NextResponse.json({ error: "uid_obrigatorio" }, { status: 400 });
  }

  const lista = lerPagamentos(ctx.mesa!.paymentMethods).filter((p) => p.uid !== uid);
  return NextResponse.json(await gravar(id, lista));
}
