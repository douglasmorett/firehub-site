/**
 * EXCLUIR UMA LOJA INTEIRA — a lixeira do admin (pedido do dono, 27/09/2026:
 * "muitas contas de teste que quero excluir para não me enganar na quantidade").
 *
 * Apagar o `User` não basta: metade do que aponta para ele é RESTRICT
 * (pedido antigo, avaliação, motoboy, garçom, mensalidade, nota de estoque),
 * o cardápio é SET NULL (viraria produto órfão sem loja) e uma dezena de
 * tabelas guardam `franchiseeId` como texto, sem chave estrangeira (caixa,
 * contador de pedidos, fila de impressão, contas a pagar, KDS...). Este
 * arquivo apaga tudo, na ordem certa, numa transação só: ou some inteira ou
 * não some nada.
 *
 * A varredura das tabelas sem FK é feita no banco (information_schema), não
 * numa lista escrita à mão — tabela nova com `franchiseeId` entra sozinha. As
 * tabelas com FK entre si são apagadas filha antes de mãe.
 */
import { prisma } from "@/lib/prisma";

/** Só o que a exclusão usa do cliente da transação (o cliente do projeto é estendido). */
type Tx = {
  $queryRawUnsafe<T = unknown>(sql: string, ...valores: unknown[]): Promise<T>;
  $executeRawUnsafe(sql: string, ...valores: unknown[]): Promise<number>;
};

/** O que a exclusão vai levar — para o admin ver antes de confirmar. */
export type RetratoDaLoja = {
  id: string;
  nome: string;
  email: string;
  role: string;
  pedidos: number;
  mensalidadesPagas: number;
  produtos: number;
  garcons: number;
  subUsuarios: number;
};

export async function retratoDaLoja(id: string): Promise<RetratoDaLoja | null> {
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, storeName: true, email: true, role: true } });
  if (!u) return null;
  const [pedidos, mensalidadesPagas, produtos, garcons, subUsuarios] = await Promise.all([
    prisma.customerOrder.count({ where: { franchiseeId: id } }),
    prisma.franchiseeBillingCycle.count({ where: { franchiseeId: id, status: "PAID" } }),
    prisma.menuProduct.count({ where: { franchiseeId: id } }),
    prisma.waiter.count({ where: { franchiseeId: id } }),
    prisma.user.count({ where: { ownerId: id } }),
  ]);
  return { id, nome: u.storeName || u.name, email: u.email, role: u.role, pedidos, mensalidadesPagas, produtos, garcons, subUsuarios };
}

/** Tabelas com coluna `franchiseeId` (ou `userId` de integração) SEM chave estrangeira para User. */
async function tabelasSemChave(tx: Tx): Promise<{ tabela: string; coluna: string }[]> {
  const linhas: { tabela: string; coluna: string }[] = await tx.$queryRawUnsafe(`
    select c.table_name as tabela, c.column_name as coluna
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name = 'franchiseeId'
      and c.table_name <> 'User'
      and not exists (
        select 1 from information_schema.key_column_usage k
        join information_schema.table_constraints t on t.constraint_name = k.constraint_name and t.table_schema = k.table_schema
        where t.constraint_type = 'FOREIGN KEY' and k.table_schema = 'public'
          and k.table_name = c.table_name and k.column_name = c.column_name
      )`);
  // Integrações que guardam a loja em `userId`, também sem FK.
  for (const tabela of ["ChatbotConversationState", "Food99Store"]) {
    const existe: { n: number }[] = await tx.$queryRawUnsafe(
      `select count(*)::int as n from information_schema.columns where table_schema='public' and table_name=$1 and column_name='userId'`, tabela
    );
    if (existe[0]?.n) linhas.push({ tabela, coluna: "userId" });
  }
  return linhas;
}

