/**
 * scripts/teste-aceite-so-com-automatico.ts — quando o FireHub confirma o
 * pedido NA PLATAFORMA sem a loja clicar (lib/loja-sem-conexao-no-banco,
 * `aceitaSozinhoAgora`).
 *
 *   npx tsx scripts/teste-aceite-so-com-automatico.ts
 *
 * Regra do Douglas (06/11/2026): só com o aceite automático ligado ou com a
 * coluna Novos escondida. Fora isso, quem confirma é o Aceitar do painel.
 */
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

// Banco falso: a loja "lida" e se ela está em queda.
let noBanco: Record<string, { autoAcceptOrders: boolean; painelPedidosConfig: unknown }> = {};
let emQueda = false;
let leituras = 0;
(globalThis as any).prisma = {
  user: {
    findUnique: async ({ where }: any) => {
      leituras++;
      return noBanco[where.id] ?? null;
    },
  },
  $executeRawUnsafe: async () => 0,
  $queryRaw: async () => [{ emQueda }],
  $queryRawUnsafe: async () => [{ existe: true }],
};

(async () => {
  const { aceitaSozinhoAgora } = await import("../src/lib/loja-sem-conexao-no-banco");

  confere("aceite automático ligado: confirma", await aceitaSozinhoAgora({ id: "a", autoAcceptOrders: true, painelPedidosConfig: null }), true);
  confere("desligado: espera o Aceitar", await aceitaSozinhoAgora({ id: "b", autoAcceptOrders: false, painelPedidosConfig: null }), false);
  confere("desligado com a coluna Novos escondida: confirma", await aceitaSozinhoAgora({ id: "c", autoAcceptOrders: false, painelPedidosConfig: { colunaNovos: false } }), true);
  confere("coluna Novos visível não muda nada", await aceitaSozinhoAgora({ id: "d", autoAcceptOrders: false, painelPedidosConfig: { colunaNovos: true, colunaProntos: true } }), false);

  leituras = 0;
  noBanco = { e: { autoAcceptOrders: true, painelPedidosConfig: null }, f: { autoAcceptOrders: false, painelPedidosConfig: null } };
  confere("loja sem os campos (Brendi, resgate do iFood) é lida do banco: ligado", await aceitaSozinhoAgora({ id: "e" }), true);
  confere("…e desligado", await aceitaSozinhoAgora({ id: "f" }), false);
  confere("uma leitura por chamada", leituras, 2);
  leituras = 0;
  await aceitaSozinhoAgora({ id: "a", autoAcceptOrders: true, painelPedidosConfig: null });
  confere("com os campos, não lê o banco", leituras, 0);
  confere("loja que não existe: não confirma", await aceitaSozinhoAgora({ id: "x" }), false);

  emQueda = true;
  confere("loja em queda não confirma nem com o aceite ligado", await aceitaSozinhoAgora({ id: "a", autoAcceptOrders: true, painelPedidosConfig: null }), false);

  console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
  process.exit(falhas ? 1 : 0);
})();

export {};
