/**
 * O fiado do PERÍODO para assinar (lib/comprovante-do-fiado.ts →
 * cupomDoFechamentoDoFiado, restanteDosLancamentos, periodoPorExtenso).
 *
 *   npx tsx scripts/teste-fiado-para-assinar.ts
 *
 * Pedido do Douglas e do Victor (19/11/2026): o mês fechado do que a pessoa
 * consumiu, com o total, o pendente e a aba de assinatura. O papel é desenhado
 * pelo MESMO código do Assistente (lib/gerado/comanda-do-assistente.ts) nas
 * duas bobinas: 58 mm (32 colunas) e 80 mm (48). Puro: sem banco, sem fila.
 */
// Banco falso na seção 5: estas variáveis nunca apontam para o Neon.
process.env.DATABASE_URL = "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET ||= "teste-do-fiado";
import {
  cupomDoFechamentoDoFiado, periodoPorExtenso, restanteDosLancamentos, KIND_DO_COMPROVANTE_DO_FIADO,
  LINHA_DO_NOME_COMPLETO, LINHA_DO_DOCUMENTO, LINHA_DA_DATA, TRACO_DA_ASSINATURA, type LancamentoDoPeriodo,
} from "../src/lib/comprovante-do-fiado";
import { saldoDoFiado } from "../src/lib/fiado-da-mesa-regras";
import { comandaDoAssistente } from "../src/lib/gerado/comanda-do-assistente";
import { lerPapel } from "../src/lib/papel-da-impressora";

