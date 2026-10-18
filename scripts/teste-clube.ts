/**
 * Clube do aplicativo (18/10/2026).
 *
 *   npx tsx scripts/teste-clube.ts
 *
 * Prova, sem banco:
 * 1) config: padrão R$ 29,90 / 15%, saneamento, só checkout da Cakto em https;
 * 2) situação: pago, tolerância de 3 dias, pendente, cancelado vale até o fim do pago;
 * 3) o mês novo soma a partir do que já estava pago (renovação adiantada não perde dias);
 * 4) desconto: 15% dos produtos a pagar, teto, nunca passa os produtos; etiqueta e leitura de volta;
 * 5) webhook da Cakto: eventos → ação, `data` em lista (disparo Agrupado), callback, trava do pagamento;
 * 6) link do checkout com callback e telefone 55;
 * 7) sessão do cliente: assina, confere, recusa adulterada e vencida;
 * 8) user agent do app; links das lojas de app.
 */
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || "segredo-de-teste";

import {
  CONFIG_PADRAO,
  descontoDoClube,
  ehDoAplicativo,
  etiquetaDoClube,
  lerConfigDoClube,
  linkDeCheckoutValido,
  novoPagoAte,
  situacaoDaAssinatura,
  valorDaEtiquetaDoClube,
} from "../src/lib/clube/regras";
import { acaoDoEvento, callbackValido, chaveDoPagamento, lerEventoDaCakto, linkDoCheckoutDoCliente } from "../src/lib/clube/cakto";
import { criarSessaoDoCliente, lerSessaoDoCliente } from "../src/lib/sessao-do-cliente";
import { linkDaLojaDeApps } from "../src/lib/app-da-loja/link-da-loja-de-apps";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n     obtido:   ${JSON.stringify(obtido)}\n     esperado: ${JSON.stringify(esperado)}`}`);
};
const DIA = 86_400_000;

// ── 1) Config ───────────────────────────────────────────────────────────────
confere("padrão: R$ 29,90 e 15%, desligado", [CONFIG_PADRAO.valor, CONFIG_PADRAO.percentual, CONFIG_PADRAO.ativo], [29.9, 15, false]);
confere("config vazia = padrão", lerConfigDoClube(null), CONFIG_PADRAO);
const cfg = lerConfigDoClube({ ativo: true, valor: "29,90", percentual: "15", teto: "", linkDoCheckout: "https://pay.cakto.com.br/abc123", nome: "  Clube Hakim  " });
confere("lê vírgula, teto vazio = sem teto, nome aparado", [cfg.valor, cfg.percentual, cfg.teto, cfg.nome, cfg.ativo], [29.9, 15, null, "Clube Hakim", true]);
confere("% fora da faixa volta ao padrão", lerConfigDoClube({ percentual: 90 }).percentual, 15);
confere("checkout só da Cakto", [linkDeCheckoutValido("https://pay.cakto.com.br/x"), linkDeCheckoutValido("https://evil.com/x"), linkDeCheckoutValido("http://pay.cakto.com.br/x")], ["https://pay.cakto.com.br/x", null, null]);

// ── 2) Situação ─────────────────────────────────────────────────────────────
const agora = new Date("2026-10-18T20:00:00Z");
const em = (dias: number) => new Date(agora.getTime() + dias * DIA).toISOString();
confere("sem linha = não assinante", situacaoDaAssinatura(null, agora), "nao_assinante");
confere("abriu o checkout e não pagou = não assinante", situacaoDaAssinatura({ status: "AGUARDANDO", pagoAte: null, desde: null }, agora), "nao_assinante");
confere("pago até daqui a 10 dias = ativo", situacaoDaAssinatura({ status: "ATIVO", pagoAte: em(10), desde: em(-20) }, agora), "ativo");
confere("venceu há 2 dias (tolerância de 3) = ativo", situacaoDaAssinatura({ status: "ATIVO", pagoAte: em(-2), desde: em(-33) }, agora), "ativo");
confere("venceu há 4 dias sem renovar = pendente", situacaoDaAssinatura({ status: "ATIVO", pagoAte: em(-4), desde: em(-35) }, agora), "pendente");
confere("renovação recusada = pendente (aviso para pagar)", situacaoDaAssinatura({ status: "PENDENTE", pagoAte: em(-1), desde: em(-32) }, agora), "pendente");
confere("cancelou com 5 dias pagos = ativo até acabar", situacaoDaAssinatura({ status: "CANCELADO", pagoAte: em(5), desde: em(-26) }, agora), "ativo");
confere("cancelou e o pago acabou = encerrado", situacaoDaAssinatura({ status: "CANCELADO", pagoAte: em(-1), desde: em(-32) }, agora), "encerrado");
confere("voltou a abrir o checkout depois de vencer = pendente", situacaoDaAssinatura({ status: "AGUARDANDO", pagoAte: em(-10), desde: em(-41) }, agora), "pendente");

