/**
 * Trava os RECEBÍVEIS (lib/relatorios/recebiveis.ts) — a base do Contas a
 * receber e do Fluxo de caixa: o prazo de cada forma (padrão e cadastrado), o
 * dia útil do cartão, a taxa da maquininha pela média das bandeiras, o repasse
 * do app pela comissão (com o pago na porta ao motoboy DA LOJA ficando com a
 * loja), o pago online no site, a mesa sem o troco, o fiado fora, e a soma do
 * Contas a receber por dia e por forma.
 *
 *   npx tsx scripts/teste-contas-a-receber.ts
 *
 * "Hoje" = terça 03/11/2026. Horários em UTC; a loja em America/Sao_Paulo (−03).
 */
import { contasAReceber, diaQueCai, lerPrazosDeRecebimento, recebiveisDasVendas } from "../src/lib/relatorios/recebiveis";
import type { PedidoDaPlataforma } from "../src/lib/relatorios/plataformas";
import type { MesaParaFormas } from "../src/lib/relatorios/formas-de-pagamento";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const TZ = "America/Sao_Paulo";
const HOJE = "2026-11-03";
let seq = 0;
const p = (x: Partial<PedidoDaPlataforma> & { createdAt: string; totalAmount: number }): PedidoDaPlataforma => ({
  id: `p${++seq}`, franchiseeId: "loja", status: "ENTREGUE", deliveryType: "DELIVERY", items: [{ quantity: 1, price: x.totalAmount }], ...x,
} as PedidoDaPlataforma);

// ── Prazos ──
const prazosPadrao = lerPrazosDeRecebimento(null);
confere("padrão: crédito 30, débito 1, Pix 0, dinheiro 0, iFood 7", [prazosPadrao.dias.CREDITO, prazosPadrao.dias.DEBITO, prazosPadrao.dias.PIX, prazosPadrao.dias.DINHEIRO, prazosPadrao.dias.IFOOD], [30, 1, 0, 0, 7]);
confere("nada cadastrado", prazosPadrao.cadastradas, []);
const prazos = lerPrazosDeRecebimento({ meta: 1, prazosDeRecebimento: { VALE: 15, CREDITO: "abc", DEBITO: -1, PIX: 500 } });
confere("só o válido vale: vale 15; crédito torto, débito negativo e Pix 500 caem no padrão", [prazos.dias.VALE, prazos.dias.CREDITO, prazos.dias.DEBITO, prazos.dias.PIX, prazos.cadastradas], [15, 30, 1, 0, ["VALE"]]);
confere("débito de sábado (D+1 = domingo) cai na segunda", diaQueCai("2026-10-31", 1, "DEBITO"), "2026-11-02");
confere("Pix de sábado cai no sábado (não espera dia útil)", diaQueCai("2026-10-31", 0, "PIX"), "2026-10-31");
confere("crédito de sexta 30/10 + 30 = domingo 29/11 → segunda 30/11", diaQueCai("2026-10-30", 30, "CREDITO"), "2026-11-30");

// ── As vendas ──
const PAYMENT_FEES = {
  CREDITO: { rate: 3, brands: [] },
  DEBITO: { rate: 0, brands: [{ name: "Visa", rate: 1, active: true }, { name: "Master", rate: 2, active: true }, { name: "Elo", rate: 9, active: false }] },
  PIX: { rate: 0 },
};
const PEDIDOS: PedidoDaPlataforma[] = [
  // Sexta 30/10, 17h: crédito no balcão, R$ 100, taxa 3%.
  p({ createdAt: "2026-10-30T20:00:00Z", totalAmount: 100, source: "PDV", paymentMethod: "Cartão Crédito" }),
  // Sábado 31/10: débito R$ 50 (média das bandeiras ATIVAS: 1,5%).
  p({ createdAt: "2026-10-31T21:00:00Z", totalAmount: 50, source: "PDV", paymentMethod: "Cartão Débito" }),
  // Segunda 02/11: Pix R$ 20 (sem taxa) e vale R$ 30 (prazo cadastrado 15; taxa NÃO cadastrada).
  p({ createdAt: "2026-11-02T20:00:00Z", totalAmount: 20, source: "PDV", paymentMethod: "Pix" }),
  p({ createdAt: "2026-11-02T20:10:00Z", totalAmount: 30, source: "PDV", paymentMethod: "Vale-refeição" }),
  // Fiado: não vira dinheiro.
  p({ createdAt: "2026-11-02T20:20:00Z", totalAmount: 25, source: "PDV", paymentMethod: "Fiado" }),
  // Site pago online por Pix: prazo "Site" (D+1, segunda → terça), sem taxa.
  p({ createdAt: "2026-11-02T21:00:00Z", totalAmount: 45, source: "SITE", paymentMethod: "Pix (Pago Online)", paymentPaidAt: "2026-11-02T21:00:00Z" }),
  // iFood pago no app, R$ 60, entrega da loja: comissão 20% sobre os itens.
  p({ createdAt: "2026-11-02T22:00:00Z", totalAmount: 60, source: "IFOOD", ifoodOrderId: "if1", paymentMethod: "Crédito (Pago Online)", deliveryBy: "MERCHANT" } as any),
  // iFood pago em DINHEIRO ao motoboy da loja, R$ 40: o dinheiro é da loja
  // (D+0), e a comissão dele (R$ 8) sai do repasse.
  p({ createdAt: "2026-11-02T22:30:00Z", totalAmount: 40, source: "IFOOD", ifoodOrderId: "if2", paymentMethod: "Dinheiro", deliveryBy: "MERCHANT" } as any),
  // Cancelado e reposição: não são dinheiro.
  p({ createdAt: "2026-11-02T23:00:00Z", totalAmount: 99, source: "PDV", paymentMethod: "Pix", status: "CANCELADO" }),
  // Pedido de mesa: paga na conta (abaixo), não aqui.
  p({ id: "m1a", createdAt: "2026-11-02T23:30:00Z", totalAmount: 40, source: "PRESENCIAL", tableSessionId: "m1", paymentMethod: "N/A" }),
];
// A mesa fechou na segunda com R$ 50 em dinheiro para R$ 40 de consumo + R$ 4 de serviço: R$ 6 de troco.
const MESAS: MesaParaFormas[] = [{
  id: "m1", fechadaEm: "2026-11-03T00:30:00Z", totalPago: 50, taxaDeServico: 4, gorjeta: 0,
  pagamentos: [{ method: "Dinheiro", amount: 50 }], pedidos: [{ id: "m1a", totalAmount: 40, status: "ENTREGUE" }],
}];

