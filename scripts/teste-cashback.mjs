/**
 * Prova do cashback (lib/cashback.ts): quando entra, quando vence, quem pode
 * usar e quanto — sem banco.
 *
 *   node scripts/teste-cashback.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const paraJs = (arquivo) =>
  ts.transpileModule(readFileSync(arquivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const canal = "data:text/javascript," + encodeURIComponent(paraJs("src/lib/canal-do-pedido.ts"));
const js = paraJs("src/lib/cashback.ts").replace('from "./canal-do-pedido"', `from "${canal}"`);
const C = await import("data:text/javascript," + encodeURIComponent(js));

let falhas = 0;
const ok = (nome, cond, det) => { if (!cond) falhas++; console.log(`${cond ? "OK    " : "FALHOU"} ${nome}${cond ? "" : " → " + JSON.stringify(det)}`); };

const AGORA = new Date("2026-10-02T20:00:00Z");
const dia = (n) => new Date(AGORA.getTime() - n * 86_400_000);
const regra = C.lerCashback({ cashbackActive: true, rate: 5, minOrderValue: 20, maxRedeemPercent: 50, expiresInDays: 30 });
let n = 0;
const ped = (x) => ({ id: `p${++n}`, source: "ONLINE", status: "ENTREGUE", deliveryType: "DELIVERY", createdAt: dia(1), ...x });

// ── leitura da configuração
ok("configuração padrão da tela liga o cashback", regra.ativo && regra.taxa === 5 && regra.maxResgatePct === 50 && regra.validadeDias === 30);
ok("desligado na tela = desligado", !C.lerCashback({ cashbackActive: false, rate: 5 }).ativo);
ok("taxa zero não liga", !C.lerCashback({ cashbackActive: true, rate: 0 }).ativo);
ok("configuração vazia não liga", !C.lerCashback(null).ativo);

// ── quanto o pedido gera
ok("5% sobre o que foi pago pelos produtos", C.cashbackDoPedido(regra, 60, 60, 5) === 3);
ok("depois de cupom, incide sobre o pago", C.cashbackDoPedido(regra, 60, 50, 5) === 2.5);
ok("abaixo do mínimo não gera", C.cashbackDoPedido(regra, 19.9, 19.9, 5) === 0);
ok("o mínimo olha os produtos antes do desconto", C.cashbackDoPedido(regra, 25, 15, 5) === 0.75);
ok("desligado não gera", C.cashbackDoPedido(C.lerCashback({ cashbackActive: false, rate: 5 }), 100, 100, 5) === 0);

// ── nível VIP
const vip = C.lerCashback({ cashbackActive: true, rate: 5, vipActive: true, bronzeCashback: 0, silverCashback: 1, silverMinSpend: 150, goldCashback: 2, goldMinSpend: 350 });
ok("VIP bronze soma o bônus bronze", C.taxaDoCliente(vip, 50) === 5);
ok("VIP prata soma +1", C.taxaDoCliente(vip, 200) === 6);
ok("VIP ouro soma +2", C.taxaDoCliente(vip, 400) === 7);
ok("sem VIP, só a taxa da loja", C.taxaDoCliente(regra, 400) === 5);

// ── saldo
const s1 = C.saldoDoCashback(regra, [ped({ cashbackEarned: 3 })], AGORA);
ok("pedido entregue credita", s1.saldo === 3, s1);
ok("pedido ainda em preparo não credita", C.saldoDoCashback(regra, [ped({ status: "PREPARANDO", cashbackEarned: 3 })], AGORA).saldo === 0);
ok("pedido cancelado não credita", C.saldoDoCashback(regra, [ped({ status: "CANCELADO", cashbackEarned: 3 })], AGORA).saldo === 0);
ok("retirada parada em Pronto credita", C.saldoDoCashback(regra, [ped({ status: "PRONTO", deliveryType: "RETIRADA", cashbackEarned: 2 })], AGORA).saldo === 2);
ok("entrega em Pronto ainda não credita", C.saldoDoCashback(regra, [ped({ status: "PRONTO", cashbackEarned: 2 })], AGORA).saldo === 0);
ok("pedido do iFood não conta", C.saldoDoCashback(regra, [ped({ source: "IFOOD", ifoodOrderId: "x", cashbackEarned: 3 })], AGORA).saldo === 0);
ok("pedido do balcão não conta", C.saldoDoCashback(regra, [ped({ source: "PRESENCIAL", cashbackEarned: 3 })], AGORA).saldo === 0);

const s2 = C.saldoDoCashback(regra, [
  ped({ cashbackEarned: 5, createdAt: dia(10), deliveredAt: dia(10) }),
  ped({ status: "NOVO", cashbackUsed: 2, createdAt: dia(0) }),
], AGORA);
ok("uso em pedido aberto já desconta do saldo", s2.saldo === 3, s2);
const s3 = C.saldoDoCashback(regra, [
  ped({ cashbackEarned: 5, createdAt: dia(10), deliveredAt: dia(10) }),
  ped({ status: "CANCELADO", cashbackUsed: 2, createdAt: dia(0) }),
], AGORA);
ok("pedido cancelado devolve o que usou", s3.saldo === 5, s3);

const s4 = C.saldoDoCashback(regra, [ped({ cashbackEarned: 4, createdAt: dia(31), deliveredAt: dia(31) })], AGORA);
ok("crédito de 31 dias atrás venceu (validade 30)", s4.saldo === 0, s4);
const semValidade = C.lerCashback({ cashbackActive: true, rate: 5, expiresInDays: 0 });
ok("validade 0 = não vence", C.saldoDoCashback(semValidade, [ped({ cashbackEarned: 4, createdAt: dia(400), deliveredAt: dia(400) })], AGORA).saldo === 4);

const s5 = C.saldoDoCashback(regra, [
  ped({ cashbackEarned: 4, createdAt: dia(28), deliveredAt: dia(28) }),
  ped({ cashbackEarned: 3, createdAt: dia(5), deliveredAt: dia(5) }),
  ped({ cashbackUsed: 2, createdAt: dia(4) }),
], AGORA);
ok("uso consome o crédito mais velho primeiro", s5.saldo === 5 && s5.proximoVencimento?.valor === 2, s5);

const s6 = C.saldoDoCashback(regra, [
  ped({ cashbackEarned: 4, createdAt: dia(40), deliveredAt: dia(40) }),
  ped({ cashbackEarned: 3, createdAt: dia(5), deliveredAt: dia(5) }),
  ped({ cashbackUsed: 2, createdAt: dia(4) }),
], AGORA);
ok("uso depois do vencimento sai do crédito vivo", s6.saldo === 1, s6);
ok("o crédito entra quando foi entregue, não quando foi feito",
  C.saldoDoCashback(regra, [ped({ cashbackEarned: 4, createdAt: dia(35), deliveredAt: dia(20) })], AGORA).saldo === 4);

// ── resgate
ok("resgate limitado a 50% dos produtos", C.resgateMaximo(regra, 30, 40) === 20);
ok("resgate limitado ao saldo", C.resgateMaximo(regra, 5, 40) === 5);
ok("sem saldo, sem resgate", C.resgateMaximo(regra, 0, 40) === 0);

// ── gasto em 30 dias (VIP)
ok("gasto em 30 dias ignora cancelado e pedido velho", C.gastoEm30Dias([
  { status: "ENTREGUE", createdAt: dia(3), totalAmount: 100 },
  { status: "CANCELADO", createdAt: dia(3), totalAmount: 50 },
  { status: "ENTREGUE", createdAt: dia(40), totalAmount: 70 },
], AGORA) === 100);

// ── lançamento à mão (aba Clientes): saldo trazido de outro sistema, cortesia, correção
const aj = (valor, dias, x = {}) => ({ valor, createdAt: dia(dias), motivo: "teste", ...x });
ok("crédito manual sem pedido nenhum vira saldo", C.saldoDoCashback(regra, [], AGORA, [aj(25, 1)]).saldo === 25);
ok("crédito manual vence pela validade da loja", C.saldoDoCashback(regra, [], AGORA, [aj(25, 31)]).saldo === 0);
ok("crédito manual marcado 'não vence' não vence", C.saldoDoCashback(regra, [], AGORA, [aj(25, 400, { semVencimento: true })]).saldo === 25);
ok("débito manual tira do saldo", C.saldoDoCashback(regra, [ped({ cashbackEarned: 10, createdAt: dia(3), deliveredAt: dia(3) })], AGORA, [aj(-4, 1)]).saldo === 6);
ok("débito maior que o saldo não deixa negativo", C.saldoDoCashback(regra, [], AGORA, [aj(5, 3), aj(-9, 1)]).saldo === 0);
ok("pedido usa o crédito manual", C.saldoDoCashback(regra, [ped({ status: "NOVO", cashbackUsed: 8, createdAt: dia(0) })], AGORA, [aj(20, 2)]).saldo === 12);
const s7 = C.saldoDoCashback(regra, [ped({ cashbackEarned: 4, createdAt: dia(25), deliveredAt: dia(25) })], AGORA, [aj(10, 2, { semVencimento: true }), aj(-3, 1)]);
ok("débito consome o lote mais velho (o do pedido), o que não vence fica", s7.saldo === 11 && s7.proximoVencimento?.valor === 1, s7);

// ── extrato do painel
const ex = C.extratoDoCashback(regra, [
  ped({ id: "pA", dailyOrderNumber: 12, cashbackEarned: 4, createdAt: dia(40), deliveredAt: dia(40) }),
  ped({ id: "pB", dailyOrderNumber: 30, cashbackEarned: 3, createdAt: dia(5), deliveredAt: dia(5) }),
  ped({ id: "pC", status: "PREPARANDO", cashbackEarned: 2, createdAt: dia(0) }),
  ped({ id: "pD", status: "NOVO", cashbackUsed: 1, createdAt: dia(0) }),
], [aj(20, 3, { motivo: "Saldo do Gama" })], AGORA);
const tipos = ex.movimentos.map((m) => m.tipo).join(",");
ok("extrato: do mais novo ao mais velho, com o vencimento no meio", tipos === "uso,credito_manual,ganho,vencido,ganho", tipos);
ok("extrato: saldo final bate com o saldo", ex.saldo === 22 && ex.movimentos[0].saldoDepois === 22, ex);
ok("extrato: o vencido sai com o valor que sobrou do lote", ex.movimentos.find((m) => m.tipo === "vencido")?.valor === -4);
ok("extrato: pedido ainda não entregue fica em 'a receber'", ex.aReceber === 2);
ok("extrato: movimento do pedido leva o número", ex.movimentos.find((m) => m.pedidoId === "pB")?.pedidoNumero === 30);
ok("extrato: o lançamento leva o motivo", ex.movimentos.find((m) => m.tipo === "credito_manual")?.motivo === "Saldo do Gama");
ok("o saldo do cardápio e o do extrato são o mesmo", C.saldoDoCashback(regra, [
  ped({ cashbackEarned: 4, createdAt: dia(40), deliveredAt: dia(40) }),
  ped({ cashbackEarned: 3, createdAt: dia(5), deliveredAt: dia(5) }),
  ped({ status: "NOVO", cashbackUsed: 1, createdAt: dia(0) }),
], AGORA, [aj(20, 3)]).saldo === ex.saldo);

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
