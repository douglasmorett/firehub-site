import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { definirPlanoDoApp, estadoDoApp, PLATAFORMAS, type Plataformas } from "@/lib/app-da-loja/plano";
import { interessesDaLoja } from "@/lib/app-da-loja/solicitacao";
import { gravarLinksDoApp, lerLinksDoApp } from "@/lib/app-da-loja/links";

/**
 * Ativação MANUAL do aplicativo próprio da loja (lib/app-da-loja/plano.ts).
 * GET  ?userId= — o plano da loja e os cliques em "quero o meu aplicativo".
 * POST { userId, plataformas: "android" | "apple" | "ambos" | null } — liga,
 *      troca ou desliga (null). Entra no boleto da mensalidade no fechamento.
 * POST { userId, links: { android, ios } } — os links do app nas lojas: com o
 *      plano ligado, o site da loja convida para baixar (lib/app-da-loja/links.ts).
 * Só ADMIN.
 */
async function admin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const me = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true, email: true } });
  return me?.role === "ADMIN" ? me : null;
}

export async function GET(req: Request) {
  if (!(await admin())) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  const userId = new URL(req.url).searchParams.get("userId") || "";
  if (!userId) return NextResponse.json({ error: "Loja não informada" }, { status: 400 });
  const [plano, interesses, links] = await Promise.all([estadoDoApp(userId), interessesDaLoja(userId), lerLinksDoApp(userId)]);
  return NextResponse.json({ plano, interesses, links });
}

export async function POST(req: Request) {
  const me = await admin();
  if (!me) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId || "");
  const plataformas = body.plataformas === null ? null : String(body.plataformas || "");
  if (!userId) return NextResponse.json({ error: "Loja não informada" }, { status: 400 });
  if (body.links && typeof body.links === "object") {
    try {
      return NextResponse.json({ links: await gravarLinksDoApp(userId, body.links) });
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || "Não deu certo." }, { status: 400 });
    }
  }
  if (plataformas !== null && !PLATAFORMAS.includes(plataformas as Plataformas)) {
    return NextResponse.json({ error: "Plano inválido" }, { status: 400 });
  }
  const loja = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!loja) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  try {
    const plano = await definirPlanoDoApp(userId, plataformas as Plataformas | null, me.email);
    return NextResponse.json({ plano });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Não deu certo." }, { status: 400 });
  }
}
