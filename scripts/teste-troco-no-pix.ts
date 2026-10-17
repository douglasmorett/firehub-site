/**
 * TROCO FEITO PELO PIX: O CAIXA E O ACERTO DO MOTOBOY FECHAM CERTO, COM E SEM A MARCA.
 *
 *   npx tsx scripts/teste-troco-no-pix.ts
 *
 * Allan (Delícia de Casa, 16/10/2026): o cliente paga um pedido de R$ 40 com
 * nota de R$ 50 e o troco de R$ 10 volta por Pix — da conta da loja ou do
 * celular do motoboy. Com "troco para 50", o sistema contava que os R$ 10
 * tinham saído em cédula da gaveta e voltado com a nota: o caixa sobrava e o
 * acerto do motoboy faltava. Decisão do Douglas (17/10/2026): marcar na forma
 * de pagamento "troco feito pelo Pix" (lib/troco-no-pix.ts).
 *
 * Cada cenário passa pela conta REAL do caixa (apurarVendasDoTurno e, com
 * Prisma falso, calcularEsperadoDoTurno) e do acerto (resumoDasEntregas,
 * partesDaEntrega), e é comparado com o dinheiro que FISICAMENTE está na
 * gaveta, na conta Pix da loja e no bolso do motoboy no fim do turno. "Fecha
 * certo" = o esperado de cada linha é o que está lá.
 */
import { mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { apurarVendasDoTurno } from "../src/lib/apuracao-do-turno";
import { dinheiroDaParte, partesDaEntrega, resumoDasEntregas, trocoLevadoDaParte, trocoNoPixDaParte } from "../src/lib/resumo-do-entregador";
import { lerTrocoNoPix, textoDoTrocoNoPix, trocoNoPixDoPedido } from "../src/lib/troco-no-pix";
import { cupomDeFechamentoDeCaixa } from "../src/lib/cupom-do-caixa";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createJiti } = require("jiti");

let ok = 0, falhou = 0;
const exigir = (nome: string, condicao: boolean, detalhe?: unknown) => {
  if (condicao) { ok++; console.log("  ok     " + nome); }
  else { falhou++; console.log("  FALHOU " + nome + (detalhe !== undefined ? "  → " + JSON.stringify(detalhe) : "")); }
};
const c = (v: number) => Math.round(v * 100);
const igual = (a: number, b: number) => c(a) === c(b);

const h = (hhmm: string) => new Date(`2026-10-17T${hhmm}:00-03:00`);
const base = {
  discountIfood: 0, discountTotal: 0, discountMerchant: 0, notes: null, tableSessionId: null, openDeliveryChannel: null, discountDetails: null,
  ifoodOrderId: null, ifoodReference: null, openDeliveryOrderId: null, openDeliveryReference: null, paymentMethods: null, paymentPaidAt: null,
  gatewayProvider: null, customerName: "Cliente", employeeName: null, deliveryBy: "MERCHANT", motoboyFee: 6, deliveryDistance: 2,
  totemLicenseId: null, deliveryFee: 6, items: [{ price: 34, quantity: 1 }], status: "ENTREGUE", source: "ONLINE", createdAt: h("19:10"),
  dailyOrderNumber: 12, ifoodDriverStatus: null, ifoodDriverName: null, reposicao: null,
};
/** O pedido do Allan: R$ 40 em dinheiro, nota de R$ 50, entregue pelo motoboy da loja. */
const pedido = (extra: Record<string, unknown> = {}) => ({
  ...base, id: "p12", deliveryType: "DELIVERY", motoboyId: "mb1", paymentMethod: "Dinheiro", totalAmount: 40, changeAmount: 50, ...extra,
});

/** As linhas da conferência de um turno com um pedido só (sem troco de abertura). */
const conferencia = (o: any) => apurarVendasDoTurno([o], []);
/** O acerto do motoboy com as entregas dele. */
const acerto = (os: any[]) => resumoDasEntregas(os.map((o) => ({ ...o, ganho: 6 })), "America/Sao_Paulo");

