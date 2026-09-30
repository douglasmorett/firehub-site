/**
 * /src/lib/nfce/ncm-sugerido.ts
 *
 * NCM ASSISTIDO — sugere NCM, CEST, CFOP e CSOSN para o cardápio de
 * restaurante, pizzaria e lanchonete do Simples Nacional, pelas palavras do
 * NOME e da CATEGORIA de cada produto.
 *
 * ── Por quê ─────────────────────────────────────────────────────────────────
 *
 * Sem NCM a NFC-e não sai (lib/fiscal-validacao → pendenciasDoProduto), e a
 * primeira loja do emissor próprio, a NIK (Brasília-DF), tinha em 29/09/2026
 * 163 produtos ativos e NENHUM com NCM. Classificar produto a produto na
 * tabela da Receita é onde o lojista desiste; classificar tudo com um código
 * só (o "2106.90.90 para tudo" que o FireHub aplicava em silêncio até
 * 24/09/2026) é pior, porque parece resolvido e está errado.
 *
 * ── O que isto é, e o que não é ─────────────────────────────────────────────
 *
 * É SUGESTÃO para o lojista revisar com o contador — a classificação fiscal é
 * responsabilidade da empresa, e a tela diz isso antes de gravar. Cada regra
 * cita de onde veio (FONTES, logo abaixo): a tabela NCM vigente, o Convênio
 * ICMS 142/18 (CEST) e as Soluções de Consulta da Cosit sobre esfiha,
 * coxinha, pastel, pizza, prato pronto e sobremesa.
 *
 * Onde a regra fiscal depende de um fato que o nome não diz, a sugestão traz
 * as DUAS opções e uma PERGUNTA — a tela pede a escolha, nunca chuta. O caso
 * clássico: esfiha de carne. Até 20% do peso em carne ela é produto de
 * padaria (1905.90.90); acima disso vai para o Capítulo 16 (preparação de
 * carne), que foi o que a Receita decidiu para uma esfiha aberta de frango
 * com 30% de frango (Solução de Consulta Cosit nº 98.211/2025).
 *
 * ── CFOP e CSOSN ────────────────────────────────────────────────────────────
 *
 *  - Feito na casa (pizza, esfiha, salgado, lanche, prato, sobremesa, drinque):
 *    CFOP 5101 (venda de produção do estabelecimento) e CSOSN 102. É o que a
 *    SEFAZ-SP respondeu a um restaurante (RC 16.687/2017); a SEFAZ aceita 5102
 *    com CSOSN 102 também — o contador decide, a planilha mostra.
 *  - Revenda sem substituição tributária (suco de caixinha, molho, embalagem):
 *    CFOP 5102 e CSOSN 102.
 *  - Revenda com ST (cerveja, chope, refrigerante, água, energético,
 *    isotônico, sorvete e, em geral, destilados e vinho): CFOP 5405 e CSOSN
 *    500, com CEST obrigatório (rejeição 806). CSOSN 500 só é verdade se a
 *    NOTA DE COMPRA veio com o ICMS-ST retido pelo fornecedor — a tela e a
 *    planilha dizem isso.
 *  - MEI (CRT 4): a NFC-e só aceita CFOP 5102 e CSOSN 102/300 (NT 2024.001);
 *    toda sugestão sai assim, e a da bebida com ST ganha um aviso.
 *  - CRT 2 e 3 usam CST, não CSOSN (rejeição 590): o CSOSN fica em branco.
 *
 * Puro: sem banco, sem rede. Roda na tela (navegador), na rota da planilha e
 * no teste (scripts/teste-nfce-ncm.ts, com os nomes reais da NIK).
 */

// ─── FONTES ─────────────────────────────────────────────────────────────────
//
// Conferidas em 29/09/2026: a tabela NCM baixada do Portal Único Siscomex
// ("Vigente em 29/09/2026", Resolução Gecex nº 926/2026), o texto do Convênio
// ICMS 142/18 no site do CONFAZ (com as redações dos Conv. ICMS 150/20, 74/21,
// 95/24 e 206/23) e as ementas das Soluções de Consulta no DOU.

export type Fonte = { titulo: string; url?: string };

export const FONTES = {
  ncm: {
    titulo:
      "Tabela NCM da TEC (Resolução Gecex nº 272/2021), versão vigente em 29/09/2026 (Resolução Gecex nº 926/2026), e TIPI (Decreto nº 11.158/2022)",
    url: "https://portalunico.siscomex.gov.br/classif/#/nomenclatura/tabela",
  },
  nota2Cap16: {
    titulo:
      "NCM, Nota 2 do Capítulo 16: preparação com mais de 20% do peso em carne, embutido, peixe ou crustáceo vai para o Capítulo 16 — exceto os produtos recheados da posição 19.02",
  },
  sc98211de2025: {
    titulo:
      "Solução de Consulta Cosit nº 98.211/2025 (DOU 11/09/2025): esfiha aberta de frango, com 30% do peso em frango → 1602.32.30",
  },
  sc98415de2021: {
    titulo: "Solução de Consulta Cosit nº 98.415/2021 (DOU 23/11/2021): coxinha de frango com recheio abaixo de 20% do peso → 1905.90.90",
  },
  sc98179de2025: {
    titulo: "Solução de Consulta Cosit nº 98.179/2025: coxinha de frango com 20,65% do peso em frango → 1602.32.90",
  },
  sc98186de2019: {
    titulo:
      "Solução de Consulta Cosit nº 98.186/2019: pastel de carne (35% de carne) → 1902.20.00 — a Nota 2 do Cap. 16 exclui os recheados da 19.02, qualquer que seja o teor de carne",
  },
  sc98277de2024: {
    titulo: "Solução de Consulta Cosit nº 98.277/2024: massa pré-assada para pizza → 1905.90.90",
  },
  sc98192de2020: {
    titulo: "Solução de Consulta Cosit nº 98.192/2020: prato pronto (escondidinho, carne bovina abaixo de 20% do peso) → 2106.90.90",
  },
  sc98285de2024: {
    titulo: "Solução de Consulta Cosit nº 98.285/2024: sobremesa láctea cremosa, pronta para consumo → 1901.90.90",
  },
  cestNaNota: {
    titulo:
      "Convênio ICMS 142/2018, cláusula vigésima, I: a nota traz \"o CEST de cada bem e mercadoria, ainda que a operação não esteja sujeita ao regime de substituição tributária\"",
    url: "https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18",
  },
  cestAnexoIII: {
    titulo: "Convênio ICMS 142/2018, Anexo III — bebidas alcoólicas, exceto cerveja e chope (CEST 02.xxx.xx)",
    url: "https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18",
  },
  cestAnexoIV: {
    titulo:
      "Convênio ICMS 142/2018, Anexo IV — cervejas, chopes, refrigerantes, águas e outras bebidas (CEST 03.xxx.xx; redação dos Conv. ICMS 150/20, 74/21 e 95/24)",
    url: "https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18",
  },
  cestAnexoXV: {
    titulo: "Convênio ICMS 142/2018, Anexo XV — papéis e plásticos (CEST 14.006.01: utensílios de mesa ou cozinha de plástico, descartáveis)",
    url: "https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18",
  },
  cestAnexoXVII: {
    titulo:
      "Convênio ICMS 142/2018, Anexo XVII — produtos alimentícios (CEST 17.xxx.xx; o item 62.1, CEST 17.062.01, cita \"produtos de panificação ... incluindo as pizzas\")",
    url: "https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18",
  },
  cestAnexoXXII: {
    titulo: "Convênio ICMS 142/2018, Anexo XXII — sorvetes (CEST 23.001.00)",
    url: "https://www.confaz.fazenda.gov.br/legislacao/convenios/2018/CV142_18",
  },
  cfop: {
    titulo:
      "Tabela CFOP (Convênio s/nº de 15/12/1970 — SINIEF): 5.101 venda de produção do estabelecimento; 5.102 venda de mercadoria de terceiros; 5.405 venda de mercadoria com ST, como contribuinte substituído",
  },
  cfopRestaurante: {
    titulo:
      "SEFAZ-SP, Resposta à Consulta nº 16.687/2017: a refeição preparada no estabelecimento vai com CFOP 5.101; a revenda, com 5.102 (ou 5.405, com ST)",
  },
  rejeicao386: {
    titulo:
      "MOC NFC-e, regras N12a-40/N12a-44 (rejeição 386): CSOSN 102 só com CFOP 5101, 5102, 5103, 5104 ou 5115; CSOSN 500 só com 5405, 5656 ou 5667",
  },
  rejeicao806: { titulo: "Rejeição 806: item com CSOSN 500 (ICMS-ST) sem CEST" },
  mei: { titulo: "NT 2024.001 (MEI na NFC-e): só CFOP 5102 (rejeição 337) e CSOSN 102 ou 300 (rejeição 782)" },
  crtSemCsosn: { titulo: "Rejeição 590: CSOSN informado por emitente fora do Simples — CRT 2 e 3 usam CST" },
  stDf: {
    titulo:
      "RICMS/DF (Decreto nº 18.955/1997), Anexo IV, Caderno I: item 3, \"cerveja, inclusive chope, refrigerantes, água mineral ou potável e gelo\" (energéticos e isotônicos equiparados a refrigerante), e sorvetes, em substituição tributária; pauta do item 3 na Portaria SEEC nº 299/2026",
  },
  segregacaoNoSimples: {
    titulo:
      "LC 123/2006, art. 18, § 4º-A, I: no PGDAS-D, a receita de produto com ICMS-ST e a de tributação monofásica (PIS/Cofins das bebidas frias, Lei nº 13.097/2015) é segregada",
  },
} as const satisfies Record<string, Fonte>;

export type IdDaFonte = keyof typeof FONTES;

// ─── TIPOS ──────────────────────────────────────────────────────────────────

export type ProdutoParaSugestao = {
  id?: string;
  nome: string;
  categoria?: string | null;
  preco?: number | null;
  /** MenuProduct.isBeverage: sinal de bebida quando o nome não tem marca conhecida. */
  ehBebida?: boolean | null;
  /** MenuProduct.apenasEmCombo: opção de dentro de um item (sabor, borda, adicional). */
  apenasEmCombo?: boolean | null;
};

export type ContextoDaSugestao = {
  /** CRT: 1 Simples, 2 Simples com excesso de sublimite, 3 Normal, 4 MEI. Ausente = 1. */
  regime?: number | null;
  /** UF do emitente: decide o que já se sabe sobre ST (hoje: o DF). */
  uf?: string | null;
};

export type OpcaoDeNcm = {
  /** "unica" quando não há dúvida; senão a resposta da pergunta que leva a esta opção. */
  chave: string;
  /** Texto do botão de escolha. */
  rotulo: string;
  /** 8 dígitos, sem pontos (como a rota de produtos grava). */
  ncm: string;
  descricao: string;
  /** 7 dígitos, sem pontos; null quando o Convênio 142/18 não lista o produto. */
  cest: string | null;
  cestDescricao: string | null;
  fontes: IdDaFonte[];
};

export type Pergunta = { id: string; texto: string; ajuda: string };

