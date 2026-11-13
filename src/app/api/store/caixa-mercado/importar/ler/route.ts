/**
 * POST (multipart, `arquivo`) — lê a planilha do PDV antigo (CSV ou XLSX) e
 * devolve as linhas + o mapeamento de colunas sugerido pelo cabeçalho. Não
 * grava nada: a tela mostra a prévia e manda /importar/planilha.
 */
import { NextResponse } from "next/server";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { lerPlanilha } from "@/lib/caixa-mercado/importacao/arquivos";
import { sugerirMapeamento } from "@/lib/caixa-mercado/importacao/planilha";

export const dynamic = "force-dynamic";
const MAX_LINHAS = 30_000;

export async function POST(req: Request) {
  const ctx = await contextoDoCaixa({ tela: "/store/caixa-mercado/importar" });
  if (ehResposta(ctx)) return ctx;
  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!arquivo || typeof arquivo === "string") return NextResponse.json({ error: "Escolha o arquivo da planilha." }, { status: 400 });
  if (arquivo.size > 25 * 1024 * 1024) return NextResponse.json({ error: "Planilha grande demais (máximo 25 MB)." }, { status: 413 });
  try {
    const linhas = lerPlanilha(Buffer.from(await arquivo.arrayBuffer()));
    if (linhas.length < 2) return NextResponse.json({ error: "A planilha está vazia ou só tem o cabeçalho." }, { status: 400 });
    if (linhas.length > MAX_LINHAS) return NextResponse.json({ error: `A planilha tem mais de ${MAX_LINHAS} linhas. Divida em partes.` }, { status: 413 });
    return NextResponse.json({ linhas, mapeamento: sugerirMapeamento(linhas[0]) });
  } catch (err: any) {
    return NextResponse.json({ error: `Não consegui ler a planilha: ${err?.message || err}` }, { status: 400 });
  }
}
