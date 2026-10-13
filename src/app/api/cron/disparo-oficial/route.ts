import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { atualizarModelosPendentes, conferirRecargasPendentes, processarFila, renovarTokens, rodarRecuperacao } from "@/lib/disparo-oficial/servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A cada minuto (scripts/cron-runner.js): manda a fila das campanhas do
 * Disparo oficial (~45 s por rodada, ~14 mensagens por segundo), devolve o
 * crédito do que expirou e confere no Asaas as recargas que o webhook não
 * avisou. Sem campanha nem recarga pendente, são três consultas e acabou.
 */
let rodando = false;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (rodando) return NextResponse.json({ ok: true, pulou: "rodada anterior ainda enviando" });
  rodando = true;
  try {
    // A recuperação automática (7, 15 e 30 dias) monta as campanhas do dia
    // antes da fila, para elas já saírem nesta rodada.
    const automaticas = await rodarRecuperacao().catch((e) => {
      console.error(`[Disparo oficial] Recuperação automática: ${e?.message}`);
      return 0;
    });
    const fila = await processarFila();
    const pagas = await conferirRecargasPendentes().catch(() => 0);
    await atualizarModelosPendentes().catch(() => {});
    const tokensRenovados = await renovarTokens().catch(() => 0);
    return NextResponse.json({ ok: true, ...fila, automaticas, recargasPagas: pagas, tokensRenovados });
  } catch (err: any) {
    console.error(`[Disparo oficial] Cron falhou: ${err?.message}`);
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  } finally {
    rodando = false;
  }
}
