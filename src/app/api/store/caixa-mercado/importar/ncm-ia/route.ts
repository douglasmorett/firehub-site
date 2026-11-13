/**
 * POST — NCM pela IA para os produtos que ainda estão sem NCM (até 80 por
 * vez; a tela repete, pulando os que a IA não soube, enquanto houver lote). Gravado como "sugerido, conferir".
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { sugerirNcmsComIa } from "@/lib/caixa-mercado/ia-ncm";
import { gravarNcmsSugeridos } from "@/lib/caixa-mercado/importar";
import { SEM_PRODUTO_DE_INTEGRACAO } from "@/lib/cardapio-interno";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const POR_VEZ = 80;

export async function POST(req: Request) {
  const ctx = await contextoDoCaixa({ tela: "/store/caixa-mercado/importar" });
  if (ehResposta(ctx)) return ctx;
  const semNcm = { franchiseeId: ctx.quem.lojaId, isCombo: false, ...SEM_PRODUTO_DE_INTEGRACAO, OR: [{ ncm: null }, { ncm: "" }] };
  // `pular`: os que a IA já não soube classificar nesta rodada (continuam sem NCM).
  const pular = Math.max(0, Math.round(Number((await req.json().catch(() => ({})))?.pular) || 0));
  const lote = await prisma.menuProduct.findMany({ where: semNcm as any, select: { id: true, name: true }, skip: pular, take: POR_VEZ, orderBy: { name: "asc" } });
  if (lote.length === 0) return NextResponse.json({ ok: true, sugeridos: 0, restam: 0 });
  const sugestoes = await sugerirNcmsComIa(ctx.quem.lojaId, lote.map((p) => ({ id: p.id, nome: p.name })));
  if (sugestoes === null) return NextResponse.json({ error: "A IA não respondeu agora. Tente de novo em instantes." }, { status: 503 });
  const sugeridos = await gravarNcmsSugeridos(ctx.quem.lojaId, sugestoes);
  const restam = await prisma.menuProduct.count({ where: semNcm as any });
  return NextResponse.json({ ok: true, sugeridos, semResposta: lote.length - sugeridos, restam });
}
