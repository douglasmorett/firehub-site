/**
 * /api/store/foody/pedido/[id] — a entrega da Foody/Voe de UM pedido, para o
 * cartão "Chamar motoboy" do painel (components/customer/FoodyNoPedido.tsx).
 *
 *   GET                           { ligada, pode, motivo, entrega }
 *   POST { acao: "chamar" }       cria a entrega (idempotente: devolve a que já existe)
 *   POST { acao: "cancelar" }     cancela na Foody (só enquanto open/ready)
 *
 * Qualquer pessoa da loja chama (é o trabalho do balcão); o pedido tem de ser
 * da loja de quem pede.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { podeIrParaFoody } from "@/lib/foody-delivery";
import { chamarFoody, configDaFoody, entregaDoPedido, entregaParaTela, mudarStatusNaFoody } from "@/lib/foody-no-banco";

export const dynamic = "force-dynamic";

async function lojaDeQuemPede() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
  return user ? user.ownerId || user.id : null;
}

async function pedidoDaLoja(id: string, lojaId: string) {
  return prisma.customerOrder.findFirst({
    where: { id, franchiseeId: lojaId },
    select: {
      id: true, status: true, deliveryType: true, customerAddress: true, source: true, deliveryBy: true,
      ifoodOrderId: true, ifoodDriverName: true, ifoodDriverStatus: true, openDeliveryChannel: true,
      openDeliveryOrderId: true, ifoodPickupCode: true, openDeliveryPickupCode: true,
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const lojaId = await lojaDeQuemPede();
  if (!lojaId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const config = await configDaFoody(lojaId);
  if (!config.conectada) return NextResponse.json({ ligada: false });
  const pedido = await pedidoDaLoja(id, lojaId);
  if (!pedido) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  const pode = podeIrParaFoody(pedido);
  return NextResponse.json({
    ligada: true,
    gatilho: config.gatilho,
    pode: pode.pode,
    motivo: pode.motivo || null,
    entrega: entregaParaTela(await entregaDoPedido(id)),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const lojaId = await lojaDeQuemPede();
  if (!lojaId) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const pedido = await pedidoDaLoja(id, lojaId);
  if (!pedido) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo?.acao || "");

  if (acao === "chamar") {
    const r = await chamarFoody(id, { origem: "MANUAL", lojaId });
    return NextResponse.json(
      { ok: r.ok, erro: r.erro || null, jaExistia: Boolean(r.jaExistia), entrega: entregaParaTela(r.entrega) },
      { status: r.ok ? 200 : 422 },
    );
  }

  if (acao === "cancelar") {
    const r = await mudarStatusNaFoody(id, "cancelled");
    return NextResponse.json(
      { ok: r.ok, erro: r.erro || null, entrega: entregaParaTela(await entregaDoPedido(id)) },
      { status: r.ok ? 200 : 422 },
    );
  }

  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}
