/**
 * scripts/teste-kds-nome-da-loja.ts — o nome da loja no cartão do KDS em
 * "Todas as Lojas" (lib/kds-telas.ts, `lojaNoCartao`), com o grupo da Annalu.
 *
 *   npx tsx scripts/teste-kds-nome-da-loja.ts
 */
import { lojaNoCartao } from "../src/lib/kds-telas";

let falhas = 0;
const conferir = (nome: string, ok: boolean, detalhe?: unknown) => {
  if (ok) console.log(`  ok  ${nome}`);
  else { falhas++; console.log(`  FALHOU  ${nome}`, detalhe ?? ""); }
};

const grupo = { annalu: "ANNALU PIZZAS", rush: " Rush Pizza ", pastele: null };

conferir("site da Rush em Todas: Rush Pizza", lojaNoCartao(grupo, { franchiseeId: "rush" }) === "Rush Pizza", lojaNoCartao(grupo, { franchiseeId: "rush" }));
conferir("99Food da Annalu: ANNALU PIZZAS", lojaNoCartao(grupo, { franchiseeId: "annalu" }) === "ANNALU PIZZAS");
conferir("iFood: o nome da loja no FireHub, não o do iFood", lojaNoCartao(grupo, { franchiseeId: "annalu", ifoodStoreName: "Annalu Pizzaria Delivery" }) === "ANNALU PIZZAS");
conferir("loja sem storeName: vale o nome no iFood", lojaNoCartao(grupo, { franchiseeId: "pastele", ifoodStoreName: "Pastelê do Carioca" }) === "Pastelê do Carioca");
conferir("loja sem nome nenhum: sem selo", lojaNoCartao(grupo, { franchiseeId: "pastele" }) === null);
conferir("pedido de loja fora da visão: sem selo", lojaNoCartao(grupo, { franchiseeId: "outra" }) === null);
conferir("pedido sem loja: sem selo", lojaNoCartao(grupo, { franchiseeId: null }) === null);
conferir("uma loja só: sem selo", lojaNoCartao({ annalu: "ANNALU PIZZAS" }, { franchiseeId: "annalu" }) === null);
conferir("fora do Todas (mapa vazio): sem selo, nem no iFood", lojaNoCartao({}, { franchiseeId: "annalu", ifoodStoreName: "Annalu Pizzaria Delivery" }) === null);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