// ── 1. SEM A MARCA: O TROCO SAIU EM CÉDULA (o caso de sempre) ───────────────
console.log("\n== 1. Sem a marca: troco em cédula, levado da gaveta ==");
{
  const o = pedido();
  const a = conferencia(o);
  // Gaveta física: abre com 100, sai R$ 10 de troco com o motoboy, volta a nota de 50 → 140.
  const gaveta = 100 - 10 + 50;
  exigir("caixa: dinheiro esperado = pedido (40)", igual(a.expected.cash, 40), a.expected);
  exigir("caixa: Pix esperado 0", igual(a.expected.pix, 0), a.expected);
  exigir("caixa fecha: abertura 100 + esperado 40 = gaveta física 140", igual(100 + a.expected.cash, gaveta));
  exigir("papel: troco levado R$ 10 com o motoboy", igual(a.entregasProprias[0].trocoLevado, 10) && !a.entregasProprias[0].trocoNoPixDaLoja);
  exigir("retrato sem linha de troco no Pix", a.retrato.trocoNoPix === undefined);
  const s = acerto([o]);
  exigir("acerto: entregar 50 = pedido 40 + troco levado 10", igual(s.cashCollectedSum, 50) && igual(s.changeGivenSum, 10) && igual(s.cashOrdersValueSum, 40), s);
  exigir("acerto: nada de troco no Pix", igual(s.trocoNoPixDaLojaSum, 0) && igual(s.trocoNoPixDoMotoboySum, 0) && s.trocoNoPixCount === 0);
}

// ── 2. PIX DA LOJA, SEM A MARCA: O DEFEITO DE HOJE ──────────────────────────
console.log("\n== 2. Pix da loja SEM a marca (o defeito) ==");
{
  const o = pedido();
  const a = conferencia(o);
  // Nenhuma cédula saiu: a nota inteira entrou (150) e a conta Pix da loja pagou R$ 10.
  const gaveta = 100 + 50;
  const contaPix = -10;
  exigir("o caixa NÃO fecha: gaveta tem R$ 10 a mais que o esperado", igual(gaveta - (100 + a.expected.cash), 10));
  exigir("o Pix NÃO fecha: a conta tem R$ 10 a menos", igual(contaPix - a.expected.pix, -10));
  exigir("e o papel ainda diz que o motoboy levou R$ 10 de troco", igual(a.entregasProprias[0].trocoLevado, 10));
}

// ── 3. PIX DA LOJA, COM A MARCA ─────────────────────────────────────────────
console.log("\n== 3. Troco feito pelo Pix da LOJA (marcado) ==");
{
  const o = pedido({ trocoNoPix: { por: "LOJA", quando: "2026-10-17T22:40:00.000Z", quem: "Allan" } });
  const a = conferencia(o);
  const gaveta = 100 + 50;
  const contaPix = -10;
  exigir("caixa: dinheiro esperado = a nota inteira (50)", igual(a.expected.cash, 50), a.expected);
  // Regra do Douglas (17/10/2026): o Pix do troco sai da CONTA da loja, fora
  // do caixa — a linha do Pix não muda; o caixa mostra a nota inteira.
  exigir("caixa: Pix esperado = 0 (o Pix do troco é da conta, fora do caixa)", igual(a.expected.pix, 0), a.expected);
  exigir("caixa: total = a nota inteira na gaveta (50)", igual(a.expected.total, 50), a.expected);
  exigir("caixa FECHA na gaveta: 100 + 50 = 150", igual(100 + a.expected.cash, gaveta));
  exigir("caixa: o Pix do caixa não espera o troco (conta da loja à parte: " + contaPix + ")", igual(a.expected.pix, 0));
  exigir("faturamento não muda: Dinheiro 40 no retrato", igual(a.retrato.porForma.find((f) => f.nome === "Dinheiro")?.valor ?? 0, 40), a.retrato.porForma);
  exigir("recebido = 40 (a venda, sem a nota)", igual(a.retrato.recebido.valor, 40));
  exigir("retrato: 1 troco no Pix da loja de R$ 10", a.retrato.trocoNoPix?.qtd === 1 && igual(a.retrato.trocoNoPix?.valor ?? 0, 10), a.retrato.trocoNoPix);
  exigir("papel: sem troco levado, R$ 10 da nota no a entregar", igual(a.entregasProprias[0].trocoLevado, 0) && igual(a.entregasProprias[0].trocoNoPixDaLoja ?? 0, 10), a.entregasProprias[0]);
  const s = acerto([o]);
  // O motoboy recebeu a nota de 50 e não levou troco: entrega os 50.
  exigir("acerto: entregar 50 (a nota inteira), troco levado 0", igual(s.cashCollectedSum, 50) && igual(s.changeGivenSum, 0), s);
  exigir("acerto: R$ 10 de troco no Pix da loja", igual(s.trocoNoPixDaLojaSum, 10) && igual(s.trocoNoPixDoMotoboySum, 0) && s.trocoNoPixCount === 1);
  exigir("acerto FECHA: o bolso do motoboy (50) = entregar (50)", igual(50, s.cashCollectedSum));
}

