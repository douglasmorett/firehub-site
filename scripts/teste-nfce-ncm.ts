/**
 * Trava o NCM ASSISTIDO (src/lib/nfce/ncm-sugerido.ts) com o cardápio REAL da
 * NIK ESFIHAS E PIZZAS — os 163 produtos ativos, todos sem NCM em 29/09/2026.
 *
 *   npx tsx scripts/teste-nfce-ncm.ts            (usa a fixture)
 *   npx tsx scripts/teste-nfce-ncm.ts --banco    (relê o cardápio do banco, SÓ LEITURA)
 *
 * A fixture scripts/fixtures/nfce-produtos-nik.json foi lida do banco de
 * produção numa transação READ ONLY; com --banco o teste relê do mesmo jeito
 * (SET TRANSACTION READ ONLY) e confere que nenhum produto ficou sem sugestão.
 * Nada aqui escreve no banco.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { pendenciasDoProduto } from "../src/lib/fiscal-validacao";
import {
  FONTES,
  montarLote,
  ncmComPontos,
  normalizarTexto,
  opcaoEscolhida,
  problemaDaCombinacao,
  resumirPorCategoria,
  situacaoDoNcmGravado,
  sugerirFiscal,
  sugerirParaCardapio,
  type SugestaoDoProduto,
} from "../src/lib/nfce/ncm-sugerido";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const verdade = (oQue: string, cond: boolean, detalhe = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "✅" : "❌"} ${oQue}${cond ? "" : ` — ${detalhe}`}`);
};

type ProdutoDaFixture = { nome: string; categoria: string; preco: number; ehBebida: boolean; ehCombo: boolean; apenasEmCombo: boolean };
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures", "nfce-produtos-nik.json"), "utf8")) as { total: number; produtos: ProdutoDaFixture[] };

/**
 * Os NCM que o NCM assistido pode sugerir, conferidos um a um na tabela NCM
 * oficial (Portal Único Siscomex, "Vigente em 29/09/2026", Resolução Gecex nº
 * 926/2026). Código novo numa regra = conferir na tabela e pôr aqui, com a
 * descrição — o teste falha até isso ser feito.
 */
const NCM_CONFERIDOS: Record<string, string> = {
  "19059090": "Produtos de padaria e pastelaria — outros",
  "19022000": "Massas alimentícias recheadas",
  "19023000": "Outras massas alimentícias",
  "21069090": "Preparações alimentícias não especificadas — outras",
  "20052000": "Batatas (preparadas, não congeladas)",
  "19019090": "Preparações alimentícias de leite — outros",
  "18069000": "Chocolate e preparações com cacau — outros",
  "21050010": "Sorvetes, embalagens até 2 kg",
  "16023230": "Galos e galinhas, 25% a 57% de carne",
  "16025000": "Preparações de carne bovina",
  "16024900": "Preparações de carne suína — outras, incluindo misturas",
  "16024100": "Suína — pernas e pedaços",
  "16010000": "Enchidos e preparações à base deles",
  "16042090": "Outras preparações de peixes — outras",
  "22021000": "Águas adicionadas de açúcar ou aromatizadas",
  "22011000": "Águas minerais e gaseificadas",
  "22019000": "Outras águas",
  "22029900": "Outras bebidas não alcoólicas",
  "22029100": "Cerveja sem álcool",
  "22030000": "Cervejas de malte",
  "20091200": "Suco de laranja não congelado, Brix até 20",
  "20096100": "Suco de uva, Brix até 30",
  "20097100": "Suco de maçã, Brix até 20",
  "20094100": "Suco de abacaxi, Brix até 20",
  "20093100": "Suco de outros cítricos, Brix até 20",
  "20095000": "Suco de tomate",
  "20098913": "Suco de maracujá",
  "20098912": "Suco de acerola",
  "20098990": "Outros sucos",
  "20099000": "Misturas de sucos",
  "20098921": "Água de coco, Brix até 7,4",
  "22084000": "Rum e aguardentes de cana",
  "22086000": "Vodca",
  "22083020": "Uísques até 2 l",
  "22085000": "Gim e genebra",
  "22089000": "Outras bebidas espirituosas",
  "22087000": "Licores",
  "22082000": "Aguardentes de vinho ou bagaço",
  "22051000": "Vermutes até 2 l",
  "22042100": "Outros vinhos até 2 l",
  "22041090": "Espumantes — outros",
  "22060090": "Outras bebidas fermentadas",
  "21032010": "Ketchup até 1 kg",
  "21039011": "Maionese até 1 kg",
  "21033021": "Mostarda preparada até 1 kg",
  "21031010": "Molho de soja até 1 kg",
  "21039091": "Outros molhos até 1 kg",
  "21039021": "Condimentos e temperos compostos até 1 kg",
  "48191000": "Caixas de papelão ondulado",
  "48192000": "Caixas dobráveis de cartão não ondulado",
  "39231090": "Caixas e artigos de plástico para embalagem — outros",
  "39241000": "Utensílios de mesa ou cozinha de plástico",
};

