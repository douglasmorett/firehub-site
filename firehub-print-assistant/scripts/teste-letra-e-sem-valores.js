/**
 * Assistente 1.2.26: a letra dos itens (Bloco.corpos.linhaDoItem) e o "sem
 * valores" por impressora (destino.semValores).
 *
 * Mesmo harness de teste-modelo-comanda.js: recorta as funcoes de server.js e
 * as avalia isoladas, para testar o codigo que vai para a loja.
 *
 *   node scripts/teste-letra-e-sem-valores.js
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
  return fonte.slice(inicio, i + 1);
}

const codigo = [recortar("cleanAscii"), recortar("documentoDoCliente"), recortar("nomeSemDocumento"), recortar("normalizarCombo"), recortar("buildEscPos")].join("\n\n");
const { buildEscPos } = new Function(`${codigo}\n return { buildEscPos };`)();

let ok = 0, falhas = 0;
function confere(nome, cond, detalhe) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}${detalhe ? `\n    ${detalhe}` : ""}`); }
}

const PEDIDO = {
  id: "ped_letra_1",
  dailyOrderNumber: "12",
  customerName: "Larissa Moreira",
  customerPhone: "(22) 99999-1020",
  deliveryType: "PICKUP",
  paymentMethod: "Dinheiro",
  totalAmount: 66.9,
  deliveryFee: 0,
  createdAt: "2026-09-24T21:45:00.000Z",
  items: [
    { name: "Pizza Calabresa G", quantity: 1, price: 54.9, notes: "bem assada" },
    { name: "X-Bacon", quantity: 1, price: 12, comboSelections: [{ name: "Cheddar extra", quantity: 1, price: 3 }] },
  ],
};

const itens = (tamanho) => [{ tipo: "itens", ligado: true, titulo: "PEDIDO", ...(tamanho ? { corpos: { linhaDoItem: tamanho } } : {}) }];
const GS_2X = "\x1d!\x11";
const papel = (order) => buildEscPos(order, "DIVINOS BURGER", 48, "safe").toString("binary");

// ── 1. Sem a chave, o papel e byte a byte o de antes ──────────────────────
const antes = papel({ ...PEDIDO, blocos: itens() });
const comUm = papel({ ...PEDIDO, blocos: itens(1) });
confere("corpo 1 = papel de sempre", antes === comUm);
confere("corpo normal: item e preco na mesma linha", /1x Pizza Calabresa G\s+R\$ 54,90/.test(antes));

// ── 2. Letra 2x: nome ampliado, preco na linha de baixo ───────────────────
const grande = papel({ ...PEDIDO, blocos: itens(2) });
const linhaDaPizza = grande.split("\n").find((l) => l.includes("1x Pizza Calabresa G")) || "";
confere("2x: a linha do item leva o comando de ampliar", linhaDaPizza.includes(GS_2X), JSON.stringify(linhaDaPizza));
confere("2x: o preco NAO fica na linha ampliada", !linhaDaPizza.includes("R$"));
confere("2x: o preco continua no papel", grande.includes("R$ 54,90"));
const linhaDoAdicional = grande.split("\n").find((l) => l.includes("Cheddar extra")) || "";
confere("2x: o complemento acompanha o corpo do item", linhaDoAdicional.includes(GS_2X), JSON.stringify(linhaDoAdicional));
confere("2x: o valor do adicional continua no papel", grande.includes("+R$ 3,00"));
confere("2x: a observacao continua", grande.includes("bem assada"));

// ── 3. Sem valores: nenhum preco, com ou sem letra grande ─────────────────
for (const t of [undefined, 2]) {
  const cozinha = papel({ ...PEDIDO, semValores: true, blocos: itens(t) });
  confere(`sem valores (letra ${t || 1}): nenhum R$ no papel`, !/R\$/.test(cozinha));
  confere(`sem valores (letra ${t || 1}): os itens continuam`, cozinha.includes("Pizza Calabresa G") && cozinha.includes("Cheddar extra"));
}

// ── 4. A copia por destino leva o semValores do servidor ──────────────────
confere(
  "fila: o destino copia semValores para o pedido",
  /semValores:\s*destino\.semValores === true \|\| job\.order\?\.semValores === true/.test(fonte)
);

console.log(`\n${ok} ok, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
