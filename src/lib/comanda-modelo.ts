/**
 * O modelo da comanda: o que sai no papel, em que ordem e como.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Até aqui o layout da comanda era fixo dentro do Assistente de Impressão, que
 * roda no PC da loja. Mudar qualquer coisa — tirar o telefone, aumentar o
 * número do pedido, escrever um recado no rodapé — exigia mexer no código e
 * atualizar o programa em todas as lojas. O lojista que vinha da Saipos
 * estranhava na hora: lá ele abre a comanda na tela e mexe.
 *
 * Aqui o modelo é DADO, não código: uma lista de blocos guardada dentro de
 * `User.printerConfig.comandaModelo`. O painel manda a lista em `order.blocos`
 * e o Assistente cola as seções nessa ordem.
 *
 * ── O que o painel manda e o que o Assistente monta ─────────────────────────
 *
 * O painel NÃO manda a comanda pronta. Manda a ORDEM. O conteúdo de cada seção
 * continua saindo do mesmo código que já roda nas lojas hoje — preço efetivo
 * com desconto rateado, combo, tarja de bebida, rateio de mesa, aviso de
 * entrega parceira. Reimplementar isso aqui criaria uma segunda verdade que
 * divergiria da primeira na primeira mudança.
 *
 * A consequência disso está nos tipos: só os blocos LEVES (número, canal,
 * loja, data, texto livre) aceitam tamanho e alinhamento. Mudar o corpo de
 * fonte de uma seção já quebrada na largura da bobina faria a IMPRESSORA
 * quebrar a linha onde ela quisesse — foi assim que endereço já saiu como
 * "Rua Ma / cae".
 *
 * ── Compatibilidade ─────────────────────────────────────────────────────────
 *
 * Loja sem modelo salvo não manda `blocos` e nada muda, em lugar nenhum.
 * Assistente antigo ignora o campo que não conhece e imprime o layout
 * embutido. Os dois casos estão medidos em
 * firehub-print-assistant/scripts/teste-modelo-comanda.js.
 */

/**
 * A versão do Assistente em que `order.blocos` passou a ser lido.
 *
 * Fixa de propósito: usar a versão ATUAL do instalador faria a tela avisar
 * "seu Assistente não lê o modelo" para quem está numa versão que lê, toda
 * vez que o instalador subisse por qualquer outro motivo.
 */
export const VERSAO_MINIMA_DO_MODELO = "1.2.11";

/**
 * A versão em que o Assistente passou a ler as palavras trocadas pela loja
 * (`Bloco.rotulos`), o negrito marcado por linha (`Bloco.negritos`) e o
 * destaque de número do app e observação.
 *
 * Subiu de 1.2.18 para 1.2.19 no mesmo dia, quando o negrito entrou: a tela
 * cobra as duas coisas com um aviso só, e um aviso que diz "atualize" mas
 * deixa metade do recurso mudo é pior que nenhum.
 *
 * Separada da de cima porque o aviso tem que ser proporcional: quem só
 * reordenou blocos continua bem servido pelo 1.2.11, e receber "atualize o
 * programa" por causa de um recurso que não usa é o jeito mais rápido de a
 * loja aprender a ignorar os nossos avisos. Só quem REESCREVE uma palavra vê
 * a cobrança (ver `temRotuloTrocado`).
 */
export const VERSAO_MINIMA_DOS_ROTULOS = "1.2.19";

export type Alinhamento = "esquerda" | "centro" | "direita";

/**
 * De quantas letras normais cada letra desta linha ocupa o lugar.
 *
 * ── Por que a escada é 1 / 1,5 / 2 / 3 e não um número qualquer ──────────
 *
 * A impressora térmica não tem fonte com tamanho em pontos: ela repete a
 * mesma matriz de pontos N vezes, e N é NÚMERO INTEIRO. Só com isso, o
 * degrau depois do normal já é o dobro — grande demais para título de seção
 * e come bobina à toa.
 *
 * A saída é que a impressora tem DUAS fontes embutidas: a Fonte A, de 12
 * pontos de largura (48 colunas em 80 mm), e a Fonte B, de 9 (64 colunas).
 * Combinando fonte e multiplicador dá para chegar em degraus intermediários
 * de verdade, não arredondados:
 *
 *   1,0x = Fonte A sem multiplicar ...... 48 colunas em 80 mm
 *   1,5x = Fonte B multiplicada por 2 ... 32 colunas  (64 / 2 = 32 = 48/1,5)
 *   2,0x = Fonte A multiplicada por 2 ... 24 colunas
 *   3,0x = Fonte A multiplicada por 3 ... 16 colunas
 *
 * 2,5x NÃO existe nesta escada e não adianta pedir: a única combinação
 * entre 2 e 3 é Fonte B x3, que dá 2,25x — perto demais de 2 para valer um
 * degrau a mais na tela.
 *
 * Se a impressora ignorar a troca de fonte (acontece em modelo muito antigo,
 * o mesmo que pede o perfil "legacy"), o 1,5x sai como 2x: maior do que foi
 * pedido, nunca ilegível.
 */
export type Tamanho = 1 | 1.5 | 2 | 3;

export const TAMANHOS: Tamanho[] = [1, 1.5, 2, 3];

/** Encosta no degrau mais próximo da escada. Valor de fora vira 1. */
export function tamanhoValido(t: unknown): Tamanho {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 1) return 1;
  return TAMANHOS.reduce((melhor, cand) =>
    Math.abs(cand - n) < Math.abs(melhor - n) ? cand : melhor, 1 as Tamanho);
}

/** Quantas letras cabem na linha neste tamanho. Papel e prévia usam esta. */
export function larguraDoTamanho(colunas: number, tamanho?: Tamanho | number): number {
  return Math.max(4, Math.floor(colunas / tamanhoValido(tamanho)));
}

/**
 * Cada peça que pode entrar na comanda.
 *
 * Esta lista é um CONTRATO com o Assistente: todo tipo daqui tem um `case`
 * em `aplicarModelo()` dentro de firehub-print-assistant/server.js. Tipo novo
 * que o Assistente não conheça simplesmente não imprime nada — some do papel
 * sem erro nenhum, que é a pior forma de descobrir.
 */
export type TipoDeBloco =
  | "numeroPedido"
  | "canal"
  | "loja"
  | "dataHora"
  | "avisoEntrega"
  | "cliente"
  | "entrega"
  | "itens"
  | "totais"
  | "pagamento"
  | "qrMotoboy"
  | "qrCliente"
  | "textoLivre"
  | "textoRico"
  | "separador"
  | "espaco";

/**
 * UM PEDAÇO DE UMA LINHA DE TEXTO RICO.
 *
 * É aqui que mora a diferença para o `textoLivre` de hoje. No texto livre a
 * variável é trocada dentro de uma string: `"Ref: {referencia}"` com a
 * referência vazia imprime `"Ref:"` sozinho, uma palavra órfã no papel.
 *
 * Aqui o RÓTULO viaja colado à variável. Quando a variável não tem valor, o
 * pedaço inteiro some — rótulo junto. É o mesmo desenho que a Saipos usa
 * (`label` dentro do `replaceableAttribute`), e é o que permite escrever uma
 * comanda que se dobra sozinha conforme o pedido tem ou não endereço,
 * referência, entregador, troco.
 *
 * Pedaço só com `texto` é literal: sai sempre.
 */
export type ParteDaLinha = {
  /** Texto fixo. Sozinho, sai sempre. Com `campo`, é o rótulo que some junto. */
  texto?: string;
  /** Chave de CAMPOS_DISPONIVEIS. Vazia no pedido = o pedaço inteiro some. */
  campo?: string;
};

/** Uma linha do bloco de texto rico, com formato próprio. */
export type LinhaRica = {
  partes: ParteDaLinha[];
  negrito?: boolean;
  /**
   * Tarja de fundo preto com letra branca, na largura inteira.
   *
   * É o destaque que o lojista chama de "marcado de preto". Existe porque
   * negrito sozinho se perde num papel térmico cheio de texto: as linhas que
   * a loja precisa achar de relance — o tipo do pedido, o nome do cliente, o
   * "PAGO ONLINE" — pedem contraste, não peso de fonte.
   *
   * Precisa do Assistente 1.2.19 (VERSAO_COM_DESTAQUE_INVERTIDO). Em versão
   * anterior a linha sai normal, sem tarja — some o destaque, nunca o texto.
   */
  invertido?: boolean;
  tamanho?: Tamanho;
  alinhamento?: Alinhamento;
};

