/**
 * O FECHAMENTO DE CAIXA SEPARADO POR TIPO DE VENDA — Delivery, Retirada,
 * Balcão, Mesas, Totem — fechando no centavo com o total.
 *
 *   npx tsx scripts/teste-caixa-por-tipo.ts           # papel em 48 colunas (80 mm)
 *   npx tsx scripts/teste-caixa-por-tipo.ts 32        # 58 mm
 *
 * Pedido do Douglas a partir da Delícia de Casa (02/10/2026): "no relatório do
 * caixa, sair de forma separada: mesas, vendas balcão e delivery — no
 * fechamento e no extrato também", com a foto do papel de outro sistema
 * ("VENDAS RETIRADA / DINHEIRO / VALOR DOS PRODUTOS / TOTAL").
 *
 * Três provas, sem banco nenhum:
 *
 *  1. A APURAÇÃO (lib/apuracao-do-turno.ts) num turno inventado mas realista —
 *     delivery em dinheiro com troco para R$ 100, iFood pago online com cupom,
 *     Pix trocado na entrega, 99Food, balcão no Pix, balcão dividido, fiado,
 *     totem pago e totem abandonado, mesa com taxa de serviço e troco, mesa
 *     com desconto, mesa ainda aberta e um cancelado. Cada bloco fecha
 *     (produtos + taxas − desconto + ajustes = total = Σ formas), e a soma dos
 *     blocos é o total faturado.
 *  2. A CONFERÊNCIA NÃO MUDOU: o esperado de cada forma, o fora da
 *     conferência e os pendentes saem iguais aos da versão do origin/master,
 *     carregada do git com o Prisma trocado por um falso que devolve os
 *     mesmos pedidos. A única diferença no retrato é a de propósito — o troco
 *     da mesa sai do Dinheiro.
 *  3. O PAPEL: o cupom do fechamento passa pelo MESMO buildEscPos do
 *     Assistente (recortado do server.js, como scripts/teste-cupom-do-caixa.js)
 *     e o texto que sairia na impressora é mostrado aqui.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { apurarVendasDoTurno, trocoDaConta, type MesaDoTurno } from "../src/lib/apuracao-do-turno";
import { cupomDeFechamentoDeCaixa, cupomDeMovimentacaoDeCaixa, type BlocoDoTipo } from "../src/lib/cupom-do-caixa";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createJiti } = require("jiti");

const RAIZ = resolve(__dirname, "..");
let ok = 0, falhou = 0;
const exigir = (nome: string, condicao: boolean, detalhe?: unknown) => {
  if (condicao) { ok++; console.log("  ok     " + nome); }
  else { falhou++; console.log("  FALHOU " + nome + (detalhe !== undefined ? "  → " + JSON.stringify(detalhe) : "")); }
};
const c = (v: number) => Math.round(v * 100);
const igual = (a: number, b: number) => c(a) === c(b);

// ── O TURNO ─────────────────────────────────────────────────────────────────
// Delícia de Casa, sexta 02/10/2026, caixa aberto às 18h com R$ 150 de troco.
const h = (hhmm: string) => new Date(`2026-10-02T${hhmm}:00-03:00`);
const base = { discountIfood: 0, discountTotal: 0, discountMerchant: 0, notes: null, tableSessionId: null, openDeliveryChannel: null, discountDetails: null,
  ifoodOrderId: null, ifoodReference: null, openDeliveryOrderId: null, openDeliveryReference: null, paymentMethods: null, paymentPaidAt: null, gatewayProvider: null,
  customerName: "Cliente", employeeName: null, deliveryBy: null, motoboyId: null, motoboyFee: null, deliveryDistance: null, totemLicenseId: null, deliveryFee: 0 };
const item = (price: number, quantity = 1) => ({ price, quantity });

const pedidos: any[] = [
  // 1. Site, entrega, dinheiro — o cliente pagou com nota de R$ 100 (o troco
  //    da entrega volta pelo motoboy e nunca foi venda: conta o total).
  { ...base, dailyOrderNumber: 1, createdAt: h("18:10"), status: "ENTREGUE", source: "ONLINE", deliveryType: "DELIVERY", paymentMethod: "Dinheiro (troco para R$ 100,00)", changeAmount: 100,
    totalAmount: 57.9, deliveryFee: 7.9, items: [item(25, 2)], motoboyId: "mb1", deliveryBy: "MERCHANT", deliveryDistance: 2.4 },
  // 2. iFood pago no app, cupom de R$ 10 do iFood e R$ 2 da loja, taxa de
  //    serviço do app de R$ 0,99 dentro do total (a-conta-do-pedido-nao-fecha-sozinha).
  { ...base, dailyOrderNumber: 2, createdAt: h("18:25"), status: "ENTREGUE", source: "IFOOD", ifoodOrderId: "if-2", ifoodReference: "4521", deliveryType: "DELIVERY", paymentMethod: "Pago Online",
    totalAmount: 44.98, deliveryFee: 5.99, discountIfood: 10, discountMerchant: 2, discountTotal: 12, items: [item(50)], deliveryBy: "IFOOD" },
  // 3. iFood com a forma TROCADA na entrega para "Pix" (pix-trocado-na-entrega-nao-e-online).
  { ...base, dailyOrderNumber: 3, createdAt: h("18:40"), status: "ENTREGUE", source: "IFOOD", ifoodOrderId: "if-3", ifoodReference: "4533", deliveryType: "DELIVERY", paymentMethod: "Pix",
    totalAmount: 46.98, deliveryFee: 5.99, items: [item(40)], deliveryBy: "MERCHANT", motoboyId: "mb1", deliveryDistance: 3.1 },
  // 4. 99Food pago no app, R$ 5 de cupom do 99.
  { ...base, dailyOrderNumber: 4, createdAt: h("19:05"), status: "ENTREGUE", source: "99FOOD", openDeliveryChannel: "99FOOD", deliveryType: "DELIVERY", paymentMethod: "Pago Online",
    totalAmount: 30, deliveryFee: 4, discountIfood: 5, discountTotal: 5, items: [item(30)], deliveryBy: "99FOOD" },
  // 5. Balcão no Pix (a tela do balcão grava "PIX" e deliveryType RETIRADA).
  { ...base, dailyOrderNumber: 5, createdAt: h("19:12"), status: "ENTREGUE", source: "PRESENCIAL", deliveryType: "RETIRADA", paymentMethod: "PIX",
    totalAmount: 32, items: [item(16, 2)] },
  // 6. Balcão dividido: R$ 20 no Pix + R$ 15 em dinheiro.
  { ...base, dailyOrderNumber: 6, createdAt: h("19:30"), status: "ENTREGUE", source: "PRESENCIAL", deliveryType: "RETIRADA", paymentMethod: "Dividido: PIX R$ 20,00 + Dinheiro R$ 15,00",
    paymentMethods: [{ method: "PIX", amount: 20 }, { method: "Dinheiro", amount: 15 }], totalAmount: 35, items: [item(35)] },
  // 7. Retirada pelo site, crédito na retirada, cupom da loja de R$ 5.
  { ...base, dailyOrderNumber: 7, createdAt: h("19:45"), status: "ENTREGUE", source: "ONLINE", deliveryType: "RETIRADA", paymentMethod: "Cartão Crédito (Pagar na retirada)",
    totalAmount: 48, discountMerchant: 5, discountTotal: 5, items: [item(53)] },
  // 8. Cancelado no iFood — não entra em conta nenhuma.
  { ...base, dailyOrderNumber: 8, createdAt: h("20:00"), status: "CANCELADO", source: "IFOOD", ifoodOrderId: "if-8", ifoodReference: "4590", deliveryType: "DELIVERY", paymentMethod: "Pago Online",
    totalAmount: 70, items: [item(70)], cancelledBy: "CUSTOMER", cancelReason: "Cliente desistiu" },
  // 9. Totem abandonado na tela do cartão — aguardando pagamento.
  { ...base, dailyOrderNumber: 9, createdAt: h("20:05"), status: "AGUARDANDO_PAGAMENTO", source: "TOTEM", deliveryType: "RETIRADA", paymentMethod: "Cartão (Maquininha)",
    totalAmount: 25, items: [item(25)] },
  // 10. Totem pago no cartão da Point (sem o tipo: vai para crédito).
  { ...base, dailyOrderNumber: 10, createdAt: h("20:20"), status: "ENTREGUE", source: "TOTEM", deliveryType: "RETIRADA", paymentMethod: "Cartão (Maquininha)", paymentPaidAt: h("20:21"),
    totalAmount: 27.5, items: [item(27.5)] },
  // 11. Fiado da Joana (equipe).
  { ...base, dailyOrderNumber: 11, createdAt: h("20:40"), status: "ENTREGUE", source: "PRESENCIAL", deliveryType: "RETIRADA", paymentMethod: "Conta Funcionário", employeeName: "Joana",
    customerName: "Func. Joana", totalAmount: 18, items: [item(18)] },
  // 12–14. Pedidos de mesa: a forma está na conta, não no pedido.
  { ...base, dailyOrderNumber: 12, createdAt: h("19:00"), status: "ENTREGUE", source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "mesa-4", paymentMethod: "N/A", totalAmount: 40, items: [item(20, 2)] },
  { ...base, dailyOrderNumber: 13, createdAt: h("19:50"), status: "ENTREGUE", source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "mesa-4", paymentMethod: "N/A", totalAmount: 23.59, items: [item(23.59)] },
  { ...base, dailyOrderNumber: 14, createdAt: h("20:10"), status: "ENTREGUE", source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "mesa-7", paymentMethod: "N/A", totalAmount: 100, items: [item(50, 2)] },
  // 15. Mesa ainda aberta.
  { ...base, dailyOrderNumber: 15, createdAt: h("21:30"), status: "EM_PREPARO", source: "PRESENCIAL", deliveryType: "MESA", tableSessionId: "mesa-9", paymentMethod: "N/A", totalAmount: 30, items: [item(30)] },
];

const mesas: (MesaDoTurno & { id: string; closedAt: Date })[] = [
  // Mesa 4: consumo R$ 63,59 + 10% (R$ 6,359, gravado sem arredondar) = R$ 69,95.
  // O cliente deu uma nota de R$ 100: a baixa grava R$ 100 (pago-da-mesa-inclui-troco).
  { id: "mesa-4", closedAt: h("21:00"), serviceFee: 6.359, waiterTip: 0, paymentMethods: [{ method: "Dinheiro", amount: 100 }],
    orders: [{ status: "ENTREGUE", totalAmount: 40, discountTotal: 0 }, { status: "ENTREGUE", totalAmount: 23.59, discountTotal: 0 }] },
  // Mesa 7: consumo R$ 100 + 10%, R$ 10 de desconto no fechamento → R$ 100 (80 no crédito + 20 em dinheiro).
  { id: "mesa-7", closedAt: h("21:40"), serviceFee: 10, waiterTip: 0, paymentMethods: [{ method: "Crédito", amount: 80 }, { method: "Dinheiro", amount: 20 }],
    orders: [{ status: "ENTREGUE", totalAmount: 100, discountTotal: 0 }] },
];

const naoCancelados = pedidos.filter((o) => o.status !== "CANCELADO" && o.status !== "CRIANDO_IA");

// ── 1. A APURAÇÃO ───────────────────────────────────────────────────────────
console.log("\n== 1. A apuração do turno, por tipo ==");
const a = apurarVendasDoTurno(naoCancelados, mesas);
const d = a.retrato;
const porChave = new Map(d.porTipo.map((b) => [b.chave, b]));
const B = (k: string) => porChave.get(k) as BlocoDoTipo;

// A conferência, à mão (sem troco de abertura e sem sangria: isso é do esperado-do-turno).
exigir("dinheiro esperado = 57,90 + 15 (dividido) + 100 (mesa 4, a nota inteira) + 20 (mesa 7)", igual(a.expected.cash, 57.9 + 15 + 100 + 20), a.expected.cash);
exigir("pix esperado = 46,98 (Pix trocado na entrega) + 32 + 20", igual(a.expected.pix, 46.98 + 32 + 20), a.expected.pix);
exigir("crédito esperado = 48 (retirada) + 27,50 (totem) + 80 (mesa 7)", igual(a.expected.credit, 48 + 27.5 + 80), a.expected.credit);
exigir("iFood online = 44,98 + 10 de cupom (o repasse)", igual(a.expected.ifoodOnline, 54.98), a.expected.ifoodOnline);
exigir("99Food online = 30 + 5 de cupom", igual(a.expected.food99Online, 35), a.expected.food99Online);
exigir("fiado fora da conferência (1, R$ 18)", a.foraDaConferencia.fiadoQtd === 1 && igual(a.foraDaConferencia.fiado, 18));
exigir("mesa aberta fora (1 pedido, R$ 30)", a.foraDaConferencia.mesasAbertasQtd === 1 && igual(a.foraDaConferencia.mesasAbertas, 30));
exigir("totem abandonado em pendentes (1, R$ 25)", a.pendentesQuantidade === 1 && igual(a.pendentesValor, 25));

exigir("tipos na ordem Delivery, Retirada, Balcão, Mesas, Totem", d.porTipo.map((b) => b.chave).join(",") === "DELIVERY,RETIRADA,BALCAO,MESA,TOTEM", d.porTipo.map((b) => b.chave));
exigir("cancelado não entra (nenhum bloco tem os R$ 70)", !d.porTipo.some((b) => b.formas.some((f) => igual(f.valor, 70))));

const somaDosTipos = d.porTipo.reduce((s, b) => s + c(b.valor), 0);
exigir(`a soma dos tipos é o TOTAL FATURADO (${(somaDosTipos / 100).toFixed(2)} = ${d.vendas.valor.toFixed(2)})`, somaDosTipos === c(d.vendas.valor));
exigir("a soma das formas é o TOTAL FATURADO", d.porForma.reduce((s, f) => s + c(f.valor), 0) + d.cupomDaPlataforma.reduce((s, f) => s + c(f.valor), 0) === c(d.vendas.valor));
exigir("a soma dos canais é o TOTAL FATURADO", d.porCanal.reduce((s, x) => s + c(x.valor), 0) === c(d.vendas.valor));
exigir("vendas = soma das vendas dos blocos", d.porTipo.reduce((s, b) => s + b.qtd, 0) === d.vendas.qtd);
for (const b of d.porTipo) {
  const formas = b.formas.reduce((s, f) => s + c(f.valor), 0);
  const conta = c(b.produtos) + c(b.taxaDeEntrega.valor) + c(b.servico.valor) + c(b.gorjeta) - c(b.desconto.valor) + c(b.ajustes);
  exigir(`${b.nome}: Σ formas = total (${b.valor.toFixed(2)})`, formas === c(b.valor), formas / 100);
  exigir(`${b.nome}: produtos + taxas − desconto + ajustes = total`, conta === c(b.valor), conta / 100);
}

// Os casos, um a um.
exigir("Delivery: 4 vendas (site, iFood, iFood/Pix, 99)", B("DELIVERY").qtd === 4);
exigir("Delivery: produtos = 50 + 50 + 40 + 30", igual(B("DELIVERY").produtos, 170));
exigir("Delivery: taxa de entrega = 7,90 + 5,99 + 5,99 + 4", igual(B("DELIVERY").taxaDeEntrega.valor, 23.88) && B("DELIVERY").taxaDeEntrega.qtd === 4);
exigir("Delivery: desconto da loja = R$ 2 do iFood", igual(B("DELIVERY").desconto.valor, 2));
exigir("Delivery: cupom das plataformas (10 + 5) entra como forma", igual(B("DELIVERY").formas.find((f) => f.nome === "Cupom da plataforma")?.valor || 0, 15));
exigir("Delivery: ajustes = taxa do app do iFood (0,99) + 99 (1,00) + iFood/Pix (0,99)", igual(B("DELIVERY").ajustes, 0.99 + 1 + 0.99), B("DELIVERY").ajustes);
exigir("Delivery: Pix trocado na entrega é Pix, não pago online", igual(B("DELIVERY").formas.find((f) => f.nome === "Pix")?.valor || 0, 46.98));
exigir("Delivery: canais separados (Site, iFood, 99Food)", B("DELIVERY").canais.length === 3);
exigir("Retirada: o pedido do site com crédito na retirada", B("RETIRADA").qtd === 1 && igual(B("RETIRADA").valor, 48));
exigir("Retirada: produtos 53 − 5 de cupom da loja = 48", igual(B("RETIRADA").produtos, 53) && igual(B("RETIRADA").desconto.valor, 5) && B("RETIRADA").ajustes === 0);
exigir("Balcão: Pix + dividido + fiado = 3 vendas, R$ 85", B("BALCAO").qtd === 3 && igual(B("BALCAO").valor, 85));
exigir("Balcão: o dividido conta R$ 20 no Pix e R$ 15 no dinheiro", igual(B("BALCAO").formas.find((f) => f.nome === "Pix")?.valor || 0, 52) && igual(B("BALCAO").formas.find((f) => f.nome === "Dinheiro")?.valor || 0, 15));
exigir("Balcão: fiado aparece como forma", igual(B("BALCAO").formas.find((f) => f.nome === "Fiado")?.valor || 0, 18));
exigir("Totem separado do balcão (o pago; o abandonado não)", B("TOTEM").qtd === 1 && igual(B("TOTEM").valor, 27.5));
exigir("Mesas: 2 contas", B("MESA").qtd === 2);
exigir("Mesas: troco de R$ 30,05 tirado do dinheiro (100 − 69,95)", igual(B("MESA").troco.valor, 30.05) && B("MESA").troco.qtd === 1, B("MESA").troco);
exigir("Mesas: dinheiro = 69,95 + 20", igual(B("MESA").formas.find((f) => f.nome === "Dinheiro")?.valor || 0, 89.95));
exigir("Mesas: produtos = consumo lançado 63,59 + 100", igual(B("MESA").produtos, 163.59));
exigir("Mesas: taxa de serviço 6,36 + 10 (2 mesas)", igual(B("MESA").servico.valor, 16.36) && B("MESA").servico.qtd === 2);
exigir("Mesas: desconto no fechamento de R$ 10 (mesa 7)", igual(B("MESA").desconto.valor, 10) && B("MESA").desconto.qtd === 1);
exigir("Mesas: total = 169,95 (o que ficou na loja)", igual(B("MESA").valor, 169.95));
exigir("retrato.mesas guarda o troco para a gaveta do papel", igual(d.mesas.troco || 0, 30.05) && d.mesas.trocoQtd === 1);

// trocoDaConta sozinho: maior nota primeiro, só do dinheiro, e o pago a mais no cartão fica.
const t1 = trocoDaConta({ formas: [{ forma: "Dinheiro", valor: 50 }, { forma: "Dinheiro", valor: 20 }], consumo: 52, servico: 5.2, gorjeta: 0 });
exigir("troco: R$ 12,80 sai da nota de 50", igual(t1.troco, 12.8) && igual(t1.formas[0].valor, 37.2) && igual(t1.formas[1].valor, 20));
const t2 = trocoDaConta({ formas: [{ forma: "Credito", valor: 60 }, { forma: "Dinheiro", valor: 5 }], consumo: 50, servico: 5, gorjeta: 0 });
exigir("troco: a nota de R$ 5 que vira troco inteira some; os R$ 5 a mais no cartão ficam", igual(t2.troco, 5) && t2.formas.length === 1 && igual(t2.formas[0].valor, 60));

// ── 2. A CONFERÊNCIA NÃO MUDOU ──────────────────────────────────────────────
console.log("\n== 2. A conferência é a mesma do origin/master ==");
const pasta = join(tmpdir(), "teste-caixa-por-tipo");
mkdirSync(pasta, { recursive: true });
const falsoPrisma = join(pasta, "prisma-falso.js");
const falsoColunas = join(pasta, "colunas-falsas.js");
writeFileSync(falsoPrisma, `
const dados = globalThis.__dadosDoCaixa;
const porStatus = (where) => dados.pedidos.filter((o) => {
  const s = where && where.status;
  if (typeof s === "string") return o.status === s;
  if (s && s.notIn) return !s.notIn.includes(o.status);
  return true;
});
exports.prisma = {
  customerOrder: { findMany: async ({ where }) => porStatus(where) },
  tableSession: { findMany: async () => dados.mesas },
  cashMovement: { findMany: async () => dados.movs },
  customerOrderItem: { findMany: async () => [] },
  motoboy: { findMany: async () => [{ id: "mb1", name: "Carlos", paymentType: "POR_ENTREGA", dailyRate: 40, perDeliveryRate: 5, perKmRate: 0, faixasDeKm: null }] },
  user: { findUnique: async () => ({ deliveryZones: null, deliveryConfig: null }) },
};
`);
writeFileSync(falsoColunas, `exports.temEstruturaDeCaixa = async () => true;`);
(globalThis as any).__dadosDoCaixa = {
  pedidos,
  mesas,
  movs: [
    { tipo: "SAIDA", valor: 60, descricao: "Paguei o gás", createdAt: h("20:30") },
    { tipo: "ENTRADA", valor: 50, descricao: "Troco do cofre", createdAt: h("21:10") },
  ],
};
const jitiCom = (raiz: string) => createJiti(__filename, {
  alias: { "@/lib/prisma": falsoPrisma, "@/lib/garantir-colunas": falsoColunas, "@": join(raiz, "src") },
  interopDefault: true,
  moduleCache: false,
  fsCache: false,
});
// A versão de antes, tirada do git para uma pasta que espelha src/lib.
const velha = join(pasta, "velho");
mkdirSync(join(velha, "src", "lib"), { recursive: true });
let temVelha = true;
try {
  writeFileSync(join(velha, "src", "lib", "esperado-do-turno.ts"), execSync("git show origin/master:src/lib/esperado-do-turno.ts", { cwd: RAIZ }).toString());
} catch {
  temVelha = false;
}
const turno = { id: "caixa-1", openedAt: h("18:00"), openingAmount: 150 };

async function provarConferencia() {
  if (!temVelha) { exigir("versão do origin/master disponível no git", false); return null; }
  // O arquivo velho importa "@/lib/…" — os vizinhos vêm do src atual, que não mudou (só ele e o cupom mudaram).
  const jVelho = createJiti(__filename, {
    alias: { "@/lib/prisma": falsoPrisma, "@/lib/garantir-colunas": falsoColunas, "@": join(RAIZ, "src") },
    interopDefault: true, moduleCache: false, fsCache: false,
  });
  const antes = await jVelho.import(join(velha, "src", "lib", "esperado-do-turno.ts")) as any;
  const agora = await jitiCom(RAIZ).import(join(RAIZ, "src", "lib", "esperado-do-turno.ts")) as any;
  const v = await antes.calcularEsperadoDoTurno("loja", turno, { retrato: true });
  const n = await agora.calcularEsperadoDoTurno("loja", turno, { retrato: true });
  for (const k of Object.keys(v.expected)) exigir(`esperado.${k} igual (${Number(v.expected[k]).toFixed(2)})`, igual(v.expected[k], n.expected[k]), { antes: v.expected[k], agora: n.expected[k] });
  exigir("fora da conferência igual", JSON.stringify(v.foraDaConferencia) === JSON.stringify(n.foraDaConferencia), { antes: v.foraDaConferencia, agora: n.foraDaConferencia });
  exigir("pendentes iguais", v.pendentesValor === n.pendentesValor && v.pendentesQuantidade === n.pendentesQuantidade);
  exigir("sangria/reforço iguais", v.movimentacaoEntradas === n.movimentacaoEntradas && v.movimentacaoSaidas === n.movimentacaoSaidas);
  exigir("vendas em dinheiro da gaveta iguais (a conferência ainda conta a nota da mesa)", igual(v.detalhe.gaveta.vendasEmDinheiro, n.detalhe.gaveta.vendasEmDinheiro));
  exigir("cancelados iguais (1, R$ 70)", n.detalhe.cancelados.qtd === 1 && v.detalhe.cancelados.qtd === 1);
  exigir("entregadores iguais", JSON.stringify(v.detalhe.entregadores) === JSON.stringify(n.detalhe.entregadores), { antes: v.detalhe.entregadores, agora: n.detalhe.entregadores });
  const dif = c(v.detalhe.vendas.valor) - c(n.detalhe.vendas.valor);
  exigir(`a única diferença no faturado é o troco da mesa (${(dif / 100).toFixed(2)})`, dif === c(30.05), { antes: v.detalhe.vendas.valor, agora: n.detalhe.vendas.valor });
  const dinheiroAntes = v.detalhe.porForma.find((f: any) => f.nome === "Dinheiro")?.valor || 0;
  const dinheiroAgora = n.detalhe.porForma.find((f: any) => f.nome === "Dinheiro")?.valor || 0;
  exigir("o Dinheiro do faturamento caiu exatamente o troco", c(dinheiroAntes) - c(dinheiroAgora) === c(30.05));
  exigir("o resto do faturamento por forma não mudou",
    JSON.stringify(v.detalhe.porForma.filter((f: any) => f.nome !== "Dinheiro")) === JSON.stringify(n.detalhe.porForma.filter((f: any) => f.nome !== "Dinheiro")));
  return n;
}

// ── 3. O PAPEL ──────────────────────────────────────────────────────────────
function recortarFuncao(fonte: string, assinatura: string) {
  const inicio = fonte.indexOf(assinatura);
  if (inicio < 0) throw new Error("não achei no server.js: " + assinatura);
  let i = fonte.indexOf("{", inicio);
  let nivel = 0;
  for (; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}") { nivel--; if (nivel === 0) return fonte.slice(inicio, i + 1); }
  }
  throw new Error("chave não fechou em " + assinatura);
}
const servidor = readFileSync(join(RAIZ, "firehub-print-assistant", "server.js"), "utf8");
const buildEscPos = new Function([
  recortarFuncao(servidor, "function cleanAscii("),
  recortarFuncao(servidor, "function documentoDoCliente("),
  recortarFuncao(servidor, "function nomeSemDocumento("),
  recortarFuncao(servidor, "function normalizarCombo("),
  recortarFuncao(servidor, "function buildEscPos("),
  "return buildEscPos;",
].join("\n\n"))();
const papel = (buf: Buffer) => buf.toString("binary")
  .replace(/[\x1b\x1d]![\x00-\xff]/g, "").replace(/\x1b [\x00-\xff]/g, "").replace(/\x1bE[\x00\x01]/g, "")
  .replace(/\x1ba[\x00-\x02]/g, "").replace(/\x1b@/g, "").replace(/\x1bt[\x00-\xff]/g, "")
  .replace(/\x1dV\x00/g, "\n--- CORTE ---\n").replace(/\x1bd[\x00-\xff]/g, "\n").replace(/\x1dB[\x00-\x01]/g, "")
  .replace(/\x1bM[\x00-\x02]/g, "").replace(/\x1b[23][\x00-\xff]/g, "").replace(/\x1dL[\x00-\xff][\x00-\xff]/g, "")
  .replace(/\x1dW[\x00-\xff][\x00-\xff]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
const colunas = Number(process.argv[2] || 48);

(async () => {
  const n = await provarConferencia();
  const detalhe = n ? n.detalhe : { ...d, gaveta: { vendasEmDinheiro: a.expected.cash, reforcosQtd: 0, sangriasQtd: 0 }, movimentacoes: [], cancelados: { qtd: 0, valor: 0, lista: [] }, entregadores: [], maisVendidos: [] };
  const esperado = n ? n.expected : a.expected;

  console.log("\n== 3. O papel do fechamento (" + colunas + " colunas) ==\n");
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const cupom = cupomDeFechamentoDeCaixa({
    sessionId: "caixa-1", loja: "Delicia de Casa", fuso: "America/Sao_Paulo", operador: "Douglas",
    abertoEm: turno.openedAt, fechadoEm: h("23:30"), trocoInicial: turno.openingAmount,
    valores: {
      esperado: { cash: r2(esperado.cash), debit: r2(esperado.debit), credit: r2(esperado.credit), pix: r2(esperado.pix), voucher: r2(esperado.voucher), total: r2(esperado.total) },
      // Contou a gaveta sem o troco que voltou para a mesa 4: a falta é o troco.
      contado: { cash: r2(esperado.cash - 30.05), debit: r2(esperado.debit), credit: r2(esperado.credit), pix: r2(esperado.pix), voucher: 0 },
      diferenca: -30.05,
      online: { ifood: r2(esperado.ifoodOnline), food99: r2(esperado.food99Online) },
      onlineEsperado: r2(esperado.ifoodOnline + esperado.food99Online),
      movimentacoes: n ? { entradas: n.movimentacaoEntradas, saidas: n.movimentacaoSaidas } : undefined,
      foraDaConferencia: n ? n.foraDaConferencia : a.foraDaConferencia,
      pendentes: { valor: a.pendentesValor, quantidade: a.pendentesQuantidade },
      detalhe,
    },
  });
  const saida = papel(buildEscPos(cupom, "Delicia de Casa", colunas, "safe"));
  console.log(saida);
  exigir("papel: bloco VENDAS DELIVERY", /VENDAS DELIVERY/.test(saida));
  exigir("papel: bloco VENDAS RETIRADA", /VENDAS RETIRADA/.test(saida));
  exigir("papel: bloco VENDAS BALCAO", /VENDAS BALCAO/.test(saida));
  exigir("papel: bloco VENDAS MESAS", /VENDAS MESAS/.test(saida));
  exigir("papel: bloco VENDAS TOTEM", /VENDAS TOTEM/.test(saida));
  exigir("papel: valor dos produtos por bloco", (saida.match(/Valor dos produtos/g) || []).length === 5);
  exigir("papel: total do bloco Mesas", /TOTAL MESAS \(2\)\s+R\$ 169,95/.test(saida));
  exigir("papel: a soma dos tipos confere com o total faturado", /Soma dos tipos \(5\)/.test(saida) && /igual ao TOTAL FATURADO/.test(saida));
  exigir("papel: o troco da mesa aparece na gaveta", /Troco das mesas \(1\)/.test(saida));
  exigir("papel: conferência continua (DIFERENCA)", /DIFERENCA/.test(saida));
  // A gaveta continua fechando com o esperado gravado.
  exigir("papel: as parcelas da gaveta somam o dinheiro esperado (sem aviso)", !/as parcelas acima somam/.test(saida));

  console.log("\n== Comprovante de sangria ==\n");
  const mov = cupomDeMovimentacaoDeCaixa({
    movimentacao: { id: "mov-1", tipo: "SAIDA", valor: 60, descricao: "Paguei o gas", criadoPor: "douglas@deliciadecasa.com.br", createdAt: h("20:30") },
    loja: "Delicia de Casa", fuso: "America/Sao_Paulo", operador: "Douglas", caixaAbertoEm: turno.openedAt,
  });
  const papelMov = papel(buildEscPos(mov, "Delicia de Casa", colunas, "safe"));
  console.log(papelMov);
  exigir("comprovante: título de sangria", /SANGRIA DE CAIXA/.test(papelMov));
  exigir("comprovante: valor", /R\$ 60,00/.test(papelMov));
  exigir("comprovante: motivo", /Paguei o gas/.test(papelMov));
  exigir("comprovante: quem lançou", /douglas@/.test(papelMov));
  exigir("comprovante: linha de assinatura", /_{10,}/.test(papelMov) && /Responsavel pelo caixa/.test(papelMov));
  exigir("comprovante: vai para a fila do caixa (kind CAIXA_*)", mov.kind.startsWith("CAIXA_"));
  exigir("comprovante: não é documento fiscal", /NAO E DOCUMENTO FISCAL/.test(papelMov));

  console.log(`\n${ok} ok, ${falhou} falharam\n`);
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
