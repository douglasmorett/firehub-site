/**
 * POST (multipart, `arquivos` — vários .xml e/ou .zip) — as NF-e de COMPRA:
 * completa NCM/CEST e o custo dos produtos pelo EAN e cria os que faltam
 * (lib/caixa-mercado/importar.ts → aplicarNotasDeCompra).
 */
import { NextResponse } from "next/server";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { lerZip, textoDoArquivo } from "@/lib/caixa-mercado/importacao/arquivos";
import { lerNotaDeCompra, type NotaDeCompra } from "@/lib/caixa-mercado/importacao/nfe";
import { aplicarNotasDeCompra } from "@/lib/caixa-mercado/importar";
import { configDoCaixa } from "@/lib/caixa-mercado/assinatura";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const ctx = await contextoDoCaixa({ tela: "/store/caixa-mercado/importar" });
  if (ehResposta(ctx)) return ctx;
  const form = await req.formData().catch(() => null);
  const arquivos = (form?.getAll("arquivos") || []).filter((a): a is File => typeof a !== "string");
  if (arquivos.length === 0) return NextResponse.json({ error: "Escolha os XML das notas (ou um .zip com eles)." }, { status: 400 });
  const notas: NotaDeCompra[] = [];
  const ignorados: string[] = [];
  const chaves = new Set<string>();
  const ler = (nome: string, buf: Buffer) => {
    const nota = lerNotaDeCompra(textoDoArquivo(buf));
    if (!nota || nota.itens.length === 0) { ignorados.push(nome); return; }
    if (nota.chave && chaves.has(nota.chave)) return; // a mesma nota duas vezes
    if (nota.chave) chaves.add(nota.chave);
    notas.push(nota);
  };
  try {
    for (const a of arquivos) {
      const buf = Buffer.from(await a.arrayBuffer());
      if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
        for (const e of lerZip(buf)) if (/\.xml$/i.test(e.nome)) ler(e.nome, e.dados);
      } else ler(a.name, buf);
    }
  } catch (err: any) {
    return NextResponse.json({ error: `Não consegui ler os arquivos: ${err?.message || err}` }, { status: 400 });
  }
  if (notas.length === 0) return NextResponse.json({ error: "Nenhuma NF-e com itens nos arquivos enviados.", ignorados }, { status: 400 });
  try {
    const { margemPadrao } = await configDoCaixa(ctx.quem.lojaId);
    const r = await aplicarNotasDeCompra(ctx.quem.lojaId, notas, margemPadrao);
    return NextResponse.json({ ok: true, ...r, ignorados });
  } catch (err: any) {
    console.error("[Caixa de mercado] importação de XML:", err);
    return NextResponse.json({ error: err?.message || "A importação falhou." }, { status: 500 });
  }
}
