/**
 * GET /api/store-settings/aceite-automatico → { ligado }
 *
 * O "Aceitar automático" da LOJA (`User.autoAcceptOrders`), que é o que vale:
 * o site aceita o pedido na hora por ele (api/customer-order) e o painel de
 * pedidos de todo aparelho segue o mesmo valor. O painel consulta isto em
 * loop para o PC da loja saber que o dono desligou pelo celular.
 *
 * Serpa Pizzaria (09/10/2026): o botão vivia no localStorage de cada
 * navegador e não era por loja — o celular mostrava DESLIGADO, o PC (ou
 * qualquer navegador que um dia ligou o aceite, para qualquer loja) seguia
 * aceitando, e ainda regravava "ligado" na loja toda vez que o painel abria.
 * Gravar continua sendo o PUT de /api/store-settings.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email || "";
  if (!email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const quem = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true } });
  if (!quem) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const loja = await prisma.user.findUnique({ where: { id: quem.ownerId || quem.id }, select: { autoAcceptOrders: true } });
  return NextResponse.json({ ligado: loja?.autoAcceptOrders === true });
}