/** Os CEST sugeridos, conferidos no texto do Convênio ICMS 142/18 no site do CONFAZ (29/09/2026). */
const CEST_CONFERIDOS: Record<string, string> = {
  "1706201": "Anexo XVII 62.1 — produtos de panificação, incluindo as pizzas (1905.90.90)",
  "1704802": "Anexo XVII 48.2 — massas alimentícias recheadas (1902.20.00)",
  "1700900": "Anexo XVII 9.0 — confeitaria contendo cacau (1806.90.00)",
  "2300100": "Anexo XXII 1.0 — sorvetes (2105.00)",
  "1707900": "Anexo XVII 79.0 — outras preparações de carne (1602)",
  "1707906": "Anexo XVII 79.6 — preparações de carne bovina (1602.50.00)",
  "1707905": "Anexo XVII 79.5 — suína, outras (1602.49.00)",
  "1707904": "Anexo XVII 79.4 — suína, pernas (1602.41.00)",
  "0300700": "Anexo IV 7.0 — água aromatizada (2202.10.00)",
  "0301500": "Anexo IV 15.0 — hidroeletrolíticas",
  "0302300": "Anexo IV 23.0 — chope (2203.00.00)",
  "0301000": "Anexo IV 10.0 — refrigerante em vidro descartável",
  "0301001": "Anexo IV 10.1 — refrigerante em embalagem pet",
  "0301002": "Anexo IV 10.2 — refrigerante em lata",
  "0301100": "Anexo IV 11.0 — demais refrigerantes",
  "0300300": "Anexo IV 3.0 — água em vidro descartável",
  "0300500": "Anexo IV 5.0 — água em copo plástico descartável",
  "0300502": "Anexo IV 5.2 — água em jarra descartável",
  "0300504": "Anexo IV 5.4 — água em demais embalagens descartáveis",
  "0302400": "Anexo IV 24.0 — água mineral retornável 10 a 20 l",
  "0302100": "Anexo IV 21.0 — cerveja em garrafa de vidro retornável",
  "0302101": "Anexo IV 21.1 — cerveja em garrafa de vidro descartável",
  "0302103": "Anexo IV 21.3 — cerveja em lata",
  "0302104": "Anexo IV 21.4 — cerveja em barril",
  "0302105": "Anexo IV 21.5 — cerveja em PET",
  "0302200": "Anexo IV 22.0 — cerveja sem álcool, vidro retornável",
  "0302201": "Anexo IV 22.1 — cerveja sem álcool, vidro descartável",
  "0302203": "Anexo IV 22.3 — cerveja sem álcool em lata",
  "0302204": "Anexo IV 22.4 — cerveja sem álcool em barril",
  "0302205": "Anexo IV 22.5 — cerveja sem álcool em PET",
  "0301300": "Anexo IV 13.0 — energéticos em lata",
  "0301301": "Anexo IV 13.1 — energéticos em PET",
  "0301302": "Anexo IV 13.2 — energéticos em vidro",
  "1711200": "Anexo XVII 112.0 — néctares (2202.99.00)",
  "1711100": "Anexo XVII 111.0 — refrescos (2202.10.00)",
  "1711300": "Anexo XVII 113.0 — bebidas prontas de mate ou chá",
  "1701100": "Anexo XVII 11.0 — água de coco (2009.89.2)",
  "1701000": "Anexo XVII 10.0 — sucos (2009)",
  "0200400": "Anexo III 4.0 — cachaça (2208.40.00)",
  "0201200": "Anexo III 12.0 — rum",
  "0201800": "Anexo III 18.0 — vodka",
  "0201600": "Anexo III 16.0 — uísque",
  "0200800": "Anexo III 8.0 — gim",
  "0201500": "Anexo III 15.0 — tequila",
  "0201000": "Anexo III 10.0 — licores",
  "0200600": "Anexo III 6.0 — conhaque",
  "0200100": "Anexo III 1.0 — aperitivos",
  "0201700": "Anexo III 17.0 — vermute",
  "0202400": "Anexo III 24.0 — vinhos (2204)",
  "0201300": "Anexo III 13.0 — saquê",
  "0200300": "Anexo III 3.0 — bebida ice",
  "0202300": "Anexo III 23.0 — sangrias e coquetéis",
  "0200200": "Anexo III 2.0 — batida",
  "1703400": "Anexo XVII 34.0 — catchup",
  "1703900": "Anexo XVII 39.0 — maionese",
  "1703800": "Anexo XVII 38.0 — mostarda preparada",
  "1703600": "Anexo XVII 36.0 — molho de soja",
  "1703500": "Anexo XVII 35.0 — condimentos e molhos, incluindo molho de pimenta",
  "1400601": "Anexo XV 6.1 — utensílios de plástico descartáveis",
};

const CONTEXTO_NIK = { regime: 1, uf: "DF" };
const lista = fixture.produtos.map((p, i) => ({ id: `p${i}`, nome: p.nome, categoria: p.categoria, preco: p.preco, ehBebida: p.ehBebida, apenasEmCombo: p.apenasEmCombo }));
const sugestoes = sugerirParaCardapio(lista, CONTEXTO_NIK);
const achar = (nome: string, categoria?: string): SugestaoDoProduto => {
  const s = sugestoes.find((x) => x.nome === nome && (categoria === undefined || x.categoria === categoria));
  if (!s) throw new Error(`produto não está na fixture: ${nome} (${categoria ?? "qualquer categoria"})`);
  return s;
};
const ncms = (s: { opcoes: { ncm: string }[] }) => s.opcoes.map((o) => o.ncm);
const cests = (s: { opcoes: { cest: string | null }[] }) => s.opcoes.map((o) => o.cest);

console.log("— o cardápio da NIK (163 produtos, UF DF, Simples)");
{
  confere("a fixture tem os 163 produtos ativos", [fixture.total, fixture.produtos.length], [163, 163]);
  const sem = sugestoes.filter((s) => !s.regra || s.opcoes.length === 0);
  confere("nenhum produto sem sugestão", sem.map((s) => `${s.categoria} / ${s.nome}`), []);
  const porRegra: Record<string, number> = {};
  for (const s of sugestoes) porRegra[String(s.regra)] = (porRegra[String(s.regra)] ?? 0) + 1;
  console.log("   regras:", JSON.stringify(porRegra));
}