// ── 4. PIX DO MOTOBOY, SEM E COM A MARCA ────────────────────────────────────
console.log("\n== 4. Troco feito pelo Pix do MOTOBOY ==");
{
  // Ele recebeu 50, pagou 10 do bolso dele no Pix e fica com 10 da nota: entrega 40.
  const entregue = 40;
  const sem = acerto([pedido()]);
  exigir("SEM a marca o acerto cobra 50 e acusa R$ 10 de falta", igual(entregue - sem.cashCollectedSum, -10), sem);
  const o = pedido({ trocoNoPix: { por: "MOTOBOY" } });
  const s = acerto([o]);
  exigir("COM a marca: entregar 40 (só o pedido), troco levado 0", igual(s.cashCollectedSum, 40) && igual(s.changeGivenSum, 0), s);
  exigir("acerto FECHA: entregou 40 = entregar 40", igual(entregue, s.cashCollectedSum));
  exigir("acerto mostra os R$ 10 que ele bancou no Pix (e ficou da nota)", igual(s.trocoNoPixDoMotoboySum, 10) && igual(s.trocoNoPixDaLojaSum, 0));
  exigir("o ganho dele não muda por causa do troco", igual(s.feeTotal, 6), s.feeTotal);
  const a = conferencia(o);
  exigir("caixa: dinheiro esperado 40, Pix 0 (a gaveta recebeu o pedido)", igual(a.expected.cash, 40) && igual(a.expected.pix, 0), a.expected);
  exigir("caixa FECHA: 100 + 40 = gaveta física 140", igual(100 + a.expected.cash, 100 + entregue));
  exigir("retrato informa o Pix do motoboy, sem mexer na gaveta", a.retrato.trocoNoPix?.qtd === 0 && a.retrato.trocoNoPix?.motoboyQtd === 1 && igual(a.retrato.trocoNoPix?.motoboyValor ?? 0, 10), a.retrato.trocoNoPix);
  exigir("papel: sem troco levado, R$ 10 do Pix dele à parte", igual(a.entregasProprias[0].trocoLevado, 0) && igual(a.entregasProprias[0].trocoNoPixDoMotoboy ?? 0, 10), a.entregasProprias[0]);
}

// ── 5. PAGAMENTO DIVIDIDO: O TROCO É DA PARTE EM DINHEIRO ───────────────────
console.log("\n== 5. Dividido: Dinheiro 30 (nota de 50) + Pix 10 ==");
{
  const dividido = { paymentMethod: "Dividido: Dinheiro R$ 30,00 + Pix R$ 10,00", paymentMethods: [{ method: "Dinheiro", amount: 30 }, { method: "Pix", amount: 10 }] };
  const sem = conferencia(pedido(dividido));
  exigir("sem a marca: dinheiro 30, Pix 10", igual(sem.expected.cash, 30) && igual(sem.expected.pix, 10), sem.expected);
  const o = pedido({ ...dividido, trocoNoPix: { por: "LOJA" } });
  const a = conferencia(o);
  // Gaveta: +50 (a nota). Conta Pix: +10 do cliente −20 de troco = −10.
  exigir("Pix da loja: dinheiro 50 e Pix 10 (só o que o cliente pagou no Pix)", igual(a.expected.cash, 50) && igual(a.expected.pix, 10), a.expected);
  exigir("total = 60 (nota inteira + Pix do cliente)", igual(a.expected.total, 60), a.expected);
  const partes = partesDaEntrega(o);
  const din = partes.find((p) => p.caixa === "DINHEIRO")!;
  exigir("a parte em dinheiro: troco 20 no Pix, entregar 50, troco levado 0",
    igual(trocoNoPixDaParte(din), 20) && igual(dinheiroDaParte(din), 50) && igual(trocoLevadoDaParte(din), 0), din);
  exigir("a parte Pix não tem troco", partes.find((p) => p.caixa === "PIX")?.trocoNoPix == null);
  exigir("trocoNoPixDoPedido usa a parte em dinheiro: R$ 20", trocoNoPixDoPedido(o)?.valor === 20, trocoNoPixDoPedido(o));
}

