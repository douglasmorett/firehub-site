/**
 * POST /api/tablet-mesa/parear { codigo, modelo? }
 *
 * O tablet digita o número de 6 dígitos que o dono gerou no painel
 * (lib/tablet-da-mesa/tablets.ts). Acertou: ganha o cookie do tablet e passa a
 * abrir o cardápio daquela mesa. Trava de tentativas por IP (o número é curto).
 */
import { NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { tabletEstaLigado } from "@/lib/tablet-da-mesa/assinatura";
import { COOKIE_DO_TABLET, apagarTablet, parearTablet } from "@/lib/tablet-da-mesa/tablets";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!checkRateLimit(`tablet-parear:${getClientIp(req)}`, { windowMs: 10 * 60_000, maxRequests: 12 }).allowed) {
    return NextResponse.json({ error: "Muitas tentativas. Espere alguns minutos." }, { status: 429 });
  }
  const corpo: any = await req.json().catch(() => ({}));
  const codigo = String(corpo?.codigo || "").replace(/\D/g, "");
  const modelo = typeof corpo?.modelo === "string" ? corpo.modelo : (req.headers.get("user-agent") || null);
  const r = await parearTablet(codigo, modelo);
  if (!r) return NextResponse.json({ error: "Código errado ou vencido. Gere outro no painel, em Tablet na mesa." }, { status: 404 });
  if (!(await tabletEstaLigado(r.lojaId))) {
    await apagarTablet(r.lojaId, r.tabletId);
    return NextResponse.json({ error: "O Tablet na mesa está desligado nesta loja." }, { status: 409 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_DO_TABLET, r.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
  return res;
}
