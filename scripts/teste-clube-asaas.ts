/**
 * Clube do aplicativo no CARTÃO AUTOMÁTICO pelo Asaas da loja (18/10/2026).
 *
 *   npx tsx scripts/teste-clube-asaas.ts
 *
 * Prova, sem banco e sem Asaas de verdade (o HTTP vai para um Asaas FALSO em
 * localhost, via ASAAS_API_BASE_LOJA — padrão de scripts/teste-pix-online.ts):
 * 1) config: a da Hakim (link da Cakto, sem a forma) segue na Cakto e somando
 *    com cupom; clube novo é Asaas e não soma; faixas do painel; chamada;
 * 2) quem leva o desconto: só no app (user agent + instalação no Asaas),
 *    sessão do mesmo telefone, sócio em dia, cupom;
 * 3) o status do sócio pela assinatura e pelas cobranças do Asaas, a cada
 *    evento do webhook (pagou, cartão recusado, venceu, renovou, estorno,
 *    chargeback, cancelado);
 * 4) qual aviso do Asaas é do clube (o pagamento dos pedidos não muda);
 * 5) o checkout recorrente (cartão, mensal, cliente, sem split) e o link;
 * 6) o painel: sócio × não sócio pela régua da venda e o resumo do mês;
 * 7) HTTP contra o Asaas falso: cliente do sócio, checkout com a volta
 *    recusada, a assinatura que vale, cancelar, eventos do webhook;
 * 8) o script que o app põe na página (só nos domínios da loja).
 */
import http from "http";
import vm from "vm";
import type { AddressInfo } from "net";

let falhas = 0;
let ok = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const certo = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (certo) ok++;
  else falhas++;
  console.log(`${certo ? "✅" : "❌"} ${oQue}${certo ? "" : `\n     obtido:   ${JSON.stringify(obtido)}\n     esperado: ${JSON.stringify(esperado)}`}`);
};

// ── Asaas falso ─────────────────────────────────────────────────────────────
type Chamada = { metodo: string; caminho: string; corpo: any };
const chamadas: Chamada[] = [];
let clientes: any[] = [];
let assinaturas: any[] = [];
let cobrancasDaAssinatura: Record<string, any[]> = {};
let recusarVolta = false;
let eventosDoWebhook: string[] = [];

function responder(res: http.ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(corpo));
}

const servidor = http.createServer((req, res) => {
  let bruto = "";
  req.on("data", (p) => (bruto += p));
  req.on("end", () => {
    const corpo = bruto ? JSON.parse(bruto) : null;
    const url = new URL(req.url || "/", "http://x");
    const p = url.pathname;
    const m = req.method || "GET";
    chamadas.push({ metodo: m, caminho: p + url.search, corpo });
    if (p === "/customers" && m === "GET") {
      const ref = url.searchParams.get("externalReference");
      return responder(res, 200, { data: clientes.filter((c) => !ref || c.externalReference === ref) });
    }
    if (p === "/customers" && m === "POST") {
      const c = { id: `cus_${clientes.length + 1}`, ...corpo };
      clientes.push(c);
      return responder(res, 200, c);
    }
    if (p === "/checkouts" && m === "POST") {
      if (recusarVolta && !String(corpo.callback?.successUrl || "").startsWith("https://pizzaria.com.br")) {
        return responder(res, 400, { errors: [{ code: "invalid_callback", description: "O domínio da successUrl não é o do site cadastrado." }] });
      }
      return responder(res, 200, { id: "chk_abc", link: null, status: "ACTIVE", ...corpo });
    }
    if (p === "/subscriptions" && m === "GET") {
      const cus = url.searchParams.get("customer");
      return responder(res, 200, { data: assinaturas.filter((a) => a.customer === cus && !a.deleted) });
    }
    const mSub = /^\/subscriptions\/([^/]+)(\/payments)?$/.exec(p);
    if (mSub) {
      const a = assinaturas.find((x) => x.id === mSub[1]);
      if (!a) return responder(res, 404, { errors: [{ code: "not_found", description: "Assinatura não encontrada." }] });
      if (mSub[2]) return responder(res, 200, { data: cobrancasDaAssinatura[a.id] || [] });
      if (m === "DELETE") { a.deleted = true; return responder(res, 200, { deleted: true, id: a.id }); }
      return responder(res, 200, a);
    }
    if (p === "/webhooks/wh_1" && m === "GET") return responder(res, 200, { id: "wh_1", events: eventosDoWebhook });
    if (p === "/webhooks/wh_1" && m === "PUT") { eventosDoWebhook = corpo.events; return responder(res, 200, { id: "wh_1", events: corpo.events }); }
    return responder(res, 404, { errors: [{ code: "not_found", description: `Rota falsa não existe: ${p}` }] });
  });
});

