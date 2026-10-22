/**
 * GET /api/cron/roteirizacao-automatica — a cada 20 s (scripts/cron-runner.js):
 * a Rota 100% automatizada de cada loja que ligou o interruptor.
 *
 * Para cada loja com `deliveryConfig.roteirizacaoAutomatica.ativo = true` E na
 * liberação (lib/roteirizacao-automatica/liberacao.ts — hoje a Hakim Centro e
 * a loja de demonstração; o JSON sozinho não liga nada), um ciclo de
 * `rodarRoteirizacaoDaLoja(loja, { gravar: true })`: cria a rota dos pedidos
 * que vão juntos, acrescenta em rota aberta, tira o cancelado e apaga a rota
 * AUTO que ficou vazia; desde a Fase 2, chama o motoboy da rota pronta (push
 * ROTA_PRONTA) e fecha a rota cujos pedidos saíram um a um.
 *
 * A loja de demonstração NÃO é pulada (§4.6): é nela que o simulador ensaia.
 *
 * Sem loja ligada: uma consulta e volta — custo zero.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { liberadaPara } from "@/lib/roteirizacao-automatica/liberacao";
import { rodarRoteirizacaoDaLoja } from "@/lib/roteirizacao-automatica/executar";

export const dynamic = "force-dynamic";
export const maxDuration = 55;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Pelo JSON, no banco: lojas sem a chave nem chegam ao Node.
  const ligadas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User"
    WHERE "deliveryConfig"->'roteirizacaoAutomatica'->>'ativo' = 'true'
  `;
  const lojas = ligadas.map((l) => l.id).filter((id) => liberadaPara(id));

  let acoes = 0;
  const falhas: string[] = [];
  // Uma loja por vez: são poucas (a liberação), e cada ciclo tem a sua vez
  // no banco (executar.ts) — em paralelo não ganharia nada.
  for (const lojaId of lojas) {
    try {
      const r = await rodarRoteirizacaoDaLoja(lojaId, { gravar: true });
      acoes += r.aplicadas?.length ?? 0;
      if (r.falhas?.length) falhas.push(`${lojaId}: ${r.falhas.length} falha(s)`);
    } catch (e: any) {
      // Uma loja que falha não segura as outras.
      console.error(`[rota-automatica] loja ${lojaId} falhou:`, e?.message || e);
      falhas.push(`${lojaId}: ${String(e?.message || e).slice(0, 120)}`);
    }
  }

  return NextResponse.json({ lojas: lojas.length, acoes, ...(falhas.length > 0 ? { falhas } : {}) });
}
