/**
 * scripts/teste-espelho-de-integracao.ts — o espelho de integração tem campo
 * (lib/espelho-de-integracao.ts): nasce pausado e fora dos canais em todo
 * caminho, o filtro central o exclui por `origemIntegracao`, e o cardápio do
 * cliente não tem mais rede de segurança que o mostre.
 *
 *   DATABASE_URL="postgresql://banco-falso/teste" NEXTAUTH_SECRET=x npx tsx scripts/teste-espelho-de-integracao.ts
 *
 * Sem banco: `produtoRealDoItem` falha ao conectar, engole o erro e devolve
 * null — exatamente o que o pedido precisa (gravar de qualquer jeito).
 */
export {};

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://banco-falso/teste";

let ok = 0, falhas = 0;
const confere = (c: boolean, m: string) => { c ? ok++ : falhas++; console.log(c ? "  ✓" : "  ✗", m); };

async function main() {
  const { camposDoEspelho, ORIGENS, SEM_ESPELHO, produtoRealDoItem } = await import("../src/lib/espelho-de-integracao");
  const { SEM_PRODUTO_DE_INTEGRACAO, ehProdutoDeIntegracao } = await import("../src/lib/cardapio-interno");

  console.log("\n[1] camposDoEspelho: pausado e fora dos quatro canais, com origem e código");
  const c = camposDoEspelho(ORIGENS.FOOD99, "abc");
  confere(c.origemIntegracao === "99FOOD", "origemIntegracao = 99FOOD");
  confere(c.codigoExterno === "abc", "codigoExterno guardado");
  confere(c.active === false && c.activePDV === false && c.activeDelivery === false && c.activeTotem === false && c.activeGarcom === false, "active e os 4 canais em false");
  confere(camposDoEspelho(ORIGENS.IFOOD, null).codigoExterno === null, "sem código vira null");

  console.log("\n[2] Filtro central exclui por origemIntegracao");
  confere((SEM_PRODUTO_DE_INTEGRACAO as any).origemIntegracao === null, "SEM_PRODUTO_DE_INTEGRACAO tem origemIntegracao: null");
  confere((SEM_ESPELHO as any).origemIntegracao === null, "SEM_ESPELHO = { origemIntegracao: null }");
  confere(ehProdutoDeIntegracao("Lanches", "cuid123", true, "99FOOD") === true, "em memória: origem preenchida = espelho, mesmo ativo com categoria real");
  confere(ehProdutoDeIntegracao("Lanches", "ifood-x", true, null) === false, "em memória: produto real importado com id ifood- ativo NÃO é espelho");
  confere(ehProdutoDeIntegracao("iFood", "cuid", true) === true, "em memória: categoria de integração continua condenando");

  console.log("\n[3] Itens do 99Food nascem como espelho pausado (sem banco: sem vínculo)");
  const { itens99ParaPrisma } = await import("../src/lib/food99-pedido");
  const itens = await itens99ParaPrisma(
    [{ nome: "Combo Tadala", precoUnitario: 39.9, quantidade: 1, observacao: "", complementos: [] } as any],
    "loja1",
    new Map([["Combo Tadala", "Burgers"]]),
  );
  const create = itens[0].menuProduct.connectOrCreate?.create;
  confere(!!create, "sem vínculo, usa connectOrCreate");
  confere(create?.origemIntegracao === "99FOOD", "espelho do 99Food com origemIntegracao");
  confere(create?.active === false && create?.activeDelivery === false, "espelho do 99Food nasce pausado e fora do delivery (antes nascia ATIVO)");
  confere(create?.category === "Burgers", "categoria real do produto de mesmo nome continua (KDS)");

  console.log("\n[4] produtoRealDoItem sem banco devolve null, sem lançar");
  const real = await produtoRealDoItem({ franchiseeId: "loja1", codigoExterno: "758", idDoEspelho: "ifood-x" });
  confere(real === null, "null sem banco");

  console.log("\n[5] Cardápio do cliente: sem rede de segurança");
  const fs = await import("node:fs");
  const fonte = fs.readFileSync(new URL("../src/lib/cardapio-publico.ts", import.meta.url), "utf8");
  confere(!/semEspelho\.length > 0 \? semEspelho : /.test(fonte), "a linha 'semEspelho.length > 0 ? semEspelho : menuProducts' saiu");
  confere(/origemIntegracao: true/.test(fonte), "o select do cardápio público traz origemIntegracao");

  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
