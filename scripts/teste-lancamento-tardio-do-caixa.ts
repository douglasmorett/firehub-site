/**
 * A ENTRADA OU RETIRADA ESQUECIDA, LANÇADA NUM CAIXA JÁ FECHADO.
 *
 *   JITI_ALIAS='{"@":"<worktree>/src"}' node node_modules/jiti/lib/jiti-cli.mjs scripts/teste-lancamento-tardio-do-caixa.ts
 *
 * Pedido do Victor na Pizzaria 17 (14/10/2026): esqueceram de lançar a sangria
 * de ontem, e ela tem de contar NAQUELE caixa e corrigir o fechamento dele.
 * Aqui, as funções puras de lib/lancamento-tardio-do-caixa.ts: o esperado anda
 * só a parcela da movimentação, a diferença sai da conta do fechamento, o caixa
 * sem conferência continua sem, e excluir desfaz exatamente o lançado.
 */
import {
  efeitoNoEsperado,
  lancadoDepoisDoFechamento,
  lerValorEmReais,
  motivoDoRegistro,
  recalcularComLancamento,
  retratoComEsperado,
} from "../src/lib/lancamento-tardio-do-caixa";
import { conferenciaGravada, FECHADO_PELO_SISTEMA } from "../src/lib/conferencia-do-caixa";
import { aplicarCorrecao } from "../src/lib/edicao-do-caixa";
import { composicaoDoDinheiroEsperado, resumoDasMovimentacoes } from "../src/lib/resumo-das-movimentacoes";
import { htmlDoFechamentoA4 } from "../src/lib/fechamento-a4";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok    " : "FALHOU"} ${nome}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

// Um caixa de pizzaria: R$ 100 de troco, R$ 250 de vendas em dinheiro, sem
// nenhuma sangria lançada; a gaveta tinha R$ 300 — os R$ 50 do gás saíram e
// ninguém lançou. Cartões e Pix conferidos certinho; R$ 400 pagos online.
const caixa = {
  openingAmount: 100,
  expectedCash: 350, expectedDebit: 200, expectedCredit: 300, expectedPix: 150, expectedVoucher: 0, expectedTotal: 1400,
  closingCash: 300, closingDebit: 200, closingCredit: 300, closingPix: 150, closingVoucher: 0,
  difference: -50, justification: null, notes: null, closedBy: "Operador", closedAt: new Date("2026-10-13T03:10:00Z"),
};

console.log("\n— A retirada esquecida —");
const depois = recalcularComLancamento(caixa, { tipo: "SAIDA", valor: 50 }, "LANCAR");
confere("dinheiro esperado 350 → 300 e total 1.400 → 1.350 (a régua do turno: retirada tira dos dois)", [depois.expectedCash, depois.expectedTotal], [300, 1350]);
confere("a falta de R$ 50 vira 'confere'", depois.difference, 0);
confere("o contado não muda", [depois.closingCash, depois.closingDebit, depois.closingCredit, depois.closingPix, depois.closingVoucher], [300, 200, 300, 150, 0]);
const gravado = { ...caixa, ...depois };
const conf = conferenciaGravada(gravado);
confere("o Histórico/2ª via/PDF leem: CONFERIDO, diferença 0, online intacto (400)", [conf.situacao, conf.diferenca, conf.online], ["CONFERIDO", 0, 400]);
// As vendas em dinheiro, lidas de trás para a frente do esperado gravado, não mudam.
const semRetirada = composicaoDoDinheiroEsperado(caixa.expectedCash, caixa.openingAmount, resumoDasMovimentacoes([]));
const comRetirada = composicaoDoDinheiroEsperado(depois.expectedCash!, caixa.openingAmount, resumoDasMovimentacoes([{ tipo: "SAIDA", valor: 50 }]));
confere("as vendas em dinheiro continuam R$ 250 (a conta das parcelas fecha)", [semRetirada.vendasEmDinheiro, comRetirada.vendasEmDinheiro], [250, 250]);

console.log("\n— Excluir o lançado por engano desfaz exatamente —");
const desfeito = recalcularComLancamento(gravado, { tipo: "SAIDA", valor: 50 }, "EXCLUIR");
confere("volta ao fechamento original", [desfeito.expectedCash, desfeito.expectedTotal, desfeito.difference], [350, 1400, -50]);

console.log("\n— A entrada esquecida —");
const comEntrada = recalcularComLancamento(caixa, { tipo: "ENTRADA", valor: 20 }, "LANCAR");
confere("entrada soma no esperado e aumenta a falta (o dinheiro devia estar na gaveta)", [comEntrada.expectedCash, comEntrada.expectedTotal, comEntrada.difference], [370, 1420, -70]);
confere("efeito: retirada −, entrada +, excluir inverte", [efeitoNoEsperado("SAIDA", 50, "LANCAR"), efeitoNoEsperado("ENTRADA", 20, "LANCAR"), efeitoNoEsperado("SAIDA", 50, "EXCLUIR")], [-50, 20, 50]);

