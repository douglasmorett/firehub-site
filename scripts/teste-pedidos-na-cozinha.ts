// O número da extensão de prazo (lib/pedidos-na-cozinha.ts): o que conta e a janela do quadro.
//   npx tsx scripts/teste-pedidos-na-cozinha.ts
import {
  contaNoPrazo,
  contarPedidosDoPrazo,
  dataDoPedido,
  inicioDaJanelaDoQuadro,
} from "../src/lib/pedidos-na-cozinha";

let falhas = 0;
const ok = (cond: boolean, nome: string, detalhe?: unknown) => {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}${cond ? "" : ` → ${JSON.stringify(detalhe)}`}`);
};

const agora = new Date("2026-10-02T23:30:00Z"); // 20:30 em Brasília
const inicioDoDia = new Date("2026-10-02T03:00:00Z"); // 00:00 em Brasília
const minAtras = (m: number) => new Date(agora.getTime() - m * 60000);
const p = (status: string, extra: Record<string, unknown> = {}) => ({
  status, deliveryType: "DELIVERY", kdsStage: null as string | null, createdAt: minAtras(20), ...extra,
});

// ── o que conta ──
ok(contaNoPrazo(p("ACEITO")) && contaNoPrazo(p("PREPARANDO")), "aceito e em preparo contam");
ok(contaNoPrazo(p("PREPARANDO", { kdsStage: "FINISHED" })) && contaNoPrazo(p("PRONTO")),
  "pronto esperando o motoboy conta (KDS finalizado ou entrega PRONTO)");
ok(contaNoPrazo(p("ACEITO", { deliveryType: "RETIRADA" })), "retirada ainda na chapa conta");
ok(!contaNoPrazo(p("PRONTO", { deliveryType: "RETIRADA" })), "retirada pronta (Finalizado no quadro, sem motoboy) não conta");
ok(!contaNoPrazo(p("NOVO")) && !contaNoPrazo(p("CRIANDO_IA")), "novo e rascunho do robô não contam");
ok(!contaNoPrazo(p("SAIU_ENTREGA")) && !contaNoPrazo(p("ENTREGUE")) && !contaNoPrazo(p("CANCELADO")), "saiu, entregue e cancelado não contam");

// ── janela do quadro ──
const desde = inicioDaJanelaDoQuadro(agora, inicioDoDia, null);
ok(desde.getTime() === inicioDoDia.getTime(), "20:30 sem caixa: a meia-noite (mais cedo que 12 h atrás)", desde);
const caixa = new Date("2026-10-02T01:00:00Z"); // aberto ontem às 22h
ok(inicioDaJanelaDoQuadro(agora, inicioDoDia, caixa).getTime() === caixa.getTime(), "caixa aberto ontem: vale a abertura do caixa");
ok(inicioDaJanelaDoQuadro(agora, inicioDoDia, new Date("2026-10-02T21:00:00Z")).getTime() === inicioDoDia.getTime(), "caixa aberto hoje às 18h: a meia-noite continua valendo");
const madrugada = new Date("2026-10-03T05:00:00Z"); // 02:00 em Brasília
ok(inicioDaJanelaDoQuadro(madrugada, new Date("2026-10-03T03:00:00Z"), null).getTime() === new Date("2026-10-02T17:00:00Z").getTime(),
  "02h sem caixa: 12 h atrás, não a meia-noite que acabou de passar");

// ── agendado de verdade × previsão de entrega ──
const previsao = p("ACEITO", { createdAt: minAtras(30), scheduledDatetime: new Date(agora.getTime() + 40 * 60000) });
ok(dataDoPedido(previsao).getTime() === minAtras(30).getTime(), "previsão de entrega do canal: vale a criação");
const deOntem = p("ACEITO", { createdAt: new Date("2026-10-01T15:00:00Z"), scheduledDatetime: new Date("2026-10-02T22:00:00Z") });
ok(dataDoPedido(deOntem).getTime() === new Date("2026-10-02T22:00:00Z").getTime(), "agendado ontem para hoje: vale o agendamento");

// ── a conta inteira: a Hakim às 20:30 de 02/10 (quadro mandava 4, API 9) ──
const fila = [
  p("PREPARANDO", { kdsStage: "PRODUCTION" }), p("PREPARANDO", { kdsStage: "PRODUCTION" }),
  p("ACEITO"), p("ACEITO"),
  p("PREPARANDO", { kdsStage: "FINISHED" }), p("PREPARANDO", { kdsStage: "FINISHED" }), p("PREPARANDO", { kdsStage: "FINISHED" }),
  p("PRONTO"), p("PRONTO"),
  p("NOVO"), p("SAIU_ENTREGA"), p("ENTREGUE"), p("CANCELADO"),
  p("PRONTO", { deliveryType: "RETIRADA" }),
  p("ACEITO", { createdAt: new Date("2026-10-01T20:00:00Z") }), // esquecido ontem às 17h: fora do quadro
  deOntem,
];
const n = contarPedidosDoPrazo(fila, desde);
ok(n === 10, "4 na chapa + 3 do KDS + 2 entregas prontas + o agendado = 10", n);

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
