/**
 * CAIXA POR USUÁRIO — cada login com o seu caixa, sem contar venda duas vezes.
 *
 *   npx tsx scripts/teste-caixa-por-usuario.ts
 *
 * Pedido da Garagem Burger (Thalyta), aprovado pelo Douglas em 13/11/2026
 * (lib/caixa-por-usuario-regras.ts). O teste passa pela apuração REAL do
 * fechamento (calcularEsperadoDoTurno, com um prisma falso no lugar do banco,
 * como em scripts/teste-resumo-do-caixa-aberto.ts) e prova:
 *
 *   1. DESLIGADO = como sempre: o caixa compartilhado conta a loja inteira na
 *      janela do turno, com ou sem vínculos gravados, e o PDV pergunta pelo
 *      caixa da loja.
 *   2. LIGADO: dois logins, dois caixas; a venda de cada um cai no caixa dele;
 *      o que não tem quem lançou (site, iFood) cai no caixa do dono; a soma
 *      dos dois caixas é o turno inteiro (nada contado duas vezes).
 *   3. Fechar um caixa não fecha o outro, e o pedido de fora passa para o
 *      caixa que sobrou aberto.
 *   4. O dono vê os caixas de todos (e filtra); o funcionário, só os dele.
 *   5. A numeração não volta ao #1 quando um caixa fecha com outro aberto.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { caixaPrincipalEm, caixasVisiveis, donoDoCaixa } from "../src/lib/caixa-por-usuario-regras";
import { lerBalcaoConfig } from "../src/lib/balcao-config";

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

// ── A LOJA ──────────────────────────────────────────────────────────────────
// Garagem Burger, sexta 13/11/2026. O dono (login "loja") abre às 10h com
// R$ 100; a Ana (login da equipe) abre o caixa DELA às 11h com R$ 50.
const LOJA = "loja";
const ANA = "ana";
const h = (hhmm: string) => new Date(`2026-11-13T${hhmm}:00-03:00`);
const base = { discountIfood: 0, discountTotal: 0, discountMerchant: 0, notes: null, tableSessionId: null, openDeliveryChannel: null, discountDetails: null,
  ifoodOrderId: null, ifoodReference: null, openDeliveryOrderId: null, openDeliveryReference: null, paymentMethods: null, paymentPaidAt: null, gatewayProvider: null,
  customerName: "Cliente", employeeName: null, deliveryBy: null, motoboyId: null, motoboyFee: null, deliveryDistance: null, totemLicenseId: null, deliveryFee: 0,
  parentOrderId: null, reposicao: null, entregaGratis: null, customerAddress: null, ifoodDriverStatus: null, ifoodDriverName: null, changeAmount: null, dailyOrderNumber: null };
const ped = (id: string, hora: string, p: Record<string, unknown>) => ({
  ...base, id, createdAt: h(hora), status: "ENTREGUE", deliveryType: "RETIRADA", source: "PRESENCIAL",
  paymentMethod: "Dinheiro", totalAmount: 10, items: [{ price: Number(p.totalAmount ?? 10), quantity: 1 }], ...p,
});

const pedidos: any[] = [
  ped("p1", "10:30", { paymentMethod: "Dinheiro", totalAmount: 50 }),                 // balcão do dono
  ped("p2", "11:30", { paymentMethod: "Dinheiro", totalAmount: 30 }),                 // balcão da Ana
  ped("p3", "11:45", { source: "SITE", deliveryType: "DELIVERY", paymentMethod: "Pix", totalAmount: 40 }), // site: sem quem lançou
  ped("p4", "12:00", { source: "IFOOD", ifoodOrderId: "if-1", deliveryType: "DELIVERY", paymentMethod: "Crédito (Pago Online)", totalAmount: 60 }),
  ped("p5", "12:10", { parentOrderId: "p2", paymentMethod: "Dinheiro", totalAmount: 5 }), // acréscimo do pedido da Ana
  ped("p6", "11:10", { tableSessionId: "m1", paymentMethod: null, totalAmount: 25 }),  // mesa que a Ana fechou
  ped("p9", "12:30", { status: "CANCELADO", paymentMethod: "Dinheiro", totalAmount: 99 }),
];
const mesas: any[] = [
  { id: "m1", paymentMethods: [{ method: "Dinheiro", amount: 25 }], serviceFee: 0, waiterTip: 0, totalPaid: 25, closedAt: h("12:20"),
    orders: [{ id: "p6", status: "ENTREGUE", totalAmount: 25, discountTotal: 0 }] },
];
const movs: any[] = [
  { cashSessionId: "c-ana", tipo: "SAIDA", valor: 20, descricao: "Gelo", createdAt: h("12:15"), criadoPor: "ana@garagem.test" },
  { cashSessionId: "c-dono", tipo: "ENTRADA", valor: 10, descricao: "Troco", createdAt: h("10:40"), criadoPor: "dono@garagem.test" },
];
const quem = (usuarioId: string, nome: string) => ({ nome, email: null, papel: usuarioId === LOJA ? "DONO" : "FUNCIONARIO", usuarioId, porUsuario: true });
const caixaDono = { id: "c-dono", franchiseeId: LOJA, status: "OPEN", openedAt: h("10:00"), closedAt: null as Date | null, openingAmount: 100, abertoPor: quem(LOJA, "Thalyta") as any };
const caixaAna = { id: "c-ana", franchiseeId: LOJA, status: "OPEN", openedAt: h("11:00"), closedAt: null as Date | null, openingAmount: 50, abertoPor: quem(ANA, "Ana") as any };

// ── O prisma falso ───────────────────────────────────────────────────────────
const pasta = join(tmpdir(), "teste-caixa-por-usuario");
mkdirSync(pasta, { recursive: true });
const falsoPrisma = join(pasta, "prisma-falso.js");
writeFileSync(falsoPrisma, `
const d = () => globalThis.__caixaPorUsuario;
const naJanela = (data, j) => !j || ((!j.gte || data >= j.gte) && (!j.lte || data <= j.lte));
const ordenar = (lista, orderBy) => {
  if (!orderBy) return lista;
  const [campo, dir] = Object.entries(orderBy)[0];
  return [...lista].sort((a, b) => ((a[campo] ? +a[campo] : 0) - (b[campo] ? +b[campo] : 0)) * (dir === "desc" ? -1 : 1));
};
const filtrarCaixas = (where = {}) => d().caixas.filter((s) => {
  if (where.id && typeof where.id === "string" && s.id !== where.id) return false;
  if (where.id && where.id.in && !where.id.in.includes(s.id)) return false;
  if (where.franchiseeId && s.franchiseeId !== where.franchiseeId) return false;
  if (where.status && s.status !== where.status) return false;
  if (where.openedAt && where.openedAt.lte && s.openedAt > where.openedAt.lte) return false;
  if (where.closedAt && where.closedAt.not === null && !s.closedAt) return false;
  if (where.closedAt && where.closedAt.gte && !(s.closedAt && s.closedAt >= where.closedAt.gte)) return false;
  if (where.OR && !where.OR.some((o) => (o.closedAt === null && !s.closedAt) || (o.closedAt && o.closedAt.gt && s.closedAt && s.closedAt > o.closedAt.gt))) return false;
  return true;
});
exports.prisma = {
  customerOrder: { findMany: async ({ where }) => {
    if (where.updatedAt) return [];
    return d().pedidos.filter((o) => {
      const s = where.status;
      if (typeof s === "string" && o.status !== s) return false;
      if (s && s.notIn && s.notIn.includes(o.status)) return false;
      return naJanela(o.createdAt, where.createdAt);
    });
  } },
  tableSession: { findMany: async ({ where }) => d().mesas.filter((m) => naJanela(m.closedAt, where.closedAt)) },
  cashMovement: { findMany: async ({ where }) => d().movs.filter((m) => m.cashSessionId === where.cashSessionId) },
  customerOrderItem: { findMany: async () => [] },
  motoboy: { findMany: async () => [] },
  user: { findUnique: async () => ({ balcaoConfig: { caixaPorUsuario: d().ligado }, deliveryZones: null, deliveryConfig: null }) },
  cashSession: {
    findMany: async ({ where, orderBy, take }) => ordenar(filtrarCaixas(where), orderBy).slice(0, take || 1e9),
    findFirst: async ({ where, orderBy }) => ordenar(filtrarCaixas(where), orderBy)[0] || null,
  },
  // Os vínculos: o SELECT devolve todos (a função monta o mapa pela chave);
  // o INSERT recebe (tipo, refId, cashSessionId, lojaId, usuarioId).
  $queryRaw: async () => d().vinculos.map(([tipo, refId, cashSessionId]) => ({ tipo, refId, cashSessionId })),
  $executeRaw: async (_partes, tipo, refId, cashSessionId) => {
    d().vinculos = d().vinculos.filter((v) => !(v[0] === tipo && v[1] === refId));
    d().vinculos.push([tipo, refId, cashSessionId]);
    return 1;
  },
};
`);
const falsoColunas = join(pasta, "colunas-falsas.js");
writeFileSync(falsoColunas, `exports.temEstruturaDeCaixa = async () => true;`);
const falsoDDL = join(pasta, "ddl-falso.js");
writeFileSync(falsoDDL, `exports.executarDDL = async () => ({ pulou: true, falhas: [] });`);
process.env.DATABASE_URL = "postgresql://teste/falso";

const dados: any = {
  ligado: true,
  pedidos, mesas, movs,
  caixas: [caixaDono, caixaAna],
  // p1 lançado pelo dono, p2 pela Ana, a mesa m1 fechada pela Ana no painel.
  vinculos: [["PEDIDO", "p1", "c-dono"], ["PEDIDO", "p2", "c-ana"], ["MESA", "m1", "c-ana"]],
};
(globalThis as any).__caixaPorUsuario = dados;
const jiti = createJiti(__filename, {
  alias: { "@/lib/prisma": falsoPrisma, "@/lib/garantir-colunas": falsoColunas, "@/lib/ddl-do-boot": falsoDDL, "@": join(RAIZ, "src") },
  interopDefault: true,
  moduleCache: false,
  fsCache: false,
});

(async () => {
  const { calcularEsperadoDoTurno } = await jiti.import(join(RAIZ, "src", "lib", "esperado-do-turno.ts")) as any;
  const cpu = await jiti.import(join(RAIZ, "src", "lib", "caixa-por-usuario.ts")) as any;
  const numeracao = await jiti.import(join(RAIZ, "src", "lib", "order-number.ts")) as any;

  // O caixa compartilhado de sempre, na mesma janela: a referência do "dia".
  const compartilhado = { id: "c-loja", openedAt: h("10:00"), openingAmount: 100 };

  console.log("\n== 1. Desligado: como sempre ==");
  exigir("a chave nasce desligada", lerBalcaoConfig(null).caixaPorUsuario === false && lerBalcaoConfig({}).caixaPorUsuario === false);
  exigir("só true liga", lerBalcaoConfig({ caixaPorUsuario: "sim" }).caixaPorUsuario === false && lerBalcaoConfig({ caixaPorUsuario: true }).caixaPorUsuario === true);
  exigir("caixa sem a marca é o compartilhado", donoDoCaixa(null) === null && donoDoCaixa({ nome: "Ana", papel: "FUNCIONARIO" }) === null && donoDoCaixa({ usuarioId: ANA }) === null);
  const semVinculos = { ...dados, vinculos: [] };
  (globalThis as any).__caixaPorUsuario = semVinculos;
  const antes = await calcularEsperadoDoTurno(LOJA, compartilhado);
  (globalThis as any).__caixaPorUsuario = dados;
  const comVinculos = await calcularEsperadoDoTurno(LOJA, { ...compartilhado, abertoPor: { nome: "Thalyta", email: null, papel: "DONO" } });
  // 7 pedidos: o cancelado fica fora e o acréscimo é o mesmo atendimento do pai
  // (régua única): p1, p2+p5, site, iFood e a mesa = 5 vendas, R$ 210.
  exigir("compartilhado conta TODAS as vendas da janela: 5 atendimentos, R$ 210",
    antes.detalhe.vendas.qtd === 5 && igual(antes.detalhe.vendas.valor, 210), antes.detalhe.vendas);
  exigir("vínculos gravados não mudam o compartilhado (mesmo esperado, mesmas vendas)",
    JSON.stringify(antes.expected) === JSON.stringify(comVinculos.expected) && igual(antes.detalhe.vendas.valor, comVinculos.detalhe.vendas.valor),
    { antes: antes.expected, depois: comVinculos.expected });
  dados.ligado = false;
  dados.caixas = [{ ...caixaDono, abertoPor: { nome: "Thalyta", email: null, papel: "DONO" } }];
  const doPdvDesligado = await cpu.caixaAbertoPara(LOJA, ANA);
  exigir("desligado: o PDV da Ana usa o caixa da loja (aberto pelo dono)", doPdvDesligado?.id === "c-dono", doPdvDesligado?.id);
  const vinculosAntes = dados.vinculos.length;
  await cpu.vincularVendaDoUsuario("PEDIDO", "pX", LOJA, ANA);
  exigir("desligado: a venda não ganha vínculo nenhum", dados.vinculos.length === vinculosAntes);
  dados.ligado = true;
  dados.caixas = [caixaDono, caixaAna];

  console.log("\n== 2. Ligado: dois logins, dois caixas ==");
  const doDono = await calcularEsperadoDoTurno(LOJA, caixaDono);
  const daAna = await calcularEsperadoDoTurno(LOJA, caixaAna);
  // Dono: troco 100 + p1 50 (dinheiro) + reforço 10; Pix do site (40); iFood online (60).
  exigir("dinheiro do dono = 100 + 50 + 10 = R$ 160", igual(doDono.expected.cash, 160), doDono.expected);
  exigir("o Pix do site (sem quem lançou) caiu no caixa do dono", igual(doDono.expected.pix, 40) && igual(daAna.expected.pix, 0), { dono: doDono.expected.pix, ana: daAna.expected.pix });
  exigir("o iFood pago online caiu no caixa do dono", igual(doDono.expected.ifoodOnline, 60) && igual(daAna.expected.ifoodOnline, 0));
  // Ana: troco 50 + p2 30 + acréscimo 5 + mesa 25 − sangria 20.
  exigir("dinheiro da Ana = 50 + 30 + 5 (acréscimo) + 25 (mesa) − 20 = R$ 90", igual(daAna.expected.cash, 90), daAna.expected);
  exigir("a sangria da Ana é só dela; o reforço do dono, só dele",
    igual(daAna.movimentacaoSaidas, 20) && igual(daAna.movimentacaoEntradas, 0) && igual(doDono.movimentacaoEntradas, 10) && igual(doDono.movimentacaoSaidas, 0));
  exigir("vendas: dono 3 (p1, site, iFood = R$ 150), Ana 2 (p2 com o acréscimo, mesa = R$ 60)",
    doDono.detalhe.vendas.qtd === 3 && igual(doDono.detalhe.vendas.valor, 150) && daAna.detalhe.vendas.qtd === 2 && igual(daAna.detalhe.vendas.valor, 60),
    { dono: doDono.detalhe.vendas, ana: daAna.detalhe.vendas });
  exigir("SEM CONTAR DUAS VEZES: faturado do dono + da Ana = faturado do turno inteiro",
    igual(doDono.detalhe.vendas.valor + daAna.detalhe.vendas.valor, antes.detalhe.vendas.valor),
    { dono: doDono.detalhe.vendas.valor, ana: daAna.detalhe.vendas.valor, turno: antes.detalhe.vendas.valor });
  exigir("SEM CONTAR DUAS VEZES: atendimentos do dono + da Ana = os do turno",
    doDono.detalhe.vendas.qtd + daAna.detalhe.vendas.qtd === antes.detalhe.vendas.qtd);
  const vendasSemTroco = (d: any) => d.expected.total - (d === doDono ? 100 : d === daAna ? 50 : 100) - d.movimentacaoEntradas + d.movimentacaoSaidas;
  exigir("SEM CONTAR DUAS VEZES: o esperado das formas (sem troco e movimentações) soma o do turno",
    igual(vendasSemTroco(doDono) + vendasSemTroco(daAna), antes.expected.total - 100), { dono: vendasSemTroco(doDono), ana: vendasSemTroco(daAna), turno: antes.expected.total - 100 });
  exigir("a mesa fechada pela Ana não aparece como 'mesa aberta' no caixa do dono",
    igual(doDono.foraDaConferencia.mesasAbertas, 0) && igual(daAna.foraDaConferencia.mesasAbertas, 0));

  // A venda nova do PDV: cai no caixa aberto de quem lançou.
  await cpu.vincularVendaDoUsuario("PEDIDO", "p7", LOJA, ANA);
  await cpu.vincularVendaDoUsuario("PEDIDO", "p8", LOJA, LOJA);
  const v7 = dados.vinculos.find((v: any) => v[1] === "p7"), v8 = dados.vinculos.find((v: any) => v[1] === "p8");
  exigir("venda nova da Ana vinculada ao caixa dela; a do dono, ao dele", v7?.[2] === "c-ana" && v8?.[2] === "c-dono", { v7, v8 });
  exigir("cada login acha o SEU caixa aberto",
    (await cpu.caixaAbertoPara(LOJA, ANA))?.id === "c-ana" && (await cpu.caixaAbertoPara(LOJA, LOJA))?.id === "c-dono");
  exigir("login sem caixa aberto: nenhum (não usa o do colega)", (await cpu.caixaAbertoPara(LOJA, "bruno")) === null);

  console.log("\n== 3. Fechar um não fecha o outro ==");
  caixaAna.status = "CLOSED"; caixaAna.closedAt = h("13:00");
  exigir("a Ana fechou: o caixa do dono continua aberto", (await cpu.caixaAbertoPara(LOJA, LOJA))?.id === "c-dono");
  exigir("e a Ana não tem mais caixa aberto", (await cpu.caixaAbertoPara(LOJA, ANA)) === null);
  const anaFechada = await calcularEsperadoDoTurno(LOJA, caixaAna, { ate: caixaAna.closedAt });
  exigir("a 2ª via da Ana (depois de fechado) bate com o que ela fechou", igual(anaFechada.expected.cash, daAna.expected.cash), anaFechada.expected);
  // O dono fecha; a Ana reabre — o pedido do site agora vai para o caixa dela.
  const linha = [{ ...caixaDono, closedAt: h("14:00") }, { ...caixaAna, id: "c-ana-2", openedAt: h("13:30"), closedAt: null }];
  exigir("pedido de fora com o dono aberto: caixa do dono", caixaPrincipalEm(h("13:45"), linha, LOJA) === "c-dono");
  exigir("pedido de fora com o dono fechado: o caixa aberto há mais tempo", caixaPrincipalEm(h("14:30"), linha, LOJA) === "c-ana-2");
  exigir("pedido de fora sem caixa aberto: nenhum caixa (como hoje)", caixaPrincipalEm(h("09:00"), linha, LOJA) === null);

  console.log("\n== 4. Quem vê quais caixas ==");
  const fechados = [caixaDono, caixaAna, { id: "antigo", abertoPor: { nome: "Thalyta", papel: "DONO" } }];
  exigir("o dono vê os caixas de todos", caixasVisiveis(fechados, { usuarioId: LOJA, souDono: true, porUsuario: true }).length === 3);
  exigir("o dono filtra pelos da Ana", caixasVisiveis(fechados, { usuarioId: LOJA, souDono: true, porUsuario: true, filtro: ANA }).map((x) => x.id).join() === "c-ana");
  exigir("a Ana vê só os dela", caixasVisiveis(fechados, { usuarioId: ANA, souDono: false, porUsuario: true }).map((x) => x.id).join() === "c-ana");
  exigir("desligado: o funcionário vê o histórico da loja, como sempre", caixasVisiveis(fechados, { usuarioId: ANA, souDono: false, porUsuario: false }).length === 3);

  console.log("\n== 5. Numeração ==");
  const dbCom = (lista: any[]) => ({ cashSession: {
    findFirst: async () => lista[0] || null,
    findMany: async () => lista,
  } });
  const fimDoTurno = { id: "ontem", closedAt: h("02:00"), abertoPor: null };
  const r1 = await numeracao.chaveDoContador(dbCom([fimDoTurno]), LOJA);
  exigir("desligado: zera no último fechamento, como sempre", r1.dateKey === "fechamento:ontem", r1);
  const r2 = await numeracao.chaveDoContador(dbCom([{ id: "c-ana", closedAt: h("13:00"), abertoPor: { ...quem(ANA, "Ana"), turnoContinua: true } }, fimDoTurno]), LOJA);
  exigir("a Ana fechou com o dono aberto: a numeração NÃO volta ao #1", r2.dateKey === "fechamento:ontem", r2);
  const r3 = await numeracao.chaveDoContador(dbCom([{ id: "c-dono", closedAt: h("23:00"), abertoPor: quem(LOJA, "Thalyta") }, fimDoTurno]), LOJA);
  exigir("o último caixa da loja fechou: a numeração zera nele", r3.dateKey === "fechamento:c-dono", r3);

  console.log(`\n${ok} ok, ${falhou} falhou`);
  process.exit(falhou > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
