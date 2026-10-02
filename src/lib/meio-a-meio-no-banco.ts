/**
 * Refaz o preço das meias pizzas de uma loja depois que o cadastro muda.
 *
 * A meia guarda o acréscimo JÁ CALCULADO por tamanho (lib/meio-a-meio.ts). Se
 * o dono sobe o preço do Camarão no painel e nada refaz a conta, toda pizza
 * com meia Camarão continua cobrando pelo preço velho. Por isso o salvamento
 * do produto (api/admin/menu-products) chama isto.
 *
 * Só mexe em pergunta de meio a meio cujas opções têm `precoPorEscolha` — as
 * montadas por scripts/meio-a-meio-nas-pizzas.mjs a partir de 27/09/2026. As
 * da NIK e da Ragnar são de outro molde (a NIK nem usa "1/2 " no nome) e ficam
 * como estão. Pizza nova ou renomeada não entra sozinha: roda-se o script.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { PREFIXO_DA_MEIA, ehPerguntaDeMeio, meiaNaPizza, regraDoTitulo, type PizzaDoMeio } from "@/lib/meio-a-meio";
import { bloqueiosDaOpcao } from "@/lib/preco-combo";

export async function refazerMeiasDaLoja(franchiseeId: string | null | undefined): Promise<number> {
  if (!franchiseeId) return 0;

  const grupos = await prisma.comboGroup.findMany({
    where: {
      title: { startsWith: "Meio a meio?", mode: "insensitive" },
      menuProduct: { franchiseeId },
    },
    select: {
      id: true,
      title: true,
      menuProductId: true,
      items: {
        select: {
          id: true,
          additionalPrice: true,
          precoPorEscolha: true,
          optionNote: true,
          menuProduct: { select: { name: true } },
        },
      },
    },
  });
  const nossos = grupos.filter(
    (g) => ehPerguntaDeMeio(g.title) && g.items.some((i) => i.precoPorEscolha !== null && i.precoPorEscolha !== undefined)
  );
  if (nossos.length === 0) return 0;

  const pizzas = await prisma.menuProduct.findMany({
    where: { franchiseeId, apenasEmCombo: false },
    select: {
      id: true,
      name: true,
      price: true,
      promoPrice: true,
      comboGroups: {
        select: { title: true, items: { select: { additionalPrice: true, promoAdditionalPrice: true, menuProduct: { select: { name: true } } } } },
      },
    },
  });
  const porId = new Map<string, PizzaDoMeio>(pizzas.map((p) => [p.id, p]));
  const porNome = new Map<string, PizzaDoMeio>(pizzas.map((p) => [p.name, p]));

  let refeitas = 0;
  for (const g of nossos) {
    const esta = porId.get(g.menuProductId);
    if (!esta) continue;
    const regra = regraDoTitulo(g.title);
    for (const item of g.items) {
      const nome = item.menuProduct?.name || "";
      if (!nome.startsWith(PREFIXO_DA_MEIA)) continue;
      const outra = porNome.get(nome.slice(PREFIXO_DA_MEIA.length));
      if (!outra) continue;
      // Os tamanhos sem meio a meio ficam como estão gravados (null na tabela).
      const meia = meiaNaPizza(esta, outra, regra, bloqueiosDaOpcao(item as any));
      const igual =
        Number(item.additionalPrice) === meia.additionalPrice &&
        mesmaTabela(item.precoPorEscolha, meia.precoPorEscolha) &&
        (item.optionNote || "") === meia.optionNote;
      if (igual) continue;
      await prisma.comboGroupItem.update({
        where: { id: item.id },
        data: {
          additionalPrice: meia.additionalPrice,
          precoPorEscolha: meia.precoPorEscolha ?? Prisma.DbNull,
          optionNote: meia.optionNote,
        },
      });
      refeitas++;
    }
  }
  return refeitas;
}

/** O JSONB devolve as chaves em outra ordem ("Grande" antes de "Pequena"). */
function mesmaTabela(a: unknown, b: unknown): boolean {
  const canon = (t: unknown) =>
    t && typeof t === "object" ? JSON.stringify(Object.entries(t as object).sort(([x], [y]) => x.localeCompare(y))) : "null";
  return canon(a) === canon(b);
}
