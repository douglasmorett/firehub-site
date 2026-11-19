import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Variante } from "@/lib/black-november";
import { cobrarAnual, ErroDaBlackNovember, registrarNaJanela, previaDaBlackNovember, situacaoDaBlackNovember } from "@/lib/black-november-no-banco";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * /api/store/black-november — a janela da Black November no painel
 * (components/customer/BlackNovember.tsx, regra em lib/black-november.ts).
 *
 * GET: a janela aparece? e com qual copy (teto/fixo).
 * POST { acao: "exibiu" | "fechou" | "nao-ver-mais" }: a janela abriu (conta
 *   o dia: no máximo 1 vez por dia), fechou por agora, ou não quer ver mais.
 * POST { acao: "cobrar", forma: "cartao" | "pix" }: gera a cobrança no Asaas
 *   do FireHub e devolve o invoiceUrl.
 *
 * Só o dono (conta sem ownerId, role FRANCHISEE) e nunca pelo "Acessar" do
 * admin: o suporte abrindo a loja não pode gastar a janela do dono.
 */
async function sessao() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;
  return { email, acessoDoSuporte: !!(session.user as any)?.impersonatedBy };
}

const variantePedida = (v: string | null): Variante | null => (v === "teto" || v === "fixo" ? v : null);

export async function GET(req: NextRequest) {
  const s = await sessao();
  if (!s) return NextResponse.json({ mostrar: false }, { status: 401 });
  try {
    // ?variante= só vale na prévia (PREVIEW_BLACK_NOVEMBER=1).
    const forcar = previaDaBlackNovember() ? variantePedida(req.nextUrl.searchParams.get("variante")) : null;
    return NextResponse.json(await situacaoDaBlackNovember(s, forcar));
  } catch (err: any) {
    console.error(`[Black November] GET falhou: ${err?.message}`);
    return NextResponse.json({ mostrar: false });
  }
}

export async function POST(req: NextRequest) {
  const s = await sessao();
  if (!s) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const loja = await prisma.user.findUnique({ where: { email: s.email }, select: { id: true, ownerId: true, role: true } });
  if (!loja || loja.ownerId || String(loja.role).toUpperCase() !== "FRANCHISEE") {
    return NextResponse.json({ error: "Só o dono da loja contrata o plano." }, { status: 403 });
  }
  if (s.acessoDoSuporte && !previaDaBlackNovember()) {
    return NextResponse.json({ error: "Acesso do suporte: a janela é do dono da loja." }, { status: 403 });
  }
  const variante = variantePedida(corpo?.variante ?? null);

  if (corpo?.acao === "exibiu" || corpo?.acao === "fechou" || corpo?.acao === "nao-ver-mais") {
    await registrarNaJanela(loja.id, corpo.acao, variante);
    return NextResponse.json({ ok: true });
  }

  if (corpo?.acao === "cobrar" && (corpo.forma === "cartao" || corpo.forma === "pix")) {
    await registrarNaJanela(loja.id, corpo.forma, variante);
    try {
      return NextResponse.json({ ok: true, ...(await cobrarAnual(loja.id, corpo.forma)) });
    } catch (err: any) {
      if (err instanceof ErroDaBlackNovember) return NextResponse.json({ ok: false, error: err.message }, { status: 422 });
      console.error(`[Black November] Cobrança falhou na loja ${loja.id}: ${err?.message}`);
      return NextResponse.json({ ok: false, error: "Não deu para gerar a cobrança agora. Fale com a gente no WhatsApp." }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
}
