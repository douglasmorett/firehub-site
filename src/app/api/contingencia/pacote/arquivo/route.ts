/**
 * GET /api/contingencia/pacote/arquivo?hash=<sha256> — um arquivo do pacote
 * (lib/contingencia/pacote.ts). O Assistente confere o hash do que baixou.
 */
import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { lojaDaChave } from "@/lib/contingencia/servidor";
import { pacoteDaVersao } from "@/lib/contingencia/pacote";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const loja = await lojaDaChave(req);
  if (!loja) return NextResponse.json({ error: "Chave inválida" }, { status: 401 });
  const hash = (req.nextUrl.searchParams.get("hash") || "").toLowerCase();
  const caminho = /^[0-9a-f]{64}$/.test(hash) ? pacoteDaVersao().porHash.get(hash) : undefined;
  if (!caminho) return NextResponse.json({ error: "Arquivo fora do pacote" }, { status: 404 });
  const tamanho = fs.statSync(caminho).size;
  const corpo = Readable.toWeb(fs.createReadStream(caminho)) as ReadableStream;
  return new NextResponse(corpo, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(tamanho),
      "cache-control": "private, max-age=86400, immutable",
    },
  });
}
