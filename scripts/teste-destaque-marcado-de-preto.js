/**
 * A TARJA "MARCADA DE PRETO" — e os campos que faltavam para reproduzir a
 * notinha que o Frangoso usava antes de vir para o FireHub.
 *
 * O lojista mandou a notinha dele (Salzburg, iFood, 11/09/2026) e pediu o
 * mesmo layout: "olhe a ordem das coisas, como são chamadas, o que está em
 * destaque marcado de preto". Três linhas daquele papel são fundo preto com
 * letra branca — o tipo do pedido, o nome do cliente e o "PAGO ONLINE". O
 * editor de modelo do FireHub só sabia negrito, e negrito não faz esse
 * trabalho num papel térmico cheio de texto.
 *
 * O que este harness protege:
 *   • a tarja sai mesmo — bytes GS B 1 / GS B 0 no fluxo;
 *   • ela ocupa a LARGURA INTEIRA (tarja do tamanho do texto vira um
 *     retângulo torto no meio da linha);
 *   • o recuo do alinhamento entra DENTRO da tarja, não antes dela;
 *   • a PRÉVIA da tela concorda com o papel — prévia que mente é pior que
 *     prévia nenhuma, porque o lojista configura confiando nela;
 *   • os campos novos (localizador, previsão, taxa de serviço, bandeira,
 *     quantidade de itens, impresso em) existem NOS DOIS lados. Campo que
 *     exista só num deles imprime vazio ou some da prévia.
 *
 *   node scripts/teste-destaque-marcado-de-preto.js
 */
const fs = require("fs");
const path = require("path");
const createJiti = require("jiti");

const RAIZ = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(RAIZ, "src") },
  interopDefault: true,
  esmResolve: true,
});
const M = jiti(path.resolve(RAIZ, "src", "lib", "comanda-modelo.ts"));

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

const INV_ON = "\x1d\x42\x01";
const INV_OFF = "\x1d\x42\x00";

let ok = 0, falhou = 0;
const exigir = (nome, condicao, detalhe) => {
  if (condicao) { ok++; console.log("  ok     " + nome); }
  else { falhou++; console.log("  FALHOU " + nome + (detalhe ? "\n         " + detalhe : "")); }
};

const COLUNAS = 48;
const bl = (tipo, extra = {}) => ({ tipo, ligado: true, ...extra });

const pedido = {
  id: "ord_1", dailyOrderNumber: "3615", source: "IFOOD", ifoodReference: "I-3615",
  customerName: "Miguel Moraes", customerPhone: "0800 705 1020",
  deliveryType: "DELIVERY", customerAddress: "R. Liberdade, 6 - Mutondo",
  paymentMethod: "Pago Online", isPrepaid: true,
  items: [{ name: "Duplo Cheddar Bacon", qty: 1, price: 27.99 }],
  totalAmount: 87.71, deliveryFee: 6.94, serviceFee: 1.72,
  ifoodOrderId: "95610470", previsao: "19:43 - 19:53", bandeira: "OTHER",
  createdAt: new Date().toISOString(),
};

const comBlocos = (blocos) =>
  buildEscPos({ ...pedido, blocos }, "Salzburg Hamburgueria", COLUNAS, "safe").toString("binary");

console.log("\n== A tarja sai no papel ==");
const semTarja = comBlocos([bl("textoLivre", { texto: "PAGO ONLINE" }), bl("itens")]);
const comTarja = comBlocos([bl("textoLivre", { texto: "PAGO ONLINE", invertido: true }), bl("itens")]);
exigir("sem a marca, nenhum byte de inversão", !semTarja.includes(INV_ON + "PAGO"));
exigir("com a marca, a inversão liga e desliga", comTarja.includes(INV_ON) && comTarja.includes(INV_OFF));

const faixa = (comTarja.match(new RegExp(INV_ON + "([^\\x1d]*)" + INV_OFF)) || [])[1];
exigir("a tarja ocupa a largura inteira do papel", faixa != null && faixa.length === COLUNAS, faixa == null ? "não achei a faixa" : `${faixa.length} de ${COLUNAS}: ${JSON.stringify(faixa)}`);
exigir("o texto está dentro da tarja", (faixa || "").includes("PAGO ONLINE"));

