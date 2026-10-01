/**
 * As regras do parceiro (lib/parceiro/regras.ts): papel em cada loja, repasse
 * do split, situação da mensalidade e os números do topo do portal.
 *
 *   npx tsx scripts/teste-relatorio-do-parceiro.ts
 *
 * O caso do Victor (30/09/2026): embaixador (30%) e vendedor (3%). Loja que ele
 * indicou E acompanha conta só como embaixador — os 3% não somam.
 */
import {
  cicloDaReferencia, comissaoSobre, ganhaComoVendedor, mensalidadeDoCiclo, mesesAntes, mesSeguinte, papelNaLoja, repasseNaLoja,
  resumirLojas, splitDaLoja, vencimentoDoBoleto,
  type CicloNasRegras, type LojaDoRelatorio, type LojaNasRegras, type ParceiroNasRegras,
} from "../src/lib/parceiro/regras";


let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const victor: ParceiroNasRegras = { id: "victor", active: true, temCarteira: true, isVendedor: true, commissionPercent: 30, level2Percent: 3, sellerPercent: 3 };
const ana = { id: "ana", active: true, temCarteira: true, commissionPercent: 20, parentAmbassadorId: "victor", parentAmbassador: { id: "victor", active: true, temCarteira: true, level2Percent: 3 } };
const vicComoN1 = { id: "victor", active: true, temCarteira: true, commissionPercent: 30, parentAmbassadorId: null, parentAmbassador: null };
const vicVendedor = { id: "victor", active: true, isVendedor: true, temCarteira: true, sellerPercent: 3 };
const outroVendedor = { id: "bia", active: true, isVendedor: true, temCarteira: true, sellerPercent: 3 };

const indicouEAcompanha: LojaNasRegras = { ambassadorId: "victor", ambassador: vicComoN1, vendedorId: "victor", vendedor: vicVendedor };
const soIndicou: LojaNasRegras = { ambassadorId: "victor", ambassador: vicComoN1, vendedorId: "bia", vendedor: outroVendedor };
const daRedeEAcompanha: LojaNasRegras = { ambassadorId: "ana", ambassador: ana, vendedorId: "victor", vendedor: vicVendedor };
const soCarteira: LojaNasRegras = { ambassadorId: null, ambassador: null, vendedorId: "victor", vendedor: vicVendedor };
const deOutro: LojaNasRegras = { ambassadorId: "ana", ambassador: { ...ana, parentAmbassadorId: null, parentAmbassador: null }, vendedorId: "bia", vendedor: outroVendedor };

console.log("\n— Papel: indicação vence carteira —");
confere("indicou e acompanha = EMBAIXADOR 30%, também na carteira", papelNaLoja(victor, indicouEAcompanha), { papel: "EMBAIXADOR", percentual: 30, tambemNaCarteira: true });
confere("só indicou = EMBAIXADOR 30%", papelNaLoja(victor, soIndicou), { papel: "EMBAIXADOR", percentual: 30, tambemNaCarteira: false });
confere("rede e acompanha = REDE 3%, também na carteira", papelNaLoja(victor, daRedeEAcompanha), { papel: "REDE", percentual: 3, tambemNaCarteira: true });
confere("só carteira = VENDEDOR 3%", papelNaLoja(victor, soCarteira), { papel: "VENDEDOR", percentual: 3, tambemNaCarteira: false });
confere("loja de outro = null", papelNaLoja(victor, deOutro), null);
confere("fora da equipe não tem carteira", papelNaLoja({ ...victor, isVendedor: false }, soCarteira), null);

console.log("\n— O split do fechamento: os 3% não somam em cima da indicação —");
confere("ganhaComoVendedor na própria indicação", ganhaComoVendedor("victor", indicouEAcompanha), false);
confere("ganhaComoVendedor na rede dele", ganhaComoVendedor("victor", daRedeEAcompanha), false);
confere("split: indicou e acompanha = só 30%", splitDaLoja(indicouEAcompanha).linhas, [{ parceiroId: "victor", papel: "EMBAIXADOR", percentual: 30 }]);
confere("split: rede e acompanha = Ana 20% + Victor 3%", splitDaLoja(daRedeEAcompanha).linhas, [
  { parceiroId: "ana", papel: "EMBAIXADOR", percentual: 20 },
  { parceiroId: "victor", papel: "REDE", percentual: 3 },
]);
confere("split: indicou, outra vendedora = 30% + 3% da Bia", splitDaLoja(soIndicou).total, 33);

