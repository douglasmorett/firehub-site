/**
 * POST /api/contingencia/entrar — SÓ no computador da loja (FIREHUB_LOCAL=1).
 *
 * A tela chegou aqui com o bilhete que guardou enquanto havia internet
 * (lib/contingencia/chave.ts). Bilhete bom = a sessão abre sem senha: a do
 * painel com o mesmo token que o login da nuvem faria, a do garçom com o
 * cookie do garçom. A senha do painel não desce para o computador; é o
 * bilhete que deixa entrar.
 *
 * O segredo do bilhete e a loja vêm do supervisor da contingência, por
 * ambiente (CONTINGENCIA_SEGREDO_DO_BILHETE, CONTINGENCIA_LOJA).
 */
import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { MODO_LOCAL } from "@/lib/modo-local";
import { lerBilhete } from "@/lib/contingencia/chave";
import { identidadeDaLoja } from "@/lib/paineis-do-dono";
import { COOKIE_DO_GARCOM, emitirTokenDoGarcom, opcoesDoCookieDoGarcom } from "@/lib/garcom-auth";

export const dynamic = "force-dynamic";

/** Sessão aberta pelo bilhete: um dia basta para atravessar a queda. */
const DURACAO_S = 24 * 60 * 60;

export async function POST(req: NextRequest) {
  if (!MODO_LOCAL) return NextResponse.json({ error: "Só no computador da loja." }, { status: 404 });
  const { bilhete } = await req.json().catch(() => ({ bilhete: "" }));
  const segredo = process.env.CONTINGENCIA_SEGREDO_DO_BILHETE || "";
  const loja = process.env.CONTINGENCIA_LOJA || "";
  const lido = lerBilhete(String(bilhete || ""), segredo, loja);
  if (!lido) return NextResponse.json({ error: "Bilhete inválido ou vencido." }, { status: 401 });

  if (lido.tipo === "painel") {
    const usuario = await prisma.user.findFirst({
      where: { email: { equals: lido.email!, mode: "insensitive" } },
      select: { id: true, name: true, email: true, role: true, city: true, storeName: true, permissions: true, ownerId: true },
    });
    if (!usuario || (usuario.ownerId || usuario.id) !== loja) {
      return NextResponse.json({ error: "Conta fora da cópia desta loja." }, { status: 401 });
    }
    const identidade = identidadeDaLoja(usuario as any, { loja: usuario.id } as any);
    const token = await encode({
      token: {
        name: identidade.name,
        email: identidade.email,
        sub: identidade.id,
        id: identidade.id,
        role: identidade.role,
        city: identidade.city,
        storeName: identidade.storeName,
        permissions: identidade.permissions,
        impersonatedBy: null,
        papeis: identidade.papeis,
      } as any,
      secret: process.env.NEXTAUTH_SECRET!,
      maxAge: DURACAO_S,
    });
    const res = NextResponse.json({ ok: true, tipo: "painel" });
    res.cookies.set("next-auth.session-token", token, { httpOnly: true, sameSite: "lax", path: "/", secure: false, maxAge: DURACAO_S });
    return res;
  }

  const garcom = await prisma.waiter.findFirst({ where: { id: lido.garcomId!, franchiseeId: loja }, select: { id: true, franchiseeId: true } });
  if (!garcom) return NextResponse.json({ error: "Garçom fora da cópia desta loja." }, { status: 401 });
  const res = NextResponse.json({ ok: true, tipo: "garcom" });
  res.cookies.set(COOKIE_DO_GARCOM, await emitirTokenDoGarcom(garcom), opcoesDoCookieDoGarcom());
  return res;
}
