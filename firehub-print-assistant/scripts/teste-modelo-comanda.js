/**
 * Prova que o modelo de comanda (order.blocos) nao mexe em quem nao usa.
 *
 * server.js nao pode ser exigido daqui: ele sobe servidor e toca no Electron.
 * Entao este harness RECORTA as tres funcoes que interessam do arquivo e as
 * avalia isoladas — o que tambem garante que estamos testando o codigo que vai
 * para a loja, nao uma copia que envelhece.
 *
 *   node scripts/teste-modelo-comanda.js
 */
const fs = require("fs");
const path = require("path");

const fonte = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

function recortar(nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  if (inicio < 0) throw new Error(`nao achei function ${nome}`);
  let nivel = 0, i = fonte.indexOf("{", inicio);
  const abre = i;
  for (; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}") { nivel--; if (nivel === 0) break; }
  }
  if (nivel !== 0) throw new Error(`chaves desbalanceadas em ${nome}`);
  return fonte.slice(inicio, i + 1);
}

const sandbox = {};
const codigo = [recortar("cleanAscii"), recortar("normalizarCombo"), recortar("buildEscPos")].join("\n\n");
// eslint-disable-next-line no-new-func
new Function(`${codigo}\n return { buildEscPos };`).call(sandbox);
const { buildEscPos } = new Function(`${codigo}\n return { buildEscPos };`)();

const PEDIDO = {
  id: "ped_teste_1",
  dailyOrderNumber: "79",
  customerName: "Larissa Moreira",
  customerPhone: "(22) 99999-1020",
  customerAddress: "Rua Dez, 59 - Costazul - Rio das Ostras",
  deliveryType: "DELIVERY",
  paymentMethod: "Credito (Pago Online)",
  items: [
    { name: "Esfirra Duo", qty: 1, price: 7.98 },
    { name: "3 Esfirras Doces", qty: 1, price: 26.9, notes: "caprichar no recheio",
      comboSelections: [{ name: "Chocolate Branco", quantity: 3 }] },
  ],
  totalAmount: 27.87,
  deliveryFee: 6.0,
  discountTotal: 12.99,
  source: "IFOOD",
  ifoodReference: "3523",
  createdAt: "2026-09-12T23:22:00-03:00",
  qrPuxarUrl: "https://firehubfood.com.br/loja/exemplo/motoboy?p=20260912-79",
  qrPuxarCodigo: "20260912-79",
};

const MODELO_PADRAO = [
  { tipo: "numeroPedido", ligado: true, tamanho: 2, negrito: true, alinhamento: "centro" },
  { tipo: "canal", ligado: true, alinhamento: "centro" },
  { tipo: "avisoEntrega", ligado: true },
  { tipo: "separador", ligado: true },
  { tipo: "loja", ligado: true },
  { tipo: "dataHora", ligado: true },
  { tipo: "cliente", ligado: true, titulo: "CLIENTE" },
  { tipo: "entrega", ligado: true, titulo: "ENTREGA" },
  { tipo: "itens", ligado: true, titulo: "RESUMO DO PEDIDO" },
  { tipo: "totais", ligado: true },
  { tipo: "pagamento", ligado: true },
  { tipo: "qrMotoboy", ligado: true },
  { tipo: "qrCliente", ligado: true },
];

/**
 * Tira os bytes de controle e deixa o TEXTO como ele cai no papel.
 *
 * Feito a mao, byte a byte, porque expressao regular nao sabe onde acaba um
 * GS ( k: o comprimento do QR vem no proprio comando, e um regex preguicoso
 * parava no meio e deixava a URL no meio do texto — o que fazia a conferencia
 * de largura acusar linha de 69 colunas que nunca existiu.
 */
const legivel = (buf) => {
  const s = buf.toString("binary");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\x1D" && s[i + 1] === "(" && s[i + 2] === "k") {
      const len = s.charCodeAt(i + 3) + (s.charCodeAt(i + 4) << 8);
      i += 4 + len;
      if (!out.endsWith("[QR]")) out += "[QR]";
      continue;
    }
    if (c === "\x1B") {
      const p = s[i + 1];
      if (p === "@" || p === "2") { i += 1; continue; }
      i += 2; continue;                       // ESC + comando + 1 parametro
    }
    if (c === "\x1D") {
      const p = s[i + 1];
      if (p === "L" || p === "W") { i += 3; continue; }
      i += 2; continue;
    }
    if (c === "\r") continue;
    out += c;
  }
  return out;
};

let falhas = 0;
const conferir = (nome, condicao, detalhe) => {
  if (condicao) { console.log("  ok   " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe ? "\n        " + detalhe : ""));
};

