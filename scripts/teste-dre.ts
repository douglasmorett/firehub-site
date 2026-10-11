/**
 * Trava o DRE do Financeiro (lib/financeiro/dre.ts) e a régua do fim do teste
 * (lib/fim-do-teste.ts) — sem banco.
 *
 *   npx tsx scripts/teste-dre.ts
 *
 * Os casos vêm da auditoria de 11/10/2026 (E1–E19): o período operacional dos
 * Relatórios, a mesa de três rodadas que é UMA venda, a taxa de entrega da
 * corrida do app, o desconto dado no fechamento da mesa, a taxa pela média das
 * bandeiras, a comissão por canal, o rateio mês a mês dos custos fixos (Pastel
 * da Paulista, R$ 10.120/mês em 90 dias) e da mensalidade (Ragnar, setembro:
 * boleto de R$ 500), e o resultado que não se chama lucro sem custo e comissão.
 *
 * A prova nos dados reais (só leitura) é scripts/conferir-dre-no-banco.ts.
 */
import {
  ATALHOS_DO_FINANCEIRO, atalhoDoFinanceiro, calcularDRE, economiaNosCanaisProprios, entraNoDRE, lerComissoesDosApps,
  lerPeriodo, mesesDoPeriodo, periodoDoFinanceiro, pontoDeEquilibrio, recebimentosDoPeriodo, taxaDaForma,
  type CicloNoPeriodo, type DadosDoPeriodo, type PedidoDoFinanceiro,
} from "../src/lib/financeiro/dre";
import { naLoja, tipoDeVenda } from "../src/lib/relatorios/base";
import { resumoDeVendas, type PedidoParaVendas } from "../src/lib/relatorios/vendas";
import { calcMensalidade } from "../src/lib/firehub-billing";
import { diasDeTesteRestantes, fimDoTeste } from "../src/lib/fim-do-teste";
import { lerValorEmReais } from "../src/lib/lote-de-saldo";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const TZ = "America/Sao_Paulo";

