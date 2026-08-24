/**
 * Ordenação do cardápio, tolerante a schema não aplicado.
 *
 * `MenuProduct.sortOrder` é a coluna que permite à loja escolher a ordem dos
 * produtos dentro da categoria. Ela entra no schema por um `prisma db push`
 * feito À MÃO — o Dockerfile roda `next build` puro e o entrypoint não aplica
 * nada (ver scripts/aplicar-schema.md).
 *
 * Isso cria uma janela perigosa: entre o deploy do código e o db push, um
 * `orderBy: { sortOrder }` bate em coluna inexistente, o Prisma levanta erro e
 * o cardápio inteiro serve 500. Já aconteceu duas vezes nesta aplicação por
 * motivo equivalente (5a953ac) — não vale repetir a terceira.
 *
 * Então a ordenação é perguntada ao banco: existe a coluna, usa; não existe,
 * cai no alfabético de sempre. Quando o db push rodar, o cardápio passa a
 * respeitar a ordem da loja sozinho, sem deploy.
 */

import { prisma } from "@/lib/prisma";

type OrderBy = Record<string, "asc" | "desc">[];

const ALFABETICO: OrderBy = [{ category: "asc" }, { name: "asc" }];
const COM_ORDEM: OrderBy = [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }];

let temColuna: boolean | null = null;
let ultimaChecagem = 0;

/** Enquanto a coluna não existe, vale a pena perguntar de novo de vez em quando. */
const REPROBE_MS = 5 * 60 * 1000;

async function colunaExiste(): Promise<boolean> {
  // Positivo é definitivo: coluna não desaparece.
  if (temColuna === true) return true;
  if (temColuna === false && Date.now() - ultimaChecagem < REPROBE_MS) return false;

  try {
    const rows = await prisma.$queryRaw<{ exists: number }[]>`
      SELECT 1 as exists
      FROM information_schema.columns
      WHERE table_name = 'MenuProduct' AND column_name = 'sortOrder'
      LIMIT 1
    `;
    temColuna = Array.isArray(rows) && rows.length > 0;
  } catch {
    // Sem conseguir perguntar, assume o comportamento antigo — que sempre funcionou.
    temColuna = false;
  }

  ultimaChecagem = Date.now();
  if (temColuna === false) {
    console.warn(
      "[Cardápio] Coluna MenuProduct.sortOrder ausente — ordenando por nome. " +
      "Rode `prisma db push` (ver scripts/aplicar-schema.md) para a loja poder ordenar os produtos."
    );
  }
  return temColuna;
}

/** orderBy para listar produtos do cardápio. */
export async function orderByCardapio(): Promise<OrderBy> {
  return (await colunaExiste()) ? COM_ORDEM : ALFABETICO;
}

/** A loja consegue gravar ordem de produto agora? */
export async function podeOrdenarProdutos(): Promise<boolean> {
  return colunaExiste();
}
