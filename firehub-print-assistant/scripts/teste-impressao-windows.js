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

// ── PAPEL EM BRANCO ANTES DO TEXTO (16/10/2026) ──────────────────────────
// A 2a via do fechamento saiu na Diebold do Bistro Burguer com ~5 cm em
// branco antes do titulo. Pelo driver, cada linha vazia no comeco e papel:
// a pagina tem que comecar no primeiro texto, e terminar no ultimo.
console.log("\nSem linha vazia nas pontas da pagina");
const primeiraLinhaDoHtml = (html) => {
  const corpo = html.split("<body>")[1] || "";
  const m = corpo.match(/^<pre>([^\n]*)/);
  return m ? m[1].replace(/<[^>]+>/g, "") : null;
};
const comecoSujo = Buffer.from("\x1b@\x1bt\x03\n\n\x1bd\x05   \n\x1d!\x01\x1bE\x01TITULO\x1bE\x00\x1d!\x00\nmeio\n\n\ndepois\n\n\x1bd\x04\x1dV\x00", "latin1");
const blSujo = lerEscPos(comecoSujo);
conferir("LF, ESC d e linha so de espacos no comeco somem", blSujo[0].tipo === "linha" && blSujo[0].runs.map(r => r.texto).join("") === "TITULO");
conferir("as linhas vazias do MEIO ficam", textoDaComanda(comecoSujo, 48) === "TITULO\nmeio\n\n\ndepois\n");
conferir("HTML comeca no titulo", primeiraLinhaDoHtml(htmlDaComanda(comecoSujo)) === "TITULO");
conferir("HTML termina no ultimo texto", /depois<\/pre><\/body>/.test(htmlDaComanda(comecoSujo)));
conferir("so linhas vazias: pagina vazia, sem erro", lerEscPos(Buffer.from("\n\n\x1bd\x03\n", "latin1")).length === 0);

const FECHAMENTO = {
  id: "caixa_fechamento_1_reimpressao_1", kind: "CAIXA_FECHAMENTO",
  dailyOrderNumber: "2a VIA - FECHAMENTO DE CAIXA", customerName: "16/10/2026 19:13 - Operador",
  caixaQuando: "16/10/2026 19:13", caixaOperador: "Operador",
  relatorio: [
    { tipo: "titulo", texto: "Conferencia" },
    { tipo: "linha", texto: "Dinheiro", valor: "R$ 120,00" },
    { tipo: "separador" },
    { tipo: "titulo", texto: "NAO E DOCUMENTO FISCAL" },
  ],
  customerPhone: "", customerAddress: "", deliveryType: "BALCAO", source: "CAIXA", paymentMethod: "-",
  isPrepaid: true, items: [{ name: "Dinheiro", qty: 1, price: 120 }], totalAmount: 120, deliveryFee: 0, notes: "Guarde",
};
const htmlFech = htmlDaComanda(buildEscPos(FECHAMENTO, "Bistro Burguer", 48, perfilDosBytes("windows")), { columns: 48 });
conferir("2a via do fechamento: a pagina comeca no titulo", /^\s*2a VIA - FECHAMENTO DE CAIXA$/.test(primeiraLinhaDoHtml(htmlFech) || ""));

// Modelo de comanda que abre com "espaco" e com secao titulada (que comeca
// com LF): o papel comeca no texto mesmo assim.
const comModelo = buildEscPos({ ...PEDIDO, blocos: [{ tipo: "espaco" }, { tipo: "espaco" }, { tipo: "cliente", ligado: true }, { tipo: "itens", ligado: true }] }, "Bistro Burguer", 48, perfilDosBytes("windows"));
const primeiraDoModelo = primeiraLinhaDoHtml(htmlDaComanda(comModelo, { columns: 48 })) || "";
conferir("modelo que abre com espaco: a pagina comeca no texto", primeiraDoModelo.trim().length > 0);

console.log(`\n${ok} ok, ${falhou} falhou`);
process.exit(falhou ? 1 : 0);