console.log("\n— Repasse —");
confere("tudo certo = CAI", repasseNaLoja(victor, indicouEAcompanha, "EMBAIXADOR"), "CAI");
confere("sem carteira", repasseNaLoja({ ...victor, temCarteira: false }, soCarteira, "VENDEDOR"), "SEM_CARTEIRA");
confere("pausado", repasseNaLoja({ ...victor, active: false }, soCarteira, "VENDEDOR"), "PARCEIRO_INATIVO");
confere("rede com a Ana sem carteira", repasseNaLoja(victor, { ...daRedeEAcompanha, ambassador: { ...ana, temCarteira: false } }, "REDE"), "INDICADOR_FORA");
confere("acima do teto", repasseNaLoja(victor, { ...soIndicou, ambassador: { ...vicComoN1, commissionPercent: 38 } }, "EMBAIXADOR"), "ACIMA_DO_TETO");

console.log("\n— Meses e vencimento do boleto —");
confere("mês seguinte vira o ano", mesSeguinte("2026-12"), "2027-01");
confere("3 meses antes vira o ano", mesesAntes("2026-02", 3), "2025-11");
confere("boleto de setembro vence 05/10", vencimentoDoBoleto("2026-09").dia, "2026-10-05");
confere("vencido depois de 05/10 23:59 em Brasília", vencimentoDoBoleto("2026-09").vencidoDepoisDe.toISOString(), "2026-10-06T03:00:00.000Z");

console.log("\n— Situação da mensalidade —");
const ciclo = (c: Partial<CicloNasRegras>): CicloNasRegras => ({
  yearMonth: "2026-09", status: "CLOSED", amountDue: 120, amountPending: 120, asaasPaymentId: "pay_1", asaasBoletoUrl: "https://asaas/b",
  dueDate: "2026-10-11T03:00:00.000Z", paidAt: null, paidValue: null, paidNetValue: null, asaasStatus: null, notes: null, ...c,
});
const em = (iso: string) => new Date(iso);
confere("sem ciclo no mês corrente = em andamento R$ 0", mensalidadeDoCiclo(null, "2026-10", "2026-10", em("2026-10-02T12:00:00Z")).situacao, "EM_ANDAMENTO");
confere("sem ciclo em mês fechado = sem cobrança", mensalidadeDoCiclo(null, "2026-09", "2026-10", em("2026-10-02T12:00:00Z")).situacao, "SEM_COBRANCA");
confere("OPEN = previsão pelo pendente", mensalidadeDoCiclo(ciclo({ status: "OPEN", yearMonth: "2026-10", amountPending: 150 }), "2026-10", "2026-10", em("2026-10-02T12:00:00Z")).valor, 150);
confere("CLOSED antes do dia 5 = a vencer", mensalidadeDoCiclo(ciclo({}), "2026-09", "2026-10", em("2026-10-05T20:00:00Z")).situacao, "A_VENCER");
const vencida = mensalidadeDoCiclo(ciclo({}), "2026-09", "2026-10", em("2026-10-08T15:00:00Z"));
confere("CLOSED em 08/10 = vencida há 3 dias", [vencida.situacao, vencida.diasDeAtraso], ["VENCIDA", 3]);
confere("Asaas diz OVERDUE = vencida", mensalidadeDoCiclo(ciclo({ asaasStatus: "OVERDUE" }), "2026-09", "2026-10", em("2026-10-05T12:00:00Z")).situacao, "VENCIDA");
confere("sem boleto emitido", mensalidadeDoCiclo(ciclo({ asaasPaymentId: null }), "2026-09", "2026-10", em("2026-10-08T15:00:00Z")).situacao, "SEM_BOLETO");
confere("boleto apagado no Asaas", mensalidadeDoCiclo(ciclo({ asaasStatus: "DELETED" }), "2026-09", "2026-10", em("2026-10-08T15:00:00Z")).situacao, "SEM_BOLETO");
const paga = mensalidadeDoCiclo(ciclo({ status: "PAID", amountPending: 0, paidAt: "2026-10-03T15:00:00.000Z", paidValue: 120, paidNetValue: 118.01, asaasStatus: "RECEIVED" }), "2026-09", "2026-10", em("2026-10-08T15:00:00Z"));
confere("PAID com pagamento = paga, entrou o líquido", [paga.situacao, paga.valor, paga.pago], ["PAGA", 120, 118.01]);
confere("PAID sem boleto (teste) = sem cobrança com o motivo", mensalidadeDoCiclo(ciclo({ status: "PAID", asaasPaymentId: null, amountDue: 0, amountPending: 0, notes: "Em período de teste até 20/09" }), "2026-09", "2026-10", em("2026-10-08T15:00:00Z")).motivo, "Em período de teste até 20/09");
confere("comissão de 30% sobre R$ 118,01", comissaoSobre(118.01, 30), 35.4);