// ── 6. ONDE A MARCA NÃO VALE ────────────────────────────────────────────────
console.log("\n== 6. Onde a marca não muda nada ==");
{
  // Nota que não passa do pedido: não há troco a marcar.
  const semNota = pedido({ changeAmount: null, trocoNoPix: { por: "LOJA" } });
  const a1 = conferencia(semNota);
  exigir("sem nota: dinheiro 40, Pix 0, sem retrato de troco", igual(a1.expected.cash, 40) && igual(a1.expected.pix, 0) && a1.retrato.trocoNoPix === undefined, a1.expected);
  exigir("sem nota: trocoNoPixDoPedido = null", trocoNoPixDoPedido(semNota) === null);
  // Entrega do app (iFood mandou o entregador dele, que cobrou na porta): fora da gaveta.
  const doApp = pedido({ source: "IFOOD", ifoodOrderId: "if-9", deliveryBy: "IFOOD", ifoodDriverName: "Entregador iFood", motoboyId: null, trocoNoPix: { por: "LOJA" } });
  const a2 = conferencia(doApp);
  exigir("entregador do app: nada na gaveta nem no Pix", igual(a2.expected.cash, 0) && igual(a2.expected.pix, 0) && a2.retrato.trocoNoPix === undefined, a2.expected);
  // Cancelado: o acerto não cobra dinheiro nenhum.
  const cancelado = acerto([pedido({ status: "CANCELADO", trocoNoPix: { por: "LOJA" } })]);
  exigir("cancelado: nada a entregar", igual(cancelado.cashCollectedSum, 0) && igual(cancelado.trocoNoPixDaLojaSum, 0));
  // Marca inválida no banco: é como se não houvesse.
  exigir("marca inválida é ignorada", lerTrocoNoPix({ por: "CLIENTE" }) === null && lerTrocoNoPix("LOJA") === null && lerTrocoNoPix([]) === null);
  exigir("marca válida é lida", lerTrocoNoPix({ por: "motoboy", quem: "Allan" })?.por === "MOTOBOY");
  exigir("o texto da comanda", textoDoTrocoNoPix(10, "LOJA") === "Troco feito pelo Pix: R$ 10,00 (Pix da loja)" && textoDoTrocoNoPix(7.5, "MOTOBOY") === "Troco feito pelo Pix: R$ 7,50 (Pix do motoboy)");
}

