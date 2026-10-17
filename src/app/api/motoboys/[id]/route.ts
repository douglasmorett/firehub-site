import { NextResponse } from "next/server";
import { lerFaixasDoMotoboy } from "@/lib/faixas-do-motoboy";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { hashDeSenha } from "@/lib/motoboy-senha";
import { renomearNoFiado, tirarDoFiado } from "@/lib/fiado-do-motoboy";
import { pedidoDeAppDoCorpo } from "@/lib/repasse-do-entregador";
import { gravarPedidoDeApp } from "@/lib/pedido-de-app-no-banco";

// PUT - atualizar motoboy
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;

  const existing = await prisma.motoboy.findFirst({
    where: { id, franchiseeId: targetFranchiseeId },
  });
  if (!existing) return NextResponse.json({ error: "Motoboy não encontrado" }, { status: 404 });

  const body = await req.json();
  const { name, phone, password, paymentType, dailyRate, perDeliveryRate, perKmRate, faixasDeKm, notes, active, modeloDePagamento } = body;

  // "Pagar diferente nos pedidos de app" (lib/repasse-do-entregador.ts). Por
  // presença, como o resto: a tela só manda quando a pessoa mexeu na seção —
  // salvar o nome não transforma a regra antiga da loja em escolha dele.
  const app = pedidoDeAppDoCorpo(body.pedidoDeApp);
  if (app.acao === "recusar") return NextResponse.json({ error: app.erro }, { status: 400 });
  if (app.acao === "gravar") await gravarPedidoDeApp(id, app.escolha);

  const motoboy = await prisma.motoboy.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(phone !== undefined && { phone: phone?.trim() || null }),
      // Campo em branco significa "não mexer na senha", não "voltar para a
      // padrão". Do jeito anterior, salvar qualquer outro dado do cadastro com o
      // campo vazio rebaixava a senha do entregador para 123456 sem avisar
      // ninguém — inclusive a de quem já tinha trocado.
      ...(password?.trim() ? { password: await hashDeSenha(password.trim()) } : {}),
      ...(paymentType !== undefined && { paymentType }),
      ...(dailyRate !== undefined && { dailyRate: dailyRate ? Number(dailyRate) : null }),
      ...(perDeliveryRate !== undefined && { perDeliveryRate: perDeliveryRate ? Number(perDeliveryRate) : null }),
      ...(perKmRate !== undefined && { perKmRate: perKmRate ? Number(perKmRate) : null }),
      // Só mexe quando a tela mandou o campo — atualização por presença, como
      // o resto desta rota.
      ...(faixasDeKm !== undefined && { faixasDeKm: lerFaixasDoMotoboy(faixasDeKm) }),
      ...(modeloDePagamento !== undefined && { modeloDePagamento: modeloDePagamento?.trim() || null }),
      ...(notes !== undefined && { notes: notes?.trim() || null }),
      ...(active !== undefined && { active }),
    },
  });

  // O fiado espelha a equipe (lib/fiado-do-motoboy.ts). Pausar não tira do
  // fiado — só excluir.
  await renomearNoFiado(existing, motoboy);

  // A escolha gravada volta na resposta mesmo com um cliente do Prisma de
  // antes da coluna (lib/pedido-de-app-no-banco.ts).
  const pedidoDeApp = app.acao === "gravar" ? app.escolha : ((motoboy as any).pedidoDeApp ?? null);
  return NextResponse.json({ ...motoboy, pedidoDeApp, password: undefined });
}

// DELETE - remover motoboy
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;

  const existing = await prisma.motoboy.findFirst({
    where: { id, franchiseeId: targetFranchiseeId },
  });
  if (!existing) return NextResponse.json({ error: "Motoboy não encontrado" }, { status: 404 });

  await prisma.motoboy.delete({ where: { id } });
  // Saiu da equipe, sai do fiado (o histórico fica) — lib/fiado-do-motoboy.ts.
  await tirarDoFiado(existing);
  return NextResponse.json({ success: true });
}
