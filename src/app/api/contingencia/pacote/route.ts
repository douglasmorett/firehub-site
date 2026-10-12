/**
 * GET /api/contingencia/pacote — a lista dos arquivos desta versão, por hash
 * (lib/contingencia/pacote.ts). Com a chave da loja: só computador ativado
 * baixa o FireHub.
 */
import { NextRequest, NextResponse } from "next/server";
import { lojaDaChave } from "@/lib/contingencia/servidor";
import { pacoteDaVersao } from "@/lib/contingencia/pacote";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const loja = await lojaDaChave(req);
  if (!loja) return NextResponse.json({ error: "Chave inválida" }, { status: 401 });
  return NextResponse.json(pacoteDaVersao().pacote);
}
