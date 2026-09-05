/**
 * Roda UMA vez quando uma instância nova do servidor sobe, e o Next só começa
 * a aceitar requisições depois que isto termina. É essa garantia de ordem que
 * este arquivo compra.
 */
export async function register() {
  // Só no runtime Node de um servidor de verdade — nunca no edge e nunca
  // durante o `next build` (os workers de prerender não precisam de DDL).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const {
    garantirColunasDePreco,
    garantirColunasDoSchema,
    garantirColunasBrendi,
    garantirEstruturaDeLotes,
    garantirEstruturaDeCaixa,
    garantirEstruturaDeMesa,
  } = await import("./lib/garantir-colunas");
  await garantirColunasDePreco();
  // As colunas que o schema.prisma declara e que nunca ganharam DDL — 39 no
  // levantamento de 03/09/2026, entre elas as que o cardápio público lê e as
  // que todo pedido novo grava. Precisa vir ANTES do primeiro request, que é
  // a única ordem que impede o 500 de "campo no schema, coluna ausente".
  await garantirColunasDoSchema();
  // Colunas brendi* no banco ANTES de qualquer rota da integração rodar —
  // elas ainda não estão no schema.prisma, então o boot é quem garante a ordem.
  await garantirColunasBrendi();
  // Tabela StockLot e as colunas de rastreio ANTES de o schema.prisma que as
  // declara ser consultado — é a ordem que impede o 500 de "campo no schema,
  // coluna ausente". Se falhar, `temEstruturaDeLotes()` desliga só o recurso
  // de validade e o resto do estoque segue inteiro.
  await garantirEstruturaDeLotes();
  // Sangria e reforço de caixa. Sem a tabela, o esperado do fechamento ignora
  // todo dinheiro que entrou ou saiu no meio do turno.
  await garantirEstruturaDeCaixa();
  // Acesso do garçom (login na tabela Waiter), quem fechou a mesa e a tabela
  // PrintRequest da conta impressa. Vem antes do primeiro request porque o GET
  // da fila de impressão — que todo Assistente chama a cada 3 s — lê uma das
  // colunas novas: sem ela, a comanda de mesa e de balcão pararia em todas as
  // lojas de uma vez.
  await garantirEstruturaDeMesa();
}
