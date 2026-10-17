/**
 * scripts/teste-pedido-de-app-do-entregador.ts — "pagar diferente nos pedidos
 * de app" no cadastro de CADA entregador, por cima da regra antiga da loja.
 *
 * Decisão do dono em 17/10/2026: o quadro da loja no topo da aba Motoboys
 * saiu, e a escolha (igual ao site / valor do app / valor fixo) passou para o
 * cadastro de cada um (lib/repasse-do-entregador.ts, PedidoDeAppDoEntregador;
 * conta em lib/ganho-do-entregador.ts).
 *
 * O que este teste segura:
 *   1. a escolha do entregador vence a da loja, nos dois sentidos;
 *   2. quem nunca escolheu continua EXATAMENTE como antes — loja com APP, com
 *      FIXO e com TABELA (a Delicias de Casa, que passou para a tabela por
 *      bairro em 17/10/2026);
 *   3. pedido do site não muda com escolha nenhuma;
 *   4. a tela mostra o que vale para ele (oQueValeNoApp) e a rota valida o corpo.
 *
 *   npx tsx scripts/teste-pedido-de-app-do-entregador.ts
 */
import { ganhoDoPedido, lerAcerto, oQueValeNoApp, type AcertoDoEntregador } from "../src/lib/ganho-do-entregador";
import { lerPedidoDeAppDoEntregador, lerRegraDeRepasse, pedidoDeAppDoCorpo } from "../src/lib/repasse-do-entregador";
import { composicaoDoGanho } from "../src/lib/resumo-do-entregador";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}${ok ? "" : ` — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`}`);
};

// ── As lojas ────────────────────────────────────────────────────────────────
const LOJA_APP = lerRegraDeRepasse({ repasseDoEntregador: { separado: false, marketplace: "APP" } });
const LOJA_FIXO = lerRegraDeRepasse({ repasseDoEntregador: { separado: false, marketplace: "FIXO", valorFixoApp: 4 } });
const LOJA_FIXO_VAZIO = lerRegraDeRepasse({ repasseDoEntregador: { separado: false, marketplace: "FIXO", valorFixoApp: null } });
const LOJA_TABELA = lerRegraDeRepasse({ repasseDoEntregador: { separado: false, marketplace: "TABELA" } });
// Delicias de Casa (17/10/2026): repasse separado, tabela POR BAIRRO
// preenchida, app pela tabela. O valorFixoApp antigo (4) continua gravado.
const DELICIAS = lerRegraDeRepasse({ repasseDoEntregador: { separado: true, marketplace: "TABELA", valorFixoApp: 4 } });
const BAIRROS_DELICIAS = [
  { name: "Colinas", fee: 6, time: 40, motoboyFee: 4 },
  { name: "Vila Verde", fee: 30, time: 60, motoboyFee: 24.98 },
  { name: "Cidade Praiana", fee: 8, time: 45, motoboyFee: 6 },
];

// ── Os entregadores ─────────────────────────────────────────────────────────
const comEscolha = (base: AcertoDoEntregador, pedidoDeApp: unknown) => lerAcerto({ ...base, pedidoDeApp });
const DIARIA_E_TAXA: AcertoDoEntregador = { paymentType: "DAILY_PLUS_FEE", dailyRate: 50 };
const DIARIA_E_ENTREGA_SEM_VALOR: AcertoDoEntregador = { paymentType: "BOTH", dailyRate: 50, perDeliveryRate: 0 };
const POR_ENTREGA_5: AcertoDoEntregador = { paymentType: "PER_DELIVERY", perDeliveryRate: 5 };
const SO_DIARIA: AcertoDoEntregador = { paymentType: "DAILY_RATE", dailyRate: 60 };
const FAIXA: AcertoDoEntregador = { paymentType: "FAIXA_KM", faixasDeKm: [{ ate: 3, valor: 7 }, { ate: 6, valor: 10 }] };

const IFOOD = { motoboyFee: null, deliveryFee: 6.94, deliveryDistance: 2, customerAddress: "Rua A, 10 - Colinas - Cabo Frio" };
const SITE = { motoboyFee: null, deliveryFee: 8, deliveryDistance: 2 };

const ganho = (acerto: ReturnType<typeof lerAcerto>, regraDaLoja: any, pedido: any, ehMarketplace: boolean, zonas: unknown = []) =>
  ganhoDoPedido({ acerto, pedido, regraDaLoja, zonas, ehMarketplace });

console.log("\n1) Sem escolha própria: tudo como antes");
confere("loja APP, diária + taxa: taxa do app pela regra da loja",
  ganho(lerAcerto(DIARIA_E_TAXA), LOJA_APP, IFOOD, true), { valor: 6.94, origem: "REGRA_DA_LOJA" });
confere("loja FIXO 4, diária + taxa: 4 pela regra da loja",
  ganho(lerAcerto(DIARIA_E_TAXA), LOJA_FIXO, IFOOD, true), { valor: 4, origem: "REGRA_DA_LOJA" });
confere("loja FIXO sem valor: taxa do cliente, como antes",
  ganho(lerAcerto(DIARIA_E_TAXA), LOJA_FIXO_VAZIO, IFOOD, true), { valor: 6.94, origem: "TAXA_DO_CLIENTE" });
confere("loja TABELA sem repasse separado: taxa do cliente",
  ganho(lerAcerto(DIARIA_E_TAXA), LOJA_TABELA, IFOOD, true), { valor: 6.94, origem: "TAXA_DO_CLIENTE" });
confere("loja FIXO, por entrega R$ 5: o acerto dele continua na frente da regra da loja",
  ganho(lerAcerto(POR_ENTREGA_5), LOJA_FIXO, IFOOD, true), { valor: 5, origem: "POR_ENTREGA" });
confere("loja APP, faixa dele: a faixa dele continua na frente",
  ganho(lerAcerto(FAIXA), LOJA_APP, IFOOD, true), { valor: 7, origem: "FAIXA_DELE" });
confere("loja FIXO, só diária: só diária",
  ganho(lerAcerto(SO_DIARIA), LOJA_FIXO, IFOOD, true), { valor: 0, origem: "SO_DIARIA" });
confere("escolha gravada como nulo é o mesmo que nunca ter escolhido",
  ganho(comEscolha(DIARIA_E_TAXA, null), LOJA_FIXO, IFOOD, true), { valor: 4, origem: "REGRA_DA_LOJA" });

console.log("\n2) Delicias de Casa (TABELA por bairro) sem escolha: igual");
const delicias = (acerto: AcertoDoEntregador, endereco: string, ehMarketplace = true) =>
  ganho(lerAcerto(acerto), DELICIAS, { ...IFOOD, customerAddress: endereco }, ehMarketplace, BAIRROS_DELICIAS);
confere("iFood Colinas: 4 do bairro", delicias(DIARIA_E_TAXA, "Rua A, 10 - Colinas - Cabo Frio"), { valor: 4, origem: "REGRA_DA_LOJA" });
confere("iFood Vila Verde: 24,98 do bairro", delicias(DIARIA_E_TAXA, "Rua B, 5 - Vila Verde - Cabo Frio"), { valor: 24.98, origem: "REGRA_DA_LOJA" });
confere("iFood Cidade Praiana (BOTH sem valor por entrega): 6 do bairro",
  delicias(DIARIA_E_ENTREGA_SEM_VALOR, "Rua C, 1 - Cidade Praiana - Cabo Frio"), { valor: 6, origem: "REGRA_DA_LOJA" });
confere("o valorFixoApp antigo (4) que ficou gravado não volta a valer",
  delicias(DIARIA_E_TAXA, "Rua B, 5 - Vila Verde - Cabo Frio").valor !== 4, true);
confere("site com repasse gravado na venda: o gravado",
  ganho(lerAcerto(DIARIA_E_TAXA), DELICIAS, { ...SITE, motoboyFee: 24.98 }, false, BAIRROS_DELICIAS), { valor: 24.98, origem: "GRAVADO" });
confere("tela: Delicias sem escolha mostra 'igual aos pedidos do site'",
  oQueValeNoApp({ acerto: lerAcerto(DIARIA_E_TAXA), regraDaLoja: DELICIAS }), { modo: "IGUAL", valor: null, daLoja: false });

console.log("\n3) A escolha do entregador vence a da loja");
confere("loja APP, ele FIXO 3: 3",
  ganho(comEscolha(DIARIA_E_TAXA, { modo: "FIXO", valor: 3 }), LOJA_APP, IFOOD, true), { valor: 3, origem: "FIXO_NO_APP" });
confere("loja FIXO 4, ele APP: a taxa do app",
  ganho(comEscolha(DIARIA_E_TAXA, { modo: "APP" }), LOJA_FIXO, IFOOD, true), { valor: 6.94, origem: "VALOR_DO_APP" });
confere("loja FIXO 4, ele IGUAL: a regra antiga da loja sai (taxa do pedido, como no site)",
  ganho(comEscolha(DIARIA_E_TAXA, { modo: "IGUAL" }), LOJA_FIXO, IFOOD, true), { valor: 6.94, origem: "TAXA_DO_CLIENTE" });
confere("loja APP, ele IGUAL com por entrega 5: 5",
  ganho(comEscolha(POR_ENTREGA_5, { modo: "IGUAL" }), LOJA_APP, IFOOD, true), { valor: 5, origem: "POR_ENTREGA" });
confere("Delicias, ele IGUAL: a tabela do bairro, como sem escolha",
  ganho(comEscolha(DIARIA_E_TAXA, { modo: "IGUAL" }), DELICIAS, { ...IFOOD, customerAddress: "Rua B, 5 - Vila Verde - Cabo Frio" }, true, BAIRROS_DELICIAS),
  { valor: 24.98, origem: "REGRA_DA_LOJA" });
confere("Delicias, ele FIXO 4: 4 mesmo na Vila Verde",
  ganho(comEscolha(DIARIA_E_TAXA, { modo: "FIXO", valor: 4 }), DELICIAS, { ...IFOOD, customerAddress: "Rua B, 5 - Vila Verde - Cabo Frio" }, true, BAIRROS_DELICIAS),
  { valor: 4, origem: "FIXO_NO_APP" });
confere("FIXO vence o valor por entrega e a faixa dele (é o 'diferente' do site)",
  [ganho(comEscolha(POR_ENTREGA_5, { modo: "FIXO", valor: 3 }), LOJA_TABELA, IFOOD, true).valor,
    ganho(comEscolha(FAIXA, { modo: "FIXO", valor: 3 }), LOJA_TABELA, IFOOD, true).valor], [3, 3]);
confere("só diária no site + R$ 3 no app: 3",
  ganho(comEscolha(SO_DIARIA, { modo: "FIXO", valor: 3 }), LOJA_TABELA, IFOOD, true), { valor: 3, origem: "FIXO_NO_APP" });
confere("FIXO zero é resposta (o app manda o entregador dele)",
  ganho(comEscolha(POR_ENTREGA_5, { modo: "FIXO", valor: 0 }), LOJA_TABELA, IFOOD, true), { valor: 0, origem: "FIXO_NO_APP" });
confere("APP com o app sem taxa: segue o acerto normal dele",
  ganho(comEscolha(POR_ENTREGA_5, { modo: "APP" }), LOJA_TABELA, { ...IFOOD, deliveryFee: 0 }, true), { valor: 5, origem: "POR_ENTREGA" });
confere("gravado no pedido continua vencendo a escolha",
  ganho(comEscolha(DIARIA_E_TAXA, { modo: "FIXO", valor: 3 }), LOJA_TABELA, { ...IFOOD, motoboyFee: 9 }, true), { valor: 9, origem: "GRAVADO" });

console.log("\n4) Pedido do site não muda com escolha nenhuma");
for (const escolha of [{ modo: "APP" }, { modo: "FIXO", valor: 3 }, { modo: "IGUAL" }]) {
  confere(`site, escolha ${escolha.modo}: por entrega 5`,
    ganho(comEscolha(POR_ENTREGA_5, escolha), LOJA_APP, SITE, false), { valor: 5, origem: "POR_ENTREGA" });
}
confere("site, só diária com FIXO no app: só diária",
  ganho(comEscolha(SO_DIARIA, { modo: "FIXO", valor: 3 }), LOJA_TABELA, SITE, false), { valor: 0, origem: "SO_DIARIA" });

console.log("\n5) A tela mostra o que vale para ele");
confere("com escolha própria: a dele",
  oQueValeNoApp({ acerto: comEscolha(POR_ENTREGA_5, { modo: "FIXO", valor: 3.5 }), regraDaLoja: LOJA_APP }), { modo: "FIXO", valor: 3.5, daLoja: false });
confere("sem escolha, loja FIXO e a regra chega nele: FIXO da loja",
  oQueValeNoApp({ acerto: lerAcerto(DIARIA_E_TAXA), regraDaLoja: LOJA_FIXO }), { modo: "FIXO", valor: 4, daLoja: true });
confere("sem escolha, loja APP e a regra chega nele: APP da loja",
  oQueValeNoApp({ acerto: lerAcerto(DIARIA_E_TAXA), regraDaLoja: LOJA_APP }), { modo: "APP", valor: null, daLoja: true });
confere("sem escolha, loja FIXO mas ele tem por entrega: igual (a regra não chegava nele)",
  oQueValeNoApp({ acerto: lerAcerto(POR_ENTREGA_5), regraDaLoja: LOJA_FIXO }), { modo: "IGUAL", valor: null, daLoja: false });
confere("sem escolha, loja FIXO sem valor: igual",
  oQueValeNoApp({ acerto: lerAcerto(DIARIA_E_TAXA), regraDaLoja: LOJA_FIXO_VAZIO }), { modo: "IGUAL", valor: null, daLoja: false });
confere("sem escolha, só diária na loja APP: igual",
  oQueValeNoApp({ acerto: lerAcerto(SO_DIARIA), regraDaLoja: LOJA_APP }), { modo: "IGUAL", valor: null, daLoja: false });
// O que a tela diz bate com a conta, nos casos em que a regra da loja chega nele.
confere("tela e conta concordam (loja FIXO, diária + taxa)",
  ganho(lerAcerto(DIARIA_E_TAXA), LOJA_FIXO, IFOOD, true).valor, oQueValeNoApp({ acerto: lerAcerto(DIARIA_E_TAXA), regraDaLoja: LOJA_FIXO }).valor);

console.log("\n6) Leitura e corpo da rota");
confere("FIXO sem valor é nulo", lerPedidoDeAppDoEntregador({ modo: "FIXO" }), null);
confere("FIXO com texto '4,5' não vale (a tela manda número)", lerPedidoDeAppDoEntregador({ modo: "FIXO", valor: "4,5" }), null);
confere("FIXO com '4.5' vale", lerPedidoDeAppDoEntregador({ modo: "FIXO", valor: "4.5" }), { modo: "FIXO", valor: 4.5 });
confere("JSON em texto", lerPedidoDeAppDoEntregador('{"modo":"APP"}'), { modo: "APP" });
confere("modo desconhecido é nulo", lerPedidoDeAppDoEntregador({ modo: "TABELA" }), null);
confere("corpo ausente: não mexe", pedidoDeAppDoCorpo(undefined), { acao: "manter" });
confere("corpo nulo: volta a seguir a loja", pedidoDeAppDoCorpo(null), { acao: "gravar", escolha: null });
confere("corpo FIXO sem valor: recusa com o motivo",
  pedidoDeAppDoCorpo({ modo: "FIXO", valor: "" }), { acao: "recusar", erro: "Preencha quanto ele recebe por entrega de app." });
confere("corpo válido: grava", pedidoDeAppDoCorpo({ modo: "FIXO", valor: 4 }), { acao: "gravar", escolha: { modo: "FIXO", valor: 4 } });

console.log("\n7) O relatório explica de onde veio");
const comp = composicaoDoGanho([
  { origemDoGanho: "FIXO_NO_APP", ganhoDoMotoboy: 4, corrida: true },
  { origemDoGanho: "FIXO_NO_APP", ganhoDoMotoboy: 4, corrida: true },
  { origemDoGanho: "VALOR_DO_APP", ganhoDoMotoboy: 6.94, corrida: true },
]);
confere("linhas com rótulo próprio",
  comp.map((c) => [c.rotulo, c.qtd, c.valor]),
  [["Pedido de app: valor fixo", 2, 8], ["Pedido de app: taxa que veio do app", 1, 6.94]]);

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1); }
console.log("\nTudo certo.");
