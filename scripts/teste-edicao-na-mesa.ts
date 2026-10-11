// O lápis do card de mesa no quadro de Pedidos (lib/edicao-de-pedido.ts,
// avaliarEdicaoDaMesa) e a conta da rodada (lib/edicao-na-mesa.ts,
// planejarEdicaoNaMesa). Sem banco: as duas são funções puras.
//   npx tsx scripts/teste-edicao-na-mesa.ts   (com a aba renderizada: renderToStaticMarkup)
import {
  avaliarEdicao,
  avaliarEdicaoDaMesa,
  avaliarEdicaoNoPainel,
  descontoNaEdicao,
} from "../src/lib/edicao-de-pedido";
import { planejarEdicaoNaMesa } from "../src/lib/edicao-na-mesa";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EditarPedidoPainel from "../src/components/customer/EditarPedidoPainel";

let falhas = 0;
const ok = (cond: boolean, nome: string, detalhe?: unknown) => {
  if (!cond) falhas++;
  console.log(`${cond ? "✓" : "✗"} ${nome}${cond ? "" : ` → ${JSON.stringify(detalhe)}`}`);
};

const DONO = { role: "FRANCHISEE", permissions: "" };
const FUNC_SEM = { role: "STAFF", permissions: "orders,kds,mesas" };
const FUNC_COM = { role: "STAFF", permissions: "orders,kds,editar_pedidos" };

// O card do print do Victor: "Mesa 1", R$ 35,90, N/A, em produção.
const rodada = {
  status: "PREPARANDO",
  source: "PRESENCIAL",
  deliveryType: "MESA",
  paymentMethod: "N/A",
  tableSessionId: "sess1",
  tableSession: { status: "OPEN", table: { number: 1 } },
};

console.log("\n== O lápis aparece no card de mesa ==");
const av = avaliarEdicaoNoPainel(rodada, DONO);
ok(av.modo === "MESA", "dono, mesa aberta → MESA", av);
ok(av.totalMuda === true, "na mesa o total acompanha", av);
ok(/Mesa 1/.test(av.motivo || ""), "a frase diz qual mesa", av.motivo);
ok(avaliarEdicaoNoPainel(rodada, FUNC_COM).modo === "MESA", "funcionário com 'editar pedidos' → MESA");
ok(avaliarEdicaoNoPainel(rodada, FUNC_SEM).modo === "BLOQUEADO", "funcionário sem a caixinha → sem lápis");

console.log("\n== Quando não aparece ==");
ok(avaliarEdicaoDaMesa({ ...rodada, tableSession: { status: "CLOSED", table: { number: 1 } } }, DONO).modo === "BLOQUEADO", "mesa fechada (paga) → sem lápis");
ok(/fechada/.test(avaliarEdicaoDaMesa({ ...rodada, tableSession: { status: "CLOSED" } }, DONO).motivo || ""), "mesa fechada diz que virou pagamento");
ok(avaliarEdicaoDaMesa({ ...rodada, status: "CANCELADO" }, DONO).modo === "BLOQUEADO", "rodada cancelada → sem lápis");
ok(avaliarEdicaoDaMesa({ ...rodada, fiscalStatus: "EMITTED" }, DONO).modo === "BLOQUEADO", "nota emitida → sem lápis (a rota da mesa recusa)");
ok(avaliarEdicaoDaMesa({ ...rodada, fiscalStatus: "EMITTED", fiscalInfo: { ambiente: 2, nfceKey: "x" } }, DONO).modo === "BLOQUEADO", "nota de homologação também trava na mesa (a rota recusa qualquer EMITTED)");
// Feed sem o status da conta: não esconde o lápis — quem decide é o servidor.
ok(avaliarEdicaoDaMesa({ ...rodada, tableSession: undefined }, DONO).modo === "MESA", "sem o status da conta → o servidor decide");
// "Finalizado" por fora com a mesa aberta continua editável ([[pedido-de-mesa-so-fecha-com-a-mesa]]).
ok(avaliarEdicaoDaMesa({ ...rodada, status: "ENTREGUE" }, DONO).modo === "MESA", "finalizado por fora com a mesa aberta → edita");

console.log("\n== O resto do painel continua vendo a mesa como bloqueada ==");
ok(avaliarEdicao(rodada, DONO).modo === "BLOQUEADO", "avaliarEdicao (troca de tipo, taxa) segue BLOQUEADO");
ok(avaliarEdicaoNoPainel({ status: "PREPARANDO", source: "ONLINE" }, DONO).modo === "COMPLETO", "pedido do site segue COMPLETO");
ok(avaliarEdicaoNoPainel({ status: "PREPARANDO", source: "IFOOD", ifoodOrderId: "x" }, DONO).modo === "MARKETPLACE", "iFood segue MARKETPLACE");

console.log("\n== Desconto é da conta, não da rodada ==");
const d = descontoNaEdicao(rodada, av);
ok(d.pode === false && /conta/.test((d as any).motivo), "desconto na rodada recusado com o porquê", d);

