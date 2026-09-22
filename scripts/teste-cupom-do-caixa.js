/**
 * O PAPEL DO CAIXA, COMO ELE SAI DA IMPRESSORA.
 *
 * O fechamento era montado COMO PEDIDO, e o rodapé dele (TOTAL ESPERADO,
 * DIFERENCA, justificativa) viajava em `order.notes` — que o Assistente só
 * imprime dentro da seção ENTREGA, exigindo deliveryType DELIVERY e endereço.
 * Num cupom de caixa (BALCAO, sem endereço) a linha mais importante do
 * fechamento era descartada em silêncio, e ninguém viu porque o resto do papel
 * saía bonito.
 *
 * Este harness passa o cupom real pelo MESMO `buildEscPos` do Assistente e
 * mostra o texto que sairia. É a única forma de provar, sem impressora, que a
 * diferença chega ao papel.
 *
 *   node scripts/teste-cupom-do-caixa.js            # 80mm (48 colunas)
 *   node scripts/teste-cupom-do-caixa.js 32         # 58mm
 *   node scripts/teste-cupom-do-caixa.js 48 antigo  # finge Assistente < 1.2.19
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
const { cupomDeFechamentoDeCaixa, cupomDeAberturaDeCaixa } = jiti(
  path.resolve(RAIZ, "src", "lib", "cupom-do-caixa.ts")
);

/* ── buildEscPos sem subir o Assistente ──────────────────────────────────
 *
 * `require("server.js")` sobe o servidor HTTP, abre WebSocket e agenda o
 * auto-update. Aqui só interessa a função que monta os bytes, então ela é
 * recortada do arquivo por contagem de chaves e avaliada sozinha, junto com as
 * duas ajudantes de módulo que ela usa. Recorte, não cópia: se a função mudar,
 * o harness testa a versão nova no mesmo instante. */
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
  recortarFuncao(servidor, "function normalizarCombo("),
  recortarFuncao(servidor, "function buildEscPos("),
  "return buildEscPos;",
].join("\n\n");
const buildEscPos = new Function(pedacos)();

/* ── Bytes de controle viram marcação legível ─────────────────────────── */
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

const colunas = Number(process.argv[2] || 48);
const fingirAntigo = String(process.argv[3] || "") === "antigo";

const abertoEm = new Date("2026-09-19T21:00:00-03:00");
const fechadoEm = new Date("2026-09-20T02:41:00-03:00");

const cupom = cupomDeFechamentoDeCaixa({
  sessionId: "sess_teste",
  loja: "Hakim Centro",
  fuso: "America/Sao_Paulo",
  operador: "Maria",
  abertoEm,
  fechadoEm,
  trocoInicial: 100,
  valores: {
    esperado: { cash: 492.6, debit: 320.0, credit: 210.5, pix: 180.0, voucher: 0, total: 2203.1 },
    contado: { cash: 480.6, debit: 320.0, credit: 210.5, pix: 180.0, voucher: 0 },
    diferenca: -12.0,
    online: { ifood: 900.0, food99: 100.0 },
    cuponsDaPlataforma: { ifood: 80.0, food99: 25.0 },
    movimentacoes: { entradas: 50, saidas: 200 },
    foraDaConferencia: { fiado: 90, fiadoQtd: 3, naoIdentificado: 40, naoIdentificadoQtd: 2, mesasAbertas: 70, mesasAbertasQtd: 1 },
    pendentes: { valor: 150, quantidade: 4 },
    finalizadosNoFechamento: 3,
    justificativa: "Faltou troco no fim da noite",
    detalhe: {
      qtdPedidos: 42,
      vendaBruta: 3500.0,
      ticketMedio: 83.33,
      taxaEntregaTotal: 210.0,
      descontoDaLoja: 45.0,
      porCanal: [
        { nome: "iFood", qtd: 12, valor: 1100.0 },
        { nome: "Online", qtd: 18, valor: 1400.0 },
        { nome: "PDV", qtd: 8, valor: 700.0 },
        { nome: "Mesa", qtd: 4, valor: 300.0 },
      ],
      movimentacoes: [
        { tipo: "ENTRADA", valor: 50, descricao: "troco extra", hora: new Date("2026-09-19T22:40:00-03:00") },
        { tipo: "SAIDA", valor: 200, descricao: "deposito no banco", hora: new Date("2026-09-20T01:10:00-03:00") },
      ],
      cancelados: { qtd: 3, valor: 200.0 },
    },
  },
});

if (fingirAntigo) delete cupom.relatorio;

console.log("\n=== FECHAMENTO — " + colunas + " colunas" + (fingirAntigo ? " — Assistente ANTIGO (sem relatorio)" : "") + " ===\n");
console.log(papel(buildEscPos(cupom, "Hakim Centro", colunas, "safe")));

/* ── A prova ───────────────────────────────────────────────────────────── */
const saida = papel(buildEscPos(cupom, "Hakim Centro", colunas, "safe"));
let ok = 0, falhou = 0;
const exigir = (nome, condicao) => {
  if (condicao) { ok++; console.log("  ok     " + nome); }
  else { falhou++; console.log("  FALHOU " + nome); }
};

console.log("\n== O que NAO pode faltar no papel ==");
exigir("a DIFERENCA chega ao papel", /DIFERENCA/.test(saida));
exigir("o valor da diferenca aparece", saida.includes("12,00"));
exigir("o total esperado aparece", saida.includes("2.203,10") || saida.includes("2203,10"));
exigir("a justificativa aparece", /Faltou troco/.test(saida));
exigir("o operador aparece", /Maria/.test(saida));
if (!fingirAntigo) {
  exigir("venda por canal aparece", /iFood \(12\)/.test(saida));
  exigir("sangria com hora e motivo aparece", /deposito no banco/.test(saida));
  exigir("cancelados aparecem", /Cancelados \(3\)/.test(saida));
  exigir("mesas abertas aparecem", /Mesas ainda abertas/.test(saida));
  exigir("nao imprime rodape de pedido", !/Subtotal:/.test(saida));
  exigir("nao imprime secao CLIENTE", !/Qtd Pedidos/.test(saida));
  exigir("pedidos da rua viram aviso", /dados como/.test(saida));
}

console.log("\n=== ABERTURA ===\n");
const abertura = cupomDeAberturaDeCaixa({
  sessionId: "sess_teste",
  loja: "Hakim Centro",
  fuso: "America/Sao_Paulo",
  operador: "Maria",
  abertoEm,
  trocoInicial: 100,
  fechamentoAnterior: { cash: 130, em: null },
});
const papelAbertura = papel(buildEscPos(abertura, "Hakim Centro", colunas, "safe"));
console.log(papelAbertura);
exigir("abertura mostra o troco", papelAbertura.includes("100,00"));
exigir("abertura confronta o fechamento anterior", /Diferenca de/.test(papelAbertura));

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou ? 1 : 0);
