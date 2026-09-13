/**
 * Prova da Trilha Premiada — especialmente a regra do ciclo, que é onde dá para
 * errar calado e o cliente descobrir vendo o número mudar sozinho.
 *
 *   node scripts/teste-trilha-premiada.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const js = ts.transpileModule(readFileSync("src/lib/trilha-premiada.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const M = await import("data:text/javascript," + encodeURIComponent(js));
const {
  lerTrilha, calcularProgresso, trilhaValida, chamadaDaTrilha, regrasDaTrilha, nomeDoPremio,
  premiosPendentes, premioDaVez, valorDoPremio, lerResgate, efeitoDoPremio,
} = M;

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? " — " + detalhe : ""));
};

const TRILHA = lerTrilha({
  trilha: {
    ativa: true, janelaDias: 30,
    paradas: [
      { pedidos: 3, tipo: "produto", produtoId: "p1", produtoNome: "Guaramor 290ml" },
      { pedidos: 6, tipo: "frete" },
      { pedidos: 10, tipo: "produto", produtoId: "p2", produtoNome: "Açaí de 300ml" },
    ],
  },
});

const dia = (n) => new Date(2026, 8, n, 20, 0, 0);
const pedidos = (...dias) => dias.map((d, i) => ({ id: "p" + i, createdAt: dia(d), status: "ENTREGUE" }));

console.log("\n1) Leitura e validação da configuração");
conferir("leu as 3 paradas", TRILHA.paradas.length === 3);
conferir("ordenou por pedido", TRILHA.paradas[0].pedidos === 3 && TRILHA.paradas[2].pedidos === 10);
conferir("trilha válida", trilhaValida(TRILHA));
conferir("sem paradas não fica ativa", lerTrilha({ trilha: { ativa: true, paradas: [] } }).ativa === false);
conferir("produto sem id invalida a trilha",
  !trilhaValida(lerTrilha({ trilha: { ativa: true, paradas: [{ pedidos: 2, tipo: "produto" }] } })));
const duplicada = lerTrilha({ trilha: { ativa: true, paradas: [
  { pedidos: 5, tipo: "frete" }, { pedidos: 5, tipo: "desconto", valor: 10 }] } });
conferir("duas paradas no mesmo pedido viram uma", duplicada.paradas.length === 1);
conferir("desconto fora da faixa vira 10%",
  lerTrilha({ trilha: { ativa: true, paradas: [{ pedidos: 2, tipo: "desconto", valor: 900 }] } }).paradas[0].valor === 10);

console.log("\n2) Contagem simples");
let p = calcularProgresso(TRILHA, pedidos(1, 2), dia(3));
conferir("2 pedidos = 2 passos", p.passos === 2);
conferir("falta 1 para a 1ª parada", p.faltam === 1 && p.proxima.pedidos === 3);
conferir("nada conquistado ainda", p.conquistadas.length === 0);

p = calcularProgresso(TRILHA, pedidos(1, 2, 3), dia(4));
conferir("3 pedidos conquistam a 1ª parada", p.conquistadas.length === 1);
conferir("a próxima vira a de 6", p.proxima.pedidos === 6 && p.faltam === 3);

console.log("\n3) Pedido cancelado não conta");
const comCancelado = [
  { id: "a", createdAt: dia(1), status: "ENTREGUE" },
  { id: "b", createdAt: dia(2), status: "CANCELADO" },
  { id: "c", createdAt: dia(3), status: "ENTREGUE" },
];
conferir("cancelado fora da conta", calcularProgresso(TRILHA, comCancelado, dia(4)).passos === 2);
conferir("aguardando pagamento também não conta",
  calcularProgresso(TRILHA, [{ id: "x", createdAt: dia(1), status: "AGUARDANDO_PAGAMENTO" }], dia(2)).passos === 0);

console.log("\n4) A janela de 30 dias");
// Pedidos nos dias 1 e 2; o terceiro 40 dias depois abre ciclo novo.
const longo = [
  { id: "a", createdAt: new Date(2026, 8, 1), status: "ENTREGUE" },
  { id: "b", createdAt: new Date(2026, 8, 2), status: "ENTREGUE" },
  { id: "c", createdAt: new Date(2026, 9, 11), status: "ENTREGUE" },
];
p = calcularProgresso(TRILHA, longo, new Date(2026, 9, 12));
conferir("pedido depois do prazo reabre o ciclo em 1 passo", p.passos === 1, `deu ${p.passos}`);
conferir("o ciclo novo começa no pedido de volta",
  p.cicloComecouEm?.getTime() === new Date(2026, 9, 11).getTime());

// Prazo venceu e o cliente sumiu: zero, sem ciclo aberto.
p = calcularProgresso(TRILHA, pedidos(1, 2), new Date(2026, 10, 20));
conferir("prazo vencido sem pedido novo zera", p.passos === 0 && p.cicloComecouEm === null);

// Sem prazo, nada expira.
const semPrazo = lerTrilha({ trilha: { ...TRILHA, janelaDias: 0, ativa: true } });
p = calcularProgresso(semPrazo, longo, new Date(2027, 0, 1));
conferir("sem prazo a contagem não zera", p.passos === 3, `deu ${p.passos}`);

console.log("\n5) A bandeira reinicia a trilha");
p = calcularProgresso(TRILHA, pedidos(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), dia(11));
conferir("10 pedidos completam a trilha", p.completou && p.passos === 10);
p = calcularProgresso(TRILHA, pedidos(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), dia(12));
conferir("o 11º pedido começa a trilha de novo", p.passos === 1 && !p.completou, `deu ${p.passos}`);
conferir("e a próxima volta a ser a de 3", p.proxima?.pedidos === 3);

console.log("\n6) Cliente novo");
p = calcularProgresso(TRILHA, [], dia(1));
conferir("sem pedido, zero passos", p.passos === 0);
conferir("já aponta a primeira parada", p.proxima?.pedidos === 3);
conferir("chamada convida a começar", /primeiro pedido/i.test(chamadaDaTrilha(p)));

console.log("\n7) O texto fala o que está valendo");
p = calcularProgresso(TRILHA, pedidos(1, 2), dia(3));
conferir("singular no 'falta 1'", chamadaDaTrilha(p) === "Falta 1 pedido para você ganhar Guaramor 290ml.", chamadaDaTrilha(p));
p = calcularProgresso(TRILHA, pedidos(1), dia(2));
conferir("plural em 'faltam 2'", /Faltam 2 pedidos/.test(chamadaDaTrilha(p)), chamadaDaTrilha(p));
const regras = regrasDaTrilha(TRILHA);
conferir("a regra cita o prazo configurado", regras.some((r) => r.includes("30 dias")));
conferir("a regra diz que o ganho não se perde", regras.some((r) => /já ganhou continua seu/i.test(r)));
conferir("a regra diz que cancelado não conta", regras.some((r) => /cancelado/i.test(r)));
const semPrazoRegras = regrasDaTrilha(semPrazo);
conferir("sem prazo, a regra muda junto", semPrazoRegras.some((r) => /não expira/i.test(r)));

console.log("\n8) Nome do prêmio");
conferir("frete", nomeDoPremio({ pedidos: 1, tipo: "frete" }) === "Frete grátis");
conferir("desconto", nomeDoPremio({ pedidos: 1, tipo: "desconto", valor: 15 }) === "15% de desconto");
conferir("produto", nomeDoPremio({ pedidos: 1, tipo: "produto", produtoNome: "Açaí" }) === "Açaí");

console.log("\n9) Trilha desligada não promete nada");
const desligada = lerTrilha({ trilha: { ...TRILHA, ativa: false } });
p = calcularProgresso(desligada, pedidos(1, 2, 3), dia(4));
conferir("sem progresso", p.passos === 0 && p.proxima === null);
conferir("sem chamada", chamadaDaTrilha(p) === "");

console.log("\n10) Pedido de marketplace não anda na trilha");
const comIfood = [
  { id: "a", createdAt: dia(1), status: "ENTREGUE", source: "ONLINE" },
  { id: "b", createdAt: dia(2), status: "ENTREGUE", source: "IFOOD" },
  { id: "c", createdAt: dia(3), status: "ENTREGUE", source: "99FOOD" },
  { id: "d", createdAt: dia(4), status: "ENTREGUE", source: "BALCAO" },
];
conferir("iFood e 99 fora, balcão dentro", calcularProgresso(TRILHA, comIfood, dia(5)).passos === 2,
  `deu ${calcularProgresso(TRILHA, comIfood, dia(5)).passos}`);
conferir("sem source é pedido do site", calcularProgresso(TRILHA, [{ id: "x", createdAt: dia(1), status: "ENTREGUE" }], dia(2)).passos === 1);

console.log("\n11) Prêmio pendente");
conferir("2 pedidos, nada a receber", premiosPendentes(TRILHA, pedidos(1, 2)).length === 0);
let pend = premiosPendentes(TRILHA, pedidos(1, 2, 3));
conferir("3 pedidos liberam o prêmio da 1ª parada", pend.length === 1 && pend[0].pedidos === 3);
conferir("premioDaVez aponta o mesmo", premioDaVez(TRILHA, pedidos(1, 2, 3))?.pedidos === 3);

// O pedido que RESGATA também é um passo: some do pendente e continua contando.
const comResgate = [
  ...pedidos(1, 2, 3),
  { id: "r", createdAt: dia(4), status: "ENTREGUE", trilhaPremio: { pedidos: 3, tipo: "produto", valorAplicado: 12, descricao: "Guaramor 290ml", em: "x" } },
];
conferir("resgatado sai da fila", premiosPendentes(TRILHA, comResgate).length === 0);
conferir("e o pedido do resgate conta como passo", calcularProgresso(TRILHA, comResgate, dia(5)).passos === 4);

// Dois pendentes ao mesmo tempo: entrega um por vez, na ordem.
const seisPedidos = pedidos(1, 2, 3, 4, 5, 6);
pend = premiosPendentes(TRILHA, seisPedidos);
conferir("6 pedidos = dois prêmios na fila", pend.length === 2, `deu ${pend.length}`);
conferir("o primeiro da fila é o mais antigo", pend[0].pedidos === 3 && pend[1].pedidos === 6);

// Promessa central: prazo vencido zera passos, NÃO tira o prêmio já ganho.
const ganhouESumiu = pedidos(1, 2, 3);
conferir("prazo vencido não tira o prêmio ganho",
  premiosPendentes(TRILHA, ganhouESumiu).length === 1 && calcularProgresso(TRILHA, ganhouESumiu, new Date(2026, 11, 1)).passos === 0);

// Cancelado depois de ganhar: a conquista se desfaz junto.
const cancelouDepois = [
  { id: "a", createdAt: dia(1), status: "ENTREGUE" },
  { id: "b", createdAt: dia(2), status: "ENTREGUE" },
  { id: "c", createdAt: dia(3), status: "CANCELADO" },
];
conferir("cancelar desfaz a conquista ainda não usada", premiosPendentes(TRILHA, cancelouDepois).length === 0);

// Já usou e depois cancelaram um pedido: o saldo não vira negativo.
const usouEcancelou = [
  { id: "a", createdAt: dia(1), status: "ENTREGUE" },
  { id: "b", createdAt: dia(2), status: "CANCELADO" },
  { id: "c", createdAt: dia(3), status: "ENTREGUE" },
  { id: "r", createdAt: dia(4), status: "ENTREGUE", trilhaPremio: { pedidos: 3, tipo: "frete", valorAplicado: 8, descricao: "Frete grátis", em: "x" } },
];
conferir("saldo nunca fica negativo", premiosPendentes(TRILHA, usouEcancelou).length === 0);

// Trilha inteira duas vezes: dois prêmios da mesma parada na fila.
const vinte = pedidos(...Array.from({ length: 20 }, (_, i) => i + 1));
const duasVoltas = premiosPendentes(TRILHA, vinte).filter((x) => x.pedidos === 3);
conferir("percorrer duas vezes dá o prêmio duas vezes", duasVoltas.length === 2, `deu ${duasVoltas.length}`);

console.log("\n12) Quanto o prêmio vale no pedido");
const conta = { subtotal: 100, taxaDeEntrega: 8.5, precoDoProduto: 14.9 };
conferir("frete vale a taxa", valorDoPremio({ pedidos: 1, tipo: "frete" }, conta) === 8.5);
conferir("desconto é sobre os itens, não sobre a taxa",
  valorDoPremio({ pedidos: 1, tipo: "desconto", valor: 15 }, conta) === 15);
conferir("produto vale o preço dele", valorDoPremio({ pedidos: 1, tipo: "produto" }, conta) === 14.9);
conferir("frete grátis em retirada não vale nada",
  valorDoPremio({ pedidos: 1, tipo: "frete" }, { subtotal: 50, taxaDeEntrega: 0 }) === 0);

console.log("\n13) Leitura do resgate gravado");
conferir("lê o que foi gravado", lerResgate({ pedidos: 6, tipo: "frete", valorAplicado: 7, descricao: "Frete grátis" })?.pedidos === 6);
conferir("lixo vira null", lerResgate(null) === null && lerResgate({ tipo: "frete" }) === null);
conferir("a regra cita o marketplace", regrasDaTrilha(TRILHA).some((r) => /iFood/.test(r)));
conferir("a regra cita um prêmio por pedido", regrasDaTrilha(TRILHA).some((r) => /um prêmio por pedido/i.test(r)));

console.log("\n14) O prêmio cabe neste pedido?");
const entrega = { subtotal: 60, taxa: 9, entrega: true };
const retirada = { subtotal: 60, taxa: 0, entrega: false };

let ef = efeitoDoPremio({ pedidos: 3, tipo: "frete" }, entrega);
conferir("frete grátis zera a taxa", ef?.zeraTaxa === true && ef?.descontoExtra === 9);
conferir("e grava o resgate com o valor", ef?.resgate.valorAplicado === 9 && ef?.resgate.pedidos === 3);
conferir("frete grátis na RETIRADA não é consumido", efeitoDoPremio({ pedidos: 3, tipo: "frete" }, retirada) === null);
conferir("frete grátis com taxa zero também fica guardado",
  efeitoDoPremio({ pedidos: 3, tipo: "frete" }, { subtotal: 60, taxa: 0, entrega: true }) === null);

ef = efeitoDoPremio({ pedidos: 6, tipo: "desconto", valor: 20 }, entrega);
conferir("desconto abate dos itens", ef?.descontoExtra === 12 && ef?.zeraTaxa === false);
conferir("desconto nunca passa do subtotal",
  efeitoDoPremio({ pedidos: 6, tipo: "desconto", valor: 100 }, entrega)?.descontoExtra === 60);
conferir("sacola vazia não consome desconto",
  efeitoDoPremio({ pedidos: 6, tipo: "desconto", valor: 20 }, { subtotal: 0, taxa: 9, entrega: true }) === null);

const acai = { id: "p9", name: "Açaí 300ml", price: 14.9, active: true };
ef = efeitoDoPremio({ pedidos: 10, tipo: "produto", produtoId: "p9" }, { ...entrega, produto: acai });
conferir("produto entra de graça, sem mexer no total",
  ef?.produtoGratis?.id === "p9" && ef?.descontoExtra === 0 && ef?.zeraTaxa === false);
conferir("e o resgate registra quanto custou à loja", ef?.resgate.valorAplicado === 14.9);
conferir("nome do produto vem do cardápio de HOJE", ef?.resgate.produtoNome === "Açaí 300ml");
conferir("produto desativado fica guardado, não quebra o pedido",
  efeitoDoPremio({ pedidos: 10, tipo: "produto", produtoId: "p9" }, { ...entrega, produto: { ...acai, active: false } }) === null);
conferir("produto apagado do cardápio também",
  efeitoDoPremio({ pedidos: 10, tipo: "produto", produtoId: "p9" }, { ...entrega, produto: null }) === null);

console.log(falhas === 0 ? "\nTUDO OK\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