console.log("\n— Dinheiro não contado, caixa sem conferência —");
const soCartoes = { ...caixa, closingCash: null, difference: 0, notes: "Não conferido (fora da diferença): Dinheiro (esperado R$ 350,00)." };
const r1 = recalcularComLancamento(soCartoes, { tipo: "SAIDA", valor: 50 }, "LANCAR");
confere("só os cartões contados: o esperado muda, a diferença não (dinheiro fora dela)", [r1.expectedCash, r1.difference], [300, 0]);
confere("…e a nota diz o esperado novo do dinheiro não conferido", r1.notes, "Não conferido (fora da diferença): Dinheiro (esperado R$ 300,00).");
const encerrado = {
  ...caixa, closingCash: null, closingDebit: null, closingCredit: null, closingPix: null, closingVoucher: null,
  difference: null, closedBy: FECHADO_PELO_SISTEMA, notes: "Turno encerrado automaticamente…",
};
const r2 = recalcularComLancamento(encerrado, { tipo: "SAIDA", valor: 50 }, "LANCAR");
confere("encerrado ao abrir outro: continua sem conferência e com a nota dele", [r2.expectedCash, r2.difference, r2.notes], [300, null, "Turno encerrado automaticamente…"]);
confere("…e o Histórico segue lendo ABRIU_OUTRO", conferenciaGravada({ ...encerrado, ...r2 }).motivo, "ABRIU_OUTRO");
// Caixa antigo com as cinco formas em zero (a "falta" gravada não aconteceu).
const tudoZero = { ...caixa, closingCash: 0, closingDebit: 0, closingCredit: 0, closingPix: 0, closingVoucher: 0, difference: -1000 };
const r3 = recalcularComLancamento(tudoZero, { tipo: "SAIDA", valor: 50 }, "LANCAR");
confere("caixa antigo com tudo em zero continua lido como sem conferência", conferenciaGravada({ ...tudoZero, ...r3 }).motivo, "TUDO_ZERO");
const semEsperado = { closingCash: null, difference: null, expectedCash: null, expectedTotal: null };
confere("caixa sem esperado gravado (encerrado pela rede de segurança): parte de zero", [recalcularComLancamento(semEsperado, { tipo: "ENTRADA", valor: 10 }, "LANCAR").expectedCash], [10]);

console.log("\n— A correção de contagem depois do lançamento usa o esperado novo —");
const corrigido = aplicarCorrecao(gravado, { cash: 290, debit: 200, credit: 300, pix: 150, voucher: 0 }, null);
confere("contado do dinheiro corrigido para 290: falta de 10 contra o esperado de 300", corrigido.difference, -10);

console.log("\n— Lançado depois do fechamento —");
const fechouAs = new Date("2026-10-13T03:10:00Z");
confere("criado depois do closedAt = tardio", lancadoDepoisDoFechamento(new Date("2026-10-14T12:00:00Z"), fechouAs), true);
confere("criado com o caixa aberto = não", lancadoDepoisDoFechamento(new Date("2026-10-13T01:00:00Z"), fechouAs), false);
confere("caixa sem closedAt = não", lancadoDepoisDoFechamento(new Date(), null), false);

console.log("\n— O valor digitado e o registro —");
confere("50,00 | 150.50 | 1.234,50 | 1.500 | R$ 30", [lerValorEmReais("50,00"), lerValorEmReais("150.50"), lerValorEmReais("1.234,50"), lerValorEmReais("1.500"), lerValorEmReais("R$ 30")], [50, 150.5, 1234.5, 1500, 30]);
confere("motivo do registro ao lançar", motivoDoRegistro({ acao: "LANCOU", tipo: "SAIDA", valor: 50, descricao: "gás" }), "Retirada (sangria) de R$ 50,00 lançada depois do fechamento: gás");
confere("motivo do registro ao excluir", motivoDoRegistro({ acao: "EXCLUIU", tipo: "SAIDA", valor: 50, descricao: "gás" }, "lancei duas vezes"), "Excluída a retirada (sangria) de R$ 50,00 lançada depois do fechamento (gás): lancei duas vezes");
confere("o antes guarda o esperado em dinheiro", [retratoComEsperado(caixa).expectedCash, retratoComEsperado(caixa).difference], [350, -50]);

console.log("\n— O PDF diz que foi lançada depois —");
const html = htmlDoFechamentoA4({
  loja: { nome: "Pizzaria 17" },
  fuso: "America/Sao_Paulo",
  abertoEm: new Date("2026-10-12T21:00:00Z"),
  fechadoEm: fechouAs,
  encerradoPor: "Operador",
  trocoInicial: 100,
  conf,
  justificativa: null,
  observacoes: null,
  movimentos: [{ id: "m1", tipo: "SAIDA", valor: 50, descricao: "gás", quem: "Victor", em: new Date("2026-10-14T12:00:00Z"), depoisDoFechamento: true }],
  vendas: null,
  correcoes: { qtd: 1, ultima: { em: new Date("2026-10-14T12:00:00Z"), por: "Victor" } },
  emitido: { em: new Date(), por: "Victor" },
});
confere("a linha da retirada tem o selo", html.includes("lançada depois do fechamento"), true);
confere("o aviso do topo diz 'Fechamento corrigido'", html.includes("Fechamento corrigido em"), true);
confere("o dinheiro esperado do PDF é o recalculado (R$ 300,00)", html.includes("R$ 300,00"), true);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
