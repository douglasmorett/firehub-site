/**
 * Prova o rodape da CONTA DA MESA: consumo, desconto, taxa de servico,
 * gorjeta e total — cada um na sua linha, e nenhum deles no meio dos itens.
 *
 * Reclamacao de cliente em 15/09/2026: a taxa de servico saia como produto
 * ("1x Taxa de servico 10% .... R$ 12,90") e o subtotal ja vinha com os 10%
 * dentro. Este teste falha se isso voltar.
 *
 *   node scripts/teste-conta-da-mesa.js
 */
const fs = require("fs");
const path = require("path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function recortar(nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  if (inicio < 0) throw new Error(`nao achei function ${nome}`);
  let nivel = 0, i = fonte.indexOf("{", inicio);
  for (; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}") { nivel--; if (nivel === 0) break; }
  }
  if (nivel !== 0) throw new Error(`chaves desbalanceadas em ${nome}`);
  return fonte.slice(inicio, i + 1);
}

// documentoDoCliente/nomeSemDocumento entram no recorte desde a 1.2.20 (o
// "CPF na nota" em linha propria): buildEscPos as chama, e sem elas aqui o
// harness quebra com ReferenceError antes de testar qualquer coisa.
const codigo = [recortar("cleanAscii"), recortar("documentoDoCliente"), recortar("nomeSemDocumento"), recortar("normalizarCombo"), recortar("buildEscPos")].join("\n\n");
const { buildEscPos } = new Function(`${codigo}\n return { buildEscPos };`)();

/** O cupom como src/lib/conta-da-mesa.ts monta com `taxaSeparada: true`. */
const CONTA = {
  id: "conta_sess1_1",
  kind: "CONTA_DA_MESA",
  dailyOrderNumber: "CONTA MESA 7",
  customerName: "Mesa 7 - 2 pessoas | Ana R$ 70,95 | Bruno R$ 70,95",
  customerAddress: "Mesa 7",
  deliveryType: "MESA",
  source: "MESA",
  paymentMethod: "Pendente - pagar no caixa ou na mesa",
  isPrepaid: false,
  items: [
    { name: "Picanha na chapa", qty: 1, price: 98.0 },
    { name: "Coca Cola Lata", qty: 3, price: 8.0 },
    { name: "Couvert", qty: 2, price: 5.0 },
  ],
  totalAmount: 141.9,
  deliveryFee: 0,
  notes: "",
  tableSessionId: "sess1",
  rateio: [{ nome: "Ana", valor: 70.95 }, { nome: "Bruno", valor: 70.95 }],
  taxaSeparada: true,
  consumo: 132.0,
  taxaServico: { percentual: 10, valor: 12.9 },
  gorjeta: 0,
  descontoDaConta: { valor: 3.0, motivo: "Cortesia" },
  createdAt: new Date().toISOString(),
};

const texto = buildEscPos(CONTA, "RESTAURANTE TESTE", "80mm")
  .toString("binary")
  .replace(/\x1b[@!aEd]?.?/g, "")
  .replace(/\x1d[Vh!wHkf].?.?/g, "");

console.log("─".repeat(50));
console.log(texto.replace(/\r/g, ""));
console.log("─".repeat(50));

let falhas = 0;
const exige = (condicao, oQue) => {
  if (condicao) console.log("  ok   " + oQue);
  else { console.log("  FALHA " + oQue); falhas++; }
};

exige(!/1x Taxa de servico/i.test(texto), "a taxa de servico NAO sai como item");
exige(!/1x Gorjeta/i.test(texto), "a gorjeta NAO sai como item");
exige(/Consumo:/.test(texto), 'imprime a linha "Consumo:"');
exige(/R\$ 132,00/.test(texto), "o consumo e o dos ITENS (132,00), sem os 10% dentro");
exige(/Taxa de servico 10%:/.test(texto), 'imprime "Taxa de servico 10%:"');
exige(/R\$ 12,90/.test(texto), "com o valor da taxa (12,90)");
exige(/Desconto:/.test(texto) && /-R\$ 3,00/.test(texto), "imprime o desconto da mesa");
exige(/otal:/.test(texto) && /R\$ 141,90/.test(texto), "o total e 132,00 - 3,00 + 12,90 = 141,90");
exige(texto.indexOf("Consumo:") < texto.indexOf("Taxa de servico"), "consumo vem ANTES da taxa");
exige(texto.indexOf("Taxa de servico") < texto.lastIndexOf("otal:"), "a taxa vem ANTES do total");
exige(!/Taxa de Entrega/i.test(texto), "conta de mesa nao imprime taxa de entrega");

console.log(falhas === 0 ? "\nTUDO CERTO" : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);

// ── Cupom ANTIGO reimpresso neste Assistente ──────────────────────────────
//
// PrintRequest guarda o payload: uma reimpressao pode trazer um cupom montado
// ANTES desta mudanca, com a taxa dentro dos itens e `consumo` ja presente.
// Sem a flag, o rodape sairia por cima de uma lista que ja tem a taxa — e o
// papel contaria os 10% duas vezes aos olhos de quem confere.
const CONTA_ANTIGA = {
  ...CONTA,
  id: "conta_sess1_antiga",
  taxaSeparada: undefined,
  items: [...CONTA.items, { name: "Taxa de servico 10%", qty: 1, price: 12.9 }],
};
const textoAntigo = buildEscPos(CONTA_ANTIGA, "RESTAURANTE TESTE", "80mm")
  .toString("binary")
  .replace(/\x1b[@!aEd]?.?/g, "")
  .replace(/\x1d[Vh!wHkf].?.?/g, "");

console.log("\n── cupom antigo (compatibilidade) ──");
let falhasAntigo = 0;
const exigeAntigo = (condicao, oQue) => {
  if (condicao) console.log("  ok   " + oQue);
  else { console.log("  FALHA " + oQue); falhasAntigo++; }
};
exigeAntigo(/Subtotal:/.test(textoAntigo), 'cupom antigo continua com "Subtotal:"');
exigeAntigo(!/Consumo:/.test(textoAntigo), "nao imprime o rodape novo por cima dele");
exigeAntigo(/1x Taxa de servico/.test(textoAntigo), "a taxa dele continua na lista, como sempre foi");
exigeAntigo(/otal:/.test(textoAntigo) && /R\$ 141,90/.test(textoAntigo), "e o total continua 141,90");
if (falhasAntigo > 0) { console.log(`\n${falhasAntigo} FALHA(S) na compatibilidade`); process.exit(1); }
console.log("\nCOMPATIBILIDADE OK");