const chaveFalsa = ["$aact", "prod", "000" + Buffer.from("chave-falsa-do-teste-clube").toString("base64")].join("_");

async function main() {
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", () => ok()));
  process.env.ASAAS_API_BASE_LOJA = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

  const R = await import("../src/lib/clube/regras");
  const A = await import("../src/lib/clube/asaas");
  const P = await import("../src/lib/clube/painel");
  const W = await import("../src/lib/asaas-da-loja");
  const { scriptDaInstalacao } = await import("../apps/loja/src/lib/instalacao-na-pagina");

  // ── 1) Config ─────────────────────────────────────────────────────────────
  console.log("\n== 1) Config ==");
  const hakim = R.lerConfigDoClube({ ativo: true, valor: 29.9, percentual: 15, teto: null, linkDoCheckout: "https://pay.cakto.com.br/abc", nome: "Clube Hakim" });
  confere("Hakim (gravada antes da forma, com link da Cakto) segue na Cakto", hakim.cobranca, "cakto");
  confere("Hakim segue somando com cupom (como já funcionava)", hakim.acumulaComCupom, true);
  confere("Hakim continua pronta para assinar sem Asaas", R.clubeProntoParaAssinar(hakim, false), true);
  const nova = R.lerConfigDoClube({ ativo: true, valor: "39,90", percentual: "10", chamada: "  Peça  com 10%   OFF sempre  " });
  confere("clube novo: Asaas, não soma com cupom", [nova.cobranca, nova.acumulaComCupom], ["asaas", false]);
  confere("chamada sem espaço sobrando", nova.chamada, "Peça com 10% OFF sempre");
  confere("Asaas sem a conta conectada não fica pronto", R.clubeProntoParaAssinar(nova, false), false);
  confere("Asaas conectado fica pronto", R.clubeProntoParaAssinar(nova, true), true);
  confere("a forma gravada vale mesmo com link da Cakto", R.lerConfigDoClube({ cobranca: "asaas", linkDoCheckout: "https://pay.cakto.com.br/x" }).cobranca, "asaas");
  confere("chamada corta em 80", (R.lerConfigDoClube({ chamada: "x".repeat(120) }).chamada || "").length, 80);
  confere("painel recusa 4%", R.problemaDaConfig(nova, { valor: 29.9, percentual: 4 }, true), "O desconto vai de 5% a 50%.");
  confere("painel recusa 51%", R.problemaDaConfig(nova, { valor: 29.9, percentual: 51 }, true), "O desconto vai de 5% a 50%.");
  confere("painel recusa mensalidade de R$ 2", R.problemaDaConfig(nova, { valor: 2, percentual: 10 }, true), "A mensalidade vai de R$ 5,00 a R$ 500,00.");
  confere("painel recusa ligar no cartão sem Asaas", R.problemaDaConfig(nova, { valor: 39.9, percentual: 10 }, false)?.startsWith("Para cobrar no cartão"), true);
  confere("painel aceita o clube certo", R.problemaDaConfig(nova, { valor: 39.9, percentual: 10 }, true), null);
  confere("painel aceita desligado sem Asaas", R.problemaDaConfig({ ...nova, ativo: false }, { valor: 39.9, percentual: 10 }, false), null);

  // ── 2) Quem leva o desconto ──────────────────────────────────────────────
  console.log("\n== 2) Só no app, só o sócio em dia ==");
  const UA_APP = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile FireHubApp/1 (hakim)";
  const UA_NAVEGADOR = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36";
  const base = { userAgent: UA_APP, cobranca: "asaas" as const, instalacaoConhecida: true, sessaoDoMesmoTelefone: true, situacao: "ativo" as const, cupomNoPedido: false, acumulaComCupom: false };
  confere("sócio em dia, no app, com a instalação: leva", R.veredictoDoClube(base), { ok: true });
  confere("no navegador do celular: não leva", R.veredictoDoClube({ ...base, userAgent: UA_NAVEGADOR }), { ok: false, motivo: "fora_do_app" });
  confere("user agent do app sem instalação conhecida (imitado): não leva", R.veredictoDoClube({ ...base, instalacaoConhecida: false }), { ok: false, motivo: "instalacao_desconhecida" });
  confere("Cakto (Hakim) segue só no user agent", R.veredictoDoClube({ ...base, cobranca: "cakto", instalacaoConhecida: false }), { ok: true });
  confere("sessão de outro telefone: não leva", R.veredictoDoClube({ ...base, sessaoDoMesmoTelefone: false }), { ok: false, motivo: "sem_sessao" });
  confere("cartão recusado (pendente): não leva", R.veredictoDoClube({ ...base, situacao: "pendente" }), { ok: false, motivo: "nao_ativo" });
  confere("com cupom e o clube não soma: não leva", R.veredictoDoClube({ ...base, cupomNoPedido: true }), { ok: false, motivo: "com_cupom" });
  confere("com cupom e o clube soma: leva", R.veredictoDoClube({ ...base, cupomNoPedido: true, acumulaComCupom: true }), { ok: true });
  confere("instalação do corpo: formato do app", [R.instalacaoDoCorpo("A".repeat(32)), R.instalacaoDoCorpo("curta"), R.instalacaoDoCorpo("x'; DROP--".padEnd(20, "x"))], ["A".repeat(32), null, null]);
  confere("o % sai sobre o preço já promocional (a base que o servidor passa)", R.descontoDoClube({ percentual: 10, teto: null }, 45), 4.5);

  // ── 3) Status pelo Asaas ─────────────────────────────────────────────────
  console.log("\n== 3) O status do sócio por evento ==");
  const agora = new Date("2026-10-18T15:00:00-03:00");
  const sub = { id: "sub_1", status: "ACTIVE", deleted: false, customer: "cus_1", dateCreated: "2026-10-18" };
  const situ = (r: ReturnType<typeof A.reconciliar>, quando = agora) => R.situacaoDaAssinatura({ status: r.status, pagoAte: r.pagoAte, desde: r.desde }, quando);

  let r = A.reconciliar(sub, [{ id: "pay_1", status: "PENDING", value: 29.9, dueDate: "2026-10-18" }], agora);
  confere("CHECKOUT criado, cartão ainda não aprovado: AGUARDANDO, sem desconto", [r.status, situ(r)], ["AGUARDANDO", "nao_assinante"]);

  r = A.reconciliar(sub, [{ id: "pay_1", status: "CONFIRMED", value: 29.9, netValue: 28.52, dueDate: "2026-10-18", confirmedDate: "2026-10-18" }], agora);
  confere("PAYMENT_CONFIRMED da 1ª: ATIVO, pago até 18/11 fim do dia", [r.status, r.pagoAte, situ(r), r.pagamentos], ["ATIVO", new Date("2026-11-18T23:59:59-03:00").toISOString(), "ativo", 1]);
  confere("mensalidade gravada com o líquido", r.mensalidades[0], { id: "pay_1", status: "CONFIRMED", valor: 29.9, valorLiquido: 28.52, vencimento: "2026-10-18", pagoEm: "2026-10-18" });

  const dia19 = new Date("2026-11-19T10:00:00-03:00");
  const renovacao = { id: "pay_2", status: "PENDING", value: 29.9, dueDate: "2026-11-18", invoiceUrl: "https://www.asaas.com/i/pay2" };
  r = A.reconciliar(sub, [{ id: "pay_1", status: "CONFIRMED", value: 29.9, dueDate: "2026-10-18", confirmedDate: "2026-10-18" }, { ...renovacao, status: "PENDING" }], dia19);
  confere("PAYMENT_CREDIT_CARD_CAPTURE_REFUSED (renovação de ontem sem passar): PENDENTE e sem desconto", [r.status, situ(r, dia19)], ["PENDENTE", "pendente"]);
  confere("a fatura em atraso fica à mão", r.emAtraso, { id: "pay_2", invoiceUrl: "https://www.asaas.com/i/pay2" });

  const dia18 = new Date("2026-11-18T10:00:00-03:00");
  r = A.reconciliar(sub, [{ id: "pay_1", status: "CONFIRMED", value: 29.9, dueDate: "2026-10-18", confirmedDate: "2026-10-18" }, renovacao], dia18);
  confere("no dia do vencimento (o Asaas ainda tenta): segue ATIVO", [r.status, situ(r, dia18)], ["ATIVO", "ativo"]);

  r = A.reconciliar(sub, [{ id: "pay_1", status: "CONFIRMED", value: 29.9, dueDate: "2026-10-18", confirmedDate: "2026-10-18" }, { ...renovacao, status: "OVERDUE" }], dia19);
  confere("PAYMENT_OVERDUE: PENDENTE", r.status, "PENDENTE");

  r = A.reconciliar(sub, [{ id: "pay_1", status: "CONFIRMED", value: 29.9, dueDate: "2026-10-18", confirmedDate: "2026-10-18" }, { ...renovacao, status: "CONFIRMED", confirmedDate: "2026-11-19" }], dia19);
  confere("nova tentativa aprovada: ATIVO até 18/12, 2 mensalidades", [r.status, r.pagoAte, r.pagamentos], ["ATIVO", new Date("2026-12-18T23:59:59-03:00").toISOString(), 2]);

  r = A.reconciliar({ ...sub, deleted: true }, [{ id: "pay_1", status: "CONFIRMED", value: 29.9, dueDate: "2026-10-18", confirmedDate: "2026-10-18" }], new Date("2026-10-25T12:00:00-03:00"));
  confere("SUBSCRIPTION_DELETED: CANCELADO, mas o mês pago vale", [r.status, situ(r, new Date("2026-10-25T12:00:00-03:00"))], ["CANCELADO", "ativo"]);
  confere("…e acabou o mês: encerrado", situ(r, new Date("2026-11-20T12:00:00-03:00")), "encerrado");
  confere("SUBSCRIPTION_INACTIVATED também cancela", A.reconciliar({ ...sub, status: "INACTIVE" }, [], agora).status, "CANCELADO");

  r = A.reconciliar(sub, [{ id: "pay_1", status: "REFUNDED", value: 29.9, dueDate: "2026-10-18", confirmedDate: "2026-10-18" }], agora);
  confere("PAYMENT_REFUNDED da única mensalidade: PENDENTE, sem desconto", [r.status, r.pagoAte, situ(r)], ["PENDENTE", null, "pendente"]);
  r = A.reconciliar(sub, [
    { id: "pay_1", status: "CONFIRMED", value: 29.9, dueDate: "2026-10-18", confirmedDate: "2026-10-18" },
    { id: "pay_2", status: "CHARGEBACK_REQUESTED", value: 29.9, dueDate: "2026-11-18", confirmedDate: "2026-11-18" },
  ], new Date("2026-11-25T12:00:00-03:00"));
  confere("PAYMENT_CHARGEBACK_REQUESTED: o mês contestado não cobre", [r.pagoAte, situ(r, new Date("2026-11-25T12:00:00-03:00"))], [new Date("2026-11-18T23:59:59-03:00").toISOString(), "pendente"]);
  confere("cobrança apagada não conta", A.reconciliar(sub, [{ id: "pay_x", status: "CONFIRMED", deleted: true, dueDate: "2026-10-18" }], agora).status, "AGUARDANDO");
  confere("31/01 + 1 mês = 28/02; 31/12 + 1 = 31/01", [A.maisUmMes("2026-01-31"), A.maisUmMes("2026-12-31"), A.maisUmMes("2028-01-31")], ["2026-02-28", "2027-01-31", "2028-02-29"]);
  confere("a assinatura que vale: a ativa mais nova", A.assinaturaQueVale([
    { id: "sub_velha", status: "ACTIVE", dateCreated: "2026-09-01" },
    { id: "sub_nova", status: "ACTIVE", dateCreated: "2026-10-01" },
    { id: "sub_apagada", status: "ACTIVE", deleted: true, dateCreated: "2026-10-10" },
  ])?.id, "sub_nova");

  // ── 4) Qual aviso é do clube ─────────────────────────────────────────────
  console.log("\n== 4) O aviso do Asaas ==");
  confere("cobrança do PEDIDO (sem assinatura): não é do clube", A.avisoDoClube({ event: "PAYMENT_RECEIVED", payment: { id: "pay_9", externalReference: "pedido:abc" } }), null);
  confere("cobrança da assinatura: é do clube", A.avisoDoClube({ event: "PAYMENT_CONFIRMED", payment: { id: "pay_1", subscription: "sub_1", customer: "cus_1" } }), { evento: "PAYMENT_CONFIRMED", assinaturaId: "sub_1", clienteId: "cus_1", checkoutId: null, assinanteId: null });
  confere("assinatura removida", A.avisoDoClube({ event: "SUBSCRIPTION_DELETED", subscription: { id: "sub_1", customer: "cus_1" } })?.assinaturaId, "sub_1");
  confere("checkout do clube pela referência", A.avisoDoClube({ event: "CHECKOUT_PAID", checkout: { id: "chk_abc", externalReference: "clube:s1", customer: "cus_1" } })?.assinanteId, "s1");
  confere("checkout que a loja fez por fora (sem cliente nem referência): não é do clube", A.avisoDoClube({ event: "CHECKOUT_PAID", checkout: { id: "chk_z" } }), null);
  confere("ACCESS_TOKEN_*: não é do clube", A.avisoDoClube({ event: "ACCESS_TOKEN_DISABLED" }), null);

  // ── 5) Checkout ──────────────────────────────────────────────────────────
  console.log("\n== 5) O checkout recorrente ==");
  const corpo = A.corpoDoCheckout({ clienteId: "cus_1", assinanteId: "s1", nomeDoClube: "Clube Pizzaria do Bairro Muito Comprido", valor: 29.9, percentual: 15, voltarPara: "https://firehubfood.com.br/loja/pizzaria", agora });
  confere("só cartão, recorrente", [corpo.billingTypes, corpo.chargeTypes], [["CREDIT_CARD"], ["RECURRENT"]]);
  confere("no cliente do sócio, com a referência", [corpo.customer, corpo.externalReference], ["cus_1", "clube:s1"]);
  confere("mensal, 1ª hoje", [corpo.subscription.cycle, corpo.subscription.nextDueDate], ["MONTHLY", "2026-10-18 00:00:00"]);
  confere("item: nome até 30, valor, com imagem", [corpo.items[0].name.length <= 30, corpo.items[0].value, corpo.items[0].imageBase64.length > 100], [true, 29.9, true]);
  confere("sem split: o FireHub não cobra nada do clube", "splits" in corpo || "split" in corpo, false);
  confere("volta ao cardápio com ?clube=ok", corpo.callback.successUrl, "https://firehubfood.com.br/loja/pizzaria?clube=ok");
  confere("link: o da resposta, senão o formato da documentação", [
    A.linkDoCheckout({ id: "chk_abc", link: null }, "producao"),
    A.linkDoCheckout({ id: "chk_abc", link: null }, "sandbox"),
    A.linkDoCheckout({ id: "chk_abc", link: "https://asaas.com/c/xyz" }, "producao"),
  ], ["https://asaas.com/checkoutSession/show?id=chk_abc", "https://sandbox.asaas.com/checkoutSession/show?id=chk_abc", "https://asaas.com/c/xyz"]);

  // ── 6) Painel ────────────────────────────────────────────────────────────
  console.log("\n== 6) O painel ==");
  const pedidos = [
    { telefone: "99990001", valor: 60, abre: true },
    { telefone: "99990001", valor: 50, abre: true },
    { telefone: "99990001", valor: 10, abre: false }, // acréscimo do mesmo pedido: valor sim, venda não
    { telefone: "99990002", valor: 40, abre: true },
    { telefone: "88880001", valor: 45, abre: true },
    { telefone: "88880002", valor: 35, abre: true },
    { telefone: "88880003", valor: 40, abre: true },
  ];
  const cmp = P.socioXNaoSocio(pedidos, new Set(["99990001", "99990002"]));
  confere("sócios: 2 clientes, 3 vendas, R$ 160, ticket 53,33, 1,5 pedido/cliente", [cmp.socios.clientes, cmp.socios.vendas, cmp.socios.valor, cmp.socios.ticket, cmp.socios.pedidosPorCliente], [2, 3, 160, 53.33, 1.5]);
  confere("não sócios: 3 clientes, 3 vendas, ticket 40", [cmp.naoSocios.clientes, cmp.naoSocios.vendas, cmp.naoSocios.ticket, cmp.naoSocios.pedidosPorCliente], [3, 3, 40, 1]);
  confere("sócio pede 1,5× e o ticket é 33,3% maior", [cmp.frequenciaVezes, cmp.ticketDiferencaPct], [1.5, 33.3]);
  confere("sem sócio, sem comparação", P.socioXNaoSocio(pedidos, new Set()).frequenciaVezes, null);
  const inicio = new Date("2026-10-01T08:00:00Z");
  const resumo = P.resumoDoMes({
    socios: [
      { situacao: "ativo", desde: "2026-10-05T15:00:00Z", canceladoEm: null },
      { situacao: "ativo", desde: "2026-09-10T15:00:00Z", canceladoEm: "2026-10-12T10:00:00Z" },
      { situacao: "pendente", desde: "2026-08-01T15:00:00Z", canceladoEm: null },
      { situacao: "encerrado", desde: "2026-07-01T15:00:00Z", canceladoEm: "2026-09-01T10:00:00Z" },
    ],
    inicioDoMes: inicio,
    mensalidades: { quantas: 3, bruto: 89.7, liquido: 85.56 },
    descontoNoMes: 31.2,
  });
  confere("resumo: 2 ativos, 1 sem pagamento, 1 novo, 1 cancelou no mês", [resumo.ativos, resumo.semPagamento, resumo.novos, resumo.cancelamentos], [2, 1, 1, 1]);
  confere("receita líquida − desconto = saldo", [resumo.receitaLiquida, resumo.desconto, resumo.saldo], [85.56, 31.2, 54.36]);

  // ── 7) HTTP contra o Asaas falso ─────────────────────────────────────────
  console.log("\n== 7) Asaas falso ==");
  const c1 = await A.clienteDoSocio(chaveFalsa, { assinanteId: "s1", nome: "Maria", cpf: "529.982.247-25", telefone: "5522999990001" });
  const criou = chamadas.find((c) => c.metodo === "POST" && c.caminho === "/customers")?.corpo;
  confere("cria o cliente do sócio", c1.dados?.id, "cus_1");
  confere("…sem notificação do Asaas, com a referência, CPF só dígitos, celular sem 55", [criou?.notificationDisabled, criou?.externalReference, criou?.cpfCnpj, criou?.mobilePhone], [true, "clube:s1", "52998224725", "22999990001"]);
  const c1b = await A.clienteDoSocio(chaveFalsa, { assinanteId: "s1", nome: "Maria", cpf: "52998224725", telefone: "" });
  confere("na segunda vez acha pela referência (não duplica)", [c1b.dados?.id, clientes.length], ["cus_1", 1]);

  recusarVolta = true;
  const ck = await A.criarCheckout(chaveFalsa, "producao", { clienteId: "cus_1", assinanteId: "s1", nomeDoClube: "Clube", valor: 29.9, percentual: 15, voltarPara: "https://firehubfood.com.br/loja/pizzaria", siteDaConta: "https://pizzaria.com.br", agora });
  const checkouts = chamadas.filter((c) => c.caminho === "/checkouts");
  confere("volta recusada: refaz com o site da conta", [checkouts.length, checkouts[1]?.corpo?.callback?.successUrl], [2, "https://pizzaria.com.br?clube=ok"]);
  confere("devolve o link do checkout", ck.dados?.link, "https://asaas.com/checkoutSession/show?id=chk_abc");
  recusarVolta = false;

  // O cliente pagou no checkout: o Asaas criou a assinatura no cliente dele.
  assinaturas = [{ id: "sub_1", customer: "cus_1", status: "ACTIVE", deleted: false, dateCreated: "2026-10-18" }];
  cobrancasDaAssinatura = { sub_1: [{ id: "pay_1", status: "CONFIRMED", value: 29.9, netValue: 28.52, dueDate: "2026-10-18", confirmedDate: "2026-10-18" }] };
  const lida = await A.lerAssinaturaDoSocio(chaveFalsa, { clienteId: "cus_1", assinaturaId: null });
  confere("acha a assinatura pelo cliente (sem saber o id)", [lida.dados?.assinatura?.id, lida.dados?.cobrancas.length], ["sub_1", 1]);
  confere("…e a leitura vira ATIVO", A.reconciliar(lida.dados!.assinatura, lida.dados!.cobrancas, agora).status, "ATIVO");
  const cancelou = await A.cancelarNoAsaas(chaveFalsa, "sub_1");
  confere("cancelar = DELETE da assinatura", [cancelou.ok, chamadas.at(-1)?.metodo, chamadas.at(-1)?.caminho], [true, "DELETE", "/subscriptions/sub_1"]);
  const depois = await A.lerAssinaturaDoSocio(chaveFalsa, { clienteId: "cus_1", assinaturaId: "sub_1" });
  confere("removida some da lista: lê pelo id guardado e fica CANCELADO", A.reconciliar(depois.dados!.assinatura, depois.dados!.cobrancas, agora).status, "CANCELADO");

  eventosDoWebhook = ["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"];
  confere("webhook antigo ganha os eventos do clube", await W.garantirEventosNoWebhook(chaveFalsa, "wh_1"), "atualizado");
  confere("…com a assinatura e o cartão recusado, sem perder os do pedido", ["SUBSCRIPTION_DELETED", "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED", "PAYMENT_RECEIVED", "CHECKOUT_PAID"].every((e) => eventosDoWebhook.includes(e)), true);
  confere("na segunda vez não mexe", await W.garantirEventosNoWebhook(chaveFalsa, "wh_1"), "ok");
  confere("nenhuma chamada saiu do localhost", chamadas.length > 0 && process.env.ASAAS_API_BASE_LOJA!.startsWith("http://127.0.0.1"), true);

  // ── 8) O script do app ───────────────────────────────────────────────────
  console.log("\n== 8) O app põe a instalação na página ==");
  const script = scriptDaInstalacao("Abc123Abc123Abc123Abc123Abc123Ab", "hakim", ["firehubfood.com.br", "www.firehubfood.com.br"]);
  const naLoja: any = { location: { hostname: "firehubfood.com.br" } };
  naLoja.window = naLoja;
  vm.runInNewContext(script, naLoja);
  confere("na página da loja: window.__FIREHUB_APP__", naLoja.__FIREHUB_APP__, { instalacaoId: "Abc123Abc123Abc123Abc123Abc123Ab", marca: "hakim" });
  const noAsaas: any = { location: { hostname: "asaas.com" } };
  noAsaas.window = noAsaas;
  vm.runInNewContext(script, noAsaas);
  confere("na página do Asaas: nada", noAsaas.__FIREHUB_APP__, undefined);

  servidor.close();
  console.log(`\n${falhas ? `❌ ${falhas} falha(s)` : "✅ tudo certo"} (${ok} conferências)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
