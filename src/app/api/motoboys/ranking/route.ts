/**
 * GET /api/motoboys/ranking?periodo=hoje|7d|30d — o ranking da equipe no app
 * do entregador (lib/relatorios/ranking-de-entregadores.ts, a MESMA conta da
 * tela Motoboys › Ranking).
 *
 * Só aparece se a loja ligou (appMotoboyConfig.rankingNoApp, padrão
 * desligado — Douglas, 24/10/2026). Desligado responde 200 com
 * `{ ativo: false }`: o app esconde a aba, sem tela de erro.
 *
 * A guarda é a do "Meu relatório" (api/motoboys/relatorio): sessão assinada
 * do app ou o par motoboy + loja, com o motoboy ATIVO. Nada de dinheiro aqui:
 * só entregas, tempos e o score.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lerAppMotoboyConfig } from "@/lib/app-motoboy-config";
import { lerRankingDeEntregadores } from "@/lib/relatorios/ranking-de-entregadores-banco";
import { PESOS } from "@/lib/relatorios/ranking-de-entregadores";
import { hojeNaLoja, periodoDoAtalho } from "@/lib/relatorios/base";
import { janelaDoPeriodo } from "@/lib/relatorios/janela";
import { anotarUsoLegado } from "@/lib/uso-legado";

export const dynamic = "force-dynamic";

const PERIODOS = { hoje: "hoje", "7d": "7d", "30d": "30d" } as const;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const { temSessaoAssinada, exigirMotoboy } = await import("@/lib/motoboy-sessao");
    const daSessao = temSessaoAssinada(req) ? await exigirMotoboy(req) : null;
    if (temSessaoAssinada(req) && !daSessao) {
      return NextResponse.json({ error: "Sessão expirada. Entre de novo.", precisaLogin: true, precisaRelogar: true }, { status: 401 });
    }
    const motoboyId = daSessao?.id ?? sp.get("motoboyId");
    const storeId = daSessao?.franchiseeId ?? sp.get("storeId");
    if (!motoboyId || !storeId) return NextResponse.json({ error: "motoboyId e storeId são obrigatórios" }, { status: 400 });

    const motoboy = await prisma.motoboy.findFirst({ where: { id: motoboyId, franchiseeId: storeId, active: true }, select: { id: true } });
    if (!motoboy) return NextResponse.json({ error: "Acesso encerrado. Fale com a loja.", precisaRelogar: true }, { status: 401 });
    // Par solto da URL (sem sessão assinada): contado para a fase 2 (lib/uso-legado.ts).
    if (!daSessao) anotarUsoLegado("motoboy-sem-sessao", storeId, "ranking GET");

    const loja = await prisma.user.findUnique({ where: { id: storeId }, select: { storeTimezone: true, appMotoboyConfig: true } });
    if (!lerAppMotoboyConfig(loja?.appMotoboyConfig).rankingNoApp) return NextResponse.json({ ativo: false });
    // A barra de abas do app só pergunta se a aba aparece: sem montar o ranking.
    if (sp.get("so") === "ativo") return NextResponse.json({ ativo: true });

    const tz = loja?.storeTimezone || "America/Sao_Paulo";
    const chave = PERIODOS[(sp.get("periodo") || "7d") as keyof typeof PERIODOS] || "7d";
    const periodo = periodoDoAtalho(chave, hojeNaLoja(tz));
    const ranking = await lerRankingDeEntregadores([storeId], janelaDoPeriodo(periodo.de, periodo.ate, tz), tz);

    return NextResponse.json({ ativo: true, periodo, voce: motoboyId, pesos: PESOS, ...ranking });
  } catch (e: any) {
    console.error("[Ranking no app]", e?.message?.slice(0, 200));
    return NextResponse.json({ error: "Não consegui montar o ranking agora." }, { status: 500 });
  }
}