console.log("\n— comida feita na casa");
{
  const pizza = achar("Pizza Calabresa", "Pizzas Tradicionais");
  confere("pizza: 1905.90.90 + CEST 17.062.01 (\"incluindo as pizzas\"), CFOP 5101, CSOSN 102, sem pergunta", [pizza.regra, ncms(pizza), cests(pizza), pizza.cfop, pizza.csosn, pizza.pergunta, pizza.confianca], ["pizza", ["19059090"], ["1706201"], "5101", "102", null, "alta"]);
  verdade("pizza cita a SC Cosit 98.277/2024 e o Anexo XVII", pizza.opcoes[0].fontes.includes("sc98277de2024") && pizza.opcoes[0].fontes.includes("cestAnexoXVII"));
  verdade("CFOP 5101 cita a tabela CFOP e a resposta da SEFAZ-SP", pizza.fontes.includes("cfop") && pizza.fontes.includes("cfopRestaurante"));
  const esfihaPizza = achar("Esfiha Pizza", "Esfihas Tradicionais");
  confere("\"Esfiha Pizza\" é ESFIHA (a palavra forte do nome vem antes), sem carne", [esfihaPizza.regra, ncms(esfihaPizza)], ["esfiha", ["19059090"]]);
  const carne = achar("Esfiha Carne", "Esfihas Tradicionais");
  confere("esfiha de carne: duas opções e a pergunta dos 20%", [carne.regra, ncms(carne), cests(carne), carne.pergunta?.id], ["esfiha-com-carne", ["19059090", "16025000"], ["1706201", "1707906"], "carne-mais-de-20"]);
  verdade("a opção do Cap. 16 cita a Nota 2 do Cap. 16", carne.opcoes[1].fontes.includes("nota2Cap16"));
  const frango = achar("Esfiha Frango", "Esfihas Tradicionais");
  confere("esfiha de frango > 20%: 1602.32.30 (a da SC Cosit 98.211/2025)", [ncms(frango)[1], frango.opcoes[1].fontes.includes("sc98211de2025")], ["16023230", true]);
  confere("esfiha de calabresa > 20%: embutido 1601.00.00, sem CEST (17.077.00 é a linguiça, não a preparação)", [ncms(achar("Esfiha Calabresa", "Esfihas Tradicionais"))[1], cests(achar("Esfiha Calabresa", "Esfihas Tradicionais"))[1]], ["16010000", null]);
  confere("\"Duplo Queijo com Bacon\": a carne é a do bacon (suína)", ncms(achar("Esfiha Duplo Queijo com Bacon", "Esfihas Especiais"))[1], "16024900");
  confere("\"Carne e Bacon\": vale a carne que vem primeiro (bovina)", ncms(achar("Esfiha Carne e Bacon", "Esfihas Especiais"))[1], "16025000");
  const doces = sugestoes.filter((s) => s.categoria === "Esfihas Doces");
  confere("as 8 esfihas doces: 1905.90.90, sem pergunta", doces.map((s) => [s.regra, s.opcoes.length]), doces.map(() => ["esfiha-doce", 1]));
  confere("\"Esfiha Creme de Ninho com Kit Kat\" não é combo (\"kit\" não é palavra de combo)", achar("Esfiha Creme de Ninho com Kit Kat").combo ?? false, false);
  confere("sabor \"Bauru\" de \"Sabores de Pizza\" é pizza (e não o lanche bauru)", achar("Bauru", "Sabores de Pizza").regra, "pizza");
  confere("borda: o NCM da pizza", [achar("Borda de Catupiry").regra, ncms(achar("Borda de Catupiry"))], ["borda", ["19059090"]]);
  const adicional = achar("Adicional Bacon");
  confere("adicional segue o prato principal (a pizza), sem CEST, confiança baixa", [adicional.regra, ncms(adicional), cests(adicional), adicional.confianca], ["adicional", ["19059090"], [null], "baixa"]);
  const quarta = sugestoes.filter((s) => s.categoria === "QUARTA COM BORDA GRÁTIS");
  confere("as 26 pizzas de \"QUARTA COM BORDA GRÁTIS\" NÃO são combo (\"grátis\" não é palavra de combo)", [quarta.length, quarta.filter((s) => s.combo).length, quarta.every((s) => s.regra === "pizza")], [26, 0, true]);
}

