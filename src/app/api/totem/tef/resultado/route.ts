/**
 * POST /api/totem/tef/resultado — o motor TEF do Assistente (computador do
 * totem, pinpad PayGo) conta como terminou a transação.
 *
 * Autenticação: `Authorization: Bearer <chave do pareamento TEF>` (nasce em
 * /api/store/totem/tef, guardada só em hash — lib/tef-do-totem.ts).
 *
 * Resposta: `acao` = CONFIRMAR | DESFAZER | NADA. O motor só manda a
 * confirmação (CNF) à PayGo com status 200 E acao CONFIRMAR; erro de rede ou
 * 5xx = mantém a transação pendente em disco e tenta de novo. Idempotente:
 * o reenvio da mesma transação devolve CONFIRMAR sem efeito novo.
 */
import { NextRequest, NextResponse } from "next/server";
import { licencaDaChaveTef, registrarResultadoTef } from "@/lib/tef-do-totem";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const licenca = await licencaDaChaveTef(req.headers.get("authorization"));
    if (!licenca) {
      return NextResponse.json({ error: "Chave do TEF inválida. Pareie o Assistente de novo no painel, em Totem.", code: "CHAVE_TEF_INVALIDA" }, { status: 401 });
    }
    const corpo = await req.json().catch(() => null);
    if (!corpo || typeof corpo !== "object") return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
    const r = await registrarResultadoTef(licenca, corpo);
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (err) {
    console.error("[TEF Resultado] Erro:", err);
    // 500 NUNCA traz `acao`: o motor mantém pendente e pergunta de novo.
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