export type Bloco = {
  tipo: TipoDeBloco;
  /** Desligado não sai no papel. O bloco fica na lista para religar depois. */
  ligado: boolean;
  /** Título da seção, quando o bloco tem um ("CLIENTE", "ENTREGA"). Vazio = sem título. */
  titulo?: string;
  /** Só para `textoLivre`: aceita {cliente}, {endereco}, {total}… */
  texto?: string;
  /**
   * Só para `textoRico`: as linhas, cada uma com o seu formato.
   *
   * Campo NOVO ao lado do velho, nunca no lugar dele. Se `texto` virasse
   * `linhas`, o Assistente 1.2.11–1.2.17 cairia no `case "textoLivre"`, leria
   * `bl.texto` undefined e o bloco sumiria do papel: o lojista configuraria o
   * cabeçalho e não sairia nada.
   */
  linhas?: LinhaRica[];
  negrito?: boolean;
  /**
   * Tarja de fundo preto com letra branca, na largura inteira.
   *
   * É o destaque que o lojista chama de "marcado de preto". Existe porque
   * negrito sozinho se perde num papel térmico cheio de texto: as linhas que
   * a loja precisa achar de relance — o tipo do pedido, o nome do cliente, o
   * "PAGO ONLINE" — pedem contraste, não peso de fonte.
   *
   * Precisa do Assistente 1.2.19 (VERSAO_COM_DESTAQUE_INVERTIDO). Em versão
   * anterior a linha sai normal, sem tarja — some o destaque, nunca o texto.
   */
  invertido?: boolean;
  /** Um degrau de TAMANHOS: 1, 1.5, 2 ou 3. Ausente = 1. */
  tamanho?: Tamanho;
  alinhamento?: Alinhamento;
  /**
   * As palavras fixas que este bloco escreve, trocadas pela loja.
   *
   * Chave do catálogo `ROTULOS_DO_BLOCO` → o texto que sai no lugar do de
   * fábrica. Só o RÓTULO muda; o valor ao lado continua vindo do pedido, então
   * trocar "Nome:" por "Cliente:" não tem como fazer o nome errado sair no
   * papel. Chave ausente = texto de fábrica, que é o que 100% das lojas têm
   * hoje.
   *
   * Mora dentro do bloco de propósito: "Subtotal:" é do bloco de valores como
   * o tamanho da letra é. Um dicionário solto no modelo sobreviveria ao bloco
   * que ele descreve, e no dia em que a loja tirasse o bloco ficaria um rótulo
   * órfão que ninguém sabe de onde veio.
   */
  rotulos?: Record<string, string>;
  /**
   * Quais linhas desta seção saem em NEGRITO, por chave do mesmo catálogo.
   *
   * `true` liga, `false` desliga, chave ausente = como sai de fábrica (o
   * `negritoPadrao` do catálogo). Precisa dos três estados: "Forma de
   * Pagamento:" e "Total:" já nascem em negrito no papel, e sem o `false`
   * explícito não haveria como a loja TIRAR o destaque de uma linha que ela
   * não quer destacada.
   *
   * Só negrito, e não tamanho: negrito não muda quantas letras cabem na linha.
   * Corpo ampliado muda, e estas seções são montadas pelo Assistente já
   * quebradas na largura da bobina — reformatá-las por fora faria a IMPRESSORA
   * quebrar a linha onde quisesse, que foi como "Rua Ma / cae" apareceu. Onde o
   * corpo maior valia a pena, ele está fixo e decidido (número do pedido,
   * número no app, observação).
   */
  negritos?: Record<string, boolean>;
  /**
   * O CORPO de linhas específicas desta seção, por chave de `CORPOS_DO_BLOCO`.
   *
   * Leia o parágrafo acima antes de acrescentar chave aqui: corpo por linha é
   * perigoso justamente porque muda quantas letras cabem, e as seções chegam
   * do Assistente já quebradas na largura da bobina. Só entra aqui a linha que
   * satisfaz as TRÊS condições:
   *
   *   1. é uma frase FIXA, que não vem do pedido;
   *   2. ocupa a linha inteira, sozinha;
   *   3. quem calcula a largura dela é o mesmo código que a amplia.
   *
   * Hoje só o aviso de bebida atende. Chave ausente = o padrão de fábrica.
   */
  corpos?: Record<string, Tamanho>;
  /**
   * Só no bloco `totais`: a linha "Taxa de Entrega" não sai no papel.
   *
   * O TOTAL não muda — ele vem de `totalAmount`, que já inclui a taxa. Some a
   * linha, não o dinheiro. Existe porque há loja que não quer o cliente
   * vendo quanto da conta é entrega.
   */
  ocultarTaxaEntrega?: boolean;
};

export type ModeloDeComanda = {
  versao: 1;
  /** A via que vai para a cozinha: sem valores, sem pagamento. */
  cozinha: Bloco[];
  /** A via completa: entrega, valores, pagamento. */
  completo: Bloco[];
  /**
   * MODELOS EXTRAS, escolhidos por impressora.
   *
   * `cozinha`/`completo` acima continuam sendo o modelo PADRÃO da loja — a
   * impressora que não escolher nada usa eles, e é o que o Assistente antigo
   * recebe em `order.blocos`. Esta lista é aditiva: quem nunca criar um
   * modelo extra tem exatamente o comportamento de sempre.
   *
   * Não trocar isto por um mapa que elimine `completo`: `modeloFoiPersonalizado`
   * decide se a loja recebe `blocos` testando `Array.isArray(bruto.completo)`,
   * e sem esse campo TODA loja que já personalizou volta ao layout de fábrica,
   * em silêncio, no primeiro pedido depois do deploy.
   */
  modelos?: ModeloNomeado[];
  /** Os avisos que a loja DESLIGOU na aba Avisos (ver AVISOS_DA_COMANDA). */
  avisos?: AvisosDesligados;
};

// ── OS AVISOS DA COMANDA (aba "Avisos" de Personalizar impressão) ───────────
//
// Pedido do dono (23/09/2026): "tem que ter opção de personalizar os avisos
// também, uma aba destacada — não quero aviso de cobrar o cliente na entrega,
// por exemplo, aí o cara desmarca lá". Cada chave é um `avisoLigado(chave)` no
// Assistente (firehub-print-assistant/server.js), a partir da 1.2.23.
//
// Só viaja o que a loja DESLIGOU. Ausente é ligado: Assistente antigo e loja
// que nunca abriu a aba imprimem como sempre.
//
// A entrega parceira ("NÃO USAR MOTOBOY DA LOJA") fica fora de propósito:
// desligada, a loja manda o próprio motoboy num pedido que já tem entregador
// do app a caminho, e paga a corrida duas vezes.
export type ChaveDeAviso =
  | "cobrarDoCliente"
  | "cobrarNaEntrega"
  | "pagoOnline"
  | "troco"
  | "faixaObservacao"
  | "contemBebida"
  | "obrigado";

export type AvisosDesligados = Partial<Record<ChaveDeAviso, false>>;

export const AVISOS_DA_COMANDA: { chave: ChaveDeAviso; nome: string; exemplo: string; ajuda?: string }[] = [
  { chave: "cobrarDoCliente", nome: "Cobrar do cliente na entrega", exemplo: "!! COBRAR DO CLIENTE NA ENTREGA: R$ 65,90 !!" },
  { chave: "cobrarNaEntrega", nome: "Cobrar na entrega (junto da forma de pagamento)", exemplo: "(COBRAR NA ENTREGA)" },
  { chave: "pagoOnline", nome: "Pago online — não cobrar", exemplo: "(Pago via iFood - NAO COBRAR)" },
  { chave: "troco", nome: "Troco para levar", exemplo: "Troco para: R$ 100,00 (Levar R$ 34,10 de troco)" },
  {
    chave: "faixaObservacao", nome: "Faixa da observação do cliente", exemplo: "!! OBSERVACAO DO CLIENTE !!",
    ajuda: "Desligada, a observação continua saindo — numa linha comum, sem a faixa preta.",
  },
  { chave: "contemBebida", nome: "Contém bebida", exemplo: "!! CONTEM BEBIDA !!" },
  { chave: "obrigado", nome: "Obrigado pela preferência (rodapé)", exemplo: "Obrigado pela preferencia!" },
];

/** O Assistente que obedece a aba Avisos. */
export const VERSAO_MINIMA_DOS_AVISOS = "1.2.23";

/** Só as chaves conhecidas, e só o `false`: o resto é "ligado". */
export function saneiaAvisos(bruto: unknown): AvisosDesligados | undefined {
  if (!bruto || typeof bruto !== "object") return undefined;
  const limpo: AvisosDesligados = {};
  for (const a of AVISOS_DA_COMANDA) {
    if ((bruto as Record<string, unknown>)[a.chave] === false) limpo[a.chave] = false;
  }
  return Object.keys(limpo).length ? limpo : undefined;
}

/**
 * Um modelo com nome, para a impressora apontar.
 *
 * Tem as MESMAS duas vias do padrão porque o botão "cozinha/completo" do
 * painel continua existindo: a impressora escolhe o modelo, o clique escolhe
 * a via. Fundir as duas coisas tiraria do lojista a via sem preço que ele já
 * usa hoje.
 */
export type ModeloNomeado = {
  /** Estável: é o que fica gravado na impressora. Nunca reaproveitar. */
  id: string;
  nome: string;
  cozinha: Bloco[];
  completo: Bloco[];
  /** Os avisos andam com o modelo: a impressora do balcão pode querer outros. */
  avisos?: AvisosDesligados;
  /**
   * A impressora que usa este modelo imprime SEM VALORES: nem preço de item,
   * nem de adicional, nem totais. É a comanda de quem monta o pedido.
   *
   * Não basta desligar os blocos de totais e pagamento: o preço de cada item
   * sai na linha do item, e quem o tira é o `semValores` do pedido, que o
   * Assistente lê (a partir da 1.2.26, por impressora — ver
   * VERSAO_COM_SEM_VALORES_POR_IMPRESSORA). Com ele ligado, vale a via
   * `cozinha` do modelo.
   */
  semValores?: boolean;
};

/**
 * Blocos que a loja não pode tirar do papel.
 *
 * `itens` porque comanda sem o pedido é papel jogado fora. `avisoEntrega`
 * porque é o aviso de que o pedido JÁ tem motoboy do parceiro a caminho, mais
 * o código de coleta — sem ele a loja manda o próprio motoboy num pedido que
 * não é dela para entregar, e paga a corrida duas vezes.
 */
export const BLOCOS_OBRIGATORIOS: TipoDeBloco[] = ["itens", "avisoEntrega"];

/** Blocos cujo conteúdo o Assistente monta: aceitam título, nunca formato. */
export const BLOCOS_DE_SECAO: TipoDeBloco[] = [
  "avisoEntrega", "cliente", "entrega", "itens", "totais", "pagamento", "qrMotoboy", "qrCliente",
];

/**
 * A partir de qual Assistente o bloco `textoRico` sai no papel.
 *
 * Constante PRÓPRIA, como VERSAO_ASSISTENTE_COM_TAXA_SEPARADA em print.ts.
 * Subir VERSAO_MINIMA_DO_MODELO no lugar faria a tela acusar atraso em loja
 * que já lê o modelo perfeitamente bem.
 */
export const VERSAO_COM_TEXTO_RICO = "1.2.18";

/**
 * A partir de qual Assistente cada IMPRESSORA pode ter o seu modelo.
 *
 * Vale só para a fila da nuvem: no trilho do navegador o modelo já viaja por
 * chamada (um POST /print por impressora), então ali funciona desde a 1.2.11.
 * Na fila, o Assistente precisa saber ler `destino.blocos` — antes disso ele
 * usa `job.order.blocos` para todas as impressoras.
 */
export const VERSAO_COM_MODELO_POR_IMPRESSORA = "1.2.18";

