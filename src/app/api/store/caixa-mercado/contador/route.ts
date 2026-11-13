/**
 * A PLANILHA PARA O CONTADOR (lib/caixa-mercado/importacao/ncm.ts).
 * GET  — XLSX com uma linha por NCM (exemplos, quantidade, sugestão de CFOP,
 *        CSOSN/CST, PIS, COFINS, CEST) + a aba dos produtos ainda sem NCM.
 * POST (multipart, `arquivo`) — a planilha que o contador devolveu: grava a
 *        regra por NCM e aplica a todos os produtos daquele NCM.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { catalogoDoCaixa } from "@/lib/caixa-mercado/catalogo";
import { agruparPorNcm, COLUNAS_DO_CONTADOR, lerPlanilhaDoContador } from "@/lib/caixa-mercado/importacao/ncm";
import { lerPlanilha } from "@/lib/caixa-mercado/importacao/arquivos";
import { aplicarRegrasDoContador } from "@/lib/caixa-mercado/importar";
import { montarPlanilha, respostaDePlanilha } from "@/lib/planilha-xlsx";
import { normalizarConfigFiscal } from "@/lib/fiscal-config";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const ctx = await contextoDoCaixa({ tela: "/store/caixa-mercado/importar" });
  if (ehResposta(ctx)) return ctx;
  const loja = await prisma.user.findUnique({ where: { id: ctx.quem.lojaId }, select: { fiscalConfig: true, storeName: true } });
  const crt = Number(normalizarConfigFiscal(loja?.fiscalConfig as any)?.regimeTributario) || 1;
  const produtos = await catalogoDoCaixa(ctx.quem.lojaId, { incluirInativos: true });
  const cest = new Map((await prisma.menuProduct.findMany({ where: { id: { in: produtos.map((p) => p.id) } }, select: { id: true, cest: true } })).map((p) => [p.id, p.cest]));
  const { grupos, semNcm } = agruparPorNcm(produtos.map((p) => ({ id: p.id, nome: p.nome, ncm: p.ncm, cest: cest.get(p.id) || null, ncmSugerido: p.ncmSugerido })), crt);
  const regime = crt === 1 || crt === 4 ? "Simples Nacional (CSOSN)" : "Regime normal (CST)";
  const xlsx = montarPlanilha([
    {
      nome: "Tributação por NCM",
      congelarLinhas: 3,
      larguras: [12, 60, 10, 11, 8, 16, 10, 12, 50],
      linhas: [
        [{ v: `${loja?.storeName || "Loja"} — tributação por NCM para o contador conferir (${regime})`, estilo: "titulo" }],
        [{ v: "Preencha ou corrija as colunas CEST, CFOP, CSOSN/CST ICMS, CST PIS e CST COFINS e devolva este arquivo. Os valores que vêm preenchidos são SUGESTÃO do FireHub. Vale para TODOS os produtos do NCM.", estilo: "suave" }],
        { celulas: [...COLUNAS_DO_CONTADOR], estilo: "cabecalho" },
        ...grupos.map((g) => [
          g.ncm,
          g.exemplos.join(" · ") + (g.sugeridosPelaIa ? ` (${g.sugeridosPelaIa} com NCM sugerido pela IA — conferir)` : ""),
          { v: g.quantidade, estilo: "qtd" as const },
          g.cest || "",
          g.sugestao.cfop,
          g.sugestao.csosn,
          g.sugestao.pis,
          g.sugestao.cofins,
          g.sugestao.obs ? `Sugestão: ${g.sugestao.obs}` : "Sugestão",
        ]),
      ],
    },
    {
      nome: "Produtos sem NCM",
      larguras: [70],
      linhas: [{ celulas: ["Produto (sem NCM: use a IA na tela de importação ou importe os XML de compra)"], estilo: "cabecalho" }, ...semNcm.map((p) => [p.nome])],
    },
  ]);
  return respostaDePlanilha(xlsx, "tributacao-por-ncm.xlsx");
}

export async function POST(req: Request) {
  const ctx = await contextoDoCaixa({ tela: "/store/caixa-mercado/importar" });
  if (ehResposta(ctx)) return ctx;
  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!arquivo || typeof arquivo === "string") return NextResponse.json({ error: "Escolha a planilha que o contador devolveu." }, { status: 400 });
  let linhas: string[][];
  try {
    linhas = lerPlanilha(Buffer.from(await arquivo.arrayBuffer()));
  } catch (err: any) {
    return NextResponse.json({ error: `Não consegui ler a planilha: ${err?.message || err}` }, { status: 400 });
  }
  // O cabeçalho pode não ser a 1ª linha (a nossa tem título e instrução em cima).
  const inicio = linhas.findIndex((l) => l.some((c) => /^ncm$/i.test(String(c).trim())));
  const { regras, erros } = lerPlanilhaDoContador(inicio >= 0 ? linhas.slice(inicio) : linhas);
  if (regras.length === 0) return NextResponse.json({ error: erros[0] || "Nenhuma regra na planilha.", erros }, { status: 400 });
  try {
    const r = await aplicarRegrasDoContador(ctx.quem.lojaId, regras);
    return NextResponse.json({ ok: true, ...r, erros });
  } catch (err: any) {
    console.error("[Caixa de mercado] regras do contador:", err);
    return NextResponse.json({ error: err?.message || "Não deu para aplicar." }, { status: 500 });
  }
}
