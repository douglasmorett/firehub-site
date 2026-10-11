/**
 * A tela do Financeiro (app/store/financeiro/DREClient.tsx) renderizada no
 * servidor, sem navegador e sem banco — cada aba com dados de mentira no
 * formato que a página manda.
 *
 *   npx tsx scripts/teste-tela-do-financeiro.tsx
 *
 * Trava o que a auditoria de 11/10/2026 achou NA TELA: a seção #fatura que o
 * aviso do topo procura (com a fatura de setembro em aberto em primeiro), a
 * conta da mensalidade com 1% e 2% e as lojas extras, o resultado que não se
 * chama lucro sem custo e comissão, as linhas novas do DRE (frete do app,
 * desconto da mesa, comissão por app, entregadores, mensalidade do ciclo) e o
 * que saiu por prometer o que não faz (saque, "Economia" sobre tudo, alerts).
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DREClient from "../src/app/store/financeiro/DREClient";
import type { DadosDoPeriodo, PedidoDoFinanceiro } from "../src/lib/financeiro/dre";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`✅ ${nome}`); }
  else { falhas++; console.log(`❌ ${nome}${detalhe !== undefined ? ` → ${String(detalhe).slice(0, 300)}` : ""}`); }
}

let seq = 0;
const pedido = (p: Partial<PedidoDoFinanceiro> & { criadoEm: string; totalAmount: number }): PedidoDoFinanceiro => ({
  id: `p${++seq}`, numero: String(seq), status: "ENTREGUE", deliveryFee: 0,
  tipo: "DELIVERY", canal: "SITE", marketplace: false, entregaDoApp: false, temEntregador: true,
  tableSessionId: null, parentOrderId: null, itens: p.totalAmount - (p.deliveryFee || 0), itensComCusto: 0, custo: 0,
  impossivel: false, pagamentos: [{ forma: "DINHEIRO", valor: p.totalAmount }], taxaOnline: 0, cupomDoApp: 0, taxaDoApp: 0,
  paymentMethod: "Dinheiro", pagarmeMethod: null, paymentPaidAt: null,
  ...p,
});

const dados: DadosDoPeriodo = {
  de: "2026-10-05", ate: "2026-10-11", hoje: "2026-10-11", tz: "America/Sao_Paulo",
  pedidos: [
    pedido({ criadoEm: "2026-10-05T22:00:00Z", totalAmount: 50, tipo: "MESA", canal: "MESA", tableSessionId: "s1", pagamentos: [] }),
    pedido({ criadoEm: "2026-10-05T22:30:00Z", totalAmount: 60, tipo: "MESA", canal: "MESA", tableSessionId: "s1", pagamentos: [] }),
    pedido({ criadoEm: "2026-10-06T23:00:00Z", totalAmount: 108, deliveryFee: 8, canal: "IFOOD", marketplace: true, entregaDoApp: true, temEntregador: false, itens: 100, pagamentos: [{ forma: "ONLINE", valor: 108 }], cupomDoApp: 10, taxaDoApp: 0.99, paymentMethod: "Pago Online" }),
    pedido({ criadoEm: "2026-10-09T23:00:00Z", totalAmount: 100, deliveryFee: 7, pagamentos: [{ forma: "ONLINE", valor: 100 }], taxaOnline: 1, paymentPaidAt: "2026-10-09T23:01:00Z", pagarmeMethod: "pix", paymentMethod: "Pix (pago online)" }),
    pedido({ criadoEm: "2026-10-10T23:30:00Z", totalAmount: 70, status: "CANCELADO" }),
  ],
  entregadores: { porEntrega: 20, diarias: 60, total: 80, corridas: 4, corridasCanceladas: 0, diasDeDiaria: 1, semDistancia: 0, pelaTaxaDoCliente: 0, erro: null },
  mesas: { fechadas: 1, descontoNoFechamento: 15, mesasComDesconto: 1, taxaDeServico: 11, gorjeta: 0, pagamentos: [{ forma: "CREDITO", valor: 106 }] },
  ciclos: [{ mes: "2026-10", mensalidade: 400, lojasExtras: 100, outrosServicos: 0, custo: 500, situacao: "projetado" }],
  isenta: false,
};

const ciclo: any = {
  yearMonth: "2026-10", totalSales: 10347.84, vendasA1PorCento: 4430.44,
  amountDue: 262.65, amountOffset: 0, amountPending: 262.65, mensalidadePrevista: 162.65,
  taxas: { trafegoPago: 0, totem: 0, lojasExtras: 100 },
  lojasExtras: { lojasIfood: 1, lojas99: 3, valor: 100, linhas: ["99Food +2 loja(s) R$100.00"] },
  status: "OPEN", isExempt: false, emTeste: false, cobrancaPorUso: null,
  cobrancaDesde: "2026-10-01T03:00:00.000Z", trialEndsAt: "2026-09-06T02:59:59.000Z",
  asaasBoletoUrl: null, asaasBoletoCode: null,
  faturasEmAberto: [{ yearMonth: "2026-09", valor: 332.99, venceEm: "2026-10-05", vencida: true, bloqueiaEm: "2026-10-11T03:00:00.000Z", boletoUrl: "https://www.asaas.com/i/exemplo" }],
};

const tela = (aba: string, extra: Record<string, unknown> = {}) => renderToStaticMarkup(
  <DREClient
    inicio={{ de: dados.de, ate: dados.ate, hoje: dados.hoje, tz: dados.tz, aba: aba as any }}
    dadosIniciais={dados}
    erroInicial={null}
    cicloInicial={ciclo}
    papel="FRANCHISEE"
    paymentFees={{ CREDITO: { rate: 0, brands: [{ name: "Visa", rate: 3, active: true }, { name: "Elo", rate: 3.5, active: true }] }, PIX: { rate: 0 } }}
    storeName="Loja de Teste"
    initialFixedCosts={[{ id: "a", label: "Aluguel", value: 3100 }]}
    comissoesIniciais={{ IFOOD: 20 }}
    initialRepasseConfig={{}}
    payables={[]}
    initialDespesas={[]}
    {...(extra as any)}
  />,
);

// ── Mensalidade ──────────────────────────────────────────────────────────
const mensal = tela("mensalidade");
confere("a seção #fatura existe (o 'Ver Fatura' do aviso do topo cai nela)", mensal.includes('id="fatura"'));
confere("a fatura de setembro em aberto vem ANTES do mês corrente", mensal.indexOf("Mensalidade de setembro de 2026") >= 0 && mensal.indexOf("Mensalidade de setembro de 2026") < mensal.indexOf("Mensalidade de outubro de 2026"), mensal.slice(0, 400));
confere("fatura vencida com o valor e o botão de pagar", mensal.includes("FATURA VENCIDA") && mensal.includes("R$ 332,99") && mensal.includes("https://www.asaas.com/i/exemplo"));
confere("a porcentagem mostra o que é 1% e o que é 2%", mensal.includes("R$ 4.430,44 a 1% (01 a 03/10)") && mensal.includes("R$ 5.917,40 a 2%"));
confere("as lojas extras aparecem e somam na previsão", mensal.includes("2 lojas extras de marketplace (99Food +2)") && mensal.includes("R$ 262,65"));
confere("sem o 'Economia vs iFood' de 26% de tudo na Mensalidade", !mensal.includes("Economia Estimada"));
const semFatura = tela("mensalidade", { cicloInicial: { ...ciclo, faturasEmAberto: [] } });
confere("sem fatura em aberto, o #fatura é o mês corrente", semFatura.includes('id="fatura"') && !semFatura.includes("FATURA VENCIDA"));
const isenta = tela("mensalidade", { cicloInicial: { ...ciclo, isExempt: true, faturasEmAberto: [] } });
confere("loja isenta: sem cobrança", isenta.includes("Conta isenta") && !isenta.includes("PREVISÃO DO BOLETO"));
const isentaComBoleto = tela("mensalidade", { cicloInicial: { ...ciclo, isExempt: true } });
confere("loja isenta com boleto antigo em aberto: a fatura aparece primeiro", isentaComBoleto.includes("FATURA VENCIDA") && isentaComBoleto.indexOf("FATURA VENCIDA") < isentaComBoleto.indexOf("Conta isenta"));

// ── DRE ──────────────────────────────────────────────────────────────────
const dre = tela("dre");
confere("período de 7 dias operacionais no título", dre.includes("05/10/2026 a 11/10/2026") && dre.includes("o dia vira às 5h"));
confere("valor vendido igual aos Relatórios", dre.includes("Valor vendido") && dre.includes("o mesmo valor dos Relatórios"));
confere("frete da corrida do app em linha própria", dre.includes("Taxa de entrega que fica com o app"));
confere("desconto dado no fechamento da mesa sai da receita", dre.includes("Desconto dado no fechamento das mesas"));
confere("cupom pago pelo app entra", dre.includes("Cupom pago pelo app"));
confere("comissão do iFood pelo percentual da loja", dre.includes("iFood — 20% sobre os itens"));
confere("entregadores pela conta do fechamento", dre.includes("a mesma conta do Motoboys → Relatório"));
confere("mensalidade pelo ciclo (mês corrente projetado), rateada", dre.includes("out/2026 (projeção do mês): R$ 500,00 × 7/31 dias"));
confere("taxa de serviço do app sai da receita", dre.includes("Taxa de serviço do app (fica com o app)"));
confere("custos fixos rateados mês a mês", dre.includes("7/31 de out/2026"));
confere("sem 'EBITDA' (vem antes do aluguel): margem de contribuição", !dre.includes("EBITDA") && dre.includes("MARGEM DE CONTRIBUIÇÃO"));
confere("sem 'Lucro Líquido' (o Início usa o nome para outra conta)", !dre.includes("LUCRO LÍQUIDO") && !dre.includes("Lucro Líquido"));
confere("margens sobre uma base só", dre.includes("Margens sobre a receita da loja"));
confere("sem custo cadastrado: resultado incompleto, não lucro", dre.includes("Resultado incompleto") && dre.includes("RESULTADO PARCIAL"));
confere("vendas por tipo no ticket (mesa entra)", dre.includes("Mesa 1"));
confere("economia só dos canais próprios", dre.includes("Vendas pelos seus canais próprios") && dre.includes("Balcão, mesa e as vendas que já são do app não entram"));

// ── CMV: de onde veio e o botão do que falta ─────────────────────────────
const semana = { diaDaContagem: 2, fecha: 1, comecaEm: 2 };
const comCmv = (cmv: DadosDoPeriodo["cmv"]) => tela("dre", { dadosIniciais: { ...dados, cmv } });
const lojaSemFicha = comCmv({ real: null, usaFicha: false, usaEstoque: false, semana,
  semCustoPorDia: { "2026-10-06": [{ nome: "X-Tudo", valor: 100, faltas: [{ motivo: "SEM_FICHA", nome: "X-Tudo" }] }] } });
confere("loja sem ficha e sem custo: botão “Cadastrar custos no cardápio”", lojaSemFicha.includes("Cadastrar custos no cardápio") && lojaSemFicha.includes("X-Tudo"));
const lojaComFicha = comCmv({ real: { contagens: 0, ultimaCompleta: null, abertura: null, trecho: null, falta: "NENHUMA_CONTAGEM", semCustoNaContagem: [] }, usaFicha: true, usaEstoque: true, semana,
  semCustoPorDia: { "2026-10-06": [{ nome: "Esfirra de Carne c/ Catupiry", valor: 100, faltas: [{ motivo: "INSUMO_SEM_CUSTO", nome: "Catupiry" }] }] } });
confere("loja com ficha e insumo sem compra: o botão é lançar compras, não “custos no cardápio”",
  lojaComFicha.includes("Lançar compras") && lojaComFicha.includes("Catupiry") && !lojaComFicha.includes("Cadastrar custos no cardápio"));
confere("loja com estoque sem contagem: chama para contar", lojaComFicha.includes("Contar o estoque") && lojaComFicha.includes("toda terça"));
const lojaComContagem = comCmv({ real: { contagens: 2, ultimaCompleta: "2026-10-11", abertura: "2026-10-04",
  trecho: { de: "2026-10-05", ate: "2026-10-11", estoqueInicial: 5000, compras: 3000, estoqueFinal: 4500, cmv: 3500, vendas: 0, pct: null, tipoDoFechamento: "COMPLETA" },
  falta: null, semCustoNaContagem: [] }, usaFicha: true, usaEstoque: true, semana, semCustoPorDia: {} });
confere("contagem cobrindo o período: “CMV real pela contagem” no cartão e no demonstrativo",
  lojaComContagem.includes("CMV real (custo dos produtos)") && lojaComContagem.includes("CMV real pela contagem do estoque de 05/10 a 11/10")
  && lojaComContagem.includes("Pela contagem do estoque — 05/10 a 11/10") && lojaComContagem.includes("R$ 3.500,00"));
confere("contagem cobrindo o período: sem botão de cadastrar custo", !lojaComContagem.includes("Cadastrar custos no cardápio"));

// ── Extrato e Relatório ──────────────────────────────────────────────────
const extrato = tela("extrato");
confere("Extrato: pago online pelo site (Asaas), não Mercado Pago", extrato.includes("Pago online pelo site (sua conta Asaas)") && !extrato.includes("Mercado Pago"));
confere("Extrato: sem botão de saque (a rota está desligada)", !extrato.includes("Saque") && !extrato.includes("saque"));
confere("Extrato: exportar baixa planilha de verdade", extrato.includes("Baixar planilha (CSV)"));
confere("Extrato: a mensalidade não é 'descontada' do dinheiro online", extrato.includes("é cobrada por boleto"));
const relatorio = tela("relatorio");
confere("Relatório: sem linhas fixas em R$ 0,00 (tráfego, indicação, repasse)", !relatorio.includes("Tráfego Pago") && !relatorio.includes("Programa de Indicação") && !relatorio.includes("Taxa de Repasse"));
confere("Relatório: o pago no site aparece (era R$ 0 para todos)", relatorio.includes("Pago online pelo site") && relatorio.includes("R$ 100,00"));

// ── Configurações e custos fixos ─────────────────────────────────────────
const config = tela("configuracoes");
confere("Configurações: comissão por app", config.includes("Comissão e taxas dos apps") && config.includes("99Food"));
confere("Configurações: repasse sem o formulário falso", !config.includes("Salvar Conta de Repasse") && config.includes("ainda não está ativo"));
const fixos = tela("custosfix");
confere("Custos fixos: sem prometer 'quanto precisa vender' com dado faltando", fixos.includes("aparece aqui quando o custo dos produtos e a comissão dos apps estiverem cadastrados"));

console.log(`\n${ok} ok, ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
