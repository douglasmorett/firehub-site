/**
 * "SEM QUEIJO POR FAVOR" TEM QUE SAIR NA COMANDA — INCLUSIVE NA RETIRADA.
 *
 * Queixa do Frangoso (Salzburg, 19-20/09/2026): o recado que o cliente
 * escreve na Brendi não chegava ao sistema. Chegava: estava no banco e
 * aparecia no painel. Não chegava era ao PAPEL.
 *
 * A observação do pedido era impressa DENTRO do bloco ENTREGA, que só é
 * montado quando `deliveryType === "DELIVERY"` E existe endereço. O Frangoso é
 * loja de balcão: medido no banco de produção em 20/09/2026, nos últimos 15
 * dias TODOS os pedidos de retirada com recado saíram sem ele —
 *
 *   #41 RETIRADA  "OBS: Trocar o molho barbecue por molho de bacon"
 *   #78 RETIRADA  "OBS: Tirar cebola e pimentao"
 *   #29 RETIRADA  "Cheese Burguer: So Pao, e 2 carnes bem passadas SEM maionese"
 *   #16 RETIRADA  "Cheese Burguer: 2 carnes 2 fatias de cheddar e sem maionese"
 *
 * O caso da RETIRADA é o teste que importa: é o que estava quebrado.
 *
 *   node scripts/teste-observacao-na-comanda.js
 */
const fs = require("fs");
const path = require("path");

const RAIZ = path.resolve(__dirname, "..");

function recortarFuncao(fonte, assinatura) {
  const inicio = fonte.indexOf(assinatura);
  if (inicio < 0) throw new Error("não achei no server.js: " + assinatura);
  let i = fonte.indexOf("{", inicio);
  let nivel = 0;
  for (; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}" && --nivel === 0) return fonte.slice(inicio, i + 1);
  }
  throw new Error("chave não fechou em " + assinatura);
}

const servidor = fs.readFileSync(path.join(RAIZ, "firehub-print-assistant", "server.js"), "utf8");
const buildEscPos = new Function([
  recortarFuncao(servidor, "function cleanAscii("),
  recortarFuncao(servidor, "function normalizarCombo("),
  // `buildEscPos` passou a chamar isto quando o CPF na nota ganhou linha
  // propria (Assistente 1.2.20). Sem recortar o ajudante junto, o eval
  // quebra com "documentoDoCliente is not defined" e o teste morre antes
  // da primeira checagem.
  recortarFuncao(servidor, "function documentoDoCliente("),
  recortarFuncao(servidor, "function buildEscPos("),
  "return buildEscPos;",
].join("\n\n"))();

const papel = (buf) =>
  buf.toString("binary")
    .replace(/[\x1b\x1d]![\x00-\xff]/g, "")
    .replace(/\x1b [\x00-\xff]/g, "")
    .replace(/\x1bE[\x00-\x01]/g, "")
    .replace(/\x1ba[\x00-\x02]/g, "")
    .replace(/\x1b@/g, "")
    .replace(/\x1bt[\x00-\xff]/g, "")
    .replace(/\x1dV\x00/g, "\n--- CORTE ---\n")
    .replace(/\x1bd[\x00-\xff]/g, "\n")
    .replace(/\x1dB[\x00-\x01]/g, "")
    .replace(/\x1bM[\x00-\x02]/g, "")
    .replace(/\x1b[23][\x00-\xff]/g, "")
    .replace(/\x1d[LW][\x00-\xff][\x00-\xff]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");

let ok = 0, falhou = 0;
const exigir = (nome, condicao, detalhe) => {
  if (condicao) { ok++; console.log("  ok     " + nome); }
  else { falhou++; console.log("  FALHOU " + nome + (detalhe ? "\n         " + detalhe : "")); }
};

const pedidoBase = {
  id: "ord_teste",
  dailyOrderNumber: "78",
  source: "BRENDI",
  customerName: "Cliente Brendi",
  customerPhone: "21999990000",
  paymentMethod: "Pix",
  isPrepaid: true,
  items: [{ name: "Cheese Burguer", qty: 1, price: 29.9 }],
  totalAmount: 29.9,
  deliveryFee: 0,
  createdAt: new Date().toISOString(),
};

/* ── 1. RETIRADA: o caso que estava quebrado ───────────────────────────── */
console.log("\n== RETIRADA (Brendi, o caso do Frangoso) ==");
const retirada = papel(buildEscPos({
  ...pedidoBase,
  deliveryType: "RETIRADA",
  customerAddress: "",
  notes: "Pedido Brendi #6078\n📝 OBS: Tirar cebola e pimentão",
}, "Salzburg Hamburgueria", 48, "safe"));
console.log(retirada);

exigir("o recado sai na retirada", /Tirar cebola e pimentao/i.test(retirada));
exigir("sai em destaque, antes dos itens", retirada.indexOf("OBSERVACAO") < retirada.indexOf("Cheese Burguer"));
exigir("a referência interna da Brendi não vira recado", !/Pedido Brendi #6078/.test(retirada));

/* ── 2. DELIVERY: não pode ter regredido ───────────────────────────────── */
console.log("\n== DELIVERY (o caminho que já funcionava) ==");
const entrega = papel(buildEscPos({
  ...pedidoBase,
  deliveryType: "DELIVERY",
  customerAddress: "R. Liberdade, 6 - Mutondo",
  notes: "Pedido iFood #ABC123\n📝 OBS: sem queijo por favor",
}, "Salzburg Hamburgueria", 48, "safe"));

exigir("o recado continua saindo no delivery", /sem queijo por favor/i.test(entrega));
exigir("o endereço continua saindo", /R\. Liberdade, 6/.test(entrega));
exigir("o recado não sai duas vezes", (entrega.match(/sem queijo por favor/gi) || []).length === 1);
exigir("a referência do iFood continua limpa", !/Pedido iFood #ABC123/.test(entrega));

/* ── 3. Pedido sem recado: nada de tarja vazia ─────────────────────────── */
console.log("\n== Sem recado ==");
const semRecado = papel(buildEscPos({
  ...pedidoBase,
  deliveryType: "RETIRADA",
  customerAddress: "",
  notes: "Pedido Brendi #6079\n🏷️ Cupom Brendi (-10%): -R$8.00",
}, "Salzburg Hamburgueria", 48, "safe"));
exigir("cupom sozinho não vira observação", !/OBSERVACAO/.test(semRecado));

/* ── 4. Observação POR ITEM continua embaixo do item ───────────────────── */
console.log("\n== Observação por item ==");
const porItem = papel(buildEscPos({
  ...pedidoBase,
  deliveryType: "RETIRADA",
  customerAddress: "",
  notes: "Pedido Brendi #6080",
  items: [{ name: "Cheese Burguer", qty: 1, price: 29.9, notes: "2 carnes, sem maionese" }],
}, "Salzburg Hamburgueria", 48, "safe"));
exigir("a observação do item sai embaixo do item", /Obs: 2 carnes, sem maionese/.test(porItem));

/* ── 5. Conta da mesa não leva tarja de observação ─────────────────────── */
console.log("\n== Conta da mesa ==");
const conta = papel(buildEscPos({
  ...pedidoBase,
  kind: "CONTA_DA_MESA",
  deliveryType: "MESA",
  customerAddress: "",
  notes: "📝 OBS: mesa 4",
}, "Salzburg Hamburgueria", 48, "safe"));
exigir("a conta do cliente não leva tarja de observação", !/OBSERVACAO DO CLIENTE/.test(conta));

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
