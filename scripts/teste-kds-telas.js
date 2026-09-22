/**
 * Harness da baixa do KDS (src/lib/kds-telas.ts).
 *
 * Roda o TS direto, via jiti, sem tocar no banco: a regra é função pura.
 *
 * ── O fluxo que estes testes travam ─────────────────────────────────────────
 *
 * PRODUÇÃO — o pronto é do ITEM. A NIK separa a cozinha em tela de esfirra e
 * tela de pizza. Marcar na de esfirra carimba as esfirras; a pizza continua
 * pendente na tela dela. E o item que aparece nas DUAS telas sai das duas ao
 * ser carimbado uma vez: "se alguém fez, não é pra fazer de novo".
 *
 * FINALIZAÇÃO — o pronto é da TELA. Duas telas de finalização são estações
 * diferentes: a baixa de uma não é a da outra, mesmo sendo o mesmo pedido. Só
 * conta quem MOSTRA o pedido — com uma em ímpar e outra em par, exigir as duas
 * travaria tudo.
 *
 * (decisões do dono, 21 e 22/09/2026)
 */
const path = require("path");
const createJiti = require("jiti");

const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "..", "src") },
  interopDefault: true,
  esmResolve: true,
});

const {
  chaveDaTela,
  telaMostraItem,
  telaPrecisaDarBaixa,
  telasComItem,
  faltaTelaDarBaixa,
  itemPronto,
  itensDaTela,
  telaTemPendencia,
  temAlgoPronto,
  tudoPronto,
  faltaFinalizacao,
  telaMostraPedido,
} = jiti(path.resolve(__dirname, "..", "src", "lib", "kds-telas.ts"));

let ok = 0;
let falhou = 0;
function conferir(nome, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) { ok++; console.log("  ok   " + nome); }
  else { falhou++; console.log("  FALHA " + nome + "\n       esperado " + b + "\n       obtido   " + a); }
}

// ── As telas da NIK ─────────────────────────────────────────────────────────
const ESFIRRA = { id: "t-esfirra", name: "Esfirras", stage: "production", filter: "all", categoryFilter: ["Esfihas"] };
const PIZZA   = { id: "t-pizza",   name: "Pizzas",   stage: "production", filter: "all", categoryFilter: ["Pizzas"] };
const FINAL   = { id: "t-final",   name: "Expedição", stage: "finishing", filter: "all", categoryFilter: [] };

const umaEsfirra = { id: "i1", menuProduct: { category: "Esfihas" }, prontoEm: null };
const umaPizza   = { id: "i2", menuProduct: { category: "Pizzas" },  prontoEm: null };
const carimbado  = (i) => ({ ...i, prontoEm: new Date() });

console.log("\nPRODUCAO: a tela carimba os itens DELA");
conferir("a tela de esfirra ve so a esfirra", itensDaTela(ESFIRRA, [umaEsfirra, umaPizza]).map((i) => i.id), ["i1"]);
conferir("a tela de pizza ve so a pizza", itensDaTela(PIZZA, [umaEsfirra, umaPizza]).map((i) => i.id), ["i2"]);

console.log("\nPRODUCAO: baixa numa tela nao tira o pedido da outra");
const esfirraFeita = [carimbado(umaEsfirra), umaPizza];
conferir("a esfirra terminou o que era dela", telaTemPendencia(ESFIRRA, esfirraFeita), false);
conferir("a pizza AINDA tem o que fazer", telaTemPendencia(PIZZA, esfirraFeita), true);
conferir("e o pedido nao esta todo pronto", tudoPronto(esfirraFeita), false);

console.log("\nPRODUCAO: item em duas telas sai das duas quando alguem faz");
const ORFAO = { id: "i9", menuProduct: { category: null }, prontoEm: null };
conferir("orfao aparece na tela de esfirra", telaMostraItem(ESFIRRA, ORFAO), true);
conferir("orfao aparece na tela de pizza", telaMostraItem(PIZZA, ORFAO), true);
const orfaoFeito = [carimbado(ORFAO)];
conferir("carimbado, sai da esfirra", telaTemPendencia(ESFIRRA, orfaoFeito), false);
conferir("carimbado, sai da pizza tambem", telaTemPendencia(PIZZA, orfaoFeito), false);

console.log("\nFINALIZACAO enxerga na PRIMEIRA baixa, nao na ultima");
conferir("nada pronto -> a expedicao nao ve", temAlgoPronto([umaEsfirra, umaPizza]), false);
conferir("esfirra pronta -> a expedicao JA ve", temAlgoPronto(esfirraFeita), true);
conferir("e sabe que ainda falta chegar coisa", tudoPronto(esfirraFeita), false);
conferir("com tudo carimbado, esta tudo la", tudoPronto([carimbado(umaEsfirra), carimbado(umaPizza)]), true);
conferir("o visto por item e o proprio carimbo", [itemPronto(esfirraFeita[0]), itemPronto(esfirraFeita[1])], [true, false]);

