import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirCotacao } from "@/lib/cotacao/sessao";
import { lerProdutosComIa } from "@/lib/cotacao/ia";
import { casarProduto, normalizarNome } from "@/lib/cotacao/casamento";

/**
 * POST { texto?, midia?: { base64, mimeType } } — a IA lê a foto da nota, o PDF
 * da lista ou o áudio do dono e devolve os produtos que ENTENDEU, sem gravar
 * nada: a tela mostra a lista para o lojista conferir, mexer e só então
 * cadastrar (POST /api/store/cotacao/produtos com a lista).
 *
 * Cada produto lido já vem com o insumo do estoque mais parecido (para ligar)
 * e marcado se já está cadastrado.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MIDIAS = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf|audio\/(ogg|webm|mp4|mpeg|wav|aac|x-m4a|mp3))$/;
const TAMANHO_MAXIMO = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const texto = String(corpo?.texto ?? "").slice(0, 20_000);
  let midia: { base64: string; mimeType: string } | null = null;
  if (corpo?.midia?.base64) {
    const mimeType = String(corpo.midia.mimeType || "").split(";")[0].trim().toLowerCase();
    if (!MIDIAS.test(mimeType)) return NextResponse.json({ error: "Mande foto, PDF ou áudio." }, { status: 400 });
    const base64 = String(corpo.midia.base64);
    if (base64.length * 0.75 > TAMANHO_MAXIMO) return NextResponse.json({ error: "Arquivo grande demais (até 15 MB)." }, { status: 400 });
    midia = { base64, mimeType };
  }
  if (!texto.trim() && !midia) return NextResponse.json({ error: "Mande um texto, uma foto, um PDF ou um áudio." }, { status: 400 });

  const lidos = await lerProdutosComIa(loja, { texto, midia });
  if (!lidos) return NextResponse.json({ error: "Não consegui ler agora. Tente de novo em instantes ou digite a lista." }, { status: 503 });
  if (!lidos.length) return NextResponse.json({ error: "Não achei nenhum produto aí. Confira se a foto está nítida." }, { status: 400 });

  const [insumos, cadastrados] = await Promise.all([
    prisma.stockItem.findMany({ where: { franchiseeId: loja, active: true }, select: { id: true, name: true }, take: 1000 }),
    prisma.produtoDeCompra.findMany({ where: { franchiseeId: loja }, select: { nome: true } }),
  ]);
  const jaTem = new Set(cadastrados.map((p) => normalizarNome(p.nome)));
  const paraCasar = insumos.map((i) => ({ id: i.id, nome: i.name }));
  return NextResponse.json({
    lidos: lidos.map((p) => {
      const c = casarProduto(p.nome, paraCasar);
      return { ...p, stockItemId: c && c.confianca >= 0.7 ? c.produtoId : null, jaCadastrado: jaTem.has(normalizarNome(p.nome)) };
    }),
  });
}
