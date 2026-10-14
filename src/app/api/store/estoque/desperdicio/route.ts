/**
 * /api/store/estoque/desperdicio — a aba Desperdício do Estoque.
 *
 *   GET   ?de=AAAA-MM-DD&ate=AAAA-MM-DD  os desperdícios do período (lançados
 *         e pedidos cancelados já produzidos), os produtos e os insumos para
 *         o lançamento. R$ só para quem vê dados sensíveis (lib/cmv/acesso.ts).
 *   POST  { tipo: "PRODUTO", produtoId, quantidade, motivo }
 *       | { tipo: "INSUMO", insumoId, quantidade, motivo }
 *         dá baixa pela ficha técnica (WASTE) e o custo entra no CMV.
 *
 * Quem pode: quem tem "Estoque" (a mesma caixinha da contagem e da compra).
 * A conta é de lib/cmv/desperdicio.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirEstoque } from "@/lib/cmv/acesso";
import { DesperdicioRecusado, desperdiciosDoPeriodo, lancarDesperdicio } from "@/lib/cmv/desperdicio";
import { hojeNaLoja, somarDias } from "@/lib/relatorios/base";

export const dynamic = "force-dynamic";
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const r = await exigirEstoque();
  if (!r.ok) return r.resposta;
  const { lojaId, tz, veDadosSensiveis } = r.acesso;

  const hoje = hojeNaLoja(tz);
  const sp = req.nextUrl.searchParams;
  let de = DIA_RE.test(sp.get("de") || "") ? sp.get("de")! : somarDias(hoje, -6);
  let ate = DIA_RE.test(sp.get("ate") || "") ? sp.get("ate")! : hoje;
  if (de > ate) [de, ate] = [ate, de];
  if (somarDias(de, 92) < ate) de = somarDias(ate, -92);

  const [periodo, produtos, insumos] = await Promise.all([
    desperdiciosDoPeriodo(lojaId, tz, de, ate),
    // Os espelhos dos apps (ifood-, 99food_...) não são produto que se faz.
    prisma.menuProduct.findMany({
      where: { franchiseeId: lojaId, active: true, NOT: [{ id: { startsWith: "ifood-" } }, { id: { startsWith: "99food_" } }] },
      select: { id: true, name: true, category: true, cost: true, _count: { select: { recipeItems: true } } },
      orderBy: { name: "asc" },
      take: 1000,
    }),
    prisma.stockItem.findMany({
      where: { franchiseeId: lojaId, NOT: { active: false } },
      select: { id: true, name: true, unit: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Sem os dados sensíveis, a cozinha lança e vê o que foi lançado, sem R$.
  const semValor = <T extends { valor: number | null }>(l: T[]) => (veDadosSensiveis ? l : l.map((x) => ({ ...x, valor: null })));
  return NextResponse.json({
    hoje, de, ate, veDadosSensiveis,
    lancados: semValor(periodo.lancados),
    cancelados: semValor(periodo.cancelados),
    totais: veDadosSensiveis ? periodo.totais : null,
    produtos: produtos.map((p) => ({
      id: p.id, nome: p.name, categoria: p.category || "",
      temFicha: p._count.recipeItems > 0,
      temCusto: Number(p.cost) > 0,
    })),
    insumos: insumos.map((i) => ({ id: i.id, nome: i.name, unidade: i.unit })),
  });
}

export async function POST(req: NextRequest) {
  const r = await exigirEstoque();
  if (!r.ok) return r.resposta;
  const { lojaId, tz, usuarioId, veDadosSensiveis } = r.acesso;

  const corpo = await req.json().catch(() => null);
  const tipo = corpo?.tipo === "INSUMO" ? "INSUMO" : corpo?.tipo === "PRODUTO" ? "PRODUTO" : null;
  if (!tipo) return NextResponse.json({ error: "Escolha se o desperdício é de um produto do cardápio ou de um insumo." }, { status: 400 });
  const quantidade = Number(String(corpo?.quantidade ?? "").replace(",", "."));
  const motivo = String(corpo?.motivo || "");

  const usuario = await prisma.user.findUnique({ where: { id: usuarioId }, select: { name: true, email: true } });
  const quem = { id: usuarioId, nome: usuario?.name || usuario?.email || "Equipe" };

  try {
    const resultado = await lancarDesperdicio(
      { id: lojaId, tz },
      quem,
      tipo === "PRODUTO"
        ? { tipo, produtoId: String(corpo?.produtoId || ""), quantidade, motivo }
        : { tipo, insumoId: String(corpo?.insumoId || ""), quantidade, motivo },
    );
    return NextResponse.json({ success: true, ...resultado, valor: veDadosSensiveis ? resultado.valor : null });
  } catch (e: any) {
    if (e instanceof DesperdicioRecusado) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[Desperdício] Erro ao lançar:", e);
    return NextResponse.json({ error: "Não deu para lançar o desperdício agora. Tente de novo." }, { status: 500 });
  }
}