// ── 7. O TURNO INTEIRO PELA FUNÇÃO DO SERVIDOR (Prisma falso) ───────────────
// Abertura 100, quatro entregas de R$ 40 com nota de 50: uma com troco em
// cédula, uma com Pix da loja, uma com Pix do motoboy e uma em Pix na porta.
// Mais uma sangria de R$ 20. O esperado tem de bater com a gaveta e a conta.
async function provarTurno() {
  console.log("\n== 7. O turno inteiro (calcularEsperadoDoTurno) ==");
  const RAIZ = resolve(__dirname, "..");
  const pasta = join(tmpdir(), "teste-troco-no-pix");
  mkdirSync(pasta, { recursive: true });
  const falsoPrisma = join(pasta, "prisma-falso.js");
  const falsoColunas = join(pasta, "colunas-falsas.js");
  writeFileSync(falsoPrisma, `
const dados = globalThis.__dadosDoTroco;
exports.prisma = {
  customerOrder: { findMany: async ({ where, select }) => {
    if (where && where.status && where.status.notIn) { dados.selects.push(select); return dados.pedidos; }
    return [];
  } },
  tableSession: { findMany: async () => [] },
  cashMovement: { findMany: async () => dados.movs },
  customerOrderItem: { findMany: async () => [] },
  motoboy: { findMany: async () => [{ id: "mb1", name: "Jobson", paymentType: "POR_ENTREGA", dailyRate: 0, perDeliveryRate: 6, perKmRate: 0, faixasDeKm: null }] },
  user: { findUnique: async () => ({ deliveryZones: null, deliveryConfig: null }) },
};
`);
  writeFileSync(falsoColunas, `exports.temEstruturaDeCaixa = async () => true;`);
  const pedidos = [
    pedido({ id: "a", dailyOrderNumber: 1 }),
    pedido({ id: "b", dailyOrderNumber: 2, trocoNoPix: { por: "LOJA" } }),
    pedido({ id: "c", dailyOrderNumber: 3, trocoNoPix: { por: "MOTOBOY" } }),
    pedido({ id: "d", dailyOrderNumber: 4, paymentMethod: "Pix", changeAmount: null }),
  ];
  const dados = { pedidos, movs: [{ tipo: "SAIDA", valor: 20, descricao: "Gás", createdAt: h("20:00"), criadoPor: "Allan" }], selects: [] as any[] };
  (globalThis as any).__dadosDoTroco = dados;
  const jiti = createJiti(__filename, {
    alias: { "@/lib/prisma": falsoPrisma, "@/lib/garantir-colunas": falsoColunas, "@": join(RAIZ, "src") },
    interopDefault: true, moduleCache: false, fsCache: false,
  });
  const modulo = await jiti.import(join(RAIZ, "src", "lib", "esperado-do-turno.ts")) as any;
  const turno = { id: "caixa-1", openedAt: h("18:00"), openingAmount: 100 };
  const n = await modulo.calcularEsperadoDoTurno("loja", turno, { retrato: true });
  exigir("a consulta dos pedidos pede o trocoNoPix", dados.selects.some((s) => s && s.trocoNoPix === true), dados.selects.map((s) => Object.keys(s || {}).length));

  // O mundo físico no fim do turno:
  //   gaveta: 100 − 10 (troco do pedido 1) + 50 + 50 (nota inteira, Pix da loja) + 40 (motoboy ficou com 10) − 20 (sangria) = 210
  //   conta Pix: +40 (pedido 4) − 10 (troco do pedido 2) = 30
  const gaveta = 100 - 10 + 50 + 50 + 40 - 20;
  // O Pix do troco (10) saiu da conta da loja, fora do caixa: o Pix do caixa é só o do pedido 4.
  const contaPix = 40;
  exigir(`gaveta: esperado ${n.expected.cash} = contado ${gaveta}`, igual(n.expected.cash, gaveta), n.expected);
  exigir(`Pix: esperado ${n.expected.pix} = contado ${contaPix}`, igual(n.expected.pix, contaPix), n.expected);
  exigir("total do turno = abertura + vendas (160) + nota inteira do Pix da loja (10) − sangria", igual(n.expected.total, 100 + 160 + 10 - 20), n.expected);
  exigir("vendas em dinheiro da gaveta = 40 + 50 + 40 = 130", igual(n.detalhe.gaveta.vendasEmDinheiro, 130), n.detalhe.gaveta);
  exigir("detalhe.trocoNoPix: 1 da loja (10) e 1 do motoboy (10)", n.detalhe.trocoNoPix?.qtd === 1 && igual(n.detalhe.trocoNoPix?.valor, 10) && n.detalhe.trocoNoPix?.motoboyQtd === 1, n.detalhe.trocoNoPix);
  const jobson = n.detalhe.entregadores[0];
  exigir("Jobson: dinheiro dos pedidos 120, troco levado 10, nota do Pix da loja 10, Pix dele 10",
    igual(jobson.dinheiro, 120) && igual(jobson.trocoLevado, 10) && igual(jobson.trocoNoPixDaLoja, 10) && igual(jobson.trocoNoPixDoMotoboy, 10), jobson);
  // No bolso dele: 50 + 50 + 40 = 140 (do pedido 3 ficou com 10, pagou o Pix).
  const s = acerto(pedidos);
  exigir("acerto do Jobson: entregar 140 = o que está no bolso dele", igual(s.cashCollectedSum, 50 + 50 + 40), s);

  // O papel do fechamento diz de onde veio cada número.
  const cupom = cupomDeFechamentoDeCaixa({
    sessionId: "caixa-1", loja: "Delicia de Casa", fuso: "America/Sao_Paulo", operador: "Allan",
    abertoEm: turno.openedAt, fechadoEm: h("23:30"), trocoInicial: 100,
    valores: {
      esperado: { cash: n.expected.cash, debit: 0, credit: 0, pix: n.expected.pix, voucher: 0, total: n.expected.total },
      contado: { cash: gaveta, debit: 0, credit: 0, pix: contaPix, voucher: 0 },
      diferenca: 0,
      online: { ifood: 0, food99: 0 },
      onlineEsperado: 0,
      movimentacoes: { entradas: n.movimentacaoEntradas, saidas: n.movimentacaoSaidas },
      foraDaConferencia: n.foraDaConferencia,
      pendentes: { valor: 0, quantidade: 0 },
      detalhe: n.detalhe,
    },
  } as any);
  const texto = JSON.stringify(cupom);
  exigir("papel: a nota inteira do Pix da loja nas vendas em dinheiro", /nota inteira: troco feito pelo Pix da loja \(1\)/.test(texto));
  exigir("papel: o a entregar do Jobson com a nota do Pix da loja", /troco levado R\$ 10,00 \+ R\$ 10,00 da nota \(troco no Pix da loja\)/.test(texto));
  exigir("papel: o Pix dele à parte", /Troco no Pix dele: R\$ 10,00/.test(texto));
}

provarTurno()
  .catch((e) => { falhou++; console.log("  FALHOU o turno inteiro: " + (e?.stack || e)); })
  .finally(() => {
    console.log(`\n${ok} ok, ${falhou} falhou`);
    if (falhou > 0) process.exit(1);
  });
