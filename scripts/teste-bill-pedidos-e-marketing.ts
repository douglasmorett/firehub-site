/**
 * Os módulos de PEDIDOS e MARKETING do Bill (lib/assessor/modulos/pedidos.ts e
 * marketing.ts).
 *
 * Parte pura (sempre): as passagens de status que o Bill aceita (as dos botões
 * do card), a frase do que a plataforma respondeu (nunca "acompanhou" com
 * aviso), o cupom novo (código, %, R$, validade, 1º pedido repetido), como o
 * dono lê cupom e fidelidade, e que status de pedido não se desfaz.
 *
 * Parte de LEITURA (opcional, banco de PRODUÇÃO): com LOJA=<id>, lista os
 * cupons, os clientes sumidos e a configuração do cashback, e acha o pedido #1
 * de hoje. Nada grava nem chama iFood/99.
 *
 *   npx tsx --env-file=.env scripts/teste-bill-pedidos-e-marketing.ts
 *   LOJA=<id> npx tsx --env-file=.env scripts/teste-bill-pedidos-e-marketing.ts
 */
import assert from "node:assert/strict";
import { MODULO_PEDIDOS, recusaDoStatus, respostaDaPlataforma, acharPedido } from "../src/lib/assessor/modulos/pedidos";
import { MODULO_MARKETING, novoCupom, cupomParaDono, fidelidadeParaDono } from "../src/lib/assessor/modulos/marketing";
import { lerCupons } from "../src/lib/cupons";

let passou = 0;
const caso = (nome: string, fn: () => void) => {
  fn();
  passou++;
  console.log(`  ok  ${nome}`);
};