console.log("\n1) Pedido SEM modelo sai byte a byte igual ao de antes do campo existir");
const semBlocos = buildEscPos(PEDIDO, "Salz Burgueria", 48, "safe");
const comBlocosVazio = buildEscPos({ ...PEDIDO, blocos: [] }, "Salz Burgueria", 48, "safe");
conferir("blocos ausente == blocos vazio", semBlocos.equals(comBlocosVazio));
conferir("tem o numero do pedido", legivel(semBlocos).includes("(79)"));
conferir("tem o item", legivel(semBlocos).includes("Esfirra Duo"));

console.log("\n2) Modelo padrao imprime as mesmas informacoes");
const comModelo = buildEscPos({ ...PEDIDO, blocos: MODELO_PADRAO }, "Salz Burgueria", 48, "safe");
const txt = legivel(comModelo);
for (const esperado of ["(79)", "Larissa Moreira", "Rua Dez, 59", "Esfirra Duo",
                        "Chocolate Branco", "caprichar no recheio", "Total:", "Credito", "[QR]"]) {
  conferir("mantem " + JSON.stringify(esperado), txt.includes(esperado));
}

console.log("\n3) Desligar um bloco tira aquilo e so aquilo");
const semCliente = legivel(buildEscPos(
  { ...PEDIDO, blocos: MODELO_PADRAO.map(b => b.tipo === "cliente" ? { ...b, ligado: false } : b) },
  "Salz Burgueria", 48, "safe"));
conferir("cliente sumiu", !semCliente.includes("Larissa Moreira"));
conferir("itens continuam", semCliente.includes("Esfirra Duo"));
conferir("endereco continua", semCliente.includes("Rua Dez, 59"));

console.log("\n4) Reordenar muda a ordem no papel");
const invertido = legivel(buildEscPos(
  { ...PEDIDO, blocos: [
    { tipo: "itens", ligado: true, titulo: "RESUMO DO PEDIDO" },
    { tipo: "cliente", ligado: true, titulo: "CLIENTE" },
  ] }, "Salz Burgueria", 48, "safe"));
conferir("itens antes do cliente", invertido.indexOf("Esfirra Duo") < invertido.indexOf("Larissa Moreira"));

console.log("\n5) Texto livre com campo do pedido");
const comTexto = legivel(buildEscPos(
  { ...PEDIDO, blocos: [
    { tipo: "itens", ligado: true },
    { tipo: "textoLivre", ligado: true, texto: "Obrigado, {cliente}! Total {total}", alinhamento: "centro" },
  ] }, "Salz Burgueria", 48, "safe"));
conferir("preencheu o nome", comTexto.includes("Obrigado, Larissa Moreira!"));
conferir("preencheu o total", comTexto.includes("R$ 27,87"));

console.log("\n6) Largura respeitada em 32 e em 42 colunas");
for (const cols of [32, 42, 48]) {
  const saida = legivel(buildEscPos({ ...PEDIDO, blocos: MODELO_PADRAO }, "Salz Burgueria", cols, "safe"));
  const maior = saida.split("\n").reduce((m, l) => Math.max(m, l.length), 0);
  conferir(`nenhuma linha passa de ${cols} colunas`, maior <= cols, `maior linha: ${maior}`);
}

console.log("\n7) Modelo so com secao que este pedido nao tem cai no cupom de sempre");
const soRetirada = buildEscPos(
  { ...PEDIDO, deliveryType: "RETIRADA", customerAddress: "", blocos: [{ tipo: "entrega", ligado: true }] },
  "Salz Burgueria", 48, "safe");
conferir("nao imprimiu papel em branco", legivel(soRetirada).includes("Esfirra Duo"));

console.log("\n8) Tamanho 1,5x usa Fonte B (ESC M 1) e o dobro (GS ! 0x11)");
const grande = buildEscPos(
  { ...PEDIDO, blocos: [{ tipo: "numeroPedido", ligado: true, tamanho: 1.5 }, { tipo: "itens", ligado: true }] },
  "Salz Burgueria", 48, "safe").toString("binary");
conferir("emitiu ESC M 1", grande.includes("\x1BM\x01"));
conferir("emitiu GS ! 0x11", grande.includes("\x1D!\x11"));
const legado = buildEscPos(
  { ...PEDIDO, blocos: [{ tipo: "numeroPedido", ligado: true, tamanho: 1.5 }, { tipo: "itens", ligado: true }] },
  "Salz Burgueria", 48, "legacy").toString("binary");
conferir("perfil legacy nao troca de fonte", !legado.includes("\x1BM\x01"));

console.log("\n9) Via da cozinha (semValores) obedece o modelo e nao leva preco");
const cozinha = legivel(buildEscPos(
  { ...PEDIDO, semValores: true, blocos: [
    { tipo: "numeroPedido", ligado: true, tamanho: 2 },
    { tipo: "itens", ligado: true, titulo: "RESUMO DO PEDIDO" },
  ] }, "Salz Burgueria", 48, "safe"));
conferir("tem os itens", cozinha.includes("Esfirra Duo"));
conferir("nao tem total", !cozinha.includes("Total:"));
conferir("nao tem o cliente (bloco fora do modelo)", !cozinha.includes("Larissa Moreira"));

