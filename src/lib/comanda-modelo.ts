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
  | "separador"
  | "espaco";

export type Bloco = {
  tipo: TipoDeBloco;
  /** Desligado não sai no papel. O bloco fica na lista para religar depois. */
  ligado: boolean;
  /** Título da seção, quando o bloco tem um ("CLIENTE", "ENTREGA"). Vazio = sem título. */
  titulo?: string;
  /** Só para `textoLivre`: aceita {cliente}, {endereco}, {total}… */
  texto?: string;
  negrito?: boolean;
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

/** Blocos que aceitam negrito, tamanho e alinhamento. */
export function aceitaFormato(tipo: TipoDeBloco): boolean {
  return !BLOCOS_DE_SECAO.includes(tipo) && tipo !== "separador" && tipo !== "espaco";
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
    { chave: "numeroNoParceiro", padrao: "N. do Pedido:", negritoPadrao: true },
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
  { chave: "telefone", rotulo: "Telefone" },
  { chave: "endereco", rotulo: "Endereço de entrega" },
  { chave: "data", rotulo: "Data" },
  { chave: "hora", rotulo: "Hora" },
  { chave: "total", rotulo: "Total do pedido" },
  { chave: "taxaEntrega", rotulo: "Taxa de entrega" },
  { chave: "pagamento", rotulo: "Forma de pagamento" },
  { chave: "entregador", rotulo: "Entregador" },
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
  return {
    versao: 1,
    cozinha: valida(m.cozinha, padrao.cozinha),
    completo: valida(m.completo, padrao.completo),
  };
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
      if (x.ocultarTaxaEntrega) saida.ocultarTaxaEntrega = true;
      if (x.tamanho && x.tamanho !== 1) saida.tamanho = x.tamanho;
      if (x.alinhamento && x.alinhamento !== "esquerda") saida.alinhamento = x.alinhamento;
      // Só viaja a palavra que a loja REESCREVEU. Mandar o texto de fábrica
      // junto engordaria o payload de toda comanda e, pior, congelaria o
      // padrão: o dia em que corrigirmos um rótulo de fábrica, a loja que
      // nunca o tocou continuaria imprimindo o antigo.
      const trocados = Object.entries(x.rotulos || {}).filter(
        ([chave, valor]) => String(valor ?? "").trim() !== "" && String(valor) !== rotuloPadrao(x.tipo, chave),
      );
      if (trocados.length) saida.rotulos = Object.fromEntries(trocados);
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
  opcoes: { semValores?: boolean } = {},
): Bloco[] | undefined {
  const bruto = (printerConfig as { comandaModelo?: unknown } | null)?.comandaModelo;
  if (!modeloFoiPersonalizado(bruto)) return undefined;
  const modelo = lerModelo(bruto);
  return blocosParaOAssistente(opcoes.semValores ? modelo.cozinha : modelo.completo);
}

// ── Prévia ──────────────────────────────────────────────────────────────────

/** Uma linha pronta para o papel: texto já quebrado na largura certa. */
export type LinhaDaComanda = {
  texto: string;
  negrito?: boolean;
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

export type PedidoParaComanda = {
  numero?: string | number | null;
  canal?: string | null;
  codigoCanal?: string | null;
  loja?: string | null;
  cliente?: string | null;
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
  /** Entrega do parceiro: o aviso de não mandar motoboy da loja. */
  entregaParceira?: { parceiro: string; codigoDeColeta?: string | null } | null;
  itens?: { quantidade: number; nome: string; preco?: number | null; observacao?: string | null; complementos?: string[] }[];
  qrMotoboy?: string | null;
  /** Campanha "trazer o cliente do marketplace para o site da loja". */
  campanha?: { valor?: string | null; cupom?: string | null; url?: string | null } | null;
};

const dinheiro = (v?: number | null) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

/** Substitui {campo} pelo valor do pedido. Campo desconhecido sai vazio. */
export function preencherCampos(texto: string, p: PedidoParaComanda): string {
  const campos: Record<string, string> = {
    numero: String(p.numero ?? ""),
    canal: p.canal || "",
    codigoCanal: p.codigoCanal || "",
    loja: p.loja || "",
    cliente: p.cliente || "",
    telefone: p.telefone || "",
    endereco: p.endereco || "",
    data: p.data || "",
    hora: p.hora || "",
    total: dinheiro(p.total),
    taxaEntrega: dinheiro(p.taxaEntrega),
    pagamento: p.pagamento || "",
    entregador: p.entregador || "",
  };
  return String(texto || "").replace(/\{(\w+)\}/g, (_, campo: string) => campos[campo] ?? "");
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
        if (!pedido.cliente && !pedido.telefone) break;
        titulo(bloco, "CLIENTE");
        if (pedido.cliente) por(`${R("nome")} ${pedido.cliente}`.trim(), { negrito: N("nome"), rotulo: "nome" });
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
    entregaParceira: null,
    itens: [
      { quantidade: 1, nome: "Esfirra Duo", preco: 7.98 },
      { quantidade: 1, nome: "3 Esfirras Doces", preco: 26.9, complementos: ["3x Chocolate Branco"], observacao: "caprichar no recheio" },
    ],
    qrMotoboy: "20260912-79",
    campanha: { valor: "VOCE GANHOU R$ 10", cupom: "VOLTA10", url: "https://firehubfood.com.br/loja/exemplo?cupom=VOLTA10" },
  };
}
