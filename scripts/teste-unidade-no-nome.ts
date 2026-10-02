/**
 * A unidade cola no número no casamento por nome (lib/categoria-do-item.ts).
 *
 *   npx tsx scripts/teste-unidade-no-nome.ts
 *
 * O caso é o da Divinos Burger em 01/10/2026: a 99Food mandou "Açaí 400 Ml",
 * o cadastro dizia "Açaí 400ml", e o pedido saiu em duas comandas.
 */
import { chaveDoNome, montarMapa, categoriaResolvida } from "../src/lib/categoria-do-item";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── O caso da Divinos ──
confere("400 Ml ≡ 400ml", chaveDoNome("Açaí 400 Ml"), chaveDoNome("Açaí 400ml"));
confere("1L ≡ 1 l", chaveDoNome("Açaí 1L"), chaveDoNome("Açaí 1 l"));
confere("1,5 L ≡ 1,5l", chaveDoNome("Guaraná Mineiro 1,5 L"), chaveDoNome("Guaraná Mineiro 1,5l"));
confere("200 g ≡ 200g", chaveDoNome("Batata 200 g"), chaveDoNome("Batata 200g"));

const mapa = montarMapa([
  { id: "prd_1", name: "Açaí 400ml", category: "Açai", active: true },
  { id: "prd_2", name: "Leite em Pó", category: "Complementos", active: true },
  { id: "prd_3", name: "Chocolate", category: "Complementos", active: true },
]);
confere(
  "espelho da 99 casa pelo nome antes de votar pelos complementos",
  categoriaResolvida(
    {
      productName: "Açaí 400 Ml",
      comboSelections: [{ name: "Leite em Pó" }, { name: "Chocolate" }],
      menuProduct: { id: "99food_loja_Açaí 400 Ml", name: "Açaí 400 Ml", category: "99Food", active: true },
    },
    mapa
  ),
  "Açai"
);

// ── O que NÃO pode colar ──
confere("número solto continua separado", chaveDoNome("Grande 2 Sabores (8 Pedaços)"), "grande 2 sabores 8 pedacos");
confere("letra que não é unidade não cola", chaveDoNome("Combo 2 Lanches"), "combo 2 lanches");
confere("'l' só como palavra inteira", chaveDoNome("X 2 Litros"), "x 2 litros");

if (falhas) {
  console.log(`\n${falhas} falha(s)`);
  process.exit(1);
}
console.log("\nTudo certo.");