// ── 3) Mês novo ─────────────────────────────────────────────────────────────
confere("1º pagamento: agora + 31 dias", novoPagoAte(null, agora), em(31));
confere("renovou 2 dias antes: soma no fim do pago", novoPagoAte(em(2), agora), em(33));
confere("pagou depois de vencido: conta de agora", novoPagoAte(em(-10), agora), em(31));

// ── 4) Desconto ─────────────────────────────────────────────────────────────
confere("15% de R$ 48,00 = R$ 7,20", descontoDoClube({ percentual: 15, teto: null }, 48), 7.2);
confere("teto R$ 10 num pedido de R$ 120", descontoDoClube({ percentual: 15, teto: 10 }, 120), 10);
confere("nada a pagar = nada de desconto", descontoDoClube({ percentual: 15, teto: null }, 0), 0);
confere("arredonda centavos (15% de 33,33)", descontoDoClube({ percentual: 15, teto: null }, 33.33), 5);
confere("etiqueta da comanda", etiquetaDoClube(15, 7.2), "[Clube 15%: -R$ 7,20]");
confere("relatório lê a etiqueta de volta", valorDaEtiquetaDoClube("[Clube 15%: -R$ 7,20] [Cupom: X] sem cebola"), 7.2);
confere("% quebrado e milhar", valorDaEtiquetaDoClube(`${etiquetaDoClube(12.5, 1234.5)} obs`), 1234.5);
confere("sem etiqueta = 0", valorDaEtiquetaDoClube("[Cupom: CLUBE10]"), 0);

// ── 5) Webhook da Cakto ─────────────────────────────────────────────────────
confere("eventos → ação", [
  acaoDoEvento("purchase_approved"), acaoDoEvento("subscription_renewed"), acaoDoEvento("subscription_late_recovered"),
  acaoDoEvento("subscription_created", "waiting_payment"), acaoDoEvento("subscription_created", "paid"),
  acaoDoEvento("subscription_renewal_refused"), acaoDoEvento("subscription_late"), acaoDoEvento("subscription_canceled"),
  acaoDoEvento("refund"), acaoDoEvento("chargeback"), acaoDoEvento("pix_gerado"), acaoDoEvento("checkout_abandonment"),
], ["pagou", "pagou", "pagou", null, "pagou", "atrasou", "atrasou", "cancelou", "estornou", "estornou", null, null]);

const corpo = {
  secret: "s3gr3do",
  event: "purchase_approved",
  data: {
    id: "ord_123", status: "paid", paymentMethod: "pix_auto", amount: 29.9, paidAt: "2026-10-18T19:59:00Z",
    callback: "clb-abcdefgh12345678",
    customer: { name: "Maria Souza", email: "Maria@Email.com", phone: "+55 (22) 99919-7179" },
    product: { name: "Clube Hakim" }, offer: { name: "Mensal", price: 29.9 },
    subscription: { id: "sub_9" },
  },
};
const ev = lerEventoDaCakto(corpo)!;
confere("lê o evento", [ev.acao, ev.pedidoId, ev.assinaturaId, ev.callback, ev.telefone, ev.email, ev.valor, ev.segredoDoCorpo],
  ["pagou", "ord_123", "sub_9", "clb-abcdefgh12345678", "5522999197179", "maria@email.com", 29.9, "s3gr3do"]);
