// O "(5 min)" ao lado da etapa no cartão do painel (lib/tempo-na-etapa.ts).
//   npx tsx scripts/teste-tempo-na-etapa.ts
import { mesmosCarimbos, tempoNaEtapa, textoDoTempo, type PedidoComCarimbos } from "../src/lib/tempo-na-etapa";

let falhas = 0;
const ok = (cond: boolean, nome: string, detalhe?: unknown) => {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}${cond ? "" : ` → ${JSON.stringify(detalhe)}`}`);
};

// O exemplo do Lucas: chegou 10:01, pronto 10:04, motoboy saiu 10:07.
const em = (hhmm: string) => new Date(`2026-10-13T${hhmm}:00-03:00`);
const p = (status: string, extra: Record<string, unknown> = {}) => ({
  status, deliveryType: "DELIVERY", kdsStage: null as string | null, createdAt: em("10:01"), ...extra,
});
const minutos = (o: PedidoComCarimbos, agora: string) => tempoNaEtapa(o, em(agora))?.minutos ?? null;

// ── uma etapa de cada vez, o relógio zerando a cada troca ──
const aceito = p("ACEITO", { acceptedAt: em("10:01"), kdsProductionAt: em("10:01") });
ok(minutos(aceito, "10:06") === 5, "em produção desde 10:01, às 10:06 → 5 min", tempoNaEtapa(aceito, em("10:06")));
ok(tempoNaEtapa(aceito, em("10:06"))?.rotulo === "Em produção", "rótulo da produção");
const pronto = p("PRONTO", { acceptedAt: em("10:01"), readyAt: em("10:04") });
ok(minutos(pronto, "10:04") === 0 && minutos(pronto, "10:06") === 2, "pronto 10:04: zera e conta de novo");
const saiu = p("SAIU_ENTREGA", { acceptedAt: em("10:01"), readyAt: em("10:04"), dispatchedAt: em("10:07") });
ok(minutos(saiu, "10:10") === 3, "saiu 10:07, às 10:10 → o motoboy saiu há 3 min");
ok(tempoNaEtapa(saiu, em("10:10"))?.rotulo === "Saiu para entrega" && tempoNaEtapa(saiu, em("10:10"))?.curto === "Saiu", "rótulos da saída");
const entregue = p("ENTREGUE", { dispatchedAt: em("10:07"), deliveredAt: em("10:25") });
ok(minutos(entregue, "10:45") === 20, "finalizado 10:25, às 10:45 → finalizado há 20 min");
ok(tempoNaEtapa(entregue, em("10:45"))?.rotulo === "Finalizado", "rótulo do finalizado");

// ── os sinônimos das plataformas caem na mesma etapa ──
ok(tempoNaEtapa(p("EM_PREPARO", { acceptedAt: em("10:02") }), em("10:05"))?.etapa === "producao", "EM_PREPARO é produção");
ok(tempoNaEtapa(p("SAIU_PARA_ENTREGA", { dispatchedAt: em("10:02") }), em("10:05"))?.etapa === "saiu", "SAIU_PARA_ENTREGA é saída");
ok(tempoNaEtapa(p("preparando", { acceptedAt: em("10:02") }), em("10:05"))?.etapa === "producao", "status em minúsculas também");

// ── sem carimbo, sem parêntese ──
ok(tempoNaEtapa(p("SAIU_ENTREGA"), em("10:30")) === null, "saiu sem dispatchedAt (pedido antigo) → nada");
ok(tempoNaEtapa(p("ENTREGUE", { dispatchedAt: em("10:07") }), em("10:30")) === null, "entregue sem deliveredAt → nada (não usa a saída no lugar)");
ok(tempoNaEtapa(p("ACEITO"), em("10:30")) === null, "produção sem aceite nem KDS → nada (não usa a chegada)");
ok(tempoNaEtapa(p("PRONTO"), em("10:30")) === null, "pronto sem readyAt → nada");
ok(tempoNaEtapa(p("SAIU_ENTREGA", { dispatchedAt: "não é data" }), em("10:30")) === null, "carimbo inválido → nada");

// ── etapas sem relógio próprio ──
for (const s of ["NOVO", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO", "CANCELADO", "ENCERRADO"]) {
  ok(tempoNaEtapa(p(s, { acceptedAt: em("10:02"), dispatchedAt: em("10:03"), deliveredAt: em("10:04") }), em("10:30")) === null, `${s} → nada`);
}

// ── o aceite regravado não zera a produção ──
// A primeira baixa do KDS passa ACEITO → PREPARANDO e regrava o acceptedAt;
// o kdsProductionAt (entrada na cozinha) segura o relógio.
const regravado = p("PREPARANDO", { kdsStage: "FINISHING", kdsProductionAt: em("10:01"), acceptedAt: em("10:09") });
ok(minutos(regravado, "10:12") === 11, "aceite regravado às 10:09 na baixa: continua contando de 10:01", tempoNaEtapa(regravado, em("10:12")));
ok(minutos(p("ACEITO", { acceptedAt: em("10:03") }), "10:08") === 5, "sem KDS: vale o aceite");
ok(minutos(p("PREPARANDO", { kdsProductionAt: em("10:04") }), "10:08") === 4, "sem aceite gravado: vale a entrada na cozinha");
// O pedido do site ganha kdsProductionAt na CRIAÇÃO, mesmo esperando aceite.
const doSite = p("ACEITO", { kdsStage: "PRODUCTION", kdsProductionAt: em("10:01"), acceptedAt: em("10:06") });
ok(minutos(doSite, "10:08") === 2, "site aceito às 10:06 (chegou 10:01): produção conta do aceite, não da chegada", tempoNaEtapa(doSite, em("10:08")));
// Agendado antecipado (scheduledDatetime apagado): kdsProductionAt é de ontem.
const antecipado = p("PREPARANDO", {
  kdsStage: "FINISHING", createdAt: new Date("2026-10-12T20:00:00-03:00"),
  kdsProductionAt: new Date("2026-10-12T20:00:00-03:00"), acceptedAt: em("10:20"),
});
ok(minutos(antecipado, "10:25") === 5, "agendado antecipado, KDS de ontem: vale o aceite, nunca 14 h", tempoNaEtapa(antecipado, em("10:25")));

// ── o selo "Pronto Cozinha" já é pronto ──
const prontoKds = p("PREPARANDO", { kdsStage: "FINISHED", kdsProductionAt: em("10:01"), acceptedAt: em("10:01"), readyAt: em("10:15") });
ok(tempoNaEtapa(prontoKds, em("10:18"))?.etapa === "pronto" && minutos(prontoKds, "10:18") === 3, "KDS finalizou a entrega às 10:15 → Pronto (3 min)");
ok(tempoNaEtapa(p("PREPARANDO", { kdsStage: "FINISHED", acceptedAt: em("10:01") }), em("10:18")) === null,
  "selo de pronto sem readyAt → nada (não volta para o relógio da produção)");

// ── retirada: SAIU_ENTREGA é o pronto do KDS ──
const retirada = p("SAIU_ENTREGA", { deliveryType: "RETIRADA", readyAt: em("10:20"), dispatchedAt: em("10:20") });
const r = tempoNaEtapa(retirada, em("10:24"));
ok(r?.rotulo === "Pronto" && r?.minutos === 4, "retirada finalizada no KDS → Pronto (4 min)", r);

// ── agendado e mesa: o carimbo da produção não mede a cozinha ──
const agendado = p("ACEITO", {
  createdAt: em("08:00"), acceptedAt: em("08:00"), kdsProductionAt: em("08:00"),
  scheduledDatetime: em("19:30"), agendado: true,
});
ok(tempoNaEtapa(agendado, em("19:00")) === null, "agendado de manhã para 19:30 → sem relógio de produção");
ok(tempoNaEtapa({ ...agendado, status: "SAIU_ENTREGA", dispatchedAt: em("19:10") }, em("19:15"))?.minutos === 5,
  "o mesmo agendado, já na rua → Saiu (5 min)");
const previsao = p("ACEITO", { acceptedAt: em("10:02"), scheduledDatetime: em("10:50") });
ok(minutos(previsao, "10:07") === 5, "previsão de entrega do iFood (50 min) não é agendamento");
ok(tempoNaEtapa(p("PREPARANDO", { deliveryType: "MESA", acceptedAt: em("10:02") }), em("11:30")) === null, "mesa em preparo → sem relógio");
ok(tempoNaEtapa(p("PREPARANDO", { deliveryType: "MESA", kdsStage: "FINISHED", readyAt: em("11:00") }), em("11:30"))?.minutos === 30,
  "mesa com o pronto do KDS → Pronto (30 min)");

// ── relógio e texto ──
ok(minutos(saiu, "10:06") === 0, "PC atrasado em relação ao servidor → 0, nunca negativo");
ok(minutos(saiu, "10:07") === 0 && minutos({ ...saiu, dispatchedAt: "2026-10-13T13:07:00.000Z" }, "10:08") === 1, "carimbo em texto ISO (o poll) funciona como Date");
ok(textoDoTempo(0) === "0 min" && textoDoTempo(5) === "5 min" && textoDoTempo(59) === "59 min", "minutos: '5 min'");
ok(textoDoTempo(60) === "1h0min" && textoDoTempo(72) === "1h12min", "horas: '1h12min', como o cartão");

// ── a comparação do poll ──
ok(mesmosCarimbos({ dispatchedAt: em("10:07") }, { dispatchedAt: em("10:07").toISOString() }), "Date e ISO do mesmo instante são iguais");
ok(!mesmosCarimbos({ status: "SAIU_ENTREGA" } as any, { status: "SAIU_ENTREGA", dispatchedAt: em("10:07") } as any), "carimbo que chegou depois do status conta como mudança");
ok(mesmosCarimbos({ readyAt: null }, {}), "nulo e ausente são iguais");

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