/**
 * A partir de qual Assistente a tarja "marcada de preto" sai no papel.
 *
 * Constante PRÓPRIA, pelo mesmo motivo das duas acima: subir a versão mínima
 * do modelo faria a tela acusar atraso em loja que lê o modelo perfeitamente.
 * Em Assistente anterior a linha sai normal — some o destaque, nunca o texto.
 */
export const VERSAO_COM_DESTAQUE_INVERTIDO = "1.2.19";

/** Blocos que aceitam negrito, tamanho e alinhamento. */
export function aceitaFormato(tipo: TipoDeBloco): boolean {
  // `textoRico` fica de fora porque o formato dele é POR LINHA, dentro do
  // bloco. Oferecer também um formato de bloco daria dois controles para a
  // mesma coisa, e o lojista não teria como saber qual vence.
  return !BLOCOS_DE_SECAO.includes(tipo) && tipo !== "separador" && tipo !== "espaco" && tipo !== "textoRico";
}

/** Blocos que têm um título editável em cima. */
export function aceitaTitulo(tipo: TipoDeBloco): boolean {
  return tipo === "cliente" || tipo === "entrega" || tipo === "itens";
}

/**
 * ── TODA PALAVRA FIXA DO PAPEL, E DE QUEM ELA É ────────────────────────────
 *
 * Este catálogo é a lista do que a loja pode reescrever na comanda. Pedido do
 * dono (19/09/2026), com a Saipos como régua: lá o lojista clica no papel da
 * tela e muda a palavra. Até aqui ele só podia mexer nos TÍTULOS de três
 * seções; "Nome:", "Subtotal:", "Forma de pagamento:" eram código, nos DOIS
 * lados (aqui e no Assistente), e trocar qualquer um exigia atualizar o
 * programa em todas as lojas.
 *
 * ── É UM CONTRATO, como a lista de tipos de bloco ──────────────────────────
 *
 * Cada `chave` daqui tem um `R(...)` correspondente em
 * firehub-print-assistant/server.js. Chave que exista só de um lado é pior do
 * que chave nenhuma: a prévia mostra a palavra nova e o papel sai com a
 * antiga, e o lojista conclui que a tela mente — o contrário do que esta tela
 * inteira foi feita para resolver. Ao acrescentar uma, acrescente nos dois e
 * no teste `scripts/teste-modelo-comanda.js`.
 *
 * O `padrao` é o texto de fábrica. Ele NÃO é gravado no modelo: o que fica
 * guardado é só o que a loja trocou, então o dia em que quisermos mudar um
 * texto de fábrica (um acento, um "nº") ele muda para todo mundo que não
 * personalizou — que é a maioria.
 */
export type RotuloDoBloco = {
  chave: string;
  padrao: string;
  ajuda?: string;
  /**
   * Esta linha já sai em negrito no papel de fábrica?
   *
   * Copiado de server.js, linha por linha — "Forma de Pagamento:" e "Total:"
   * sempre saíram em negrito, e a prévia os desenhava normais. Enquanto a tela
   * só ilustrava, isso passava; agora que ela é o lugar onde a loja MARCA o
   * negrito, um padrão errado aqui faria o lojista clicar em "N" achando que
   * está ligando o que já estava ligado — e o papel não mudaria.
   */
  negritoPadrao?: boolean;
};

export const ROTULOS_DO_BLOCO: Partial<Record<TipoDeBloco, RotuloDoBloco[]>> = {
  numeroPedido: [
    { chave: "delivery", padrao: "DELIVERY", ajuda: "A palavra ao lado do número, no topo.", negritoPadrao: true },
  ],
  loja: [{ chave: "estabelecimento", padrao: "Estabelecimento:" }],
  dataHora: [
    // "{canal}" vira o nome do app no papel ("N. no iFood:", "N. no 99Food:").
    // Era "N. do Pedido:", e ao lado do nosso número grande no topo deixava a
    // dúvida de qual dos dois era o pedido (23/09/2026). O Assistente troca o
    // {canal} também no texto que a loja escrever.
    {
      chave: "numeroNoParceiro", padrao: "N. no {canal}:", negritoPadrao: true,
      ajuda: "Só sai em pedido do iFood, 99Food e outros apps. {canal} vira o nome do app.",
    },
    { chave: "data", padrao: "Data:" },
  ],
  avisoEntrega: [
    { chave: "motoboy", padrao: "MOTOBOY", ajuda: "Vem antes do nome do parceiro: \"*** MOTOBOY IFOOD ***\"." },
    { chave: "entregaParceira", padrao: "(ENTREGA PARCEIRA)" },
    { chave: "naoUsar", padrao: "NAO USAR MOTOBOY DA LOJA!" },
    { chave: "codigoDeColeta", padrao: "CODIGO DE COLETA:" },
  ],
  cliente: [
    { chave: "nome", padrao: "Nome:" },
    // O "CPF na nota". Rótulo único para os dois documentos de propósito: se a
    // palavra mudasse conforme o número ("CPF:" ou "CNPJ:"), a loja editaria
    // uma das duas e a outra continuaria como veio de fábrica.
    { chave: "documento", padrao: "CPF/CNPJ:", ajuda: "O documento que o cliente pediu na nota." },
    { chave: "telefone", padrao: "Telefone:" },
    { chave: "qtdPedidos", padrao: "Qtd Pedidos:" },
  ],
  entrega: [
    { chave: "endereco", padrao: "Endereco:" },
    { chave: "observacao", padrao: "Obs:", ajuda: "O que o cliente escreveu sobre a entrega.", negritoPadrao: true },
  ],
  itens: [
    { chave: "observacaoDoItem", padrao: "Obs:", ajuda: "O que o cliente pediu naquele item.", negritoPadrao: true },
  ],
  totais: [
    { chave: "subtotal", padrao: "Subtotal:" },
    { chave: "desconto", padrao: "Desconto (Cupom - Loja):" },
    { chave: "taxaEntrega", padrao: "Taxa de Entrega:" },
    { chave: "total", padrao: "Total:", negritoPadrao: true },
  ],
  // Os textos de fábrica daqui são os do PAPEL, copiados de server.js — não os
  // que a prévia mostrava antes. A prévia sempre foi uma aproximação do
  // conteúdo ("ENTREGADOR: PUXAR PEDIDO" onde o papel escreve "MOTOBOY:
  // escaneie para puxar"), e isso não fazia mal enquanto ela só ilustrava.
  // Agora que a palavra da tela É a palavra do papel, aproximação vira mentira:
  // a loja editaria um texto que não existe e o papel sairia com outro.
  pagamento: [
    { chave: "formaDePagamento", padrao: "Forma de Pagamento:", negritoPadrao: true },
    { chave: "troco", padrao: "Troco para:", ajuda: "Vem antes do valor que o cliente vai entregar.", negritoPadrao: true },
  ],
  qrMotoboy: [
    { chave: "chamada", padrao: "MOTOBOY: escaneie para puxar", negritoPadrao: true },
    { chave: "digite", padrao: "ou digite o numero", ajuda: "Antes do código curto do pedido." },
  ],
  qrCliente: [
    { chave: "chamada", padrao: "Escaneie e faca seu proximo pedido", negritoPadrao: true },
    { chave: "cupom", padrao: "ou use o cupom" },
  ],
};

/** O texto de fábrica de um rótulo, ou "" se a chave não existir no catálogo. */
export function rotuloPadrao(tipo: TipoDeBloco, chave: string): string {
  return ROTULOS_DO_BLOCO[tipo]?.find((r) => r.chave === chave)?.padrao ?? "";
}

/** O que sai no papel para este rótulo: o da loja, ou o de fábrica. */
export function rotuloDoBloco(bloco: Bloco, chave: string): string {
  const meu = bloco.rotulos?.[chave];
  return meu != null && String(meu).trim() !== "" ? String(meu) : rotuloPadrao(bloco.tipo, chave);
}

/** Esta linha sai em negrito no papel de fábrica? */
export function negritoPadrao(tipo: TipoDeBloco, chave: string): boolean {
  return ROTULOS_DO_BLOCO[tipo]?.find((r) => r.chave === chave)?.negritoPadrao === true;
}

/** Esta linha sai em negrito: o que a loja marcou, ou o de fábrica. */
export function negritoDoBloco(bloco: Bloco, chave: string): boolean {
  const meu = bloco.negritos?.[chave];
  return typeof meu === "boolean" ? meu : negritoPadrao(bloco.tipo, chave);
}

/** A loja reescreveu alguma palavra OU mexeu em algum negrito? */
export function temRotuloTrocado(modelo: ModeloDeComanda): boolean {
  return [...modelo.completo, ...modelo.cozinha].some((b) =>
    Object.entries(b.rotulos || {}).some(([chave, valor]) =>
      String(valor ?? "").trim() !== "" && String(valor) !== rotuloPadrao(b.tipo, chave)));
}

/** Os campos que o lojista pode usar dentro de um bloco de texto livre. */
export const CAMPOS_DISPONIVEIS: { chave: string; rotulo: string }[] = [
  { chave: "numero", rotulo: "Número do pedido" },
  { chave: "canal", rotulo: "Canal (iFood, 99Food…)" },
  { chave: "codigoCanal", rotulo: "Número no canal" },
  { chave: "loja", rotulo: "Nome da loja" },
  { chave: "cliente", rotulo: "Nome do cliente" },
  { chave: "documento", rotulo: "CPF/CNPJ do cliente" },
  { chave: "telefone", rotulo: "Telefone" },
  { chave: "endereco", rotulo: "Endereço de entrega" },
  { chave: "data", rotulo: "Data" },
  { chave: "hora", rotulo: "Hora" },
  { chave: "total", rotulo: "Total do pedido" },
  { chave: "taxaEntrega", rotulo: "Taxa de entrega" },
  { chave: "pagamento", rotulo: "Forma de pagamento" },
  { chave: "entregador", rotulo: "Entregador" },
  { chave: "observacao", rotulo: "Observação do pedido" },
  { chave: "subtotal", rotulo: "Subtotal" },
  { chave: "desconto", rotulo: "Desconto" },
  { chave: "troco", rotulo: "Troco" },
  { chave: "localizador", rotulo: "Localizador (nº no suporte do parceiro)" },
  { chave: "previsao", rotulo: "Previsão de entrega" },
  { chave: "taxaServico", rotulo: "Taxa de serviço do parceiro" },
  { chave: "bandeira", rotulo: "Bandeira do cartão" },
  { chave: "quantidadeDeItens", rotulo: "Quantidade de itens" },
  { chave: "impressoEm", rotulo: "Impresso em (data e hora)" },
];