const agrupado = lerEventoDaCakto({ event: "subscription_renewed", data: [{ id: "x", product: { name: "Outro" } }, { ...corpo.data, id: "ord_456" }] })!;
confere("disparo Agrupado: pega o item com callback", [agrupado.pedidoId, agrupado.callback], ["ord_456", "clb-abcdefgh12345678"]);
confere("trava: o mesmo pedido pago não soma dois meses", [chaveDoPagamento(ev), chaveDoPagamento({ ...ev, evento: "subscription_created" })], ["pago:ord_123", "pago:ord_123"]);
confere("trava do cancelamento é por evento", chaveDoPagamento({ acao: "cancelou", evento: "subscription_canceled", pedidoId: null, assinaturaId: "sub_9" }), "subscription_canceled:sub_9");
confere("subscription como texto", lerEventoDaCakto({ event: "subscription_canceled", data: { subscription: "sub_7" } })!.assinaturaId, "sub_7");
confere("callback inválido", [callbackValido("clb-abcdefgh12345678"), callbackValido("a b"), callbackValido("curto")], ["clb-abcdefgh12345678", null, null]);

// ── 6) Link do checkout ─────────────────────────────────────────────────────
const link = new URL(linkDoCheckoutDoCliente("https://pay.cakto.com.br/abc123", { callback: "clb-xyz12345678", nome: "Maria", telefone: "22999197179" }));
confere("link com callback, nome e telefone com 55", [link.searchParams.get("callback"), link.searchParams.get("name"), link.searchParams.get("phone")], ["clb-xyz12345678", "Maria", "5522999197179"]);
confere("telefone que já tem 55 não ganha outro", new URL(linkDoCheckoutDoCliente("https://pay.cakto.com.br/a", { callback: "clb-xyz12345678", telefone: "5522999197179" })).searchParams.get("phone"), "5522999197179");

// ── 7) Sessão ───────────────────────────────────────────────────────────────
const sessao = criarSessaoDoCliente("cli_1", "(22) 99919-7179", agora)!;
confere("sessão nasce no formato c1.", sessao.startsWith("c1."), true);
confere("sessão confere", lerSessaoDoCliente(sessao, agora), { clienteId: "cli_1", telefone: "22999197179" });
const [v, corpoDaSessao, ass] = sessao.split(".");
const forjada = `${v}.${Buffer.from(JSON.stringify({ i: "cli_2", p: "22999197179", e: 9999999999 })).toString("base64url")}.${ass}`;
confere("corpo trocado é recusado", lerSessaoDoCliente(forjada, agora), null);
confere("assinatura trocada é recusada", lerSessaoDoCliente(`${v}.${corpoDaSessao}.${"x".repeat(ass.length)}`, agora), null);
confere("vence em 180 dias", [lerSessaoDoCliente(sessao, new Date(agora.getTime() + 179 * DIA)) !== null, lerSessaoDoCliente(sessao, new Date(agora.getTime() + 181 * DIA))], [true, null]);
confere("lixo é recusado", [lerSessaoDoCliente(""), lerSessaoDoCliente(null), lerSessaoDoCliente("c1.a.b")], [null, null, null]);

// ── 8) App ──────────────────────────────────────────────────────────────────
confere("user agent do app", [
  ehDoAplicativo("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 FireHubApp/1 (hakim)"),
  ehDoAplicativo("Mozilla/5.0 (iPhone) AppleWebKit/605 FireHubApp/1 (hakim)"),
  ehDoAplicativo("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile"),
  ehDoAplicativo(null),
], [true, true, false, false]);
confere("links das lojas de app", [
  linkDaLojaDeApps("https://play.google.com/store/apps/details?id=br.com.hakimriodasostras.app", "android"),
  linkDaLojaDeApps("https://apps.apple.com/br/app/hakim-delivery/id6822140388", "ios"),
  linkDaLojaDeApps("https://play.google.com/store/apps/details", "android"),
  linkDaLojaDeApps("https://apps.apple.com/br/app/hakim", "ios"),
  linkDaLojaDeApps("https://evil.com/?id=1", "android"),
], [
  "https://play.google.com/store/apps/details?id=br.com.hakimriodasostras.app",
  "https://apps.apple.com/br/app/hakim-delivery/id6822140388",
  null, null, null,
]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
