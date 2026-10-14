/**
 * "Nao quero a bebida." nao e bebida (Delicias de Casa, 09/10/2026).
 *
 * A opcao de recusa do combo tem a palavra "bebida" no nome e a comanda saia
 * com "!! ATENCAO: POSSUI BEBIDA NESTE PEDIDO !!" e "<=== BEBIDA" na linha
 * dela — justo no pedido em que o cliente recusou. Mesmo recorte de
 * teste-modelo-comanda.js: testa o codigo que vai para a loja.
 *
 *   node scripts/teste-bebida-recusada.js
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

const pedido = (itens) => ({
  id: "ped_bebida", dailyOrderNumber: "123", createdAt: "2026-10-09T23:00:00.000Z",
  customerName: "Cliente Teste", deliveryType: "DELIVERY", source: "IFOOD",
  paymentMethod: "Pago Online", totalAmount: 49.99, deliveryFee: 0, items: itens,
});
const texto = (o) => {
  const r = buildEscPos(o);
  return Buffer.isBuffer(r) ? r.toString("latin1") : String(r);
};

let falhas = 0;
const confere = (nome, ok) => { if (!ok) falhas++; console.log(`${ok ? "ok  " : "FALHOU"} ${nome}`); };

// O pedido real da loja: parmegiana com nome que fala de Coca, cliente recusou.
const recusou = texto(pedido([{
  name: "Parmegiana de Frango C/ Pure de Batata + 2 Coca-Cola 200ml", quantity: 1, price: 49.99,
  comboSelections: [{ name: "Nao Quero Nuggets", quantity: 1 }, { name: "Sem Feijao", quantity: 1 }, { name: "Não quero a bebida.", quantity: 1 }],
}]));
confere("recusou: sem a faixa POSSUI BEBIDA", !/POSSUI BEBIDA|CONTEM BEBIDA/i.test(recusou));
confere("recusou: a opcao sem a marca <=== BEBIDA", !/<===[^\n]*BEBIDA/.test(recusou)); // a palavra sai com o código de inversão no meio
confere("recusou: a opcao continua impressa", /quero a bebida/i.test(recusou));

const escolheu = texto(pedido([{
  name: "Frango a Milanesa", quantity: 1, price: 39.9,
  comboSelections: [{ name: "Coca-Cola Lata 350ml", quantity: 1 }],
}]));
confere("escolheu Coca: faixa continua", /POSSUI BEBIDA|CONTEM BEBIDA/i.test(escolheu));

const zero = texto(pedido([{ name: "Refrigerante sem Açúcar Coca-Cola 1,5l", quantity: 1, price: 12 }]));
confere("'Refrigerante sem Acucar' continua bebida", /POSSUI BEBIDA|CONTEM BEBIDA/i.test(zero));

// "Calzone Carne de SOL" saia como bebida (Esfirrao, 13/10/2026): "sol" so
// e bebida com contexto (lata, ml...) ou categoria de bebida.
const BEBIDA = /POSSUI BEBIDA|CONTEM BEBIDA/i;
const calzone = texto(pedido([
  { name: "Calzone carne de sol", quantity: 1, price: 14.5, category: "Calzones" },
  { name: "Ka churrasco bovino", quantity: 1, price: 17.5, comboSelections: [{ name: "QUEIJO MUSSARELA", quantity: 1 }] },
]));
confere("calzone carne de sol: sem a faixa de bebida", !BEBIDA.test(calzone));
confere("calzone carne de sol: sem a marca <=== BEBIDA", !/<===[^\n]*BEBIDA/.test(calzone));
confere("'Cerveja Sol 600ml' continua bebida", BEBIDA.test(texto(pedido([{ name: "Cerveja Sol 600ml", quantity: 1, price: 12 }]))));
confere("'Sol Lata' continua bebida", BEBIDA.test(texto(pedido([{ name: "Sol Lata", quantity: 1, price: 7 }]))));
confere("'Sol' na categoria Bebidas e bebida", BEBIDA.test(texto(pedido([{ name: "Sol", quantity: 1, price: 7, category: "Bebidas" }]))));
confere("'Marmitex Sol Nascente' nao e bebida", !BEBIDA.test(texto(pedido([{ name: "Marmitex Sol Nascente", quantity: 1, price: 20, category: "Marmitas" }]))));
confere("palavra da loja continua valendo", BEBIDA.test(texto({ ...pedido([{ name: "Xodo do Sertao", quantity: 1, price: 9 }]), customBeverageKeywords: "xodo" })));
confere("combo com 'Guarana 1L' continua bebida", BEBIDA.test(texto(pedido([{ name: "Combo Esfiha", quantity: 1, price: 30, comboSelections: [{ name: "Guarana 1L", quantity: 1 }] }]))));

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
