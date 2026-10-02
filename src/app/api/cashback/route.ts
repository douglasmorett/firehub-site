/**
 * FireHub — saldo de cashback de um cliente NA LOJA de quem consulta.
 *
 * GET /api/cashback?phone=xx → { saldo, taxa, proximoVencimento } ou { saldo: 0 }
 *
 * O saldo é calculado dos pedidos da loja (lib/cashback.ts). O antigo POST
 * desta rota somava e tirava saldo de um contador GLOBAL (um por telefone,
 * para todas as lojas) e aceitava qualquer sessão: um lojista podia dar ou
 * tirar saldo do cliente de outra loja. Nada o chamava; saiu. Crédito e uso
 * agora só acontecem no pedido (/api/customer-order).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { cashbackDoCliente } from "@/lib/cashback-no-banco";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const phone = String(req.nextUrl.searchParams.get("phone") || "").replace(/\D/g, "");
  if (phone.length < 8) return NextResponse.json({ error: "phone obrigatório" }, { status: 400 });

  // A loja é a do DONO (`ownerId || id`): funcionário consulta a loja dele.
  const usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!usuario) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const lojaId = usuario.ownerId || usuario.id;
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeLoyalty: true } });

  const cashback = await cashbackDoCliente(lojaId, loja?.storeLoyalty, phone);
  return NextResponse.json(cashback ?? { saldo: 0, taxa: 0, proximoVencimento: null });
}
