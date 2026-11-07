/**
 * Trava o filtro de aniversariantes da aba Clientes e o texto do parabéns
 * (lib/clientes-da-loja-regras.ts).
 *
 *   npx tsx scripts/teste-aniversariantes.ts
 *
 * O aniversário chega de três jeitos: o site grava "1990-03-15", o "Editar
 * cadastro" grava "15/03" ou "15/03/1990", e cadastro trazido de outro
 * sistema às vezes vem com lixo. O parabéns é um link wa.me com o texto
 * pronto — nada sai sozinho.
 */
import {
  aniversariantes, linkDoParabens, mensagemDeAniversario, mesEDiaDoAniversario, primeiroNome,
} from "../src/lib/clientes-da-loja-regras";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

console.log("\n1) Ler o aniversário");
confere("as três grafias", ["1990-03-15", "15/03", "15/03/1990", "5.3.90"].map(mesEDiaDoAniversario),
  [{ mes: 3, dia: 15 }, { mes: 3, dia: 15 }, { mes: 3, dia: 15 }, { mes: 3, dia: 5 }]);
confere("lixo e data impossível não viram aniversário", ["", "amanhã", "31/02", "00/05", "12/13"].map(mesEDiaDoAniversario), [null, null, null, null, null]);
confere("29/02 vale (o ano é o do cliente)", mesEDiaDoAniversario("29/02"), { mes: 2, dia: 29 });

console.log("\n2) Quem faz aniversário");
const base: [string, string][] = [
  ["2299990001", "07/11"], // hoje
  ["2299990002", "02/11/1985"], // já passou neste mês
  ["2299990003", "1992-11-13"], // daqui a 6 dias: ainda na semana
  ["2299990004", "14/11"], // daqui a 7 dias: fora da semana, dentro do mês
  ["2299990005", "01/12"], // outro mês
  ["2299990006", "sem data"],
];
const doMes = aniversariantes(base, "2026-11-07", "mes");
confere("no mês: o mês inteiro, em ordem de data (o que já passou também)",
  doMes.map((a) => [a.chave, a.em, a.hoje, a.jaPassou]),
  [["2299990002", "2026-11-02", false, true], ["2299990001", "2026-11-07", true, false], ["2299990003", "2026-11-13", false, false], ["2299990004", "2026-11-14", false, false]]);
confere("em 7 dias: hoje e os 6 seguintes (o dia 14 fica fora)",
  aniversariantes(base, "2026-11-07", "semana").map((a) => a.chave), ["2299990001", "2299990003"]);
confere("a semana atravessa o ano: em 28/12, o 02/01 é do ano que vem",
  aniversariantes([["a", "02/01"], ["b", "30/12"], ["c", "05/01"]], "2026-12-28", "semana").map((a) => [a.chave, a.em]),
  [["b", "2026-12-30"], ["a", "2027-01-02"]]);
confere("29/02 em ano que não é bissexto: no dia 28", aniversariantes([["x", "29/02/2000"]], "2027-02-25", "semana").map((a) => a.em), ["2027-02-28"]);
confere("29/02 em ano bissexto: no dia 29", aniversariantes([["x", "29/02"]], "2028-02-01", "mes").map((a) => a.em), ["2028-02-29"]);

console.log("\n3) O parabéns");
confere("primeiro nome com a primeira letra maiúscula; genérico não é nome",
  [primeiroNome("ana PAULA souza"), primeiroNome("Cliente"), primeiroNome("  "), primeiroNome(null)], ["Ana", null, null, null]);
confere("com cupom: o código em negrito e o link sozinho na última linha",
  mensagemDeAniversario({ nome: "ana paula", loja: "Hambúrgueria Avenida", cupom: { codigo: "ANIVER10", beneficio: "10% de desconto" }, link: "https://firehubfood.com.br/loja/avenida" }),
  "Feliz aniversário, Ana! 🎉\n\nHambúrgueria Avenida preparou um presente pra você: use o cupom *ANIVER10* e ganhe 10% de desconto no seu próximo pedido.\n\nPeça por aqui:\nhttps://firehubfood.com.br/loja/avenida");
confere("sem cupom e sem nome: só os parabéns; sem link, sem a linha do link",
  mensagemDeAniversario({ nome: "Consumidor", loja: "NIK", cupom: null, link: null }),
  "Feliz aniversário! 🎉\n\nUm dia muito especial pra você, com carinho de NIK!");
const link = linkDoParabens("(22) 99999-0001", "Oi, tudo bem? 🎉");
confere("o link wa.me leva o número com 55 e o texto codificado",
  link, "https://wa.me/5522999990001?text=Oi%2C%20tudo%20bem%3F%20%F0%9F%8E%89");
confere("telefone que não é de cliente (0800 do iFood) não vira link", linkDoParabens("0800 123 4567", "x"), null);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
