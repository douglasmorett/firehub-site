// Sonda manual (Electron): imprime uma comanda de exemplo pelo perfil "windows" numa impressora do Windows.
// Uso: npx electron scripts/sonda-driver-windows.js "Nome da impressora"
const fs = require("fs"), path = require("path");
const { app } = require("electron");
const { htmlDaComanda, imprimirPeloDriver } = require("../impressao-windows");
const fonte = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
function recortar(nome) { const ini = fonte.indexOf(`function ${nome}(`); let n = 0, i = fonte.indexOf("{", ini); for (; i < fonte.length; i++) { if (fonte[i] === "{") n++; else if (fonte[i] === "}") { n--; if (!n) break; } } return fonte.slice(ini, i + 1); }
const { buildEscPos } = new Function([ "cleanAscii", "documentoDoCliente", "nomeSemDocumento", "normalizarCombo", "buildEscPos" ].map(recortar).join("\n") + "\nreturn { buildEscPos };")();
const pedido = { id: "p1", dailyOrderNumber: "42", customerName: "Joao da Silva", customerPhone: "(22) 99999-0000", customerAddress: "Rua Dez, 59", deliveryType: "DELIVERY", paymentMethod: "Dinheiro", items: [{ name: "X-Burguer Duplo", qty: 2, price: 29.9 }, { name: "Coca-Cola 2L", qty: 1, price: 14.9 }], totalAmount: 74.7, qrPuxarUrl: "https://firehubfood.com.br/p/abc" };
app.whenReady().then(async () => {
  try { await imprimirPeloDriver(process.argv[process.argv.length - 1], htmlDaComanda(buildEscPos(pedido, "Bistro Burguer", 48, "safe"), { columns: 48 })); fs.writeFileSync(path.join(__dirname, "sonda.log"), "SONDA OK"); }
  catch (e) { fs.writeFileSync(path.join(__dirname, "sonda.log"), "SONDA ERRO " + e.message); }
  app.quit();
});
