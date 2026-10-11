/**
 * POST /api/integracoes/firecheck/descarte  (Authorization: Bearer <chave da ligação>)
 *   { idExterno, loja, item, quantidade, unidade, valorEstimado, motivo, funcionario, registradoEm, foto }
 *
 * Chamado pelo servidor do FireCheck a cada descarte lançado na loja ligada.
 * Vira perda no estoque (lib/cmv/firecheck.ts). Repetir o mesmo idExterno
 * devolve 200 com `repetido: true` sem baixar de novo: o FireCheck reenvia o
 * que falhou, e para ele 200 quer dizer "chegou".
 */
import { NextRequest, NextResponse } from "next/server";
import { lerDescarte, lojaDaChave, registrarDescarte } from "@/lib/cmv/firecheck";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const loja = await lojaDaChave(req.headers.get("authorization"));
  if (!loja) return NextResponse.json({ error: "Chave inválida: este FireCheck não está conectado a nenhuma loja do FireHub." }, { status: 401 });
  const d = lerDescarte(await req.json().catch(() => null));
  if (typeof d === "string") return NextResponse.json({ error: d }, { status: 400 });
  try {
    const r = await registrarDescarte(loja, d);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("[FireCheck] descarte não registrado:", loja.id, d.idExterno, e);
    return NextResponse.json({ error: "Falha ao registrar o descarte" }, { status: 500 });
  }
}
