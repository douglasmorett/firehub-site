/**
 * POST /api/contingencia/subida — a VOLTA: o computador da loja manda, em
 * lotes e em ordem, o que a loja fez durante a queda (lib/contingencia/
 * subida-no-banco.ts aplica; lib/contingencia/mescla.ts decide linha a linha).
 *
 *   { banco, lote: [{ seq, tabela, registro, operacao, antes, depois }], episodio, final }
 *   → { aplicadoAte, aplicadas, conflitos, recusadas }
 *
 * O computador apaga da saída só até `aplicadoAte`. Se a conexão cair no meio,
 * ele manda de novo e o que já entrou é pulado — nada duplica.
 *
 * A linha que o banco da nuvem não aceita NÃO derruba o lote (era o 500 que
 * prendia a loja na cópia): ela volta em `recusadas` e vira conflito
 * "recusada" no painel. O 500 fica para o que impede a subida inteira
 * (contingência desativada, banco fora, transação vencida).
 */
import { NextRequest, NextResponse } from "next/server";
import { lojaDaChave } from "@/lib/contingencia/servidor";
import { aplicarSubida } from "@/lib/contingencia/subida-no-banco";
import type { LinhaDaSaida } from "@/lib/contingencia/mescla";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const loja = await lojaDaChave(req);
  if (!loja) return NextResponse.json({ error: "Chave inválida" }, { status: 401 });
  const corpo = await req.json().catch(() => null);
  const banco = String(corpo?.banco || "");
  const lote = Array.isArray(corpo?.lote) ? (corpo.lote as LinhaDaSaida[]) : [];
  if (!banco || lote.length > 500) return NextResponse.json({ error: "Lote inválido" }, { status: 400 });
  const episodio =
    corpo?.episodio && typeof corpo.episodio.inicio === "string"
      ? { inicio: String(corpo.episodio.inicio), fim: corpo.episodio.fim ? String(corpo.episodio.fim) : null }
      : null;
  try {
    const r = await aplicarSubida(loja.lojaId, banco, lote, episodio, corpo?.final === true);
    if (r.recusadas.length) {
      console.warn(`[Contingência] Subida da loja ${loja.lojaId}: ${r.recusadas.length} recusada(s) (o resto do lote subiu).`, r.recusadas.slice(0, 5));
    }
    return NextResponse.json(r);
  } catch (e: any) {
    console.error(`[Contingência] Subida da loja ${loja.lojaId} falhou:`, e?.message);
    return NextResponse.json({ error: e?.message || "Falha na subida" }, { status: 500 });
  }
}
