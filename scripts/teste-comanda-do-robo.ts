/**
 * Teste da comanda que o robô manda ao fechar o pedido e do cashback no pedido
 * do robô. Rodar: npx tsx scripts/teste-comanda-do-robo.ts
 */
import assert from "node:assert/strict";
import { comandaDoRobo, cashbackDoClienteParaOPrompt } from "../src/lib/comanda-do-robo";
import { lerCashback, saldoDoCashback, pedidoComCashback } from "../src/lib/cashback";

let ok = 0;
const caso = (nome: string, f: () => void) => { f(); ok++; console.log("ok -", nome); };

caso("comanda completa de entrega com cashback", () => {
  const t = comandaDoRobo({
    numero: 5553, status: "ACEITO",
    itens: [{ quantity: 1, productName: "Yakisoba com lula e camarão", price: 30.89, comboSelections: { g1: { P: 1 }, g2: { Bacon: 2 } }, notes: "sem cebolinha" }],
    formaDePagamento: "Pix", entrega: true, taxaDeEntrega: 6, endereco: "Rua Raul Veiga, 389 - Braga, Cabo Frio",
    previsao: new Date("2026-10-05T03:12:00Z"), fuso: "America/Sao_Paulo",
    cashbackUsado: 2.19, cashbackGerado: 1.43, total: 34.7,
  });
  assert.match(t, /EM PRODUÇÃO/);
  assert.match(t, /Pedido nº 5553/);
  assert.match(t, /1x Yakisoba com lula e camarão — R\$ 30,89/);
  assert.match(t, /↳ P, Bacon x2/);
  assert.match(t, /Obs: sem cebolinha/);
  assert.match(t, /Pagamento:\* Pix/);
  assert.match(t, /Delivery\* \(taxa de entrega: R\$ 6,00\)/);
  assert.match(t, /Rua Raul Veiga, 389/);
  assert.match(t, /Previsão de entrega: até 00:12/);
  assert.match(t, /Cashback \(desconto\): -R\$ 2,19/);
  assert.match(t, /Total: R\$ 34,70/);
  assert.match(t, /vai te dar R\$ 1,43 de cashback/);
});

caso("retirada sem taxa, aguardando a loja, sem linhas vazias de valor", () => {
  const t = comandaDoRobo({
    numero: 12, status: "NOVO", itens: [{ quantity: 2, productName: "Coxinha", price: 5 }],
    formaDePagamento: "Dinheiro", trocoPara: 20, entrega: false, taxaDeEntrega: 0, total: 10,
  });
  assert.match(t, /Recebemos seu pedido/);
  assert.match(t, /Retirada na loja/);
  assert.match(t, /troco para R\$ 20,00/);
  assert.doesNotMatch(t, /Subtotal|Cashback|Taxa de entrega/);
});

caso("frete grátis por cupom e alteração", () => {
  const t = comandaDoRobo({
    numero: 7, status: "ACEITO", alterado: true, itens: [{ quantity: 1, productName: "Pizza", price: 50 }],
    formaDePagamento: "Cartão", entrega: true, taxaDeEntrega: 0, cupom: { code: "FRETE", desconto: 8, freteGratis: true }, total: 50,
  });
  assert.match(t, /ATUALIZADO/);
  assert.match(t, /entrega grátis pelo cupom FRETE/);
  assert.doesNotMatch(t, /Cupom FRETE: -/);
});

caso("prompt do cashback só com saldo", () => {
  assert.equal(cashbackDoClienteParaOPrompt({ saldo: 0, maxResgatePct: 50 }), "");
  const p = cashbackDoClienteParaOPrompt({ saldo: 12.5, maxResgatePct: 50 });
  assert.match(p, /R\$ 12,50 de saldo/);
  assert.match(p, /usarCashback/);
  assert.match(p, /até 50%/);
});

