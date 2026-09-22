/**
 * Harness da baixa do KDS por tela (src/lib/kds-telas.ts).
 *
 * O caso que originou tudo: a NIK separa a cozinha em tela de esfirra e tela
 * de pizza. Um pedido com 20 esfirras e 1 pizza aparece nas duas, e a baixa da
 * esfirra estava finalizando o pedido inteiro — sumia da tela de pizza, que
 * nem tinha começado, e ia direto para a finalização (21/09/2026).
 *
 * Roda o TS direto, via jiti, sem tocar no banco: a regra é função pura.
 */
const path = require("path");
const createJiti = require("jiti");

const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "..", "src") },
  interopDefault: true,
  esmResolve: true,
});

const { telasComItem, faltaTelaDarBaixa, chaveDaTela, telaMostraItem, telaPrecisaDarBaixa } =
  jiti(path.resolve(__dirname, "..", "src", "lib", "kds-telas.ts"));

let ok = 0;
let falhou = 0;
function conferir(nome, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) { ok++; console.log("  ok   " + nome); }
  else { falhou++; console.log("  FALHA " + nome + "\n       esperado " + b + "\n       obtido   " + a); }
}

// ── O cenário da NIK ────────────────────────────────────────────────────────
const ESFIRRA = { id: "t-esfirra", name: "Esfirras", stage: "production", categoryFilter: ["Esfihas"] };
const PIZZA   = { id: "t-pizza",   name: "Pizzas",   stage: "production", categoryFilter: ["Pizzas"] };
const FINAL   = { id: "t-final",   name: "Expedição", stage: "finishing",  categoryFilter: [] };
const TELAS = [ESFIRRA, PIZZA, FINAL];

const pedidoMisto = [
  { menuProduct: { category: "Esfihas" } },
  { menuProduct: { category: "Pizzas" } },
];
const soEsfirra = [{ menuProduct: { category: "Esfihas" } }];

console.log("\nquais telas precisam dar baixa");
conferir("pedido misto -> as duas de producao", telasComItem(TELAS, pedidoMisto, "production"), ["t-esfirra", "t-pizza"]);
conferir("so esfirra -> so a de esfirra", telasComItem(TELAS, soEsfirra, "production"), ["t-esfirra"]);
conferir("finalizacao sem filtro pega tudo", telasComItem(TELAS, pedidoMisto, "finishing"), ["t-final"]);

console.log("\na baixa de uma tela nao finaliza o pedido");
conferir("misto, so a esfirra deu baixa -> AINDA falta", faltaTelaDarBaixa(TELAS, pedidoMisto, "production", ["t-esfirra"]), true);
conferir("misto, as duas deram baixa -> pode avancar", faltaTelaDarBaixa(TELAS, pedidoMisto, "production", ["t-esfirra", "t-pizza"]), false);
conferir("misto, ninguem deu baixa -> falta", faltaTelaDarBaixa(TELAS, pedidoMisto, "production", []), true);

console.log("\nquem tem uma tela so nao muda de comportamento");
conferir("so esfirra, a esfirra deu baixa -> avanca", faltaTelaDarBaixa(TELAS, soEsfirra, "production", ["t-esfirra"]), false);
conferir("loja sem telas configuradas -> avanca sempre", faltaTelaDarBaixa([], pedidoMisto, "production", []), false);
conferir("uma tela so, sem filtro -> avanca", faltaTelaDarBaixa([FINAL], pedidoMisto, "finishing", []), false);

console.log("\nas telas do OUTRO estagio nao seguram");
conferir("producao nao espera a finalizacao", faltaTelaDarBaixa(TELAS, pedidoMisto, "production", ["t-esfirra", "t-pizza"]), false);

console.log("\nitem sem categoria: MOSTRA em toda tela, mas nao PRENDE nenhuma");
const semCategoria = [{ menuProduct: { category: null } }];
conferir("mostra na tela de esfirra", telaMostraItem(ESFIRRA, semCategoria[0]), true);
conferir("mostra na tela de pizza", telaMostraItem(PIZZA, semCategoria[0]), true);
conferir("NAO exige baixa da esfirra", telaPrecisaDarBaixa(ESFIRRA, semCategoria[0]), false);
conferir("NAO exige baixa da pizza", telaPrecisaDarBaixa(PIZZA, semCategoria[0]), false);
conferir("orfao sozinho nao prende ninguem", telasComItem(TELAS, semCategoria, "production"), []);
conferir("orfao nao trava o pedido", faltaTelaDarBaixa(TELAS, semCategoria, "production", []), false);

// O caso que o dono levantou (21/09/2026): a loja tem uma tela que ninguem
// abre. Um item orfao nao pode transformar essa tela em refem do pedido.
const ESQUECIDA = { id: "t-abandonada", name: "Sobremesas", stage: "production", categoryFilter: ["Sobremesas"] };
const TRES_TELAS = [ESFIRRA, PIZZA, ESQUECIDA];
const esfirraMaisOrfao = [{ menuProduct: { category: "Esfihas" } }, semCategoria[0]];
conferir("esfirra + orfao: so a esfirra prende", telasComItem(TRES_TELAS, esfirraMaisOrfao, "production"), ["t-esfirra"]);
conferir("a baixa da esfirra libera o pedido", faltaTelaDarBaixa(TRES_TELAS, esfirraMaisOrfao, "production", ["t-esfirra"]), false);

// A bebida do exemplo do dono: nenhuma tela a mostra.
const BEBIDA = { menuProduct: { category: "Bebidas" } };
const esfirraMaisBebida = [{ menuProduct: { category: "Esfihas" } }, BEBIDA];
conferir("bebida nao aparece na tela de esfirra", telaMostraItem(ESFIRRA, BEBIDA), false);
conferir("esfirra + bebida: so a esfirra prende", telasComItem(TELAS, esfirraMaisBebida, "production"), ["t-esfirra"]);
conferir("e o pedido anda com a baixa da esfirra", faltaTelaDarBaixa(TELAS, esfirraMaisBebida, "production", ["t-esfirra"]), false);
conferir("tela com filtro mostra item sem categoria", telaMostraItem(ESFIRRA, { menuProduct: { category: "" } }), true);
conferir("tela com filtro NAO mostra categoria alheia", telaMostraItem(ESFIRRA, { menuProduct: { category: "Pizzas" } }), false);

console.log("\nchave da tela");
conferir("usa o id quando existe", chaveDaTela({ id: "abc", name: "Esfirras" }), "abc");
conferir("cai no nome quando nao ha id (link antigo)", chaveDaTela({ name: "Esfirras" }), "nome:esfirras");
conferir("sem id e sem nome -> vazio", chaveDaTela({}), "");

console.log("\nbaixa repetida da mesma tela nao destrava nada");
conferir("esfirra duas vezes -> ainda falta a pizza", faltaTelaDarBaixa(TELAS, pedidoMisto, "production", ["t-esfirra", "t-esfirra"]), true);

console.log("\n" + ok + " ok, " + falhou + " falharam\n");
process.exit(falhou ? 1 : 0);
