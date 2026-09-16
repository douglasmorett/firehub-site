/**
 * Harness da regra de edição de pedido. Roda o TS de src/lib direto, via jiti,
 * com o alias "@" apontando para src (é o que o tsconfig faz no app).
 *
 * Não toca no banco: a regra é função pura, e é exatamente por isso que ela foi
 * separada em lib/edicao-de-pedido.ts em vez de morar dentro da rota.
 */
const path = require("path");
const createJiti = require("jiti");

const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "..", "src") },
  interopDefault: true,
  esmResolve: true,
});

const { avaliarEdicao, recalcularTotal, podeEditarPedidos, empilharEdicao } =
  jiti(path.resolve(__dirname, "..", "src", "lib", "edicao-de-pedido.ts"));

let ok = 0;
let falhou = 0;
function conferir(nome, real, esperado) {
  const bate = JSON.stringify(real) === JSON.stringify(esperado);
  if (bate) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}\n         esperado: ${JSON.stringify(esperado)}\n         veio:     ${JSON.stringify(real)}`); }
}

const DONO = { role: "FRANCHISEE", permissions: "" };
const FUNC_SEM = { role: "STAFF", permissions: "orders,kds,venda_presencial" };
const FUNC_COM = { role: "STAFF", permissions: "orders,kds,editar_pedidos" };

console.log("\n== Quem pode editar ==");
conferir("dono pode", podeEditarPedidos(DONO), true);
conferir("admin pode", podeEditarPedidos({ role: "ADMIN", permissions: "" }), true);
conferir("funcionario SEM a permissao nao pode", podeEditarPedidos(FUNC_SEM), false);
conferir("funcionario COM a permissao pode", podeEditarPedidos(FUNC_COM), true);
conferir("funcionario antigo (csv sem a chave) nao pode", podeEditarPedidos({ role: "STAFF", permissions: "dashboard,orders,kds,venda_presencial,cardapio,estoque,motoboys,financeiro,ifood,impressoras,minha_loja" }), false);

console.log("\n== Canal e status ==");
const proprio = { status: "PREPARANDO", source: "PRESENCIAL" };
conferir("pedido proprio em preparo -> COMPLETO", avaliarEdicao(proprio, DONO).modo, "COMPLETO");
conferir("pedido do site -> COMPLETO", avaliarEdicao({ status: "ACEITO", source: "ONLINE" }, DONO).modo, "COMPLETO");
conferir("whatsapp IA -> COMPLETO", avaliarEdicao({ status: "ACEITO", source: "WHATSAPP_IA" }, DONO).modo, "COMPLETO");
conferir("iFood -> SO_ACRESCIMO", avaliarEdicao({ status: "PREPARANDO", source: "IFOOD", ifoodOrderId: "x" }, DONO).modo, "SO_ACRESCIMO");
conferir("99Food -> SO_ACRESCIMO", avaliarEdicao({ status: "PREPARANDO", source: "99FOOD", openDeliveryChannel: "99FOOD" }, DONO).modo, "SO_ACRESCIMO");
conferir("Brendi -> SO_ACRESCIMO", avaliarEdicao({ status: "ACEITO", source: "BRENDI", openDeliveryChannel: "BRENDI" }, DONO).modo, "SO_ACRESCIMO");
conferir("Wabiz -> SO_ACRESCIMO", avaliarEdicao({ status: "ACEITO", source: "WABIZ", openDeliveryChannel: "WABIZ" }, DONO).modo, "SO_ACRESCIMO");
conferir("Jotaja -> SO_ACRESCIMO", avaliarEdicao({ status: "ACEITO", source: "JOTAJA", openDeliveryOrderId: "y" }, DONO).modo, "SO_ACRESCIMO");

console.log("\n== A janela que o dono escolheu (ate sair para entrega) ==");
for (const s of ["NOVO", "CONFIRMADO", "ACEITO", "PREPARANDO", "EM_PREPARO", "PRONTO"]) {
  conferir(`${s} -> edita`, avaliarEdicao({ status: s, source: "PRESENCIAL" }, DONO).modo, "COMPLETO");
}
for (const s of ["SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "EM_ROTA", "ENTREGUE", "ENCERRADO", "CANCELADO", "CANCELLED", "CANCELED", "AGUARDANDO_PAGAMENTO", "CRIANDO_IA", "STATUS_QUE_NAO_EXISTE"]) {
  conferir(`${s} -> bloqueado`, avaliarEdicao({ status: s, source: "PRESENCIAL" }, DONO).modo, "BLOQUEADO");
}

console.log("\n== Mesa tem tela propria ==");
conferir("pedido de mesa -> bloqueado", avaliarEdicao({ status: "ACEITO", source: "PRESENCIAL", tableSessionId: "sess1" }, DONO).modo, "BLOQUEADO");

console.log("\n== Permissao vence antes de tudo ==");
conferir("funcionario sem permissao, pedido perfeito -> bloqueado", avaliarEdicao(proprio, FUNC_SEM).modo, "BLOQUEADO");
conferir("funcionario com permissao -> COMPLETO", avaliarEdicao(proprio, FUNC_COM).modo, "COMPLETO");

console.log("\n== A conta: itens - desconto + taxa ==");
conferir("so itens", recalcularTotal({ itens: [{ price: 12, quantity: 2 }] }), 24);
conferir("com taxa de entrega", recalcularTotal({ itens: [{ price: 12, quantity: 2 }], deliveryFee: 5 }), 29);
conferir("com desconto", recalcularTotal({ itens: [{ price: 12, quantity: 2 }], discountTotal: 4 }), 20);
conferir("taxa + desconto", recalcularTotal({ itens: [{ price: 12, quantity: 2 }], deliveryFee: 5, discountTotal: 4 }), 25);
conferir("centavos quebrados (29.9 x 3)", recalcularTotal({ itens: [{ price: 29.9, quantity: 3 }] }), 89.7);
conferir("nunca negativo", recalcularTotal({ itens: [{ price: 10, quantity: 1 }], discountTotal: 50 }), 0);
conferir("sem item sobra a taxa", recalcularTotal({ itens: [], deliveryFee: 5 }), 5);

console.log("\n== O caso que a conta da mesa erraria ==");
// Pedido real: 2 pastéis de 12 + taxa de 5 = 29. Tirando 1 pastel:
const semUmPastel = recalcularTotal({ itens: [{ price: 12, quantity: 1 }], deliveryFee: 5 });
conferir("tirar 1 item preserva a taxa (17, nao 12)", semUmPastel, 17);

console.log("\n== Rastro ==");
const h1 = empilharEdicao(null, { quando: "x", quem: "a", acao: "REMOVEU", descricao: "d", totalAntes: 1, totalDepois: 2 });
conferir("comeca do nada", h1.length, 1);
const h2 = empilharEdicao(h1, { quando: "y", quem: "b", acao: "ACRESCENTOU", descricao: "e", totalAntes: 2, totalDepois: 3 });
conferir("empilha sem perder", h2.length, 2);
conferir("preserva o primeiro", h2[0].quem, "a");
let grande = null;
for (let i = 0; i < 60; i++) grande = empilharEdicao(grande, { quando: String(i), quem: "z", acao: "REMOVEU", descricao: "d", totalAntes: 0, totalDepois: 0 });
conferir("teto de 50", grande.length, 50);
conferir("mantem os ULTIMOS", grande[49].quando, "59");

console.log(`\n${ok} ok, ${falhou} falharam\n`);
process.exit(falhou > 0 ? 1 : 0);
