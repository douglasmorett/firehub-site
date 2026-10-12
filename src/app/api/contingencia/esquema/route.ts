/**
 * GET /api/contingencia/esquema — o esquema do banco da nuvem, para o
 * computador da loja montar o dele igual (Modo Contingência). Com a chave da
 * loja (lib/contingencia/servidor.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { esquemaDoBanco, lojaDaChave } from "@/lib/contingencia/servidor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const loja = await lojaDaChave(req);
  if (!loja) return NextResponse.json({ error: "Chave inválida" }, { status: 401 });
  return NextResponse.json(await esquemaDoBanco());
}
