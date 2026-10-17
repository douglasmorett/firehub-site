/**
 * O RESUMO DO "MOVIMENTAR CAIXA" BATE COM O ESPERADO DO FECHAMENTO.
 *
 *   npx tsx scripts/teste-resumo-do-caixa-aberto.ts
 *
 * Pedido do Allan (Delícia de Casa, 17/10/2026): o topo do menu do caixa mostra
 * quem abriu, o troco, as vendas do turno (e quanto em dinheiro), as entradas
 * e saídas e o dinheiro que deveria estar na gaveta. A regra é não ter conta
 * paralela: o turno passa pela apuração REAL do fechamento
 * (calcularEsperadoDoTurno, com um prisma falso no lugar do banco, como em
 * scripts/teste-caixa-por-tipo.ts) e o resumo tem de dizer, no centavo, o que
 * o fechamento vai cobrar.
 *
 * Também prova quem abriu: dono, equipe e suporte gravados do jeito certo, e o
 * caixa antigo (sem o registro) saindo como "não se sabe", nunca como "dono".
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { lerQuemAbriu, quemEstaAbrindo, resumoDoCaixaAberto, rotuloDoPapel } from "../src/lib/resumo-do-caixa-aberto";
import { composicaoDoDinheiroEsperado, resumoDasMovimentacoes } from "../src/lib/resumo-das-movimentacoes";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createJiti } = require("jiti");

const RAIZ = resolve(__dirname, "..");
let ok = 0, falhou = 0;
const exigir = (nome: string, condicao: boolean, detalhe?: unknown) => {
  if (condicao) { ok++; console.log("  ok     " + nome); }
  else { falhou++; console.log("  FALHOU " + nome + (detalhe !== undefined ? "  → " + JSON.stringify(detalhe) : "")); }
};
const c = (v: number) => Math.round(v * 100);
const igual = (a: number, b: number) => c(a) === c(b);

// ── O TURNO ─────────────────────────────────────────────────────────────────
// Delícia de Casa, sexta 17/10/2026: caixa aberto às 10h com R$ 120 de troco.
const h = (hhmm: string) => new Date(`2026-10-17T${hhmm}:00-03:00`);
const base = { discountIfood: 0, discountTotal: 0, discountMerchant: 0, notes: null, tableSessionId: null, openDeliveryChannel: null, discountDetails: null,
  ifoodOrderId: null, ifoodReference: null, openDeliveryOrderId: null, openDeliveryReference: null, paymentMethods: null, paymentPaidAt: null, gatewayProvider: null,
  customerName: "Cliente", employeeName: null, deliveryBy: null, motoboyId: null, motoboyFee: null, deliveryDistance: null, totemLicenseId: null, deliveryFee: 0,
  parentOrderId: null, reposicao: null, entregaGratis: null, customerAddress: null, ifoodDriverStatus: null, ifoodDriverName: null, changeAmount: null, dailyOrderNumber: null };
let seq = 0;
const ped = (hora: string, p: Record<string, unknown>) => ({
  ...base, id: `p${++seq}`, createdAt: h(hora), status: "ENTREGUE", deliveryType: "RETIRADA", source: "PRESENCIAL",
  paymentMethod: "Dinheiro", totalAmount: 10, items: [{ price: Number(p.totalAmount ?? 10), quantity: 1 }], ...p,
});

const pedidos: any[] = [
  // Dinheiro no balcão: 45,90 + 32,00.
  ped("10:20", { paymentMethod: "Dinheiro", totalAmount: 45.9 }),
  ped("11:05", { paymentMethod: "Dinheiro", totalAmount: 32 }),
  // Dividido: 20 em dinheiro + 15 no Pix — só os 20 vão para a gaveta.
  ped("11:40", { paymentMethod: "Dividido: Dinheiro R$ 20,00 + Pix R$ 15,00", paymentMethods: [{ method: "Dinheiro", amount: 20 }, { method: "Pix", amount: 15 }], totalAmount: 35 }),
  // Cartão e Pix: vendas do turno, mas fora da gaveta.
  ped("12:10", { paymentMethod: "Cartão de Débito", totalAmount: 58 }),
  ped("12:30", { paymentMethod: "Pix", totalAmount: 27.5 }),
  // iFood pago no app: venda, nunca gaveta.
  ped("13:00", { source: "IFOOD", ifoodOrderId: "if-1", deliveryType: "DELIVERY", paymentMethod: "Crédito (Pago Online)", totalAmount: 64 }),
  // Cancelado: fora de tudo.
  ped("13:20", { status: "CANCELADO", paymentMethod: "Dinheiro", totalAmount: 99 }),
];
const movs = [
  { tipo: "SAIDA", valor: 40, descricao: "Paguei o gás", createdAt: h("12:00"), criadoPor: "allan@deliciadecasa.test" },
  { tipo: "ENTRADA", valor: 50, descricao: "Troco do cofre", createdAt: h("12:45"), criadoPor: "allan@deliciadecasa.test" },
  { tipo: "SAIDA", valor: 25.5, descricao: "Motoboy", createdAt: h("13:10"), criadoPor: "maria@deliciadecasa.test" },
];
const turno = { id: "caixa-17", openedAt: h("10:00"), openingAmount: 120 };

// ── O prisma falso: a apuração REAL do fechamento, sem banco ─────────────────
const pasta = join(tmpdir(), "teste-resumo-do-caixa-aberto");
mkdirSync(pasta, { recursive: true });
const falsoPrisma = join(pasta, "prisma-falso.js");
const falsoColunas = join(pasta, "colunas-falsas.js");
writeFileSync(falsoPrisma, `
const dados = globalThis.__dadosDoResumo;
const porStatus = (where) => dados.pedidos.filter((o) => {
  const s = where && where.status;
  if (typeof s === "string") return o.status === s;
  if (s && s.notIn) return !s.notIn.includes(o.status);
  return true;
});
exports.prisma = {
  customerOrder: { findMany: async ({ where }) => porStatus(where) },
  tableSession: { findMany: async () => [] },
  cashMovement: { findMany: async () => dados.movs },
  customerOrderItem: { findMany: async () => [] },
  motoboy: { findMany: async () => [] },
  user: { findUnique: async () => ({ deliveryZones: null, deliveryConfig: null }) },
};
`);
writeFileSync(falsoColunas, `exports.temEstruturaDeCaixa = async () => true;`);
(globalThis as any).__dadosDoResumo = { pedidos, movs };
const jiti = createJiti(__filename, {
  alias: { "@/lib/prisma": falsoPrisma, "@/lib/garantir-colunas": falsoColunas, "@": join(RAIZ, "src") },
  interopDefault: true,
  moduleCache: false,
  fsCache: false,
});

(async () => {
  console.log("\n== 1. O resumo é o esperado do fechamento ==");
  const { calcularEsperadoDoTurno } = await jiti.import(join(RAIZ, "src", "lib", "esperado-do-turno.ts")) as any;
  const apurado = await calcularEsperadoDoTurno("loja", turno);
  const abertoPor = { nome: "Allan", email: "allan@deliciadecasa.test", papel: "DONO" };
  const r = resumoDoCaixaAberto({ ...turno, abertoPor }, apurado);

  // O fechamento: o que ele confere e o que o papel imprime.
  exigir("dinheiro na gaveta = expected.cash do fechamento (o mesmo número, sem refazer conta)", igual(r.dinheiroNaGaveta, apurado.expected.cash), { r: r.dinheiroNaGaveta, fechamento: apurado.expected.cash });
  exigir("vendas em dinheiro = a gaveta do papel do fechamento", igual(r.vendasEmDinheiro, apurado.detalhe.gaveta.vendasEmDinheiro));
  exigir("vendas do turno = o TOTAL FATURADO do fechamento (régua única)", igual(r.vendas.valor, apurado.detalhe.vendas.valor) && r.vendas.qtd === apurado.detalhe.vendas.qtd, r.vendas);
  exigir("entradas e saídas = as movimentações do fechamento", igual(r.entradas, apurado.movimentacaoEntradas) && igual(r.saidas, apurado.movimentacaoSaidas));

  // Os valores, à mão.
  exigir("troco inicial R$ 120", igual(r.trocoInicial, 120));
  exigir("vendas em dinheiro = 45,90 + 32 + 20 (só a parte em dinheiro do dividido)", igual(r.vendasEmDinheiro, 97.9), r.vendasEmDinheiro);
  exigir("vendas do turno = 6 vendas, R$ 262,40 (cancelado fora)", r.vendas.qtd === 6 && igual(r.vendas.valor, 262.4), r.vendas);
  exigir("entradas R$ 50 e saídas R$ 65,50", igual(r.entradas, 50) && igual(r.saidas, 65.5), r);
  exigir("gaveta = 120 + 97,90 + 50 − 65,50 = R$ 202,40", igual(r.dinheiroNaGaveta, 202.4), r.dinheiroNaGaveta);
  // As parcelas que a tela mostra fecham com o total que ela mostra.
  exigir("as linhas da tela somam o total da tela", igual(r.trocoInicial + r.vendasEmDinheiro + r.entradas - r.saidas, r.dinheiroNaGaveta));
  // E o Histórico, lendo o mesmo caixa depois de fechado, chega às mesmas vendas em dinheiro.
  const historico = composicaoDoDinheiroEsperado(apurado.expected.cash, turno.openingAmount, resumoDasMovimentacoes(movs as any));
  exigir("o Histórico (de trás para a frente) chega às mesmas vendas em dinheiro", historico.vendasEmDinheiro !== null && igual(historico.vendasEmDinheiro, r.vendasEmDinheiro), historico);
  exigir("abertura em ISO, a hora do caixa", r.abertoEm === turno.openedAt.toISOString());
  exigir("quem abriu chega ao resumo", r.abertoPor?.nome === "Allan" && r.abertoPor?.papel === "DONO");

  // Lançou outra sangria: o resumo acompanha o fechamento.
  (globalThis as any).__dadosDoResumo.movs = [...movs, { tipo: "SAIDA", valor: 100, descricao: "Cofre", createdAt: h("14:00"), criadoPor: null }];
  const depois = await calcularEsperadoDoTurno("loja", turno);
  const r2 = resumoDoCaixaAberto({ ...turno, abertoPor }, depois);
  exigir("sangria nova de R$ 100: gaveta R$ 102,40, igual ao fechamento", igual(r2.dinheiroNaGaveta, 102.4) && igual(r2.dinheiroNaGaveta, depois.expected.cash), { r: r2.dinheiroNaGaveta, fechamento: depois.expected.cash });

  console.log("\n== 2. Quem abriu ==");
  const dono = quemEstaAbrindo({ name: "Allan", email: "allan@deliciadecasa.test", ownerId: null });
  exigir("a conta da loja é o dono", dono.papel === "DONO" && dono.nome === "Allan", dono);
  const equipe = quemEstaAbrindo({ name: " Maria ", email: "maria@deliciadecasa.test", ownerId: "loja-1" });
  exigir("login da equipe (ownerId) é funcionário, com o nome limpo", equipe.papel === "FUNCIONARIO" && equipe.nome === "Maria", equipe);
  const semNome = quemEstaAbrindo({ name: "", email: "caixa2@deliciadecasa.test", ownerId: "loja-1" });
  exigir("sem nome no cadastro: o e-mail", semNome.nome === "caixa2@deliciadecasa.test", semNome);
  const suporte = quemEstaAbrindo({ name: "Delícia de Casa", email: "loja@deliciadecasa.test", ownerId: null }, { name: "Douglas" });
  exigir("suporte entrando como a loja NÃO vira dono", suporte.papel === "SUPORTE" && suporte.nome === "Suporte FireHub (Douglas)", suporte);
  exigir("rótulos: dono, equipe, suporte", rotuloDoPapel("DONO") === "dono" && rotuloDoPapel("FUNCIONARIO") === "equipe" && rotuloDoPapel("SUPORTE") === "suporte");

  // O que volta do banco: objeto (JSONB pelo driver) ou texto.
  exigir("lê o JSONB gravado", lerQuemAbriu(equipe)?.nome === "Maria");
  exigir("lê o JSON em texto", lerQuemAbriu(JSON.stringify(equipe))?.papel === "FUNCIONARIO");
  exigir("caixa antigo (coluna nula): não se sabe — a tela mostra —", lerQuemAbriu(null) === null);
  exigir("lixo gravado: não se sabe", lerQuemAbriu("{quebrado") === null && lerQuemAbriu({ papel: "DONO" }) === null);
  const antigo = resumoDoCaixaAberto({ ...turno, abertoPor: null }, apurado);
  exigir("resumo do caixa antigo: sem quem abriu, números iguais", antigo.abertoPor === null && igual(antigo.dinheiroNaGaveta, apurado.expected.cash));

  console.log(`\n${ok} ok, ${falhou} falhou`);
  process.exit(falhou > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
