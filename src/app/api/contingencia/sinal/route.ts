/**
 * GET /api/contingencia/sinal — "a nuvem está de pé?" (Modo Contingência).
 *
 * O computador da loja pergunta a cada poucos segundos, e a tela que está no
 * computador da loja durante uma queda pergunta para saber quando voltar.
 * Leve de propósito (o /api/health faz checagens que levam segundos): só
 * confere que o banco responde. CORS aberto: quem pergunta é uma página em
 * http://<ip-do-computador>, que não é este domínio.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "cache-control": "no-store",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, falha) => setTimeout(() => falha(new Error("banco demorou")), 4000)),
    ]);
    return NextResponse.json({ ok: true, em: new Date().toISOString() }, { headers: CORS });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: CORS });
  }
}
