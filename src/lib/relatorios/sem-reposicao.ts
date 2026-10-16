/**
 * REPOSIÇÃO NÃO É VENDA — o pedaço de consulta que tira o pedido de reposição
 * (lib/reposicao.ts) de toda busca que conta venda. Só servidor (Prisma).
 *
 * Decisão do dono (Douglas, 16/10/2026): "reposição não é venda, o cliente não
 * paga, é prejuízo". O pedido de reposição vale R$ 0,00 e tem `reposicao`
 * preenchido; contado como venda, ele somava um atendimento de R$ 0,00 (o
 * ticket médio caía), uma forma de pagamento "Pago online (reposição do #N)"
 * de R$ 0,00 e um pedido a mais para o cliente.
 *
 * O lado puro da mesma regra é `ehReposicao` (lib/relatorios/regua-da-venda.ts),
 * que `entraNaVenda` já confere quando o pedido traz a coluna. O custo dela vai
 * para o CMV do DRE (lib/financeiro/dre.ts, "Reposições (troca)") e para o
 * relatório Reposições (lib/relatorios/reposicoes.ts).
 *
 * Quem CONTINUA vendo a reposição: o consumo de insumos (Itens consumidos — ela
 * gasta insumo), o quadro de pedidos, o KDS, o acerto do motoboy (a corrida é
 * paga) e os avisos de pedido parado/atrasado.
 */
import { Prisma } from "@prisma/client";

/** `where` do Prisma: só pedidos que NÃO são reposição. */
export const SEM_REPOSICAO = { reposicao: { equals: Prisma.DbNull } } satisfies Prisma.CustomerOrderWhereInput;

/** O mesmo para SQL cru (`"reposicao" IS NULL`), com o alias da tabela quando houver. */
export const sqlSemReposicao = (alias?: string) => Prisma.raw(alias ? `${alias}."reposicao" IS NULL` : `"reposicao" IS NULL`);