console.log("\nFINALIZACAO: uma tela NAO finaliza pela outra");
const FIM1 = { id: "f1", name: "Expedicao 1", stage: "finishing", filter: "all", categoryFilter: [] };
const FIM2 = { id: "f2", name: "Expedicao 2", stage: "finishing", filter: "all", categoryFilter: [] };
const PEDIDO = { numero: "8825", deliveryType: "DELIVERY" };
conferir("f1 deu baixa -> f2 ainda falta", faltaFinalizacao([FIM1, FIM2], ["f1"], PEDIDO), true);
conferir("as duas deram -> acabou", faltaFinalizacao([FIM1, FIM2], ["f1", "f2"], PEDIDO), false);
conferir("uma tela so -> a primeira baixa fecha", faltaFinalizacao([FIM1], [], PEDIDO), false);
conferir("producao nao conta na finalizacao", faltaFinalizacao([ESFIRRA, PIZZA, FIM1], ["f1"], PEDIDO), false);

console.log("\nFINALIZACAO dividida em impar e par nao trava");
const IMPAR = { id: "f-i", name: "Impares", stage: "finishing", filter: "odd", categoryFilter: [] };
const PAR   = { id: "f-p", name: "Pares",   stage: "finishing", filter: "even", categoryFilter: [] };
const IMPAR_8825 = { numero: "8825", deliveryType: "DELIVERY" };
const PAR_8824   = { numero: "8824", deliveryType: "DELIVERY" };
conferir("a tela de impar mostra o 8825", telaMostraPedido(IMPAR, IMPAR_8825), true);
conferir("a tela de par NAO mostra o 8825", telaMostraPedido(PAR, IMPAR_8825), false);
conferir("8825: so a de impar precisa fechar", faltaFinalizacao([IMPAR, PAR], ["f-i"], IMPAR_8825), false);
conferir("8824: so a de par precisa fechar", faltaFinalizacao([IMPAR, PAR], ["f-p"], PAR_8824), false);
conferir("8825 sem ninguem fechar -> falta", faltaFinalizacao([IMPAR, PAR], [], IMPAR_8825), false);

console.log("\nFINALIZACAO por categoria: a tela que nao ve o pedido nao prende (NIK)");
const FIM_ESF = { id: "fe", name: "Finalizacao Esfihas", stage: "finishing", filter: "all", categoryFilter: ["Esfihas"] };
const FIM_PIZ = { id: "fp", name: "Finalizacao Pizza",   stage: "finishing", filter: "all", categoryFilter: ["Pizzas"] };
const SO_ESFIRRA = [carimbado(umaEsfirra)];
const OS_DOIS = [carimbado(umaEsfirra), carimbado(umaPizza)];
conferir("so esfirra: a de esfirra fecha sozinha", faltaFinalizacao([FIM_ESF, FIM_PIZ], ["fe"], PEDIDO, SO_ESFIRRA), false);
conferir("esfirra + pizza: a de pizza ainda falta", faltaFinalizacao([FIM_ESF, FIM_PIZ], ["fe"], PEDIDO, OS_DOIS), true);
conferir("esfirra + pizza: as duas deram -> acabou", faltaFinalizacao([FIM_ESF, FIM_PIZ], ["fe", "fp"], PEDIDO, OS_DOIS), false);
conferir("item sem categoria aparece nas duas, entao prende as duas", faltaFinalizacao([FIM_ESF, FIM_PIZ], ["fe"], PEDIDO, [carimbado(ORFAO)]), true);
conferir("sem itens a regra antiga vale", faltaFinalizacao([FIM_ESF, FIM_PIZ], ["fe"], PEDIDO, null), true);

console.log("\nfiltro de entrega e retirada");
conferir("tela de delivery mostra delivery", telaMostraPedido({ filter: "delivery" }, { deliveryType: "DELIVERY" }), true);
conferir("tela de delivery nao mostra retirada", telaMostraPedido({ filter: "delivery" }, { deliveryType: "RETIRADA" }), false);
conferir("tela sem filtro mostra tudo", telaMostraPedido({ filter: "all" }, { deliveryType: "RETIRADA" }), true);

console.log("\nitem sem categoria MOSTRA em toda tela, mas nao PRENDE nenhuma");
conferir("NAO exige baixa da esfirra", telaPrecisaDarBaixa(ESFIRRA, ORFAO), false);
conferir("orfao sozinho nao prende ninguem", telasComItem([ESFIRRA, PIZZA, FINAL], [ORFAO], "production"), []);
conferir("orfao nao trava o pedido", faltaTelaDarBaixa([ESFIRRA, PIZZA, FINAL], [ORFAO], "production", []), false);

console.log("\nchave da tela");
conferir("usa o id quando existe", chaveDaTela({ id: "abc", name: "Esfirras" }), "abc");
conferir("cai no nome quando nao ha id (link antigo)", chaveDaTela({ name: "Esfirras" }), "nome:esfirras");
conferir("sem id e sem nome -> vazio", chaveDaTela({}), "");

console.log("\n" + ok + " ok, " + falhou + " falharam\n");
process.exit(falhou ? 1 : 0);
