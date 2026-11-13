/**
 * POST { linhas, mapeamento, cabecalho } — importa a planilha já lida e
 * mapeada na tela: cria/atualiza os produtos, os EAN, a unidade, NCM/CEST,
 * custo e estoque (lib/caixa-mercado/importar.ts).
 */
import { NextResponse } from "next/server";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { CAMPOS_DA_PLANILHA, lerLinhasDaPlanilha, type Mapeamento } from "@/lib/caixa-mercado/importacao/planilha";
import { aplicarPlanilha } from "@/lib/caixa-mercado/importar";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const ctx = await contextoDoCaixa({ tela: "/store/caixa-mercado/importar" });
  if (ehResposta(ctx)) return ctx;
  const corpo: any = await req.json().catch(() => null);
  const linhas: string[][] = Array.isArray(corpo?.linhas) ? corpo.linhas.map((l: unknown) => (Array.isArray(l) ? l.map((c) => String(c ?? "")) : [])) : [];
  const mapa = {} as Mapeamento;
  for (const c of CAMPOS_DA_PLANILHA) {
    const i = Number(corpo?.mapeamento?.[c.campo]);
    mapa[c.campo] = Number.isInteger(i) && i >= 0 ? i : -1;
  }
  if (mapa.descricao < 0) return NextResponse.json({ error: "Escolha a coluna da descrição." }, { status: 400 });
  const { itens, descartadas } = lerLinhasDaPlanilha(linhas, mapa, corpo?.cabecalho !== false);
  if (itens.length === 0) return NextResponse.json({ error: "Nenhuma linha com descrição para importar." }, { status: 400 });
  try {
    const r = await aplicarPlanilha(ctx.quem.lojaId, itens);
    return NextResponse.json({ ok: true, ...r, lidas: itens.length, descartadas });
  } catch (err: any) {
    console.error("[Caixa de mercado] importação da planilha:", err);
    return NextResponse.json({ error: err?.message || "A importação falhou." }, { status: 500 });
  }
}
