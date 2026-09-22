/**
 * "5x X-BACON" OU CINCO LINHAS DE "1x X-BACON"?
 *
 * Escolha POR IMPRESSORA (pedido do dono, 20/09/2026). Não é gosto: quem monta
 * lanche a lanche risca UMA linha por unidade e usa o papel como checklist —
 * com "5x" numa linha só, o cozinheiro perde a conta no meio do movimento e
 * manda quatro. Quem embala junto prefere agrupado, que gasta menos bobina.
 *
 * O que não pode quebrar:
 *   • o padrão continua AGRUPADO — toda loja já configurada imprime igual;
 *   • separar muda só o DESENHO: subtotal e total saem idênticos nos dois
 *     (eles vêm de `order.items` e de `order.totalAmount`, não da lista
 *     desenhada);
 *   • combo separado repete os adicionais em cada unidade, senão a cozinha lê
 *     "1x Combo" sem saber o que vai dentro;
 *   • quantidade fracionada (meia pizza) não é multiplicada.
 *
 *   node scripts/teste-itens-agrupados-ou-separados.js
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

const base = {
  id: "ord_1", dailyOrderNumber: "12", source: "PDV",
  customerName: "Joao", deliveryType: "RETIRADA", customerAddress: "",
  paymentMethod: "Dinheiro", items: [{ name: "X-Bacon", qty: 5, price: 20 }],
  totalAmount: 100, deliveryFee: 0, createdAt: new Date().toISOString(),
};

const contar = (texto, agulha) => (texto.match(new RegExp(agulha.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

console.log("\n== Agrupado é o padrão ==");
const agrupado = papel(buildEscPos(base, "Loja", 48, "safe"));
exigir("sai '5x X-Bacon' numa linha", contar(agrupado, "5x X-Bacon") === 1);
exigir("não repete a linha", contar(agrupado, "1x X-Bacon") === 0);
exigir("o valor da linha é o da quantidade toda", /5x X-Bacon\s+R\$ 100,00/.test(agrupado), agrupado.split("\n").find((l) => l.includes("X-Bacon")));

console.log("\n== Separado: uma linha por unidade ==");
const separado = papel(buildEscPos({ ...base, separarItens: true }, "Loja", 48, "safe"));
console.log(separado.split("\n").filter((l) => l.includes("X-Bacon") || l.includes("Total") || l.includes("Subtotal")).join("\n"));
exigir("sai cinco linhas de '1x X-Bacon'", contar(separado, "1x X-Bacon") === 5);
exigir("não sobrou a linha agrupada", contar(separado, "5x X-Bacon") === 0);
exigir("cada linha vale o unitário", contar(separado, "R$ 20,00") === 5);

console.log("\n== O dinheiro não muda ==");
const totalDe = (t) => (t.match(/Total:\s+(R\$ [\d.,]+)/) || [])[1];
const subtotalDe = (t) => (t.match(/Subtotal:\s+(R\$ [\d.,]+)/) || [])[1];
exigir("o TOTAL é o mesmo nos dois", totalDe(agrupado) === totalDe(separado) && totalDe(agrupado) === "R$ 100,00", `${totalDe(agrupado)} x ${totalDe(separado)}`);
exigir("o SUBTOTAL é o mesmo nos dois", subtotalDe(agrupado) === subtotalDe(separado), `${subtotalDe(agrupado)} x ${subtotalDe(separado)}`);

console.log("\n== Combo separado leva os adicionais em cada unidade ==");
const comCombo = {
  ...base,
  items: [{
    name: "Combo Duplo", qty: 3, price: 40,
    comboSelections: JSON.stringify([{ name: "Batata", quantity: 1, price: 0 }, { name: "Guarana", quantity: 1, price: 0 }]),
  }],
  totalAmount: 120,
};
const comboSeparado = papel(buildEscPos({ ...comCombo, separarItens: true }, "Loja", 48, "safe"));
exigir("três linhas de combo", contar(comboSeparado, "1x Combo Duplo") === 3);
exigir("cada uma com a batata", contar(comboSeparado, "- Batata") === 3);
exigir("cada uma com a bebida", contar(comboSeparado, "- Guarana") === 3);

console.log("\n== Quantidade que não é inteira fica como está ==");
const meia = papel(buildEscPos({ ...base, separarItens: true, items: [{ name: "Pizza", qty: 0.5, price: 30 }], totalAmount: 15 }, "Loja", 48, "safe"));
exigir("meia pizza não vira lista", contar(meia, "Pizza") === 1);

console.log("\n== Quantidade 1 não muda nada ==");
const umSo = papel(buildEscPos({ ...base, separarItens: true, items: [{ name: "Coca", qty: 1, price: 8 }], totalAmount: 8 }, "Loja", 48, "safe"));
exigir("um item só sai uma vez", contar(umSo, "1x Coca") === 1);

console.log("\n== Assistente que não conhece o campo agrupa ==");
const semCampo = papel(buildEscPos({ ...base, separarItens: undefined }, "Loja", 48, "safe"));
exigir("campo ausente = agrupado", contar(semCampo, "5x X-Bacon") === 1);
const valorErrado = papel(buildEscPos({ ...base, separarItens: "sim" }, "Loja", 48, "safe"));
exigir("valor que não é true = agrupado (lado seguro)", contar(valorErrado, "5x X-Bacon") === 1);

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
