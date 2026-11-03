/**
 * scripts/teste-projecao-do-mes.ts — as contas da aba Projeção do admin
 * (lib/projecao-do-mes-regras.ts), sem banco.
 *
 * Pergunta do dono (12/10/2026): "a gente vai fechar quanto de mensalidade no
 * fim do mês?". A projeção usa a mesma conta do boleto (calcMensalidade).
 *
 *   npx tsx scripts/teste-projecao-do-mes.ts
 */
import {
  chanceDePagar, faixaDaVenda, mesCheioNoRitmo, projetarMes, ritmoPorDia,
  somarDias, telefoneDoWhatsapp, totaisDaProjecao, diaNoFuso,
} from "../src/lib/projecao-do-mes-regras";
import { montarMesAMes } from "../src/lib/projecao-mes-a-mes";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}${ok ? "" : ` — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`}`);
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const brt = (s: string) => new Date(`${s}-03:00`);

// Ritmo: 7 dias inteiros; quem começou dentro da janela divide pelos dias que teve.
const ini = brt("2026-10-05T00:00:00"), fim = brt("2026-10-12T00:00:00");
confere("ritmo de loja antiga = semana / 7", ritmoPorDia(7000, brt("2026-08-01T10:00:00"), ini, fim), 1000);
confere("ritmo de loja que começou há 2 dias", ritmoPorDia(4000, brt("2026-10-10T12:00:00"), ini, fim), 2000);
confere("sem venda na janela: zero", ritmoPorDia(0, brt("2026-08-01T10:00:00"), ini, fim), 0);
confere("nunca vendeu: zero", ritmoPorDia(500, null, ini, fim), 0);

// Projeção do mês: já conta + ritmo até o fim do mês.
const agora = brt("2026-10-12T12:00:00");
const fimDoMes = brt("2026-11-01T00:00:00");
const base = { mes: "2026-10", agora, fimDoMes };
const grande = projetarMes({ ...base, contaAntesDaVirada: 3000, contaDepois: 20000, porDia: 1000, inicioDaCobranca: brt("2026-10-01T00:00:00") });
confere("loja grande: base = já conta + 19,5 dias de ritmo", r2(grande.baseProjetada), 42500);
confere("loja grande: no teto", grande.mensalidade, 400);
const pequena = projetarMes({ ...base, contaAntesDaVirada: 0, contaDepois: 300, porDia: 10, inicioDaCobranca: brt("2026-10-01T00:00:00") });
confere("loja pequena: no mínimo", pequena.mensalidade, 100);
const media = projetarMes({ ...base, contaAntesDaVirada: 5000, contaDepois: 10000, porDia: 0, inicioDaCobranca: brt("2026-10-01T00:00:00") });
confere("parte antes da virada a 1%", r2(media.mensalidade), r2(5000 * 0.01 + 10000 * 0.02));
const teste = projetarMes({ ...base, contaAntesDaVirada: 0, contaDepois: 0, porDia: 500, inicioDaCobranca: brt("2026-10-22T00:00:00") });
confere("teste acaba dia 22: conta só de lá (10 dias)", r2(teste.baseProjetada), 5000);
confere("teste acaba dia 22: 2%", r2(teste.mensalidade), 100);
confere("teste o mês todo: nada", projetarMes({ ...base, contaAntesDaVirada: 0, contaDepois: 0, porDia: 900, inicioDaCobranca: null }).mensalidade, 0);
confere("sem venda nenhuma: nada", projetarMes({ ...base, contaAntesDaVirada: 0, contaDepois: 0, porDia: 0, inicioDaCobranca: brt("2026-10-01T00:00:00") }).mensalidade, 0);

// Mês cheio no ritmo.
confere("mês cheio: R$ 500/dia → 15 mil × 2%", mesCheioNoRitmo(500, "2026-11"), 300);
confere("mês cheio sem venda: zero", mesCheioNoRitmo(0, "2026-11"), 0);

// Faixas e chance.
confere("faixa grande", faixaDaVenda(10000), "GRANDE");
confere("faixa média", faixaDaVenda(2000), "MEDIA");
confere("faixa pequena", faixaDaVenda(1999), "PEQUENA");
confere("pagando e vendendo: 100%", chanceDePagar({ situacao: "PAGANDO", faixa: "PEQUENA", diasSemPedido: 1 }).chance, 1);
confere("pagando e parado 7 dias: 50%", chanceDePagar({ situacao: "PAGANDO", faixa: "GRANDE", diasSemPedido: 7 }).chance, 0.5);
confere("teste acaba, grande: 80%", chanceDePagar({ situacao: "TESTE_ACABA", faixa: "GRANDE", diasSemPedido: 0 }).chance, 0.8);
confere("mínimo sem venda: 25%", chanceDePagar({ situacao: "SO_USO", faixa: "PEQUENA", diasSemPedido: null }).chance, 0.25);

confere("totais", totaisDaProjecao([{ total: 500, chance: 1 }, { total: 400, chance: 0.8 }, { total: 100, chance: 0.25 }]),
  { garantido: 500, aposta: 845, seTodas: 1000 });

// Datas e telefone.
confere("dia em Brasília às 23h30", diaNoFuso(brt("2026-10-12T23:30:00")), "2026-10-12");
confere("somar dias vira o mês", somarDias("2026-10-30", 3), "2026-11-02");
confere("somar dias para trás", somarDias("2026-10-03", -7), "2026-09-26");
confere("telefone com DDD ganha 55", telefoneDoWhatsapp("(22) 98180-8872"), "5522981808872");
confere("telefone já com 55", telefoneDoWhatsapp("+55 86 9546-8564"), "558695468564");
confere("telefone curto: nada", telefoneDoWhatsapp("1234"), null);

// Mês a mês (Douglas, 03/11): janeiro do 1º ano até dezembro do ano atual, cada mês contra o anterior.
{
  const ciclo = (mes: string, status: string, amountDue: number, extra: Partial<{ amountPending: number; paidValue: number | null; asaasPaymentId: string | null }> = {}) =>
    ({ mes, status, amountDue, amountPending: 0, paidValue: null, asaasPaymentId: "pay_1", ...extra });
  const mm = montarMesAMes({
    vendas: [
      { mes: "2026-09", vendas: 100_000, pedidos: 2000, lojas: 20 },
      { mes: "2026-10", vendas: 150_000, pedidos: 2500, lojas: 30 },
      { mes: "2026-11", vendas: 20_000, pedidos: 300, lojas: 28 },
    ],
    ciclos: [
      ciclo("2026-09", "PAID", 1000, { paidValue: 990 }),
      ciclo("2026-09", "PAID", 0, { asaasPaymentId: null }), // nada a cobrar (teste)
      ciclo("2026-09", "FORGIVEN", 300),
      ciclo("2026-10", "PAID", 700),
      ciclo("2026-10", "CLOSED", 1500, { amountPending: 1300 }),
    ],
    mesAtual: "2026-11",
    atual: { vendasPrevistas: 180_000, pedidosPrevistos: 3000, seTodas: 4000, aposta: 3500, boletos: 40 },
  });
  confere("12 meses do ano, de janeiro a dezembro", [mm.length, mm[0].mes, mm[11].mes], [12, "2026-01", "2026-12"]);
  const set = mm.find((x) => x.mes === "2026-09")!, out = mm.find((x) => x.mes === "2026-10")!, nov = mm.find((x) => x.mes === "2026-11")!;
  confere("setembro: pago pelo valor pago; sem boleto e perdoado fora do valor", [set.mensalidade, set.recebido, set.boletos, set.perdoadas], [990, 990, 1, 1]);
  confere("outubro: pago + em aberto", [out.mensalidade, out.recebido, out.emAberto, out.boletos, out.lojasPagas], [2000, 700, 1300, 2, 1]);
  confere("outubro contra setembro", [r2(out.variacao.vendas!), r2(out.variacao.pedidos!), r2(out.variacao.mensalidade!)], [0.5, 0.25, 1.02]);
  confere("novembro compara pelo previsto, não pelo até agora", [r2(nov.variacao.vendas!), r2(nov.variacao.pedidos!), r2(nov.variacao.mensalidade!)], [0.2, 0.2, 1]);
  confere("novembro: até agora e previsto lado a lado", [nov.tipo, nov.vendas, nov.vendasPrevistas, nov.aposta, nov.boletos], ["atual", 20_000, 180_000, 3500, 40]);
  confere("dezembro é futuro, sem comparação", [mm[11].tipo, mm[11].variacao.vendas], ["futuro", null]);
  confere("agosto sem venda: setembro sem base", set.variacao.vendas, null);
  confere("dois anos: começa no janeiro do primeiro",
    montarMesAMes({ vendas: [{ mes: "2025-11", vendas: 1, pedidos: 1, lojas: 1 }], ciclos: [], mesAtual: "2026-02",
      atual: { vendasPrevistas: 0, pedidosPrevistos: 0, seTodas: 0, aposta: 0, boletos: 0 } }).length, 24);
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
