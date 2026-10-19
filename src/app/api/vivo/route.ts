/**
 * GET /api/vivo — o processo está de pé e atende. Nada além disso.
 *
 * Para o BALANCEADOR: ele pergunta a cada poucos segundos em cada instância e
 * tira da roda a que não responder. Não toca no banco de propósito: com o
 * Neon fora, as DUAS instâncias falhariam juntas no /api/health, e o
 * balanceador tiraria as duas — o site inteiro fora por um problema que
 * nenhuma delas resolve trocando de lugar. O /api/health (banco, memória,
 * esquema) fica para o Coolify e o monitor.
 */
import { NextResponse } from "next/server";
import { instancia, shaDaVersao } from "@/lib/instancia";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { ok: true, instancia: instancia().id, sha: shaDaVersao() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
