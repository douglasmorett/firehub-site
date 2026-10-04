/**
 * Quais produtos levam as opções completas no prompt do robô (src/lib/cardapio-citado.ts).
 *
 *   node scripts/teste-cardapio-citado.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/cardapio-citado.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { palavrasDaConversa, produtoCitado } = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const confere = (nome, obtido, esperado) => {
  if (obtido === esperado) { console.log(`  ok    ${nome}`); return; }
  falhas++;
  console.log(`  FALHA ${nome} — veio ${obtido}, esperado ${esperado}`);
};
const grupo = (...nomes) => ({ items: nomes.map((name) => ({ menuProduct: { name } })) });
const xtudo = { name: "X-Tudo", comboGroups: [grupo("Bacon", "Cheddar", "Ovo")] };
const pizza = { name: "Pizza Grande (8 Pedaços)", comboGroups: [grupo("Calabresa", "Frango com Catupiry", "Portuguesa")] };
const smash = { name: "Smash | burger artesanal", comboGroups: [grupo("Suco Del Valle Uva 290ml", "Coca lata")] };
const acai = { name: "Açaí 500ml", comboGroups: [grupo("Leite em pó", "Granola")] };
const c = (...textos) => palavrasDaConversa(textos);

console.log("\n1) Citado pelo nome");
confere("\"quero 1 x tudo\"", produtoCitado(xtudo, c("quero 1 x tudo")), true);
confere("\"xtudo\" grudado", produtoCitado(xtudo, c("me ve um xtudo")), true);
confere("acento e caixa: \"AÇAI\"", produtoCitado(acai, c("tem AÇAI?")), true);
confere("plural: \"pizzas\"", produtoCitado(pizza, c("quais pizzas vocês têm")), true);
confere("nome antes do \"|\"", produtoCitado(smash, c("01 smash")), true);

console.log("\n2) Citado por uma opção");
confere("sabor puxa a pizza: \"calabresa\"", produtoCitado(pizza, c("meio a meio calabresa e portuguesa")), true);
confere("adicional puxa o lanche: \"bacon\"", produtoCitado(xtudo, c("tem lanche com bacon?")), true);
confere("bebida do combo: \"suco de uva\"", produtoCitado(smash, c("01 suco de uva")), true);

console.log("\n3) O que o robô ofereceu no histórico também conta");
confere("robô falou do X-Tudo antes", produtoCitado(xtudo, c("pode ser", "O X-Tudo sai R$ 25,00, quer?")), true);

console.log("\n4) Não citado: só nome e preço");
confere("\"boa noite\"", produtoCitado(xtudo, c("boa noite")), false);
confere("outro produto", produtoCitado(acai, c("quero 2 x tudo")), false);
confere("palavra curta não casa (\"ovo\" < 4 letras)", produtoCitado(xtudo, c("ovo")), false);
confere("conversa vazia", produtoCitado(pizza, c()), false);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