/** Como cada bloco se chama na tela de edição. */
export const NOME_DO_BLOCO: Record<TipoDeBloco, string> = {
  numeroPedido: "Número do pedido",
  canal: "Marca ou marketplace",
  loja: "Nome da loja",
  dataHora: "Data, hora e nº no parceiro",
  avisoEntrega: "Aviso de entrega parceira",
  cliente: "Dados do cliente",
  entrega: "Endereço de entrega",
  itens: "Itens do pedido",
  totais: "Valores e total",
  pagamento: "Forma de pagamento",
  qrMotoboy: "QR do entregador",
  qrCliente: "QR do cupom do cliente",
  textoLivre: "Texto livre",
  textoRico: "Texto com variáveis",
  separador: "Linha separadora",
  espaco: "Linha em branco",
};

/** O que o bloco faz, em uma linha, para quem nunca viu esta tela. */
export const AJUDA_DO_BLOCO: Record<TipoDeBloco, string> = {
  numeroPedido: "O número grande no topo, que a cozinha lê de longe.",
  canal: "A marca, quando você tem mais de uma no iFood — senão o nome do marketplace. Pedido do seu site não imprime nada aqui.",
  loja: "Útil para quem imprime pedidos de mais de uma loja na mesma impressora.",
  dataHora: "Quando o pedido entrou e o número dele no parceiro.",
  avisoEntrega: "\"MOTOBOY IFOOD — NÃO USAR MOTOBOY DA LOJA\" e o código de coleta. Não pode ser desligado.",
  cliente: "Nome e telefone.",
  entrega: "Endereço completo e a observação que o cliente escreveu.",
  itens: "A lista do que foi pedido, com combos e observações. Não pode ser desligada.",
  totais: "Subtotal, descontos, taxa de entrega e total.",
  pagamento: "Como o cliente paga, se já está pago e quanto de troco levar.",
  qrMotoboy: "O código que o ENTREGADOR escaneia para puxar o pedido no app.",
  qrCliente: "O cupom da campanha de trazer o cliente do iFood/99 para o seu site.",
  textoLivre: "O que você quiser escrever. Clique num campo para trazer dado do pedido.",
  textoRico:
    "Linhas com texto e campos do pedido misturados. O rótulo some junto com o campo vazio: " +
    '"Ref: {referência}" não imprime nada quando o pedido não tem referência.',
  separador: "Uma linha de tracinhos para separar seções.",
  espaco: "Um espaço em branco.",
};

const b = (tipo: TipoDeBloco, extra: Partial<Bloco> = {}): Bloco => ({ tipo, ligado: true, ...extra });

/**
 * O modelo que toda loja começa usando — a comanda que o FireHub imprime,
 * seção por seção, na mesma ordem.
 *
 * ── O NÚMERO EM 3x É DE FÁBRICA, E DE PROPÓSITO ──────────────────────────
 *
 * Decisão do dono em 19/09/2026, com a comanda do próprio iFood na mão: o
 * número do pedido sai gigante lá porque é o que a cozinha, o balcão e o
 * entregador leem de longe, em papel amassado, sob luz ruim. Em 2x ele
 * dividia o topo com o nome do canal e os dois disputavam o olho. Em 3x cabem
 * 16 colunas — "(79) DELIVERY #3523" quebra em duas linhas, e é o que o iFood
 * faz também. O par disso está no Assistente: quem nunca abriu esta tela não
 * manda modelo nenhum e imprime pelo layout embutido, então o mesmo destaque
 * teve que ser feito lá (`aplicarModelo` não roda para essa loja).
 */
export function modeloPadrao(): ModeloDeComanda {
  return {
    versao: 1,
    cozinha: [
      b("numeroPedido", { tamanho: 3, negrito: true, alinhamento: "centro" }),
      b("canal", { tamanho: 2, negrito: true, alinhamento: "centro" }),
      b("avisoEntrega"),
      b("separador"),
      b("loja"),
      b("dataHora"),
      b("cliente", { titulo: "CLIENTE" }),
      b("entrega", { titulo: "ENTREGA" }),
      b("itens", { titulo: "RESUMO DO PEDIDO" }),
    ],
    completo: [
      b("numeroPedido", { tamanho: 3, negrito: true, alinhamento: "centro" }),
      b("canal", { tamanho: 2, negrito: true, alinhamento: "centro" }),
      b("avisoEntrega"),
      b("separador"),
      b("loja"),
      b("dataHora"),
      b("cliente", { titulo: "CLIENTE" }),
      b("entrega", { titulo: "ENTREGA" }),
      b("itens", { titulo: "RESUMO DO PEDIDO" }),
      b("totais"),
      b("pagamento"),
      b("qrMotoboy"),
      b("qrCliente"),
    ],
  };
}

// ── MODELOS PRONTOS ─────────────────────────────────────────────────────────
//
// Pedido do dono (24/09/2026): "deixar 2 modelos pré-prontos, comanda
// detalhada e cozinha sem valores, porque sai a comanda resumida só para
// fazerem o pedido". Existem para toda loja sem ninguém criar nada: a tela de
// Impressoras já oferece os dois no seletor de cada impressora.
//
// São VIRTUAIS: não ficam gravados até a loja editar um deles. Editou, o
// modelo entra em `modelos[]` com o MESMO id e passa a valer a versão da loja
// (`modelosDisponiveis` põe a da loja por cima). Apagar a versão da loja volta
// ao pronto. O id nunca muda, então a impressora que escolheu o pronto segue
// apontando para ele depois da edição.

export const ID_MODELO_DETALHADA = "pronto-detalhada";
export const ID_MODELO_COZINHA = "pronto-cozinha";

/** Assistente que tira os valores POR IMPRESSORA (destino.semValores) e aumenta a letra dos itens. */
export const VERSAO_COM_SEM_VALORES_POR_IMPRESSORA = "1.2.26";

export function modelosProntos(): ModeloNomeado[] {
  const padrao = modeloPadrao();
  const cozinha: Bloco[] = [
    b("numeroPedido", { tamanho: 3, negrito: true, alinhamento: "centro" }),
    b("canal", { tamanho: 2, negrito: true, alinhamento: "centro" }),
    b("avisoEntrega"),
    b("separador"),
    b("dataHora"),
    b("cliente", { titulo: "CLIENTE" }),
    b("itens", { titulo: "PEDIDO", corpos: { linhaDoItem: 2 } }),
  ];
  return [
    {
      id: ID_MODELO_DETALHADA,
      nome: "Comanda detalhada",
      completo: padrao.completo.map((x) => (x.tipo === "itens" ? { ...x, corpos: { linhaDoItem: 1.5 } } : x)),
      cozinha: padrao.cozinha,
    },
    {
      id: ID_MODELO_COZINHA,
      nome: "Cozinha sem valores",
      semValores: true,
      cozinha,
      completo: cozinha,
    },
  ];
}

export function ehModeloPronto(id: string | null | undefined): boolean {
  return id === ID_MODELO_DETALHADA || id === ID_MODELO_COZINHA;
}

/**
 * Todos os modelos que uma impressora pode escolher: os prontos (ou a versão
 * que a loja editou deles) e os que a loja criou, nesta ordem.
 */
export function modelosDisponiveis(modelo: ModeloDeComanda): ModeloNomeado[] {
  const daLoja = modelo.modelos || [];
  const prontos = modelosProntos().map((p) => daLoja.find((x) => x.id === p.id) || p);
  return [...prontos, ...daLoja.filter((x) => !ehModeloPronto(x.id))];
}

/** O modelo com este id (pronto ou da loja), ou null. */
export function acharModelo(modelo: ModeloDeComanda, id: string | null | undefined): ModeloNomeado | null {
  if (!id) return null;
  return modelosDisponiveis(modelo).find((x) => x.id === id) || null;
}

/**
 * Guarda só rótulo de chave que existe, e corta o que for grande demais.
 *
 * O que chega aqui pode vir de um modelo salvo por uma versão futura da tela,
 * de edição na mão do JSON ou de um bug meu. Chave desconhecida some (o
 * Assistente a ignoraria de qualquer jeito, e guardá-la só faria o payload
 * crescer para sempre); 60 letras é mais que qualquer rótulo cabe no papel —
 * é trava contra alguém colar um texto inteiro no lugar de "Nome:".
 */
function saneiaRotulos(tipo: TipoDeBloco, bruto: unknown): Record<string, string> | undefined {
  if (!bruto || typeof bruto !== "object") return undefined;
  const conhecidas = new Set((ROTULOS_DO_BLOCO[tipo] || []).map((r) => r.chave));
  const limpo: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (!conhecidas.has(chave) || typeof valor !== "string") continue;
    const t = valor.trim().slice(0, 60);
    if (t) limpo[chave] = t;
  }
  return Object.keys(limpo).length ? limpo : undefined;
}

/** Mesma trava do rótulo: só chave do catálogo, e só booleano de verdade. */
function saneiaNegritos(tipo: TipoDeBloco, bruto: unknown): Record<string, boolean> | undefined {
  if (!bruto || typeof bruto !== "object") return undefined;
  const conhecidas = new Set((ROTULOS_DO_BLOCO[tipo] || []).map((r) => r.chave));
  const limpo: Record<string, boolean> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (conhecidas.has(chave) && typeof valor === "boolean") limpo[chave] = valor;
  }
  return Object.keys(limpo).length ? limpo : undefined;
}

