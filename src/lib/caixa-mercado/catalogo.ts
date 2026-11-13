/**
 * O CADASTRO QUE O CAIXA CARREGA ao abrir: todos os produtos vendáveis da loja
 * com preço do salão em centavos, unidade e códigos (EAN e PLU). O navegador
 * acha o produto do código lido sem ir ao servidor a cada bipe (mercado com
 * 5 mil itens dá ~400 KB, uma vez por abertura).
 */
import { prisma } from "@/lib/prisma";
import { precoDoCanal } from "@/lib/preco-por-canal";
import { SEM_PRODUTO_DE_INTEGRACAO } from "@/lib/cardapio-interno";
import { garantirEstruturaDoCaixa } from "./estrutura";

export type ProdutoDoCaixa = {
  id: string;
  nome: string;
  precoCentavos: number;
  unidade: "UN" | "KG";
  ncm: string | null;
  ncmSugerido: boolean;
  eans: string[];
  plu: string | null;
  estoque: number | null;
  ativo: boolean;
};

export async function catalogoDoCaixa(lojaId: string, opcoes: { incluirInativos?: boolean } = {}): Promise<ProdutoDoCaixa[]> {
  const produtos = await prisma.menuProduct.findMany({
    where: { franchiseeId: lojaId, isCombo: false, apenasEmCombo: false, ...(opcoes.incluirInativos ? {} : { active: true }), ...SEM_PRODUTO_DE_INTEGRACAO },
    select: { id: true, name: true, price: true, priceSalao: true, priceDelivery: true, priceTotem: true, promoPrice: true, ncm: true, estoqueQtd: true, active: true },
    orderBy: { name: "asc" },
  });
  const extras = new Map<string, { unidade: string; ncmSugerido: boolean }>();
  const eans = new Map<string, string[]>();
  const plus = new Map<string, string>();
  if (await garantirEstruturaDoCaixa()) {
    const linhas = await prisma.$queryRawUnsafe<{ menuProductId: string; unidade: string; ncmSugerido: boolean }[]>(
      `SELECT "menuProductId", "unidade", "ncmSugerido" FROM "CaixaMercadoProduto" WHERE "lojaId" = $1`,
      lojaId,
    );
    for (const l of linhas) extras.set(l.menuProductId, l);
    const codigos = await prisma.$queryRawUnsafe<{ tipo: string; codigo: string; menuProductId: string }[]>(
      `SELECT "tipo", "codigo", "menuProductId" FROM "CaixaMercadoCodigo" WHERE "lojaId" = $1`,
      lojaId,
    );
    for (const c of codigos) {
      if (c.tipo === "PLU") plus.set(c.menuProductId, c.codigo);
      else eans.set(c.menuProductId, [...(eans.get(c.menuProductId) ?? []), c.codigo]);
    }
  }
  return produtos.map((p) => ({
    id: p.id,
    nome: p.name,
    precoCentavos: Math.round(precoDoCanal(p as any, "salao") * 100),
    unidade: extras.get(p.id)?.unidade === "KG" ? "KG" : "UN",
    ncm: p.ncm ? p.ncm.replace(/\D/g, "") || null : null,
    ncmSugerido: Boolean(extras.get(p.id)?.ncmSugerido),
    eans: eans.get(p.id) ?? [],
    plu: plus.get(p.id) ?? null,
    estoque: p.estoqueQtd ?? null,
    ativo: p.active,
  }));
}
