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
  lerPeriodo, mesesDoPeriodo, periodoDoFinanceiro, pontoDeEquilibrio, projetarMensalidadeDoMes, recebimentosDoPeriodo, taxaDaForma,
  type CicloNoPeriodo, type CmvDoServidor, type CmvRealDoPeriodo, type DadosDoPeriodo, type PedidoDoFinanceiro,
} from "../src/lib/financeiro/dre";
import { custoDoInsumoNoDia, custoDoItem, lerEscolhas, montarCatalogo, type ItemParaCusto, type ProdutoParaCusto } from "../src/lib/financeiro/custo-pela-ficha";
import { custosNoDia, type InsumoParaCusto } from "../src/lib/cmv/custo-do-insumo";
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
  confere("período não passa de hoje (dia futuro só somaria custo fixo)", lerPeriodo("2026-10-05", "2026-10-31", hoje), { de: "2026-10-05", ate: "2026-10-11" });
  confere("período todo no futuro vira hoje", lerPeriodo("2026-11-01", "2026-11-05", hoje), { de: "2026-10-11", ate: "2026-10-11" });
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
    impossivel: false, pagamentos: [{ forma: "DINHEIRO", valor: p.totalAmount }], taxaOnline: 0, cupomDoApp: 0, taxaDoApp: 0,
    paymentMethod: "Dinheiro", pagarmeMethod: null, paymentPaidAt: null,
    ...p,
  });
  const pedidos: PedidoDoFinanceiro[] = [
    // Mesa de três rodadas: UMA venda (E11). Paga na conta, não no pedido.
    pedido({ criadoEm: "2026-10-05T22:00:00Z", totalAmount: 50, tipo: "MESA", canal: "MESA", tableSessionId: "s1", pagamentos: [], itens: 50, itensComCusto: 50, custo: 15 }),
    pedido({ criadoEm: "2026-10-05T22:30:00Z", totalAmount: 60, tipo: "MESA", canal: "MESA", tableSessionId: "s1", pagamentos: [], itens: 60, itensComCusto: 60, custo: 18 }),
    pedido({ criadoEm: "2026-10-05T23:00:00Z", totalAmount: 40, tipo: "MESA", canal: "MESA", tableSessionId: "s1", pagamentos: [], itens: 40, itensComCusto: 40, custo: 12 }),
    // iFood com entregador do iFood: a taxa de R$ 8 fica com o app (E1).
    // E a taxa de serviço do iFood (R$ 0,99), que o cliente paga ao app.
    pedido({ criadoEm: "2026-10-06T23:00:00Z", totalAmount: 108, deliveryFee: 8, canal: "IFOOD", marketplace: true, entregaDoApp: true, temEntregador: false, itens: 100, itensComCusto: 100, custo: 30, pagamentos: [{ forma: "ONLINE", valor: 108 }], cupomDoApp: 10, taxaDoApp: 0.99, paymentMethod: "Pago Online" }),
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
  confere("receita da loja = valor − frete do app − taxa de serviço do app − desconto da mesa + cupom do app", dre.receitaDaLoja, Math.round((somaValida - 8 - 0.99 - 15 + 10) * 100) / 100);
  confere("taxa de serviço do app em linha própria", [dre.taxaDoApp, dre.pedidosComTaxaDoApp], [0.99, 1]);
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
  const semMesas = calcularDRE({ dados: { ...dados, mesas: { ...dados.mesas, erro: "falhou" } }, custosFixos, despesas, comissoes: { IFOOD: 20, "99FOOD": 12 }, paymentFees: feesPorBandeira });
  confere("mesas não lidas: pendência (não zero calado)", semMesas.pendencias, ["as mesas fechadas não puderam ser lidas (desconto no fechamento e pagamento das mesas)"]);
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

  // Mês em andamento: a previsão "até agora" não pode ser rateada pelos dias do
  // mês (dividia duas vezes). Brazza, 11/10 às 10h: R$ 4.430,44 a 1% (01–03/10)
  // + R$ 5.917,40 a 2% em 7,4 dias → o mês projetado passa do teto (R$ 400).
  const projetadaBrazza = projetarMensalidadeDoMes({
    yearMonth: "2026-10", vendas: 10347.84, vendasA1PorCento: 4430.44,
    desde: new Date("2026-10-01T03:00:00Z"), fimDoMes: new Date("2026-11-01T03:00:00Z"), agora: new Date("2026-10-11T13:00:00Z"),
    minimoPorUso: 0, previstaAteAgora: 162.65,
  });
  confere("Brazza: mensalidade do mês projetada pelo ritmo (teto)", projetadaBrazza, 400);
  confere("Brazza 'Este mês' no DRE: (400 + 100 de lojas extras) × 11/31 (antes R$ 93,20)",
    calcularDRE({ dados: { ...dados, de: "2026-10-01", ate: "2026-10-11", pedidos: [], mesas: { ...dados.mesas, pagamentos: [], descontoNoFechamento: 0 },
      ciclos: [{ mes: "2026-10", mensalidade: projetadaBrazza, lojasExtras: 100, outrosServicos: 0, custo: projetadaBrazza + 100, situacao: "projetado" }] },
      custosFixos: [], despesas: [], comissoes: {}, paymentFees: {} }).mensalidade.total, 177.42);
  confere("ritmo baixo: o mínimo do mês (não a previsão rateada duas vezes)", projetarMensalidadeDoMes({
    yearMonth: "2026-11", vendas: 1000, vendasA1PorCento: 0, desde: new Date("2026-11-01T03:00:00Z"), fimDoMes: new Date("2026-12-01T03:00:00Z"),
    agora: new Date("2026-11-11T03:00:00Z"), minimoPorUso: 0, previstaAteAgora: 100 }), 100);
  confere("ritmo médio: 2% do mês projetado", projetarMensalidadeDoMes({
    yearMonth: "2026-11", vendas: 5000, vendasA1PorCento: 0, desde: new Date("2026-11-01T03:00:00Z"), fimDoMes: new Date("2026-12-01T03:00:00Z"),
    agora: new Date("2026-11-11T03:00:00Z"), minimoPorUso: 0, previstaAteAgora: 100 }), 300);
  confere("sem venda e com uso: o mínimo por uso", projetarMensalidadeDoMes({
    yearMonth: "2026-11", vendas: 0, vendasA1PorCento: 0, desde: new Date("2026-11-01T03:00:00Z"), fimDoMes: new Date("2026-12-01T03:00:00Z"),
    agora: new Date("2026-11-02T03:00:00Z"), minimoPorUso: 100, previstaAteAgora: 100 }), 100);
  confere("teste acabou no meio do mês: o ritmo conta do fim do teste", projetarMensalidadeDoMes({
    yearMonth: "2026-11", vendas: 2000, vendasA1PorCento: 0, desde: new Date("2026-11-21T03:00:00Z"), fimDoMes: new Date("2026-12-01T03:00:00Z"),
    agora: new Date("2026-11-26T03:00:00Z"), minimoPorUso: 0, previstaAteAgora: 100 }), 100);

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

  // ── 11. CMV: CONTAGEM → FICHA TÉCNICA → CUSTO DO PRODUTO ────────────────
  console.log("\n— Custo do item pela ficha técnica × custo do insumo no dia —");
  const insumo = (id: string, x: Partial<InsumoParaCusto & { entraNoCmv: boolean }> = {}) => ({
    id, nome: id, unidade: "g", tipo: null, rendimento: null, unitCost: null, componentes: [], entraNoCmv: true, ...x,
  });
  const INSUMOS = [
    insumo("Massa", { unidade: "un" }), insumo("Recheio de carne"), insumo("Mussarela"), insumo("Catupiry"),
    insumo("Coca lata", { unidade: "un" }), insumo("Caixa G", { unidade: "un" }), insumo("Kraft", { unidade: "un" }),
    insumo("Guardanapo", { unidade: "un", unitCost: 0.1, entraNoCmv: false }),
    insumo("Frango"), insumo("Sal"),
    // 1 kg de frango + 10 g de sal rendem 800 g de recheio.
    insumo("Recheio de frango", { tipo: "PREPARO", rendimento: 800, componentes: [{ insumoId: "Frango", quantidade: 1000 }, { insumoId: "Sal", quantidade: 10 }] }),
  ];
  const compra = (id: string, dia: string, unitCost: number, custoAnterior?: number | null) => ({ stockItemId: id, dia, em: Date.parse(`${dia}T20:00:00Z`), unitCost, custoAnterior });
  const ENTRADAS = [
    compra("Massa", "2026-10-01", 0.5), compra("Recheio de carne", "2026-10-01", 0.04),
    // A carne subiu na compra do dia 12: a venda do 13 já sai pelo custo novo.
    compra("Recheio de carne", "2026-10-12", 0.06, 0.04),
    // A primeira compra de mussarela foi no dia 12: antes disso ela não tinha custo.
    compra("Mussarela", "2026-10-12", 0.05, null),
    compra("Coca lata", "2026-10-01", 3), compra("Caixa G", "2026-10-01", 1), compra("Kraft", "2026-10-01", 0.7),
    compra("Frango", "2026-10-01", 0.02),
    // Catupiry e Sal: nenhuma compra, nenhum custo no cadastro.
  ];
  const ficha = (...l: [string, number][]) => l.map(([insumoId, quantidade]) => ({ insumoId, nome: insumoId, quantidade }));
  const prod = (id: string, nome: string, x: Partial<ProdutoParaCusto> = {}): ProdutoParaCusto => ({ id, nome, ativo: true, custo: null, combo: false, ficha: [], grupos: [], ...x });
  const CATALOGO = montarCatalogo([
    prod("p-carne", "Esfirra de Carne", { ficha: ficha(["Massa", 1], ["Recheio de carne", 25]) }),
    prod("p-carne-promo", "Esfirra de Carne (Promo)", { ficha: ficha(["Massa", 1], ["Recheio de carne", 25]) }),
    prod("p-queijo", "Esfirra de Queijo Temperado", { ficha: ficha(["Massa", 1], ["Mussarela", 20]) }),
    prod("p-catupiry", "Esfirra de Carne c/ Catupiry", { ficha: ficha(["Massa", 1], ["Recheio de carne", 25], ["Catupiry", 15]) }),
    prod("p-frango", "Esfirra de Frango", { ficha: ficha(["Massa", 1], ["Recheio de frango", 10]) }),
    prod("p-coca", "Coca-Cola lata", { ficha: ficha(["Coca lata", 1]) }),
    prod("p-combo", "Combo Imperial", { combo: true, ficha: ficha(["Caixa G", 1], ["Kraft", 1], ["Guardanapo", 2]),
      grupos: [{ id: "g1", opcoes: [{ id: "o1", produtoId: "p-carne" }, { id: "o2", produtoId: "p-queijo" }, { id: "o3", produtoId: "p-coca" }] }] }),
    prod("p-xtudo", "X-Tudo", { custo: 8 }),
    prod("p-suco", "Suco"),
    // Os espelhos do iFood: inativos, categoria "iFood", sem ficha.
    prod("ifood-123", "Combo Imperial", { ativo: false }),
    prod("ifood-9", "esfirra de queijo temperado", { ativo: false }),
    prod("ifood-77", "Combo Imperial Mix", { ativo: false }),
    prod("ifood-55", "Esfirra de Carne (Promo)", { ativo: false }),
  ]);
  const noDia = (dia: string) => custoDoInsumoNoDia(INSUMOS, custosNoDia(INSUMOS, ENTRADAS, dia));
  const item = (x: Partial<ItemParaCusto>, dia = "2026-10-13") => custoDoItem({ produtoId: null, nome: null, quantidade: 1, preco: 10, escolhas: null, ...x }, CATALOGO, noDia(dia));

  // Combo do iFood: o espelho casa com o "Combo Imperial" do cardápio pelo nome;
  // as opções vêm em lista e o preço do item (R$ 45) JÁ tem o acréscimo da Coca (R$ 3).
  const comboIfood = item({ produtoId: "ifood-123", nome: "Combo Imperial", quantidade: 2, preco: 45,
    escolhas: [{ name: "Esfirra de Carne", quantity: 3, price: 0 }, { name: "esfirra de queijo temperado", quantity: 2, price: 0 }, { name: "Coca-Cola lata", quantity: 1, price: 3 }] });
  // Por combo: caixa 1,00 + kraft 0,70 (guardanapo não entra no CMV) + 3 × (0,50 + 25 × 0,06) + 2 × (0,50 + 20 × 0,05) + 3,00 = 13,70.
  confere("combo do iFood: ficha do combo + cada opção × quantidade, pelo custo do dia", [comboIfood.custo, comboIfood.fonte, comboIfood.faltas], [27.4, "FICHA", []]);
  confere("combo do iFood: o valor é preço × quantidade (o acréscimo já está no preço; não soma de novo)", comboIfood.valor, 90);
  const comboSite = item({ produtoId: "p-combo", nome: "Combo Imperial", quantidade: 1, preco: 40, escolhas: { g1: { "Esfirra de Carne": 2, "Coca-Cola lata": 1 } } });
  confere("combo do site no formato { grupo: { nome: qtd } }", comboSite.custo, 1.7 + 2 * 2 + 3);
  confere("item-espelho do iFood casa pelo nome sem diferenciar caixa", item({ produtoId: "ifood-9", nome: "esfirra de queijo temperado", quantidade: 4, preco: 6 }).custo, 6);
  confere("“(Promo)” é produto do cardápio e casa pelo nome", item({ produtoId: "ifood-55", nome: "Esfirra de Carne (Promo)" }).custo, 2);
  confere("o custo do insumo é o do DIA da venda (carne a 0,04 antes da compra do dia 12)", item({ produtoId: "p-carne" }, "2026-10-11").custo, 1.5);
  confere("insumo sem compra lançada: SEM custo (nunca R$ 0)", item({ produtoId: "p-catupiry" }), { nome: "Esfirra de Carne c/ Catupiry", valor: 10, custo: null, fonte: null, faltas: [{ motivo: "INSUMO_SEM_CUSTO", nome: "Catupiry" }] });
  confere("antes da primeira compra, a mussarela não tem custo", item({ produtoId: "p-queijo" }, "2026-10-11").faltas, [{ motivo: "INSUMO_SEM_CUSTO", nome: "Mussarela" }]);
  confere("preparo com componente sem custo: falta o componente (o sal), não o recheio", item({ produtoId: "p-frango" }).faltas, [{ motivo: "INSUMO_SEM_CUSTO", nome: "Sal" }]);
  confere("combo com uma opção sem custo: o combo inteiro fica sem custo",
    item({ produtoId: "p-combo", nome: "Combo Imperial", escolhas: { g1: { "Esfirra de Carne": 1, "Esfirra de Carne c/ Catupiry": 1 } } }).custo, null);
  confere("só o custo digitado (sem ficha): fonte 3", [item({ produtoId: "p-xtudo", quantidade: 2 }).custo, item({ produtoId: "p-xtudo" }).fonte], [16, "CADASTRO"]);
  confere("sem ficha e sem custo digitado", item({ produtoId: "p-suco" }).faltas, [{ motivo: "SEM_FICHA", nome: "Suco" }]);
  confere("nome do iFood que não existe no cardápio", item({ produtoId: "ifood-77", nome: "Combo Imperial Mix" }).faltas, [{ motivo: "NOME_NAO_CASA", nome: "Combo Imperial Mix" }]);
  confere("modificador sem preço (“Sem cebola”) não tira o custo da esfirra", item({ produtoId: "p-carne", escolhas: [{ name: "Sem cebola", quantity: 1, price: 0 }] }).custo, 2);
  confere("adicional pago que não é produto: sem custo", item({ produtoId: "p-carne", escolhas: [{ name: "Bacon extra", quantity: 1, price: 2 }] }).faltas, [{ motivo: "OPCAO_SEM_FICHA", nome: "Bacon extra" }]);
  confere("opção de combo que não é produto: sem custo", item({ produtoId: "ifood-123", nome: "Combo Imperial", escolhas: [{ name: "Esfirra Misteriosa", quantity: 2, price: 0 }] }).faltas, [{ motivo: "OPCAO_SEM_FICHA", nome: "Esfirra Misteriosa" }]);
  confere("“5 Queijos” como texto não vira 5 × Queijos", lerEscolhas(["5 Queijos", "2x Esfirra de Carne"]).map((e) => [e.nome, e.qtd]), [["5 Queijos", 1], ["Esfirra de Carne", 2]]);
  const ambiguo = montarCatalogo([prod("a", "Esfirra", { ficha: ficha(["Massa", 1]) }), prod("b", "esfirra", { ficha: ficha(["Massa", 2]) })]);
  confere("dois produtos ativos com o mesmo nome e fichas diferentes: não chuta", ambiguo.porNome.get("esfirra"), null);

  console.log("\n— CMV do DRE: contagem → ficha → custo do produto —");
  const SEMANA_DO_HAKIM = { diaDaContagem: 2, fecha: 1, comecaEm: 2 }; // contagem na terça antes de abrir: semana de terça a segunda
  const trechoReal = { de: "2026-10-13", ate: "2026-10-19", estoqueInicial: 5000, compras: 3000, estoqueFinal: 4500, cmv: 3500, vendas: 0, pct: null, tipoDoFechamento: "COMPLETA" };
  const real = (x: Partial<CmvRealDoPeriodo> = {}): CmvRealDoPeriodo => ({ contagens: 8, ultimaCompleta: "2026-10-19", abertura: "2026-10-12", trecho: trechoReal, falta: null, semCustoNaContagem: [], ...x });
  const cmvDo = (x: Partial<CmvDoServidor> = {}): CmvDoServidor => ({ real: real(), usaFicha: true, usaEstoque: true, semana: SEMANA_DO_HAKIM, semCustoPorDia: {}, ...x });
  // Vendas do site no dinheiro: nada de comissão, maquininha ou entregador a pendurar.
  const venda = (dia: string, x: Partial<PedidoDoFinanceiro> = {}) => pedido({ criadoEm: `${dia}T23:00:00Z`, totalAmount: 100, tipo: "RETIRADA", itens: 100, ...x });
  const semanaHakim = (pedidos: PedidoDoFinanceiro[], cmv: CmvDoServidor | undefined, de = "2026-10-13", ate = "2026-10-19") => calcularDRE({
    dados: { ...dados, de, ate, hoje: "2026-10-20", pedidos, ciclos: [], mesas: { ...dados.mesas, pagamentos: [], descontoNoFechamento: 0 }, entregadores: { ...dados.entregadores, erro: null }, cmv },
    custosFixos: [], despesas: [], comissoes: {}, paymentFees: {},
  });

  const soContagem = semanaHakim([venda("2026-10-13"), venda("2026-10-15"), venda("2026-10-19", { deliveryFee: 10, totalAmount: 110 })], cmvDo());
  confere("só contagem: CMV = estoque inicial + compras − estoque final", [soContagem.cmv, soContagem.cmvDetalhe.fonte], [3500, "CONTAGEM"]);
  confere("só contagem: diz de onde veio", soContagem.cmvDetalhe.titulo, "CMV real pela contagem do estoque de 13/10 a 19/10");
  confere("só contagem: completo, sem pendência de custo, cobertura 100%", [soContagem.completo, soContagem.pendencias, soContagem.cobertura], [true, [], 1]);
  confere("só contagem: % sobre as vendas desses dias sem a taxa de entrega", [soContagem.cmvDetalhe.real?.vendas, soContagem.cmvDetalhe.real?.pct], [300, 1166.7]);

  // O DRE de 12/10 a 19/10: a contagem cobre 13 a 19; o dia 12 vai pela ficha.
  const parcialBoa = semanaHakim([venda("2026-10-12", { itensComCusto: 90, custo: 30, itensPelaFicha: 90, custoPelaFicha: 30 }), venda("2026-10-14")], cmvDo(), "2026-10-12", "2026-10-19");
  confere("contagem parcial: dias cobertos pelo real + o dia de fora pela ficha", [parcialBoa.cmv, parcialBoa.cmvDetalhe.fonte], [3530, "CONTAGEM_E_FICHA"]);
  confere("contagem parcial: o título diz as duas fontes", parcialBoa.cmvDetalhe.titulo, "CMV real pela contagem do estoque de 13/10 a 19/10; nos outros dias, pela ficha técnica e o custo das compras");
  confere("contagem parcial: o dia de fora com 90% de custo → completo", [parcialBoa.completo, parcialBoa.cmvDetalhe.coberturaFora], [true, 0.9]);
  confere("contagem parcial: a tela aponta a semana do CMV (terça a segunda)", parcialBoa.avisos.some((a) => a.includes("escolha a semana do CMV (de terça a segunda)")), true);
  // O dia de fora só com metade do valor coberto: incompleto, mesmo com 6 dias de contagem.
  const parcialRuim = semanaHakim([venda("2026-10-12", { itensComCusto: 50, custo: 20, itensPelaFicha: 50, custoPelaFicha: 20 }), venda("2026-10-14")],
    cmvDo({ semCustoPorDia: {
      "2026-10-12": [{ nome: "Esfirra de Carne c/ Catupiry", valor: 50, faltas: [{ motivo: "INSUMO_SEM_CUSTO", nome: "Catupiry" }] }],
      // Dia coberto pela contagem: o que estiver sem ficha lá não pesa.
      "2026-10-14": [{ nome: "Suco", valor: 100, faltas: [{ motivo: "SEM_FICHA", nome: "Suco" }] }],
    } }), "2026-10-12", "2026-10-19");
  confere("contagem parcial: a cobertura de fora se mede só nos dias de fora", parcialRuim.pendencias, ["nos dias fora da contagem do estoque, 50% do valor dos itens vendidos está sem custo (insumo sem compra lançada)"]);
  confere("contagem parcial: o que falta e para onde ir (só o dia de fora)", parcialRuim.cmvDetalhe.faltas.map((f) => [f.chave, f.href, f.bloqueia]), [["COMPRAS", "/store/estoque/compras", true]]);
  confere("contagem parcial: a cobertura geral conta os dias da contagem como cobertos", parcialRuim.cobertura, 0.75);

  const soFicha = semanaHakim([venda("2026-10-13", { itensComCusto: 100, custo: 32, itensPelaFicha: 100, custoPelaFicha: 32 })], cmvDo({ real: real({ trecho: null, falta: "NENHUMA_CONTAGEM", contagens: 0, abertura: null, ultimaCompleta: null }) }));
  confere("só ficha: CMV pela ficha × custo das compras", [soFicha.cmv, soFicha.cmvDetalhe.fonte, soFicha.cmvDetalhe.titulo], [32, "FICHA", "CMV pela ficha técnica e o custo das compras"]);
  confere("só ficha: completo; a contagem aparece como próximo passo, sem travar", [soFicha.completo, soFicha.cmvDetalhe.faltas.map((f) => [f.chave, f.bloqueia])], [true, [["CONTAGEM", false]]]);
  confere("só ficha: a contagem diz o dia da contagem completa da loja", soFicha.cmvDetalhe.faltas[0].texto.includes("toda terça"), true);
  const umaContagem = semanaHakim([venda("2026-10-13", { itensComCusto: 100, custo: 32, itensPelaFicha: 100, custoPelaFicha: 32 })], cmvDo({ real: real({ trecho: null, falta: "SO_UMA_CONTAGEM", contagens: 1, abertura: "2026-10-12" }) }));
  confere("uma contagem só: diz que falta a próxima", umaContagem.cmvDetalhe.faltas[0].texto, "A contagem completa de 12/10 abre o período; falta a próxima (toda terça) para o CMV real fechar.");

  const soDigitado = semanaHakim([venda("2026-10-13", { itensComCusto: 100, custo: 40 })], cmvDo({ real: null, usaFicha: false, usaEstoque: false }));
  confere("só custo digitado: fonte 3, sem falar de contagem para loja sem estoque", [soDigitado.cmv, soDigitado.cmvDetalhe.fonte, soDigitado.cmvDetalhe.faltas.length, soDigitado.completo], [40, "CADASTRO", 0, true]);

  const nadaSemFicha = semanaHakim([venda("2026-10-13")], cmvDo({ real: null, usaFicha: false, usaEstoque: false,
    semCustoPorDia: { "2026-10-13": [{ nome: "X-Tudo", valor: 100, faltas: [{ motivo: "SEM_FICHA", nome: "X-Tudo" }] }] } }));
  confere("nada: incompleto com a pendência certa", [nadaSemFicha.completo, nadaSemFicha.pendencias], [false, ["100% do valor dos itens vendidos está sem custo (produto sem custo)"]]);
  confere("nada, loja sem ficha: o botão é “Cadastrar custos no cardápio”", nadaSemFicha.cmvDetalhe.faltas.map((f) => [f.chave, f.rotulo, f.href]), [["CUSTO_NO_PRODUTO", "Cadastrar custos no cardápio", "/store/cardapio"]]);
  confere("nada: diz que não há fonte", nadaSemFicha.cmvDetalhe.fonte, "NENHUMA");
  const nadaComFicha = semanaHakim([venda("2026-10-13")], cmvDo({ real: real({ trecho: null, falta: "NENHUMA_CONTAGEM", contagens: 0, abertura: null, ultimaCompleta: null }),
    semCustoPorDia: { "2026-10-13": [
      { nome: "Suco", valor: 60, faltas: [{ motivo: "SEM_FICHA", nome: "Suco" }] },
      { nome: "Combo Imperial Mix", valor: 40, faltas: [{ motivo: "NOME_NAO_CASA", nome: "Combo Imperial Mix" }] },
    ] } }));
  confere("nada, loja com ficha: ficha técnica e nome do app (não “custos no cardápio”)", nadaComFicha.cmvDetalhe.faltas.map((f) => [f.chave, f.rotulo]),
    [["FICHA", "Fazer as fichas técnicas"], ["NOME_DO_APP", "Abrir o cardápio"], ["CONTAGEM", "Contar o estoque"]]);
  confere("nada, loja com ficha: a pendência resume os motivos", nadaComFicha.pendencias, ["100% do valor dos itens vendidos está sem custo (produto sem ficha técnica e nome do app que não existe no cardápio)"]);

  const contagemSemCusto = semanaHakim([venda("2026-10-13")], cmvDo({ real: real({ semCustoNaContagem: ["Catupiry", "Sal"] }) }));
  confere("insumo contado sem custo: o CMV real não é completo", [contagemSemCusto.completo, contagemSemCusto.pendencias], [false, ["2 insumos contados sem custo na contagem do estoque (entram com R$ 0 no CMV real)"]]);
  const negativo = semanaHakim([venda("2026-10-13")], cmvDo({ real: real({ trecho: { ...trechoReal, estoqueFinal: 9000, cmv: -1000 } }) }));
  confere("CMV da contagem negativo: pendência, não lucro", negativo.completo, false);
  const erroNoCmv = semanaHakim([venda("2026-10-13", { itensComCusto: 100, custo: 30 })], cmvDo({ real: null, erro: "falhou" }));
  confere("contagem/fichas não lidas: pendência", erroNoCmv.pendencias, ["o custo dos produtos (contagem do estoque, fichas técnicas e custo digitado) não pôde ser lido agora — recarregue a página"]);

  console.log("\n— Desperdício no CMV do DRE (cancelado já produzido e lançado) —");
  // 12/10 fora da contagem (vai pela ficha) e 14/10 dentro dela (13 a 19).
  const desperdicioPorDia = {
    "2026-10-12": { cancelados: 18, pedidosCancelados: 2, canceladosSemCusto: 5, lancado: 7 },
    "2026-10-14": { cancelados: 30, pedidosCancelados: 1, canceladosSemCusto: 0, lancado: 4 },
    "2026-10-25": { cancelados: 99, pedidosCancelados: 9, canceladosSemCusto: 0, lancado: 99 }, // fora do período
  };
  const comDesperdicio = semanaHakim([venda("2026-10-12", { itensComCusto: 100, custo: 30, itensPelaFicha: 100, custoPelaFicha: 30 }), venda("2026-10-14")],
    cmvDo({ desperdicioPorDia }), "2026-10-12", "2026-10-19");
  confere("desperdício fora da contagem soma no CMV; o dos dias da contagem já está nela", comDesperdicio.cmv, 3500 + 30 + 18 + 7);
  confere("desperdício: cancelados e lançado separados, com a parte do CMV e a da contagem", comDesperdicio.cmvDetalhe.desperdicio,
    { cancelados: { valor: 48, pedidos: 3, semCusto: 5, noCmv: 18 }, lancado: { valor: 11, noCmv: 7 }, reposicoes: { valor: 0, trocas: 0, faltou: 0, semCusto: 0, semCustoNomes: [], noCmv: 0 }, naContagem: 34 });
  confere("desperdício entra no lucro bruto", comDesperdicio.lucroBruto, Math.round((comDesperdicio.receitaDaLoja - comDesperdicio.cmv) * 100) / 100);
  const soFichaComDesperdicio = semanaHakim([venda("2026-10-13", { itensComCusto: 100, custo: 32, itensPelaFicha: 100, custoPelaFicha: 32 })],
    cmvDo({ real: real({ trecho: null, falta: "NENHUMA_CONTAGEM", contagens: 0, abertura: null, ultimaCompleta: null }), desperdicioPorDia: { "2026-10-13": { cancelados: 12.5, pedidosCancelados: 1, canceladosSemCusto: 0, lancado: 0 } } }));
  confere("sem contagem: o cancelado já produzido soma inteiro no CMV", [soFichaComDesperdicio.cmv, soFichaComDesperdicio.cmvDetalhe.desperdicio.cancelados.noCmv], [44.5, 12.5]);
  confere("sem desperdício: tudo zero", soContagem.cmvDetalhe.desperdicio, { cancelados: { valor: 0, pedidos: 0, semCusto: 0, noCmv: 0 }, lancado: { valor: 0, noCmv: 0 }, reposicoes: { valor: 0, trocas: 0, faltou: 0, semCusto: 0, semCustoNomes: [], noCmv: 0 }, naContagem: 0 });

  console.log("\n— Reposições no CMV do DRE (troca refeita soma; faltou item não) —");
  // O dono (16/10/2026): "se não foi feita, só o custo da entrega de novo; se
  // refez, o custo é do primeiro e do segundo". 12/10 fora da contagem, 14/10 dentro.
  const zeroDesp = { cancelados: 0, pedidosCancelados: 0, canceladosSemCusto: 0, lancado: 0 };
  const comReposicoes = semanaHakim([venda("2026-10-12", { itensComCusto: 100, custo: 30, itensPelaFicha: 100, custoPelaFicha: 30 }), venda("2026-10-14")],
    cmvDo({ desperdicioPorDia: {
      "2026-10-12": { ...zeroDesp, reposicoes: 22, trocas: 2, trocasSemCusto: 1, trocasSemCustoNomes: ["Refrigerante"], faltou: 3 },
      "2026-10-14": { ...zeroDesp, reposicoes: 9, trocas: 1, trocasSemCusto: 0, trocasSemCustoNomes: [], faltou: 0 },
    } }), "2026-10-12", "2026-10-19");
  confere("troca fora da contagem soma no CMV (R$ 22,00); a dos dias da contagem já saiu do estoque contado", comReposicoes.cmv, 3500 + 30 + 22);
  confere("a linha própria 'Reposições (troca)': valor, trocas, faltou só contado, sem custo fora da soma", comReposicoes.cmvDetalhe.desperdicio.reposicoes,
    { valor: 31, trocas: 3, faltou: 3, semCusto: 1, semCustoNomes: ["Refrigerante"], noCmv: 22 });
  confere("a troca dos dias da contagem conta como 'já na contagem'", comReposicoes.cmvDetalhe.desperdicio.naContagem, 9);
  confere("item refeito sem custo cadastrado: aviso, sem inventar custo", comReposicoes.avisos.some((a) => a.startsWith("1 unidade refeita em troca (veio errado) sem custo cadastrado ficou fora do CMV: Refrigerante")), true);
  confere("a troca entra no lucro bruto", comReposicoes.lucroBruto, Math.round((comReposicoes.receitaDaLoja - comReposicoes.cmv) * 100) / 100);
  const soFaltou = semanaHakim([venda("2026-10-13", { itensComCusto: 100, custo: 32, itensPelaFicha: 100, custoPelaFicha: 32 })],
    cmvDo({ real: real({ trecho: null, falta: "NENHUMA_CONTAGEM", contagens: 0, abertura: null, ultimaCompleta: null }), desperdicioPorDia: { "2026-10-13": { ...zeroDesp, reposicoes: 0, trocas: 0, faltou: 4 } } }));
  confere("só faltou item: o CMV não muda (o item já estava na venda; o prejuízo é a corrida, em Entregadores)", [soFaltou.cmv, soFaltou.cmvDetalhe.desperdicio.reposicoes.faltou, soFaltou.cmvDetalhe.desperdicio.reposicoes.noCmv], [32, 4, 0]);

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
