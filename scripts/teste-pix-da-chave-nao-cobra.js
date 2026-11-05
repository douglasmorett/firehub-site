/**
 * Pix na chave da loja (pedido do robô): a comanda e o motoboy NÃO cobram na
 * porta, e o caixa continua contando como Pix. "Cliente já fez o pagamento por
 * pix e no pedido saiu cobrar na entrega" (05/11/2026).
 *
 *   node scripts/teste-pix-da-chave-nao-cobra.js
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const createJiti = require("jiti");

const RAIZ = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.resolve(RAIZ, "src") }, interopDefault: true, esmResolve: true });
const pg = jiti(path.resolve(RAIZ, "src", "lib", "pagamento-na-entrega.ts"));
const { FORMA_PIX_DA_CHAVE, pagaNoPix } = jiti(path.resolve(RAIZ, "src", "lib", "pix-da-loja.ts"));

function recortarFuncao(fonte, assinatura) {
  const inicio = fonte.indexOf(assinatura);
  if (inicio < 0) throw new Error("não achei no server.js: " + assinatura);
  let i = fonte.indexOf("{", inicio);
  let nivel = 0;
  for (; i < fonte.length; i++) {
    const c = fonte[i];
    if (c === "{") nivel++;
    else if (c === "}") {
      nivel--;
      if (nivel === 0) return fonte.slice(inicio, i + 1);
    }
  }
  throw new Error("chave não fechou em " + assinatura);
}

const servidor = fs.readFileSync(path.resolve(RAIZ, "firehub-print-assistant", "server.js"), "utf8");
const pedacos = [
  recortarFuncao(servidor, "function cleanAscii("),
  // As duas do "CPF na nota" (1.2.20): o papel do Assistente ANTIGO (sem
  // relatorio) passa pelo caminho de pedido, que as chama.
  recortarFuncao(servidor, "function documentoDoCliente("),
  recortarFuncao(servidor, "function nomeSemDocumento("),
  recortarFuncao(servidor, "function normalizarCombo("),
  recortarFuncao(servidor, "function buildEscPos("),
  "return buildEscPos;",
].join("\n\n");
const buildEscPos = new Function(pedacos)();
function papel(buf) {
  return buf
    .toString("binary")
    .replace(/[\x1b\x1d]![\x00-\xff]/g, "") // dobrado / volta ao normal
    .replace(/\x1b [\x00-\xff]/g, "")       // espacamento entre caracteres
    .replace(/\x1bE\x01/g, "")        // negrito
    .replace(/\x1bE\x00/g, "")
    .replace(/\x1ba[\x00-\x02]/g, "") // alinhamento
    .replace(/\x1b@/g, "")
    .replace(/\x1bt[\x00-\xff]/g, "")
    .replace(/\x1dV\x00/g, "\n--- CORTE ---\n")
    .replace(/\x1bd[\x00-\xff]/g, "\n")
    .replace(/\x1dB[\x00-\x01]/g, "")
    .replace(/\x1bM[\x00-\x02]/g, "")
    .replace(/\x1b[23][\x00-\xff]/g, "")
    .replace(/\x1dL[\x00-\xff][\x00-\xff]/g, "")
    .replace(/\x1dW[\x00-\xff][\x00-\xff]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

const base = { deliveryType: "DELIVERY", totalAmount: 59, customerName: "Cliente", customerAddress: "Rua A, 10", source: "WHATSAPP",
  items: [{ name: "Pizza Grande", quantity: 1, price: 56 }], deliveryFee: 3 };

// A forma do robô continua sendo Pix: a confirmação manda a chave, o caixa conta Pix.
assert.ok(pagaNoPix(FORMA_PIX_DA_CHAVE));
assert.strictEqual(pg.formaCanonica(FORMA_PIX_DA_CHAVE), "Pix");
assert.strictEqual(pg.ehPagoOnline({ ...base, paymentMethod: FORMA_PIX_DA_CHAVE }), false, "não vira online (fiscal e caixa)");

// O motoboy não cobra.
assert.strictEqual(pg.cobrancaNaEntrega({ ...base, paymentMethod: FORMA_PIX_DA_CHAVE }).cobrar, false);
// O Pix sem a marca (Pix na porta, loja sem chave cadastrada) continua cobrando.
assert.strictEqual(pg.cobrancaNaEntrega({ ...base, paymentMethod: "PIX" }).cobrar, true);
assert.strictEqual(pg.cobrancaNaEntrega({ ...base, paymentMethod: "Pix (Cobrar na Entrega)" }).cobrar, true);

// O papel: o que a fila manda para o Assistente.
const imprimir = (pm) => {
  const order = { ...base, paymentMethod: pm, ...pg.pagamentoPeloSiteParaImpressao({ paymentMethod: pm }) };
  return papel(buildEscPos(order, "Loja", 48, "safe"));
};
const pago = imprimir(FORMA_PIX_DA_CHAVE);
console.log(pago.split("\n").filter((l) => /Pagamento|COBRAR|Pago via/i.test(l)).join("\n"));
assert.doesNotMatch(pago, /COBRAR (DO CLIENTE )?NA ENTREGA/);
assert.match(pago, /Pix na chave da loja -\s+conferir comprovante/);
assert.match(pago, /NAO COBRAR/);
assert.match(imprimir("PIX"), /COBRAR DO CLIENTE NA ENTREGA/, "Pix sem a marca segue cobrando");

console.log("✅ Pix na chave da loja não cobra na entrega");
