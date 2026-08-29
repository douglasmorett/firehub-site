/**
 * A única fonte de verdade sobre O QUE SAI NA ETIQUETA.
 *
 * Existe por um motivo específico: a tela ganhou uma prévia, e prévia que
 * decide por conta própria o que desenhar vira mentira no primeiro caso de
 * borda. O papel e a prévia leem daqui, das MESMAS funções — se divergirem, é
 * bug deste arquivo, não de uma das duas telas.
 *
 * Sem React e sem Prisma de propósito: dá para exercitar no node puro.
 */

export type PresetDaEtiqueta = "cozinha" | "venda" | "fornecimento";

/** O que pode ser ligado e desligado. A ordem é a que aparece na tela. */
export const CHAVES_DE_CAMPO = [
  "peso",
  "modoPreparo",
  "conservacao",
  "tabelaNutricional",
  "ingredientes",
  "alergicos",
  "loteInterno",
  "qr",
  "logo",
  "nomeDaLoja",
  "cnpj",
  "endereco",
] as const;

export type ChaveDeCampo = (typeof CHAVES_DE_CAMPO)[number];

/** Textos que eram chumbados no JSX e agora a loja edita. */
export const CHAVES_DE_TEXTO = [
  "conservacaoCongelado",
  "conservacaoResfriado",
  "conservacaoSeco",
  "conservacaoAmbiente",
  "transgenico",
  "porcao",
] as const;

export type ChaveDeTexto = (typeof CHAVES_DE_TEXTO)[number];

/**
 * O default REPRODUZ a etiqueta que as lojas já imprimem hoje, campo por campo.
 * Quem nunca abrir a aba nova não pode notar diferença nenhuma no papel — é a
 * regra que torna esta entrega segura de subir.
 *
 * `logo: false` não é escolha nova: o valor vinha de
 * localStorage["labelShowLogo"], e localStorage vazio já dava false.
 */
export const PADRAO: Record<ChaveDeCampo, boolean> = {
  peso: true,
  modoPreparo: true,
  conservacao: true,
  tabelaNutricional: true,
  ingredientes: true,
  alergicos: true,
  loteInterno: true,
  qr: true,
  logo: false,
  nomeDaLoja: true,
  cnpj: true,
  endereco: true,
};

/** Os textos de hoje, palavra por palavra. Vazio na config = usa estes. */
export const TEXTOS_PADRAO: Record<ChaveDeTexto, string> = {
  // Hoje esta frase sai em TODA etiqueta — inclusive em molho refrigerado,
  // farinha seca e pão, onde ela contradiz a validade impressa três linhas
  // abaixo, no mesmo papel que a vigilância lê.
  conservacaoCongelado: "Congelador: Até -12ºC = 30 dias\nFreezer: -18ºC = Vide validade",
  conservacaoResfriado: "Manter refrigerado entre 0ºC e 4ºC. Consumir em até 5 dias.",
  conservacaoSeco: "Manter em local seco e arejado, ao abrigo da luz.",
  conservacaoAmbiente: "Conservar em temperatura ambiente. Depois de aberto, manter refrigerado.",
  // Estava escrita dentro do JSX: um produto que só tem soja transgênica saía
  // declarando milho.
  transgenico: "Contém derivados de milho e soja transgênicos.",
  // A porção de referência estava chumbada em 100 g. Quem embala porção de 80 g
  // não tinha como declarar.
  porcao: "100 g",
};

/**
 * O preset mora em `KitchenItem.labelSize` — coluna que existe desde o boot da
 * estrutura de lotes e que NENHUMA tela jamais leu ou gravou. O nome é herança
 * de quando ela ia guardar dimensão de papel; o schema já a documenta como
 * escolha POR PRODUTO, e é isso que ela passa a ser.
 *
 * Retrocompatibilidade importa aqui: vazio lê como "venda", que é o formato
 * completo que toda etiqueta impressa até hoje usou.
 */
export function presetDoItem(labelSize?: string | null): PresetDaEtiqueta {
  const v = String(labelSize || "").trim().toLowerCase();
  if (v === "cozinha" || v === "60x60") return "cozinha";
  if (v === "fornecimento") return "fornecimento";
  return "venda";
}

export const NOME_DO_PRESET: Record<PresetDaEtiqueta, string> = {
  cozinha: "Uso interno da cozinha",
  venda: "Produto embalado para venda",
  fornecimento: "Fornecimento para outra loja",
};