export type SugestaoFiscal = {
  /** Id da regra que casou (null = sem sugestão). */
  regra: string | null;
  /** O que a regra achou que o produto é ("Pizza", "Refrigerante em lata"...). */
  rotulo: string;
  /** Uma opção = sugestão direta; duas = a tela pergunta (`pergunta`). Vazia = sem sugestão. */
  opcoes: OpcaoDeNcm[];
  pergunta: Pergunta | null;
  cfop: string | null;
  csosn: string | null;
  /** Substituição tributária: "sim" conferida na UF; "provavel" em geral; "nao". */
  substituicao: "sim" | "provavel" | "nao";
  producaoPropria: boolean;
  confianca: "alta" | "media" | "baixa";
  avisos: string[];
  /** Fontes do CFOP, do CSOSN e da ST (as do NCM/CEST ficam em cada opção). */
  fontes: IdDaFonte[];
  /** Combo/promoção: a nota só sai certa com a Engenharia de Combos. */
  combo?: boolean;
  /** Quando a regra veio de um produto irmão ("Calabresa" do 99Food ← "Pizza Calabresa"). */
  parecidoCom?: string | null;
};

// ─── TEXTO ──────────────────────────────────────────────────────────────────

/** minúsculas, sem acento, só letras/números separados por um espaço. */
export function normalizarTexto(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "19059090" → "1905.90.90" (a tela e a planilha mostram assim). */
export const ncmComPontos = (ncm: string | null | undefined): string => {
  const d = String(ncm ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d;
};

/** "1706201" → "17.062.01". */
export const cestComPontos = (cest: string | null | undefined): string => {
  const d = String(cest ?? "").replace(/\D/g, "");
  return d.length === 7 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}` : d;
};

// ─── AS OPÇÕES (NCM + CEST), com a descrição oficial ─────────────────────────

type Base = Omit<OpcaoDeNcm, "chave" | "rotulo">;

const op = (ncm: string, descricao: string, cest: string | null, cestDescricao: string | null, fontes: IdDaFonte[]): Base => ({
  ncm: ncm.replace(/\D/g, ""),
  descricao,
  cest: cest ? cest.replace(/\D/g, "") : null,
  cestDescricao,
  fontes,
});

const CEST_PANIFICACAO = "Outros bolos industrializados e produtos de panificação não especificados anteriormente, incluindo as pizzas";

const NCM = {
  pizza: op("1905.90.90", "Produtos de padaria e pastelaria — outros (1905.90.90)", "17.062.01", CEST_PANIFICACAO, [
    "ncm",
    "sc98277de2024",
    "cestAnexoXVII",
    "cestNaNota",
  ]),
  padaria: op("1905.90.90", "Produtos de padaria e pastelaria — outros (1905.90.90)", "17.062.01", CEST_PANIFICACAO, [
    "ncm",
    "nota2Cap16",
    "cestAnexoXVII",
    "cestNaNota",
  ]),
  // Coxinha, empada, enroladinho: a Receita pôs a coxinha com menos de 20% de
  // frango na 1905.90.90. O CEST fica em branco: o Anexo XVII tem, para esse
  // NCM, "salgadinhos diversos" (17.031.01) e "produtos de panificação"
  // (17.062.01), e escolher entre os dois é do contador.
  salgadoAte20: op("1905.90.90", "Produtos de padaria e pastelaria — outros (1905.90.90)", null, null, ["ncm", "sc98415de2021", "nota2Cap16"]),
  pastel: op("1902.20.00", "Massas alimentícias recheadas, mesmo cozidas ou preparadas de outro modo", "17.048.02", "Massas alimentícias recheadas (mesmo cozidas ou preparadas de outro modo)", [
    "ncm",
    "sc98186de2019",
    "cestAnexoXVII",
    "cestNaNota",
  ]),
  lancheAte20: op("1905.90.90", "Produtos de padaria e pastelaria — outros (1905.90.90)", null, null, ["ncm", "nota2Cap16"]),
  pratoAte20: op("2106.90.90", "Preparações alimentícias não especificadas nem compreendidas noutras posições — outras", null, null, [
    "ncm",
    "sc98192de2020",
    "nota2Cap16",
  ]),
  massaPreparada: op("1902.30.00", "Outras massas alimentícias (cozidas ou preparadas: macarrão, lasanha, nhoque)", null, null, ["ncm", "nota2Cap16"]),
  batata: op("2005.20.00", "Batatas preparadas, não congeladas (a porção frita servida na casa)", null, null, ["ncm"]),
  bolo: op("1905.90.90", "Produtos de padaria e pastelaria — outros (1905.90.90)", "17.062.01", CEST_PANIFICACAO, ["ncm", "cestAnexoXVII", "cestNaNota"]),
  sobremesaLactea: op("1901.90.90", "Preparações alimentícias de leite (pudim, mousse, pavê) — outras", null, null, ["ncm", "sc98285de2024"]),
  docesComCacau: op("1806.90.00", "Chocolate e outras preparações que contenham cacau — outros (brigadeiro, trufa)", "17.009.00", "Bombons, balas, caramelos, confeitos, pastilhas e outros produtos de confeitaria, contendo cacau", [
    "ncm",
    "cestAnexoXVII",
    "cestNaNota",
  ]),
  sorvete: op("2105.00.10", "Sorvetes, em embalagens imediatas de até 2 kg", "23.001.00", "Sorvetes de qualquer espécie", ["ncm", "cestAnexoXXII"]),
  // Capítulo 16, pela carne que PREDOMINA (Nota 2 do Cap. 16).
  frango: op("1602.32.30", "Preparações de galos e galinhas com 25% a 57% do peso em carne (de 20% a 25%: 1602.32.90)", "17.079.00", "Outras preparações e conservas de carne, miudezas ou de sangue", [
    "ncm",
    "nota2Cap16",
    "sc98211de2025",
    "sc98179de2025",
    "cestAnexoXVII",
  ]),
  bovina: op("1602.50.00", "Outras preparações e conservas de carne da espécie bovina", "17.079.06", "Outras preparações e conservas de carne, de miudezas ou de sangue, da espécie bovina", [
    "ncm",
    "nota2Cap16",
    "cestAnexoXVII",
  ]),
  suina: op("1602.49.00", "Outras preparações de carne da espécie suína, incluindo as misturas", "17.079.05", "Outras preparações e conservas de carne, de miudezas ou de sangue, da espécie suína: outras, incluindo as misturas", [
    "ncm",
    "nota2Cap16",
    "cestAnexoXVII",
  ]),
  presunto: op("1602.41.00", "Preparações de carne suína — pernas e respectivos pedaços (presunto)", "17.079.04", "Outras preparações e conservas de carne, de miudezas ou de sangue, da espécie suína: pernas e respectivos pedaços", [
    "ncm",
    "nota2Cap16",
    "cestAnexoXVII",
  ]),
  // O CEST 17.077.00 é "salsicha e linguiça" em si, não a preparação à base
  // delas: fica em branco para o contador decidir.
  embutido: op("1601.00.00", "Enchidos (linguiça, calabresa, salsicha) e preparações alimentícias à base desses produtos", null, null, ["ncm", "nota2Cap16"]),
  peixe: op("1604.20.90", "Outras preparações e conservas de peixes — outras (atum: 1604.20.10)", null, null, ["ncm", "nota2Cap16"]),
  // ── Bebidas ──
  refrigerante: op("2202.10.00", "Águas adicionadas de açúcar ou de outros edulcorantes, ou aromatizadas (refrigerantes)", null, null, ["ncm", "cestAnexoIV"]),
  aguaMineral: op("2201.10.00", "Águas minerais e águas gaseificadas, sem açúcar nem aroma", null, null, ["ncm", "cestAnexoIV"]),
  aguaPotavel: op("2201.90.00", "Outras águas sem açúcar nem aroma (potável, purificada, adicionada de sais)", null, null, ["ncm", "cestAnexoIV"]),
  aguaAromatizada: op("2202.10.00", "Águas aromatizadas (água com sabor)", "03.007.00", "Água aromatizada artificialmente, exceto os refrescos e refrigerantes", ["ncm", "cestAnexoIV"]),
  energetico: op("2202.99.00", "Outras bebidas não alcoólicas (energéticos)", null, null, ["ncm", "cestAnexoIV"]),
  isotonico: op("2202.99.00", "Outras bebidas não alcoólicas (isotônicos)", "03.015.00", "Bebidas hidroeletrolíticas", ["ncm", "cestAnexoIV"]),
  cerveja: op("2203.00.00", "Cervejas de malte", null, null, ["ncm", "cestAnexoIV"]),
  chope: op("2203.00.00", "Cervejas de malte (chope)", "03.023.00", "Chope", ["ncm", "cestAnexoIV"]),
  cervejaSemAlcool: op("2202.91.00", "Cerveja sem álcool", null, null, ["ncm", "cestAnexoIV"]),
  nectar: op("2202.99.00", "Outras bebidas não alcoólicas (néctar de fruta, bebida de fruta com água e açúcar)", "17.112.00", "Néctares de frutas e outras bebidas não alcoólicas prontas para beber, exceto bebidas hidroeletrolíticas e energéticos", [
    "ncm",
    "cestAnexoXVII",
    "cestNaNota",
  ]),
  refresco: op("2202.10.00", "Águas adicionadas de açúcar ou aromatizadas (limonada, refresco)", "17.111.00", "Refrescos e outras bebidas não alcoólicas, exceto os refrigerantes e as demais bebidas nos CEST 03.007.00 e 17.110.00", [
    "ncm",
    "cestAnexoXVII",
    "cestNaNota",
  ]),
  chaPronto: op("2202.99.00", "Outras bebidas não alcoólicas (chá ou mate pronto para beber)", "17.113.00", "Bebidas prontas à base de mate ou chá", ["ncm", "cestAnexoXVII", "cestNaNota"]),
  aguaDeCoco: op("2009.89.21", "Água de coco com valor Brix não superior a 7,4", "17.011.00", "Água de coco", ["ncm", "cestAnexoXVII", "cestNaNota"]),
  // ── Alcoólicas (Anexo III do Convênio 142/18) ──
  cachaca: op("2208.40.00", "Rum e outras aguardentes da cana-de-açúcar (cachaça)", "02.004.00", "Cachaça e aguardentes", ["ncm", "cestAnexoIII"]),
  rum: op("2208.40.00", "Rum e outras aguardentes da cana-de-açúcar", "02.012.00", "Rum", ["ncm", "cestAnexoIII"]),
  vodka: op("2208.60.00", "Vodca", "02.018.00", "Vodka", ["ncm", "cestAnexoIII"]),
  uisque: op("2208.30.20", "Uísques em embalagens de até 2 l", "02.016.00", "Uísque", ["ncm", "cestAnexoIII"]),
  gim: op("2208.50.00", "Gim e genebra", "02.008.00", "Gim (gin) e genebra", ["ncm", "cestAnexoIII"]),
  tequila: op("2208.90.00", "Outras bebidas espirituosas (tequila)", "02.015.00", "Tequila", ["ncm", "cestAnexoIII"]),
  licor: op("2208.70.00", "Licores", "02.010.00", "Licores e similares", ["ncm", "cestAnexoIII"]),
  conhaque: op("2208.20.00", "Aguardentes de vinho ou de bagaço de uvas (conhaque)", "02.006.00", "Conhaque, brandy e similares", ["ncm", "cestAnexoIII"]),
  aperitivo: op("2208.90.00", "Outras bebidas espirituosas (aperitivos e amargos)", "02.001.00", "Aperitivos, amargos, bitter e similares", ["ncm", "cestAnexoIII"]),
  vermute: op("2205.10.00", "Vermutes e outros vinhos aromatizados, em recipientes de até 2 l", "02.017.00", "Vermute e similares", ["ncm", "cestAnexoIII"]),
  vinho: op("2204.21.00", "Outros vinhos, em recipientes de até 2 l", "02.024.00", "Vinhos de uvas frescas, incluindo os vinhos enriquecidos com álcool; mostos de uvas", ["ncm", "cestAnexoIII"]),
  espumante: op("2204.10.90", "Vinhos espumantes e espumosos — outros (tipo champanhe: 2204.10.10)", "02.024.00", "Vinhos de uvas frescas, incluindo os vinhos enriquecidos com álcool; mostos de uvas", ["ncm", "cestAnexoIII"]),
  sake: op("2206.00.90", "Outras bebidas fermentadas (saquê)", "02.013.00", "Saquê", ["ncm", "cestAnexoIII"]),
  ice: op("2208.90.00", "Outras bebidas espirituosas (bebida \"ice\")", "02.003.00", "Bebida ice", ["ncm", "cestAnexoIII"]),
  coquetel: op("2208.90.00", "Outras bebidas espirituosas (caipirinha, drinque, coquetel preparado na casa)", "02.023.00", "Sangrias e coquetéis", ["ncm", "cestAnexoIII", "cestNaNota"]),
  batida: op("2208.90.00", "Outras bebidas espirituosas (batida)", "02.002.00", "Batida e similares", ["ncm", "cestAnexoIII", "cestNaNota"]),
  // ── Molhos e condimentos ──
  ketchup: op("2103.20.10", "Ketchup e outros molhos de tomate, em embalagens de até 1 kg", "17.034.00", "Catchup em embalagens imediatas de até 650 g (exceto sachês de até 10 g)", ["ncm", "cestAnexoXVII"]),
  maionese: op("2103.90.11", "Maionese, em embalagens de até 1 kg", "17.039.00", "Maionese em embalagens imediatas de até 650 g (exceto sachês de até 10 g)", ["ncm", "cestAnexoXVII"]),
  mostarda: op("2103.30.21", "Mostarda preparada, em embalagens de até 1 kg", "17.038.00", "Mostarda preparada em embalagens imediatas de até 650 g (exceto sachês de até 10 g)", ["ncm", "cestAnexoXVII"]),
  shoyu: op("2103.10.10", "Molho de soja, em embalagens de até 1 kg", "17.036.00", "Molhos de soja preparados em embalagens imediatas de até 650 g (exceto sachês de até 10 g)", ["ncm", "cestAnexoXVII"]),
  molhoOutros: op("2103.90.91", "Outros molhos preparados, em embalagens de até 1 kg", "17.035.00", "Condimentos e temperos compostos, incluindo molho de pimenta e outros molhos, em embalagens de até 1 kg (exceto sachês de até 3 g)", [
    "ncm",
    "cestAnexoXVII",
    "cestNaNota",
  ]),
  condimento: op("2103.90.21", "Condimentos e temperos compostos, em embalagens de até 1 kg", "17.035.00", "Condimentos e temperos compostos, incluindo molho de pimenta e outros molhos, em embalagens de até 1 kg (exceto sachês de até 3 g)", [
    "ncm",
    "cestAnexoXVII",
    "cestNaNota",
  ]),
  // ── Embalagens cobradas à parte ──
  caixaOndulada: op("4819.10.00", "Caixas de papel ou cartão ondulado (papelão)", null, null, ["ncm"]),
  caixaLisa: op("4819.20.00", "Caixas e cartonagens dobráveis, de papel ou cartão não ondulado", null, null, ["ncm"]),
  poteEmbalagem: op("3923.10.90", "Caixas, potes e artigos semelhantes de plástico, para embalagem", null, null, ["ncm"]),
  poteUtensilio: op("3924.10.00", "Serviços de mesa e utensílios de mesa ou de cozinha, de plástico", "14.006.01", "Serviços de mesa e outros utensílios de mesa ou de cozinha, de plástico, descartáveis", [
    "ncm",
    "cestAnexoXV",
  ]),
} as const;

// ─── PALAVRAS ───────────────────────────────────────────────────────────────

const P = {
  // Nem "grátis" (a NIK tem a categoria "QUARTA COM BORDA GRÁTIS", de pizzas
  // avulsas) nem "kit" ("Kit Kat" na esfiha doce): os dois pegavam item que
  // não é combo.
  combo: /\b(combos?|promocao|promocoes|promo)\b/,
  pizza: /\bpizzas?\b/,
  borda: /\bbordas?\b/,
  esfiha: /\b(esfihas?|esfirras?|esfiras?|sfihas?|esfihinhas?)\b/,
  pastel: /\b(pastel|pasteis|pastelzinho|pasteizinhos)\b/,
  salgado: /\b(coxinhas?|kibes?|quibes?|empadas?|empadinhas?|empadoes?|enroladinhos?|risoles?|rissoles?|croquetes?|bolinhas? de queijo|pao de queijo|paes de queijo|joelhos?|folhados?|salgados?|salgadinhos?|croissants?)\b/,
  kibe: /\b(kibes?|quibes?)\b/,
  lanche: /\b(hamburguer|hamburger|burgers?|x (bacon|tudo|salada|egg|burguer|burger|frango|calabresa)|sanduiches?|sandubas?|lanches?|misto quente|hot dog|cachorro quente|beirute|wrap|baguetes?|queijo quente|bauru)\b/,
  prato: /\b(pratos?|refeicao|refeicoes|marmitas?|executivos?|pf|parmegiana|parmegiana|parmigiana|estrogonofe|strogonoff|stroganoff|feijoada|escondidinho|a la minuta|file|bife|grelhados?|yakisoba|risotos?|porcao|porcoes|galinhada|moqueca|baiao|arroz|feijao|saladas?|omelete|tropeiro)\b/,
  massa: /\b(lasanhas?|macarrao|macarronada|espaguete|nhoque|talharim|penne|fettuccine|parafuso)\b/,
  massaRecheada: /\b(ravioli|raviolis|capeletti|capeletes?|tortellini|canelone)\b/,
  batata: /\b(batata frita|batatas fritas|fritas|batata rustica|batata palito)\b/,
  sobremesa: /\b(sobremesas?|doces?|confeitaria)\b/,
  bolo: /\b(bolos?|tortas? doces?|brownies?|petit gateau|cheesecake|bolo de pote|cupcakes?|rocambole|tortas?)\b/,
  sobremesaLactea: /\b(pudim|pudins|mousse|pave|creme de papaya|manjar|doce de colher)\b/,
  docesComCacau: /\b(brigadeiros?|trufas?|bombons?|palha italiana)\b/,
  sorvete: /\b(sorvetes?|picoles?|gelato|sundae|milk shake|milkshake|casquinha|taca de sorvete)\b/,
  adicional: /\b(adicionais|adicional|extras?|acrescimos?|complementos?)\b/,
  embalagemCategoria: /\b(embalagens?|descartaveis)\b/,
  embalagemNome: /^(cx|caixa|caixas|embalagem|embalagens|vasilha|vasilhas|pote|potes|marmitex|sacola|sacolas)\b/,
  caixa: /\b(cx|caixa|caixas)\b/,
  pote: /\b(vasilha|vasilhas|pote|potes|marmitex|marmitinha)\b/,
  molhoCategoria: /\b(molhos?|saches?|condimentos?|temperos?)\b/,
  sache: /\b(saches?|sachet|saquinhos?)\b/,
  ketchup: /\b(ketchup|catchup|catsup)\b/,
  maionese: /\bmaionese\b/,
  mostarda: /\bmostarda\b/,
  shoyu: /\b(shoyu|molho de soja)\b/,
  molho: /\b(molhos?|barbecue|bbq|pimenta|chimichurri|tare|teriyaki)\b/,
  // ── bebidas ──
  bebidaCategoria: /\b(bebidas?|refrigerantes?|drinks?|drinques?|cervejas?|sucos?|aguas?)\b/,
  cerveja: /\b(cervejas?|heineken|amstel|brahma|skol|budweiser|stella|corona|spaten|bohemia|itaipava|eisenbahn|devassa|petra|imperio|becks|michelob|patagonia|colorado|baden|serramalte|long neck|longneck|litrao|latao)\b/,
  chope: /\b(chope|chopp|chopes|chopps)\b/,
  semAlcool: /\b(sem alcool|zero alcool|0 0|00)\b/,
  refrigerante: /\b(refrigerantes?|refri|refris|coca|coca cola|pepsi|guarana|fanta|sprite|sukita|kuat|schweppes|tonica|soda|dolly|itubaina|tubaina|h2oh|h2o|mineirinho|citrus|7up|seven up|soda limonada)\b/,
  energetico: /\b(energeticos?|energy|red bull|redbull|monster|tnt|burn|baly|flying horse)\b/,
  isotonico: /\b(isotonicos?|gatorade|powerade|hidroeletroliticos?|hidroeletrolitica)\b/,
  agua: /\b(agua|aguas|bonafont|minalba|indaia|lindoya|crystal|sao lourenco|pureza vital)\b/,
  aguaDeCoco: /\bagua de coco\b/,
  aguaSabor: /\b(saborizada|aromatizada|com sabor|sabor)\b/,
  aguaPotavel: /\b(potavel|purificada|adicionada de sais|mineralizada)\b/,
  suco: /\b(sucos?|nectar|nectares|del valle|dafruta|maguary|prats|natural one|sufresh|greenpeople|green people)\b/,
  suco100: /\b(integral|100|prats|natural one|greenpeople|green people|espremido|espremida)\b/,
  nectar: /\bnectar(es)?\b/,
  sucoDaCasa: /\b(natural|da casa|feito na hora|polpa|jarra|copo|laranjada)\b/,
  limonada: /\b(limonada|limonadas|refresco|refrescos|laranjada)\b/,
  cha: /\b(cha gelado|ice tea|icetea|fuze|lipton|mate leao|cha mate|cha pronto)\b/,
  coquetel: /\b(caipirinhas?|caipiroskas?|caipivodkas?|caipisake|drinks?|drinques?|coqueteis|coquetel|sangria|gin tonica|mojito|pina colada|moscow mule|aperol spritz|spritz|negroni)\b/,
  batida: /\bbatidas?\b/,
  // Sem "51" e "salinas" soltos: casariam "Pizza 51 cm" ou um nome próprio.
  cachaca: /\b(cachaca|cachacas|pinga|aguardente|ypioca|velho barreiro)\b/,
  vodka: /\b(vodka|vodca|smirnoff|absolut|orloff|ciroc)\b/,
  uisque: /\b(whisky|whiskey|uisque|red label|black label|jack daniels|chivas|ballantines|old parr)\b/,
  gim: /\b(gin|gim|tanqueray|beefeater|bombay)\b/,
  rum: /\b(rum|bacardi|montilla)\b/,
  tequila: /\b(tequila|jose cuervo)\b/,
  licor: /\b(licor|licores|amarula|baileys|frangelico|cointreau)\b/,
  conhaque: /\b(conhaque|brandy|dreher|domecq)\b/,
  aperitivo: /\b(campari|aperol|bitter|fernet|jagermeister|cynar)\b/,
  vermute: /\b(vermute|martini|cinzano)\b/,
  vinho: /\b(vinhos?|tinto|branco seco|cabernet|merlot|malbec|carmenere|sauvignon|chardonnay|taca de vinho)\b/,
  espumante: /\b(espumantes?|champagne|champanhe|prosecco|moscatel)\b/,
  sake: /\b(saque|sake)\b/,
  ice: /\b(smirnoff ice|skol beats|bebida ice)\b/,
  // ── embalagem da bebida (decide o CEST) ──
  lata: /\b(lata|latas|latinha|latao|can)\b/,
  vidro: /\b(vidro|long neck|longneck|ks|garrafinha de vidro)\b/,
  retornavel: /\b(retornavel|retornaveis|casco|litrao|600 ?ml|600ml|1 litro retornavel)\b/,
  pet: /\b(pet|plastico|plastica)\b/,
  barril: /\b(barril|barris)\b/,
  copo: /\bcopo\b/,
  jarra: /\bjarra\b/,
  galao: /\b(galao|galoes|bombona|20 ?l|20 litros|10 ?l|10 litros)\b/,
  volumeGrande: /\b(\d+(?: \d+)? ?l|\d+(?: \d+)? ?litros?|[5-9]\d\d ?ml|\d{4} ?ml)\b/,
} as const;

/** Carne que predomina, na ORDEM em que aparece no nome ("Carne e Bacon" → bovina). */
const CARNES: Array<{ tipo: "embutido" | "frango" | "bovina" | "presunto" | "suina" | "peixe"; re: RegExp }> = [
  { tipo: "embutido", re: /\b(calabresa|linguica|salsicha|salame|pepperoni|peperoni|mortadela|toscana)\b/ },
  { tipo: "frango", re: /\b(frango|galinha|chester|peito de peru|peru)\b/ },
  {
    tipo: "bovina",
    re: /\b(carne|carnes|costela|churrasco|picanha|cupim|mignon|alcatra|maminha|fraldinha|kafta|kofta|carne seca|charque|hamburguer|hamburger|burger|bife|contra file|acem|patinho|moida|bolonhesa|cheeseburger|file|cordeiro)\b/,
  },
  { tipo: "presunto", re: /\bpresunto\b/ },
  { tipo: "suina", re: /\b(lombo|lombinho|bacon|pernil|costelinha|porco|suino|suina|panceta|torresmo)\b/ },
  { tipo: "peixe", re: /\b(atum|bacalhau|sardinha|salmao|camarao|camaroes|peixe|tilapia|frutos do mar|kani|siri)\b/ },
];

function carneDoNome(texto: string): (typeof CARNES)[number]["tipo"] | null {
  let melhor: { tipo: (typeof CARNES)[number]["tipo"]; pos: number } | null = null;
  for (const c of CARNES) {
    const m = c.re.exec(texto);
    if (m && (melhor === null || m.index < melhor.pos)) melhor = { tipo: c.tipo, pos: m.index };
  }
  return melhor?.tipo ?? null;
}

const DOCE_NA_ESFIHA_OU_PIZZA =
  /\b(chocolate|choco|nutella|ninho|doce de leite|banana|banoffe|banoffee|confete|confetes|kit kat|kitkat|morango|prestigio|brigadeiro|romeu e julieta|goiabada|acucar|canela|ouro branco|oreo|sonho de valsa|charge|nevada|leite condensado|doce|doces|uva|abacaxi|coco|beijinho|m m|mms|ovomaltine|nutela)\b/;

// ─── CONTEXTO: regime e UF decidem CFOP, CSOSN e o que se sabe de ST ─────────

type Operacao = "producao" | "revenda" | "revendaST";

function cfopECsosn(
  operacao: Operacao,
  regime: number
): { cfop: string | null; csosn: string | null; fontes: IdDaFonte[]; avisos: string[] } {
  const fontesBase: IdDaFonte[] = ["cfop", "rejeicao386"];
  if (regime === 4) {
    // MEI: a NFC-e só aceita 5102 e CSOSN 102/300 (NT 2024.001).
    return {
      cfop: "5102",
      csosn: "102",
      fontes: ["mei", ...fontesBase],
      avisos:
        operacao === "revendaST"
          ? ["MEI: na NFC-e vai CSOSN 102 e CFOP 5102 mesmo em produto com ST — a SEFAZ recusa o 500 do MEI (rejeição 782)."]
          : [],
    };
  }
  const cfop = operacao === "producao" ? "5101" : operacao === "revenda" ? "5102" : "5405";
  const fontes: IdDaFonte[] = operacao === "producao" ? ["cfop", "cfopRestaurante", "rejeicao386"] : fontesBase;
  if (operacao === "revendaST") fontes.push("rejeicao806", "segregacaoNoSimples");
  if (regime === 2 || regime === 3) {
    return {
      cfop,
      csosn: null,
      fontes: [...fontes, "crtSemCsosn"],
      avisos: [`CRT ${regime}: a situação tributária é CST (não CSOSN) — defina com o contador.`],
    };
  }
  return { cfop, csosn: operacao === "revendaST" ? "500" : "102", fontes, avisos: [] };
}

/** O que se sabe da ST de cada grupo de bebida na UF (conferido: DF). */
function stDaBebida(grupo: "anexoIV" | "alcoolica" | "sorvete", uf: string): { substituicao: "sim" | "provavel"; avisos: string[]; fontes: IdDaFonte[] } {
  const u = String(uf || "").toUpperCase();
  if (u === "DF") {
    if (grupo === "alcoolica") {
      return {
        substituicao: "provavel",
        fontes: ["stDf"],
        avisos: [
          "No DF, o Caderno I do Anexo IV do RICMS/DF não lista vinho nem destilados na substituição tributária: se a nota de compra veio SEM ICMS-ST, use CSOSN 102 e CFOP 5102.",
        ],
      };
    }
    return { substituicao: "sim", fontes: ["stDf"], avisos: [] };
  }
  return {
    substituicao: "provavel",
    fontes: [],
    avisos: ["Substituição tributária é regra de cada estado: confira na nota de compra se o fornecedor reteve o ICMS-ST."],
  };
}

// ─── A SUGESTÃO DE UM PRODUTO ───────────────────────────────────────────────

const AVISO_ST_NA_COMPRA =
  "CSOSN 500 só vale se a nota de COMPRA veio com o ICMS-ST retido pelo fornecedor (está no XML dela). Sem ST na compra: CSOSN 102 e CFOP 5102.";
const AVISO_NCM_DA_COMPRA = "Na revenda, o NCM e o CEST certos estão na nota de compra do fornecedor — confira lá.";

function unica(base: Base, rotulo: string): OpcaoDeNcm[] {
  return [{ chave: "unica", rotulo, ...base }];
}

const PERGUNTA_CARNE: Pergunta = {
  id: "carne-mais-de-20",
  texto: "A carne (ou o embutido) passa de 20% do peso do produto?",
  ajuda:
    "Até 20% do peso em carne, o produto fica no NCM da massa/prato. Acima disso a regra da NCM (Nota 2 do Capítulo 16) manda para \"preparação de carne\" — foi o que a Receita decidiu para uma esfiha aberta de frango com 30% de frango (Solução de Consulta Cosit nº 98.211/2025). Na dúvida, pese uma unidade com e sem o recheio.",
};

function opcaoDaCarne(tipo: ReturnType<typeof carneDoNome>): Base {
  switch (tipo) {
    case "frango":
      return NCM.frango;
    case "embutido":
      return NCM.embutido;
    case "presunto":
      return NCM.presunto;
    case "suina":
      return NCM.suina;
    case "peixe":
      return NCM.peixe;
    default:
      return NCM.bovina;
  }
}

/** Duas opções: até 20% (a base) ou mais de 20% (Capítulo 16 pela carne que predomina). */
function comPerguntaDaCarne(ate20: Base, rotuloAte20: string, tipo: ReturnType<typeof carneDoNome>): { opcoes: OpcaoDeNcm[]; pergunta: Pergunta } {
  const carne = opcaoDaCarne(tipo);
  const nomeDaCarne =
    tipo === "frango" ? "frango" : tipo === "embutido" ? "embutido" : tipo === "presunto" ? "presunto" : tipo === "suina" ? "carne suína" : tipo === "peixe" ? "peixe" : "carne bovina";
  return {
    pergunta: PERGUNTA_CARNE,
    opcoes: [
      { chave: "ate20", rotulo: `Até 20% de carne: ${rotuloAte20}`, ...ate20 },
      { chave: "mais20", rotulo: `Mais de 20% (${nomeDaCarne}): preparação de carne`, ...carne },
    ],
  };
}

type Achado = {
  regra: string;
  rotulo: string;
  opcoes: OpcaoDeNcm[];
  pergunta?: Pergunta | null;
  operacao: Operacao;
  confianca: SugestaoFiscal["confianca"];
  avisos?: string[];
  grupoSt?: "anexoIV" | "alcoolica" | "sorvete";
  fontes?: IdDaFonte[];
  combo?: boolean;
};

/** O CEST do Anexo IV depende da EMBALAGEM: o nome costuma dizer ("lata", "2l", "long neck"). */
function embalagemDaBebida(texto: string): "lata" | "vidro" | "retornavel" | "pet" | "barril" | "copo" | "jarra" | "galao" | null {
  if (P.barril.test(texto)) return "barril";
  if (P.lata.test(texto)) return "lata";
  if (P.galao.test(texto)) return "galao";
  if (P.jarra.test(texto)) return "jarra";
  if (P.copo.test(texto)) return "copo";
  if (P.retornavel.test(texto)) return "retornavel";
  if (P.vidro.test(texto)) return "vidro";
  if (P.pet.test(texto) || P.volumeGrande.test(texto)) return "pet";
  return null;
}

function comCest(base: Base, cest: string | null, cestDescricao: string | null): Base {
  return { ...base, cest: cest ? cest.replace(/\D/g, "") : null, cestDescricao };
}

function bebida(texto: string): Achado | null {
  const emb = embalagemDaBebida(texto);
  const semEmbalagem = "O nome não diz a embalagem (lata, long neck, garrafa, PET): o CEST depende dela — complete o nome ou escolha o CEST na planilha.";

  if (P.aguaDeCoco.test(texto)) {
    return { regra: "agua-de-coco", rotulo: "Água de coco", opcoes: unica(NCM.aguaDeCoco, "Água de coco"), operacao: "revenda", confianca: "media", avisos: [AVISO_NCM_DA_COMPRA] };
  }
  if (P.energetico.test(texto)) {
    const cest = emb === "vidro" ? "03.013.02" : emb === "pet" ? "03.013.01" : "03.013.00";
    const desc = emb === "vidro" ? "Bebidas energéticas em vidro" : emb === "pet" ? "Bebidas energéticas em embalagem PET" : "Bebidas energéticas em lata";
    return {
      regra: "energetico",
      rotulo: "Energético",
      opcoes: unica(comCest(NCM.energetico, cest, desc), "Energético"),
      operacao: "revendaST",
      grupoSt: "anexoIV",
      confianca: emb ? "alta" : "media",
      avisos: emb ? [] : ["Embalagem suposta: lata (a mais comum). Se for PET ou vidro, o CEST muda."],
    };
  }
  if (P.isotonico.test(texto)) {
    return { regra: "isotonico", rotulo: "Isotônico", opcoes: unica(NCM.isotonico, "Isotônico"), operacao: "revendaST", grupoSt: "anexoIV", confianca: "alta" };
  }
  if (P.chope.test(texto)) {
    return { regra: "chope", rotulo: "Chope", opcoes: unica(NCM.chope, "Chope"), operacao: "revendaST", grupoSt: "anexoIV", confianca: "alta" };
  }
  if (P.cerveja.test(texto) && !/\bguarana\b/.test(texto)) {
    const semAlcool = P.semAlcool.test(texto) || /\bzero\b/.test(texto);
    const prefixo = semAlcool ? "03.022" : "03.021";
    const sufixo = emb === "lata" ? ".03" : emb === "vidro" ? ".01" : emb === "retornavel" ? ".00" : emb === "barril" ? ".04" : emb === "pet" ? ".05" : null;
    const nome = semAlcool ? "Cerveja sem álcool" : "Cerveja";
    const descs: Record<string, string> = {
      ".00": "em garrafa de vidro retornável",
      ".01": "em garrafa de vidro descartável",
      ".03": "em lata",
      ".04": "em barril",
      ".05": "em embalagem PET",
    };
    const base = semAlcool ? NCM.cervejaSemAlcool : NCM.cerveja;
    return {
      regra: semAlcool ? "cerveja-sem-alcool" : "cerveja",
      rotulo: sufixo ? `${nome} ${descs[sufixo]}` : nome,
      opcoes: unica(sufixo ? comCest(base, `${prefixo}${sufixo}`, `${nome} ${descs[sufixo]}`) : base, nome),
      operacao: "revendaST",
      grupoSt: "anexoIV",
      confianca: sufixo ? "alta" : "media",
      avisos: sufixo ? [] : [semEmbalagem],
    };
  }
  if (P.refrigerante.test(texto)) {
    // Água tônica é refrigerante (antes da regra da água).
    const cest = emb === "lata" ? "03.010.02" : emb === "vidro" ? "03.010.00" : emb === "retornavel" ? "03.011.00" : emb === "pet" ? "03.010.01" : null;
    const desc =
      emb === "lata" ? "Refrigerante em lata" : emb === "vidro" ? "Refrigerante em vidro descartável" : emb === "retornavel" ? "Demais refrigerantes" : emb === "pet" ? "Refrigerante em embalagem pet" : null;
    const avisos: string[] = [];
    if (!cest) avisos.push(semEmbalagem);
    else if (emb === "pet" && !P.pet.test(texto)) avisos.push("Embalagem suposta pelo volume: garrafa PET. Se for vidro, o CEST é 03.010.00.");
    if (/\bh2oh?\b/.test(texto)) avisos.push("H2OH! é registrada como refrigerante de baixa caloria — por isso a regra do refrigerante.");
    return {
      regra: "refrigerante",
      rotulo: desc || "Refrigerante",
      opcoes: unica(cest ? comCest(NCM.refrigerante, cest, desc) : NCM.refrigerante, "Refrigerante"),
      operacao: "revendaST",
      grupoSt: "anexoIV",
      confianca: cest ? (emb === "pet" && !P.pet.test(texto) ? "media" : "alta") : "media",
      avisos,
    };
  }
  if (P.agua.test(texto)) {
    if (P.aguaSabor.test(texto)) {
      return { regra: "agua-aromatizada", rotulo: "Água com sabor", opcoes: unica(NCM.aguaAromatizada, "Água aromatizada"), operacao: "revendaST", grupoSt: "anexoIV", confianca: "media" };
    }
    const base = P.aguaPotavel.test(texto) ? NCM.aguaPotavel : NCM.aguaMineral;
    const cest =
      emb === "copo" ? ["03.005.00", "Água mineral, gasosa ou não, ou potável, naturais, em copo plástico descartável"]
      : emb === "jarra" ? ["03.005.02", "Água mineral, gasosa ou não, ou potável, naturais, em jarra descartável"]
      : emb === "vidro" ? ["03.003.00", "Água mineral, gasosa ou não, ou potável, naturais, em embalagem de vidro descartável"]
      : emb === "galao" ? ["03.024.00", "Água mineral em embalagens retornáveis de 10 a 20 litros"]
      : ["03.005.04", "Água mineral, gasosa ou não, ou potável, naturais, em demais embalagens descartáveis"];
    return {
      regra: "agua",
      rotulo: "Água mineral",
      opcoes: unica(comCest(base, cest[0], cest[1]), "Água"),
      operacao: "revendaST",
      grupoSt: "anexoIV",
      confianca: emb ? "alta" : "media",
      avisos: emb ? [] : ["Embalagem suposta: garrafa plástica descartável (CEST 03.005.04). Se for vidro, é 03.003.00."],
    };
  }
  if (P.cha.test(texto)) {
    return { regra: "cha-pronto", rotulo: "Chá pronto", opcoes: unica(NCM.chaPronto, "Chá pronto"), operacao: "revenda", confianca: "media", avisos: [AVISO_NCM_DA_COMPRA] };
  }
  if (P.limonada.test(texto)) {
    return { regra: "limonada", rotulo: "Limonada / refresco da casa", opcoes: unica(NCM.refresco, "Refresco"), operacao: "producao", confianca: "media" };
  }
  if (P.suco.test(texto)) {
    const suco100 = sucoPelaFruta(texto);
    const daCasa = P.sucoDaCasa.test(texto) && !P.lata.test(texto);
    const operacao: Operacao = daCasa ? "producao" : "revenda";
    if (P.nectar.test(texto)) {
      return { regra: "nectar", rotulo: "Néctar", opcoes: unica(NCM.nectar, "Néctar"), operacao, confianca: "alta", avisos: daCasa ? [] : [AVISO_NCM_DA_COMPRA] };
    }
    if (P.suco100.test(texto)) {
      return { regra: "suco-100", rotulo: "Suco 100% (integral)", opcoes: unica(suco100, "Suco 100%"), operacao, confianca: "media", avisos: daCasa ? [] : [AVISO_NCM_DA_COMPRA] };
    }
    return {
      regra: "suco",
      rotulo: "Suco",
      pergunta: {
        id: "suco-ou-nectar",
        texto: "É suco 100% da fruta, ou leva água e açúcar (néctar, refresco)?",
        ajuda:
          "Suco 100% (integral) fica na posição 20.09, pela fruta. Néctar e bebida de fruta com água e açúcar ficam na 2202.99.00. A lata ou a caixinha diz: \"néctar\" ou \"100% suco\".",
      },
      opcoes: [
        { chave: "suco100", rotulo: "Suco 100% da fruta", ...suco100 },
        { chave: "nectar", rotulo: "Néctar / com água e açúcar", ...NCM.nectar },
      ],
      operacao,
      confianca: "media",
      avisos: daCasa ? [] : [AVISO_NCM_DA_COMPRA],
    };
  }
  // ── alcoólicas (a ordem importa: o drinque da casa antes da garrafa) ──
  if (P.coquetel.test(texto)) {
    return {
      regra: "drinque",
      rotulo: "Drinque preparado na casa",
      opcoes: unica(NCM.coquetel, "Coquetel"),
      operacao: "producao",
      confianca: "media",
      avisos: ["Drinque feito na casa é produção própria (CFOP 5101, CSOSN 102): a ST foi da garrafa comprada, não do drinque."],
    };
  }
  if (P.batida.test(texto)) {
    return { regra: "batida", rotulo: "Batida", opcoes: unica(NCM.batida, "Batida"), operacao: "producao", confianca: "media" };
  }
  const garrafa: Array<[RegExp, Base, string, string]> = [
    [P.espumante, NCM.espumante, "espumante", "Espumante"],
    [P.vermute, NCM.vermute, "vermute", "Vermute"],
    [P.aperitivo, NCM.aperitivo, "aperitivo", "Aperitivo / bitter"],
    [P.licor, NCM.licor, "licor", "Licor"],
    [P.uisque, NCM.uisque, "uisque", "Uísque"],
    [P.vodka, NCM.vodka, "vodka", "Vodca"],
    [P.gim, NCM.gim, "gim", "Gim"],
    [P.tequila, NCM.tequila, "tequila", "Tequila"],
    [P.rum, NCM.rum, "rum", "Rum"],
    [P.conhaque, NCM.conhaque, "conhaque", "Conhaque"],
    [P.cachaca, NCM.cachaca, "cachaca", "Cachaça"],
    [P.sake, NCM.sake, "sake", "Saquê"],
    [P.vinho, NCM.vinho, "vinho", "Vinho"],
    [P.ice, NCM.ice, "ice", "Bebida ice"],
  ];
  for (const [re, base, regra, rotulo] of garrafa) {
    if (re.test(texto)) {
      return { regra, rotulo, opcoes: unica(base, rotulo), operacao: "revendaST", grupoSt: "alcoolica", confianca: "media", avisos: [AVISO_NCM_DA_COMPRA] };
    }
  }
  return null;
}

/** O NCM do suco 100% pela fruta (subposições da 20.09 da tabela NCM). */
function sucoPelaFruta(texto: string): Base {
  const fruta = (ncm: string, descricao: string) => op(ncm, descricao, "17.010.00", "Sucos de frutas ou de produtos hortícolas; mistura de sucos", ["ncm", "cestAnexoXVII", "cestNaNota"]);
  if (/\b(misto|mix|frutas vermelhas|tropical)\b/.test(texto)) return fruta("2009.90.00", "Misturas de sucos");
  if (/\blaranja\b/.test(texto)) return fruta("2009.12.00", "Suco de laranja não congelado, com valor Brix até 20");
  if (/\buva\b/.test(texto)) return fruta("2009.61.00", "Suco de uva com valor Brix até 30");
  if (/\bmaca\b/.test(texto)) return fruta("2009.71.00", "Suco de maçã com valor Brix até 20");
  if (/\b(abacaxi|ananas)\b/.test(texto)) return fruta("2009.41.00", "Suco de abacaxi com valor Brix até 20");
  if (/\b(limao|lima)\b/.test(texto)) return fruta("2009.31.00", "Suco de outros cítricos com valor Brix até 20");
  if (/\btomate\b/.test(texto)) return fruta("2009.50.00", "Suco de tomate");
  if (/\bmaracuja\b/.test(texto)) return fruta("2009.89.13", "Suco de maracujá");
  if (/\bacerola\b/.test(texto)) return fruta("2009.89.12", "Suco de acerola");
  return fruta("2009.89.90", "Outros sucos de fruta (caju, manga, goiaba...) — confira a fruta na tabela");
}

/**
 * A comida feita na casa.
 *
 * A ORDEM importa: primeiro o nome com palavra forte (esfiha, pizza, pastel,
 * coxinha...), depois a categoria (o sabor "Calabresa" dentro de "Sabores de
 * Pizza"), e só por último as palavras fracas de lanche e prato. Assim
 * "Esfiha Pizza" é esfiha (e não pizza), e o sabor "Bauru" de "Sabores de
 * Pizza" é pizza (e não o lanche bauru).
 */
function comida(nome: string, categoria: string, principal: Achado | null): Achado | null {
  const doNome = (re: RegExp) => re.test(nome);
  const daCategoria = (re: RegExp) => re.test(categoria);

  const pizza = (): Achado => ({ regra: "pizza", rotulo: "Pizza", opcoes: unica(NCM.pizza, "Pizza"), operacao: "producao", confianca: "alta" });
  const borda = (): Achado => ({
    regra: "borda",
    rotulo: "Borda de pizza",
    opcoes: unica(NCM.pizza, "Pizza (borda)"),
    operacao: "producao",
    confianca: "alta",
    avisos: ["A borda é parte da pizza: vai com o NCM dela."],
  });
  const esfiha = (): Achado => {
    const doce = DOCE_NA_ESFIHA_OU_PIZZA.test(nome) || /\bdoces?\b/.test(categoria);
    const carne = doce ? null : carneDoNome(nome);
    if (!carne) {
      return {
        regra: doce ? "esfiha-doce" : "esfiha",
        rotulo: doce ? "Esfiha doce" : "Esfiha sem carne",
        opcoes: unica(NCM.padaria, "Esfiha"),
        operacao: "producao",
        confianca: "alta",
      };
    }
    const { opcoes, pergunta } = comPerguntaDaCarne(NCM.padaria, "produto de padaria", carne);
    return { regra: "esfiha-com-carne", rotulo: "Esfiha com carne", opcoes, pergunta, operacao: "producao", confianca: "media" };
  };
  const pastel = (): Achado => ({
    regra: "pastel",
    rotulo: "Pastel",
    opcoes: unica(NCM.pastel, "Pastel"),
    operacao: "producao",
    confianca: "alta",
    avisos: ["Pastel é massa recheada (19.02): fica no 1902.20.00 mesmo com mais de 20% de carne (Solução de Consulta Cosit nº 98.186/2019)."],
  });
  const salgado = (): Achado => {
    const carne = carneDoNome(nome);
    if (!carne) return { regra: "salgado", rotulo: "Salgado sem carne", opcoes: unica(NCM.salgadoAte20, "Salgado"), operacao: "producao", confianca: "media" };
    const { opcoes, pergunta } = comPerguntaDaCarne(NCM.salgadoAte20, "salgado de padaria", carne);
    return { regra: "salgado-com-carne", rotulo: "Salgado com carne", opcoes, pergunta, operacao: "producao", confianca: "media" };
  };
  const sorvete = (): Achado => ({
    regra: "sorvete",
    rotulo: "Sorvete",
    opcoes: unica(NCM.sorvete, "Sorvete"),
    operacao: "revendaST",
    grupoSt: "sorvete",
    confianca: "media",
    avisos: ["Sorvete feito na casa é produção própria: CSOSN 102 e CFOP 5101, e não 500."],
  });
  const bolo = (): Achado => {
    // "Torta de frango" é salgado de padaria, com a pergunta da carne.
    if (carneDoNome(nome)) return salgado();
    return { regra: "bolo", rotulo: "Bolo / torta doce", opcoes: unica(NCM.bolo, "Bolo / torta"), operacao: "producao", confianca: "media" };
  };
  const lanche = (): Achado => {
    const carne = carneDoNome(nome);
    if (!carne) return { regra: "lanche", rotulo: "Lanche sem carne", opcoes: unica(NCM.lancheAte20, "Lanche"), operacao: "producao", confianca: "media" };
    const { opcoes, pergunta } = comPerguntaDaCarne(NCM.lancheAte20, "lanche (pão recheado)", carne);
    return { regra: "lanche-com-carne", rotulo: "Lanche com carne", opcoes, pergunta, operacao: "producao", confianca: "media" };
  };
  const prato = (): Achado => {
    const carne = carneDoNome(nome);
    if (!carne) return { regra: "prato", rotulo: "Prato pronto sem carne", opcoes: unica(NCM.pratoAte20, "Prato"), operacao: "producao", confianca: "media" };
    const { opcoes, pergunta } = comPerguntaDaCarne(NCM.pratoAte20, "prato pronto", carne);
    return { regra: "prato-com-carne", rotulo: "Prato com carne", opcoes, pergunta, operacao: "producao", confianca: "media" };
  };

  // 1) Palavra forte no NOME.
  if (doNome(P.esfiha)) return esfiha();
  if (doNome(P.pizza)) return pizza();
  if (doNome(P.borda)) return borda();
  if (doNome(P.pastel)) return pastel();
  if (doNome(P.kibe)) {
    return {
      regra: "kibe",
      rotulo: "Quibe",
      opcoes: unica(NCM.bovina, "Quibe (carne bovina)"),
      operacao: "producao",
      confianca: "media",
      avisos: ["Quibe é carne moída com trigo: a carne passa de 20% do peso, então vai como preparação de carne bovina (Nota 2 do Capítulo 16)."],
    };
  }
  if (doNome(P.salgado)) return salgado();
  if (doNome(P.massaRecheada)) {
    return { regra: "massa-recheada", rotulo: "Massa recheada", opcoes: unica(NCM.pastel, "Massa recheada"), operacao: "producao", confianca: "media" };
  }
  if (doNome(P.massa)) {
    const carne = carneDoNome(nome);
    if (!carne) return { regra: "massa", rotulo: "Massa", opcoes: unica(NCM.massaPreparada, "Massa"), operacao: "producao", confianca: "media" };
    const { opcoes, pergunta } = comPerguntaDaCarne(NCM.massaPreparada, "massa preparada", carne);
    return { regra: "massa-com-carne", rotulo: "Massa com carne", opcoes, pergunta, operacao: "producao", confianca: "media" };
  }
  if (doNome(P.batata)) {
    return { regra: "batata-frita", rotulo: "Batata frita", opcoes: unica(NCM.batata, "Batata frita"), operacao: "producao", confianca: "media" };
  }
  // Sobremesas antes de lanche e prato: "Bolo de chocolate" não é prato.
  if (doNome(P.sorvete)) return sorvete();
  if (doNome(P.sobremesaLactea)) {
    return { regra: "sobremesa-lactea", rotulo: "Pudim / mousse", opcoes: unica(NCM.sobremesaLactea, "Sobremesa láctea"), operacao: "producao", confianca: "media" };
  }
  if (doNome(P.docesComCacau)) {
    return { regra: "doce-com-cacau", rotulo: "Brigadeiro / trufa", opcoes: unica(NCM.docesComCacau, "Doce com cacau"), operacao: "producao", confianca: "media" };
  }
  if (doNome(P.bolo)) return bolo();

  // 2) A CATEGORIA diz o que é (o sabor dentro de "Sabores de Pizza").
  if (daCategoria(P.pizza)) return pizza();
  if (daCategoria(P.borda)) return borda();
  if (daCategoria(P.esfiha)) return esfiha();
  if (daCategoria(P.pastel)) return pastel();
  if (daCategoria(P.salgado)) return salgado();
  if (daCategoria(P.sorvete)) return sorvete();

  // 3) Palavras fracas: lanche e prato, pelo nome e depois pela categoria.
  if (doNome(P.lanche)) return lanche();
  if (doNome(P.prato)) return prato();
  if (daCategoria(P.lanche)) return lanche();
  if (daCategoria(P.prato)) return prato();

  // 4) Adicional: segue o prato principal da loja (a pizza, a esfiha).
  if (daCategoria(P.adicional) || /^(adicional|extra|acrescimo)\b/.test(nome)) {
    const base = principal?.opcoes[0];
    if (!base || !principal) return null;
    return {
      regra: "adicional",
      rotulo: "Adicional do preparo",
      opcoes: [{ ...base, chave: "unica", rotulo: `Segue ${principal.rotulo.toLowerCase()}`, cest: null, cestDescricao: null }],
      operacao: "producao",
      confianca: "baixa",
      avisos: [
        `Adicional vendido junto do preparo segue o NCM do prato — aqui, o de ${principal.rotulo.toLowerCase()}, o principal do cardápio. Se ele acompanha outro prato, use o NCM daquele prato.`,
      ],
    };
  }
  return null;
}

function embalagemOuMolho(nome: string, categoria: string): Achado | null {
  const ehEmbalagem = P.embalagemCategoria.test(categoria) || P.embalagemNome.test(nome);
  if (ehEmbalagem) {
    const aviso = "Embalagem só vira item da nota quando é cobrada à parte. " + AVISO_NCM_DA_COMPRA;
    if (P.caixa.test(nome) || /\b\d+ ?cm\b/.test(nome)) {
      return {
        regra: "caixa",
        rotulo: "Caixa (embalagem)",
        pergunta: {
          id: "caixa-ondulada",
          texto: "A caixa é de papelão ondulado (com a \"sanfona\" por dentro) ou de cartão liso?",
          ajuda: "Caixa de pizza costuma ser de papelão ondulado (4819.10.00). Caixinha dobrável de cartão liso é 4819.20.00.",
        },
        opcoes: [
          { chave: "ondulado", rotulo: "Papelão ondulado", ...NCM.caixaOndulada },
          { chave: "liso", rotulo: "Cartão liso, dobrável", ...NCM.caixaLisa },
        ],
        operacao: "revenda",
        confianca: "media",
        avisos: [aviso],
      };
    }
    if (P.pote.test(nome)) {
      return {
        regra: "pote",
        rotulo: "Pote / vasilha (embalagem)",
        pergunta: {
          id: "pote-plastico",
          texto: "O pote é embalagem para levar a comida, ou utensílio de mesa (prato, tigela, talher)?",
          ajuda: "Pote/marmita de plástico para transportar a comida: 3923.10.90. Utensílio de mesa ou cozinha de plástico: 3924.10.00.",
        },
        opcoes: [
          { chave: "embalagem", rotulo: "Embalagem de transporte", ...NCM.poteEmbalagem },
          { chave: "utensilio", rotulo: "Utensílio de mesa/cozinha", ...NCM.poteUtensilio },
        ],
        operacao: "revenda",
        confianca: "media",
        avisos: [aviso],
      };
    }
    return null;
  }
  const ehMolho = P.molhoCategoria.test(categoria) || P.ketchup.test(nome) || P.maionese.test(nome) || P.mostarda.test(nome) || P.shoyu.test(nome) || /^molhos?\b/.test(nome);
  if (!ehMolho) return null;
  const sache = P.sache.test(nome) || P.sache.test(categoria);
  const semCestDoSache = (b: Base): Base => (sache ? { ...b, cest: null, cestDescricao: null } : b);
  const avisoSache = sache ? ["Sachê individual fica fora do CEST (o Anexo XVII exclui as embalagens de sachês de até 10 g)."] : [];
  const k = P.ketchup.test(nome);
  const m = P.maionese.test(nome);
  if (k && m) {
    return {
      regra: "molho-dois",
      rotulo: "Dois molhos num item só",
      pergunta: { id: "qual-molho", texto: "O item leva ketchup e maionese: qual predomina (ou separe em dois produtos)?", ajuda: "Cada molho tem o seu NCM. O certo é um produto para cada." },
      opcoes: [
        { chave: "ketchup", rotulo: "Ketchup", ...semCestDoSache(NCM.ketchup) },
        { chave: "maionese", rotulo: "Maionese", ...semCestDoSache(NCM.maionese) },
      ],
      operacao: "revenda",
      confianca: "baixa",
      avisos: [...avisoSache, AVISO_NCM_DA_COMPRA],
    };
  }
  if (k) return { regra: "ketchup", rotulo: "Ketchup", opcoes: unica(semCestDoSache(NCM.ketchup), "Ketchup"), operacao: "revenda", confianca: "alta", avisos: avisoSache };
  if (m) return { regra: "maionese", rotulo: "Maionese", opcoes: unica(semCestDoSache(NCM.maionese), "Maionese"), operacao: "revenda", confianca: "alta", avisos: avisoSache };
  if (P.mostarda.test(nome)) return { regra: "mostarda", rotulo: "Mostarda", opcoes: unica(semCestDoSache(NCM.mostarda), "Mostarda"), operacao: "revenda", confianca: "alta", avisos: avisoSache };
  if (P.shoyu.test(nome)) return { regra: "shoyu", rotulo: "Shoyu", opcoes: unica(semCestDoSache(NCM.shoyu), "Shoyu"), operacao: "revenda", confianca: "alta", avisos: avisoSache };
  if (P.molho.test(nome) || P.molhoCategoria.test(categoria)) {
    return {
      regra: "molho",
      rotulo: "Molho",
      pergunta: {
        id: "molho-ou-condimento",
        texto: "É um molho pronto (pimenta, barbecue) ou um tempero/condimento composto?",
        ajuda: "Os dois ficam no mesmo CEST (17.035.00, que cita o molho de pimenta); o NCM muda: molho 2103.90.91, condimento composto 2103.90.21.",
      },
      opcoes: [
        { chave: "molho", rotulo: "Molho pronto", ...semCestDoSache(NCM.molhoOutros) },
        { chave: "condimento", rotulo: "Condimento/tempero composto", ...semCestDoSache(NCM.condimento) },
      ],
      operacao: "revenda",
      confianca: "media",
      avisos: [...avisoSache, "Molho feito na casa é produção própria: CFOP 5101."],
    };
  }
  return null;
}

/** Combo/promoção: a comida manda no NCM da linha; a bebida só sai certa com a Engenharia de Combos. */
function ehCombo(nomeOriginal: string, categoriaOriginal: string): boolean {
  const nome = normalizarTexto(nomeOriginal);
  const categoria = normalizarTexto(categoriaOriginal);
  if (P.combo.test(nome) || P.combo.test(categoria)) return true;
  // "6 Esfihas Tradicionais + Guaraná Mineiro 1,5L": comida e bebida no mesmo
  // item (na NIK, o nome da categoria também traz o "+").
  const temMais = nomeOriginal.includes("+") || categoriaOriginal.includes("+");
  const temBebida = P.refrigerante.test(nome) || P.cerveja.test(nome) || P.suco.test(nome) || P.agua.test(nome);
  return temMais && temBebida;
}

/**
 * A sugestão de um produto.
 *
 * `principal`: a regra de comida que mais aparece no cardápio (é o que o
 * adicional acompanha). `sugerirParaCardapio` calcula e passa.
 */
export function sugerirFiscal(produto: ProdutoParaSugestao, contexto: ContextoDaSugestao = {}, principal: Achado | null = null): SugestaoFiscal {
  const regime = [1, 2, 3, 4].includes(Number(contexto.regime)) ? Number(contexto.regime) : 1;
  const uf = String(contexto.uf || "").toUpperCase();
  const nomeOriginal = String(produto.nome ?? "");
  const nome = normalizarTexto(nomeOriginal.replace(/\+/g, " mais "));
  const categoria = normalizarTexto(produto.categoria);
  const combo = ehCombo(nomeOriginal, String(produto.categoria ?? ""));

  let achado: Achado | null = null;
  if (!combo) {
    achado = bebida(nome);
    // Categoria de bebida com nome de marca desconhecida ("Guaravita")? Só o
    // nome decide a bebida — a categoria "Bebidas" sozinha não diz qual é.
  }
  if (!achado) achado = embalagemOuMolho(nome, categoria);
  if (!achado) achado = comida(nome, categoria, principal);
  if (!achado && !combo && (produto.ehBebida || P.bebidaCategoria.test(categoria))) {
    return semSugestao("Bebida sem tipo ou marca reconhecida no nome. " + AVISO_NCM_DA_COMPRA);
  }
  if (combo) {
    if (!achado) {
      return {
        ...semSugestao("Combo sem o que vai dentro no nome: configure a Engenharia de Combos (aba ao lado) para a nota discriminar cada item."),
        combo: true,
      };
    }
    achado = {
      ...achado,
      regra: `combo-${achado.regra}`,
      rotulo: `Combo (${achado.rotulo.toLowerCase()})`,
      confianca: "baixa",
      combo: true,
      avisos: [
        "Combo: sem a Engenharia de Combos, o item inteiro sai com o NCM da comida — a bebida de dentro (com ST e CEST próprios) não aparece. Configure a Engenharia de Combos para a nota separar.",
        ...(achado.avisos ?? []),
      ],
    };
    // Dentro do combo a comida é produção própria, ainda que a regra da bebida fosse ST.
    if (achado.operacao === "revendaST") achado.operacao = "revenda";
  }
  if (!achado) {
    return semSugestao("Nenhuma palavra conhecida no nome nem na categoria. Escolha o NCM na tabela da Receita ou peça ao contador.");
  }

  const t = cfopECsosn(achado.operacao, regime);
  const avisos = [...(achado.avisos ?? []), ...t.avisos];
  const fontes: IdDaFonte[] = [...t.fontes, ...(achado.fontes ?? [])];
  let substituicao: SugestaoFiscal["substituicao"] = "nao";
  if (achado.operacao === "revendaST") {
    const st = stDaBebida(achado.grupoSt ?? "anexoIV", uf);
    substituicao = st.substituicao;
    fontes.push(...st.fontes);
    avisos.push(...st.avisos);
    if (regime !== 4) avisos.push(AVISO_ST_NA_COMPRA);
    if (achado.opcoes.some((o) => !o.cest)) avisos.push("Com CSOSN 500 o CEST é obrigatório (rejeição 806): defina a embalagem para completar o CEST.");
  }
  return {
    regra: achado.regra,
    rotulo: achado.rotulo,
    opcoes: achado.opcoes,
    pergunta: achado.opcoes.length > 1 ? achado.pergunta ?? null : null,
    cfop: t.cfop,
    csosn: t.csosn,
    substituicao,
    producaoPropria: achado.operacao === "producao",
    confianca: achado.confianca,
    avisos: [...new Set(avisos)],
    fontes: [...new Set(fontes)],
    ...(achado.combo ? { combo: true } : {}),
  };
}

function semSugestao(motivo: string): SugestaoFiscal {
  return {
    regra: null,
    rotulo: "Sem sugestão",
    opcoes: [],
    pergunta: null,
    cfop: null,
    csosn: null,
    substituicao: "nao",
    producaoPropria: false,
    confianca: "baixa",
    avisos: [motivo],
    fontes: [],
  };
}

// ─── O CARDÁPIO INTEIRO ─────────────────────────────────────────────────────

export type SugestaoDoProduto = SugestaoFiscal & { produtoId: string; nome: string; categoria: string; preco: number | null };

/**
 * A sugestão de cada produto do cardápio, com duas coisas que só o conjunto
 * permite:
 *
 *  - o ADICIONAL segue o prato principal da loja (a regra de comida mais
 *    frequente — na NIK, pizza e esfiha, as duas 1905.90.90);
 *  - o produto de nome solto ("Calabresa", "Costela com Catupiry" na
 *    categoria "99Food") herda a regra do irmão de mesmo nome ("Calabresa"
 *    em "Sabores de Pizza") ou do que termina com o nome dele ("Pizza Costela
 *    com Catupiry"); havendo mais de um, fica o de preço mais parecido (o
 *    cardápio do marketplace é o da loja com outro preço). Confiança baixa e
 *    o aviso dizem de onde veio.
 */
export function sugerirParaCardapio(produtos: ProdutoParaSugestao[], contexto: ContextoDaSugestao = {}): SugestaoDoProduto[] {
  const lista = produtos.map((p, i) => ({ p, id: p.id ?? String(i), nome: normalizarTexto(p.nome) }));

  // 1ª passada, sem o principal.
  const primeira = lista.map(({ p }) => sugerirFiscal(p, contexto, null));

  // O prato principal: a regra de comida (produção própria) mais frequente.
  const contagem = new Map<string, { n: number; achado: Achado }>();
  primeira.forEach((s) => {
    if (!s.regra || !s.producaoPropria || s.combo || s.opcoes.length === 0 || !COMIDA_PRINCIPAL.has(s.regra)) return;
    const atual = contagem.get(s.regra);
    const achado: Achado = { regra: s.regra, rotulo: s.rotulo, opcoes: s.opcoes, operacao: "producao", confianca: s.confianca };
    contagem.set(s.regra, { n: (atual?.n ?? 0) + 1, achado });
  });
  const principal = [...contagem.values()].sort((a, b) => b.n - a.n)[0]?.achado ?? null;
  // Para o adicional, a opção "até 20%" (a massa) — o adicional não é a carne.
  const principalParaAdicional = principal ? { ...principal, opcoes: principal.opcoes.slice(0, 1) } : null;

  const resultado = lista.map(({ p, id }, i) => {
    let s = primeira[i];
    if (!s.regra && principalParaAdicional) {
      const denovo = sugerirFiscal(p, contexto, principalParaAdicional);
      if (denovo.regra) s = denovo;
    }
    return { ...s, produtoId: id, nome: String(p.nome ?? ""), categoria: String(p.categoria ?? ""), preco: typeof p.preco === "number" ? p.preco : null };
  });

  // 2ª passada: o nome solto herda do irmão.
  return resultado.map((s, i) => {
    if (s.regra) return s;
    const alvo = lista[i];
    if (!alvo.nome) return s;
    // Combo só herda de combo ("Combo 1" do 99Food ← "Combo 1" de "Combos
    // Esfihas"); produto avulso, só de avulso.
    const mesmoTipo = (o: SugestaoDoProduto) => Boolean(o.regra) && Boolean(o.combo) === Boolean(s.combo);
    const iguais = resultado.filter((o, j) => j !== i && mesmoTipo(o) && lista[j].nome === alvo.nome);
    const terminam = resultado.filter((o, j) => j !== i && mesmoTipo(o) && lista[j].nome !== alvo.nome && lista[j].nome.endsWith(` ${alvo.nome}`));
    const candidatos = iguais.length > 0 ? iguais : terminam;
    if (candidatos.length === 0) return s;
    const preco = s.preco;
    // Distância de preço em escala log: R$ 106,90 contra R$ 86,90 (o markup do
    // marketplace) é perto; contra R$ 12,90 é outro produto.
    const distancia = (o: SugestaoDoProduto) => (preco && o.preco ? Math.abs(Math.log(preco / o.preco)) : Infinity);
    const regras = new Set(candidatos.map((c) => c.regra));
    let escolhido: SugestaoDoProduto | null = null;
    if (regras.size === 1) escolhido = candidatos[0];
    else {
      // Mais de um tipo com o mesmo nome (a pizza e a esfiha "Costela com
      // Catupiry"): fica o de preço mais parecido — só se ele for CLARAMENTE o
      // mais parecido: até 60% de diferença, e no máximo metade da distância
      // do tipo seguinte. Preço no meio do caminho não decide nada.
      const ordenados = [...candidatos].sort((a, b) => distancia(a) - distancia(b));
      const melhor = ordenados[0];
      const seguinte = ordenados.find((o) => o.regra !== melhor.regra);
      if (distancia(melhor) <= Math.log(1.6) && (!seguinte || distancia(melhor) <= distancia(seguinte) / 2)) escolhido = melhor;
    }
    if (!escolhido) {
      return {
        ...s,
        avisos: [`O nome aparece em mais de um tipo de produto (${[...regras].join(", ")}): escolha o NCM deste à mão.`],
      };
    }
    return {
      ...escolhido,
      produtoId: s.produtoId,
      nome: s.nome,
      categoria: s.categoria,
      preco: s.preco,
      confianca: "baixa" as const,
      parecidoCom: `${escolhido.nome} (${escolhido.categoria})`,
      avisos: [`Sugestão pelo produto parecido "${escolhido.nome}" (${escolhido.categoria}), pelo nome e pelo preço — confira.`, ...escolhido.avisos],
    };
  });
}

/** As regras de comida que podem ser o "prato principal" da loja. */
const COMIDA_PRINCIPAL = new Set(["pizza", "esfiha", "esfiha-com-carne", "esfiha-doce", "salgado", "salgado-com-carne", "pastel", "lanche", "lanche-com-carne", "prato", "prato-com-carne", "massa", "massa-com-carne"]);

// ─── RESPOSTAS, LOTE E CONFERÊNCIA ───────────────────────────────────────────

/** A opção escolhida: a única, ou a da resposta à pergunta. null = falta responder. */
export function opcaoEscolhida(s: Pick<SugestaoFiscal, "opcoes" | "pergunta">, respostas: Record<string, string | undefined>): OpcaoDeNcm | null {
  if (s.opcoes.length === 0) return null;
  if (s.opcoes.length === 1) return s.opcoes[0];
  const r = s.pergunta ? respostas[s.pergunta.id] : undefined;
  return s.opcoes.find((o) => o.chave === r) ?? null;
}

export type LinhaDoLote = { productId: string; ncm: string; cest: string | null; cfop: string; csosn: string | null; regra: string };

/**
 * O NCM gravado no produto, do ponto de vista do lote:
 *  - "vazio": sem NCM de 8 dígitos;
 *  - "sugestao": o NCM que o lote aplicou e ninguém revisou — a marca de
 *    `fiscalConfig.ncmAssistido` (api/store/fiscal/products) com o MESMO NCM;
 *  - "revisado": qualquer outro NCM de 8 dígitos. O contador revisou (o
 *    "revisado" tira a marca), alguém digitou à mão no produto (editar tira a
 *    marca) ou o gravado já não é o da marca.
 */
export type SituacaoDoNcmGravado = "vazio" | "sugestao" | "revisado";

export function situacaoDoNcmGravado(ncmAtual: string | null | undefined, marca: { ncm?: string | null } | null | undefined): SituacaoDoNcmGravado {
  const ncm = String(ncmAtual ?? "").replace(/\D/g, "");
  if (ncm.length !== 8) return "vazio";
  return marca && String(marca.ncm ?? "").replace(/\D/g, "") === ncm ? "sugestao" : "revisado";
}

export type OpcoesDoLote = {
  /**
   * Refazer também o NCM já gravado — mas só o que ainda é SUGESTÃO a revisar.
   * O revisado pelo contador ou digitado à mão fica de fora (`revisados`).
   */
  substituirNcmGravado?: boolean;
  /** As marcas de "sugestão aplicada, a revisar", por id do produto (fiscalConfig.ncmAssistido). */
  marcas?: Readonly<Record<string, { ncm?: string | null } | undefined>> | null;
  /**
   * A SEGUNDA escolha, explícita: sobrescrever também o NCM revisado ou
   * digitado à mão. Só vale junto de `substituirNcmGravado`.
   */
  substituirRevisados?: boolean;
};

export type LoteMontado = {
  lote: LinhaDoLote[];
  semResposta: SugestaoDoProduto[];
  semSugestao: SugestaoDoProduto[];
  /** Já têm NCM e ninguém pediu para substituir: ficam como estão. */
  mantidos: SugestaoDoProduto[];
  /** Pediu para substituir, mas o NCM é revisado/digitado à mão e a segunda escolha não veio: ficam como estão. */
  revisados: SugestaoDoProduto[];
  /** Os revisados que ENTRAM no lote (veio a segunda escolha) — o que a confirmação tem de dizer. */
  revisadosSobrescritos: SugestaoDoProduto[];
};

/**
 * O que gravar num lote (uma categoria, por exemplo): só produtos com
 * sugestão e resposta, e — por padrão — só os que ainda não têm NCM.
 *
 * "Substituir também o NCM já gravado" refaz a SUGESTÃO que ninguém revisou.
 * Uma versão desta função sobrescrevia qualquer NCM gravado, inclusive o que o
 * contador já tinha conferido (sem a marca de sugestão) — um clique na
 * categoria desfazia a revisão inteira. Agora o revisado só entra com a
 * segunda escolha (`substituirRevisados`), e volta em `revisadosSobrescritos`
 * para a tela contar na confirmação.
 */
export function montarLote(
  sugestoes: Array<SugestaoDoProduto & { ncmAtual?: string | null }>,
  respostas: Record<string, string | undefined>,
  opcoes: OpcoesDoLote = {}
): LoteMontado {
  const lote: LinhaDoLote[] = [];
  const semResposta: SugestaoDoProduto[] = [];
  const semSugestao: SugestaoDoProduto[] = [];
  const mantidos: SugestaoDoProduto[] = [];
  const revisados: SugestaoDoProduto[] = [];
  const revisadosSobrescritos: SugestaoDoProduto[] = [];
  for (const s of sugestoes) {
    const situacao = situacaoDoNcmGravado(s.ncmAtual, opcoes.marcas?.[s.produtoId]);
    if (situacao !== "vazio" && !opcoes.substituirNcmGravado) {
      mantidos.push(s);
      continue;
    }
    if (!s.regra || s.opcoes.length === 0 || !s.cfop) {
      semSugestao.push(s);
      continue;
    }
    const o = opcaoEscolhida(s, respostas);
    if (!o) {
      semResposta.push(s);
      continue;
    }
    // Só chega aqui o revisado que ENTRARIA no lote: a conta de `revisados` é
    // exatamente quantos a segunda escolha sobrescreveria.
    if (situacao === "revisado") {
      if (!opcoes.substituirRevisados) {
        revisados.push(s);
        continue;
      }
      revisadosSobrescritos.push(s);
    }
    lote.push({ productId: s.produtoId, ncm: o.ncm, cest: o.cest, cfop: s.cfop, csosn: s.csosn, regra: s.regra });
  }
  return { lote, semResposta, semSugestao, mantidos, revisados, revisadosSobrescritos };
}

/**
 * As regras que a SEFAZ confere no item e que a validação de um produto só
 * (lib/fiscal-validacao → pendenciasDoProduto) não pega: CSOSN 500 sem CEST
 * (rejeição 806). A rota do lote recusa a linha com esta frase.
 */
export function problemaDaCombinacao(linha: { csosn?: string | null; cest?: string | null }): string | null {
  const cest = String(linha.cest ?? "").replace(/\D/g, "");
  if (String(linha.csosn ?? "").trim() === "500" && cest.length !== 7) {
    return "Com CSOSN 500 (ICMS já cobrado por substituição tributária) o CEST é obrigatório — a SEFAZ recusa sem ele (rejeição 806).";
  }
  return null;
}

// ─── A CATEGORIA, PARA A TELA ────────────────────────────────────────────────

export type ResumoDaCategoria = {
  categoria: string;
  produtos: SugestaoDoProduto[];
  semNcm: number;
  /** As perguntas que a categoria precisa responder (uma vez cada). */
  perguntas: Array<{ pergunta: Pergunta; opcoes: Array<{ chave: string; rotulo: string }>; produtos: number }>;
  /** As regras que casaram, com quantos produtos cada. */
  regras: Array<{ regra: string; rotulo: string; quantos: number }>;
  semSugestao: number;
};

export function resumirPorCategoria(sugestoes: Array<SugestaoDoProduto & { ncmAtual?: string | null }>): ResumoDaCategoria[] {
  const porCategoria = new Map<string, Array<SugestaoDoProduto & { ncmAtual?: string | null }>>();
  for (const s of sugestoes) {
    const c = s.categoria || "Sem categoria";
    if (!porCategoria.has(c)) porCategoria.set(c, []);
    porCategoria.get(c)!.push(s);
  }
  return [...porCategoria.entries()].map(([categoria, produtos]) => {
    const perguntas = new Map<string, { pergunta: Pergunta; opcoes: Map<string, string>; produtos: number }>();
    const regras = new Map<string, { regra: string; rotulo: string; quantos: number }>();
    for (const s of produtos) {
      if (s.regra) {
        const r = regras.get(s.regra) ?? { regra: s.regra, rotulo: s.rotulo, quantos: 0 };
        // A mesma regra com rótulos diferentes ("Refrigerante em lata" e "…
        // em embalagem pet"): o resumo da categoria fica com a parte comum.
        if (r.rotulo !== s.rotulo) r.rotulo = r.rotulo.split(" em ")[0];
        r.quantos++;
        regras.set(s.regra, r);
      }
      if (s.pergunta && s.opcoes.length > 1) {
        const q = perguntas.get(s.pergunta.id) ?? { pergunta: s.pergunta, opcoes: new Map<string, string>(), produtos: 0 };
        q.produtos++;
        // O rótulo da opção muda com a carne ("Mais de 20% (frango)"): na
        // pergunta da categoria vale o texto genérico da chave.
        for (const o of s.opcoes) if (!q.opcoes.has(o.chave)) q.opcoes.set(o.chave, rotuloDaChave(o));
        perguntas.set(s.pergunta.id, q);
      }
    }
    return {
      categoria,
      produtos,
      semNcm: produtos.filter((p) => String(p.ncmAtual ?? "").replace(/\D/g, "").length !== 8).length,
      perguntas: [...perguntas.values()].map((q) => ({ pergunta: q.pergunta, opcoes: [...q.opcoes.entries()].map(([chave, rotulo]) => ({ chave, rotulo })), produtos: q.produtos })),
      regras: [...regras.values()].sort((a, b) => b.quantos - a.quantos),
      semSugestao: produtos.filter((p) => !p.regra).length,
    };
  });
}

function rotuloDaChave(o: OpcaoDeNcm): string {
  if (o.chave === "ate20") return "Até 20% do peso";
  if (o.chave === "mais20") return "Mais de 20% (preparação de carne)";
  return o.rotulo;
}

/** Texto de uma linha para a planilha/tela: "1905.90.90" ou "1905.90.90 ou 1602.50.00". */
export function ncmSugeridoEmTexto(s: Pick<SugestaoFiscal, "opcoes">): string {
  return s.opcoes.map((o) => ncmComPontos(o.ncm)).filter((v, i, a) => a.indexOf(v) === i).join(" ou ");
}