(async () => {
  console.log("Pedidos — passagens de status");
  const entrega = (status: string) => ({ status, deliveryType: "DELIVERY" });
  const retirada = (status: string) => ({ status, deliveryType: "RETIRADA" });
  caso("aceitar o NOVO", () => assert.equal(recusaDoStatus(entrega("NOVO"), "ACEITO"), null));
  caso("em preparo só depois de aceito", () => {
    assert.match(String(recusaDoStatus(entrega("NOVO"), "PREPARANDO")), /não foi aceito/);
    assert.equal(recusaDoStatus(entrega("ACEITO"), "PREPARANDO"), null);
  });
  caso("pronto é da retirada; na entrega é o selo da cozinha", () => {
    assert.equal(recusaDoStatus(retirada("PREPARANDO"), "PRONTO"), null);
    assert.match(String(recusaDoStatus(entrega("PREPARANDO"), "PRONTO")), /selo da cozinha/);
  });
  caso("saiu para entrega só em pedido de entrega", () => {
    assert.equal(recusaDoStatus(entrega("ACEITO"), "SAIU_ENTREGA"), null);
    assert.equal(recusaDoStatus(entrega("PRONTO"), "SAIU_ENTREGA"), null);
    assert.match(String(recusaDoStatus(retirada("ACEITO"), "SAIU_ENTREGA")), /não é de entrega/);
  });
  caso("entregue a partir de saiu/pronto", () => {
    assert.equal(recusaDoStatus(entrega("SAIU_ENTREGA"), "ENTREGUE"), null);
    assert.equal(recusaDoStatus(retirada("PRONTO"), "ENTREGUE"), null);
  });
  caso("cancelado, entregue, rascunho e esperando pagamento ficam no painel", () => {
    assert.match(String(recusaDoStatus(entrega("CANCELADO"), "ACEITO")), /painel/);
    assert.match(String(recusaDoStatus(entrega("ENTREGUE"), "SAIU_ENTREGA")), /painel/);
    assert.match(String(recusaDoStatus(entrega("CRIANDO_IA"), "ACEITO")), /rascunho/);
    assert.match(String(recusaDoStatus(entrega("AGUARDANDO_PAGAMENTO"), "ACEITO")), /pagamento/);
  });
  caso("voltar para trás não passa (SAIU → ACEITO)", () => assert.ok(recusaDoStatus(entrega("SAIU_ENTREGA"), "ACEITO")));
  caso("CANCELADO não é por mudar_status (é cancelar_pedido)", () => assert.match(String(recusaDoStatus(entrega("NOVO"), "CANCELADO")), /cancelar_pedido/));
  caso("mesmo status passa (a rota responde sem mudança)", () => assert.equal(recusaDoStatus(entrega("ACEITO"), "ACEITO"), null));

  console.log("Pedidos — o que a plataforma respondeu");
  const ifood = { chave: "IFOOD", nome: "iFood", ehMarketplace: true };
  caso("iFood sem aviso = respondeu ok", () => assert.equal(respostaDaPlataforma(ifood, { success: true, avisoIfood: null })?.acompanhou, true));
  caso("iFood com aviso NUNCA diz que acompanhou", () => {
    const r = respostaDaPlataforma(ifood, { success: true, avisoIfood: "token vencido" })!;
    assert.equal(r.acompanhou, false);
    assert.match(r.frase, /NÃO acompanhou: token vencido/);
  });
  caso("99 lê o aviso dele", () => assert.equal(respostaDaPlataforma({ chave: "99FOOD", nome: "99Food", ehMarketplace: true }, { aviso99Food: "x" })?.acompanhou, false));
  caso("JotaJá não devolve confirmação: não afirma", () => assert.equal(respostaDaPlataforma({ chave: "JOTAJA", nome: "Jotajá", ehMarketplace: true }, {})?.acompanhou, null));
  caso("pedido do site não tem plataforma", () => assert.equal(respostaDaPlataforma({ chave: "SITE", nome: "Online", ehMarketplace: false }, {}), null));

  console.log("Pedidos — o módulo");
  const ctxFalso = { franchiseeId: "loja-teste", usuarioId: "dono-teste", canal: "PAINEL" as const };
  caso("declara as três ações e todas gravam", () => {
    assert.deepEqual(MODULO_PEDIDOS.declaracoes.map((d) => d.name), ["mudar_status_do_pedido", "cancelar_pedido", "atribuir_motoboy"]);
    assert.deepEqual(MODULO_PEDIDOS.gravam, ["mudar_status_do_pedido", "cancelar_pedido", "atribuir_motoboy"]);
  });
  assert.equal(await MODULO_PEDIDOS.executar("cupons", {}, ctxFalso), null);
  assert.match(String((await MODULO_PEDIDOS.desfazer!("PEDIDO_STATUS", {}, ctxFalso))?.erro), /painel de pedidos/);
  assert.match(String((await MODULO_PEDIDOS.desfazer!("PEDIDO_CANCELADO", {}, ctxFalso))?.erro), /painel de pedidos/);
  assert.equal(await MODULO_PEDIDOS.desfazer!("MKT_CUPOM_CRIADO", {}, ctxFalso), null);
  caso("status e cancelamento não se desfazem; tipo alheio não é dele", () => {});

  console.log("Marketing — cupom novo");
  const hoje = "2026-11-19";
  const existentes = [{ code: "VOLTA10", discount: 10, type: "percent", active: true }, { code: "PRIMEIROPEDIDO", discount: 10, type: "percent", active: true, primeiroPedido: true }];
  caso("% com mínimo, validade e usos, como a tela grava", () => {
    const r = novoCupom({ codigo: "pizza 15", tipo: "percent", valor: 15, minimo: 50, validade: "2026-11-30", usosPorCliente: 1 }, existentes, hoje);
    assert.ok(r.ok);
    assert.deepEqual(r.ok && r.cupom, { code: "PIZZA15", discount: 15, type: "percent", active: true, minOrderValue: 50, validade: "2026-11-30", usosPorCliente: 1 });
  });
  caso("R$ fixo e frete grátis", () => {
    const fixo = novoCupom({ codigo: "MENOS5", tipo: "fixed", valor: "5,50" }, [], hoje);
    assert.ok(fixo.ok && fixo.cupom.discount === 5.5 && fixo.cupom.type === "fixed");
    const frete = novoCupom({ codigo: "FRETE", tipo: "free_shipping" }, [], hoje);
    assert.ok(frete.ok && frete.cupom.type === "free_shipping");
  });
  caso("recusa código repetido, % fora de 1–100, validade passada e 2º cupom de 1º pedido", () => {
    assert.match(String((novoCupom({ codigo: "volta10", valor: 5 }, existentes, hoje) as any).erro), /Já existe/);
    assert.match(String((novoCupom({ codigo: "X100", valor: 150 }, [], hoje) as any).erro), /porcentagem/);
    assert.match(String((novoCupom({ codigo: "VELHO", valor: 5, validade: "2026-11-01" }, [], hoje) as any).erro), /já passou/);
    assert.match(String((novoCupom({ codigo: "BEMVINDO", valor: 5, primeiroPedido: true }, existentes, hoje) as any).erro), /1º pedido ativo/);
    assert.match(String((novoCupom({ codigo: "a" }, [], hoje) as any).erro), /3 a 30/);
  });
  caso("como o dono lê o cupom", () => {
    const [c] = lerCupons([{ code: "FIM", discount: 10, type: "percent", active: true, validade: "2026-11-10", minOrderValue: 40 }]);
    const d = cupomParaDono(c, hoje);
    assert.equal(d.situacao, "vencido");
    assert.match(d.regras, /pedido mínimo R\$ 40,00/);
    assert.equal(cupomParaDono(lerCupons([{ code: "P", discount: 5, active: false }])[0], hoje).situacao, "pausado");
  });

  console.log("Marketing — fidelidade e o módulo");
  caso("cashback ligado e desligado", () => {
    const lig = fidelidadeParaDono({ cashbackActive: true, rate: 5, minOrderValue: 30, expiresInDays: 60 });
    assert.equal(lig.cashback.situacao, "ligado");
    assert.equal((lig.cashback as any).percentual, "5%");
    assert.equal(fidelidadeParaDono({ cashbackActive: false, rate: 3 }).cashback.situacao, "desligado");
    assert.equal(fidelidadeParaDono(null).trilhaPremiada, "desligada");
  });
  caso("gravam só cupons e mudar_cashback; leitura não grava", () => {
    assert.deepEqual(MODULO_MARKETING.gravam, ["cupons", "mudar_cashback"]);
    assert.ok(!MODULO_MARKETING.declaracoes.some((d) => /disparo|campanha|enviar/i.test(d.name)));
  });
  assert.equal(await MODULO_MARKETING.executar("cancelar_pedido", {}, ctxFalso), null);
  assert.equal(await MODULO_MARKETING.desfazer!("PEDIDO_STATUS", {}, ctxFalso), null);
  caso("tipo alheio não é do marketing", () => {});

  console.log(`\n${passou} casos puros passaram.`);

  const LOJA = process.env.LOJA;
  if (!LOJA) {
    console.log("(sem LOJA=<id>: parte de leitura no banco pulada)");
    return;
  }
  console.log(`\nLeitura na loja ${LOJA} (nada grava):`);
  const ctx = { franchiseeId: LOJA, usuarioId: LOJA, canal: "PAINEL" as const };
  const cupons = await MODULO_MARKETING.executar("cupons", { acao: "listar" }, ctx);
  console.log("cupons:", JSON.stringify(cupons, null, 1));
  const sumidos: any = await MODULO_MARKETING.executar("clientes_sumidos", { dias: 30, limite: 3 }, ctx);
  assert.ok(sumidos?.ok);
  console.log("sumidos (3):", JSON.stringify(sumidos.sumidos.map((c: any) => ({ ...c, telefone: `…${String(c.telefone).slice(-4)}` }))));
  console.log("melhores (3):", JSON.stringify(sumidos.melhoresDoPeriodo.map((c: any) => ({ ...c, telefone: `…${String(c.telefone).slice(-4)}` }))));
  const fid = await MODULO_MARKETING.executar("cashback_e_fidelidade", {}, ctx);
  console.log("fidelidade:", JSON.stringify(fid));
  const p1 = await acharPedido({ numero: 1 }, ctx);
  console.log("pedido #1 de hoje:", p1.ok ? `achado (${p1.pedido.status}, ${p1.pedido.deliveryType})` : (p1 as any).erro);
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
