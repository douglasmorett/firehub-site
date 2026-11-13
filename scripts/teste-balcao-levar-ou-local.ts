/**
 * "Para levar" / "Consumir no local" dentro do Balcão do PDV (Garagem Burger,
 * aprovado pelo Douglas em 13/11/2026).
 *
 *   npx tsx scripts/teste-balcao-levar-ou-local.ts
 *
 * Nada vai a banco. Confere:
 *   1. a etiqueta na observação: quem escreve (venda presencial) e quem lê;
 *   2. o pedido que vai ao Assistente (lib/bairro-na-comanda.ts →
 *      pedidoParaOAssistente, o funil dos três trilhos): `consumoNoBalcao`
 *      pronto, a etiqueta de "para levar" fora do papel, nada muda sem escolha;
 *   3. o PAPEL, pelo código do Assistente (lib/gerado/comanda-do-assistente.ts):
 *      a linha sai logo abaixo do número, em altura dobrada e negrito, no
 *      layout embutido e no modelo da loja, e não se repete na observação;
 *   4. o Assistente que ainda não conhece o campo: "consumir no local" sai na
 *      observação, como qualquer recado;
 *   5. a cópia do celular (comanda-escpos.gerado.ts) faz os mesmos bytes.
 */
import { comandaDoAssistente } from "../src/lib/gerado/comanda-do-assistente";
import { buildEscPos } from "../src/lib/app-firehub/comanda-escpos.gerado";
import { lerPapel } from "../src/lib/papel-da-impressora";
import { blocosParaOAssistente, modeloPadrao } from "../src/lib/comanda-modelo";
import { pedidoParaOAssistente } from "../src/lib/bairro-na-comanda";
import {
  consumoDoPedido,
  lerConsumoNoBalcao,
  notasComConsumo,
  notasSemConsumo,
} from "../src/lib/balcao-levar-ou-local";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n     obtido   ${JSON.stringify(obtido)}\n     esperava ${JSON.stringify(esperado)}`}`);
};

// ── 1. A etiqueta ────────────────────────────────────────────────────────────
confere("o corpo aceita LEVAR e LOCAL (qualquer caixa)", [lerConsumoNoBalcao("levar"), lerConsumoNoBalcao(" LOCAL ")], ["LEVAR", "LOCAL"]);
confere("e recusa o resto (pedido grava como hoje)", [lerConsumoNoBalcao(undefined), lerConsumoNoBalcao("MESA"), lerConsumoNoBalcao("")], [null, null, null]);
confere("a etiqueta vem antes do recado da loja", notasComConsumo("sem cebola", "LOCAL"), "[Balcão: consumir no local] sem cebola");
confere("sem recado, só a etiqueta", notasComConsumo("", "LEVAR"), "[Balcão: para levar]");
confere("sem escolha, a observação fica igual", notasComConsumo("sem cebola", null), "sem cebola");

const balcao = (notes: string) => ({ deliveryType: "RETIRADA", notes });
confere("lê a escolha do pedido de balcão",
  [consumoDoPedido(balcao("[Balcão: consumir no local] sem cebola")), consumoDoPedido(balcao("[Balcão: para levar]"))], ["LOCAL", "LEVAR"]);
confere("lê sem o til (texto que perdeu o acento)", consumoDoPedido(balcao("[Balcao: Consumir no local]")), "LOCAL");
confere("pedido que virou entrega ou mesa: a etiqueta velha não vale",
  [consumoDoPedido({ deliveryType: "DELIVERY", notes: "[Balcão: consumir no local]" }), consumoDoPedido({ deliveryType: "MESA", notes: "[Balcão: para levar]" })], [null, null]);
confere("sem etiqueta, nada", [consumoDoPedido(balcao("sem cebola")), consumoDoPedido({ deliveryType: "RETIRADA", notes: null } as any)], [null, null]);
confere("o card mostra a observação sem a etiqueta", notasSemConsumo("[Balcão: consumir no local] sem cebola"), "sem cebola");
confere("observação sem etiqueta volta igual (e null continua null)", [notasSemConsumo("sem cebola"), notasSemConsumo(null)], ["sem cebola", null]);