export const EXPLICACAO_DO_PRESET: Record<PresetDaEtiqueta, string> = {
  cozinha:
    "Para o que fica guardado na sua geladeira, freezer ou prateleira. Precisa do nome, da data de preparo e da validade — o resto é opcional.",
  venda:
    "Para o produto que sai embalado para o cliente. A lei exige ingredientes, alérgicos, peso e os dados da loja no rótulo.",
  fornecimento:
    "Para a mercadoria que você manda para outra loja ou franquia. Igual à de venda, e os alérgicos ficam obrigatórios.",
};

type Trava = { ligado: boolean; motivo: string };

/**
 * O que o preset TRAVA, e o porquê escrito para o lojista ler.
 *
 * Trava aqui significa "o interruptor fica desabilitado com o motivo ao lado" —
 * nunca "a impressão é bloqueada". Trava legal errada é pior que trava nenhuma:
 * ela impede alguém de imprimir a comida que já está esfriando na bancada.
 */
export const TRAVAS_POR_PRESET: Record<PresetDaEtiqueta, Partial<Record<ChaveDeCampo, Trava>>> = {
  cozinha: {},
  venda: {
    peso: { ligado: true, motivo: "A quantidade é obrigatória no rótulo de produto embalado." },
    ingredientes: { ligado: true, motivo: "A lista de ingredientes é obrigatória no rótulo de produto embalado." },
    conservacao: { ligado: true, motivo: "As instruções de conservação são obrigatórias no rótulo." },
    nomeDaLoja: { ligado: true, motivo: "O rótulo precisa identificar quem produziu." },
    cnpj: { ligado: true, motivo: "O rótulo precisa identificar quem produziu." },
    endereco: { ligado: true, motivo: "O rótulo precisa identificar quem produziu." },
  },
  fornecimento: {
    peso: { ligado: true, motivo: "A quantidade é obrigatória no rótulo de produto embalado." },
    ingredientes: { ligado: true, motivo: "A lista de ingredientes é obrigatória no rótulo de produto embalado." },
    alergicos: { ligado: true, motivo: "A declaração de alérgicos é obrigatória (RDC 727/2022)." },
    conservacao: { ligado: true, motivo: "As instruções de conservação são obrigatórias no rótulo." },
    nomeDaLoja: { ligado: true, motivo: "O rótulo precisa identificar quem produziu." },
    cnpj: { ligado: true, motivo: "O rótulo precisa identificar quem produziu." },
    endereco: { ligado: true, motivo: "O rótulo precisa identificar quem produziu." },
  },
};

/** O que o preset já entrega desligado, sem travar. */
const NASCE_DESLIGADO: Record<PresetDaEtiqueta, ChaveDeCampo[]> = {
  // Tabela nutricional em etiqueta de pote de molho da própria cozinha é papel
  // gasto: ninguém que vai usar aquele molho lê caloria por 100 g.
  cozinha: ["tabelaNutricional"],
  venda: [],
  fornecimento: [],
};

/**
 * O selo "ALTO EM" é caso à parte e NÃO entra em CHAVES_DE_CAMPO.
 *
 * O que está desenhado no papel hoje é um retângulo com ícone de triângulo e as
 * palavras AÇÚCAR/SÓDIO/GORDURA — não é a lupa dos Anexos XVII e XVIII da IN
 * 75/2020, e a RDC 429/2022 proíbe outro modelo de alerta visível no rótulo.
 *
 * Dar a ele um interruptor bonito seria dar aparência de conformidade a algo
 * que não está conforme. Ele continua seguindo os três checkboxes do produto,
 * aparece na aba de layout como linha travada com o aviso escrito, e some nos
 * presets onde a veiculação do alerta é vedada.
 */
export function seloAltoEmSuprimido(preset: PresetDaEtiqueta): boolean {
  return preset === "cozinha" || preset === "fornecimento";
}

/** Os dados reais do produto e da loja, para decidir o que não TEM o que mostrar. */
export type DadosDaEtiqueta = {
  pesoPreenchido?: boolean;
  temIngredientes?: boolean;
  temAlergicos?: boolean;
  temModoPreparo?: boolean;
  tabelaTodaZerada?: boolean;
  temLogo?: boolean;
  temLote?: boolean;
  temNomeDaLoja?: boolean;
  temCnpj?: boolean;
  temEndereco?: boolean;
  qrPedido?: boolean;
};

export type CamposResolvidos = {
  campos: Record<ChaveDeCampo, boolean>;
  travas: Partial<Record<ChaveDeCampo, Trava>>;
  /** Por que um bloco ligado ainda assim não vai sair — texto para a prévia. */
  avisos: { chave: ChaveDeCampo; texto: string }[];
};

/**
 * Resolve, na ordem: o default → o que a loja gravou → o que o preset trava →
 * o que os dados do produto tornam impossível.
 */
