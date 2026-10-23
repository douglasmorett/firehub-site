/**
 * O endereço do pedido da 99 (lib/food99-pedido.ts → enderecoDoCliente) sai
 * igual ao de antes, e um house_number feito para travar a RegExp não trava.
 *
 *   npx tsx scripts/teste-endereco-do-99.ts
 */
import { enderecoDoCliente } from "../src/lib/food99-pedido";

let falhas = 0;
function confere(nome: string, ok: boolean, obtido?: unknown) {
  if (ok) console.log(`✅ ${nome}`);
  else { falhas++; console.log(`❌ ${nome} — obtido ${JSON.stringify(obtido)}`); }
}

const casos: [string, any, string][] = [
  ["número já no fim da rua não repete", { poi_address: "Rua das Flores, 893", house_number: "893", city: "Rio das Ostras" }, "Rua das Flores, 893, Rio das Ostras"],
  ["número com espaço no fim da rua não repete", { poi_address: "Av. Brasil 120 ", house_number: "120" }, "Av. Brasil 120"],
  ["número diferente entra", { poi_address: "Rua A, 10", house_number: "100" }, "Rua A, 10, 100"],
  // A RegExp não tira (não há espaço antes), mas a regra de "já escrito" tira — como sempre foi.
  ["número contido em outro número fica como antes", { poi_address: "Rua A 1893", house_number: "893" }, "Rua A 1893"],
  ["rua só com o número", { poi_address: "893", house_number: "893" }, "893"],
  ["sem número", { poi_address: "Rua B", poi_display_name: "Condomínio Sol", city: "Macaé" }, "Rua B, Condomínio Sol, Macaé"],
  ["cidade repetida não entra de novo", { poi_address: "Rua C, 5 - Rio das Ostras", house_number: "7", city: "Rio das Ostras" }, "Rua C, 5 - Rio das Ostras, 7"],
];
for (const [nome, entrada, esperado] of casos) {
  const obtido = enderecoDoCliente(entrada);
  confere(nome, obtido === esperado, obtido);
}

const inicio = Date.now();
enderecoDoCliente({ poi_address: "a".repeat(40) + "!", house_number: "(a+)+$" });
enderecoDoCliente({ poi_address: "Rua X", house_number: "([" });
confere("house_number malicioso não trava nem estoura", Date.now() - inicio < 200, Date.now() - inicio);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
