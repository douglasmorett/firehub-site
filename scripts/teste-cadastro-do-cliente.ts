/**
 * O "Editar cadastro" da ficha do cliente (lib/cadastro-do-cliente.ts) — o
 * que a tela manda e o que é gravado. Pedido do Flavio (Showrrascão, 11/10/2026).
 *
 *   npx tsx scripts/teste-cadastro-do-cliente.ts
 *
 * A consulta da lista com a edição roda em scripts/teste-clientes-da-loja.ts;
 * a busca do balcão em scripts/teste-busca-de-clientes.ts.
 */
import { aniversarioBonito, lerAniversario, lerCadastro } from "../src/lib/cadastro-do-cliente";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

console.log("\n— Aniversário —");
confere("dia/mês", lerAniversario("15/3"), "15/03");
confere("dia/mês/ano", lerAniversario("05/11/1990"), "05/11/1990");
confere("ano com 2 dígitos", [lerAniversario("05/11/90"), lerAniversario("05/11/08")], ["05/11/1990", "05/11/2008"]);
confere("com hífen ou ponto", [lerAniversario("15-03"), lerAniversario("15.03.1990")], ["15/03", "15/03/1990"]);
confere("o AAAA-MM-DD do cadastro do site", lerAniversario("1990-03-15"), "15/03/1990");
confere("29/02 sem ano vale; 29/02/2023 não", [lerAniversario("29/02"), lerAniversario("29/02/2023")], ["29/02", undefined]);
confere("data que não existe", [lerAniversario("31/04"), lerAniversario("10/13"), lerAniversario("0/5"), lerAniversario("amanhã")], [undefined, undefined, undefined, undefined]);
confere("vazio = sem aniversário", lerAniversario("  "), null);
confere("a ficha mostra o do site em dia/mês/ano", aniversarioBonito("1990-03-15"), "15/03/1990");

console.log("\n— O que a tela manda —");
confere("tudo preenchido, com espaços sobrando",
  lerCadastro({ nome: "  João   da Silva ", aniversario: "1/2", endereco: " Rua A,  10 - Centro ", observacao: "Portão azul\r\nSem cebola " }),
  { ok: true, campos: { nome: "João da Silva", aniversario: "01/02", endereco: "Rua A, 10 - Centro", observacao: "Portão azul\nSem cebola" } });
confere("tudo vazio = apagar a correção", lerCadastro({}), { ok: true, campos: { nome: null, aniversario: null, endereco: null, observacao: null } });
confere("aniversário errado é recusado", lerCadastro({ nome: "Ana", aniversario: "32/01" }).ok, false);
confere("nome sem letras é recusado", lerCadastro({ nome: "12" }).ok, false);
const longo = lerCadastro({ nome: "x".repeat(200), observacao: "y".repeat(900) });
confere("nome e observação cortados no limite", longo.ok ? [longo.campos.nome?.length, longo.campos.observacao?.length] : null, [80, 500]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