console.log("\n— bebidas (revenda com ST no DF)");
{
  const lata = achar("Coca Cola Lata 310ml");
  confere("refrigerante em lata: 2202.10.00, CEST 03.010.02, CFOP 5405, CSOSN 500, ST sim (DF)", [ncms(lata), cests(lata), lata.cfop, lata.csosn, lata.substituicao], [["22021000"], ["0301002"], "5405", "500", "sim"]);
  verdade("a ST do DF cita o RICMS/DF e a segregação no Simples", lata.fontes.includes("stDf") && lata.fontes.includes("segregacaoNoSimples") && lata.fontes.includes("rejeicao806"));
  verdade("o aviso diz que CSOSN 500 depende da nota de COMPRA", lata.avisos.some((a) => /nota de COMPRA/.test(a)));
  confere("refrigerante 2 l: PET (03.010.01), com o aviso da embalagem suposta", [cests(achar("Coca Cola 2l", "Bebidas")), achar("Coca Cola 2l", "Bebidas").avisos.some((a) => /suposta/.test(a))], [["0301001"], true]);
  confere("\"Coca Cola 1,5l\" do 99Food (isBeverage=false): o nome decide — refrigerante PET", [achar("Coca Cola 1,5l", "99Food").regra, cests(achar("Coca Cola 1,5l", "99Food"))], ["refrigerante", ["0301001"]]);
  confere("H2O Limão: refrigerante (H2OH! é registrada como refrigerante)", achar("H2O Limão 500ml").regra, "refrigerante");
  confere("\"Guaraná Antártica\" não é cerveja", achar("Guaraná Antartica Lata 350ml").regra, "refrigerante");
  const cerveja = achar("Cerveja Heineken lata");
  confere("cerveja em lata: 2203.00.00, CEST 03.021.03, 5405/500", [ncms(cerveja), cests(cerveja), cerveja.cfop, cerveja.csosn], [["22030000"], ["0302103"], "5405", "500"]);
  const agua = achar("Água Com Gás");
  confere("água com gás: 2201.10.00, CEST 03.005.04 (garrafa descartável suposta)", [ncms(agua), cests(agua), agua.csosn], [["22011000"], ["0300504"], "500"]);
  const prats = achar("Suco Prats Laranja 300ml");
  confere("Prats (suco integral): 2009.12.00, CEST 17.010.00, revenda SEM ST no DF (5102/102)", [ncms(prats), cests(prats), prats.cfop, prats.csosn, prats.substituicao], [["20091200"], ["1701000"], "5102", "102", "nao"]);
  const delValle = achar("Suco Del Valle Lata - Uva");
  confere("Del Valle de uva: suco 100% (2009.61.00) ou néctar (2202.99.00) — pergunta", [ncms(delValle), cests(delValle), delValle.pergunta?.id], [["20096100", "22029900"], ["1701000", "1711200"], "suco-ou-nectar"]);
  const semSt = sugestoes.filter((s) => s.csosn === "500" && s.opcoes.some((o) => !o.cest));
  confere("toda bebida com CSOSN 500 da NIK tem CEST (rejeição 806)", semSt.map((s) => s.nome), []);
}

console.log("\n— embalagens, molhos e combos");
{
  const caixa = achar("Cx 25 cm");
  confere("caixa de pizza: papelão ondulado ou cartão liso — pergunta", [caixa.regra, ncms(caixa), caixa.pergunta?.id, caixa.cfop, caixa.csosn], ["caixa", ["48191000", "48192000"], "caixa-ondulada", "5102", "102"]);
  confere("vasilha: embalagem (3923.10.90) ou utensílio (3924.10.00, CEST 14.006.01)", [ncms(achar("Vasilha Nik")), cests(achar("Vasilha Nik"))], [["39231090", "39241000"], [null, "1400601"]]);
  const molho = achar("Molho de Pimenta Nik");
  confere("molho de pimenta: 2103.90.91 ou 2103.90.21, os dois com o CEST 17.035.00 (que cita o molho de pimenta)", [ncms(molho), cests(molho)], [["21039091", "21039021"], ["1703500", "1703500"]]);
  const sache = achar("Ketchup e Maionese");
  confere("\"Ketchup e Maionese\" (sachês): qual molho — e sem CEST (sachê fora do Anexo XVII)", [sache.regra, ncms(sache), cests(sache)], ["molho-dois", ["21032010", "21039011"], [null, null]]);
  const combo = achar("6 Esfihas Tradicionais + Guaraná Mineiro 1,5L");
  confere("\"6 Esfihas + Guaraná\": combo, com o NCM da comida e CFOP de produção (não 5405)", [combo.regra, combo.combo, ncms(combo), combo.cfop, combo.csosn], ["combo-esfiha", true, ["19059090"], "5101", "102"]);
  verdade("o combo manda configurar a Engenharia de Combos", combo.avisos.some((a) => /Engenharia de Combos/.test(a)));
  confere("\"Combo 1\" de \"Combos Esfihas\": combo de esfiha pela categoria", [achar("Combo 1", "Combos Esfihas").regra, achar("Combo 1", "Combos Esfihas").combo], ["combo-esfiha", true]);
  confere("promoção de pizzas com Coca: combo de pizza", achar("Na Compra de 2 Pizzas Especiais, Ganhe Grátis Uma Coca 2l").regra, "combo-pizza");
}

console.log("\n— o nome solto herda do irmão (categoria 99Food)");
{
  const calabresa = achar("Calabresa", "99Food");
  confere("\"Calabresa\" (R$ 83,90) herda do sabor \"Calabresa\" de \"Sabores de Pizza\"", [calabresa.regra, calabresa.parecidoCom, calabresa.confianca], ["pizza", "Calabresa (Sabores de Pizza)", "baixa"]);
  const costela = achar("Costela com Catupiry", "99Food");
  confere("\"Costela com Catupiry\" (R$ 106,90): pizza e esfiha têm o nome; o preço decide (pizza R$ 86,90)", [costela.regra, costela.parecidoCom], ["pizza", "Pizza Costela com Catupiry (Pizzas Especiais)"]);
  confere("\"Combo 1\" do 99Food herda do \"Combo 1\" de \"Combos Esfihas\" (combo só herda de combo)", [achar("Combo 1", "99Food").regra, achar("Combo 1", "99Food").combo], ["combo-esfiha", true]);
  // Sem irmão de preço parecido, não chuta.
  const ambiguo = sugerirParaCardapio(
    [
      { id: "a", nome: "Pizza Frango", categoria: "Pizzas", preco: 60 },
      { id: "b", nome: "Esfiha Frango", categoria: "Esfihas", preco: 10 },
      { id: "c", nome: "Frango", categoria: "Outros", preco: 30 },
    ],
    CONTEXTO_NIK
  ).find((s) => s.produtoId === "c")!;
  confere("nome dos dois tipos com preço no meio do caminho: fica sem sugestão e diz por quê", [ambiguo.regra, /mais de um tipo/.test(ambiguo.avisos[0] ?? "")], [null, true]);
}