/**
 * A faixa preta "CONTEM BEBIDA", no fim da lista de itens.
 *
 * Saía no corpo do resto do papel, e a reclamação veio da loja (NIK, 21/09/2026):
 * na pilha de comandas do balcão a faixa se perde, que é exatamente o que ela
 * existe para não deixar acontecer — bebida esquecida volta como entrega
 * refeita. Agora nasce em 2x.
 *
 * É a ÚNICA linha com corpo configurável, e isso é de propósito. O comentário
 * de `Bloco.negritos` explica por que tamanho por linha é perigoso: as seções
 * chegam do Assistente já quebradas na largura da bobina, e reformatá-las por
 * fora faz a impressora quebrar onde quiser ("Rua Ma / cae"). Aqui não há esse
 * risco: é uma frase FIXA, sozinha na linha, e quem calcula a largura da faixa
 * é o mesmo código que a amplia.
 *
 * Mora aqui, e não junto de DESTAQUE_DO_NUMERO_NO_APP, porque o catálogo
 * abaixo lê o valor na hora em que o módulo carrega.
 */
export const DESTAQUE_DO_AVISO_DE_BEBIDA: Tamanho = 2;

/**
 * Versão do Assistente que entende `Bloco.corpos`.
 *
 * Abaixo dela o papel sai como sempre saiu, no corpo normal, em vez de sair
 * errado: o Assistente antigo ignora a chave que não conhece. A tela usa isto
 * para avisar a loja em vez de prometer o que não vai acontecer.
 */
// 1.2.21 e NAO 1.2.20: a 1.2.20 ja foi publicada, com o CPF na nota, e o
// codigo da faixa de bebida entrou DEPOIS dela. Apontar para a 1.2.20 diria
// a loja que ja atualizou que o recurso funciona, e o papel sairia igual.
export const VERSAO_COM_CORPO_DO_AVISO = "1.2.21";

/**
 * Catálogo das linhas com corpo configurável. Leia `Bloco.corpos` antes de
 * acrescentar chave: a lista é curta de propósito.
 */
export const CORPOS_DO_BLOCO: Partial<Record<TipoDeBloco, { chave: string; rotulo: string; ajuda: string; padrao: Tamanho }[]>> = {
  itens: [
    {
      chave: "linhaDoItem",
      rotulo: "Letra dos itens",
      ajuda: "A linha de cada item (\"2x X-Bacon\") e os complementos dele. Maior = a cozinha lê de longe. Precisa do Assistente 1.2.26.",
      padrao: 1,
    },
    {
      chave: "avisoDeBebida",
      rotulo: "Faixa CONTÉM BEBIDA",
      ajuda: "A tarja preta no fim da lista, quando o pedido tem bebida. Maior = mais difícil de passar batido na pilha de comandas.",
      padrao: DESTAQUE_DO_AVISO_DE_BEBIDA,
    },
  ],
};

export function corpoPadrao(tipo: TipoDeBloco, chave: string): Tamanho {
  return (CORPOS_DO_BLOCO[tipo] || []).find((c) => c.chave === chave)?.padrao ?? 1;
}

/** O corpo que a loja escolheu para esta linha, ou o de fábrica. */
export function corpoDoBloco(bloco: Bloco, chave: string): Tamanho {
  const meu = bloco.corpos?.[chave];
  return meu != null ? tamanhoValido(meu) : corpoPadrao(bloco.tipo, chave);
}

function saneiaCorpos(tipo: TipoDeBloco, bruto: unknown): Record<string, Tamanho> | undefined {
  if (!bruto || typeof bruto !== "object") return undefined;
  const conhecidas = new Set((CORPOS_DO_BLOCO[tipo] || []).map((c) => c.chave));
  const limpo: Record<string, Tamanho> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (conhecidas.has(chave) && TAMANHOS.includes(Number(valor) as Tamanho)) {
      limpo[chave] = Number(valor) as Tamanho;
    }
  }
  return Object.keys(limpo).length ? limpo : undefined;
}

/** Lê o que está gravado, completando o que faltar com o padrão. */
export function lerModelo(bruto: unknown): ModeloDeComanda {
  const padrao = modeloPadrao();
  if (!bruto || typeof bruto !== "object") return padrao;
  const m = bruto as Partial<ModeloDeComanda>;
  const valida = (lista: unknown, reserva: Bloco[]): Bloco[] => {
    if (!Array.isArray(lista) || lista.length === 0) return reserva;
    const limpos = lista
      .filter((x): x is Bloco => !!x && typeof x === "object" && typeof (x as Bloco).tipo === "string" && (x as Bloco).tipo in NOME_DO_BLOCO)
      .map((x): Bloco => ({
        ...x,
        ligado: BLOCOS_OBRIGATORIOS.includes(x.tipo) ? true : x.ligado !== false,
        // Tamanho fora da escada (modelo de versão futura, edição na mão)
        // encosta no degrau mais próximo em vez de virar tarja preta.
        tamanho: x.tamanho ? tamanhoValido(x.tamanho) : undefined,
        rotulos: saneiaRotulos(x.tipo, x.rotulos),
        negritos: saneiaNegritos(x.tipo, x.negritos),
        corpos: saneiaCorpos(x.tipo, x.corpos),
      }));
    // Bloco obrigatório que sumiu do modelo salvo volta para o fim. Some por
    // edição manual, por versão antiga, ou por um bug meu — e em qualquer um
    // desses casos a loja não pode descobrir na hora do pedido.
    for (const obrigatorio of BLOCOS_OBRIGATORIOS) {
      if (!limpos.some((x) => x.tipo === obrigatorio)) {
        limpos.push(b(obrigatorio, obrigatorio === "itens" ? { titulo: "RESUMO DO PEDIDO" } : {}));
      }
    }
    return limpos;
  };
  // ── OS MODELOS EXTRAS PASSAM PELA MESMA VALIDAÇÃO ─────────────────────
  //
  // Cada um por `valida`, senão um modelo de cozinha "só itens" criado na mão
  // perde a garantia de BLOCOS_OBRIGATORIOS — e o aviso de entrega parceira
  // some do papel. Sem ele a loja manda o próprio motoboy num pedido que não é
  // dela e paga a corrida duas vezes.
  //
  // E esta função PRECISA devolver os extras: o editor salva com
  // `onChange({ ...lerModelo(atual), [via]: nova })`, então uma chave que
  // `lerModelo` não conheça é apagada no primeiro Salvar da tela antiga.
  const extras = Array.isArray(m.modelos)
    ? m.modelos
        .filter((x): x is ModeloNomeado => !!x && typeof x === "object" && typeof (x as ModeloNomeado).id === "string" && !!(x as ModeloNomeado).id)
        .map((x): ModeloNomeado => {
          const avisosDoExtra = saneiaAvisos(x.avisos);
          return {
            id: String(x.id),
            nome: String(x.nome || "Modelo").slice(0, 40),
            cozinha: valida(x.cozinha, padrao.cozinha),
            completo: valida(x.completo, padrao.completo),
            ...(avisosDoExtra ? { avisos: avisosDoExtra } : {}),
            ...(x.semValores === true ? { semValores: true } : {}),
          };
        })
    : [];
  // Mesma regra dos extras: chave que `lerModelo` não devolve é apagada no
  // primeiro Salvar — e os avisos que a loja desligou voltariam ao papel.
  const avisos = saneiaAvisos(m.avisos);

  return {
    versao: 1,
    cozinha: valida(m.cozinha, padrao.cozinha),
    completo: valida(m.completo, padrao.completo),
    ...(extras.length > 0 ? { modelos: extras } : {}),
    ...(avisos ? { avisos } : {}),
  };
}

/**
 * O modelo que ESTA impressora usa, já pela via pedida.
 *
 * `modeloId` vazio, apontando para modelo apagado, ou impressora sintética de
 * resgate (a `{id:"default"}` que o painel monta quando a loja não cadastrou
 * nada) caem todos no modelo PADRÃO da loja. A regra é a mesma de
 * `modulo-do-pedido.ts`: ausente significa "o de sempre", nunca "nenhum" —
 * ninguém acorda com a impressora muda porque um campo novo apareceu.
 */
export function viaDoModelo(
  modelo: ModeloDeComanda,
  opcoes: { modeloId?: string | null; semValores?: boolean } = {},
): Bloco[] {
  const escolhido = acharModelo(modelo, opcoes.modeloId);
  const fonte = escolhido || modelo;
  return opcoes.semValores || escolhido?.semValores ? fonte.cozinha : fonte.completo;
}

/**
 * Esta impressora imprime sem valores pelo MODELO que escolheu? (O botão
 * "Cupom da cozinha" do painel força sem valores por conta própria.)
 */
export function semValoresDaImpressora(printerConfig: unknown, modeloId: string | null | undefined): boolean {
  if (!modeloId) return false;
  const bruto = (printerConfig as { comandaModelo?: unknown } | null)?.comandaModelo;
  return acharModelo(lerModelo(bruto), modeloId)?.semValores === true;
}

/**
 * A lista que vai no `order.blocos`, enxuta.
 *
 * Bloco desligado nem é mandado, e campo vazio sai do JSON: o payload que
 * atravessa a rede fica do tamanho do que a loja realmente configurou.
 */