console.log("\n— Referência do boleto da mensalidade —");
confere("billing:<id>", cicloDaReferencia("billing:ck123"), "ck123");
confere("pedido de insumos não é", cicloDaReferencia("ck123"), null);
confere("vazio não é", cicloDaReferencia("billing:"), null);

console.log("\n— Resumo do portal —");
const base = (id: string, extra: Partial<LojaDoRelatorio>): LojaDoRelatorio => ({
  id, nome: id, dono: "Dono", cidade: null, telefone: "22999990000", email: `${id}@x.com`, slug: null, cadastradaEm: "2026-08-01T00:00:00.000Z",
  papel: "EMBAIXADOR", percentual: 30, tambemNaCarteira: false, via: null, vendedorDaLoja: null, repasse: "CAI", isenta: false, semCpfCnpj: false,
  teste: { ativo: false, ate: null, diasRestantes: 0 }, uso: { situacao: "ATIVA", diasSemPedido: 0, pedidos7d: 10, ultimoPedidoEm: null },
  carteira: null,
  mesAtual: { ...mensalidadeDoCiclo(null, "2026-10", "2026-10", em("2026-10-08T15:00:00Z")), comissao: 0 },
  mesAnterior: { ...mensalidadeDoCiclo(null, "2026-09", "2026-10", em("2026-10-08T15:00:00Z")), comissao: 0 },
  emAberto: null, recebidoPorMes: [], ...extra,
});
const lojas = [
  base("a", { tambemNaCarteira: true, carteira: { atendimento: "AGUARDANDO", atribuidoEm: null, atendidoEm: null }, mesAtual: { ...base("x", {}).mesAtual, valor: 200, comissao: 60 }, mesAnterior: { ...paga, comissao: 35.4 }, recebidoPorMes: [{ yearMonth: "2026-09", valor: 35.4, pagoEm: "2026-10-03T15:00:00.000Z" }] }),
  base("b", { papel: "VENDEDOR", percentual: 3, mesAtual: { ...base("x", {}).mesAtual, valor: 100, comissao: 3 }, mesAnterior: { ...vencida, comissao: 3.6 }, emAberto: { valor: 120, meses: 1, vencida: true, diasDeAtraso: 3, maisAntigo: "2026-09", boletoUrl: null, comissaoParada: 3.6 }, uso: { situacao: "PARADA", diasSemPedido: 9, pedidos7d: 0, ultimoPedidoEm: null } }),
  base("c", { papel: "REDE", percentual: 3, repasse: "INDICADOR_FORA", mesAtual: { ...base("x", {}).mesAtual, valor: 100, comissao: 3 } }),
];
const r = resumirLojas(lojas, { atual: "2026-10", anterior: "2026-09", historico: ["2026-07", "2026-08", "2026-09"] }, (iso) => iso.slice(0, 7));
confere("comissão do mês só com repasse ok", r.mesAtual.comissao, 63);
confere("o que não cai fica à parte", r.mesAtual.semRepasse, 3);
confere("por papel: embaixador 60", r.mesAtual.porPapel.EMBAIXADOR.comissao, 60);
confere("mês anterior: recebido e atrasado", [r.mesAnterior.recebido, r.mesAnterior.atrasado, r.mesAnterior.lojas.pagas, r.mesAnterior.lojas.vencidas], [35.4, 3.6, 1, 1]);
confere("entrou neste mês (pago em outubro)", r.recebidoEsteMes, 35.4);
confere("média de 3 meses", r.media.valor, 11.8);
confere("nas duas = 1", r.nasDuas, 1);
confere("atenção: atrasadas, comissão parada, esperando contato, paradas", [r.atencao.atrasadas, r.atencao.comissaoParada, r.atencao.aguardandoContato, r.atencao.paradas], [1, 3.6, 1, 1]);
confere("estrutura total", [r.estrutura.TOTAL.lojas, r.estrutura.TOTAL.ativas, r.estrutura.TOTAL.paradas, r.estrutura.TOTAL.atrasadas], [3, 2, 1, 1]);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
