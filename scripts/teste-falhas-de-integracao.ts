/**
 * Trava o relatório "Pedidos com falha na integração"
 * (lib/relatorios/falhas-de-integracao.ts).
 *
 *   npx tsx scripts/teste-falhas-de-integracao.ts
 *
 * Os erros são os que o código das integrações grava de verdade: o
 * "Detalhes do pedido falhou: 503" do polling do iFood, o "order/detail
 * recusou … em 2 token(s)" do 99Food das lojas do Lucas Pimenta (12/09/2026),
 * a conta sem auth_token (errno -2) e o banco fora durante a gravação.
 */
import {
  erroEmLinguagemSimples, falhasDoRelatorio, situacaoDaFalha, type FalhaDoBanco,
} from "../src/lib/relatorios/falhas-de-integracao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

console.log("\n1) O erro em linguagem de lojista");
confere("iFood 503 nos detalhes: o app não respondeu",
  erroEmLinguagemSimples("IFOOD", "detalhes do pedido: HTTP 503"), "O iFood não respondeu na hora (fora do ar ou lento).");
confere("iFood 401: a conexão da loja pode ter caído",
  erroEmLinguagemSimples("IFOOD", "detalhes do pedido: HTTP 401"), "O iFood recusou o acesso do FireHub ao pedido: a conexão da loja com o iFood pode ter caído.");
confere("iFood 404: o app não achou o pedido",
  erroEmLinguagemSimples("IFOOD", "detalhes do pedido: HTTP 404"), "O iFood não achou o pedido quando o FireHub foi buscar.");
confere("99Food: o order/detail recusou (mesmo falando em token, não é falta de token)",
  erroEmLinguagemSimples("99FOOD", "order/detail recusou: 10002 shop not authorized"), "O 99Food recusou mandar os detalhes do pedido ao FireHub.");
confere("99Food sem auth_token: reconectar",
  erroEmLinguagemSimples("99FOOD", "nenhuma loja da conta tem auth_token (errno -2)"),
  "A loja não está conectada ao 99Food: o FireHub não tem a chave para buscar o pedido. Reconecte em Integrações.");
confere("banco fora na gravação: é nosso, e não confunde com HTTP",
  erroEmLinguagemSimples("IFOOD", "Invalid `prisma.customerOrder.create()` invocation: Can't reach database server at db:5432"),
  "O banco do FireHub não respondeu na hora (instabilidade do nosso lado).");
confere("fetch failed: o app não respondeu", erroEmLinguagemSimples("IFOOD", "fetch failed"), "O iFood não respondeu na hora (fora do ar ou lento).");
confere("qualquer outro erro: deu erro ao gravar", erroEmLinguagemSimples("99FOOD", "Cannot read properties of undefined (reading 'nome')"),
  "O pedido chegou, mas deu erro ao gravar no FireHub.");

console.log("\n2) A situação de hoje");
confere("entrou depois, com o número do painel", situacaoDaFalha({ pedidoId: "o1", numeroDoPedido: 42, tentativas: 3 }), "Entrou depois — pedido #42");
confere("não entrou, tentou 5 vezes", situacaoDaFalha({ pedidoId: null, numeroDoPedido: null, tentativas: 5 }), "Não entrou (5 tentativas)");
confere("não entrou, uma tentativa", situacaoDaFalha({ pedidoId: null, numeroDoPedido: null, tentativas: 1 }), "Não entrou");

console.log("\n3) O relatório");
const linha = (x: Partial<FalhaDoBanco> & { id: string; primeiraEm: string }): FalhaDoBanco => ({
  plataforma: "IFOOD", pedidoExterno: `ext-${x.id}-0000-1111`, codigo: null, erro: "detalhes do pedido: HTTP 503", tentativas: 1,
  ultimaEm: x.primeiraEm, pedidoId: null, numeroDoPedido: null, ...x,
});
const r = falhasDoRelatorio([
  linha({ id: "a", primeiraEm: "2026-11-07T23:10:00.000Z", pedidoId: "o1", numeroDoPedido: 12, tentativas: 2 }), // 20:10 na loja
  linha({ id: "b", primeiraEm: "2026-11-08T02:30:00.000Z" }), // 23:30 na loja
  linha({ id: "c", primeiraEm: "2026-11-08T04:15:00.000Z", plataforma: "99FOOD", codigo: "8812", erro: "order/detail recusou: 1 x", tentativas: 4 }), // 1:15 da manhã
  linha({ id: "d", primeiraEm: "data ruim" }),
], "America/Sao_Paulo");
confere("totais: 3 falhas válidas, 1 entrou depois, 2 não entraram (a data ruim fica de fora)", [r.total, r.entraram, r.naoEntraram], [3, 1, 2]);
confere("a mais recente primeiro", r.lista.map((l) => l.id), ["c", "b", "a"]);
confere("a 1h15 da manhã é do dia operacional anterior (o dia vira às 5h)", [r.lista[0].dia, r.lista[0].hora], ["2026-11-07", "01:15"]);
confere("o número do app quando veio; sem ele, o começo do id", r.lista.map((l) => l.codigo), ["#8812", "id ext-b-00…", "id ext-a-00…"]);
confere("por plataforma: iFood primeiro", r.porPlataforma, [
  { plataforma: "IFOOD", nome: "iFood", total: 2, naoEntraram: 1 },
  { plataforma: "99FOOD", nome: "99Food", total: 1, naoEntraram: 1 },
]);
confere("a linha do 99Food: o porquê e a situação", [r.lista[0].nomeDaPlataforma, r.lista[0].oQueAconteceu, r.lista[0].situacao],
  ["99Food", "O 99Food recusou mandar os detalhes do pedido ao FireHub.", "Não entrou (4 tentativas)"]);
confere("nada no período: zero, sem inventar plataforma", falhasDoRelatorio([], "America/Sao_Paulo"), { total: 0, entraram: 0, naoEntraram: 0, porPlataforma: [], lista: [] });

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
