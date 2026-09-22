/**
 * O PAPEL: texto com variavel no meio da frase, e o modelo POR IMPRESSORA.
 *
 * O dono viu o editor de modelos da Saipos e pediu duas coisas (19/09/2026):
 * cada impressora escolhe o seu modelo, e o cabecalho/rodape aceita variavel
 * no meio da frase — onde o ROTULO some junto com o campo vazio, para nao
 * imprimir "Ref:" sozinho num pedido sem referencia.
 *
 * Este harness prova no BYTE, recortando buildEscPos do server.js como o
 * teste-modelo-comanda.js ja faz (server.js nao pode ser exigido daqui: sobe
 * servidor e toca no Electron).
 *
 * O que ele protege, alem do recurso novo:
 *   • bloco desconhecido continua sumindo em silencio (Assistente antigo);
 *   • quem NAO usa modelo nenhum imprime exatamente como antes.
 *
 *   node scripts/teste-texto-rico.js
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
  if (nivel !== 0) throw new Error(`chaves desbalanceadas em ${nome}`);
  return fonte.slice(inicio, i + 1);
}

// documentoDoCliente/nomeSemDocumento entram no recorte desde a 1.2.20 (o
// "CPF na nota" em linha propria): buildEscPos as chama, e sem elas aqui o
// harness quebra com ReferenceError antes de testar qualquer coisa.
const codigo = [recortar("cleanAscii"), recortar("documentoDoCliente"), recortar("nomeSemDocumento"), recortar("normalizarCombo"), recortar("buildEscPos")].join("\n\n");
// eslint-disable-next-line no-new-func
const { buildEscPos } = new Function(`${codigo}\n return { buildEscPos };`)();

const legivel = (buf) => buf.toString("binary").replace(/[\x00-\x08\x0b-\x1f\x7f-\xff]/g, "");

let ok = 0, falhou = 0;
const conferir = (nome, cond) => {
  if (cond) { ok++; console.log(`  ok    ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}`); }
};

const PEDIDO = {
  id: "p1",
  dailyOrderNumber: "42",
  customerName: "Ana Souza",
  customerPhone: "(22) 99999-0000",
  customerAddress: "Rua Dez, 59 - Costazul",
  deliveryType: "DELIVERY",
  paymentMethod: "Dinheiro",
  items: [{ name: "Esfirra de Carne", qty: 2, price: 7.5 }],
  totalAmount: 21.0,
  deliveryFee: 6.0,
  notes: "sem cebola",
  changeAmount: 50,
  motoboyName: "Bruno",
  source: "SITE",
  createdAt: "2026-09-19T20:10:00-03:00",
};

const bloco = (tipo, extra = {}) => ({ tipo, ligado: true, ...extra });
const comModelo = (pedido, blocos) => legivel(buildEscPos({ ...pedido, blocos }, "Salz", 48, "safe"));

console.log("\n== o rotulo some junto com o campo vazio ==");
const modeloRico = [
  bloco("textoRico", {
    linhas: [
      { partes: [{ texto: "Entregador: ", campo: "entregador" }] },
      { partes: [{ texto: "Obs: ", campo: "observacao" }], negrito: true },
      { partes: [{ texto: "Troco para ", campo: "troco" }] },
      { partes: [{ texto: "OBRIGADO PELA PREFERENCIA" }], alinhamento: "centro" },
    ],
  }),
  bloco("itens", { titulo: "PEDIDO" }),
];

const cheio = comModelo(PEDIDO, modeloRico);
conferir("com entregador, imprime rotulo + valor", /Entregador: Bruno/.test(cheio));
conferir("com observacao, imprime", /Obs: sem cebola/.test(cheio));
conferir("com troco, imprime o valor formatado", /Troco para R\$ 50,00/.test(cheio));
conferir("o literal sai sempre", /OBRIGADO PELA PREFERENCIA/.test(cheio));

const magro = comModelo({ ...PEDIDO, motoboyName: "", notes: "", changeAmount: 0 }, modeloRico);
conferir("sem entregador, NAO imprime 'Entregador:' orfao", !/Entregador:/.test(magro));
conferir("sem observacao, NAO imprime 'Obs:' orfao", !/Obs:/.test(magro));
conferir("sem troco, NAO imprime 'Troco para' orfao", !/Troco para/.test(magro));
conferir("mas o literal continua saindo", /OBRIGADO PELA PREFERENCIA/.test(magro));
conferir("e a comanda continua tendo o pedido", /Esfirra de Carne/.test(magro));

console.log("\n== pedaco literal no meio de dois campos ==");
const mista = [
  bloco("textoRico", { linhas: [{ partes: [{ campo: "cliente" }, { texto: " - " }, { texto: "tel ", campo: "telefone" }] }] }),
  bloco("itens"),
];
conferir("com os dois, sai inteiro", /Ana Souza - tel/.test(comModelo(PEDIDO, mista)));
conferir(
  "sem o telefone, o rotulo 'tel' some e o literal fica",
  (() => { const t = comModelo({ ...PEDIDO, customerPhone: "" }, mista); return /Ana Souza/.test(t) && !/tel /.test(t); })(),
);

console.log("\n== nada regride para quem nao usa ==");
const semModelo = legivel(buildEscPos(PEDIDO, "Salz", 48, "safe"));
conferir("sem blocos, a comanda de fabrica sai inteira", /Esfirra de Carne/.test(semModelo) && /Ana Souza/.test(semModelo));
conferir("bloco desconhecido nao quebra e nao imprime lixo", (() => {
  const t = comModelo(PEDIDO, [bloco("inventadoNoFuturo"), bloco("itens")]);
  return /Esfirra de Carne/.test(t) && !/inventadoNoFuturo/.test(t);
})());
conferir("textoRico sem linhas nao imprime nada e nao quebra", (() => {
  const t = comModelo(PEDIDO, [bloco("textoRico"), bloco("itens")]);
  return /Esfirra de Carne/.test(t);
})());
conferir("linha sem partes nao vira linha em branco", (() => {
  const t = comModelo(PEDIDO, [bloco("textoRico", { linhas: [{ partes: [] }] }), bloco("itens")]);
  return /Esfirra de Carne/.test(t);
})());

console.log("\n== o modelo vem do DESTINO quando o destino tem um ==");
// Nao da para chamar o laco de destinos daqui (ele vive dentro do poll), entao
// a conferencia e no codigo-fonte: e a linha que faz o modelo por impressora
// valer na fila da nuvem, e sem ela o recurso funciona so com o painel aberto.
conferir(
  "server.js prefere destino.blocos ao job.order.blocos",
  /blocos: Array\.isArray\(destino\.blocos\) && destino\.blocos\.length/.test(fonte),
);
conferir(
  "e cai no job.order.blocos quando o destino nao traz",
  /\? destino\.blocos\s*\n\s*: job\.order\?\.blocos/.test(fonte),
);

console.log("\n== os campos novos existem nos DOIS lados ==");
for (const campo of ["observacao", "subtotal", "desconto", "troco"]) {
  conferir(`o Assistente conhece {${campo}}`, new RegExp(`^\\s+${campo}:`, "m").test(fonte));
}

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