const r = recebiveisDasVendas(PEDIDOS, MESAS, { tz: TZ, prazos, paymentFees: PAYMENT_FEES, comissoes: { IFOOD: 20 } });
const de = (chave: string, diaDaVenda: string) => r.recebiveis.find((x) => x.chave === chave && x.diaDaVenda === diaDaVenda);
const resumo = (x: ReturnType<typeof de>) => x && { dia: x.dia, bruto: x.bruto, taxaPct: x.taxaPct, taxa: x.taxa, liquido: x.liquido, prazoPadrao: x.prazoPadrao };

confere("crédito: cai 30/11, R$ 100 − 3% = R$ 97", resumo(de("CREDITO", "2026-10-30")), { dia: "2026-11-30", bruto: 100, taxaPct: 3, taxa: 3, liquido: 97, prazoPadrao: true });
confere("débito: cai segunda 02/11, 1,5% (média das ativas)", resumo(de("DEBITO", "2026-10-31")), { dia: "2026-11-02", bruto: 50, taxaPct: 1.5, taxa: 0.75, liquido: 49.25, prazoPadrao: true });
confere("Pix no dia, sem taxa", resumo(de("PIX", "2026-11-02")), { dia: "2026-11-02", bruto: 20, taxaPct: 0, taxa: 0, liquido: 20, prazoPadrao: true });
confere("vale: prazo cadastrado (15 dias, terça 17/11), taxa não cadastrada", resumo(de("VALE", "2026-11-02")), { dia: "2026-11-17", bruto: 30, taxaPct: null, taxa: 0, liquido: 30, prazoPadrao: false });
confere("site pago online: D+1, sem taxa", resumo(de("SITE", "2026-11-02")), { dia: "2026-11-03", bruto: 45, taxaPct: 0, taxa: 0, liquido: 45, prazoPadrao: true });
confere("dinheiro da segunda: R$ 40 do iFood na porta + R$ 44 da mesa (R$ 50 − R$ 6 de troco)", resumo(de("DINHEIRO", "2026-11-02")), { dia: "2026-11-02", bruto: 84, taxaPct: 0, taxa: 0, liquido: 84, prazoPadrao: true });
confere("iFood: R$ 60 pago no app − 20% de R$ 100 de itens = repasse R$ 40, segunda + 7", resumo(de("IFOOD", "2026-11-02")), { dia: "2026-11-09", bruto: 60, taxaPct: 20, taxa: 20, liquido: 40, prazoPadrao: true });
confere("fiado fica fora, contado", r.fora, [{ chave: "FIADO", rotulo: "Fiado / conta funcionário", quantidade: 1, valor: 25 }]);
confere("vale sem taxa cadastrada é avisado", r.semTaxa, ["Vale-refeição"]);
confere("iFood com comissão: nada a avisar", r.semComissao, []);
confere("cancelado não vira recebível (nenhum Pix de R$ 99)", r.recebiveis.some((x) => x.bruto === 99), false);

// Sem a comissão do iFood: o repasse entra sem descontá-la, e a tela avisa.
const semCom = recebiveisDasVendas(PEDIDOS, [], { tz: TZ, prazos, paymentFees: PAYMENT_FEES, comissoes: {} });
const ifSem = semCom.recebiveis.find((x) => x.chave === "IFOOD");
confere("sem comissão: líquido = bruto, % nulo, avisado", [ifSem?.liquido, ifSem?.taxaPct, semCom.semComissao], [60, null, ["iFood"]]);

// ── O Contas a receber de novembro ──
const nov = contasAReceber(r.recebiveis, { de: "2026-11-01", ate: "2026-11-30", hoje: HOJE });
confere("30 dias, um por dia", nov.dias.length, 30);
confere("02/11 (já caiu): débito 49,25 + Pix 20 + dinheiro 84", [nov.dias[1].liquido, nov.dias[1].jaCaiu], [153.25, true]);
confere("03/11 (hoje) ainda não conta como caído: o site, R$ 45", [nov.dias[2].liquido, nov.dias[2].jaCaiu], [45, false]);
confere("total líquido de novembro (o crédito de 30/10 cai em 30/11)", nov.total.liquido, 49.25 + 20 + 84 + 45 + 40 + 30 + 97);
confere("já caiu × a cair", [nov.total.jaCaiu, nov.total.aCair], [153.25, 212]);
confere("por forma, na ordem do caixa e o app no fim", nov.porForma.map((f) => f.chave), ["DINHEIRO", "PIX", "DEBITO", "CREDITO", "VALE", "SITE", "IFOOD"]);
confere("taxa do mês: 0,75 + 3 + 20", nov.total.taxa, 23.75);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
process.exit(falhas ? 1 : 0);
