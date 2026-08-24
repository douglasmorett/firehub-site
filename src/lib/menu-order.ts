/**
 * Ordenação do cardápio: onde está a coluna sortOrder.
 *
 * `MenuProduct.sortOrder` guarda a ordem escolhida pela loja dentro da
 * categoria. Ela NÃO está no schema do Prisma, e isso é deliberado — o que se
 * aprendeu derrubando o cardápio:
 *
 * Declarar o campo no schema não é inofensivo. Toda consulta que usa `include:`
 * sem `select:` faz o Prisma montar um SELECT com TODAS as colunas escalares do
 * modelo. Com o campo no schema e a coluna ausente no banco, o Postgres
 * responde "column MenuProduct.sortOrder does not exist" e o cardápio inteiro
 * serve 500 — independente de qualquer `orderBy`. Foi exatamente o que
 * aconteceu com /loja/brasa-burguer, e é a terceira vez que esta aplicação cai
 * pela mesma classe de erro (ver 5a953ac).
 *
 * A coluna entra por SQL rodado à mão (scripts/aplicar-schema.md). Enquanto
 * isso, quem escreve nela usa SQL cru, que não depende do schema, e quem lê
 * continua no alfabético de sempre.
 *
 * Passo seguinte, depois da coluna existir no banco: devolver o campo ao
 * schema e trocar os `orderBy` literais por orderByCardapio(). Nessa ordem —
 * primeiro a coluna, depois o schema. Nunca o contrário.
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
    // O apelido NÃO pode ser `exists`: é palavra reservada no Postgres e a
    // consulta inteira vira erro de sintaxe — o que fazia esta sondagem
    // responder "não existe" para sempre, mesmo com a coluna criada.
    const rows = await prisma.$queryRaw<{ achou: number }[]>`
      SELECT 1 AS achou
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