// ── 2. O pedido que vai ao Assistente ───────────────────────────────────────
const base = {
  id: "teste", dailyOrderNumber: 12, customerName: "Balcão", customerPhone: "00000000000",
  customerAddress: "Balcão", deliveryType: "RETIRADA", source: "PRESENCIAL", paymentMethod: "Dinheiro",
  items: [{ name: "X-Bacon", qty: 1, price: 32 }], totalAmount: 32, deliveryFee: 0,
  createdAt: "2026-11-13T22:00:00.000Z",
};
const local = pedidoParaOAssistente({ ...base, notes: "[Balcão: consumir no local] sem cebola" });
confere("consumir no local: `consumoNoBalcao` pronto", (local as any).consumoNoBalcao, "CONSUMIR NO LOCAL");
confere("e a etiqueta fica na observação (o Assistente antigo a imprime)", local.notes, "[Balcão: consumir no local] sem cebola");
const levar = pedidoParaOAssistente({ ...base, notes: "[Balcão: para levar] sem cebola" });
confere("para levar: `consumoNoBalcao` pronto", (levar as any).consumoNoBalcao, "PARA LEVAR");
confere("e a etiqueta sai da observação do papel (o padrão não vira recado em toda venda)", levar.notes, "sem cebola");
const soLevar = pedidoParaOAssistente({ ...base, notes: "[Balcão: para levar]" });
confere("só a etiqueta de levar: observação vazia", soLevar.notes, "");
const semEscolha = { ...base, notes: "sem cebola" };
confere("sem escolha, o MESMO pedido (nada muda)", pedidoParaOAssistente(semEscolha) === semEscolha, true);
const entrega = pedidoParaOAssistente({ ...base, deliveryType: "DELIVERY", notes: "[Balcão: consumir no local]" });
confere("entrega com etiqueta velha não ganha o campo", (entrega as any).consumoNoBalcao, undefined);
const conta = pedidoParaOAssistente({ ...base, kind: "CONTA_DA_MESA", notes: "[Balcão: para levar]" } as any);
confere("papel que não é pedido (conta) não ganha o campo", (conta as any).consumoNoBalcao, undefined);

// ── 3. O papel ───────────────────────────────────────────────────────────────
const bytes = (order: Record<string, unknown>, colunas = 48) =>
  comandaDoAssistente(order, "Garagem Burger", colunas, "safe") as unknown as string;
const linhas = (escpos: string) =>
  lerPapel(escpos)
    .filter((l) => l.trechos.some((t) => t.texto.trim()))
    .map((l) => {
      const ts = l.trechos.filter((t) => t.texto.trim());
      return { texto: l.trechos.map((t) => t.texto).join("").trim(), altura: ts[0].altura, largura: ts[0].largura, negrito: ts.every((t) => t.negrito) };
    });

for (const colunas of [48, 32]) {
  const papel = linhas(bytes(local, colunas));
  const i = papel.findIndex((l) => l.texto === "CONSUMIR NO LOCAL");
  if (colunas === 48) for (const l of papel.slice(0, 4)) console.log(`    |${l.texto}  (altura ${l.altura}, largura ${l.largura}${l.negrito ? ", negrito" : ""})`);
  // Em 32 colunas o número em corpo triplo quebra em duas linhas: "logo
  // abaixo" é a primeira linha depois das de altura 3.
  const fimDoNumero = papel.findIndex((l) => l.altura !== 3);
  confere(`${colunas} col: "CONSUMIR NO LOCAL" logo abaixo do número`, [i, i === fimDoNumero, papel[0]?.texto.startsWith("(12)")], [fimDoNumero, true, true]);
  confere(`${colunas} col: altura dobrada, largura normal, negrito`, papel[i] && [papel[i].altura, papel[i].largura, papel[i].negrito], [2, 1, true]);
  confere(`${colunas} col: a etiqueta não se repete na observação`, papel.some((l) => /\[Balcao/i.test(l.texto)), false);
  confere(`${colunas} col: o recado da loja continua saindo`, papel.some((l) => /sem cebola/i.test(l.texto)), true);
}
const papelLevar = linhas(bytes(levar));
confere("para levar: \"PARA LEVAR\" logo abaixo do número", papelLevar[1]?.texto, "PARA LEVAR");

// O modelo da loja (order.blocos): a linha anda com o bloco do número.
const blocos = blocosParaOAssistente(modeloPadrao().completo);
const papelModelo = linhas(bytes({ ...local, blocos }));
const iModelo = papelModelo.findIndex((l) => l.texto === "CONSUMIR NO LOCAL");
confere("com modelo da loja: logo abaixo do número, alta e em negrito",
  [iModelo, papelModelo[iModelo]?.altura, papelModelo[iModelo]?.negrito], [1, 2, true]);

// Pedido sem escolha: os bytes não mudam com a etiqueta ausente.
confere("sem `consumoNoBalcao` nenhuma linha nova no topo",
  linhas(bytes({ ...base, notes: "sem cebola" })).some((l) => /PARA LEVAR|CONSUMIR NO LOCAL/.test(l.texto)), false);

// ── 4. O Assistente que ainda não conhece o campo ───────────────────────────
// Simulado mandando o pedido SEM `consumoNoBalcao`: é o que a 1.2.46 vê.
const { consumoNoBalcao: _ignorado, ...comoOAntigoVe } = local as any;
const papelAntigo = linhas(bytes(comoOAntigoVe));
confere("Assistente antigo: \"consumir no local\" sai na observação",
  papelAntigo.some((l) => /\[Balcao: consumir no local\] sem cebola/.test(l.texto)), true);

// ── 5. A cópia do celular ────────────────────────────────────────────────────
const doCelular = buildEscPos(local, "Garagem Burger", 48, "safe") as unknown as Buffer;
const doPc = comandaDoAssistente(local, "Garagem Burger", 48, "safe") as unknown as Buffer;
confere("o celular monta os mesmos bytes do Assistente", Buffer.from(doCelular).equals(Buffer.from(doPc)), true);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
