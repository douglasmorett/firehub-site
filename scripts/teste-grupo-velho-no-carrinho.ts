/**
 * Carrinho com o id de um grupo que não existe mais (src/lib/preco-combo.ts,
 * reancorarNosGruposAtuais) e os "+R$" da comanda contra o preço gravado
 * (src/lib/parse-combo.ts, comboParaImpressao).
 *
 * Caso real: Deeds Delivery, 16/10/2026 22:00, "Pizza Grande 8 Pedaços - 2
 * Sabores" (MÉDIA) — gravada por 112,70 (soma das opções) no lugar de 66,30.
 *
 *   npx tsx scripts/teste-grupo-velho-no-carrinho.ts
 */
import { precoUnitarioDoItem, adicionaisDetalhados, escolhasNosGruposAtuais } from "../src/lib/preco-combo";
import { comboParaImpressao } from "../src/lib/parse-combo";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`, detalhe === undefined ? "" : JSON.stringify(detalhe)); }
}

const op = (name: string, additionalPrice: number) => ({ additionalPrice, menuProduct: { name, price: 0 } });

// O produto como está hoje no banco (grupos recriados às 22:02).
const pizza = {
  price: 0,
  comboGroups: [
    {
      id: "cmvbijddl048dml01a2x8sve4",
      title: "Escolha os 2 sabores",
      minQty: 2,
      maxQty: 2,
      priceRule: "MEDIA",
      items: [op("Pizza Atum I Premium", 46.9), op("Pizza Premium Portuguesa", 45.9), op("Pizza Premium Portuguesa com Catupiry", 47.9)],
    },
    {
      id: "cmvbijdt804amml01fjtlqkp4",
      title: "BROTO PROMOCIONAL",
      minQty: 0,
      maxQty: 1,
      priceRule: null,
      items: [op("BROTO BANANA NEVADA", 24.9), op("BROTO BRIGADEIRO", 19.9), op("BROTO BEIJINHO", 19.9)],
    },
  ],
};

const gravadoNoBanco = {
  cmvbijddl048dml01a2x8sve4: { "Pizza Atum I Premium": 1, "Pizza Premium Portuguesa": 1 },
  cmvbijdt804amml01fjtlqkp4: { "BROTO BRIGADEIRO": 1 },
};
// O mesmo carrinho montado com a página de ANTES do produto ser salvo.
const carrinhoVelho = {
  grupo_de_sabores_velho: { "Pizza Atum I Premium": 1, "Pizza Premium Portuguesa": 1 },
  grupo_do_broto_velho: { "BROTO BRIGADEIRO": 1 },
};

// 1. Com os ids atuais: MÉDIA (46,90 + 45,90) / 2 = 46,40 + broto 19,90 = 66,30.
confere("ids atuais = 66,30", precoUnitarioDoItem(pizza, gravadoNoBanco) === 66.3, precoUnitarioDoItem(pizza, gravadoNoBanco));

// 2. O bug: ids velhos caíam na regra SOMA = 112,70. Agora 66,30.
confere("ids velhos = 66,30 (era 112,70)", precoUnitarioDoItem(pizza, carrinhoVelho) === 66.3, precoUnitarioDoItem(pizza, carrinhoVelho));

const det = adicionaisDetalhados(pizza, carrinhoVelho);
confere("sabores reancorados no grupo atual", det.filter((d) => d.grupoId === "cmvbijddl048dml01a2x8sve4").length === 2, det);
confere("broto reancorado no grupo atual", det.some((d) => d.nome === "BROTO BRIGADEIRO" && d.grupoId === "cmvbijdt804amml01fjtlqkp4"), det);

// 3. O que o pedido grava: as escolhas nos grupos de hoje.
confere("grava nos grupos atuais", JSON.stringify(escolhasNosGruposAtuais(pizza, carrinhoVelho)) === JSON.stringify(gravadoNoBanco), escolhasNosGruposAtuais(pizza, carrinhoVelho));
confere("ids atuais ficam como estão", JSON.stringify(escolhasNosGruposAtuais(pizza, gravadoNoBanco)) === JSON.stringify(gravadoNoBanco));
const pdv = [{ name: "Pizza Atum I Premium", quantity: 1 }];
confere("lista do PDV não muda", escolhasNosGruposAtuais(pizza, pdv) === pdv);
const semCasar = { velho: { "Sabor que saiu do cardápio": 1 } };
confere("nome que não existe mais não mexe", escolhasNosGruposAtuais(pizza, semCasar) === semCasar);

// 4. Nome em dois grupos atuais: não chuta (fica sem grupo, como antes).
const ambiguo = {
  price: 0,
  comboGroups: [
    { id: "a", priceRule: "MAIOR", items: [op("Calabresa", 40), op("Frango", 50)] },
    { id: "b", priceRule: null, items: [op("Calabresa", 40), op("Frango", 50)] },
  ],
};
confere("ambíguo não é reancorado", adicionaisDetalhados(ambiguo, { x: { Calabresa: 1 } })[0]?.grupoId === undefined);

// 5. A comanda: "+R$" pela regra do grupo, somando o preço gravado.
const comanda = comboParaImpressao(gravadoNoBanco, pizza, 66.3) || [];
const somaDaComanda = comanda.reduce((s: number, c: any) => s + (Number(c.price) || 0) * (Number(c.quantity) || 1), 0);
confere("comanda soma o preço gravado", Math.abs(somaDaComanda - 66.3) < 0.005, comanda);
confere("sabor sai com a metade (23,20), não a inteira (46,90)", comanda.some((c: any) => c.name === "Pizza Atum I Premium" && c.price === 23.2), comanda);

// 6. Opções que somam MAIS que o item gravado (o cardápio mudou depois do
//    pedido): saem sem valor, nunca com "+R$" de pizza inteira.
const somaAntiga = { ...pizza, comboGroups: pizza.comboGroups.map((g) => ({ ...g, priceRule: null })) };
const comandaVelha = comboParaImpressao(gravadoNoBanco, somaAntiga, 66.3) || [];
confere("adicionais acima do item gravado saem sem valor", comandaVelha.length === 3 && comandaVelha.every((c: any) => c.price === undefined), comandaVelha);
confere("sem preço gravado segue como antes", (comboParaImpressao(gravadoNoBanco, somaAntiga) || []).some((c: any) => c.price === 46.9));

console.log(`${ok} ok, ${falhas} falha(s)`);
if (falhas > 0) process.exit(1);
