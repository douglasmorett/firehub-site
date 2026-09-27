/**
 * O "Ver pedido" do app do motoboy (src/lib/pedido-do-motoboy.ts e
 * src/components/motoboy/VerPedido.tsx).
 *
 *   npx tsx scripts/teste-pedido-do-motoboy.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pedidoParaOMotoboy, resumoDoPedido } from "../src/lib/pedido-do-motoboy";
import { getBeveragesFromOrder } from "../src/lib/beverage";
import VerPedido from "../src/components/motoboy/VerPedido";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe === undefined ? "" : JSON.stringify(detalhe)); }
}

// O pedido como o GET /api/motoboys/orders devolve (items com menuProduct).
const pedido = {
  items: [
    {
      quantity: 2, productName: "X-Tudo", notes: "sem cebola",
      // Formato do cardápio online: { grupoId: { nome: quantidade } }.
      comboSelections: JSON.stringify({ g1: { "Pão brioche": 1 }, g2: { "Bacon extra": 1 } }),
      menuProduct: { name: "X-Tudo", category: "Lanches", isBeverage: false },
    },
    { quantity: 1, productName: "Coca-Cola 2L", notes: null, comboSelections: null, menuProduct: { name: "Coca-Cola 2L", category: "Bebidas", isBeverage: true } },
    {
      quantity: 2, productName: "Combo Casal", notes: "",
      // Formato do PDV: lista de { name, quantity }.
      comboSelections: [{ name: "Coca Lata", quantity: 1 }, { name: "Batata frita", quantity: 1 }],
      menuProduct: { name: "Combo Casal", category: "Combos", isBeverage: false },
    },
  ],
};

const p = pedidoParaOMotoboy(pedido);
confere("uma linha por item do pedido", p.linhas.length === 3, p.linhas.length);
confere("nome, quantidade e observação do lanche", p.linhas[0].nome === "X-Tudo" && p.linhas[0].quantidade === 2 && p.linhas[0].obs === "sem cebola", p.linhas[0]);
confere("as escolhas do cardápio online saem no mesmo leitor da comanda",
  JSON.stringify(p.linhas[0].escolhas.map((e) => e.nome)) === JSON.stringify(["Pão brioche", "Bacon extra"]), p.linhas[0].escolhas);
confere("o lanche não é bebida", p.linhas[0].bebida === false);
confere("a Coca 2L é bebida (produto marcado)", p.linhas[1].bebida === true);
confere("combo não vira bebida inteiro", p.linhas[2].bebida === false);
confere("a Coca DENTRO do combo aparece marcada como bebida",
  p.linhas[2].escolhas.find((e) => e.nome === "Coca Lata")?.bebida === true && p.linhas[2].escolhas.find((e) => e.nome === "Batata frita")?.bebida === false, p.linhas[2].escolhas);
confere("itens contam as unidades (2 + 1 + 2)", p.itens === 5, p.itens);
confere("bebidas contam a do combo × a quantidade dele (1 + 2)", p.bebidas === 3, p.bebidas);
confere("…e batem com o aviso 'você entregou a bebida?' do app",
  p.bebidas === getBeveragesFromOrder(pedido).reduce((s, b) => s + b.quantity, 0));
confere("resumo do botão", resumoDoPedido(p) === "5 itens · 3 bebidas", resumoDoPedido(p));
confere("resumo no singular e sem bebida", resumoDoPedido({ itens: 1, bebidas: 0 }) === "1 item");

const marcaLocal = pedidoParaOMotoboy({ items: [{ quantity: 1, productName: "Guaravita 290ml", menuProduct: { name: "Guaravita 290ml", category: "Outros" } }] }, "guaravita");
confere("a palavra de bebida da LOJA vale (marca regional)", marcaLocal.linhas[0].bebida === true && marcaLocal.bebidas === 1, marcaLocal);
confere("pedido sem itens: nada a mostrar", pedidoParaOMotoboy({ items: [] }).linhas.length === 0 && pedidoParaOMotoboy(null).linhas.length === 0);
const lixo = pedidoParaOMotoboy({ items: [{ quantity: "x", productName: "", comboSelections: "{quebrado", menuProduct: null }] });
confere("item torto não derruba a tela", lixo.linhas[0].nome === "Item" && lixo.linhas[0].quantidade === 1, lixo);

// A tela: fechado por padrão, com o resumo no botão.
const html = renderToStaticMarkup(<VerPedido order={pedido} palavrasDeBebida="" />);
confere("o botão 'Ver pedido' aparece com o resumo", html.includes("Ver pedido") && html.includes("5 itens · 3 bebidas"), html);
confere("começa FECHADO (o cartão na moto continua curto)", !html.includes("<ul") && html.includes('aria-expanded="false"'), html);
const aberto = renderToStaticMarkup(<VerPedido order={pedido} abertoDeInicio />);
confere("aberto: a lista mostra o lanche, as escolhas de CADA um e a observação",
  aberto.includes("X-Tudo") && aberto.includes("cada: ") && aberto.includes("Bacon extra") && aberto.includes("sem cebola"), aberto);
confere("aberto: a bebida vem destacada com o copo", aberto.includes("🥤 Coca-Cola 2L") && aberto.includes("🥤 Coca Lata"), aberto);
confere("sem preço na lista (o valor da porta já está no cartão)", !aberto.includes("R$"), aberto);
confere("sem itens, sem botão", renderToStaticMarkup(<VerPedido order={{ items: [] }} />) === "");

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