/** Filha antes de mãe: entre as tabelas da varredura, quem aponta para quem. */
async function ordemDeExclusao(tx: Tx, tabelas: string[]): Promise<string[]> {
  if (tabelas.length === 0) return [];
  const fks: { filha: string; mae: string }[] = await tx.$queryRawUnsafe(`
    select tc.table_name as filha, ccu.table_name as mae
    from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
      and tc.table_name = any($1) and ccu.table_name = any($1) and tc.table_name <> ccu.table_name`, tabelas);
  const restantes = new Set(tabelas);
  const saida: string[] = [];
  while (restantes.size > 0) {
    // Pode sair quem não é mãe de ninguém que ainda está na fila.
    const livres = [...restantes].filter((t) => !fks.some((f) => f.mae === t && restantes.has(f.filha)));
    if (livres.length === 0) { saida.push(...restantes); break; } // ciclo: tenta na ordem que vier
    for (const t of livres) { saida.push(t); restantes.delete(t); }
  }
  return saida;
}

async function apagarTudoDe(tx: Tx, id: string, log: string[]) {
  // Sub-usuários (funcionários com login próprio) primeiro — cada um pode ter o mesmo rastro.
  const filhos: { id: string }[] = await tx.$queryRawUnsafe(`select id from "User" where "ownerId" = $1`, id);
  for (const f of filhos) await apagarTudoDe(tx, f.id, log);

  const exec = async (rotulo: string, sql: string) => {
    const n = await tx.$executeRawUnsafe(sql, id);
    if (n > 0) log.push(`${rotulo}: ${n}`);
  };

  // RESTRICT em cadeia: avaliação → pedido; item/histórico → pedido antigo.
  await exec("avaliações", `delete from "StoreReview" where "franchiseeId" = $1 or "orderId" in (select id from "CustomerOrder" where "franchiseeId" = $1)`);
  await exec("pedidos", `delete from "CustomerOrder" where "franchiseeId" = $1`);
  await exec("itens de pedido antigo", `delete from "OrderItem" where "orderId" in (select id from "Order" where "userId" = $1)`);
  await exec("histórico de pedido antigo", `delete from "OrderHistory" where "orderId" in (select id from "Order" where "userId" = $1)`);
  await exec("pedidos antigos", `delete from "Order" where "userId" = $1`);

  // Cardápio: SET NULL deixaria produto e categoria sem loja.
  await exec("opções de combo", `delete from "ComboGroupItem" where "menuProductId" in (select id from "MenuProduct" where "franchiseeId" = $1)`);
  await exec("produtos", `delete from "MenuProduct" where "franchiseeId" = $1`);
  await exec("categorias", `delete from "MenuCategory" where "franchiseeId" = $1`);

  // RESTRICT direto no User.
  await exec("motoboys", `delete from "Motoboy" where "franchiseeId" = $1`);
  await exec("garçons", `delete from "Waiter" where "franchiseeId" = $1`);
  await exec("mensalidades", `delete from "FranchiseeBillingCycle" where "franchiseeId" = $1`);
  await exec("campanhas Meta", `delete from "MetaAdsCampaign" where "franchiseeId" = $1`);
  await exec("notas de estoque", `delete from "StockInvoice" where "franchiseeId" = $1`);

  // Tabelas sem chave estrangeira — a cascata não as alcança.
  const semChave = await tabelasSemChave(tx);
  const ordem = await ordemDeExclusao(tx, [...new Set(semChave.map((t) => t.tabela))]);
  for (const tabela of ordem) {
    for (const { coluna } of semChave.filter((t) => t.tabela === tabela)) {
      await exec(tabela, `delete from "${tabela}" where "${coluna}" = $1`);
    }
  }

  // O resto (mesas, estoque, funcionários, API keys, fila de impressão...) vai em cascata.
  await exec("conta", `delete from "User" where id = $1`);
}

/**
 * Apaga a loja e tudo que é dela. Devolve o que foi apagado, tabela a tabela,
 * para o registro no console e para o admin ver.
 */
export async function excluirLoja(id: string, opcoes?: { ensaio?: boolean }): Promise<{ apagado: string[] }> {
  const log: string[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      await apagarTudoDe(tx, id, log);
      // Ensaio: roda tudo e desfaz — para conferir o SQL numa conta real sem apagar.
      if (opcoes?.ensaio) throw new Error("ENSAIO");
    }, { timeout: 60_000 });
  } catch (e: any) {
    if (e?.message !== "ENSAIO") throw e;
  }
  return { apagado: log };
}
