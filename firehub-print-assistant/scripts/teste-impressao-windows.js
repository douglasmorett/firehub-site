/**
 * Perfil "windows" (1.2.39): a comanda pelo DRIVER do Windows.
 *
 * Prova que o tradutor ESC/POS -> texto (impressao-windows.js) devolve so
 * texto limpo — nenhum byte de controle alem do "\n" — para a comanda de
 * verdade (buildEscPos recortado do server.js, como os outros harnesses) e
 * para o DANFE com o QR como imagem. E que a pagina HTML leva o QR.
 *
 *   node scripts/teste-impressao-windows.js
 */
const fs = require("fs");
const path = require("path");
const { textoDaComanda, htmlDaComanda, lerEscPos } = require("../impressao-windows");

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
const codigo = [recortar("cleanAscii"), recortar("documentoDoCliente"), recortar("nomeSemDocumento"), recortar("normalizarCombo"), recortar("buildEscPos"), recortar("perfilDosBytes")].join("\n\n");
// eslint-disable-next-line no-new-func
const { buildEscPos, perfilDosBytes } = new Function(`${codigo}\n return { buildEscPos, perfilDosBytes };`)();

let ok = 0, falhou = 0;
const conferir = (nome, cond) => {
  if (cond) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}`); }
};
const soTexto = (t) => ![...t].some(ch => { const c = ch.charCodeAt(0); return (c < 0x20 && c !== 0x0a) || c > 0x7e; });

const PEDIDO = {
  id: "p1",
  dailyOrderNumber: "42",
  customerName: "Joao da Silva",
  customerPhone: "(22) 99999-0000",
  customerAddress: "Rua Dez, 59 - Costazul",
  deliveryType: "DELIVERY",
  paymentMethod: "Dinheiro",
  items: [
    { name: "X-Burguer Duplo com bacon e cheddar cremoso", qty: 2, price: 29.9, notes: "sem cebola" },
    { name: "Coca-Cola 2L", qty: 1, price: 14.9 },
  ],
  totalAmount: 74.7,
  notes: "Tocar a campainha",
  qrPuxarUrl: "https://firehubfood.com.br/p/abc123",
};

console.log("Perfil windows: texto pelo driver");
conferir('"windows" monta os bytes como "safe"', perfilDosBytes("windows") === "safe" && perfilDosBytes("legacy") === "legacy");

for (const cols of [48, 42, 32]) {
  const bytes = buildEscPos(PEDIDO, "Bistro Burguer", cols, perfilDosBytes("windows"));
  const texto = textoDaComanda(bytes, cols);
  conferir(`${cols} col: sem byte < 0x20 alem de \\n`, soTexto(texto));
  conferir(`${cols} col: nenhuma linha passa de ${cols}`, texto.split("\n").every(l => l.length <= cols));
  conferir(`${cols} col: o conteudo esta la`, /JOAO DA SILVA|Joao da Silva/.test(texto) && /Coca-Cola 2L|COCA-COLA 2L/i.test(texto) && /sem cebola/i.test(texto));
  const html = htmlDaComanda(bytes, { columns: cols, paperWidth: cols === 32 ? "58mm" : "80mm" });
  conferir(`${cols} col: HTML sem controle e com o QR`, soTexto(html.replace(/\n/g, "")) && /<svg/.test(html));
}

// Raster (GS v 0) e corte parcial (GS V 66 0): saem do texto e o raster vira SVG.
const raster = Buffer.concat([
  Buffer.from("\x1b@\x1b!\x08TOTAL\x1b!\x00\n", "latin1"),
  Buffer.from([0x1d, 0x76, 0x30, 0x00, 0x01, 0x00, 0x02, 0x00, 0xff, 0x81]),
  Buffer.from("fim\n\x1bd\x04\x1dVB\x00", "latin1"),
]);
const tr = textoDaComanda(raster, 48);
conferir("negrito vira maiusculas e o corte some", tr === "TOTAL\nfim\n");
conferir("raster vira bloco de imagem", lerEscPos(raster).some(b => b.tipo === "raster" && b.linhas === 2));
conferir("HTML escapa < e &", htmlDaComanda(Buffer.from("a<b & c\n")).includes("a&lt;b &amp; c"));

console.log(`\n${ok} ok, ${falhou} falhou`);
process.exit(falhou ? 1 : 0);
