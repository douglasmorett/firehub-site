/**
 * O "Itens vendidos" na bobina (lib/relatorios/papel-dos-itens-vendidos.ts),
 * passado pelo MESMO buildEscPos do Assistente — o recorte do
 * teste-cupom-do-caixa.js. Prova que sai como relatório de caixa (título,
 * linhas com quantidade, opções com 0,5) e não como pedido.
 *
 *   node scripts/teste-papel-dos-itens-vendidos.js
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const createJiti = require("jiti");

const RAIZ = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { alias: { "@": path.resolve(RAIZ, "src") }, interopDefault: true, esmResolve: true });
const { papelDosItensVendidos } = jiti(path.resolve(RAIZ, "src", "lib", "relatorios", "papel-dos-itens-vendidos.ts"));

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

const no = (tipo, nome, quantidade, valor, filhos) => ({ chave: `${tipo}:${nome}`, nome, tipo, quantidade, valor, pct: 0, filhos });
const dados = {
  periodo: { de: "2026-11-04", ate: "2026-11-04", horaDe: null, horaAte: null },
  itens: [
    no("categoria", "Pizzas | Meio a Meio", 3, 190, [
      no("produto", "Pizza Meio a Meio - Tamanho GG", 2, 132, [
        no("grupo", "Sabores", 2, 0, [no("opcao", "Calabresa", 1.5, 0), no("opcao", "Frango com Catupiry", 0.5, 0)]),
      ]),
      no("produto", "Pizza Meio a Meio - Tamanho P", 1, 58, []),
    ]),
    no("categoria", "Bebidas", 2, 15, [no("produto", "Coca-Cola 600ml", 2, 15, [])]),
  ],
  opcoes: null,
  total: { quantidade: 5, valor: 205 },
};
const cupom = papelDosItensVendidos(dados, { loja: "pizzaria Bom cheff", dataHora: "05/11/2026 03:10", operador: "Vania" });
assert.ok(cupom.kind.startsWith("CAIXA_"), "vai pela regra do papel do caixa");

for (const colunas of [48, 32]) {
  const texto = papel(buildEscPos(cupom, "pizzaria Bom cheff", colunas, "safe"));
  if (colunas === 48) console.log(texto);
  assert.match(texto, /ITENS VENDIDOS/);
  assert.match(texto, /Periodo\s+04\/11\/2026/);
  assert.match(texto, /2x Pizza Meio a Meio -\s+Tamanho GG/);
  assert.match(texto, /- 1,5x Calabresa *\n/);
  assert.match(texto, /- 0,5x Frango com Catupiry *\n/);
  assert.match(texto, /TOTAL 5 itens\s+R\$ 205,00/);
  assert.doesNotMatch(texto, /Taxa de Entrega|CLIENTE/i, "nada de pedido no papel");
  const linhas = texto.split("\n").filter((l) => l.trim()).length;
  assert.ok(linhas < 40, `papel curto (${linhas} linhas)`);
}

// Assistente < 1.2.19 ignora `relatorio` e imprime os produtos como itens.
assert.deepStrictEqual(cupom.items.map((i) => `${i.qty}x ${i.name}`), [
  "2x Pizza Meio a Meio - Tamanho GG", "1x Pizza Meio a Meio - Tamanho P", "2x Coca-Cola 600ml",
]);
console.log("✅ papel dos itens vendidos ok");
