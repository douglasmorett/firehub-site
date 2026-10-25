/**
 * scripts/teste-ranking-de-entregadores.ts — as medidas e o score do ranking
 * (lib/relatorios/ranking-de-entregadores.ts), com pedidos montados à mão.
 *
 *   npx tsx scripts/teste-ranking-de-entregadores.ts
 */
import { notaDeTempo, rankingDeEntregadores, type PedidoDoRanking } from "../src/lib/relatorios/ranking-de-entregadores";

let falhas = 0;
const conferir = (nome: string, ok: boolean, detalhe?: unknown) => {
  if (ok) console.log(`  ok  ${nome}`);
  else { falhas++; console.log(`  FALHOU  ${nome}`, detalhe ?? ""); }
};

// 24/10/2026 19:00 em São Paulo = 22:00Z.
const base = Date.parse("2026-10-24T22:00:00.000Z");
const t = (min: number) => new Date(base + min * 60_000).toISOString();
let seq = 0;
const pedido = (motoboyId: string, p: Partial<PedidoDoRanking>): PedidoDoRanking => ({
  id: `p${++seq}`, motoboyId, status: "ENTREGUE", createdAt: t(0), deliveryType: "DELIVERY", tempoEntregaMin: 50, ...p,
});

console.log("— Um motoboy: entrega, coleta, prazo, viagens e volta —");
const ana: PedidoDoRanking[] = [
  // Viagem 1: dois pedidos que saíram juntos (2 min de diferença), prontos às 10 e 12.
  pedido("ana", { readyAt: t(10), dispatchedAt: t(14), deliveredAt: t(24), deliveryDistance: 2 }),
  pedido("ana", { readyAt: t(12), dispatchedAt: t(16), deliveredAt: t(30), deliveryDistance: 3 }),
  // Viagem 2: pegou (puxou) 8 min depois da última entrega da viagem 1, saiu 1 min depois.
  pedido("ana", { readyAt: t(25), motoboyPuxadoEm: t(38), dispatchedAt: t(39), deliveredAt: t(49) }),
  // Viagem 3: 12 min depois; entregue atrasado (criado em 0 + 50 = prazo 50; chegou 70).
  pedido("ana", { readyAt: t(55), dispatchedAt: t(61), deliveredAt: t(70) }),
  // Cancelado DEPOIS de sair com ela: conta. Cancelado antes de sair: não conta.
  pedido("ana", { status: "CANCELADO", dispatchedAt: t(80), cancelledAt: t(90) }),
  pedido("ana", { status: "CANCELADO", cancelledAt: t(5) }),
];
const r1 = rankingDeEntregadores(ana, [{ id: "ana", name: "Ana" }], "America/Sao_Paulo");
const a = r1.linhas[0];
conferir("4 entregas", a.entregas === 4, a.entregas);
conferir("1 cancelado com ela (o de antes de sair não)", a.canceladas === 1, a.canceladas);
conferir("conclusão 80%", a.conclusaoPct === 80, a.conclusaoPct);
// Entregas: 10, 14, 10, 9 → mediana 10
conferir("entrega mediana 10 min", a.entregaMedianaMin === 10, a.entregaMedianaMin);
// Coletas: 4, 4, 14, 6 → mediana 5
conferir("coleta mediana 5 min", a.coletaMedianaMin === 5, a.coletaMedianaMin);
// Viagens: [14,16], [39], [61], [80 cancelado] → 3 com entrega
conferir("3 viagens com entrega", a.viagens === 3, a.viagens);
// Voltas: fim 30 → puxou 38 = 8; fim 49 → saiu 61 = 12; fim 70 → saiu 80 (cancelado) = 10 → mediana 10
conferir("volta mediana 10 min (8, 12, 10)", a.voltaMedianaMin === 10, a.voltaMedianaMin);
conferir("3 voltas medidas", a.voltas === 3, a.voltas);
conferir("1 atrasada de 4 com prazo → 75% no prazo", a.noPrazoPct === 75 && a.atrasadas === 1 && a.comPrazo === 4, a);
conferir("atraso médio 20 min", a.atrasoMedioMin === 20, a.atrasoMedioMin);
conferir("km 5", a.km === 5, a.km);
conferir("1 dia trabalhado", a.dias === 1, a.dias);

console.log("— Volta acima de 60 min é pausa: não entra —");
const bia = [
  pedido("bia", { dispatchedAt: t(0), deliveredAt: t(10) }),
  pedido("bia", { dispatchedAt: t(100), deliveredAt: t(110) }),
  pedido("bia", { dispatchedAt: t(115), deliveredAt: t(125) }),
];
const b = rankingDeEntregadores(bia, [{ id: "bia", name: "Bia" }], "America/Sao_Paulo").linhas[0];
conferir("só a volta de 5 min conta", b.voltas === 1 && b.voltaMedianaMin === 5, b);

console.log("— Mesma rota é uma viagem só, mesmo saindo com 20 min de diferença —");
const caio = [
  pedido("caio", { routeId: "r1", dispatchedAt: t(0), deliveredAt: t(10) }),
  pedido("caio", { routeId: "r1", dispatchedAt: t(20), deliveredAt: t(30) }),
];
conferir("1 viagem", rankingDeEntregadores(caio, [{ id: "caio", name: "Caio" }], null).linhas[0].viagens === 1);

console.log("— Nota de tempo contra a equipe —");
conferir("igual à equipe = 100", notaDeTempo(10, 10) === 100);
conferir("melhor que a equipe = 100", notaDeTempo(5, 10) === 100);
conferir("1,5× a equipe = 50", notaDeTempo(15, 10) === 50);
conferir("o dobro = 0", notaDeTempo(20, 10) === 0);
conferir("sem dado = nulo", notaDeTempo(null, 10) === null);

console.log("— Score, posição e quem tem poucas entregas —");
const rapido = [0, 30, 60].map((m) => pedido("r", { readyAt: t(m), dispatchedAt: t(m + 2), deliveredAt: t(m + 8) }));
const lento = [0, 30, 60].map((m) => pedido("l", { readyAt: t(m), dispatchedAt: t(m + 10), deliveredAt: t(m + 40) }));
const novato = [pedido("n", { dispatchedAt: t(0), deliveredAt: t(5) })];
const r2 = rankingDeEntregadores([...lento, ...rapido, ...novato],
  [{ id: "r", name: "Rápido" }, { id: "l", name: "Lento" }, { id: "n", name: "Novato" }], "America/Sao_Paulo");
const [p1, p2, p3] = r2.linhas;
conferir("o rápido em 1º", p1.nome === "Rápido" && p1.posicao === 1, r2.linhas.map((l) => [l.nome, l.score]));
conferir("o lento em 2º com score menor", p2.nome === "Lento" && p2.posicao === 2 && (p2.score ?? 0) < (p1.score ?? 0), p2);
conferir("o novato sem posição e sem score (1 entrega)", p3.nome === "Novato" && p3.posicao == null && p3.score == null, p3);
conferir("destaque 'Entrega mais rápida' é do rápido", r2.destaques.find((d) => d.chave === "entrega")?.nome === "Rápido", r2.destaques);
conferir("equipe: 7 entregas", r2.equipe.entregas === 7, r2.equipe);

console.log("— Pedido sem motoboy fica de fora —");
conferir("ninguém", rankingDeEntregadores([pedido("", { motoboyId: null })], [], null).linhas.length === 0);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