console.log("\n— toda sugestão passa na conferência da nota (a mesma da rota do lote)");
{
  const problemas: string[] = [];
  for (const s of sugestoes) {
    for (const o of s.opcoes) {
      if (!s.cfop || !s.csosn) continue;
      for (const p of pendenciasDoProduto({ ncm: o.ncm, cfop: s.cfop, cest: o.cest, csosn: s.csosn, origem: 0, unidadeComercial: "UN" }, 1)) {
        problemas.push(`${s.nome} ${o.ncm}: ${p.mensagem}`);
      }
      const c = problemaDaCombinacao({ csosn: s.csosn, cest: o.cest });
      if (c) problemas.push(`${s.nome}: ${c}`);
    }
  }
  confere("nenhuma pendência de produto (CSOSN×CFOP, CEST, NCM) nas sugestões da NIK", problemas, []);
}

// Um produto de cada regra, para conferir códigos e fontes de TODAS as regras.
const AMOSTRA = [
  "Pizza Portuguesa", "Esfiha de Carne", "Esfiha de Chocolate", "Coxinha de Frango", "Pastel de Carne", "Quibe Frito", "Empada de Palmito",
  "Ravioli de Queijo", "Lasanha à Bolonhesa", "Macarrão ao Sugo", "Batata Frita", "Sorvete de Creme", "Pudim de Leite", "Brigadeiro",
  "Bolo de Cenoura", "X-Bacon", "Queijo Quente", "Prato Feito de Frango", "Feijoada", "Salada Verde", "Coca-Cola Lata", "Coca-Cola 600ml",
  "Guaraná KS vidro", "Refrigerante retornável 1 litro retornavel", "Água Mineral 500ml", "Água em copo 200ml", "Água com sabor limão",
  "Galão de água 20 litros", "Red Bull lata", "Monster 473ml pet", "Gatorade", "Cerveja Brahma 600ml", "Heineken Long Neck", "Chopp Brahma 300ml",
  "Heineken 0.0 lata", "Cerveja Barril", "Cerveja PET", "Suco de Laranja Natural", "Suco de Maracujá", "Suco de Acerola", "Suco de Abacaxi",
  "Suco de Maçã", "Suco de Tomate", "Suco Misto", "Suco de Caju", "Néctar de Pêssego", "Limonada Suíça", "Chá Gelado Lipton", "Água de Coco",
  "Caipirinha", "Batida de Coco", "Cachaça Ypioca dose", "Rum Bacardi", "Vodka Absolut", "Whisky Red Label", "Gin Tanqueray", "Tequila José Cuervo",
  "Licor 43", "Conhaque Dreher", "Campari", "Martini Bianco", "Vinho Tinto Malbec", "Espumante Brut", "Saquê", "Smirnoff Ice",
  "Ketchup", "Maionese", "Mostarda", "Shoyu", "Molho Barbecue", "Caixa de pizza", "Pote 500ml",
];