export function resolverCamposDaEtiqueta(
  json: any,
  labelSize: string | null | undefined,
  dados: DadosDaEtiqueta = {},
): CamposResolvidos {
  const preset = presetDoItem(labelSize);
  const gravado = (json && typeof json === "object" && json.campos) || {};

  const campos = {} as Record<ChaveDeCampo, boolean>;
  for (const k of CHAVES_DE_CAMPO) {
    // `typeof === "boolean"` e nunca `gravado[k] || PADRAO[k]`: com `||`, o
    // `false` que o lojista acabou de gravar volta `true` na próxima leitura, o
    // interruptor "não segura", e ele desiste da tela na segunda tentativa.
    campos[k] = typeof gravado[k] === "boolean" ? gravado[k] : PADRAO[k];
  }

  for (const k of NASCE_DESLIGADO[preset]) {
    if (typeof gravado[k] !== "boolean") campos[k] = false;
  }

  const travas = TRAVAS_POR_PRESET[preset];
  for (const k of Object.keys(travas) as ChaveDeCampo[]) {
    campos[k] = travas[k]!.ligado;
  }

  // Bloco ligado mas sem conteúdo não vira frase falsa no papel: ele some, e a
  // prévia diz por quê. Antes desta regra a etiqueta saía com "Ingredientes:
  // Não cadastrado.", com "ALÉRGICOS: NÃO CADASTRADO" em negrito — que um
  // consumidor alérgico pode ler como ausência de alérgeno — e com a tabela
  // nutricional inteira zerada, que não é campo em branco: é a declaração de
  // que o alimento não tem nada.
  const avisos: { chave: ChaveDeCampo; texto: string }[] = [];
  const somePorFaltaDeDado = (chave: ChaveDeCampo, temDado: boolean | undefined, texto: string) => {
    if (campos[chave] && temDado === false) {
      campos[chave] = false;
      avisos.push({ chave, texto });
    }
  };

  somePorFaltaDeDado("peso", dados.pesoPreenchido, "O peso não vai sair: o campo está vazio na aba Produto.");
  somePorFaltaDeDado("ingredientes", dados.temIngredientes, "Os ingredientes não vão sair: nada foi cadastrado na aba Produto.");
  somePorFaltaDeDado("alergicos", dados.temAlergicos, "Os alérgicos não vão sair: nada foi cadastrado na aba Produto.");
  somePorFaltaDeDado("modoPreparo", dados.temModoPreparo, "O modo de preparo não vai sair: está vazio na aba Produto.");
  somePorFaltaDeDado(
    "tabelaNutricional",
    dados.tabelaTodaZerada === true ? false : undefined,
    "A tabela nutricional não vai sair: todos os valores estão em zero. Tabela zerada não é campo em branco — ela declara que o alimento não tem nada.",
  );
  somePorFaltaDeDado("logo", dados.temLogo, "A logo não vai sair: nenhuma imagem foi enviada em Dados da Loja.");
  // O lote NÃO entra aqui: ele é opcional por definição, e uma faixa amarela
  // por campo opcional vazio é o tipo de aviso que ensina o lojista a ignorar
  // faixas amarelas — inclusive as que importam.
  somePorFaltaDeDado("nomeDaLoja", dados.temNomeDaLoja, "O nome da loja não vai sair: está vazio em Dados da Loja.");
  somePorFaltaDeDado("cnpj", dados.temCnpj, "O CNPJ não vai sair: está vazio em Dados da Loja.");
  somePorFaltaDeDado("endereco", dados.temEndereco, "O endereço não vai sair: está vazio em Dados da Loja.");
  somePorFaltaDeDado("qr", dados.qrPedido, "O QR não vai sair: a opção está desmarcada na aba Imprimir.");

  return { campos, travas, avisos };
}

/** O texto de conservação que o preset e o produto pedem. */
export function textoDeConservacao(json: any, chave: ChaveDeTexto = "conservacaoCongelado"): string {
  const gravado = json && typeof json === "object" && json.textos && json.textos[chave];
  const v = typeof gravado === "string" ? gravado.trim() : "";
  return v || TEXTOS_PADRAO[chave];
}

const LIMITE_DE_TEXTO = 240;
const LIMITE_DE_PRODUTOS = 400;

/**
 * Espelho de `apenasCamposConhecidos` do kitchenItems.ts: o Json vira saco sem
 * fundo se a action gravar o que o cliente mandar.
 *
 * Recusa em vez de cortar quando passa do limite — cortar a cauda em silêncio é
 * perder configuração sem ninguém ficar sabendo.
 */
