/**
 * Trava o Ticket médio (lib/relatorios/ticket-medio.ts): por dia e por
 * garçom, faturamento, atendimentos, pessoas, ticket por atendimento, ticket
 * por pessoa e P.A.
 *
 *   npx tsx scripts/teste-ticket-medio.ts
 *
 * Dados sintéticos de dois dias. Confere a conta de mão, que o faturamento e
 * os atendimentos são os da régua única (`atendimentosDaVenda`, a mesma do
 * Faturamento por dia), que as linhas por dia e por garçom somam o total, e
 * que pessoa só existe onde alguém informou.
 */
import { FORA_DO_SALAO, MESA_SEM_GARCOM, ticketMedioDoPeriodo, type ContaDoTicket, type PedidoDoTicket } from "../src/lib/relatorios/ticket-medio";
import { atendimentosDaVenda, cent, reais, ticketMedio } from "../src/lib/relatorios/regua-da-venda";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const SP = "America/Sao_Paulo";
const h = (dia: string, hora: string) => `${dia}T${hora}:00-03:00`;
let seq = 0;
const pedido = (createdAt: string, totalAmount: number, itens: number[], extra: Partial<PedidoDoTicket> = {}): PedidoDoTicket => ({
  id: `p${String(++seq).padStart(2, "0")}`, createdAt, status: "ENTREGUE", totalAmount, items: itens.map((q) => ({ quantity: q, price: 1 })), ...extra,
});

// Dia 07/11 (sábado) e 08/11 (domingo).
const pedidos: PedidoDoTicket[] = [
  // Mesa A (Ana, 4 pessoas): duas rodadas no dia 07 e a saideira à 1h do dia 08 — ainda é o expediente de 07.
  pedido(h("2026-11-07", "19:00"), 100, [2, 1], { tableSessionId: "A" }),
  pedido(h("2026-11-07", "20:00"), 60, [2], { tableSessionId: "A" }),
  pedido(h("2026-11-08", "01:00"), 40, [1], { tableSessionId: "A" }),
  // Mesa B (Ana, sem nº de pessoas).
  pedido(h("2026-11-07", "21:00"), 90, [3], { tableSessionId: "B" }),
  // Mesa C (Beto, 2 pessoas nomeadas), no dia 08.
  pedido(h("2026-11-08", "12:00"), 80, [2], { tableSessionId: "C" }),
  // Mesa D (sem garçom, 3 pessoas digitadas): lançou às 23h do dia 07 e de novo às 12h do dia 08 (outro expediente).
  pedido(h("2026-11-07", "23:00"), 30, [1], { tableSessionId: "D" }),
  pedido(h("2026-11-08", "12:30"), 30, [1], { tableSessionId: "D" }),
  // Fora do salão: uma entrega e o acréscimo dela (mesmo cliente, uma venda só), e um balcão.
  pedido(h("2026-11-07", "20:30"), 50, [1], { id: "ent" } as Partial<PedidoDoTicket>),
  pedido(h("2026-11-07", "20:40"), 10, [1], { parentOrderId: "ent" }),
  pedido(h("2026-11-08", "13:00"), 20, [1]),
  // Cancelado: fora de tudo.
  pedido(h("2026-11-08", "13:10"), 500, [9], { status: "CANCELADO" }),
];

const contas = new Map<string, ContaDoTicket>([
  ["A", { waiterId: "ana", garcom: "Ana", pessoas: 4 }],
  ["B", { waiterId: "ana", garcom: "Ana" }],
  ["C", { waiterId: "beto", garcom: "Beto", convidados: 2 }],
  ["D", { waiterId: null, pessoas: 3 }],
]);

const t = ticketMedioDoPeriodo({ pedidos, contas, tz: SP });

console.log("\n1) O total é o da régua única");
const regua = atendimentosDaVenda(pedidos);
const valorDaRegua = reais(pedidos.filter((p) => p.status !== "CANCELADO").reduce((s, p) => s + cent(p.totalAmount), 0));
confere("faturamento 510 (o cancelado fora)", t.total.faturamento, 510);
confere("= Σ totalAmount da régua", t.total.faturamento, valorDaRegua);
// A, B, C, D (no 1º lançamento, dia 07), entrega + acréscimo = 1, balcão = 1 → 6
confere("atendimentos = atendimentosDaVenda (6: 4 mesas, a entrega com o acréscimo, o balcão)", [t.total.atendimentos, t.total.atendimentos === regua.vendas], [6, true]);
confere("lançamentos 10 e mesas 4", [t.total.lancamentos, t.total.mesas], [10, 4]);
confere("ticket por atendimento 510 ÷ 6 = 85 = ticketMedio da régua", [t.total.ticketPorAtendimento, ticketMedio(510, 6)], [85, 85]);
// A 3+2+1, B 3, C 2, D 1+1, entrega 1 + acréscimo 1, balcão 1 = 16 (o cancelado, 9, fora)
confere("P.A.: 16 itens ÷ 6 = 2,7", [t.total.itens, t.total.pa], [16, 2.7]);