export function blocosParaOAssistente(lista: Bloco[]): Bloco[] {
  return lista
    .filter((x) => x.ligado !== false)
    .map((x) => {
      const saida: Bloco = { tipo: x.tipo, ligado: true };
      if (x.titulo != null) saida.titulo = x.titulo;
      if (x.texto) saida.texto = x.texto;
      if (x.negrito) saida.negrito = true;
      if (x.invertido) saida.invertido = true;
      if (x.ocultarTaxaEntrega) saida.ocultarTaxaEntrega = true;
      // O título de seção nasce em 1,5 no Assistente (`bl.tamanho || 1.5`),
      // então o 1 PRECISA viajar: omitido, a loja escolhia "1×" na tela e o
      // papel continuava saindo em 1,5.
      if (x.tamanho && (x.tamanho !== 1 || aceitaTitulo(x.tipo))) saida.tamanho = x.tamanho;
      if (x.alinhamento && x.alinhamento !== "esquerda") saida.alinhamento = x.alinhamento;
      // Só viaja a palavra que a loja REESCREVEU. Mandar o texto de fábrica
      // junto engordaria o payload de toda comanda e, pior, congelaria o
      // padrão: o dia em que corrigirmos um rótulo de fábrica, a loja que
      // nunca o tocou continuaria imprimindo o antigo.
      const trocados = Object.entries(x.rotulos || {}).filter(
        ([chave, valor]) => String(valor ?? "").trim() !== "" && String(valor) !== rotuloPadrao(x.tipo, chave),
      );
      if (trocados.length) saida.rotulos = Object.fromEntries(trocados);
      // ── O NEGRITO POR LINHA ────────────────────────────────────────────
      //
      // FALTAVA AQUI. O botão "N" da tela gravava `Bloco.negritos`, o
      // Assistente sabia ler (`negritosPorTipo` em server.js), e no meio do
      // caminho esta cópia não mandava: a loja marcava a linha em negrito, a
      // prévia mostrava, e o papel saía igual. É exatamente a armadilha que o
      // comentário da lista branca abaixo descreve.
      //
      // Só viaja o que DIFERE do padrão, e o `false` explícito é significativo:
      // é como se TIRA o negrito de "Total:", que já nasce marcado.
      const negritosMudados = Object.entries(x.negritos || {}).filter(
        ([chave, valor]) => typeof valor === "boolean" && valor !== negritoPadrao(x.tipo, chave),
      );
      if (negritosMudados.length) saida.negritos = Object.fromEntries(negritosMudados);
      // Campo do bloco de texto rico. Esta cópia é LISTA BRANCA: campo novo
      // esquecido aqui some do payload sem erro nenhum, e quem for depurar vai
      // olhar o Assistente e não achar nada errado.
      if (Array.isArray(x.linhas) && x.linhas.length > 0) saida.linhas = x.linhas;
      // O CORPO de linha específica (hoje só a faixa de bebida). Mesma regra
      // dos rótulos: só viaja o que a loja MUDOU, para o padrão de fábrica
      // continuar podendo mudar sem congelar em quem nunca tocou na tela.
      const corposMudados = Object.entries(x.corpos || {}).filter(
        ([chave, valor]) => Number(valor) !== Number(corpoPadrao(x.tipo, chave)),
      );
      if (corposMudados.length) saida.corpos = Object.fromEntries(corposMudados);
      return saida;
    });
}

/**
 * O modelo está mexido, ou a loja nunca abriu a tela?
 *
 * Quem nunca abriu não deve mandar `blocos` nenhum: assim o Assistente (novo
 * ou velho) imprime o layout embutido e não há como o modelo introduzir
 * diferença onde ninguém pediu diferença.
 */
export function modeloFoiPersonalizado(bruto: unknown): boolean {
  return !!bruto && typeof bruto === "object" && Array.isArray((bruto as ModeloDeComanda).completo);
}

/**
 * Os blocos prontos para o `order.blocos`, ou `undefined` quando a loja não
 * personalizou. As duas rotas de impressão (navegador e fila da nuvem) passam
 * por aqui para não divergirem uma da outra.
 */
export function blocosDoPedido(
  printerConfig: unknown,
  opcoes: { semValores?: boolean; modeloId?: string | null } = {},
): Bloco[] | undefined {
  const bruto = (printerConfig as { comandaModelo?: unknown } | null)?.comandaModelo;
  const modelo = lerModelo(bruto);
  // Impressora com modelo escolhido (inclusive um PRONTO, que a loja nunca
  // gravou) leva os blocos dele mesmo quando o padrão da loja é o de fábrica.
  const temModelo = !!acharModelo(modelo, opcoes.modeloId);
  if (!modeloFoiPersonalizado(bruto) && !temModelo) return undefined;
  return blocosParaOAssistente(viaDoModelo(modelo, opcoes));
}

/**
 * Os avisos que ESTA impressora desligou, para o `order.avisos` — ou
 * `undefined` quando não há nenhum. Segue o mesmo modelo que `blocosDoPedido`
 * escolhe: impressora com modelo próprio leva os avisos dele.
 */
export function avisosDoPedido(
  printerConfig: unknown,
  opcoes: { modeloId?: string | null } = {},
): AvisosDesligados | undefined {
  const bruto = (printerConfig as { comandaModelo?: unknown } | null)?.comandaModelo;
  const modelo = lerModelo(bruto);
  const escolhido = acharModelo(modelo, opcoes.modeloId);
  if (!modeloFoiPersonalizado(bruto) && !escolhido) return undefined;
  return (escolhido || modelo).avisos;
}

// ── Prévia ──────────────────────────────────────────────────────────────────

/** Uma linha pronta para o papel: texto já quebrado na largura certa. */
export type LinhaDaComanda = {
  texto: string;
  negrito?: boolean;
  /** Tarja de fundo preto, na largura inteira. */
  invertido?: boolean;
  tamanho?: Tamanho;
  alinhamento?: Alinhamento;
  /** Marca a linha como QR: o papel mostra o código, não o texto. */
  qr?: string;
  /** Índice do bloco que desenhou esta linha — a prévia usa para saber onde o clique caiu. */
  bloco?: number;
  /** A chave do rótulo que esta linha escreve, quando tem um. "@titulo" = o título da seção. */
  rotulo?: string;
};

/**
 * O corpo do número do pedido no app e o da observação do cliente.
 *
 * Ficam aqui, com nome, porque valem nos DOIS lados (esta prévia e o layout
 * embutido do Assistente) e porque são decisão de produto, não gosto: o número
 * é o que a loja procura no app com o cliente no telefone, e a observação é o
 * que a cozinha erra. Ver a comanda do iFood, que usa exatamente este recurso.
 * 1,5x e não 2x na observação: "sem cebola, sem azeitona e capricha no
 * recheio" em 2x vira quatro linhas de bobina.
 */
export const DESTAQUE_DO_NUMERO_NO_APP: Tamanho = 2;
export const DESTAQUE_DA_OBSERVACAO: Tamanho = 1.5;

/**
 * O corpo da faixa "CONTEM BEBIDA" e irmao destes dois, mas mora la em cima,
 * junto de `CORPOS_DO_BLOCO`, com o nome `DESTAQUE_DO_AVISO_DE_BEBIDA`: o
 * catalogo le o valor na hora em que o modulo carrega, e declarado aqui
 * embaixo daria ReferenceError antes de qualquer tela abrir.
 */

export type PedidoParaComanda = {
  numero?: string | number | null;
  canal?: string | null;
  codigoCanal?: string | null;
  loja?: string | null;
  cliente?: string | null;
  /** O "CPF na nota", já formatado (lib/documento-do-cliente.ts). */
  documento?: string | null;
  telefone?: string | null;
  endereco?: string | null;
  data?: string | null;
  hora?: string | null;
  total?: number | null;
  subtotal?: number | null;
  taxaEntrega?: number | null;
  desconto?: number | null;
  pagamento?: string | null;
  troco?: number | null;
  entregador?: string | null;
  observacao?: string | null;
  // ── Campos que a notinha do Frangoso (ex-Saipos) pede ────────────────
  //
  // Todos já existiam no pedido; só não tinham como ser escritos no papel
  // pelo editor de modelo. Eram o que faltava para reproduzir a notinha que
  // a loja usava antes de vir para o FireHub.
  /** O número que o cliente informa ao suporte do marketplace. */
  localizador?: string | null;
  /** "19:43 - 19:53": a janela que o parceiro prometeu ao cliente. */
  previsao?: string | null;
  /** Taxa de serviço cobrada pelo parceiro (o 99Food e o iFood cobram). */
  taxaServico?: number | null;
  /** "VISA", "MASTER", "OTHER" — a bandeira do cartão, quando o parceiro manda. */
  bandeira?: string | null;
  /** Quantas unidades o pedido tem ao todo. */
  quantidadeDeItens?: number | null;
  /** Data e hora em que o papel saiu (não é a do pedido). */
  impressoEm?: string | null;
  /** Entrega do parceiro: o aviso de não mandar motoboy da loja. */
  entregaParceira?: { parceiro: string; codigoDeColeta?: string | null } | null;
  itens?: { quantidade: number; nome: string; preco?: number | null; observacao?: string | null; complementos?: string[] }[];
  qrMotoboy?: string | null;
  /** Campanha "trazer o cliente do marketplace para o site da loja". */
  campanha?: { valor?: string | null; cupom?: string | null; url?: string | null } | null;
};

const dinheiro = (v?: number | null) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

/**
 * UMA LINHA DE TEXTO RICO, RESOLVIDA CONTRA O PEDIDO.
 *
 * A regra que justifica o bloco existir: pedaço com `campo` vazio some
 * INTEIRO, levando o rótulo junto. `{texto:"Ref: ", campo:"referencia"}` num
 * pedido sem referência não imprime "Ref:" órfão — não imprime nada.
 *
 * Devolve string vazia quando sobrou só espaço em branco: a linha inteira sai
 * do papel, em vez de virar uma linha vazia no meio da comanda.
 *
 * Esta função tem um GÊMEO no Assistente (firehub-print-assistant/server.js,
 * dentro de `aplicarModelo`). Mudou aqui, mude lá: a prévia da tela e o papel
 * resolvem a variável em dois lugares diferentes, e é assim que a tela começa
 * a mentir.
 */
export function resolverLinhaRica(linha: LinhaRica, p: PedidoParaComanda): string {
  const campos = mapaDeCampos(p);
  let saida = "";
  for (const parte of linha.partes || []) {
    if (parte.campo) {
      const v = (campos[parte.campo] ?? "").trim();
      // Vazio: o pedaço inteiro some, rótulo incluído.
      if (!v) continue;
      saida += (parte.texto || "") + v;
    } else if (parte.texto) {
      saida += parte.texto;
    }
  }
  return saida.trim();
}

/** Substitui {campo} pelo valor do pedido. Campo desconhecido sai vazio. */
export function preencherCampos(texto: string, p: PedidoParaComanda): string {
  const campos = mapaDeCampos(p);
  return String(texto || "").replace(/\{(\w+)\}/g, (_, campo) => campos[campo] ?? "");
}