let ok = 0;
let falhou = 0;
function conferir(nome: string, real: unknown, esperado: unknown) {
  if (JSON.stringify(real) === JSON.stringify(esperado)) {
    ok++;
    console.log(`  ok   ${nome}`);
  } else {
    falhou++;
    console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`);
  }
}

const FUSO = "America/Sao_Paulo";
const d = (iso: string) => new Date(iso);

// ── 1. As baixas quitam do mais antigo para o mais novo ────────────────────
console.log("[1] Quanto falta de cada lançamento");
const todos = [
  { id: "out1", quando: d("2026-10-20T15:00:00Z"), valor: 30 },
  { id: "nov2", quando: d("2026-11-07T22:10:00Z"), valor: 22 },
  { id: "nov1", quando: d("2026-11-07T17:32:00Z"), valor: 40.5 },
  { id: "nov3", quando: d("2026-11-12T16:00:00Z"), valor: 15.9 },
];
const r1 = restanteDosLancamentos(todos, 50);
conferir("50 de baixa: quita outubro (30) e 20 do pedido das 14:32", [r1.get("out1"), r1.get("nov1"), r1.get("nov2"), r1.get("nov3")], [0, 20.5, 22, 15.9]);
const somaR = (m: Map<string, number>) => Math.round([...m.values()].reduce((s, v) => s + v * 100, 0)) / 100;
conferir("a soma do que falta é o saldo (saldoDoFiado)", somaR(r1), saldoDoFiado({ pedidos: 108.4, mesas: 0, baixas: 50 }));
conferir("baixa a mais não vira crédito: tudo zero", somaR(restanteDosLancamentos(todos, 500)), 0);
conferir("sem baixa: falta tudo", somaR(restanteDosLancamentos(todos, 0)), 108.4);
const comNegativo = restanteDosLancamentos([...todos, { id: "estorno", quando: d("2026-11-15T12:00:00Z"), valor: -10 }], 0);
conferir("lançamento negativo conta como baixa (bate com o saldo)", [somaR(comNegativo), comNegativo.get("out1"), comNegativo.get("estorno")], [98.4, 20, 0]);
conferir("centavos não escorregam (0,1 + 0,2)", somaR(restanteDosLancamentos([{ id: "a", quando: d("2026-11-01T12:00:00Z"), valor: 0.1 }, { id: "b", quando: d("2026-11-02T12:00:00Z"), valor: 0.2 }], 0.05)), 0.25);

// ── 2. O período por extenso ───────────────────────────────────────────────
console.log("\n[2] Período por extenso");
conferir("mês inteiro", periodoPorExtenso("2026-10-01", "2026-10-31"), "Outubro de 2026");
conferir("mês em curso", periodoPorExtenso("2026-11-01", "2026-11-19"), "Novembro de 2026 (01/11 a 19/11)");
conferir("fevereiro inteiro", periodoPorExtenso("2026-02-01", "2026-02-28"), "Fevereiro de 2026");
conferir("datas livres", periodoPorExtenso("2026-10-20", "2026-11-19"), "20/10 a 19/11/2026");
conferir("virada de ano", periodoPorExtenso("2025-12-20", "2026-01-05"), "20/12/2025 a 05/01/2026");
conferir("um dia só", periodoPorExtenso("2026-11-19", "2026-11-19"), "19/11/2026");
conferir("sem datas", periodoPorExtenso("", ""), "Todas as datas");
conferir("lixo vale como vazio", periodoPorExtenso("ontem", null), "Todas as datas");

// ── 3. O papel ─────────────────────────────────────────────────────────────
console.log("\n[3] O papel do período");
const doPeriodo: LancamentoDoPeriodo[] = [
  { id: "nov2", quando: d("2026-11-07T22:10:00Z"), rotulo: "Mesa 4", descricao: "2× Pastel de carne, 1× Guaraná lata", valor: 22, restante: 22 },
  { id: "nov1", quando: d("2026-11-07T17:32:00Z"), rotulo: "Pedido #12", descricao: "2x X Burger, 1x Coca lata", valor: 40.5, restante: 20.5 },
  { id: "nov3", quando: d("2026-11-12T16:00:00Z"), rotulo: "Divida lancada", descricao: "Vale combinado com o gerente para a festa da equipe no sabado", valor: 15.9, restante: 15.9 },
];
const agora = d("2026-11-19T03:20:00Z"); // 19/11 00:20 em Brasília
const cupom = cupomDoFechamentoDoFiado({
  loja: "Hakim Centro", fuso: FUSO, operador: "Caixa Ana",
  cliente: { id: "emp1", nome: "João Silva", cargo: "Cozinheiro" },
  periodo: periodoPorExtenso("2026-11-01", "2026-11-19"),
  lancamentos: doPeriodo, saldoTotal: 58.4, agora,
});
const R = cupom.relatorio || [];
const textos = R.map((l) => ("texto" in l ? l.texto : "") + ("valor" in l && l.valor ? ` | ${l.valor}` : ""));
conferir("vai pela fila do caixa (CAIXA_FIADO)", [cupom.kind, cupom.kind.startsWith("CAIXA_")], [KIND_DO_COMPROVANTE_DO_FIADO, true]);
conferir("título e cabeçalho (loja, hora no fuso, operador)", [cupom.dailyOrderNumber, cupom.caixaQuando, cupom.caixaOperador], ["FIADO DO PERIODO", "19/11/2026, 00:20", "Caixa Ana"]);
conferir("cliente e período", [textos.includes("João Silva (Cozinheiro)"), textos.includes("Periodo: Novembro de 2026 (01/11 a 19/11)")], [true, true]);
conferir("lançamentos em ordem de data, agrupados por dia", textos.filter((t) => t.startsWith("==") || / \| R\$/.test(t) && /^\d\d:\d\d /.test(t)), [
  "== 07/11 (sáb) ==",
  "14:32 Pedido #12 (resta R$ 20,50) | R$ 40,50",
  "19:10 Mesa 4 | R$ 22,00",
  "== 12/11 (qui) ==",
  "13:00 Divida lancada | R$ 15,90",
]);
conferir("itens embaixo do lançamento (× vira x)", [textos.includes("- 2x X Burger, 1x Coca lata"), textos.includes("- 2x Pastel de carne, 1x Guaraná lata")], [true, true]);
conferir("subtotal só no dia com mais de um lançamento", textos.filter((t) => t.startsWith("Subtotal")), ["Subtotal 07/11 | R$ 62,50"]);
conferir("total, já pago e PENDENTE em destaque", [
  textos.includes("Total consumido (3) | R$ 78,40"),
  textos.includes("Ja pago deste consumo | -R$ 20,00"),
  R.some((l) => l.tipo === "destaque" && l.texto === "PENDENTE" && l.valor === "R$ 58,40"),
], [true, true, true]);
conferir("saldo de todas as datas só quando difere do pendente", textos.some((t) => t.startsWith("Saldo em aberto")), false);
conferir("reconhecimento com o valor e o período", textos.includes("Reconheco o debito acima no valor de R$ 58,40, referente a Novembro de 2026 (01/11 a 19/11)."), true);
const iAss = textos.indexOf(TRACO_DA_ASSINATURA);
conferir("aba: traço, Assinatura, Nome, CPF e Data, nessa ordem", [textos[iAss + 1], textos.indexOf(LINHA_DO_NOME_COMPLETO) > iAss, textos.indexOf(LINHA_DO_DOCUMENTO) > textos.indexOf(LINHA_DO_NOME_COMPLETO), textos.indexOf(LINHA_DA_DATA) > textos.indexOf(LINHA_DO_DOCUMENTO)], ["Assinatura", true, true, true]);
conferir("vão em branco antes do traço (onde a caneta assina)", [R[iAss - 1], R[iAss - 2]].every((l) => l.tipo === "linha" && !l.texto && !l.valor), true);
conferir("cupom.totalAmount é o pendente", cupom.totalAmount, 58.4);
conferir("Assistente antigo: um item por lançamento", cupom.items.map((i) => `${i.name} ${i.price}`), ["07/11 Pedido #12 40.5", "07/11 Mesa 4 22", "12/11 Divida lancada 15.9"]);

const comOutrasDatas = cupomDoFechamentoDoFiado({
  loja: "Hakim", fuso: FUSO, operador: "Ana", cliente: { id: "e", nome: "Ana" }, periodo: "Outubro de 2026",
  lancamentos: [{ id: "x", quando: d("2026-10-20T15:00:00Z"), rotulo: "Pedido #3", valor: 30, restante: 0 }], saldoTotal: 58.4, agora,
});
const t2 = (comOutrasDatas.relatorio || []).map((l) => ("texto" in l ? l.texto : "") + ("valor" in l && l.valor ? ` | ${l.valor}` : ""));
conferir("mês quitado: (pago), pendente zero e o saldo das outras datas aparece", [t2.includes("12:00 Pedido #3 (pago) | R$ 30,00"), t2.includes("PENDENTE | R$ 0,00"), t2.includes("Saldo em aberto (todas as datas) | R$ 58,40")], [true, true, true]);
const vazio = cupomDoFechamentoDoFiado({ loja: "", fuso: FUSO, operador: "", cliente: { id: "e", nome: "Ana" }, periodo: "Outubro de 2026", lancamentos: [], saldoTotal: 0, agora });
conferir("período sem consumo ainda imprime, e diz isso", (vazio.relatorio || []).some((l) => l.tipo === "texto" && l.texto === "Nenhum lancamento no periodo."), true);

// ── 4. Na bobina: o MESMO código do Assistente, 58 mm e 80 mm ──────────────
console.log("\n[4] Na bobina (código do Assistente)");
const textoDe = (l: any) => l.trechos.map((t: any) => t.texto).join("");
for (const colunas of [32, 48]) {
  const papel = lerPapel(comandaDoAssistente(cupom, "Hakim Centro", colunas, "safe"));
  const linhas = papel.map(textoDe);
  const larguraReal = (l: any) => l.trechos.reduce((s: number, t: any) => s + t.texto.length * (t.largura || 1), 0);
  if (colunas === 32) for (const x of linhas.filter((y) => y.trim())) console.log(`      |${x}`);
  conferir(`${colunas} col: nenhuma linha passa da largura`, papel.filter((l) => larguraReal(l) > colunas).map(textoDe), []);
  const corpo = linhas.join("\n");
  conferir(`${colunas} col: total e pendente com valor alinhado à direita`, [
    linhas.some((l) => l.startsWith("Total consumido (3)") && l.endsWith("R$ 78,40")),
    linhas.some((l) => l.startsWith("PENDENTE") && l.endsWith("R$ 58,40")),
  ], [true, true]);
  conferir(`${colunas} col: a observação comprida quebra em linhas, sem perder palavra`, /festa da equipe/.test(corpo.replace(/\s+/g, " ")) && /sabado/.test(corpo), true);
  conferir(`${colunas} col: Nome, CPF e Data inteiros numa linha`, [LINHA_DO_NOME_COMPLETO, LINHA_DO_DOCUMENTO, LINHA_DA_DATA].every((x) => linhas.some((l) => l.trim() === x)), true);
  conferir(`${colunas} col: reconhecimento com o valor (quebra sem cortar o R$)`, /Reconheco o debito acima no valor de R\$ 58,40/.test(corpo.replace(/\s*\n\s*/g, " ")), true);
  conferir(`${colunas} col: fecha com NAO E DOCUMENTO FISCAL`, linhas.some((l) => /NAO E DOCUMENTO FISCAL/.test(l)), true);
}

// ── 5. A fila da nuvem: o papel sai na impressora escolhida ───────────────
// Banco FALSO em memória (como scripts/teste-nfce-fila-do-danfe.ts): nada vai
// ao Neon e nada imprime de verdade.
async function fila() {
  console.log("\n[5] Fila da nuvem (print-queue, banco falso)");
  const LOJA = "loja_fiado_teste";
  const pedidos: any[] = [];
  const casa = (pr: any, w: any) =>
    (!w.franchiseeId || pr.franchiseeId === w.franchiseeId) && (!w.createdAt?.gt || pr.createdAt > w.createdAt.gt)
    && !("printedAt" in w && w.printedAt === null && pr.printedAt != null)
    && !(w.kind && typeof w.kind === "object" && "not" in w.kind && pr.kind === w.kind.not);
  const dono: any = {
    id: LOJA, storeName: "Hakim", name: "Hakim", slug: "hakim", storeLoyalty: null, city: "", printQueuePolledAt: new Date(), printQueueEstado: null,
    printerConfig: { printers: [
      { id: "p1", name: "CAIXA", categories: [], copies: 2, paperWidth: "80mm" },
      { id: "p2", name: "BALCAO 58", categories: [], copies: 1, paperWidth: "58mm", columns: 32 },
    ] },
  };
  (globalThis as any).prisma = {
    user: { findUnique: async () => ({ ...dono }), update: async () => dono, findMany: async () => [dono] },
    customerOrder: { findMany: async () => [], findUnique: async () => null },
    printRequest: {
      findMany: async ({ where }: any) => pedidos.filter((pr) => casa(pr, where)).map((pr) => ({ ...pr })),
      findFirst: async () => null,
      create: async ({ data }: any) => { const pr = { id: `pr_${pedidos.length + 1}`, createdAt: new Date(), printedAt: null, ...structuredClone(data) }; pedidos.push(pr); return { id: pr.id }; },
      deleteMany: async () => ({ count: 0 }),
      updateMany: async () => ({ count: 0 }),
    },
  };
  const { enfileirarCupomDoCaixa } = await import("../src/lib/imprimir-caixa");
  const { GET } = await import("../src/app/api/store/print-queue/route");
  const { NextRequest } = await import("next/server");
  await enfileirarCupomDoCaixa(LOJA, { ...cupom, id: "escolhida", impressoraAlvo: "BALCAO 58" } as any, "Ana");
  await enfileirarCupomDoCaixa(LOJA, { ...cupom, id: "sem_escolha" }, "Ana");
  const res = await GET(new NextRequest(`https://firehubfood.com.br/api/store/print-queue?franchiseeId=${LOJA}&v=1.2.47&pendentes=0`, { headers: { "x-forwarded-for": "10.9.8.7" } }));
  const jobs = ((await res.json()) as any).jobs.filter((j: any) => j.order?.kind === KIND_DO_COMPROVANTE_DO_FIADO);
  const destino = (id: string) => jobs.find((j: any) => j.order.id === id)?.destinos?.map((x: any) => [x.printer, x.copies, x.paperWidth, x.columns ?? null]);
  conferir("com impressora escolhida: sai só nela, uma via, na bobina dela", destino("escolhida"), [["BALCAO 58", 1, "58mm", 32]]);
  conferir("sem escolha: a regra de sempre do papel de caixa (a do caixa, uma via)", destino("sem_escolha"), [["CAIXA", 1, "80mm", null]]);
  conferir("o papel chega com o relatório (o Assistente imprime o fechamento)", jobs.length === 2 && jobs.every((j: any) => Array.isArray(j.order.relatorio) && j.order.relatorio.length > 10), true);
}

fila()
  .catch((e) => { falhou++; console.log("  FALHOU exceção na fila:", e?.message || e); })
  .finally(() => {
    console.log(`\n${ok} ok, ${falhou} falhou`);
    process.exit(falhou > 0 ? 1 : 0);
  });