console.log("\n— códigos conferidos na tabela NCM e no Convênio 142/18");
{
  const amostra = AMOSTRA.map((nome, i) => ({ id: `a${i}`, nome, categoria: /caixa|pote/i.test(nome) ? "Embalagens" : "Cardápio" }));
  const r = sugerirParaCardapio(amostra, CONTEXTO_NIK);
  const semRegra = r.filter((s) => !s.regra);
  confere("a amostra cobre as regras (nenhuma sem sugestão)", semRegra.map((s) => s.nome), []);
  const todas = [...r, ...sugestoes];
  const ncmFora = [...new Set(todas.flatMap((s) => s.opcoes.map((o) => o.ncm)))].filter((n) => !(n in NCM_CONFERIDOS));
  confere("todo NCM sugerido está na lista conferida na tabela oficial", ncmFora, []);
  const cestFora = [...new Set(todas.flatMap((s) => s.opcoes.map((o) => o.cest)).filter((c): c is string => Boolean(c)))].filter((c) => !(c in CEST_CONFERIDOS));
  confere("todo CEST sugerido está na lista conferida no Convênio 142/18", cestFora, []);
  const semFonteNcm = todas.flatMap((s) => s.opcoes.filter((o) => !o.fontes.includes("ncm")).map((o) => `${s.nome} ${o.ncm}`));
  confere("toda opção cita a tabela NCM", semFonteNcm, []);
  const semFonteCest = todas.flatMap((s) => s.opcoes.filter((o) => o.cest && !o.fontes.some((f) => String(f).startsWith("cestAnexo"))).map((o) => `${s.nome} ${o.cest}`));
  confere("toda opção com CEST cita o anexo do Convênio 142/18", semFonteCest, []);
  const fontesInexistentes = todas.flatMap((s) => [...s.fontes, ...s.opcoes.flatMap((o) => o.fontes)]).filter((f) => !(f in FONTES));
  confere("toda fonte citada existe em FONTES", [...new Set(fontesInexistentes)], []);
  const d = (nome: string) => r.find((s) => s.nome === nome)!;
  confere("pastel: 1902.20.00 mesmo com carne (SC Cosit 98.186/2019), sem pergunta", [d("Pastel de Carne").regra, ncms(d("Pastel de Carne")), d("Pastel de Carne").pergunta], ["pastel", ["19022000"], null]);
  confere("coxinha de frango: 1905.90.90 (SC 98.415/2021) ou 1602.32.30", [d("Coxinha de Frango").regra, ncms(d("Coxinha de Frango"))], ["salgado-com-carne", ["19059090", "16023230"]]);
  confere("prato com frango: 2106.90.90 (SC 98.192/2020) ou Cap. 16", ncms(d("Prato Feito de Frango")), ["21069090", "16023230"]);
  confere("pudim: 1901.90.90 (SC 98.285/2024)", ncms(d("Pudim de Leite")), ["19019090"]);
  confere("sorvete: 2105.00.10, CEST 23.001.00, ST no DF", [ncms(d("Sorvete de Creme")), cests(d("Sorvete de Creme")), d("Sorvete de Creme").substituicao], [["21050010"], ["2300100"], "sim"]);
  confere("caipirinha: drinque da casa (2208.90.00, CEST 02.023.00), produção própria 5101/102", [ncms(d("Caipirinha")), cests(d("Caipirinha")), d("Caipirinha").cfop, d("Caipirinha").csosn], [["22089000"], ["0202300"], "5101", "102"]);
  confere("vodca (garrafa): 2208.60.00, CEST 02.018.00, 5405/500 com o aviso do DF", [ncms(d("Vodka Absolut")), cests(d("Vodka Absolut")), d("Vodka Absolut").cfop, d("Vodka Absolut").substituicao, d("Vodka Absolut").avisos.some((a) => /Caderno I/.test(a))], [["22086000"], ["0201800"], "5405", "provavel", true]);
  confere("cerveja sem álcool em lata: 2202.91.00, CEST 03.022.03", [ncms(d("Heineken 0.0 lata")), cests(d("Heineken 0.0 lata"))], [["22029100"], ["0302203"]]);
  confere("cerveja 600 ml: garrafa retornável (03.021.00); long neck: vidro descartável (03.021.01)", [cests(d("Cerveja Brahma 600ml")), cests(d("Heineken Long Neck"))], [["0302100"], ["0302101"]]);
  confere("chope: CEST 03.023.00", cests(d("Chopp Brahma 300ml")), ["0302300"]);
  confere("água em copo: 03.005.00; galão de 20 l: 03.024.00", [cests(d("Água em copo 200ml")), cests(d("Galão de água 20 litros"))], [["0300500"], ["0302400"]]);
}

console.log("\n— regime: MEI, CRT 2 e outra UF");
{
  const nik = lista.find((p) => p.nome === "Coca Cola Lata 310ml")!;
  const mei = sugerirFiscal(nik, { regime: 4, uf: "DF" });
  confere("MEI: refrigerante vai 5102/102 (NT 2024.001), com o aviso", [mei.cfop, mei.csosn, mei.avisos.some((a) => /MEI/.test(a))], ["5102", "102", true]);
  const meiPizza = sugerirFiscal({ nome: "Pizza Calabresa", categoria: "Pizzas" }, { regime: 4 });
  confere("MEI: pizza também 5102/102", [meiPizza.cfop, meiPizza.csosn], ["5102", "102"]);
  const problemasMei = sugerirParaCardapio(lista, { regime: 4, uf: "DF" }).flatMap((s) =>
    s.opcoes.flatMap((o) => (s.cfop && s.csosn ? pendenciasDoProduto({ ncm: o.ncm, cfop: s.cfop, cest: o.cest, csosn: s.csosn, origem: 0, unidadeComercial: "UN" }, 4) : [])).map((p) => `${s.nome}: ${p.mensagem}`)
  );
  confere("MEI: o cardápio inteiro passa na conferência do MEI (5102 e CSOSN 102)", problemasMei, []);
  const crt2 = sugerirFiscal({ nome: "Pizza Calabresa", categoria: "Pizzas" }, { regime: 2 });
  confere("CRT 2: sem CSOSN (usa CST — rejeição 590), com o aviso", [crt2.csosn, crt2.cfop, crt2.avisos.some((a) => /CST/.test(a))], [null, "5101", true]);
  const rj = sugerirFiscal({ nome: "Cerveja Heineken lata" }, { regime: 1, uf: "RJ" });
  confere("fora do DF: ST \"provável\", com o aviso de conferir a nota de compra", [rj.substituicao, rj.avisos.some((a) => /cada estado/.test(a))], ["provavel", true]);
}

