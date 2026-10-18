/**
 * Quem pode ver o perfil das lojas pelo portal: o VENDEDOR logado (conta de
 * embaixador com isVendedor, mesmo login do /embaixador — lib/vendedores.ts),
 * ativo. O id da sessão é o do Ambassador, como em api/vendedor/clientes.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function vendedorDaSessao(): Promise<{ ok: true; id: string } | { ok: false; resposta: NextResponse }> {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  if (!user || user.role !== "AMBASSADOR" || !user.id) {
    return { ok: false, resposta: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  const v = await prisma.ambassador.findUnique({ where: { id: user.id }, select: { id: true, isVendedor: true, active: true } });
  if (!v || !v.isVendedor) return { ok: false, resposta: NextResponse.json({ error: "Sua conta não é de vendedor." }, { status: 403 }) };
  if (!v.active) return { ok: false, resposta: NextResponse.json({ error: "Sua conta de vendedor está pausada." }, { status: 403 }) };
  return { ok: true, id: v.id };
}
