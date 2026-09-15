import { semRabichoDepoisDaUF } from "@/lib/geocodificacao-servidor";

const CASOS: [string, string][] = [
  // 99Food: observação colada depois da UF — o caso que quebrava.
  ["R . Cuiabá, 742 - Trindade, São Gonçalo - RJ, Em cima da oficina do Eduardo (Dudu)",
   "R . Cuiabá, 742 - Trindade, São Gonçalo - RJ"],
  ["R . Nestor Pinto Alves, 386 - Alcantara, São Gonçalo - RJ, do lado da borracharia",
   "R . Nestor Pinto Alves, 386 - Alcantara, São Gonçalo - RJ"],
  ["R . Aimorés, 64 - Jardim Catarina, São Gonçalo - RJ, lote12 quadra 83",
   "R . Aimorés, 64 - Jardim Catarina, São Gonçalo - RJ"],
  // Sem rabicho: não pode mexer.
  ["Rua Noel Rosa, 137 - Trindade, São Gonçalo - RJ",
   "Rua Noel Rosa, 137 - Trindade, São Gonçalo - RJ"],
  // iFood: o complemento vem ANTES da cidade, com hífen — não pode ser cortado.
  ["R. Augusto Franco, 89 - Comp: Apt 101 - Alcantara - São Gonçalo",
   "R. Augusto Franco, 89 - Comp: Apt 101 - Alcantara - São Gonçalo"],
  // Vírgula antes de algo que NÃO é UF: intocado.
  ["Rua Juazeiro, 326 - Trindade, São Gonçalo",
   "Rua Juazeiro, 326 - Trindade, São Gonçalo"],
  // Complemento curto depois da UF também sai — o que sobra ainda é endereço.
  ["Rua X - RJ, casa 2", "Rua X - RJ"],
  // Toco de verdade: o corte deixaria menos que um endereço, devolve o original.
  ["AB - RJ, casa 2", "AB - RJ, casa 2"],
  // Vazio e nulo não podem explodir.
  ["", ""],
];

let falhas = 0;
for (const [entrada, esperado] of CASOS) {
  const saida = semRabichoDepoisDaUF(entrada);
  const ok = saida === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHA"}  ${JSON.stringify(entrada).slice(0, 60)}\n       -> ${JSON.stringify(saida)}`);
}
console.log(falhas === 0 ? "\nTUDO CERTO" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
