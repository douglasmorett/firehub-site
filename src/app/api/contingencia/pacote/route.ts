/**
 * GET /api/contingencia/pacote — a lista ASSINADA dos arquivos desta versão
 * (lib/contingencia/pacote.ts): `{ conteudo, assinatura }`. O Assistente
 * confere a assinatura sobre os bytes de `conteudo` antes de usar a lista.
 * Com a chave da loja: só computador ativado baixa o FireHub.
 */
import { NextRequest, NextResponse } from "next/server";
import { lojaDaChave } from "@/lib/contingencia/servidor";
import { pacoteDaVersao } from "@/lib/contingencia/pacote";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const loja = await lojaDaChave(req);
  if (!loja) return NextResponse.json({ error: "Chave inválida" }, { status: 401 });
  const pacote = pacoteDaVersao();
  if (!pacote) return NextResponse.json({ error: "Esta versão do FireHub não tem o pacote da contingência." }, { status: 503 });
  return NextResponse.json(pacote.assinado);
}