console.log("\n== A conta da rodada ==");
const itens = [
  { id: "a", productName: "X Burguer", quantity: 1, price: 25.9, menuProductId: "p1" },
  { id: "b", productName: "Coca lata", quantity: 2, price: 5, menuProductId: "p2" },
];
const r1 = planejarEdicaoNaMesa({ items: itens, deliveryFee: 0, discountTotal: 0 }, { removerItemIds: ["b"] }, true);
ok(r1.ok && r1.novoTotal === 25.9 && !r1.cancela && r1.acao === "REMOVEU" && r1.descricao === "−Coca lata", "tira a Coca: 35,90 → 25,90", r1);

const r2 = planejarEdicaoNaMesa({ items: itens, deliveryFee: 0, discountTotal: 0 }, { itens: [{ itemId: "b", quantity: 1 }] }, true);
ok(r2.ok && r2.novoTotal === 30.9 && r2.acao === "MUDOU_QTD" && r2.descricao === "Coca lata 2x → 1x", "Coca 2x → 1x: 30,90", r2);

const r3 = planejarEdicaoNaMesa({ items: itens, deliveryFee: 0, discountTotal: 0 }, { itens: [{ itemId: "a", quantity: 3 }] }, true);
ok(r3.ok && r3.novoTotal === 87.7 && JSON.stringify(r3.aumentos) === JSON.stringify([{ menuProductId: "p1", quantity: 2 }]), "aumentar confere só o aumento no estoque", r3);

const r4 = planejarEdicaoNaMesa({ items: itens, deliveryFee: 0, discountTotal: 0 }, { removerItemIds: ["a", "b"] }, true);
ok(r4.ok && r4.cancela === true, "tirou tudo → cancela a rodada", r4);

// Delivery que virou mesa (lib/troca-de-tipo.ts) guarda o desconto: a soma pura o apagaria.
const r5 = planejarEdicaoNaMesa({ items: itens, deliveryFee: 0, discountTotal: 4 }, { removerItemIds: ["b"] }, true);
ok(r5.ok && r5.novoTotal === 21.9, "desconto do pedido que virou mesa fica de pé", r5);

console.log("\n== Garçom sem 'remover item' ==");
const g1 = planejarEdicaoNaMesa({ items: itens, deliveryFee: 0, discountTotal: 0 }, { removerItemIds: ["b"] }, false);
ok(!g1.ok && g1.status === 403, "não remove", g1);
const g2 = planejarEdicaoNaMesa({ items: itens, deliveryFee: 0, discountTotal: 0 }, { itens: [{ itemId: "b", quantity: 1 }] }, false);
ok(!g2.ok && g2.status === 403, "não diminui", g2);
const g3 = planejarEdicaoNaMesa({ items: itens, deliveryFee: 0, discountTotal: 0 }, { itens: [{ itemId: "b", quantity: 3 }] }, false);
ok(g3.ok && g3.novoTotal === 40.9, "aumenta", g3);

console.log("\n== O que não vale ==");
const n1 = planejarEdicaoNaMesa({ items: itens, deliveryFee: 0, discountTotal: 0 }, {}, true);
ok(!n1.ok && n1.status === 400, "corpo vazio → 400", n1);
const n2 = planejarEdicaoNaMesa({ items: itens, deliveryFee: 0, discountTotal: 0 }, { removerItemIds: ["de-outro-pedido"] }, true);
ok(!n2.ok && n2.status === 400, "item de outro pedido não alcança nada", n2);
const n3 = planejarEdicaoNaMesa({ items: itens, deliveryFee: 0, discountTotal: 0 }, { itens: [{ itemId: "b", quantity: 2 }] }, true);
ok(!n3.ok, "a mesma quantidade não é mudança", n3);
const n4 = planejarEdicaoNaMesa({ items: itens, deliveryFee: 0, discountTotal: 0 }, { itens: [{ itemId: "b", quantity: 0 }] }, true);
ok(!n4.ok, "quantidade 0 não passa (tirar é pelo remover)", n4);

console.log("\n== A aba Editar itens, renderizada ==");
const html = renderToStaticMarkup(
  React.createElement(EditarPedidoPainel, {
    pedido: {
      ...rodada,
      id: "o1",
      totalAmount: 35.9,
      items: itens.map((i) => ({ id: i.id, productName: i.productName, quantity: i.quantity, price: i.price })),
    },
    operador: DONO,
    aoFechar: () => {},
    aoSalvar: () => {},
  })
);
ok(html.includes("Itens da rodada"), "título da lista é da rodada");
ok(html.includes("Rodada da Mesa 1"), "o recado da mesa vem no topo");
ok(!html.includes("Acrescentar item") && !html.includes("Escolher item do cardápio"), "sem acrescentar (item novo é rodada nova)");
ok(html.includes("Desconto de mesa é na conta"), "sem desconto, com o porquê");
ok(html.includes("Rodada hoje") && html.includes("R$ 35,90"), "o total de hoje da rodada aparece");
ok(html.includes("Salvar e reimprimir comanda"), "salvar reimprime a comanda (2ª via), como no delivery");

const htmlDelivery = renderToStaticMarkup(
  React.createElement(EditarPedidoPainel, {
    pedido: { id: "o2", status: "PREPARANDO", source: "ONLINE", deliveryType: "DELIVERY", totalAmount: 35.9, items: [] },
    operador: DONO,
    aoFechar: () => {},
    aoSalvar: () => {},
  })
);
ok(htmlDelivery.includes("Acrescentar item") && !htmlDelivery.includes("Itens da rodada"), "delivery segue com acrescentar");

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