/** O valor de cada `{campo}`. Um mapa só, para o texto livre e o rico nunca divergirem. */
function mapaDeCampos(p: PedidoParaComanda): Record<string, string> {
  const campos: Record<string, string> = {
    numero: String(p.numero ?? ""),
    canal: p.canal || "",
    codigoCanal: p.codigoCanal || "",
    loja: p.loja || "",
    cliente: p.cliente || "",
    documento: p.documento || "",
    telefone: p.telefone || "",
    endereco: p.endereco || "",
    data: p.data || "",
    hora: p.hora || "",
    total: dinheiro(p.total),
    taxaEntrega: dinheiro(p.taxaEntrega),
    pagamento: p.pagamento || "",
    entregador: p.entregador || "",
    // Campos que só o texto rico usa hoje. Entram aqui (e não num mapa
    // separado) porque o texto livre também passa a alcançá-los — dois mapas
    // seriam duas verdades sobre o que "{troco}" significa.
    observacao: p.observacao || "",
    subtotal: p.subtotal != null ? dinheiro(p.subtotal) : "",
    desconto: p.desconto ? dinheiro(p.desconto) : "",
    troco: p.troco ? dinheiro(p.troco) : "",
    localizador: p.localizador || "",
    previsao: p.previsao || "",
    taxaServico: p.taxaServico ? dinheiro(p.taxaServico) : "",
    bandeira: p.bandeira || "",
    quantidadeDeItens: p.quantidadeDeItens != null ? String(p.quantidadeDeItens) : "",
    impressoEm: p.impressoEm || "",
  };
  return campos;
}

/**
 * O modelo + o pedido viram a lista de linhas da PRÉVIA.
 *
 * Atenção ao que isto é e ao que não é: o papel de verdade sai do Assistente,
 * com o preço efetivo já rateado, a tarja de bebida e o rateio de mesa. Aqui
 * o objetivo é a loja ver a ORDEM, a LARGURA e o TAMANHO das letras exatamente
 * como vão sair — que é o que ela está editando nesta tela. Por isso a prévia
 * roda sobre um pedido de exemplo, e não sobre um pedido real.
 */
export function montarComanda(
  modelo: Bloco[],
  pedido: PedidoParaComanda,
  opcoes: { colunas: number; comValores: boolean },
): LinhaDaComanda[] {
  const { colunas, comValores } = opcoes;
  const saida: LinhaDaComanda[] = [];
  /**
   * `iBloco` e `rotulo` carimbam de onde a linha veio.
   *
   * É o que deixa a prévia ser clicável: o papel da direita devolve o bloco e
   * a palavra exata que aquela linha desenhou, então clicar em "Subtotal:"
   * abre "Subtotal:" para editar em vez de mandar o lojista caçar na lista da
   * esquerda qual card faz aquela linha. Sem o carimbo, o papel é um texto só
   * e não há como saber onde o clique caiu.
   */
  let iBloco = -1;
  const por = (texto: string, extra: Partial<LinhaDaComanda> = {}) =>
    saida.push({ texto, bloco: iBloco, ...extra });
  const titulo = (bloco: Bloco, padrao: string) => {
    const t = String(bloco.titulo == null ? padrao : bloco.titulo).trim();
    if (t) por(t.toUpperCase(), { alinhamento: "centro", tamanho: bloco.tamanho || 1.5, rotulo: "@titulo" });
  };
  /** A observação do cliente sai em destaque — ver DESTAQUE_DA_OBSERVACAO. */
  const obs: Partial<LinhaDaComanda> = { negrito: true, tamanho: DESTAQUE_DA_OBSERVACAO };

  for (const bloco of modelo) {
    iBloco++;
    if (!bloco.ligado) continue;
    const formato: Partial<LinhaDaComanda> = {
      negrito: bloco.negrito,
      invertido: bloco.invertido,
      tamanho: bloco.tamanho,
      alinhamento: bloco.alinhamento,
    };
    /** O texto desta palavra: o que a loja escreveu, ou o de fábrica. */
    const R = (chave: string) => rotuloDoBloco(bloco, chave);
    /** Esta linha sai em negrito? O que a loja marcou, ou o de fábrica. */
    const N = (chave: string) => negritoDoBloco(bloco, chave);

    switch (bloco.tipo) {
      case "numeroPedido":
        if (pedido.numero != null && pedido.numero !== "") {
          por(`(${pedido.numero}) ${R("delivery")} ${pedido.codigoCanal || ""}`.replace(/\s+/g, " ").trim(), { ...formato, negrito: N("delivery"), rotulo: "delivery" });
        }
        break;

      case "canal":
        if (pedido.canal) por(pedido.canal.toUpperCase(), formato);
        break;

      case "loja":
        if (pedido.loja) por(`${R("estabelecimento")} ${pedido.loja.toUpperCase()}`.trim(), { ...formato, negrito: N("estabelecimento"), rotulo: "estabelecimento" });
        break;

      case "dataHora":
        // ── O NÚMERO NO APP SAI GRANDE, COMO O DO PEDIDO ──────────────────
        //
        // É por ele que a loja acha o pedido dentro do iFood/99 quando o
        // cliente liga, e era a única linha de 1x no meio de um cabeçalho de
        // números grandes: para ler, alguém pegava o papel e aproximava.
        // Decisão do dono (19/09/2026), com a comanda do próprio iFood como
        // régua — lá o número sai em corpo dobrado. A DATA continua miúda: ela
        // é conferência, não é o que alguém procura com o telefone na mão.
        if (pedido.codigoCanal) {
          por(`${R("numeroNoParceiro")} ${String(pedido.codigoCanal).replace("#", "")}`.trim(),
            { ...formato, negrito: N("numeroNoParceiro"), tamanho: DESTAQUE_DO_NUMERO_NO_APP, rotulo: "numeroNoParceiro" });
        }
        if (pedido.data || pedido.hora) {
          por(`${R("data")} ${pedido.data || ""} ${pedido.hora || ""}`.trim(), { ...formato, negrito: N("data"), rotulo: "data" });
        }
        break;

      case "avisoEntrega": {
        const e = pedido.entregaParceira;
        if (!e) break;
        por(`*** ${R("motoboy")} ${e.parceiro.toUpperCase()} ${R("entregaParceira")} ***`.replace(/\s+/g, " "), { alinhamento: "centro", tamanho: 2, negrito: N("motoboy"), rotulo: "motoboy" });
        por(R("naoUsar"), { alinhamento: "centro", tamanho: 2, negrito: N("naoUsar"), rotulo: "naoUsar" });
        if (e.codigoDeColeta) por(`${R("codigoDeColeta")} #${e.codigoDeColeta}`.trim(), { alinhamento: "centro", tamanho: 2, negrito: N("codigoDeColeta"), rotulo: "codigoDeColeta" });
        break;
      }

      case "cliente":
        if (!pedido.cliente && !pedido.telefone && !pedido.documento) break;
        titulo(bloco, "CLIENTE");
        if (pedido.cliente) por(`${R("nome")} ${pedido.cliente}`.trim(), { negrito: N("nome"), rotulo: "nome" });
        if (pedido.documento) por(`${R("documento")} ${pedido.documento}`.trim(), { negrito: N("documento"), rotulo: "documento" });
        if (pedido.telefone) por(`${R("telefone")} ${pedido.telefone}`.trim(), { negrito: N("telefone"), rotulo: "telefone" });
        por(`${R("qtdPedidos")} 1`.trim(), { negrito: N("qtdPedidos"), rotulo: "qtdPedidos" });
        break;

      case "entrega":
        if (!pedido.endereco) break;
        titulo(bloco, "ENTREGA");
        por(`${R("endereco")} ${pedido.endereco}`.trim(), { negrito: N("endereco"), rotulo: "endereco" });
        if (pedido.observacao) por(`${R("observacao")} ${pedido.observacao}`.trim(), { ...obs, negrito: N("observacao"), rotulo: "observacao" });
        break;

      case "itens": {
        titulo(bloco, "RESUMO DO PEDIDO");
        for (const item of pedido.itens || []) {
          const valor = comValores && item.preco != null ? dinheiro(item.preco) : "";
          por(linhaComValor(`${item.quantidade}x ${item.nome}`, valor, colunas));
          for (const c of item.complementos || []) por(`  - ${c}`);
          // A OBSERVAÇÃO DO ITEM É O QUE A COZINHA ERRA. Saía do mesmo tamanho
          // da lista, recuada dois espaços, e "sem cebola" se perdia entre os
          // complementos — o pedido voltava. Decisão do dono (19/09/2026):
          // destaque, como na comanda do iFood. Sem recuo, porque em corpo
          // ampliado o recuo come coluna que falta para a frase.
          if (item.observacao) por(`${R("observacaoDoItem")} ${item.observacao}`.trim(), { ...obs, negrito: N("observacaoDoItem"), rotulo: "observacaoDoItem" });
          por("_".repeat(colunas));
        }
        break;
      }

      case "totais":
        if (!comValores) break;
        if (pedido.subtotal != null) por(linhaComValor(R("subtotal"), dinheiro(pedido.subtotal), colunas), { negrito: N("subtotal"), rotulo: "subtotal" });
        if (pedido.desconto) por(linhaComValor(R("desconto"), `-${dinheiro(pedido.desconto)}`, colunas), { negrito: N("desconto"), rotulo: "desconto" });
        if (pedido.taxaEntrega != null && !bloco.ocultarTaxaEntrega) {
          por(linhaComValor(R("taxaEntrega"), dinheiro(pedido.taxaEntrega), colunas), { negrito: N("taxaEntrega"), rotulo: "taxaEntrega" });
        }
        por("_".repeat(colunas));
        por(linhaComValor(R("total"), dinheiro(pedido.total), larguraDoTamanho(colunas, 2)), { negrito: N("total"), tamanho: 2, rotulo: "total" });
        por("_".repeat(colunas));
        break;

      case "pagamento":
        if (!comValores || !pedido.pagamento) break;
        por(`${R("formaDePagamento")} ${pedido.pagamento}`.trim(), { negrito: N("formaDePagamento"), rotulo: "formaDePagamento" });
        if (pedido.troco) por(`${R("troco")} ${dinheiro(pedido.troco)}`, { negrito: N("troco"), tamanho: 2, rotulo: "troco" });
        break;

      // ── OS DOIS QR NÃO PODEM SE PARECER ─────────────────────────────────
      //
      // Na mesma folha podem sair dois códigos: o que o ENTREGADOR lê para
      // puxar o pedido no app, e o cupom de desconto que o CLIENTE leva. Sem
      // rótulo são dois quadrados pretos iguais, e o cliente aponta a câmera no
      // errado achando que é o desconto dele — não vaza nada, o QR do
      // entregador só carrega o número do pedido e quem autoriza é a sessão do
      // motoboy, mas o cliente fica com a sensação de que o cupom não funcionou.
      case "qrMotoboy":
        if (!pedido.qrMotoboy) break;
        por("-".repeat(colunas));
        por("", { qr: pedido.qrMotoboy });
        por(R("chamada"), { alinhamento: "centro", negrito: N("chamada"), rotulo: "chamada" });
        por(`${R("digite")} 4821 no app`, { alinhamento: "centro", negrito: N("digite"), rotulo: "digite" });
        break;

      case "qrCliente": {
        const c = pedido.campanha;
        if (!c || !c.url) break;
        por("");
        // Barra de "=" de propósito: a folha inteira usa "-", então esta faixa
        // é a única coisa com essa cara e separa o que é do cliente.
        por("=".repeat(colunas));
        if (c.valor) por(String(c.valor), { alinhamento: "centro", negrito: true, tamanho: 2 });
        por("", { qr: c.url });
        por(R("chamada"), { alinhamento: "centro", negrito: N("chamada"), rotulo: "chamada" });
        if (c.cupom) por(`${R("cupom")} ${c.cupom.toUpperCase()}`.trim(), { alinhamento: "centro", negrito: N("cupom"), rotulo: "cupom" });
        por("=".repeat(colunas));
        break;
      }

      case "textoLivre": {
        const t = preencherCampos(bloco.texto || "", pedido).trim();
        if (t) por(t, formato);
        break;
      }

      case "textoRico": {
        // Uma LinhaDaComanda por linha configurada, cada uma com o formato
        // dela. Linha que resolveu vazia (todos os campos em branco) não vira
        // linha em branco no papel: some.
        for (const linha of bloco.linhas || []) {
          const t = resolverLinhaRica(linha, pedido);
          if (!t) continue;
          por(t, {
            negrito: linha.negrito,
            tamanho: linha.tamanho,
            alinhamento: linha.alinhamento,
          });
        }
        break;
      }

      case "separador":
        por("-".repeat(colunas));
        break;

      case "espaco":
        por("");
        break;
    }
  }

  return saida;
}