console.log("\n— lote por categoria");
{
  const trad = sugestoes.filter((s) => s.categoria === "Esfihas Tradicionais").map((s) => ({ ...s, ncmAtual: null }));
  const semResposta = montarLote(trad, {});
  confere("sem responder a pergunta: só as sem carne entram; as 3 com carne esperam", [semResposta.lote.length, semResposta.semResposta.map((s) => s.nome).sort()], [2, ["Esfiha Calabresa", "Esfiha Carne", "Esfiha Frango"]]);
  const ate20 = montarLote(trad, { "carne-mais-de-20": "ate20" });
  confere("\"até 20%\": as 5 com 1905.90.90", ate20.lote.map((l) => l.ncm), ["19059090", "19059090", "19059090", "19059090", "19059090"]);
  const mais20 = montarLote(trad, { "carne-mais-de-20": "mais20" });
  const porNome = Object.fromEntries(mais20.lote.map((l) => [trad.find((t) => t.produtoId === l.productId)!.nome, ncmComPontos(l.ncm)]));
  confere("\"mais de 20%\": cada uma pela sua carne; as sem carne continuam 1905.90.90", porNome, {
    "Esfiha Calabresa": "1601.00.00",
    "Esfiha Carne": "1602.50.00",
    "Esfiha Frango": "1602.32.30",
    "Esfiha Muçarela": "1905.90.90",
    "Esfiha Pizza": "1905.90.90",
  });
  const comNcm = trad.map((s, i) => ({ ...s, ncmAtual: i === 0 ? "19059090" : null }));
  const ate20Resp = { "carne-mais-de-20": "ate20" };
  const primeiro = comNcm[0].produtoId;
  const ids = (lista: Array<{ produtoId: string }>) => lista.map((s) => s.produtoId);
  const noLote = (r: ReturnType<typeof montarLote>) => r.lote.some((l) => l.productId === primeiro);
  confere("produto que já tem NCM fica como está quando não se pede para substituir", ids(montarLote(comNcm, ate20Resp).mantidos), [primeiro]);

  // "Substituir também o NCM já gravado" refaz a SUGESTÃO ainda não revisada:
  // a marca de fiscalConfig.ncmAssistido com o MESMO NCM do gravado.
  const refaz = montarLote(comNcm, ate20Resp, { substituirNcmGravado: true, marcas: { [primeiro]: { ncm: "19059090" } } });
  confere("com a marca de sugestão, \"substituir\" refaz o NCM (ainda é sugestão a revisar)", [noLote(refaz), refaz.revisados.length, refaz.revisadosSobrescritos.length, refaz.lote.length], [true, 0, 0, 5]);

  // O NCM REVISADO (o contador conferiu — a marca saiu) ou digitado à mão fica
  // FORA: um clique na categoria desfazia a revisão inteira.
  const semSegunda = montarLote(comNcm, ate20Resp, { substituirNcmGravado: true });
  confere("NCM revisado (sem a marca): \"substituir\" sozinho NÃO sobrescreve — fica em `revisados`", [noLote(semSegunda), ids(semSegunda.revisados), semSegunda.lote.length], [false, [primeiro], 4]);
  confere(
    "marca de OUTRO NCM (o gravado mudou à mão depois da sugestão): conta como revisado",
    ids(montarLote(comNcm, ate20Resp, { substituirNcmGravado: true, marcas: { [primeiro]: { ncm: "16025000" } } }).revisados),
    [primeiro]
  );
  const comSegunda = montarLote(comNcm, ate20Resp, { substituirNcmGravado: true, substituirRevisados: true });
  confere(
    "com a SEGUNDA escolha, o revisado entra — e volta em `revisadosSobrescritos` para a confirmação contar",
    [noLote(comSegunda), ids(comSegunda.revisadosSobrescritos), comSegunda.revisados.length, comSegunda.lote.length],
    [true, [primeiro], 0, 5]
  );
  confere("a segunda escolha sem a primeira não faz nada (o produto com NCM fica como está)", ids(montarLote(comNcm, ate20Resp, { substituirRevisados: true }).mantidos), [primeiro]);
  const todosRevisados = trad.map((s) => ({ ...s, ncmAtual: "19059090" }));
  const semResp1 = montarLote(todosRevisados, {}, { substituirNcmGravado: true });
  const semResp2 = montarLote(todosRevisados, {}, { substituirNcmGravado: true, substituirRevisados: true });
  confere(
    "revisado que depende da pergunta ainda sem resposta fica em semResposta: a conta da segunda escolha é exata",
    [semResp1.revisados.length, semResp1.semResposta.length, semResp2.revisadosSobrescritos.length, semResp2.lote.length],
    [2, 3, 2, 2]
  );
  confere(
    "situacaoDoNcmGravado: vazio, sugestão (com pontos ou sem) e revisado",
    [situacaoDoNcmGravado(null, null), situacaoDoNcmGravado("1905.90.90", { ncm: "19059090" }), situacaoDoNcmGravado("19059090", undefined), situacaoDoNcmGravado("19059090", { ncm: "16025000" }), situacaoDoNcmGravado("1905", { ncm: "1905" })],
    ["vazio", "sugestao", "revisado", "revisado", "vazio"]
  );
  const resumo = resumirPorCategoria(trad).find((c) => c.categoria === "Esfihas Tradicionais")!;
  confere("a categoria pergunta uma vez só, para os 3 produtos com carne", [resumo.perguntas.length, resumo.perguntas[0]?.pergunta.id, resumo.perguntas[0]?.produtos, resumo.semNcm], [1, "carne-mais-de-20", 3, 5]);
  confere("opcaoEscolhida: sem resposta = null; com resposta = a opção", [opcaoEscolhida(trad.find((s) => s.nome === "Esfiha Carne")!, {}), opcaoEscolhida(trad.find((s) => s.nome === "Esfiha Carne")!, { "carne-mais-de-20": "mais20" })?.ncm], [null, "16025000"]);
}

console.log("\n— a regra do CEST com ST (rejeição 806)");
{
  confere("CSOSN 500 sem CEST: recusado", Boolean(problemaDaCombinacao({ csosn: "500", cest: "" })), true);
  confere("CSOSN 500 com CEST: passa", problemaDaCombinacao({ csosn: "500", cest: "03.010.02" }), null);
  confere("CSOSN 102 sem CEST: passa", problemaDaCombinacao({ csosn: "102", cest: null }), null);
}

console.log("\n— texto");
{
  confere("normalizar tira acento e pontuação", normalizarTexto("Água Com Gás – 1,5L!"), "agua com gas 1 5l");
  confere("NCM e CEST com pontos", [ncmComPontos("19059090"), ncmComPontos("123")], ["1905.90.90", "123"]);
}