async function main() {
  // ── 1. PERÍODO = o dos Relatórios (E7) ──────────────────────────────────
  console.log("\n— Período operacional —");
  const hoje = "2026-10-11";
  confere("7 dias = os 7 dias operacionais até hoje (não as últimas 168 h)", periodoDoFinanceiro("7d", hoje), { de: "2026-10-05", ate: "2026-10-11" });
  confere("Hoje = só o dia operacional de hoje", periodoDoFinanceiro("hoje", hoje), { de: "2026-10-11", ate: "2026-10-11" });
  confere("Este mês", periodoDoFinanceiro("mes", hoje), { de: "2026-10-01", ate: "2026-10-11" });
  confere("Mês anterior (novo — fecha o mês)", periodoDoFinanceiro("mesAnterior", hoje), { de: "2026-09-01", ate: "2026-09-30" });
  confere("90 dias = 90 dias operacionais", periodoDoFinanceiro("90d", hoje), { de: "2026-07-14", ate: "2026-10-11" });
  confere("os atalhos dos Relatórios + 90 dias", ATALHOS_DO_FINANCEIRO.map((a) => a.chave), ["hoje", "ontem", "7d", "15d", "30d", "90d", "mes", "mesAnterior"]);
  confere("o botão aceso é o do período", atalhoDoFinanceiro("2026-10-05", "2026-10-11", hoje), "7d");
  confere("período personalizado não acende atalho", atalhoDoFinanceiro("2026-10-02", "2026-10-09", hoje), null);
  confere("sem período na URL = 7 dias", lerPeriodo(null, null, hoje), { de: "2026-10-05", ate: "2026-10-11" });
  confere("período invertido é desvirado", lerPeriodo("2026-10-11", "2026-10-01", hoje), { de: "2026-10-01", ate: "2026-10-11" });
  confere("período acima de 400 dias é cortado", lerPeriodo("2024-01-01", "2026-10-11", hoje).de, "2025-09-07");
  // O pedido das 04:30 de 11/10 (Brasília) é do expediente de 10/10: às 08:51
  // o "Hoje" antigo começava à meia-noite e mostrava a madrugada de ontem.
  confere("04:30 de 11/10 é do dia operacional 10/10", naLoja(new Date("2026-10-11T07:30:00Z"), TZ).dia, "2026-10-10");
  confere("05:00 de 11/10 já é 11/10", naLoja(new Date("2026-10-11T08:00:00Z"), TZ).dia, "2026-10-11");

  // ── 2. RATEIO MÊS A MÊS (E12) ───────────────────────────────────────────
  console.log("\n— Rateio dos custos fixos e da mensalidade —");
  confere("90 dias tocam 4 meses", mesesDoPeriodo("2026-07-14", "2026-10-11"), [
    { mes: "2026-07", dias: 18, diasDoMes: 31 },
    { mes: "2026-08", dias: 31, diasDoMes: 31 },
    { mes: "2026-09", dias: 30, diasDoMes: 30 },
    { mes: "2026-10", dias: 11, diasDoMes: 31 },
  ]);
  confere("virada de ano", mesesDoPeriodo("2026-12-30", "2027-01-02").map((m) => [m.mes, m.dias]), [["2026-12", 2], ["2027-01", 2]]);

  // ── 3. TAXA POR BANDEIRA (E8) ───────────────────────────────────────────
  console.log("\n— Taxa de pagamento —");
  const feesPorBandeira = {
    PIX: { rate: 0, active: true },
    CREDITO: { rate: 0, active: true, brands: [{ name: "Visa", rate: 3, active: true }, { name: "Elo", rate: 3.5, active: true }, { name: "Amex", rate: 9, active: false }] },
    DEBITO: { rate: 0, active: true, brands: [{ name: "Visa", rate: 1.5, active: true }, { name: "Elo", rate: 2, active: true }] },
    VOUCHER: { rate: 0, active: true, brands: [{ name: "VR", rate: 5, active: true }] },
  };
  confere("crédito = média das bandeiras ATIVAS (a taxa geral é 0)", taxaDaForma(feesPorBandeira, "CREDITO").pct, 3.25);
  confere("débito por bandeira", taxaDaForma(feesPorBandeira, "DEBITO").pct, 1.75);
  confere("vale = VOUCHER", taxaDaForma(feesPorBandeira, "VALE").pct, 5);
  confere("Pix na chave da loja: sem taxa (não 0,5%)", taxaDaForma(feesPorBandeira, "PIX").pct, 0);
  confere("Pix sem nada cadastrado: sem taxa", taxaDaForma({}, "PIX"), { pct: 0, configurada: true, comoFoi: "Pix na chave da loja: sem taxa" });
  confere("crédito sem nada cadastrado: NÃO configurado (não inventa 2,99%)", taxaDaForma({}, "CREDITO").configurada, false);
  confere("formato antigo (número)", taxaDaForma({ CREDITO: 2.5 }, "CREDITO").pct, 2.5);
  confere("taxa única quando não há bandeira ativa", taxaDaForma({ DEBITO: { rate: 1.9, brands: [{ rate: 2, active: false }] } }, "DEBITO").pct, 1.9);

  // ── 4. O DRE INTEIRO ────────────────────────────────────────────────────
  console.log("\n— DRE com os casos da auditoria —");
  let seq = 0;
  const pedido = (p: Partial<PedidoDoFinanceiro> & { criadoEm: string; totalAmount: number }): PedidoDoFinanceiro => ({
    id: `p${++seq}`, numero: String(seq), status: "ENTREGUE", deliveryFee: 0,
    tipo: "DELIVERY", canal: "SITE", marketplace: false, entregaDoApp: false, temEntregador: true,
    tableSessionId: null, parentOrderId: null, itens: p.totalAmount - (p.deliveryFee || 0), itensComCusto: 0, custo: 0,
    impossivel: false, pagamentos: [{ forma: "DINHEIRO", valor: p.totalAmount }], taxaOnline: 0, cupomDoApp: 0,
    paymentMethod: "Dinheiro", pagarmeMethod: null, paymentPaidAt: null,
    ...p,
  });
  const pedidos: PedidoDoFinanceiro[] = [
    // Mesa de três rodadas: UMA venda (E11). Paga na conta, não no pedido.
    pedido({ criadoEm: "2026-10-05T22:00:00Z", totalAmount: 50, tipo: "MESA", canal: "MESA", tableSessionId: "s1", pagamentos: [], itens: 50, itensComCusto: 50, custo: 15 }),
    pedido({ criadoEm: "2026-10-05T22:30:00Z", totalAmount: 60, tipo: "MESA", canal: "MESA", tableSessionId: "s1", pagamentos: [], itens: 60, itensComCusto: 60, custo: 18 }),
    pedido({ criadoEm: "2026-10-05T23:00:00Z", totalAmount: 40, tipo: "MESA", canal: "MESA", tableSessionId: "s1", pagamentos: [], itens: 40, itensComCusto: 40, custo: 12 }),
    // iFood com entregador do iFood: a taxa de R$ 8 fica com o app (E1).
    pedido({ criadoEm: "2026-10-06T23:00:00Z", totalAmount: 108, deliveryFee: 8, canal: "IFOOD", marketplace: true, entregaDoApp: true, temEntregador: false, itens: 100, itensComCusto: 100, custo: 30, pagamentos: [{ forma: "ONLINE", valor: 108 }], cupomDoApp: 10, paymentMethod: "Pago Online" }),
    // iFood com entrega da loja, pago na entrega no crédito (taxa da maquininha).
    pedido({ criadoEm: "2026-10-07T23:00:00Z", totalAmount: 55, deliveryFee: 5, canal: "IFOOD", marketplace: true, itens: 50, itensComCusto: 50, custo: 15, pagamentos: [{ forma: "CREDITO", valor: 55 }], paymentMethod: "Crédito (Cobrar na Entrega)" }),
    // 99Food sem comissão cadastrada → pendência.
    pedido({ criadoEm: "2026-10-08T23:00:00Z", totalAmount: 40, canal: "99FOOD", marketplace: true, itens: 40, itensComCusto: 40, custo: 12, pagamentos: [{ forma: "ONLINE", valor: 40 }] }),
    // Site pago online (1% do FireHub gravado) e retirada no Pix (sem taxa).
    pedido({ criadoEm: "2026-10-09T23:00:00Z", totalAmount: 100, deliveryFee: 7, itens: 93, itensComCusto: 93, custo: 30, pagamentos: [{ forma: "ONLINE", valor: 100 }], taxaOnline: 1, paymentPaidAt: "2026-10-09T23:01:00Z", pagarmeMethod: "pix" }),
    pedido({ criadoEm: "2026-10-10T23:00:00Z", totalAmount: 30, tipo: "RETIRADA", itens: 30, itensComCusto: 30, custo: 9, pagamentos: [{ forma: "PIX", valor: 30 }] }),
    // Cancelado (fica fora da receita, conta em cancelamentos) e valor impossível.
    pedido({ criadoEm: "2026-10-10T23:30:00Z", totalAmount: 70, status: "CANCELADO" }),
    pedido({ criadoEm: "2026-10-10T23:40:00Z", totalAmount: 1e17, impossivel: true }),
    // Mais uma entrega da loja (com entregador).
    pedido({ criadoEm: "2026-10-11T23:00:00Z", totalAmount: 45, deliveryFee: 5, itens: 40, itensComCusto: 40, custo: 12 }),
  ];
  const ciclos: CicloNoPeriodo[] = [{ mes: "2026-10", mensalidade: 400, lojasExtras: 100, outrosServicos: 0, custo: 500, situacao: "previsto" }];
  const dados: DadosDoPeriodo = {
    de: "2026-10-05", ate: "2026-10-11", hoje, tz: TZ, pedidos,
    entregadores: { porEntrega: 20, diarias: 60, total: 80, corridas: 4, corridasCanceladas: 0, diasDeDiaria: 1, semDistancia: 0, pelaTaxaDoCliente: 0, erro: null },
    mesas: {
      fechadas: 1, descontoNoFechamento: 15, mesasComDesconto: 1, taxaDeServico: 15, gorjeta: 0,
      // A conta da mesa (R$ 150 − 15 de desconto + 15 de serviço) paga no crédito.
      pagamentos: [{ forma: "CREDITO", valor: 150 }],
    },
    ciclos, isenta: false,
  };
  const despesas = [
    { dia: "2026-10-06", categoria: "Gás", valor: 120 },
    { dia: "2026-09-30", categoria: "Gás", valor: 999 }, // fora do período
  ];
  const custosFixos = [{ id: "a", label: "Aluguel", value: 3100 }];
  const comissoes = { IFOOD: 20 };
  const dre = calcularDRE({ dados, custosFixos, despesas, comissoes, paymentFees: feesPorBandeira });

  const somaValida = 50 + 60 + 40 + 108 + 55 + 40 + 100 + 30 + 45;
  confere("valor vendido = Σ total dos pedidos que são venda (sem cancelado e sem valor impossível)", dre.valorVendido, somaValida);
  confere("vendas: a mesa de três rodadas é UMA venda", [dre.vendas, dre.lancamentos, dre.mesasAtendidas], [7, 9, 1]);
  confere("ticket = valor ÷ vendas", dre.ticketMedio, Math.round((somaValida / 7) * 100) / 100);
  confere("por tipo: Entrega/Mesa/Retirada", dre.porTipo.map((t) => [t.rotulo, t.vendas]), [["Entrega", 5], ["Retirada", 1], ["Mesa", 1]]);
  confere("frete da corrida do app sai da receita", [dre.freteDoApp, dre.freteDaLoja], [8, 17]);
  confere("receita da loja = valor − frete do app − desconto da mesa + cupom do app", dre.receitaDaLoja, somaValida - 8 - 15 + 10);
  confere("CMV pelo custo cadastrado", dre.cmv, 15 + 18 + 12 + 30 + 15 + 12 + 30 + 9 + 12);
  confere("cobertura de custo = 100%", dre.cobertura, 1);
  confere("comissão do iFood = 20% dos itens; 99Food sem percentual", dre.comissoes.map((c) => [c.canal, c.base, c.pct, c.valor]), [["IFOOD", 150, 20, 30], ["99FOOD", 40, null, 0]]);
  // Crédito: R$ 55 do iFood na porta + R$ 150 da conta da mesa, a 3,25%.
  const credito = dre.taxas.find((t) => t.chave === "CREDITO")!;
  confere("crédito pela média das bandeiras, mesa pela conta", [credito.base, credito.pct, credito.valor], [205, 3.25, 6.66]);
  confere("Pix na chave: sem taxa", dre.taxas.find((t) => t.chave === "PIX")?.valor, 0);
  confere("pago pelo site: o 1% gravado", dre.taxas.find((t) => t.chave === "SITE")?.valor, 1);
  confere("pago no app: sem taxa de maquininha (está na comissão)", dre.taxas.some((t) => (t.chave as string) === "ONLINE"), false);
  confere("entregadores = corridas + diárias (não motoboyFee)", dre.entregadores.total, 80);
  confere("mensalidade = ciclo (R$ 500 com as lojas extras) × 7/31", dre.mensalidade.total, Math.round((50000 * 7) / 31) / 100);
  confere("despesas lançadas só do período", dre.despesas.total, 120);
  confere("custo fixo de 7 dias = 7/31 do mês", dre.custosFixos.total, 700);
  const esperado = Math.round((dre.receitaDaLoja - dre.cmv - dre.totalComissoes - dre.totalTaxas - 80 - dre.mensalidade.total - 120 - 700) * 100) / 100;
  confere("resultado = a cadeia inteira", dre.resultado, esperado);
  confere("margens sobre a receita da loja (uma base só)", [dre.margens.bruta, dre.margens.resultado],
    [Math.round((dre.lucroBruto / dre.receitaDaLoja) * 10000) / 100, Math.round((dre.resultado / dre.receitaDaLoja) * 10000) / 100]);
  confere("cancelamentos contados à parte", dre.cancelados, { pedidos: 1, valor: 70 });
  confere("sem comissão do 99Food: resultado incompleto", [dre.completo, dre.pendencias], [false, ["comissão do 99Food não configurada"]]);
  // Entrega da loja sem entregador atribuído: até 20% é aviso; acima, o custo
  // das entregas está incompleto.
  const semEntregador = (n: number, de: number) => calcularDRE({
    dados: { ...dados, pedidos: Array.from({ length: de }, (_, i) => pedido({ criadoEm: "2026-10-06T23:00:00Z", totalAmount: 30, temEntregador: i >= n, itensComCusto: 30, custo: 10 })) },
    custosFixos: [], despesas: [], comissoes: {}, paymentFees: feesPorBandeira,
  });
  confere("1 de 5 entregas sem entregador: só aviso", [semEntregador(1, 5).completo, semEntregador(1, 5).avisos.some((a) => a.startsWith("1 entrega da loja ficou sem entregador"))], [true, true]);
  confere("1 de 4 entregas sem entregador: pendência", semEntregador(1, 4).pendencias, ["1 entrega da loja ficou sem entregador atribuído — o custo delas não entra aqui"]);

  // ── 5. RÉGUA ÚNICA: DRE = Relatórios ────────────────────────────────────
  console.log("\n— Receita do DRE = régua dos Relatórios (lib/relatorios/vendas.ts) —");
  const comoNosRelatorios: PedidoParaVendas[] = pedidos.map((p) => ({
    id: p.id, franchiseeId: "loja", createdAt: p.criadoEm, status: p.status, totalAmount: p.totalAmount, deliveryFee: p.deliveryFee,
    deliveryType: p.tipo === "MESA" ? "MESA" : p.tipo === "RETIRADA" ? "RETIRADA" : "DELIVERY", source: p.canal === "IFOOD" ? "IFOOD" : p.canal === "99FOOD" ? "99FOOD" : "ONLINE",
    tableSessionId: p.tableSessionId, parentOrderId: p.parentOrderId,
    items: [{ quantity: 1, price: p.impossivel ? 1e17 : p.itens }],
  }));
  const relatorio = resumoDeVendas(comoNosRelatorios, []);
  confere("valor vendido igual ao Vendas por período", dre.valorVendido, relatorio.totalPedidos);
  confere("vendas iguais", dre.vendas, relatorio.atendimentos);
  confere("ticket igual", dre.ticketMedio, relatorio.ticketMedio);
  confere("tipo de venda pela mesma régua", pedidos.filter(entraNoDRE).map((p) => p.tipo), comoNosRelatorios.filter((p) => p.status !== "CANCELADO" && p.totalAmount < 1e6).map((p) => tipoDeVenda(p as any)));

  // ── 6. LUCRO HONESTO (E2) ───────────────────────────────────────────────
  console.log("\n— Resultado incompleto x completo —");
  const semCusto = calcularDRE({
    dados: { ...dados, pedidos: pedidos.map((p) => ({ ...p, itensComCusto: p.canal === "MESA" ? p.itens : 0, custo: p.canal === "MESA" ? p.custo : 0 })) },
    custosFixos, despesas, comissoes: { IFOOD: 20, "99FOOD": 12 }, paymentFees: feesPorBandeira,
  });
  confere("cobertura abaixo de 80% vira pendência", semCusto.pendencias, [`${Math.round((1 - semCusto.cobertura) * 100)}% do valor dos itens vendidos está sem custo cadastrado`]);
  const completo = calcularDRE({ dados, custosFixos, despesas, comissoes: { IFOOD: 20, "99FOOD": 12 }, paymentFees: feesPorBandeira });
  confere("tudo cadastrado: resultado completo", [completo.completo, completo.pendencias.length], [true, 0]);
  const semMaquininha = calcularDRE({ dados, custosFixos, despesas, comissoes: { IFOOD: 20, "99FOOD": 12 }, paymentFees: {} });
  confere("crédito vendido sem taxa cadastrada: pendência", semMaquininha.pendencias, ["taxa da maquininha não cadastrada (crédito (maquininha))"]);
  const comErro = calcularDRE({ dados: { ...dados, entregadores: { ...dados.entregadores, erro: "falhou" } }, custosFixos, despesas, comissoes: { IFOOD: 20, "99FOOD": 12 }, paymentFees: feesPorBandeira });
  confere("entregadores não apurados: pendência", comErro.completo, false);
  confere("comissão gravada é lida; percentual inválido descartado", lerComissoesDosApps({ faturamento: 25000, comissaoDosApps: { IFOOD: 23, "99FOOD": 120, BRENDI: "", WABIZ: "5" } }), { IFOOD: 23, WABIZ: 5 });

  // ── 7. CUSTOS FIXOS DA PASTEL EM 90 DIAS (E12) ──────────────────────────
  const pastel = calcularDRE({
    dados: { ...dados, de: "2026-07-14", ate: "2026-10-11", pedidos: [], ciclos: [], mesas: { ...dados.mesas, pagamentos: [], descontoNoFechamento: 0 } },
    custosFixos: [{ id: "x", label: "Tudo", value: 10120 }], despesas: [], comissoes: {}, paymentFees: {},
  });
  const esperadoPastel = Math.round((1012000 * 18) / 31) / 100 + 10120 + 10120 + Math.round((1012000 * 11) / 31) / 100;
  confere("Pastel: R$ 10.120/mês em 90 dias ≈ 2,94 meses (não 1 mês)", pastel.custosFixos.total, Math.round(esperadoPastel * 100) / 100);
  confere("Pastel: meses equivalentes", pastel.custosFixos.mesesEquivalentes, 2.935);
  confere("valor do custo fixo em formato brasileiro (E19)", [lerValorEmReais("1.200,00"), lerValorEmReais("1200,5"), lerValorEmReais("850")], [1200, 1200.5, 850]);

  // ── 8. MENSALIDADE: a conta que a tela mostra = a do boleto (E3/E6) ───────
  console.log("\n— Mensalidade —");
  // Brazza, outubro/2026: R$ 4.430,44 a 1% (01–03/10) + R$ 5.917,40 a 2%, duas lojas extras.
  const brazzaMensal = calcMensalidade(10347.84, true, "2026-10", 4430.44).mensalidade;
  confere("Brazza: a porcentagem da tela (1% + 2%) = calcMensalidade", Math.round((4430.44 * 0.01 + 5917.40 * 0.02) * 100) / 100, Math.round(brazzaMensal * 100) / 100);
  confere("Brazza: previsão = mensalidade + 2 lojas extras", Math.round((brazzaMensal + 100) * 100) / 100, 262.65);
  // Ragnar, setembro/2026: teto (R$ 400) + 2 lojas extras = boleto de R$ 500. No DRE de setembro inteiro: R$ 500.
  const ragnarSet = calcularDRE({
    dados: { ...dados, de: "2026-09-01", ate: "2026-09-30", pedidos: [], mesas: { ...dados.mesas, pagamentos: [], descontoNoFechamento: 0 },
      ciclos: [{ mes: "2026-09", mensalidade: 400, lojasExtras: 100, outrosServicos: 0, custo: 500, situacao: "fechado" }] },
    custosFixos: [], despesas: [], comissoes: {}, paymentFees: {},
  });
  confere("Ragnar setembro inteiro: mensalidade do DRE = boleto (R$ 500)", ragnarSet.mensalidade.total, 500);
  // Divinos em teste: ciclo zero → DRE zero (o antigo descontava R$ 204,90).
  const divinos = calcularDRE({
    dados: { ...dados, pedidos: [], ciclos: [{ mes: "2026-10", mensalidade: 0, lojasExtras: 0, outrosServicos: 0, custo: 0, situacao: "teste" }] },
    custosFixos: [], despesas: [], comissoes: {}, paymentFees: {},
  });
  confere("Divinos em teste: mensalidade do DRE = R$ 0", divinos.mensalidade.total, 0);
  confere("loja isenta: R$ 0", calcularDRE({ dados: { ...dados, isenta: true, ciclos: [] }, custosFixos: [], despesas: [], comissoes: {}, paymentFees: {} }).mensalidade.total, 0);

  // ── 9. O QUE A TELA MOSTRA EM VOLTA (E13/E14) ───────────────────────────
  console.log("\n— Economia e recebimentos —");
  const economia = economiaNosCanaisProprios(dre, comissoes);
  confere("economia só sobre site + WhatsApp, com o % da loja", [economia.base, economia.percentual, economia.valor], [175, 20, 35]);
  confere("loja 100% app: economia zero (antes 26% de tudo)", economiaNosCanaisProprios({ porCanal: [{ canal: "IFOOD", nome: "iFood", pedidos: 10, valor: 1000 }] }, {}).base, 0);
  const receb = recebimentosDoPeriodo(dados);
  confere("pago online pelo site entra no 'Faturamento online'", [receb.site.total, receb.site.pix, receb.site.taxaFireHub], [100, 100, 1]);
  confere("pago no app vai para o repasse do app", receb.noApp.linhas.map((l) => [l.canal, l.valor]), [["IFOOD", 108], ["99FOOD", 40]]);
  confere("recebido na loja pelas formas do caixa (mesa pela conta)", receb.naLoja.linhas.map((l) => [l.forma, l.valor]), [["DINHEIRO", 45], ["PIX", 30], ["CREDITO", 205]]);
  confere("ponto de equilíbrio só com resultado completo", pontoDeEquilibrio(dre, 3100), { ok: false, motivo: "incompleto" });
  const pe = pontoDeEquilibrio(completo, 3100);
  confere("ponto de equilíbrio = fixo ÷ margem de contribuição", pe.ok ? Math.round(pe.vendaMensal) : null, Math.round(3100 / (completo.margemDeContribuicao / completo.valorVendido)));

  // ── 10. FIM DO TESTE: uma regra só (E5) ─────────────────────────────────
  console.log("\n— Fim do teste —");
  const agora = new Date("2026-10-11T12:00:00Z");
  confere("sem trialEndsAt: sem teste (o topo inventava cadastro + 15 dias)", [fimDoTeste(null), diasDeTesteRestantes(null, agora)], [null, 0]);
  confere("teste até 13/10 12h: 2 dias", diasDeTesteRestantes("2026-10-13T12:00:00Z", agora), 2);
  confere("faltando 2 horas: 1 dia", diasDeTesteRestantes("2026-10-11T14:00:00Z", agora), 1);
  confere("teste acabado: 0", diasDeTesteRestantes("2026-10-01T00:00:00Z", agora), 0);
  confere("data inválida: sem teste", fimDoTeste("xx"), null);
  // A cobrança lê a mesma regra (lib/billing.ts importa o prisma: precisa de uma URL qualquer só para carregar).
  process.env.DATABASE_URL ||= "postgresql://127.0.0.1:1/so-para-carregar";
  const { inicioDaCobranca, intervaloDoMes } = await import("../src/lib/billing");
  const { monthStart, monthEnd } = intervaloDoMes("2026-10", TZ);
  confere("cobrança: sem teste, cobra desde o dia 1 (o mesmo 'sem teste' do topo)", inicioDaCobranca(monthStart, monthEnd, null)?.toISOString(), monthStart.toISOString());
  confere("cobrança: teste no meio do mês, cobra do fim do teste", inicioDaCobranca(monthStart, monthEnd, "2026-10-13T12:00:00Z")?.toISOString(), "2026-10-13T12:00:00.000Z");
  confere("cobrança: teste cobre o mês, nada a cobrar", inicioDaCobranca(monthStart, monthEnd, "2026-11-20T00:00:00Z"), null);
  confere("cobrança: data inválida = sem teste", inicioDaCobranca(monthStart, monthEnd, "xx")?.toISOString(), monthStart.toISOString());

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
