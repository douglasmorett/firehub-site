/**
 * A comanda do 99Food separa quem bancou o desconto — igual faz no iFood.
 *
 * O #266003 do Frangoso (17/09/2026) saiu "Desconto (Cupom - Loja) R$ 70,00 /
 * Total R$ 1,97", como se a loja tivesse pago o combo para o cliente. Eram
 * R$ 20 da loja e R$ 50 do 99. Dois motivos para a comanda nao separar:
 *
 *   1. o rotulo da parte da plataforma era fixo, "Desconto (iFood)";
 *   2. as linhas separadas so saem quando fecham a conta
 *      subtotal + entrega - total, e no 99 falta a taxa de servico nela.
 *
 * O servidor passa a mandar `discountPlatform` + `discountPlatformLabel` e
 * `serviceFee` + `serviceFeeLabel` (src/lib/desconto-99food.ts). Este harness
 * prova o papel dos tres lados: 99 com servidor novo, 99 com servidor antigo
 * (nada muda) e iFood (nada muda).
 *
 * Como em teste-modelo-comanda.js: server.js nao pode ser exigido daqui, entao
 * as funcoes sao recortadas do arquivo e avaliadas isoladas.
 *
 *   node scripts/teste-desconto-99food.js
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
// eslint-disable-next-line no-new-func
const { buildEscPos } = new Function(`${codigo}\n return { buildEscPos };`)();

// Tira os bytes de controle e deixa so o texto, para procurar linhas.
const legivel = (buf) => buf.toString("binary").replace(/[\x00-\x08\x0b-\x1f\x7f-\xff]/g, "");

let ok = 0, falhou = 0;
function confere(nome, cond) {
  if (cond) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}`); }
}
function linha(texto, rotulo, valor) {
  // rightAlign poe espacos entre rotulo e valor; a linha tem os dois na ordem.
  const re = new RegExp(rotulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+" + valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return re.test(texto);
}

// O #266003 como o servidor NOVO manda (lib/desconto-99food.ts).
const PEDIDO_99 = {
  id: "ped_266003",
  dailyOrderNumber: "31",
  customerName: "Yann Santos",
  customerPhone: "(21) 97417-9704",
  customerAddress: "Rua Coronel Ferreira da Silva, 143 - Camarao - Sao Goncalo",
  deliveryType: "DELIVERY",
  paymentMethod: "Pago Online (99Food)",
  isPrepaid: true,
  items: [
    { name: "Molho", qty: 1, price: 2.99 },
    { name: "Combo Box de Frango P", qty: 1, price: 59.99 },
  ],
  totalAmount: 1.97,
  deliveryFee: 8.0,
  discountTotal: 70,
  discountIfood: null,
  discountMerchant: 20,
  discountPlatform: 50,
  discountPlatformLabel: "Desconto (99Food):",
  serviceFee: 0.99,
  serviceFeeLabel: "Taxa de servico (99Food):",
  source: "99FOOD",
  openDeliveryReference: "266003",
  createdAt: "2026-09-17T22:48:00-03:00",
};

console.log("\n== 99Food, servidor novo: as duas linhas + taxa de servico ==");
const novo = legivel(buildEscPos(PEDIDO_99, "Frangoso - Trindade", 48, "safe"));
confere("Desconto (99Food): -R$ 50,00", linha(novo, "Desconto (99Food):", "-R$ 50,00"));
confere("Desconto (Cupom - Loja): -R$ 20,00", linha(novo, "Desconto (Cupom - Loja):", "-R$ 20,00"));
confere("Taxa de Entrega: R$ 8,00", linha(novo, "Taxa de Entrega:", "R$ 8,00"));
confere("Taxa de servico (99Food): R$ 0,99", linha(novo, "Taxa de servico (99Food):", "R$ 0,99"));
confere("Total: R$ 1,97", /Total:\s+R\$ 1,97/.test(novo));
confere("NAO diz iFood em lugar nenhum", !/iFood/.test(novo));
confere("NAO cai na linha unica 'Desconto:'", !/Desconto:\s+-R\$/.test(novo));

console.log("\n== 99Food, servidor ANTIGO (sem os campos novos): tudo como era ==");
const antigo = legivel(buildEscPos({
  ...PEDIDO_99,
  discountMerchant: null, discountPlatform: undefined, discountPlatformLabel: undefined,
  serviceFee: undefined, serviceFeeLabel: undefined,
}, "Frangoso - Trindade", 48, "safe"));
confere("linha unica com o que a conta exige: Desconto: -R$ 69,01", linha(antigo, "Desconto:", "-R$ 69,01"));
confere("sem linha de taxa de servico", !/Taxa de servico/.test(antigo));
confere("Total: R$ 1,97", /Total:\s+R\$ 1,97/.test(antigo));

console.log("\n== iFood: nada muda ==");
const ifood = legivel(buildEscPos({
  ...PEDIDO_99,
  source: "IFOOD", paymentMethod: "Pago Online (iFood)", ifoodReference: "3523",
  discountPlatform: undefined, discountPlatformLabel: undefined, serviceFee: undefined, serviceFeeLabel: undefined,
  items: [{ name: "Esfirra", qty: 1, price: 40 }],
  totalAmount: 33, deliveryFee: 5, discountTotal: 12, discountIfood: 10, discountMerchant: 2,
}, "Salz", 48, "safe"));
confere("Desconto (iFood): -R$ 10,00", linha(ifood, "Desconto (iFood):", "-R$ 10,00"));
confere("Desconto (Cupom - Loja): -R$ 2,00", linha(ifood, "Desconto (Cupom - Loja):", "-R$ 2,00"));
confere("Taxa de Entrega (iFood): R$ 5,00", linha(ifood, "Taxa de Entrega (iFood):", "R$ 5,00"));

console.log("\n== 99Food so com cupom do 99 (loja nao deu nada) ==");
const soPlataforma = legivel(buildEscPos({
  ...PEDIDO_99,
  items: [{ name: "Pastel", qty: 1, price: 30 }],
  totalAmount: 21.5, deliveryFee: 0, discountTotal: 10, discountMerchant: null, discountPlatform: 10, serviceFee: 1.5,
}, "Loja", 48, "safe"));
confere("Desconto (99Food): -R$ 10,00", linha(soPlataforma, "Desconto (99Food):", "-R$ 10,00"));
confere("NAO inventa 'Cupom - Loja' com o total", !/Cupom - Loja/.test(soPlataforma));
confere("Taxa de servico (99Food): R$ 1,50", linha(soPlataforma, "Taxa de servico (99Food):", "R$ 1,50"));

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
