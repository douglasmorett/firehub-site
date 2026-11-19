/**
 * GET /api/cron/roteirizacao-automatica — a cada 20 s (scripts/cron-runner.js):
 * a Rota 100% automatizada de cada loja que ligou o interruptor.
 *
 * Para cada loja com `deliveryConfig.roteirizacaoAutomatica.ativo = true` E o
 * módulo ligado pela assinatura (lib/roteirizacao-automatica/assinatura.ts —
 * trecho ligado agora, ou loja isenta; desde a Fase 4, 05/11/2026, o módulo é
 * pago e vale para qualquer loja: o JSON sozinho não liga nada), um ciclo de
 * `rodarRoteirizacaoDaLoja(loja, { gravar: true })`: cria a rota dos pedidos
 * que vão juntos, acrescenta em rota aberta, tira o cancelado e apaga a rota
 * AUTO que ficou vazia; desde a Fase 2, chama o motoboy da rota pronta (push
 * ROTA_PRONTA) e fecha a rota cujos pedidos saíram um a um.
 *
 * A regra e a assinatura saem numa consulta só, para todas as lojas
 * (`lojasComARotaAutomaticaLigada`, LEFT JOIN): nenhuma consulta a mais por
 * loja por ciclo. O desligamento marcado para a virada do mês vale sozinho
 * (os trechos decidem), sem outro cron.
 *
 * A loja de demonstração NÃO é pulada (§4.6): é nela que o simulador ensaia.
 *
 * Sem loja ligada: uma consulta e volta — custo zero.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { lojasComARotaAutomaticaLigada } from "@/lib/roteirizacao-automatica/assinatura";
import { rodarRoteirizacaoDaLoja } from "@/lib/roteirizacao-automatica/executar";

export const dynamic = "force-dynamic";
export const maxDuration = 55;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const lojas = await lojasComARotaAutomaticaLigada();

  let acoes = 0;
  const falhas: string[] = [];
  // Uma loja por vez: cada ciclo tem a sua vez no banco (executar.ts) — em
  // paralelo não ganharia nada.
  for (const lojaId of lojas) {
    try {
      // A assinatura já foi conferida na consulta acima: o ciclo não lê de novo.
      const r = await rodarRoteirizacaoDaLoja(lojaId, { gravar: true, ligadaPelaAssinatura: true });
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
