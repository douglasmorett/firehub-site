/**
 * GET  /api/store/avisos              → cancelamentos, disputas e cancelamentos
 *                                       parciais do dia em aberto
 * POST /api/store/avisos { ciente: [], cienteParcial: [{ id, registros }] }
 *                                     → "Ciente" nos cancelamentos e nos cortes
 *
 * Consultado em loop pelo AvisosDoDia (components/customer), montado SÓ na tela
 * de pedidos — no KDS e nas outras telas o aviso não aparece (dono, 25/09/2026).
 * A regra do que é aviso mora em lib/avisos-do-dia.ts.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FUSO_PADRAO } from "@/lib/fuso";
import { avisosDoDia, marcarCiente, marcarCienteParcial } from "@/lib/avisos-do-dia";
import { lembrarPor } from "@/lib/cache-curto";
import { lerEnquantoNadaMuda } from "@/lib/novidade-da-loja";

export const dynamic = "force-dynamic";

/** As lojas desta conta — o mesmo recorte do feed de pedidos (customer-order/poll). */
async function lojasDaSessao() {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email || "";
  if (!email) return null;
  // 15 s em memória: esta rota roda a cada 8 s por aba (lib/cache-curto.ts).
  const user = await lembrarPor(`avisos:usuario:${email}`, 15_000, () =>
    prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, name: true } }));
  if (!user) return null;
  const lojaId = user.ownerId || user.id;
  const ids = [...new Set([lojaId, user.id, user.ownerId].filter(Boolean))] as string[];
  return { lojaId, ids, quem: session?.user?.name || user.name || email };
}

export async function GET() {
  const s = await lojasDaSessao();
  if (!s) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const loja = await lembrarPor(`avisos:fuso:${s.lojaId}`, 60_000, () =>
    prisma.user.findUnique({ where: { id: s.lojaId }, select: { storeTimezone: true } }));
  const fuso = loja?.storeTimezone || FUSO_PADRAO;
  try {
    // A lista só muda com gravação de pedido destas lojas (lib/novidade-da-loja.ts).
    const [avisos, parceiroInstavel] = await Promise.all([
      lerEnquantoNadaMuda(`avisos:${s.ids.join(",")}|${fuso}`, s.ids, () => avisosDoDia(s.ids, fuso)),
      // JotaJá fora do ar (lib/jotaja-instavel.ts): faixa no painel de pedidos. 30 s em memória.
      lembrarPor(`avisos:parceiro:${s.lojaId}`, 30_000, () =>
        import("@/lib/jotaja-instavel").then((m) => m.parceiroInstavel(s.lojaId)).catch(() => null)),
    ]);
    return NextResponse.json({ ...avisos, parceiroInstavel });
  } catch (e: any) {
    // Coluna ainda não criada (boot que falhou) ou banco fora: sem aviso, mas
    // sem 500 em loop no console da loja a cada poucos segundos.
    console.error("[Avisos] Não consegui listar os avisos do dia:", e?.message);
    return NextResponse.json({ cancelamentos: [], disputas: [], parciais: [], erro: true });
  }
}

export async function POST(req: Request) {
  const s = await lojasDaSessao();
  if (!s) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({} as any));
  const ids = Array.isArray(body?.ciente) ? body.ciente : [];
  const parciais = Array.isArray(body?.cienteParcial) ? body.cienteParcial : [];
  const marcados = ids.length ? await marcarCiente(s.ids, ids, s.quem) : 0;
  const marcadosParciais = parciais.length ? await marcarCienteParcial(s.ids, parciais, s.quem) : 0;
  return NextResponse.json({ ok: true, marcados, marcadosParciais });
}