console.log("\n== O recuo entra DENTRO da tarja ==");
const centro = comBlocos([bl("textoLivre", { texto: "ENTREGA", invertido: true, alinhamento: "centro" }), bl("itens")]);
const faixaCentro = (centro.match(new RegExp(INV_ON + "([^\\x1d]*)" + INV_OFF)) || [])[1] || "";
exigir("a faixa continua com a largura inteira", faixaCentro.length === COLUNAS, `${faixaCentro.length}`);
exigir("o texto fica centralizado dentro dela", faixaCentro.trim() === "ENTREGA" && faixaCentro.startsWith(" "));
exigir("não sobrou espaço ANTES da tarja", !centro.includes(" " + INV_ON));

console.log("\n== A prévia da tela concorda com o papel ==");
const linhas = M.montarComanda([bl("textoLivre", { texto: "PAGO ONLINE", invertido: true, alinhamento: "centro" })], M.pedidoDeExemplo(), { colunas: COLUNAS, comValores: true });
const renderizadas = M.linhasDoPapel(linhas, COLUNAS);
const daTarja = renderizadas.find((l) => l.invertido);
exigir("a prévia marca a linha como invertida", !!daTarja);
exigir("a prévia usa a largura inteira, como o papel", !!daTarja && daTarja.texto.length === COLUNAS, daTarja ? String(daTarja.texto.length) : "");
exigir("a prévia não recua por fora", !!daTarja && daTarja.recuo === 0);

console.log("\n== O sanitizador não come a marca ==");
const guardado = M.lerModelo({ versao: 1, cozinha: [], completo: [bl("textoLivre", { texto: "X", invertido: true })] });
exigir("invertido sobrevive ao salvar/ler", guardado.completo[0].invertido === true);

console.log("\n== Os campos novos existem nos DOIS lados ==");
const NOVOS = ["localizador", "previsao", "taxaServico", "bandeira", "quantidadeDeItens", "impressoEm"];
const naTela = M.CAMPOS_DISPONIVEIS.map((c) => c.chave);
for (const campo of NOVOS) {
  exigir(`"${campo}" aparece na lista da tela`, naTela.includes(campo));
}
const doAssistente = recortarFuncao(servidor, "function buildEscPos(");
for (const campo of NOVOS) {
  exigir(`"${campo}" existe no Assistente`, new RegExp(`\\b${campo}:`).test(doAssistente));
}

console.log("\n== E chegam ao papel com o valor do pedido ==");
const comCampos = comBlocos([
  bl("textoRico", {
    linhas: [
      { partes: [{ texto: "Localizador: ", campo: "localizador" }], negrito: true },
      { partes: [{ texto: "Previsao: ", campo: "previsao" }] },
      { partes: [{ texto: "Taxa de servico(+) ", campo: "taxaServico" }] },
      { partes: [{ texto: "Bandeira: ", campo: "bandeira" }] },
      { partes: [{ texto: "Quantidade de itens: ", campo: "quantidadeDeItens" }] },
    ],
  }),
  bl("itens"),
]);
exigir("o localizador sai", comCampos.includes("95610470"));
exigir("a previsão sai", comCampos.includes("19:43 - 19:53"));
exigir("a taxa de serviço sai", comCampos.includes("1,72"));
exigir("a bandeira sai", comCampos.includes("OTHER"));
exigir("a quantidade de itens sai", /Quantidade de itens: 1/.test(comCampos));

console.log("\n== Rótulo some junto com o campo vazio ==");
const semLocalizador = buildEscPos(
  { ...pedido, ifoodOrderId: "", ifoodReference: "", openDeliveryReference: "", blocos: [bl("textoRico", { linhas: [{ partes: [{ texto: "Localizador: ", campo: "localizador" }] }] }), bl("itens")] },
  "Salzburg", COLUNAS, "safe"
).toString("binary");
exigir("sem localizador, o rótulo não fica órfão", !semLocalizador.includes("Localizador:"));

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
