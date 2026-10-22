import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDoMultimarcasDaSessao } from "@/lib/multimarcas/sessao";
import { multimarcasEstaLigado } from "@/lib/multimarcas/assinatura";
import { gravarConfigDaPagina, lerConfigDaPagina, LIMITES, type ConfigDaPagina } from "@/lib/multimarcas/pagina";
import { SELECT_DA_LOJA_NO_CARDAPIO } from "@/lib/cardapio-publico";
import { vitrineDaLoja } from "@/lib/multimarcas/carga";

/**
 * O editor do Multimarcas (tela /store/multimarcas, ativado).
 * GET — a página montada (ou um começo), as categorias do cardápio, os
 *       produtos para a prévia e nomes sugeridos (as lojas da conta no iFood/99).
 * PUT { config } — grava (lib/multimarcas/pagina.ts limpa tudo antes).
 * O dono, o ADMIN na loja ou o funcionário com acesso à tela (lib/multimarcas/sessao.ts), com o Multimarcas ativo.
 */
export const dynamic = "force-dynamic";

/** A página das marcas e o cardápio têm cache de 60 s: o que o dono salvou vale na hora. */
async function atualizarPaginasDaLoja(franchiseeId: string) {
  try {
    const { prisma } = await import("@/lib/prisma");
    const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { slug: true } });
    if (!loja?.slug) return;
    const { revalidatePath } = await import("next/cache");
    revalidatePath(`/marcas/${loja.slug}`);
    revalidatePath(`/loja/${loja.slug}`);
  } catch {}
}

async function sugestoesDeMarcas(franchiseeId: string): Promise<string[]> {
  const nomes = new Set<string>();
  try {
    const ifood = await prisma.ifoodIntegration.findMany({ where: { userId: franchiseeId, active: true }, select: { label: true } });
    for (const i of ifood) if (i.label?.trim()) nomes.add(i.label.trim());
  } catch {}
  try {
    // A tabela das lojas da 99 nasce no primeiro uso (api/admin/tabela-lojas-99food): pode não existir.
    const existe = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(`SELECT to_regclass('"Food99Store"') IS NOT NULL AS ok`);
    if (existe[0]?.ok) {
      const r = await prisma.$queryRawUnsafe<{ label: string | null }[]>(`SELECT "label" FROM "Food99Store" WHERE "userId" = $1 AND "active" = true`, franchiseeId);
      for (const x of r) if (x.label?.trim()) nomes.add(x.label.trim());
    }
  } catch {}
  // "Frangoso iFood" → "Frangoso": o nome da conta costuma vir com o app junto.
  return [...nomes].map((n) => n.replace(/\s*[-–·|]?\s*(ifood|99\s?food|99)\s*$/i, "").trim()).filter(Boolean).slice(0, 12);
}

export async function GET() {
  const s = await lojaDoMultimarcasDaSessao();
  if (!s) return NextResponse.json({ error: "Seu acesso não abre o Multimarcas. Peça ao dono da loja." }, { status: 403 });
  const franchisee = await prisma.user.findUnique({ where: { id: s.franchiseeId }, select: SELECT_DA_LOJA_NO_CARDAPIO });
  if (!franchisee) return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });
  const nomeDaLoja = franchisee.storeName || franchisee.name || "Minhas marcas";

  const salva = await lerConfigDaPagina(s.franchiseeId, nomeDaLoja);
  const config: ConfigDaPagina = salva ?? { nome: nomeDaLoja, frase: "", cor: "#E8590C", marcas: [], banners: [] };

  const [categorias, contagem, sugestoes, vitrine] = await Promise.all([
    prisma.menuCategory.findMany({ where: { franchiseeId: s.franchiseeId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { name: true, emoji: true } }),
    prisma.menuProduct.groupBy({ by: ["category"], where: { franchiseeId: s.franchiseeId }, _count: { _all: true } }).catch(() => []),
    sugestoesDeMarcas(s.franchiseeId),
    vitrineDaLoja(franchisee, config),
  ]);
  const qtd = new Map((contagem as any[]).map((c) => [String(c.category).trim().toLowerCase(), c._count._all]));
  // Categoria que só existe no produto (sem cadastro em MenuCategory) também entra.
  const nomes = new Map(categorias.map((c) => [c.name.trim().toLowerCase(), { nome: c.name, emoji: c.emoji }]));
  for (const c of contagem as any[]) {
    const k = String(c.category).trim().toLowerCase();
    if (k && !nomes.has(k)) nomes.set(k, { nome: String(c.category).trim(), emoji: "🍽️" });
  }

  return NextResponse.json({
    config,
    salva: Boolean(salva),
    limites: LIMITES,
    loja: { slug: franchisee.slug, nome: nomeDaLoja, logo: franchisee.storeLogo || null },
    categorias: [...nomes.entries()].map(([k, c]) => ({ ...c, produtos: qtd.get(k) ?? 0 })),
    sugestoes,
    vitrine,
  });
}

export async function PUT(req: Request) {
  const s = await lojaDoMultimarcasDaSessao();
  if (!s) return NextResponse.json({ error: "Seu acesso não abre o Multimarcas. Peça ao dono da loja." }, { status: 403 });
  if (!(await multimarcasEstaLigado(s.franchiseeId))) {
    return NextResponse.json({ error: "Ative o Multimarcas para montar a página das marcas." }, { status: 403 });
  }
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  try {
    const config = await gravarConfigDaPagina(s.franchiseeId, corpo?.config, s.nomeDaLoja);
    await atualizarPaginasDaLoja(s.franchiseeId);
    return NextResponse.json({ ok: true, config });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Erro ao salvar." }, { status: 503 });
  }
}
