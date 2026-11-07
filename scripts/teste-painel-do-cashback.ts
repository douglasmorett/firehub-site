/**
 * Prova do painel da aba Cashback (lib/painel-do-cashback.ts): o saldo e o
 * vencimento saem do MESMO extrato de lib/cashback.ts; o gerado/usado do
 * período são os movimentos da janela; o comparativo segue a régua da venda;
 * a mensagem do WhatsApp diz quanto vence e deixa o link sozinho. Sem banco.
 *
 *   npx tsx scripts/teste-painel-do-cashback.ts
 */
import assert from "node:assert/strict";
import { lerCashback, saldoDoCashback } from "../src/lib/cashback";
import {
  cashbackNoPainel,
  comparativoDoCashback,
  linkDoWhatsAppComTexto,
  mensagemDoCashback,
  resumoDoPainel,
  type PedidoDoComparativo,
} from "../src/lib/painel-do-cashback";

let ok = 0;
const caso = (nome: string, f: () => void) => { f(); ok++; console.log("ok -", nome); };

const AGORA = new Date("2026-11-07T20:00:00Z");
const DIA = 86_400_000;
const dia = (n: number) => new Date(AGORA.getTime() - n * DIA);
// Janela: os últimos 7 dias.
const JANELA = { inicio: dia(7), fim: AGORA };
const regra = lerCashback({ cashbackActive: true, rate: 5, minOrderValue: 0, maxRedeemPercent: 50, expiresInDays: 30 });
const semValidade = lerCashback({ cashbackActive: true, rate: 5, expiresInDays: 0 });
let n = 0;
const ped = (x: Record<string, unknown>) => ({ id: `p${++n}`, source: "ONLINE", status: "ENTREGUE", deliveryType: "DELIVERY", createdAt: dia(1), ...x });

// Cliente: ganhou R$ 10 há 25 dias (vence em 5), R$ 6 há 3 dias (vence em 27),
// usou R$ 4 há 2 dias (consome o lote mais velho: sobram 6 + 6).
const grupo = {
  pedidos: [
    ped({ cashbackEarned: 10, createdAt: dia(25), deliveredAt: dia(25) }),
    ped({ cashbackEarned: 6, createdAt: dia(3), deliveredAt: dia(3) }),
    ped({ cashbackUsed: 4, createdAt: dia(2) }),
    ped({ status: "PREPARANDO", cashbackEarned: 2, createdAt: dia(0) }),
  ],
  ajustes: [],
};

caso("saldo do painel = saldo do cardápio (mesma conta)", () => {
  const p = cashbackNoPainel(regra, grupo, JANELA, AGORA);
  const s = saldoDoCashback(regra, grupo.pedidos, AGORA, []);
  assert.equal(p.saldo, s.saldo);
  assert.equal(p.saldo, 12);
  assert.deepEqual(p.proximoVencimento, s.proximoVencimento);
});

caso("vence em 7 dias = só o resto do lote velho; em 30 dias = tudo", () => {
  const p = cashbackNoPainel(regra, grupo, JANELA, AGORA);
  assert.equal(p.vence7, 6);
  assert.equal(p.vence30, 12);
  assert.equal(p.proximoVencimento?.valor, 6);
});

caso("gerado/usado no período: só os movimentos dentro da janela", () => {
  const p = cashbackNoPainel(regra, grupo, JANELA, AGORA);
  assert.equal(p.geradoNoPeriodo, 6, "o de 25 dias atrás fica fora");
  assert.equal(p.usadoNoPeriodo, 4);
  assert.equal(p.gerado, 16);
  assert.equal(p.usado, 4);
  assert.equal(p.aReceber, 2, "pedido em preparo ainda não entrou");
});

caso("o que venceu entra em vencido, na data do vencimento", () => {
  const g = { pedidos: [ped({ cashbackEarned: 8, createdAt: dia(33), deliveredAt: dia(33) })], ajustes: [] };
  const p = cashbackNoPainel(regra, g, JANELA, AGORA);
  assert.equal(p.saldo, 0);
  assert.equal(p.vencido, 8);
  assert.equal(p.vencidoNoPeriodo, 8, "venceu há 3 dias, dentro da janela");
});

caso("sem validade: nada vence", () => {
  const p = cashbackNoPainel(semValidade, grupo, JANELA, AGORA);
  assert.equal(p.vence7, 0);
  assert.equal(p.vence30, 0);
  assert.equal(p.saldo, 12);
});

caso("lançamento à mão sem vencimento não entra no vence", () => {
  const g = { pedidos: [], ajustes: [{ valor: 20, createdAt: dia(28), semVencimento: true }, { valor: 5, createdAt: dia(28) }] };
  const p = cashbackNoPainel(regra, g, JANELA, AGORA);
  assert.equal(p.saldo, 25);
  assert.equal(p.vence7, 5);
  assert.equal(p.geradoNoPeriodo, 0);
  assert.equal(p.gerado, 25);
});

caso("resumo soma no centavo e conta quem vence", () => {
  const a = cashbackNoPainel(regra, grupo, JANELA, AGORA);
  const b = cashbackNoPainel(regra, { pedidos: [ped({ cashbackEarned: 0.1, createdAt: dia(1), deliveredAt: dia(1) })], ajustes: [] }, JANELA, AGORA);
  const c = cashbackNoPainel(regra, { pedidos: [ped({ cashbackEarned: 0.2, createdAt: dia(1), deliveredAt: dia(1) })], ajustes: [] }, JANELA, AGORA);
  const zerado = cashbackNoPainel(regra, { pedidos: [ped({ cashbackEarned: 3, createdAt: dia(40), deliveredAt: dia(40) })], ajustes: [] }, JANELA, AGORA);
  const r = resumoDoPainel([a, b, c, zerado]);
  assert.equal(r.clientesComSaldo, 3);
  assert.equal(r.saldoEmAberto, 12.3);
  assert.equal(r.vence7, 6);
  assert.equal(r.clientesQueVencem7, 1);
  assert.equal(r.clientesQueVencem30, 3);
  assert.equal(r.geradoNoPeriodo, 6.3);
  assert.equal(r.aReceber, 2);
});

