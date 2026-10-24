import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { pegarVez } from "@/lib/vez";
import { anotaAiConfigurado } from "@/lib/anotaai/api";
import { cicloDoAnotaAi } from "@/lib/anotaai/eventos";

/**
 * GET /api/cron/anotaai-poll — a cada 30 s (scripts/cron-runner.js).
 *
 * O caminho INTEIRO dos pedidos do Anota AI (lib/anotaai/eventos.ts): a doc
 * deles recomenda ler a lista a cada ~30 s, e o webhook não tem formato nem
 * assinatura documentados. Por loja ligada: a lista do dia e a dos
 * cancelados, a busca só do pedido que muda algo aqui, e depois as ações
 * pendentes (aceite, pronto, finalizar que falharam).
 *
 * Limite do Anota AI: 500 chamadas a cada 10 s por credencial — folgado.
 *
 * Sem ANOTAAI_CLIENT_ID/ANOTAAI_CLIENT_SECRET no servidor: responde na hora,
 * sem tocar no banco.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 55;

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!anotaAiConfigurado()) return NextResponse.json({ ok: true, desligada: true });
  // Com dois containers vivos (deploy, A e B), só um roda esta volta (lib/vez.ts).
  if (!(await pegarVez("job:anotaai-poll", 24_000))) {
    return NextResponse.json({ ok: true, pulada: "outro servidor está nesta volta" });
  }

  try {
    const r = await cicloDoAnotaAi();
    if (r.log.length > 0) console.log(`[Anota AI Poll] ${r.log.join(" | ")}`);
    return NextResponse.json({ ok: true, lojas: r.lojas, log: r.log });
  } catch (e: any) {
    console.error("[Anota AI Poll] ❌", e?.message);
    return NextResponse.json({ ok: false, erro: e?.message || "erro" }, { status: 500 });
  }
}