console.log("\n— a tela e as rotas (conferência estática)");
{
  const tela = readFileSync(join(__dirname, "../src/app/store/fiscal/NcmAssistido.tsx"), "utf8");
  verdade("painel: a planilha do contador sai da rota de produtos", tela.includes('href="/api/store/fiscal/products/planilha"') && tela.includes("Baixar planilha para o contador"));
  verdade("a pergunta é fieldset com legend e rádios (teclado e leitor de tela)", /<fieldset[\s\S]*?<legend[\s\S]*?type="radio"/.test(tela));
  verdade("o abre/fecha da categoria tem aria-expanded e aria-controls", tela.includes("aria-expanded={expandida}") && tela.includes("aria-controls={`${idBase}-detalhe`}"));
  verdade("aplicar em lote pede confirmação e fala em revisar com o contador", tela.includes("window.confirm(") && /revisar com o contador/.test(tela));
  verdade(
    "o lote da tela leva as marcas, e a segunda escolha só vale com a primeira",
    tela.includes("montarLote(produtos, respostas[categoria] ?? {}, opcoesDoLote(categoria))") &&
      tela.includes("substituirRevisados: substituir[categoria] === true && substituirRevisados[categoria] === true") &&
      /const opcoesDoLote = [\s\S]{0,80}marcas,/.test(tela)
  );
  verdade(
    "a segunda escolha é um checkbox com texto e descrição, e diz quantos revisados",
    tela.includes("Incluir também {revisaveis} produto(s) com NCM já revisado ou digitado à mão") &&
      tela.includes("aria-describedby={`${idBase}-revisados-ajuda`}") &&
      tela.includes("id={`${idBase}-revisados-ajuda`}")
  );
  verdade(
    "a confirmação diz quantos revisados seriam SOBRESCRITOS (e quantos ficam de fora)",
    tela.includes("r.revisadosSobrescritos.length") && tela.includes("SOBRESCRITOS") && tela.includes("r.revisados.length")
  );
  verdade("desmarcar a primeira escolha desfaz a segunda", tela.includes("if (!marcado) setSubstituirRevisados("));
  verdade("o resultado é anunciado (role=status)", tela.includes('role="status"'));
  const pagina = readFileSync(join(__dirname, "../src/app/store/fiscal/page.tsx"), "utf8");
  verdade("a tabela marca a sugestão aplicada (\"Sugestão aplicada\" + revisar com o contador)", pagina.includes('"Sugestão aplicada"') && pagina.includes("revisar com o contador"));
  const idsDoModal = ["produto-ncm", "produto-cest", "produto-cfop", "produto-csosn", "produto-pis", "produto-cofins"];
  confere("o editor do produto: cada rótulo com htmlFor e o id do campo", idsDoModal.filter((id) => pagina.split(`htmlFor="${id}"`).length !== 2 || pagina.split(`id="${id}"`).length !== 2), []);
  verdade("o editor do produto é um diálogo nomeado", pagina.includes('role="dialog" aria-modal="true" aria-labelledby="produto-tributacao-titulo"'));
  const rota = readFileSync(join(__dirname, "../src/app/api/store/fiscal/products/route.ts"), "utf8");
  verdade("o lote é tudo ou nada, numa transação", rota.includes("prisma.$transaction(") && rota.includes("Nada foi gravado"));
  verdade("o lote confere CSOSN×CFOP (pendenciasDoProduto) e o CEST do CSOSN 500", rota.includes("pendenciasDoProduto({ ncm, cfop, cest, csosn") && rota.includes("problemaDaCombinacao({ csosn, cest })"));
  verdade("o lote e o \"revisado\" são só do titular", rota.includes('if (role === "STAFF")') && (rota.match(/soTitular\(ctx\.user\.role\)/g) ?? []).length === 2);
  const planilha = readFileSync(join(__dirname, "../src/app/api/store/fiscal/products/planilha/route.ts"), "utf8");
  verdade("a planilha usa montarPlanilha e leva a aba de Fontes", planilha.includes("montarPlanilha([") && planilha.includes('nome: "Fontes"'));
}

async function doBanco() {
  if (!process.argv.includes("--banco")) return;
  console.log("\n— o cardápio de hoje, relido do banco (SÓ LEITURA)");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv").config({ path: join(__dirname, "..", ".env") });
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const linhas = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return tx.$queryRawUnsafe<Array<{ id: string; name: string; category: string; price: number; isBeverage: boolean; apenasEmCombo: boolean }>>(
        `SELECT id, name, category, price, "isBeverage", "apenasEmCombo" FROM "MenuProduct" WHERE "franchiseeId" = $1 AND active = true`,
        "cmtn5q78c00ebte01zsqrggqx"
      );
    });
    const r = sugerirParaCardapio(
      linhas.map((p) => ({ id: p.id, nome: p.name, categoria: p.category, preco: p.price, ehBebida: p.isBeverage, apenasEmCombo: p.apenasEmCombo })),
      CONTEXTO_NIK
    );
    console.log(`   ${linhas.length} produtos ativos lidos`);
    confere("no cardápio de hoje, nenhum produto sem sugestão", r.filter((s) => !s.regra).map((s) => `${s.categoria} / ${s.nome}`), []);
  } finally {
    await prisma.$disconnect();
  }
}

doBanco()
  .catch((e) => {
    falhas++;
    console.log(`❌ leitura do banco falhou: ${String(e?.message ?? e).slice(0, 200)}`);
  })
  .finally(() => {
    console.log(falhas === 0 ? "\n✅ Tudo certo." : `\n❌ ${falhas} falha(s).`);
    process.exit(falhas === 0 ? 0 : 1);
  });
