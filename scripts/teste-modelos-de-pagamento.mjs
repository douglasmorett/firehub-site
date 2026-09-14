/**
 * Prova dos modelos de pagamento do entregador.
 *
 *   node scripts/teste-modelos-de-pagamento.mjs
 *
 * O que está em jogo aqui é quanto uma pessoa recebe no fim do dia. Um campo
 * esquecido embaixo do acerto novo não aparece em tela nenhuma e some direto
 * para dentro do cálculo — por isso a maior parte das provas abaixo é sobre o
 * que o modelo APAGA, não sobre o que ele escreve.
 */
import { readFileSync } from "fs";
import ts from "typescript";

const compilar = (caminho) =>
  ts.transpileModule(readFileSync(caminho, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

// `modelos-de-pagamento` importa `faixas-do-motoboy`: as duas viram data-url e o
// import relativo é reescrito para a url da dependência.
const faixas = "data:text/javascript," + encodeURIComponent(compilar("src/lib/faixas-do-motoboy.ts"));
const fonte = compilar("src/lib/modelos-de-pagamento.ts").replace(/["']\.\/faixas-do-motoboy["']/g, JSON.stringify(faixas));
const M = await import("data:text/javascript," + encodeURIComponent(fonte));

const {
  lerModelosDePagamento, aplicarModelo, modeloDoAcerto, problemasDoModelo,
  explicarModelo, acertoSegueOModelo,
} = M;

let falhas = 0;
const conferir = (nome, ok, detalhe) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};

const TABELA = {
  id: "padrao", nome: "Tabela padrão", paymentType: "FAIXA_KM",
  faixasDeKm: [{ ate: 1, valor: 5 }, { ate: 2, valor: 6 }, { ate: 3, valor: 7 }],
};

console.log("\n1) Ler o que está gravado");
conferir("aceita o modelo inteiro", lerModelosDePagamento([TABELA]).length === 1);
conferir("modelo sem nome é descartado (não dá para escolher pelo nada)",
  lerModelosDePagamento([{ id: "x", nome: "   ", paymentType: "PER_DELIVERY" }]).length === 0);
conferir("tipo desconhecido vira 'por entrega', não quebra a tela",
  lerModelosDePagamento([{ id: "x", nome: "N", paymentType: "INVENTADO" }])[0].paymentType === "PER_DELIVERY");
conferir("id repetido: fica o primeiro",
  lerModelosDePagamento([{ id: "a", nome: "Um" }, { id: "a", nome: "Dois" }]).length === 1);
conferir("lixo não derruba", lerModelosDePagamento(null).length === 0 && lerModelosDePagamento("x").length === 0);
conferir("valor com vírgula decimal é lido",
  lerModelosDePagamento([{ id: "a", nome: "N", paymentType: "PER_DELIVERY", perDeliveryRate: "6,50" }])[0].perDeliveryRate === 6.5);

console.log("\n2) Aplicar no entregador — o que ESCREVE");
const aplicado = aplicarModelo(lerModelosDePagamento([TABELA])[0]);
conferir("tipo vai junto", aplicado.paymentType === "FAIXA_KM");
conferir("as três faixas vão junto", aplicado.faixasDeKm.length === 3 && aplicado.faixasDeKm[2].valor === 7);
conferir("guarda de qual modelo veio", aplicado.modeloDePagamento === "padrao");

console.log("\n3) Aplicar no entregador — o que APAGA (o que paga errado calado)");
const diaria = aplicarModelo(lerModelosDePagamento([
  { id: "d", nome: "Só diária", paymentType: "DAILY_RATE", dailyRate: 100, perDeliveryRate: 7, perKmRate: 2,
    faixasDeKm: [{ ate: 5, valor: 9 }] },
])[0]);
conferir("diária fica", diaria.dailyRate === 100);
conferir("por-entrega que o tipo não usa é zerado", diaria.perDeliveryRate === null, diaria.perDeliveryRate);
conferir("por-km que o tipo não usa é zerado", diaria.perKmRate === null, diaria.perKmRate);
conferir("faixas que o tipo não usa são zeradas", diaria.faixasDeKm.length === 0, diaria.faixasDeKm);
conferir("trocar FAIXA_KM -> PER_DELIVERY não deixa faixa viva embaixo",
  aplicarModelo(lerModelosDePagamento([{ id: "p", nome: "Por entrega", paymentType: "PER_DELIVERY", perDeliveryRate: 6, faixasDeKm: [{ ate: 2, valor: 5 }] }])[0]).faixasDeKm.length === 0);

console.log("\n4) Salvar o acerto da tela como modelo");
const novo = modeloDoAcerto("Turno da noite", { paymentType: "FAIXA_KM", faixasDeKm: [{ ate: 2, valor: 8 }] });
conferir("ganha id próprio", typeof novo.id === "string" && novo.id.length > 3);
conferir("guarda as faixas", novo.faixasDeKm.length === 1 && novo.faixasDeKm[0].valor === 8);
conferir("regravar mantém o id quando informado",
  modeloDoAcerto("X", { paymentType: "PER_DELIVERY", perDeliveryRate: 5 }, "padrao").id === "padrao");

console.log("\n5) O que a tela recusa antes de salvar");
conferir("sem nome", problemasDoModelo(modeloDoAcerto("", { paymentType: "PER_DELIVERY", perDeliveryRate: 5 })).length > 0);
conferir("nome repetido é recusado",
  problemasDoModelo(modeloDoAcerto("Tabela padrão", { paymentType: "PER_DELIVERY", perDeliveryRate: 5 }), [lerModelosDePagamento([TABELA])[0]]).some((s) => /já existe/i.test(s)));
conferir("diária sem valor", problemasDoModelo(modeloDoAcerto("D", { paymentType: "DAILY_RATE" })).some((s) => /diária/i.test(s)));
conferir("faixa sem nenhuma linha", problemasDoModelo(modeloDoAcerto("F", { paymentType: "FAIXA_KM", faixasDeKm: [] })).some((s) => /faixa/i.test(s)));
conferir("modelo bom passa limpo", problemasDoModelo(lerModelosDePagamento([TABELA])[0]).length === 0);

console.log("\n6) A frase que o lojista lê na lista");
conferir("faixa vira escada legível", /até 1 km R\$ 5,00/.test(explicarModelo(lerModelosDePagamento([TABELA])[0])));
conferir("diária + entrega", /Diária de R\$ 100,00 \+ R\$ 7,00 por entrega/.test(
  explicarModelo(lerModelosDePagamento([{ id: "b", nome: "B", paymentType: "BOTH", dailyRate: 100, perDeliveryRate: 7 }])[0])));

console.log("\n7) Este entregador ainda segue o modelo?");
const mod = lerModelosDePagamento([TABELA])[0];
conferir("acabou de aplicar: segue", acertoSegueOModelo(aplicarModelo(mod), mod));
conferir("mexeu numa faixa: não segue mais",
  !acertoSegueOModelo({ paymentType: "FAIXA_KM", faixasDeKm: [{ ate: 1, valor: 5 }, { ate: 2, valor: 6 }, { ate: 3, valor: 9 }] }, mod));
conferir("tirou uma faixa: não segue mais",
  !acertoSegueOModelo({ paymentType: "FAIXA_KM", faixasDeKm: [{ ate: 1, valor: 5 }] }, mod));
conferir("trocou o tipo: não segue mais",
  !acertoSegueOModelo({ paymentType: "PER_DELIVERY", perDeliveryRate: 5 }, mod));

console.log(falhas === 0 ? "\nTUDO OK\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
