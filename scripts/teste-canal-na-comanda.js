/**
 * DE QUAL APP VEIO O PEDIDO — ESCRITO NO PAPEL.
 *
 * O modelo padrão da comanda tem o bloco "canal" desde que a tela
 * "Personalizar notinha" existe, e a prévia sempre o desenhou. O papel, não:
 * o servidor só manda `order.blocos` para quem PERSONALIZOU o modelo, e a via
 * padrão do Assistente nunca imprimiu a origem. Na loja de modelo padrão — a
 * maioria — a comanda do iFood, do 99Food e da Wabiz saía igual à do site.
 *
 * Medido na NIK Esfihas em 22/09/2026, ligando a Wabiz: a prévia mostrava
 * "WABIZ", o papel não mostrava nada. Pedido do "Wabiz passou os dados... por
 * favor aparecer o nome da plataforma, tem q ver wabiz escrito".
 *
 * Junto vai o "(Pago via ...)": dizia "Online", que não diz em qual app
 * procurar o dinheiro.
 *
 *   node scripts/teste-canal-na-comanda.js
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

const base = {
  id: "ord_teste",
  dailyOrderNumber: "8825",
  customerName: "Danilo",
  customerPhone: "22999990000",
  paymentMethod: "Cartao de Credito (Pago Online)",
  isPrepaid: true,
  deliveryType: "DELIVERY",
  customerAddress: "R. das Esfihas, 100 - Centro",
  items: [{ name: "Esfiha de Carne", qty: 4, price: 6.5 }],
  totalAmount: 26,
  deliveryFee: 0,
  createdAt: new Date().toISOString(),
};

const comanda = (extra) => papel(buildEscPos({ ...base, ...extra }, "NIK ESFIHAS E PIZZAS", 42, "safe"));

/* ── 1. Wabiz: o pedido desta tarefa ───────────────────────────────────── */
console.log("\n== WABIZ (modelo padrao, sem order.blocos) ==");
const wabiz = comanda({ source: "WABIZ", openDeliveryChannel: "WABIZ", openDeliveryReference: "1042" });
console.log(wabiz);
exigir("a comanda diz WABIZ", /WABIZ/.test(wabiz));
exigir("o nome do canal vem logo apos o numero do pedido",
  wabiz.indexOf("WABIZ") < wabiz.indexOf("Estabelecimento"));
exigir("o pago diz Wabiz, nao 'Online'", /Pago via Wabiz/.test(wabiz),
  (wabiz.match(/\(Pago via [^)]*\)/) || ["(nao achei a linha)"])[0]);

/* ── 2. Os outros marketplaces, com o nome que a loja le no telefone ───── */
console.log("\n== OS OUTROS CANAIS ==");
for (const [src, escrito] of [["IFOOD", "IFOOD"], ["99FOOD", "99FOOD"], ["JOTAJA", "JOTAJA"], ["BRENDI", "BRENDI"]]) {
  const p = comanda({ source: src });
  exigir(`${src} sai escrito no topo`, p.includes(escrito));
}

/* ── 3. O pedido do proprio site NAO ganha linha ───────────────────────── */
console.log("\n== SITE PROPRIO (nao pode ganhar linha nenhuma) ==");
const site = comanda({ source: "SITE" });
exigir("nao imprime 'SITE' em corpo dobrado", !/^SITE$/m.test(site));
exigir("continua dizendo (Pago via Online)", /Pago via Online/.test(site));

/* ── 4. A marca manda mais que o marketplace (iFood multi-loja) ────────── */
console.log("\n== DUAS MARCAS NO MESMO IFOOD ==");
const multi = comanda({ source: "IFOOD", ifoodStoreName: "Ragnar Burguer" });
exigir("imprime a marca", /RAGNAR BURGUER/.test(multi));
exigir("e nao o nome do marketplace junto", !/^IFOOD$/m.test(multi));

/* ── 5. Cobrar na entrega nao vira 'pago' ──────────────────────────────── */
console.log("\n== COBRAR NA ENTREGA ==");
const naEntrega = comanda({ source: "WABIZ", paymentMethod: "Dinheiro (Cobrar na Entrega)", isPrepaid: false });
exigir("continua sendo cobranca na entrega", /COBRAR DO CLIENTE NA ENTREGA/.test(naEntrega));
exigir("e ainda assim diz de onde veio", /WABIZ/.test(naEntrega));

console.log("\n" + ok + " ok, " + falhou + " falharam\n");
process.exit(falhou ? 1 : 0);