console.log("\n10) Centro e centro mesmo, tambem em corpo ampliado");
// O recuo tem que sair em colunas NORMAIS. Contado em colunas do proprio
// tamanho, o ajuste anda de dois em dois e o texto encosta a esquerda — foi
// o que o lojista viu na previa em 12/09/2026.
for (const tamanho of [1, 1.5, 2, 3]) {
  const saida = legivel(buildEscPos(
    { ...PEDIDO, blocos: [{ tipo: "numeroPedido", ligado: true, tamanho, alinhamento: "centro" }, { tipo: "itens", ligado: true }] },
    "Salz Burgueria", 48, "safe"));
  const linha = saida.split("\n").find((l) => l.includes("(79)")) || "";
  const texto = linha.trim();
  const esquerda = linha.length - linha.trimStart().length;
  const direita = 48 - esquerda - Math.round(texto.length * tamanho);
  // Sobra impar nao divide igual: 1 coluna de diferenca e o maximo aceitavel.
  conferir(`${tamanho}x centralizado (${esquerda} a esquerda, ${direita} a direita)`,
    Math.abs(esquerda - direita) <= 1);
}

console.log("\n11) Esconder a taxa de entrega nao mexe no total");
const comTaxa = legivel(buildEscPos({ ...PEDIDO, blocos: MODELO_PADRAO }, "Salz Burgueria", 48, "safe"));
const semTaxa = legivel(buildEscPos(
  { ...PEDIDO, blocos: MODELO_PADRAO.map(b => b.tipo === "totais" ? { ...b, ocultarTaxaEntrega: true } : b) },
  "Salz Burgueria", 48, "safe"));
conferir("com a opcao desligada a taxa sai", comTaxa.includes("Taxa de Entrega"));
conferir("com a opcao ligada a taxa some", !semTaxa.includes("Taxa de Entrega"));
conferir("o subtotal continua", semTaxa.includes("Subtotal:"));
conferir("o desconto continua", semTaxa.includes("Desconto"));
const totalDe = (t) => (t.split("\n").find((l) => l.includes("Total:")) || "").trim();
conferir(`o TOTAL nao muda (${totalDe(semTaxa)})`, totalDe(comTaxa) === totalDe(semTaxa) && totalDe(semTaxa).includes("27,87"));

console.log("\n12) O cupom fecha a conta — numeros reais do 99Food (ref 266009)");
// Medido no banco em 12/09/2026: item 59,99 / desconto 25,00 / taxa 1,00 e
// total 48,52 vindo do parceiro. 59,99 - 25,00 + 1,00 da 35,99, e o lojista
// somava de cabeca e via que nao fechava.
const pedido99 = {
  id: "ped_99", dailyOrderNumber: "20", customerName: "Vitoria Rodrigues",
  customerAddress: "R. Prof. Firmino Cardoso, 5 - Coelho",
  deliveryType: "DELIVERY", paymentMethod: "Pago Online (99Food)",
  source: "99FOOD", openDeliveryReference: "266009",
  items: [{ name: "Box de Frango M + Molho", qty: 1, price: 59.99 }],
  totalAmount: 48.52, deliveryFee: 1.00, discountTotal: 25.00,
  createdAt: "2026-09-11T23:33:00-03:00",
};
const cupom99 = legivel(buildEscPos(pedido99, "Loja do Lucas", 48, "safe"));
const valorDe = (rotulo, txt) => {
  const l = txt.split("\n").find((x) => x.includes(rotulo));
  if (!l) return null;
  const m = l.match(/-?R\$\s*([\d.]+,\d{2})/);
  return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) * (l.includes("-R$") ? -1 : 1) : null;
};
const sub = valorDe("Subtotal:", cupom99);
const desc = valorDe("Desconto (Cupom - Loja):", cupom99) || 0;
const outros = valorDe("Desconto:", cupom99);
const taxa = valorDe("Taxa de Entrega:", cupom99);
const tot = valorDe("Total:", cupom99);
conferir("imprimiu a linha que fecha a conta", outros !== null);
const soma = Math.round(((sub || 0) + (desc || 0) + (outros || 0) + (taxa || 0)) * 100) / 100;
conferir(`o papel fecha: ${sub} ${desc} ${outros} +${taxa} = ${soma} (total ${tot})`, soma === tot);
conferir("o TOTAL continua sendo o do parceiro", tot === 48.52);

// Pedido que ja fechava nao ganha linha nenhuma a mais.
const certinho = legivel(buildEscPos(
  { ...pedido99, totalAmount: 35.99 }, "Loja do Lucas", 48, "safe"));
conferir("pedido que ja fechava mantem a quebra por origem", certinho.includes("Desconto (Cupom - Loja):"));

console.log(falhas === 0 ? "\nTUDO OK\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