/** "1x Esfirra Duo" à esquerda e "R$ 7,98" à direita, na mesma linha. */
function linhaComValor(esquerda: string, direita: string, colunas: number): string {
  if (!direita) return esquerda;
  const espaco = Math.max(1, colunas - esquerda.length - direita.length);
  if (espaco < 1) return `${esquerda} ${direita}`;
  return esquerda + " ".repeat(espaco) + direita;
}

/**
 * Uma linha já quebrada na largura certa, pronta para desenhar.
 *
 * `recuo` é medido em colunas NORMAIS, não nas colunas do tamanho da linha —
 * e é isso que faz o texto ampliado ficar centralizado de verdade. Ver
 * `linhasDoPapel`.
 */
export type LinhaRenderizada = {
  recuo: number;
  texto: string;
  tamanho: Tamanho;
  negrito?: boolean;
  /** Tarja de fundo preto, na largura inteira. */
  invertido?: boolean;
  /** Linha de QR: quem desenha mostra o código, não o texto. */
  qr?: string;
  /** De qual bloco esta linha saiu, e que palavra ela escreve (ver LinhaDaComanda). */
  bloco?: number;
  rotulo?: string;
  /**
   * Qual pedaço da frase original esta linha é (0 = o começo).
   *
   * A palavra editável está sempre no COMEÇO da frase, e a frase pode ter
   * quebrado em três linhas no papel. Sem saber qual pedaço é o primeiro, a
   * tela abriria a edição de "Endereco:" em cima do meio do endereço.
   */
  parte?: number;
};

/**
 * Quebra, alinha e devolve a comanda linha a linha.
 *
 * ── Por que o recuo é contado em colunas normais ───────────────────────────
 *
 * Uma letra em 2x ocupa o lugar de duas letras normais — inclusive o ESPAÇO.
 * Centralizar contando os espaços no mesmo tamanho do texto só consegue mexer
 * de dois em dois: "(79) DELIVERY #3523" tem 19 caracteres e cabem 24 em 2x,
 * então sobram 5 e a conta dá 2 de um lado e 3 do outro — que no papel viram
 * 4 e 6 colunas. O lojista pede centro e vê o texto encostado à esquerda, com
 * razão (relatado em 12/09/2026).
 *
 * Emitindo o recuo em colunas NORMAIS e só então ampliando o texto, sobram 10
 * colunas e dá 5 de cada lado: centro exato. A impressora aceita isso sem
 * truque nenhum — os espaços saem antes do comando de tamanho.
 */
export function linhasDoPapel(linhas: LinhaDaComanda[], colunas: number): LinhaRenderizada[] {
  const out: LinhaRenderizada[] = [];
  for (const l of linhas) {
    // `bloco` e `rotulo` atravessam a quebra: a frase que virou três linhas no
    // papel continua sendo a MESMA palavra editável, e clicar em qualquer
    // pedaço dela abre a mesma edição.
    const origem = { bloco: l.bloco, rotulo: l.rotulo };
    if (l.qr) {
      out.push({ ...origem, recuo: Math.max(0, Math.floor((colunas - 6) / 2)), texto: "[ QR ]", tamanho: 1, qr: l.qr });
      continue;
    }
    const n = tamanhoValido(l.tamanho);
    const partes = quebrar(l.texto, larguraDoTamanho(colunas, n));
    if (partes.length === 0) { out.push({ ...origem, recuo: 0, texto: "", tamanho: 1, parte: 0 }); continue; }
    partes.forEach((p, parte) => {
      const sobra = Math.max(0, colunas - p.length * n);
      const recuo =
        l.alinhamento === "centro" ? Math.floor(sobra / 2)
          : l.alinhamento === "direita" ? sobra
          : 0;
      // A tarja invertida ocupa a LARGURA INTEIRA: o recuo entra DENTRO dela,
      // senão o fundo preto sai deslocado do texto que ele deveria marcar.
      if (l.invertido) {
        const vaos = Math.max(0, larguraDoTamanho(colunas, n) - p.length);
        const antes =
          l.alinhamento === "centro" ? Math.floor(vaos / 2)
            : l.alinhamento === "direita" ? vaos
            : 0;
        out.push({
          ...origem,
          recuo: 0,
          texto: " ".repeat(antes) + p + " ".repeat(Math.max(0, vaos - antes)),
          tamanho: n,
          negrito: l.negrito,
          invertido: true,
          parte,
        });
        return;
      }
      out.push({ ...origem, recuo, texto: p, tamanho: n, negrito: l.negrito, parte });
    });
  }
  return out;
}

/**
 * A comanda como TEXTO puro. Serve para conferência em teste; a tela desenha
 * a partir de `linhasDoPapel`, porque texto plano não sabe mostrar a letra
 * ampliada — e foi justamente isso que fez a prévia parecer desalinhada.
 */
export function previaEmTexto(linhas: LinhaDaComanda[], colunas: number): string {
  return linhasDoPapel(linhas, colunas)
    .map((l) => " ".repeat(l.recuo) + l.texto)
    .join("\n");
}

/** Quebra por palavra, igual ao Assistente: a linha nunca é cortada no meio. */
function quebrar(texto: string, largura: number): string[] {
  const t = String(texto || "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  const w = Math.max(4, largura);
  const out: string[] = [];
  let atual = "";
  for (let palavra of t.split(" ")) {
    while (palavra.length > w) {
      if (atual) { out.push(atual); atual = ""; continue; }
      out.push(palavra.slice(0, w));
      palavra = palavra.slice(w);
    }
    if (!palavra) continue;
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (tentativa.length > w) { out.push(atual); atual = palavra; }
    else atual = tentativa;
  }
  if (atual) out.push(atual);
  return out;
}

/** Quantas colunas cabem na bobina. */
export function colunasDoPapel(paperWidth?: string | null, colunas?: number | null): number {
  if (colunas && colunas > 10) return colunas;
  return String(paperWidth || "80mm") === "58mm" ? 32 : 48;
}

/** Um pedido de mentira, para a tela de edição ter o que mostrar. */
export function pedidoDeExemplo(nomeDaLoja = "Sua Loja"): PedidoParaComanda {
  return {
    numero: 79,
    canal: "iFood",
    codigoCanal: "#3523",
    loja: nomeDaLoja,
    cliente: "Larissa Moreira",
    // O "CPF na nota": aparece na prévia para a loja ver a linha e poder
    // reescrever o rótulo dela, mesmo antes de o primeiro cliente pedir.
    documento: "529.982.247-25",
    telefone: "(22) 99999-1020",
    endereco: "Rua Dez, 59 - Costazul - Rio das Ostras",
    data: "12/09/2026",
    hora: "23:22",
    subtotal: 34.88,
    desconto: 12.99,
    taxaEntrega: 6.0,
    total: 27.87,
    pagamento: "Credito (Pago Online)",
    troco: 0,
    entregador: "Jefim Bahia",
    observacao: "Sem cebola, por favor",
    // Os campos da notinha do Frangoso: sem valor no exemplo, a prévia mostra
    // o bloco vazio e o lojista acha que o campo não funciona.
    localizador: "95610470",
    previsao: "23:43 - 23:53",
    taxaServico: 1.72,
    bandeira: "MASTER",
    quantidadeDeItens: 2,
    impressoEm: "12/09/2026 23:23:41",
    entregaParceira: null,
    itens: [
      { quantidade: 1, nome: "Esfirra Duo", preco: 7.98 },
      { quantidade: 1, nome: "3 Esfirras Doces", preco: 26.9, complementos: ["3x Chocolate Branco"], observacao: "caprichar no recheio" },
    ],
    qrMotoboy: "20260912-79",
    campanha: { valor: "VOCE GANHOU R$ 10", cupom: "VOLTA10", url: "https://firehubfood.com.br/loja/exemplo?cupom=VOLTA10" },
  };
}