caso("pedido do robô entra no saldo; rascunho não", () => {
  assert.equal(pedidoComCashback({ source: "WHATSAPP_IA", status: "ENTREGUE" } as any), true);
  assert.equal(pedidoComCashback({ source: "WHATSAPP_IA", status: "CRIANDO_IA" } as any), false);
  assert.equal(pedidoComCashback({ source: "SITE", status: "ENTREGUE" } as any), true);
  assert.equal(pedidoComCashback({ source: "IFOOD", status: "ENTREGUE" } as any), false);
  const regra = lerCashback({ cashbackActive: true, rate: 5, maxRedeemPercent: 50 });
  const agora = new Date("2026-10-05T12:00:00Z");
  const s = saldoDoCashback(regra, [
    { id: "a", source: "WHATSAPP_IA", status: "ENTREGUE", createdAt: "2026-10-01T12:00:00Z", cashbackEarned: 4 },
    { id: "b", source: "WHATSAPP_IA", status: "ACEITO", createdAt: "2026-10-04T12:00:00Z", cashbackUsed: 1.5 },
    { id: "c", source: "WHATSAPP_IA", status: "CRIANDO_IA", createdAt: "2026-10-05T11:00:00Z", cashbackUsed: 2 },
  ] as any, agora);
  assert.equal(s.saldo, 2.5);
});

console.log(`\n${ok} casos ok`);

// ── Acréscimo a pedido já na loja (lib/acrescimo-do-pedido.ts) ──────────────
import { pedidoAtivoParaOPrompt, situacaoDoPedido, mensagemDaResposta, mensagemDoAcrescimoEnviado } from "../src/lib/acrescimo-do-pedido";

const base = { numero: 47, minutos: 35, itens: "1x Pizza Grande", total: 46, entrega: true, taxaDeEntrega: 6 };

caso("situação do pedido pelo status", () => {
  assert.equal(situacaoDoPedido("NOVO"), "NAO_ACEITO");
  assert.equal(situacaoDoPedido("PREPARANDO"), "NA_COZINHA");
  assert.equal(situacaoDoPedido("PRONTO"), "NA_COZINHA");
  assert.equal(situacaoDoPedido("SAIU_ENTREGA"), "SAIU");
  assert.equal(situacaoDoPedido("ENTREGUE"), "ENCERRADO");
});

caso("na cozinha: pergunta se quer acrescentar e ensina a tag", () => {
  const t = pedidoAtivoParaOPrompt({ ...base, status: "PREPARANDO" });
  assert.match(t, /Quer acrescentar nesse pedido\?/);
  assert.match(t, /"acrescentarAoPedido": 47/);
  assert.match(t, /SÓ os itens NOVOS/);
  assert.match(t, /NÃO diga que já foi incluído/);
});

caso("saiu para entrega: avisa que é pedido novo com nova taxa", () => {
  const t = pedidoAtivoParaOPrompt({ ...base, status: "SAIU_ENTREGA" });
  assert.match(t, /JÁ SAIU PARA ENTREGA/);
  assert.match(t, /a entrega é cobrada de novo \(a taxa foi R\$ 6,00/);
  assert.doesNotMatch(t, /acrescentarAoPedido": 47/);
});

caso("acréscimo esperando a loja: não emite outro", () => {
  const t = pedidoAtivoParaOPrompt({ ...base, status: "ACEITO", acrescimoPendente: "2x Coca 2L" });
  assert.match(t, /esperando a resposta da loja: 2x Coca 2L/);
  assert.match(t, /NÃO emita outra tag/);
});

caso("encerrado não vai ao prompt", () => {
  assert.equal(pedidoAtivoParaOPrompt({ ...base, status: "ENTREGUE" }), "");
});

caso("mensagens ao cliente", () => {
  const itens = [{ productName: "Coca 2L", quantity: 2, price: 12 }];
  assert.match(mensagemDoAcrescimoEnviado(47, itens), /pedido nº 47: 2x Coca 2L \(\+R\$ 24,00\)/);
  assert.match(mensagemDaResposta({ aceito: true, numero: 47, itens, novoTotal: 70 }), /Novo total: R\$ 70,00/);
  const recusa = mensagemDaResposta({ aceito: false, numero: 47, itens, textoDaLoja: "Acabou a Coca" });
  assert.match(recusa, /não conseguiu incluir 2x Coca 2L/);
  assert.match(recusa, /Acabou a Coca/);
});

console.log(`\n${ok} casos ok (com o acréscimo)`);
