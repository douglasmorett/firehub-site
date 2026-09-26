/**
 * scripts/teste-pedido-esperando-loja.tsx — as duas telas do pedido que o robô
 * segurou (regra do dono, 25/09/2026), desenhadas sem navegador e sem rede:
 *   - o aviso "Pedido do WhatsApp esperando você" (AvisoPedidoEsperandoLoja);
 *   - a janela "Finalizar pedido manualmente" (FinalizarPedidoDoRobo), no
 *     primeiro quadro, antes de o rascunho chegar do servidor.
 *
 *   npx tsx scripts/teste-pedido-esperando-loja.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AvisoPedidoEsperandoLoja from "../src/components/customer/AvisoPedidoEsperandoLoja";
import FinalizarPedidoDoRobo from "../src/components/customer/FinalizarPedidoDoRobo";
import { marcarAguardandoLoja, motivoDeAguardarLoja } from "../src/lib/finalizar-rascunho";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}${detalhe !== undefined ? ` — ${String(detalhe).slice(0, 300)}` : ""}`); }
}

const pedido = {
  id: "p1",
  status: "CRIANDO_IA",
  customerName: "Amanda",
  customerPhone: "+55 (22) 99710-4278",
  customerAddress: "Rua do forno, travessa pantanal, nº 130, Jardim Esperança",
  paymentMethod: "Cartão",
  totalAmount: 62.9,
  notes: marcarAguardandoLoja("🤖 Pedido sendo montado pela IA no WhatsApp", "o robô não achou o endereço no mapa"),
  items: [{ id: "i1", quantity: 2, productName: "X-Bacon" }, { id: "i2", quantity: 1, menuProduct: { name: "Coca 350ml" } }],
};
const motivo = motivoDeAguardarLoja(pedido)!;
confere("o motivo sai da marca do rascunho", motivo === "o robô não achou o endereço no mapa", motivo);

const aviso = renderToStaticMarkup(
  <AvisoPedidoEsperandoLoja pedido={pedido} motivo={motivo} quantosMais={2} onAceitar={() => {}} onNaoAceitar={async () => null} onDepois={() => {}} />,
);
confere("aviso: título", aviso.includes("Pedido do WhatsApp esperando você"));
confere("aviso: diz que não foi para a produção e por quê", aviso.includes("não pôs o pedido na produção") && aviso.includes("o robô não achou o endereço no mapa"));
confere("aviso: dados do cliente", aviso.includes("Amanda") && aviso.includes("99710-4278") && aviso.includes("travessa pantanal"));
confere("aviso: itens (nome do dia e do cardápio)", aviso.includes("2x X-Bacon") && aviso.includes("1x Coca 350ml"), aviso);
confere("aviso: total", aviso.includes("R$ 62,90"));
confere("aviso: os três botões", aviso.includes("Aceitar e conferir a taxa") && aviso.includes("Não aceitar") && aviso.includes("Depois"));
confere("aviso: quantos mais esperam", aviso.includes("+2 esperando"));

const janela = renderToStaticMarkup(<FinalizarPedidoDoRobo orderId="p1" onClose={() => {}} onFinalizado={() => {}} />);
confere("janela: abre com o título e carregando o rascunho", janela.includes("Finalizar pedido manualmente") && janela.includes("Abrindo o rascunho"), janela);

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