// ── comparativo
let m = 0;
const venda = (x: Partial<PedidoDoComparativo>): PedidoDoComparativo => ({ id: `v${++m}`, createdAt: dia(1), status: "ENTREGUE", totalAmount: 50, ...x });

caso("quem usou × quem não usou: ticket e frequência pela régua", () => {
  const pedidos = [
    // Ana usou cashback em 1 de 2 pedidos: os dois contam para o grupo dela.
    venda({ customerPhone: "(22) 99999-1111", totalAmount: 80, cashbackUsed: 5 }),
    venda({ customerPhone: "22999991111", totalAmount: 40 }),
    // Beto (robô, sem o 9) é o mesmo cliente do site com o 9.
    venda({ customerPhone: "+55 (22) 9888-2222", totalAmount: 30 }),
    venda({ customerPhone: "22998882222", totalAmount: 30 }),
    // Caio: 1 pedido, não usou.
    venda({ customerPhone: "21977773333", totalAmount: 60 }),
    // Cancelado não conta, nem o uso de cashback dele.
    venda({ customerPhone: "21977773333", totalAmount: 99, status: "CANCELADO", cashbackUsed: 10 }),
    // Mesa e iFood: no valor da loja, fora do comparativo.
    venda({ customerPhone: null, totalAmount: 100, tableSessionId: "s1" }),
    venda({ customerPhone: "08007770000", totalAmount: 70, ifoodOrderId: "x" } as Partial<PedidoDoComparativo>),
  ];
  const c = comparativoDoCashback(pedidos);
  assert.deepEqual(c.usaram, { clientes: 1, vendas: 2, valor: 120, ticketMedio: 60, frequencia: 2 });
  assert.deepEqual(c.naoUsaram, { clientes: 2, vendas: 3, valor: 120, ticketMedio: 40, frequencia: 1.5 });
  assert.equal(c.valorDaLoja, 410, "80+40+30+30+60 + mesa 100 + iFood 70");
  assert.equal(c.participacao, 29.3, "120 de 410");
});

caso("acréscimo com o pai no recorte não vira venda nova", () => {
  const pai = venda({ customerPhone: "22999991111", totalAmount: 50, cashbackUsed: 2 });
  const c = comparativoDoCashback([pai, venda({ customerPhone: "22999991111", totalAmount: 10, parentOrderId: pai.id })]);
  assert.equal(c.usaram.vendas, 1);
  assert.equal(c.usaram.valor, 60);
  assert.equal(c.usaram.ticketMedio, 60);
});

caso("período sem venda: tudo zero, sem dividir por zero", () => {
  const c = comparativoDoCashback([]);
  assert.equal(c.participacao, 0);
  assert.equal(c.usaram.ticketMedio, 0);
  assert.equal(c.naoUsaram.frequencia, 0);
});

// ── mensagem
caso("mensagem com todo o saldo vencendo", () => {
  const t = mensagemDoCashback({
    nome: "Maria Souza", saldo: 12.5, loja: "Pizzaria Bella",
    proximoVencimento: { valor: 12.5, em: "2026-11-15T15:00:00Z" }, fuso: "America/Sao_Paulo",
    link: "https://firehubfood.com.br/loja/bella",
  });
  assert.equal(t, "Oi, Maria! Você tem R$ 12,50 de cashback na Pizzaria Bella. Ele vence dia 15/11. Use no seu próximo pedido:\nhttps://firehubfood.com.br/loja/bella");
  assert.equal(t.split("\n").pop(), "https://firehubfood.com.br/loja/bella", "link sozinho na linha");
});

caso("mensagem com só parte vencendo diz quanto", () => {
  const t = mensagemDoCashback({ nome: null, saldo: 30, loja: "Bella", proximoVencimento: { valor: 5, em: "2026-11-15T15:00:00Z" }, link: "" });
  assert.equal(t, "Oi! Você tem R$ 30,00 de cashback na Bella. R$ 5,00 vence dia 15/11. Use no seu próximo pedido!");
});

caso("vencimento usa o dia da loja, não o UTC", () => {
  // 02h UTC do dia 16 ainda é 23h do dia 15 em São Paulo.
  const t = mensagemDoCashback({ saldo: 5, loja: "X", proximoVencimento: { valor: 5, em: "2026-11-16T02:00:00Z" }, fuso: "America/Sao_Paulo" });
  assert.ok(t.includes("vence dia 15/11"), t);
});

caso("link do WhatsApp: 55 + DDD + número, texto codificado; telefone ruim = null", () => {
  assert.equal(linkDoWhatsAppComTexto("(22) 99999-1111", "Oi!\nlink"), "https://wa.me/5522999991111?text=Oi!%0Alink");
  assert.equal(linkDoWhatsAppComTexto("+55 22 99999-1111", "a"), "https://wa.me/5522999991111?text=a");
  assert.equal(linkDoWhatsAppComTexto("99991111", "a"), null);
  assert.equal(linkDoWhatsAppComTexto("08007770000", "a"), null);
});

console.log(`\n${ok} casos ok`);