console.log("\n2) Pessoas: só onde alguém informou");
// A (4) + C (2 nomeadas) + D (3) = 9 pessoas; o lançado delas: A 200 + C 80 + D 60 = 340
confere("9 pessoas em 3 das 4 mesas", [t.total.pessoas, t.total.mesasComPessoas], [9, 3]);
confere("ticket por pessoa: 340 ÷ 9 = 37,78 (a mesa B e a entrega fora dos dois lados)", t.total.ticketPorPessoa, 37.78);

console.log("\n3) Por dia");
const d7 = t.porDia.find((d) => d.dia === "2026-11-07")!;
const d8 = t.porDia.find((d) => d.dia === "2026-11-08")!;
confere("dois dias, em ordem", t.porDia.map((d) => [d.dia, d.diaSemana]), [["2026-11-07", 6], ["2026-11-08", 0]]);
// 07: A 100+60+40 (a da 1h é do 07), B 90, D 30, entrega 50+10 = 380 ; 08: C 80, D 30, balcão 20 = 130
confere("faturamento 380 + 130 (a saideira da 1h é do dia 07)", [d7.faturamento, d8.faturamento], [380, 130]);
confere("atendimentos: 07 = A, B, D, entrega; 08 = C, balcão (D já contou no 07)", [d7.atendimentos, d8.atendimentos], [4, 2]);
confere("pessoas: 07 = A 4 + D 3; 08 = C 2", [d7.pessoas, d8.pessoas], [7, 2]);
// 07: A 200 + D 60 (a rodada do 08 vai junto com a mesa) = 260 ÷ 7 ; 08: C 80 ÷ 2
confere("ticket por pessoa: 07 = (200 + 60) ÷ 7 = 37,14; 08 = 80 ÷ 2 = 40", [d7.ticketPorPessoa, d8.ticketPorPessoa], [37.14, 40]);
confere("Σ dias = total (faturamento, atendimentos, pessoas, itens)", [
  reais(t.porDia.reduce((s, d) => s + cent(d.faturamento), 0)), t.porDia.reduce((s, d) => s + d.atendimentos, 0),
  t.porDia.reduce((s, d) => s + d.pessoas, 0), t.porDia.reduce((s, d) => s + d.itens, 0),
], [t.total.faturamento, t.total.atendimentos, t.total.pessoas, t.total.itens]);

console.log("\n4) Por garçom");
const g = (chave: string) => t.porGarcom.find((x) => x.chave === chave)!;
confere("ordem pelo faturamento (Ana 290, Beto 80, sem garçom 60) e Fora do salão (80) por último", t.porGarcom.map((x) => x.nome), ["Ana", "Beto", "Mesa sem garçom", "Fora do salão (balcão, entrega, retirada)"]);
confere("Ana: 290 em 2 mesas, 4 pessoas (só a A), ticket por pessoa 200 ÷ 4 = 50", [g("ana").faturamento, g("ana").atendimentos, g("ana").pessoas, g("ana").ticketPorPessoa], [290, 2, 4, 50]);
confere("Beto: 80, 1 mesa, 2 pessoas nomeadas, 40 por pessoa", [g("beto").faturamento, g("beto").atendimentos, g("beto").pessoas, g("beto").ticketPorPessoa], [80, 1, 2, 40]);
confere("Mesa sem garçom: 60 em 1 mesa, 3 pessoas", [g(MESA_SEM_GARCOM).faturamento, g(MESA_SEM_GARCOM).atendimentos, g(MESA_SEM_GARCOM).pessoas], [60, 1, 3]);
confere("Fora do salão: 80 em 2 vendas, sem pessoas (nunca 1 por pedido)", [g(FORA_DO_SALAO).faturamento, g(FORA_DO_SALAO).atendimentos, g(FORA_DO_SALAO).pessoas, g(FORA_DO_SALAO).ticketPorPessoa], [80, 2, 0, null]);
confere("Σ garçons = total", [
  reais(t.porGarcom.reduce((s, x) => s + cent(x.faturamento), 0)), t.porGarcom.reduce((s, x) => s + x.atendimentos, 0), t.porGarcom.reduce((s, x) => s + x.pessoas, 0),
], [t.total.faturamento, t.total.atendimentos, t.total.pessoas]);

console.log("\n5) Sem nenhuma pessoa informada");
const semPessoas = ticketMedioDoPeriodo({ pedidos, contas: new Map(), tz: SP });
confere("ticket por pessoa nulo ('sem nº de pessoas'), o resto igual", [semPessoas.total.ticketPorPessoa, semPessoas.total.pessoas, semPessoas.total.faturamento, semPessoas.total.atendimentos], [null, 0, 510, 6]);
confere("período sem venda: nada dividido por zero", (() => { const v = ticketMedioDoPeriodo({ pedidos: [], contas, tz: SP }); return [v.total.ticketPorAtendimento, v.total.pa, v.porDia.length, v.porGarcom.length]; })(), [null, null, 0, 0]);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
