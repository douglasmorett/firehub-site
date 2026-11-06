/**
 * scripts/teste-keeta-cardapio.ts — o cardápio do FireHub no formato da Keeta.
 *
 *   npx tsx scripts/teste-keeta-cardapio.ts
 *
 * Os casos da homologação (SIT, Menu): publicar, itemOfferId estável ao
 * acrescentar item, pausar item, pausar opção e horário do item.
 */
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
process.env.KEETA_CLIENT_SECRET ||= "segredo-de-teste";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : `\n   esperado: ${JSON.stringify(esperado)}\n   obtido:   ${JSON.stringify(obtido)}`}`);
};

(async () => {
  const { cardapioParaKeeta, horarioDoProdutoParaKeeta, chaveDoCardapio, chaveDoCardapioConfere, urlDoCardapio } = await import("../src/lib/keeta/cardapio");
  const M = "firehub-keeta-loja1";
  const pizza = (comboId: string, itemIds: [string, string]) => ({
    id: "p-pizza", name: "Pizza Calabresa", description: "Molho e calabresa", price: 44.9, precoDe: 54.9, category: "Pizzas",
    active: true, imageUrl: "https://cdn.exemplo.com/pizza.jpg",
    comboGroups: [{ id: comboId, title: "Borda", maxQty: 1, minQty: 0, items: [
      { id: itemIds[0], menuProductId: "p-catupiry", additionalPrice: 8, menuProduct: { id: "p-catupiry", name: "Catupiry", active: true } },
      { id: itemIds[1], menuProductId: "p-cheddar", additionalPrice: 9, adicionalDe: 10, menuProduct: { id: "p-cheddar", name: "Cheddar", active: false } },
    ] }],
  });
  const marmita = { id: "p-marmita", name: "Marmita", price: 22, category: "Almoço", active: true, availableDays: '["SEG","TER","QUA","QUI","SEX"]', availableHours: '{"de":"11:00","ate":"14:00"}', imageUrl: "/uploads/x.png" };
  const coca = { id: "p-coca", name: "Coca lata", price: 6, category: "Bebidas", active: false };
  const borda = { id: "p-catupiry", name: "Catupiry", price: 8, category: "Bordas", active: true, apenasEmCombo: true };
  const soSalao = { id: "p-salao", name: "Rodízio", price: 80, category: "Salão", active: true, activeDelivery: false };
  const base = { merchantId: M, lojaId: "loja1", nomeDaLoja: "Loja Teste", email: "a@b.com", telefone: "(22) 99999-0000", storeHours: [], deslocamentoMin: -180, agora: new Date("2026-11-06T13:00:00Z") };

  console.log("\n— Publicar (Menu Publish) —");
  const c1 = cardapioParaKeeta({ ...base, produtos: [pizza("g1", ["i1", "i2"]), marmita, coca, borda, soSalao] });
  confere("campos obrigatórios do Merchant", ["id", "status", "basicInfo", "services", "items", "menus", "categories", "itemOffers"].every((k) => k in c1), true);
  confere("só vai o que vende no delivery, sem complemento avulso", c1.itemOffers.map((o) => o.itemId), ["p-pizza", "p-marmita", "p-coca"]);
  confere("categorias na ordem do cardápio", c1.categories.map((c) => c.name), ["Pizzas", "Almoço", "Bebidas"]);
  confere("menu aponta para as categorias", c1.menus[0].categoryId, c1.categories.map((c) => c.id));
  confere("preço do delivery com promoção riscada", c1.itemOffers[0].price, { value: 44.9, originalValue: 54.9 });
  confere("externalCode do item é o id do produto (volta no pedido)", c1.items.find((i) => i.id === "p-pizza")?.externalCode, "p-pizza");
  confere("foto só com https", [c1.items.find((i) => i.id === "p-pizza")?.image, c1.items.find((i) => i.id === "p-marmita")?.image], [{ URL: "https://cdn.exemplo.com/pizza.jpg" }, undefined]);
  confere("a opção vira item próprio", c1.items.some((i) => i.id === "p-cheddar"), true);
  confere("pergunta com mín/máx do FireHub", [c1.optionGroups[0].minPermitted, c1.optionGroups[0].maxPermitted], [0, 1]);
  confere("telefone com DDD no formato da Keeta", c1.basicInfo.contactPhones.commercialNumber, "55-22999990000");
  confere("o serviço de delivery sempre leva horário", c1.services[0].serviceHours.weekHours.length > 0, true);

  console.log("\n— itemOfferId estável (itemOfferId Consistency) —");
  // O painel apaga e recria as perguntas a cada salvamento: ids de ComboGroup e
  // ComboGroupItem novos. Nada que vai para a Keeta pode mudar por isso.
  const nova = { id: "p-nova", name: "Pizza Nova", price: 50, category: "Pizzas", active: true };
  const c2 = cardapioParaKeeta({ ...base, produtos: [pizza("g999", ["i777", "i888"]), nova, marmita, coca, borda, soSalao] });
  const ids = (c: any) => ({ ofertas: c.itemOffers.map((o: any) => o.id), grupos: c.optionGroups.map((g: any) => g.id), opcoes: c.optionGroups.flatMap((g: any) => g.options.map((o: any) => o.id)), cats: c.categories.map((x: any) => x.id) });
  const a = ids(c1), b = ids(c2);
  confere("ofertas antigas com o mesmo id", a.ofertas.every((id: string) => b.ofertas.includes(id)), true);
  confere("a nova entra com id próprio", b.ofertas.includes("of-p-nova"), true);
  confere("perguntas e opções com o mesmo id depois de salvar", [b.grupos, b.opcoes], [a.grupos, a.opcoes]);
  confere("categorias com o mesmo id", b.cats, a.cats);

  console.log("\n— Pausar item e opção —");
  confere("produto pausado vai UNAVAILABLE", c1.itemOffers.find((o) => o.itemId === "p-coca")?.status, "UNAVAILABLE");
  confere("opção pausada vai UNAVAILABLE, a outra AVAILABLE", c1.optionGroups[0].options.map((o: any) => o.status), ["AVAILABLE", "UNAVAILABLE"]);
  const esgotada = cardapioParaKeeta({ ...base, produtos: [{ ...coca, active: true, esgotado: true }] });
  confere("estoque zerado também vai UNAVAILABLE", esgotada.itemOffers[0].status, "UNAVAILABLE");

  console.log("\n— Horário do item —");
  confere("marmita seg–sex 11h–14h em Brasília = 14h–17h UTC", c1.availabilities, [{ id: "av-p-marmita", hours: [{ dayOfWeek: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"], timePeriods: { startTime: "14:00:00.000Z", endTime: "17:00:00.000Z" } }] }]);
  confere("a oferta aponta para o horário", c1.itemOffers.find((o) => o.itemId === "p-marmita")?.availabilityId, ["av-p-marmita"]);
  confere("produto sem dia nem horário não leva availability", c1.itemOffers.find((o) => o.itemId === "p-pizza")?.availabilityId, undefined);
  confere("todo dia, sem horário = sempre", horarioDoProdutoParaKeeta('["SEG","TER","QUA","QUI","SEX","SAB","DOM"]', null, -180), null);
  confere("18h–02h vira a noite", horarioDoProdutoParaKeeta('["SEX"]', '{"de":"18:00","ate":"02:00"}', -180), [
    { dayOfWeek: ["FRIDAY"], timePeriods: { startTime: "21:00:00.000Z", endTime: "23:59:00.000Z" } },
    { dayOfWeek: ["SATURDAY"], timePeriods: { startTime: "00:00:00.000Z", endTime: "05:00:00.000Z" } },
  ]);

  console.log("\n— Chave da URL —");
  confere("a chave certa passa", chaveDoCardapioConfere(M, chaveDoCardapio(M)), true);
  confere("chave de outra loja não passa", chaveDoCardapioConfere(M, chaveDoCardapio("outra")), false);
  confere("sem chave não passa", chaveDoCardapioConfere(M, null), false);
  confere("URL por loja", urlDoCardapio("https://firehubfood.com.br", M).baseURL, `https://firehubfood.com.br/api/keeta/cardapio/${M}`);

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  process.exit(falhas ? 1 : 0);
})();

export {};