export function sanitizarConfigDeEtiqueta(
  entrada: any,
): { ok: true; config: any } | { ok: false; erro: string } {
  const e = entrada && typeof entrada === "object" ? entrada : {};

  const campos: Record<string, boolean> = {};
  const dosCampos = e.campos && typeof e.campos === "object" ? e.campos : {};
  for (const k of CHAVES_DE_CAMPO) {
    if (Object.prototype.hasOwnProperty.call(dosCampos, k)) campos[k] = dosCampos[k] === true;
  }

  const textos: Record<string, string> = {};
  const dosTextos = e.textos && typeof e.textos === "object" ? e.textos : {};
  for (const k of CHAVES_DE_TEXTO) {
    if (typeof dosTextos[k] === "string") textos[k] = dosTextos[k].slice(0, LIMITE_DE_TEXTO);
  }

  const produtos: Record<string, any> = {};
  const dosProdutos = e.produtos && typeof e.produtos === "object" ? e.produtos : {};
  const chavesDeProduto = Object.keys(dosProdutos);
  if (chavesDeProduto.length > LIMITE_DE_PRODUTOS) {
    return {
      ok: false,
      erro: `A configuração passou de ${LIMITE_DE_PRODUTOS} produtos e não foi salva. Apague itens de cozinha que você não usa mais e tente de novo.`,
    };
  }
  for (const id of chavesDeProduto) {
    const p = dosProdutos[id];
    if (!p || typeof p !== "object") continue;
    const limpo: Record<string, string> = {};
    for (const k of CHAVES_DE_TEXTO) {
      if (typeof p[k] === "string") limpo[k] = p[k].slice(0, LIMITE_DE_TEXTO);
    }
    if (Object.keys(limpo).length) produtos[id] = limpo;
  }

  return { ok: true, config: { versao: 1, campos, textos, produtos } };
}

/**
 * Lê a quantidade e a unidade a partir do peso JÁ CADASTRADO na etiqueta.
 *
 * O estoque tem que se mexer pelo que está escrito no papel: se a etiqueta diz
 * "1,00 kg", escanear dá entrada de 1 kg. Até aqui toda etiqueta valia
 * exatamente 1 — o `criarLotesDaImpressao` caía no fallback `total = etiquetas`
 * porque a tela nunca mandou `quantidadeTotal` nem `unit` —, então o saco de
 * 5 kg entrava no estoque como "1" e o saldo nascia errado na primeira leitura.
 *
 * Sem campo novo na tela de propósito: o peso já existe na ficha do produto, já
 * é impresso no papel e já é o que o funcionário lê. Pedir a mesma informação
 * duas vezes é como as duas passam a divergir.
 *
 * NÃO converte unidade (g→kg, ml→L). A conversão parece uma gentileza e é uma
 * armadilha: a rota de entrada soma a quantidade CRUA no saldo do insumo, então
 * qualquer conversão silenciosa aqui viraria um erro de mil vezes lá — e sem
 * nada na tela explicando. O que a tela faz é MOSTRAR o que vai entrar, antes
 * de o papel sair.
 */
export function quantidadeDaEtiqueta(weightStr?: string | null): {
  quantidade: number;
  unidade: string;
  reconhecido: boolean;
} {
  const bruto = String(weightStr || "").trim().toLowerCase();
  if (!bruto || bruto === "n/a" || bruto === "na" || bruto === "-") {
    return { quantidade: 1, unidade: "un", reconhecido: false };
  }

  // "0,90kg", "1,00 kg", "500 g", "2.5 L", "250ml", "12 un"
  const m = /^\s*([\d]+(?:[.,]\d+)?)\s*([a-zçãé]*)\s*$/i.exec(bruto);
  if (!m) return { quantidade: 1, unidade: "un", reconhecido: false };

  const numero = Number(m[1].replace(",", "."));
  if (!Number.isFinite(numero) || numero <= 0) {
    return { quantidade: 1, unidade: "un", reconhecido: false };
  }

  const sufixo = m[2] || "";
  const unidade =
    sufixo === "kg" || sufixo === "quilo" || sufixo === "quilos" ? "kg"
    : sufixo === "g" || sufixo === "gr" || sufixo === "grama" || sufixo === "gramas" ? "g"
    : sufixo === "l" || sufixo === "lt" || sufixo === "litro" || sufixo === "litros" ? "L"
    : sufixo === "ml" ? "ml"
    : sufixo === "un" || sufixo === "und" || sufixo === "unid" || sufixo === "unidade" || sufixo === "unidades" || sufixo === "" ? "un"
    : sufixo;

  return { quantidade: numero, unidade, reconhecido: true };
}

/** "1,5 kg" — número em pt-BR, sem zeros à toa. */
export function textoDeQuantidade(quantidade: number, unidade: string): string {
  const n = Number.isInteger(quantidade)
    ? String(quantidade)
    : quantidade.toFixed(3).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
  return `${n} ${unidade}`;
}
