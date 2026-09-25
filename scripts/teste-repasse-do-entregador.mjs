/**
 * Prova do repasse ao entregador — o número que a loja paga de verdade.
 *
 *   node scripts/teste-repasse-do-entregador.mjs
 *
 * O caso que originou tudo está no item 4: pedido de iFood com taxa de R$ 6,94
 * que o Lucas via no acerto de uma entrega que ele paga R$ 2,00.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/repasse-do-entregador.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const M = await import("data:text/javascript," + encodeURIComponent(js));
const {
  lerRegraDeRepasse, repasseDaFaixaKm, repasseDoBairro, repasseDoPedido,
  repasseDaZona, explicarRegraDoApp, REPASSE_PADRAO,
} = M;

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};

const FAIXAS = [
  { km: 1, time: 20, fee: 3.5, motoboyFee: 3 },
  { km: 2, time: 30, fee: 4, motoboyFee: 3 },
  { km: 3, time: 40, fee: 5, motoboyFee: 4 },
];
const BAIRROS = [
  { name: "Centro", time: 30, fee: 6, motoboyFee: 4 },
  { name: "Trindade", time: 45, fee: 9, motoboyFee: 7 },
  { name: "Vila Nova", time: 45, fee: 8 },
];
const SEPARADO = { separado: true, marketplace: "TABELA" };

console.log("\n1) Leitura da configuração");
conferir("sem nada gravado, nasce desligada", lerRegraDeRepasse(undefined).separado === false);
conferir("e o padrão do app é a TABELA da loja", lerRegraDeRepasse(undefined).marketplace === "TABELA");
conferir("lê o que a loja gravou",
  lerRegraDeRepasse({ repasseDoEntregador: { separado: true, marketplace: "APP" } }).marketplace === "APP");
conferir("valor estranho vira TABELA",
  lerRegraDeRepasse({ repasseDoEntregador: { marketplace: "qualquer coisa" } }).marketplace === "TABELA");
conferir("o padrão exportado bate", REPASSE_PADRAO.separado === false && REPASSE_PADRAO.marketplace === "TABELA");

console.log("\n2) A faixa de distância");
conferir("1,0 km cai na 1ª faixa", repasseDaFaixaKm(FAIXAS, 1) === 3);
conferir("1,5 km cai na faixa de 2 km", repasseDaFaixaKm(FAIXAS, 1.5) === 3);
conferir("2,8 km cai na faixa de 3 km", repasseDaFaixaKm(FAIXAS, 2.8) === 4);
conferir("além da última faixa vale a última", repasseDaFaixaKm(FAIXAS, 12) === 4);
conferir("sem distância não há faixa", repasseDaFaixaKm(FAIXAS, null) === null);
// R6 (25/09/2026): a faixa que COBRE a distância responde. Até aqui a faixa
// sem valor era pulada e a entrega de 0,5 km pagava, calada, o repasse da
// faixa de 5 km. Agora é null, e o acerto cai na regra seguinte.
conferir("faixa sem repasse cadastrado NÃO pega o valor da seguinte",
  repasseDaFaixaKm([{ km: 1, fee: 3 }, { km: 5, fee: 9, motoboyFee: 6 }], 0.5) === null);
conferir("…e a faixa que tem valor continua respondendo",
  repasseDaFaixaKm([{ km: 1, fee: 3 }, { km: 5, fee: 9, motoboyFee: 6 }], 3) === 6);
conferir("distância 0 é entrega: cai na 1ª faixa", repasseDaFaixaKm(FAIXAS, 0) === 3);
conferir("faixa com repasse zero devolve zero",
  repasseDaFaixaKm([{ km: 1, fee: 3, motoboyFee: 0 }, { km: 5, fee: 9, motoboyFee: 6 }], 0.5) === 0);
conferir("nenhuma faixa com repasse = null", repasseDaFaixaKm([{ km: 1, fee: 3 }], 0.5) === null);
conferir("repasse zero é resposta, não ausência", repasseDaZona({ motoboyFee: 0 }) === 0);
conferir("campo vazio não é zero", repasseDaZona({ motoboyFee: "" }) === null && repasseDaZona({}) === null);
conferir("cadastro antigo usa radius/maxKm",
  repasseDaFaixaKm([{ radius: 2, motoboyFee: 5 }], 1.2) === 5 && repasseDaFaixaKm([{ maxKm: 2, motoboyFee: 5 }], 1.2) === 5);

console.log("\n3) O bairro");
conferir("acha pelo nome", repasseDoBairro(BAIRROS, "Trindade") === 7);
conferir("ignora caixa e espaço", repasseDoBairro(BAIRROS, "  centro ") === 4);
conferir("bairro sem repasse = null", repasseDoBairro(BAIRROS, "Vila Nova") === null);
conferir("bairro que não existe = null", repasseDoBairro(BAIRROS, "Outro") === null);

console.log("\n4) O pedido de app — o caso do Lucas");
// iFood cobrou R$ 6,94 do cliente; a loja paga R$ 2,00 ao entregador naquela faixa.
const pedidoIfood = { zonas: [{ km: 3, fee: 5, motoboyFee: 2 }], km: 2.4, taxaDaEntrega: 6.94, ehMarketplace: true };
conferir("com TABELA, paga o que a loja cadastrou (2,00)",
  repasseDoPedido({ regra: SEPARADO, ...pedidoIfood }) === 2,
  `deu ${repasseDoPedido({ regra: SEPARADO, ...pedidoIfood })}`);
conferir("com APP, paga o que veio do app (6,94)",
  repasseDoPedido({ regra: { separado: true, marketplace: "APP" }, ...pedidoIfood }) === 6.94);
conferir("APP vale mesmo sem tabela separada",
  repasseDoPedido({ regra: { separado: false, marketplace: "APP" }, ...pedidoIfood }) === 6.94);
conferir("APP sem taxa no pedido não inventa número",
  repasseDoPedido({ regra: { separado: true, marketplace: "APP" }, zonas: FAIXAS, km: 2, taxaDaEntrega: 0, ehMarketplace: true }) === null);
conferir("a escolha do app não afeta pedido do site",
  repasseDoPedido({ regra: { separado: true, marketplace: "APP" }, zonas: FAIXAS, km: 2.4, taxaDaEntrega: 9, ehMarketplace: false }) === 4);

console.log("\n5) O pedido da loja");
conferir("desligado, a regra não responde",
  repasseDoPedido({ regra: REPASSE_PADRAO, zonas: FAIXAS, km: 2 }) === null);
conferir("ligado, responde pela faixa", repasseDoPedido({ regra: SEPARADO, zonas: FAIXAS, km: 2 }) === 3);
conferir("bairro vence a faixa quando os dois existem",
  repasseDoPedido({ regra: SEPARADO, zonas: BAIRROS, bairro: "Centro", km: 9 }) === 4);
conferir("bairro sem repasse cai na faixa, não na taxa do cliente",
  repasseDoPedido({ regra: SEPARADO, zonas: BAIRROS, bairro: "Vila Nova" }) === null);

console.log("\n6) O texto explica a escolha");
conferir("APP fala do valor do app", /veio do app/.test(explicarRegraDoApp({ separado: true, marketplace: "APP" })));
conferir("TABELA avisa que a taxa do app é do marketplace",
  /dinheiro do marketplace/.test(explicarRegraDoApp({ separado: true, marketplace: "TABELA" })));

console.log(falhas === 0 ? "\nTUDO OK\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
