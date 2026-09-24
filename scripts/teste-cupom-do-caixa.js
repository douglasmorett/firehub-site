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
  // As duas do "CPF na nota" (1.2.20): o papel do Assistente ANTIGO (sem
  // relatorio) passa pelo caminho de pedido, que as chama.
  recortarFuncao(servidor, "function documentoDoCliente("),
  recortarFuncao(servidor, "function nomeSemDocumento("),
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
    onlineEsperado: 1000.0,
    movimentacoes: { entradas: 50, saidas: 200 },
    foraDaConferencia: { fiado: 90, fiadoQtd: 3, naoIdentificado: 40, naoIdentificadoQtd: 2, mesasAbertas: 70, mesasAbertasQtd: 1 },
    pendentes: { valor: 150, quantidade: 4 },
    finalizadosNoFechamento: 3,
    justificativa: "Faltou troco no fim da noite",
    // O retrato no formato de lib/esperado-do-turno.ts (fechamento completo,
    // 23/09/2026): faturamento por forma, canal com as formas, tipo de venda,
    // cupons da loja x plataformas, fiado com nome, entregadores.
    detalhe: {
      vendas: { qtd: 42, valor: 3500.0 },
      porForma: [
        { nome: "Dinheiro", qtd: 10, valor: 542.6 },
        { nome: "Debito", qtd: 6, valor: 320.0 },
        { nome: "Credito", qtd: 5, valor: 210.5 },
        { nome: "Pix", qtd: 4, valor: 180.0 },
        { nome: "Pago online iFood", qtd: 12, valor: 820.0 },
        { nome: "Pago online 99Food", qtd: 2, valor: 75.0 },
        { nome: "Fiado", qtd: 3, valor: 90.0 },
        { nome: "Forma nao identificada", qtd: 2, valor: 40.0 },
      ],
      porCanal: [
        { nome: "iFood", qtd: 12, valor: 900.0, formas: [{ nome: "Pago online", qtd: 12, valor: 820.0 }, { nome: "Cupom da plataforma", qtd: 5, valor: 80.0 }] },
        { nome: "Site", qtd: 18, valor: 1400.0, formas: [{ nome: "Pix", qtd: 4, valor: 180.0 }, { nome: "Dinheiro", qtd: 14, valor: 1220.0 }] },
        { nome: "PDV", qtd: 8, valor: 700.0, formas: [{ nome: "Debito", qtd: 6, valor: 610.0 }, { nome: "Fiado", qtd: 2, valor: 90.0 }] },
        { nome: "Mesa", qtd: 4, valor: 300.0, formas: [{ nome: "Credito", qtd: 4, valor: 300.0 }] },
      ],
      porTipo: [
        { nome: "Entrega", qtd: 26, valor: 2200.0 },
        { nome: "Balcao", qtd: 12, valor: 1000.0 },
        { nome: "Mesa", qtd: 4, valor: 300.0 },
      ],
      cupomDaLoja: { qtd: 3, valor: 45.0, porCanal: [{ nome: "Site", qtd: 2, valor: 30.0 }, { nome: "iFood", qtd: 1, valor: 15.0 }] },
      cupomDaPlataforma: [{ nome: "iFood", qtd: 5, valor: 80.0 }, { nome: "99Food", qtd: 2, valor: 25.0 }],
      onlinePorCanal: [{ nome: "iFood", qtd: 12, valor: 900.0 }, { nome: "99Food", qtd: 2, valor: 100.0 }],
      taxaDeEntrega: { qtd: 30, valor: 210.0 },
      mesas: { servico: 30.0, servicoQtd: 4, gorjeta: 0 },
      gaveta: { vendasEmDinheiro: 542.6, reforcosQtd: 1, sangriasQtd: 1 },
      movimentacoes: [
        { tipo: "ENTRADA", valor: 50, descricao: "troco extra", hora: new Date("2026-09-19T22:40:00-03:00") },
        { tipo: "SAIDA", valor: 200, descricao: "deposito no banco", hora: new Date("2026-09-20T01:10:00-03:00") },
      ],
      fiado: [
        { hora: new Date("2026-09-19T22:05:00-03:00"), numero: "#12", nome: "Joao", valor: 30.0 },
        { hora: new Date("2026-09-19T23:10:00-03:00"), numero: "#19", nome: "Maria", valor: 45.0 },
        { hora: new Date("2026-09-20T00:30:00-03:00"), numero: "#27", nome: "Joao", valor: 15.0 },
      ],
      cancelados: {
        qtd: 3,
        valor: 200.0,
        lista: [
          { hora: new Date("2026-09-19T21:40:00-03:00"), numero: "#5", canal: "iFood", referencia: "4035", valor: 80.0, motivo: "Cliente desistiu", quem: "cliente" },
          { hora: new Date("2026-09-19T22:15:00-03:00"), numero: "#9", canal: "99Food", referencia: "403012", valor: 70.0, motivo: null, quem: null },
          { hora: new Date("2026-09-20T00:05:00-03:00"), numero: "#21", canal: "PDV", referencia: null, valor: 50.0, motivo: "Item em falta", quem: "loja" },
        ],
      },
      entregadores: [
        { nome: "Carlos", entregas: 8, dinheiro: 180.0, cartao: 95.5, pix: 0, online: 210.0, outros: 0, taxas: 40.0, diaria: 50.0, semDistancia: 0, pelaTaxaDoCliente: 0 },
      ],
      entregaParceira: { qtd: 4, valor: 300.0 },
      semEntregador: { qtd: 1, valor: 45.0 },
      maisVendidos: [{ nome: "Esfiha de carne", qtd: 40, valor: 200.0 }],
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
  exigir("cancelados aparecem, um a um", /Total cancelado \(3\)/.test(saida) && /#4035/.test(saida));
  exigir("fiado com o nome de quem comprou", /#12 Joao/.test(saida) && /Joao R\$ 45,00/.test(saida));
  exigir("cupom da loja, do iFood e do 99 separados",
    /Pago pela loja \(3\)/.test(saida) && /Pago pelo iFood \(5\)/.test(saida) && /Pago pelo 99Food \(2\)/.test(saida));
  exigir("canal com as formas de pagamento", /- Pago online \(12\)/.test(saida));
  exigir("entregador com o que recebe", /A pagar ao entregador/.test(saida));
  exigir("tipo de venda com ticket", /Entrega \(26\)/.test(saida) && /ticket medio/.test(saida));
  exigir("total faturado", /TOTAL FATURADO/.test(saida));
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
