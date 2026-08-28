import { prisma } from "@/lib/prisma";

/**
 * Garante as colunas de PREÇO POR CANAL antes de o servidor aceitar tráfego.
 *
 * ── POR QUE ISTO EXISTE, SE JÁ HÁ /api/admin/colunas-preco ──────────────────
 *
 * A rota continua sendo a ferramenta manual de conferência. Mas ela exige uma
 * sessão ADMIN — e no deploy desta revisão não havia nenhuma disponível: a
 * conta da matriz opera como FRANCHISEE. O deploy não pode depender de um
 * clique que ninguém consegue dar.
 *
 * A regra da casa ("migração é decisão de pessoa, não de start de container")
 * nasceu do `prisma db push` automático que derrubou o cardápio duas vezes
 * (5a953ac): sincronização de schema INTEIRA, com potencial destrutivo. Isto
 * aqui é outra categoria:
 *
 *   - TRÊS instruções fixas, escritas no código, aditivas e idempotentes
 *     (`ADD COLUMN IF NOT EXISTS` de coluna NULÁVEL não altera, não apaga e
 *     não trava nada; rodar mil vezes é igual a uma).
 *   - Roda ANTES do primeiro request do container novo — que é a única ordem
 *     que impede o 500 de "campo no schema, coluna ausente" (o que derrubou
 *     /loja em 24/08/2026 com MenuProduct.sortOrder).
 *   - NUNCA lança: falhar aqui não pode impedir o boot. Se o banco estiver
 *     fora, o app inteiro já não funciona de qualquer jeito — e o log CRÍTICO
 *     abaixo diz exatamente o que conferir.
 *
 * Colunas novas no futuro: adicionar a instrução AQUI e o campo no schema no
 * MESMO commit — a ordem passa a ser garantida pelo boot, não por gente.
 */
const INSTRUCOES = [
  `ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "priceSalao" DOUBLE PRECISION`,
  `ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "priceDelivery" DOUBLE PRECISION`,
  `ALTER TABLE "MenuProduct" ADD COLUMN IF NOT EXISTS "priceTotem" DOUBLE PRECISION`,
];

const ESPERADAS = ["priceSalao", "priceDelivery", "priceTotem"];

export async function garantirColunasDePreco(): Promise<void> {
  // Ambiente sem banco de verdade (dev local usa .env higienizado): não há o
  // que garantir, e ficar tentando só suja o log.
  const url = process.env.DATABASE_URL || "";
  if (!/^postgres/i.test(url)) {
    console.warn("[Boot] DATABASE_URL não é Postgres; pulando a garantia de colunas.");
    return;
  }

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      for (const sql of INSTRUCOES) {
        await prisma.$executeRawUnsafe(sql);
      }

      const rows = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'MenuProduct'
          AND column_name IN ('priceSalao', 'priceDelivery', 'priceTotem')
      `;
      const existentes = rows.map((r) => r.column_name);
      const faltando = ESPERADAS.filter((c) => !existentes.includes(c));

      if (faltando.length === 0) {
        console.log("[Boot] ✅ Colunas de preço por canal garantidas no banco.");
        return;
      }
      // ADD COLUMN sem erro mas coluna ausente não deveria acontecer nunca;
      // se acontecer, é melhor o log gritar do que o cardápio servir 500 mudo.
      console.error(`[Boot] 🛑 Colunas ausentes mesmo após o ALTER: ${faltando.join(", ")}.`);
      return;
    } catch (err: any) {
      console.error(
        `[Boot] Garantia de colunas falhou (tentativa ${tentativa}/3): ${err?.message}`
      );
      if (tentativa < 3) await new Promise((r) => setTimeout(r, 2000 * tentativa));
    }
  }

  console.error(
    "[Boot] 🛑 CRÍTICO: não consegui garantir as colunas de preço por canal. " +
      "Se o cardápio servir 500, rode /api/admin/colunas-preco?criar=sim (ADMIN) ou o SQL acima à mão."
  );
}
