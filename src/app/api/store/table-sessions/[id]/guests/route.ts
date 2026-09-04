/**
 * Pessoas sentadas na mesa.
 *
 * GET    /api/store/table-sessions/[id]/guests   → lista, com o consumo de cada um
 * POST   /api/store/table-sessions/[id]/guests   { name } | { quantidade }
 * PATCH  /api/store/table-sessions/[id]/guests   { guestId, name }
 * DELETE /api/store/table-sessions/[id]/guests?guestId=...
 *
 * Existe para responder "quem pediu o quê" ANTES da hora de pagar. Sem isso, na
 * hora de rachar a conta o garçom tem que lembrar de cabeça quem comeu o quê —
 * e é aí que a mesa trava, a fila cresce e alguém acaba pagando a mais.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";

export const dynamic = "force-dynamic";

/** Confere que a sessão existe e pertence à loja de quem está logado. */
async function autorizar(sessionId: string) {
  // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
  const operador = await resolverOperadorDaMesa();
  if (!operador) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };

  const lojaId = operador.franchiseeId;

  const mesa = await prisma.tableSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, franchiseeId: true },
  });

  // Isolamento: uma loja não pode tocar na mesa de outra.
  if (!mesa || mesa.franchiseeId !== lojaId) {
    return { erro: NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 }) };
  }

  return { lojaId, mesa };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await autorizar(id);
  if (ctx.erro) return ctx.erro;

  const pessoas = await prisma.tableGuest.findMany({
    where: { tableSessionId: id },
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        select: { id: true, quantity: true, price: true, productName: true, menuProduct: { select: { name: true } } },
      },
    },
  });

  return NextResponse.json({
    guests: pessoas.map((p: any) => ({
      id: p.id,
      name: p.name,
      sortOrder: p.sortOrder,
      // Consumo individual: é o número que vai virar a conta dele no fim.
      total: p.items.reduce((s: number, i: any) => s + (i.price || 0) * (i.quantity || 1), 0),
      itens: p.items.map((i: any) => ({
        id: i.id,
        nome: i.productName || i.menuProduct?.name || "Item",
        quantidade: i.quantity,
        preco: i.price,
      })),
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await autorizar(id);
  if (ctx.erro) return ctx.erro;
  if (ctx.mesa!.status !== "OPEN") {
    return NextResponse.json({ error: "Esta mesa não está aberta." }, { status: 400 });
  }

  const corpo = await req.json().catch(() => ({}));
  const existentes = await prisma.tableGuest.count({ where: { tableSessionId: id } });

  // Duas formas de criar: uma pessoa com nome, ou N pessoas de uma vez.
  // O garçom raramente sabe os nomes — "mesa de 4" é o caso comum, e ele
  // renomeia depois se quiser.
  const quantidade = Number(corpo.quantidade);
  if (Number.isFinite(quantidade) && quantidade > 0) {
    const quantos = Math.min(Math.floor(quantidade), 20);
    const novos = Array.from({ length: quantos }, (_, i) => ({
      tableSessionId: id,
      name: `Cliente ${existentes + i + 1}`,
      sortOrder: existentes + i,
    }));
    await prisma.tableGuest.createMany({ data: novos });
    return NextResponse.json({ criados: quantos });
  }

  const nome = String(corpo.name || "").trim().slice(0, 60);
  const criado = await prisma.tableGuest.create({
    data: {
      tableSessionId: id,
      name: nome || `Cliente ${existentes + 1}`,
      sortOrder: existentes,
    },
  });

  return NextResponse.json({ guest: { id: criado.id, name: criado.name } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await autorizar(id);
  if (ctx.erro) return ctx.erro;

  const { guestId, name } = await req.json().catch(() => ({}));
  const nome = String(name || "").trim().slice(0, 60);
  if (!guestId || !nome) {
    return NextResponse.json({ error: "Informe a pessoa e o novo nome." }, { status: 400 });
  }

  // where com o tableSessionId junto: impede renomear pessoa de outra mesa.
  const alterados = await prisma.tableGuest.updateMany({
    where: { id: guestId, tableSessionId: id },
    data: { name: nome },
  });
  if (alterados.count === 0) {
    return NextResponse.json({ error: "Pessoa não encontrada nesta mesa." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await autorizar(id);
  if (ctx.erro) return ctx.erro;

  const guestId = req.nextUrl.searchParams.get("guestId");
  if (!guestId) return NextResponse.json({ error: "guestId obrigatório" }, { status: 400 });

  const pessoa = await prisma.tableGuest.findFirst({
    where: { id: guestId, tableSessionId: id },
    include: { items: { select: { id: true } } },
  });
  if (!pessoa) return NextResponse.json({ error: "Pessoa não encontrada nesta mesa." }, { status: 404 });

  // Os itens NÃO são apagados junto — o consumo aconteceu e a mesa deve
  // continuar devendo por ele. Eles apenas voltam a ser "da mesa" (sem dono),
  // e entram no rateio geral. Apagar o pedido junto com a pessoa seria sumir
  // com comida que já foi servida.
  await prisma.customerOrderItem.updateMany({
    where: { tableGuestId: guestId },
    data: { tableGuestId: null },
  });
  await prisma.tableGuest.delete({ where: { id: guestId } });

  return NextResponse.json({ success: true, itensLiberados: pessoa.items.length });
}
