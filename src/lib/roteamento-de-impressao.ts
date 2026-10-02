/**
 * /src/lib/roteamento-de-impressao.ts
 *
 * Regra única de "quais impressoras recebem este pedido, e com quais itens".
 *
 * Existiam DOIS caminhos de impressão no sistema, com capacidades diferentes:
 *
 *   1. O navegador (src/lib/print.ts) — usado pela tela de pedidos. Sabe rotear
 *      por categoria, por módulo e por "só bebida".
 *   2. A FILA DA NUVEM — usada pela mesa e pelo balcão. O pedido é criado no
 *      servidor e o Assistente puxa a fila sozinho. Este caminho não roteava
 *      nada: mandava tudo para `currentConfig.printer`, a impressora antiga.
 *
 * Por isso a comanda de mesa saía inteira na impressora do bar mesmo com "só
 * bebida" ligado, e por isso o filtro de categoria nunca valeu para a mesa —
 * duas telas configuradas do mesmo jeito, comportando-se diferente, sem nada
 * na interface explicando a diferença.
 *
 * Agora a decisão é tomada aqui, e os dois caminhos chamam esta função.
 */
import { moduloDoPedido, impressoraAtendeModulo, type ModuloDePedido } from "./modulo-do-pedido";
import { impressorasDaLoja, type PedidoComOrigem } from "./loja-de-origem";
import { CATEGORIAS_DE_INTEGRACAO } from "./cardapio-interno";
import { isBeverageCategory, isBeverageName } from "./beverage";
import { ehEntregaDaLoja } from "./qr-puxar";

export type ImpressoraConfigurada = {
  /** O id do cadastro — é por ele que o andar escolhe a impressora. */
  id?: string | null;
  name?: string | null;
  label?: string | null;
  categories?: string[] | null;
  copies?: number | null;
  paperWidth?: string | null;
  columns?: number | null;
  escposProfile?: string | null;
  modulos?: ModuloDePedido[] | null;
  somenteBebidas?: boolean | null;
  /**
   * Recebe o pedido que é SÓ bebida — e, quando recebe, as outras não. Pedido
   * com qualquer comida não vem para ela. Ver `impressorasPeloPedidoSoDeBebida`.
   */
  pedidoSoDeBebida?: boolean | null;
  /**
   * Com `pedidoSoDeBebida`: recebe TAMBÉM o pedido de comida com bebida — a
   * comanda inteira, a mesma da cozinha. Pedido só de comida continua fora.
   */
  pedidoComBebida?: boolean | null;
  /** true = uma linha por unidade no papel desta impressora. */
  separarItens?: boolean | null;
  /** QR do motoboy no rodapé. Ausente = ligado (ver lib/qr-puxar.ts). */
  qrPuxar?: boolean | null;
  /** Imprime também a via do entregador no delivery da loja (ver viaDoEntregador). */
  viaDoEntregador?: boolean | null;
  /** O modelo de comanda desta impressora (lib/comanda-modelo.ts). */
  modeloId?: string | null;
  /** De quais lojas recebe (chaves de lib/loja-de-origem.ts). Vazio = todas. */
  lojas?: string[] | null;
};

export type ItemDoPedido = {
  name?: string | null;
  productName?: string | null;
  category?: string | null;
  quantity?: number | null;
  qty?: number | null;
  /** O objeto de papel, quando este é o embrulho do navegador (lib/print.ts). */
  item?: Record<string, unknown> | null;
  /** As escolhas do combo com a categoria de cada uma (lib/categoria-do-item.ts). */
  opcoesParaImpressao?: { name: string; quantity: number; category: string }[] | null;
  isBeverage?: boolean | null;
  comboSelections?: unknown;
  menuProduct?: { name?: string | null; category?: string | null; isBeverage?: boolean | null } | null;
};

const texto = (v: unknown) => String(v ?? "").toLowerCase().trim();

/** Sem acento: "Jotajá" no chip, "JOTAJA" no source do pedido. */
const semAcento = (v: unknown) => texto(v).normalize("NFD").replace(/\p{M}/gu, "");

const categoriaDoItem = (item: ItemDoPedido | null | undefined) =>
  texto(item?.category ?? item?.menuProduct?.category);

/**
 * Categoria de ESPELHO de plataforma ("iFood", "99Food", "Brendi"...): diz de
 * onde o item veio, não o que ele é. Mesma lista de lib/categoria-do-item.ts,
 * que não dá para importar aqui porque puxa o Prisma e este arquivo roda
 * também no navegador.
 */
const DE_INTEGRACAO = new Set([...CATEGORIAS_DE_INTEGRACAO, "BRENDI", "WABIZ"].map(semAcento));

/** O nome não diz o que o item é: espelho de plataforma ou o próprio canal. */
const ehCategoriaDeOrigem = (categoria: string, source: unknown) => {
  const c = semAcento(categoria);
  return DE_INTEGRACAO.has(c) || (c !== "" && c === semAcento(source));
};

/**
 * A impressora está marcada com o CANAL do pedido em vez de uma categoria?
 *
 * "iFood" e "JotaJá" aparecem na mesma lista de chips que as categorias, mas
 * significam outra coisa: "esta impressora recebe o que vem daquela plataforma".
 * Casando o canal, o pedido inteiro vai — não se filtra item de pedido do iFood
 * por categoria.
 */
function casaComOCanal(impressora: ImpressoraConfigurada, source: unknown): boolean {
  const origem = texto(source);
  if (!origem) return false;
  return (impressora.categories || []).some((c) => {
    const alvo = texto(c);
    if (!alvo) return false;
    if (alvo === origem) return true;
    if (alvo === "jotajá" && origem === "jotaja") return true;
    return false;
  });
}

/**
 * As categorias que alguma impressora DESTE pedido pediu pelo nome.
 *
 * `impressoras` são só as que vão receber o pedido (já filtradas por loja e
 * por módulo): a cerveja de um pedido de delivery não é "do balcão" se o
 * balcão só atende o salão.
 *
 * Não entram: a impressora sem filtro (recebe tudo, não pede nada), a de "só
 * bebida" (recebe tudo e o Assistente separa) e o chip de PLATAFORMA. O item
 * espelhado do iFood tem categoria "iFood" — se o chip "iFood" de uma
 * impressora contasse como pedido, a cozinha deixaria de receber o pedido do
 * iFood inteiro.
 */
export function categoriasPedidas(
  impressoras: ImpressoraConfigurada[],
  pedido: { source?: unknown }
): Set<string> {
  const pedidas = new Set<string>();
  for (const imp of impressoras || []) {
    if (!imp || imp.somenteBebidas === true || imp.pedidoSoDeBebida === true) continue;
    for (const c of imp.categories || []) {
      const cat = texto(c);
      if (cat && !ehCategoriaDeOrigem(cat, pedido?.source)) pedidas.add(cat);
    }
  }
  return pedidas;
}

/**
 * Os itens que ESTA impressora deve imprimir deste pedido.
 *
 * Devolve `null` quando a impressora não deve imprimir NADA: não atende o
 * módulo do pedido, ou o pedido não tem nada dela.
 *
 * `pedidas` (de `categoriasPedidas`) é o que as OUTRAS impressoras do pedido
 * pediram. Sem ele, a regra é a antiga: nenhum item casou, imprime tudo.
 */
export function itensParaImpressora<T extends ItemDoPedido>(
  impressora: ImpressoraConfigurada,
  pedido: { source?: unknown; items?: T[] | null },
  pedidas?: Set<string>
): T[] | null {
  const modulo: ModuloDePedido = moduloDoPedido(pedido?.source as any);
  if (!impressoraAtendeModulo(impressora.modulos as any, modulo)) return null;
  return itensDaImpressora(impressora, pedido, pedidas);
}

/**
 * A linha de papel de UMA opção do combo, para a impressora da categoria dela:
 * "Suco de Morango Natural 500Ml  (do Combo Heimdall)", quantidade da opção ×
 * quantidade do combo, sem preço (ele já está no combo) e sem escolhas.
 * Funciona nos dois formatos: o item do banco (fila) e o embrulho do navegador
 * (`{ item, category, name }`, lib/print.ts), que leva o papel dentro de `item`.
 */
function linhaDaOpcao<T extends ItemDoPedido>(item: T, op: { name: string; quantity: number; category: string }): T {
  const pai = String(item.name ?? item.productName ?? item.menuProduct?.name ?? "combo").split(" | ")[0].trim() || "combo";
  const nome = `${op.name}  (do ${pai})`;
  const papel = (item.item || item) as Record<string, unknown>;
  const qtdDoPai = Number(papel.quantity ?? papel.qty ?? item.quantity ?? item.qty ?? 1) || 1;
  const n = qtdDoPai * op.quantity;
  const papelNovo = {
    ...papel,
    name: nome,
    productName: nome,
    quantity: n,
    qty: n,
    price: 0,
    comboSelections: null,
    opcoesParaImpressao: null,
    ...(papel.menuProduct && typeof papel.menuProduct === "object"
      ? { menuProduct: { ...(papel.menuProduct as Record<string, unknown>), name: nome, category: op.category, isBeverage: false } }
      : {}),
  };
  if (item.item) return { ...item, name: nome, category: op.category, opcoesParaImpressao: null, item: papelNovo, daOpcaoDoCombo: true } as T;
  return { ...item, ...papelNovo, category: op.category, daOpcaoDoCombo: true } as T;
}

/**
 * Quantos itens do PEDIDO esta impressora recebeu, para decidir a via do
 * entregador. A linha da opção do combo ("Fanta (do Combo Berserker)") não
 * conta: ela é só o aviso para a outra cozinha separar a bebida, e o pedido
 * fica pronto onde o combo é montado. Contando, o combo de burger com Fanta
 * empatava 1 a 1 com a cozinha da pizza e a via saía lá (Ragnar, #85,
 * 01/10/2026).
 */
export function itensQueContamParaAVia(itens: unknown[] | null | undefined): number {
  return (itens || []).filter((i) => !(i as { daOpcaoDoCombo?: boolean } | null)?.daOpcaoDoCombo).length;
}

/**
 * O filtro por categoria, sem olhar o módulo. É a parte que o navegador
 * (lib/print.ts) usa: ele escolhe as impressoras do módulo por conta própria,
 * com o resgate de "nenhuma impressora deste módulo = todas".
 */
export function itensDaImpressora<T extends ItemDoPedido>(
  impressora: ImpressoraConfigurada,
  pedido: { source?: unknown; items?: T[] | null },
  pedidas?: Set<string>
): T[] | null {
  const itens = pedido?.items || [];

  // A do pedido só de bebida recebe o pedido inteiro: quem decidiu que ele
  // vem para cá foi `impressorasPeloPedidoSoDeBebida` — ou tudo nele é
  // bebida, ou é comida com bebida e ela está marcada para receber esse
  // também (a mesma comanda da cozinha).
  if (impressora.pedidoSoDeBebida === true) return itens as T[];

  // Só bebida NÃO passa pelo filtro de categoria, e isso é o ponto: o combo tem
  // categoria "Combos", seria descartado, e a bebida de dentro dele nunca seria
  // encontrada. Vai o pedido inteiro; quem extrai a bebida é o Assistente, que
  // é onde mora a lista de palavras que definem bebida.
  if (impressora.somenteBebidas === true) return itens as T[];

  const categorias = (impressora.categories || []).filter(Boolean);
  if (categorias.length === 0) return itens as T[];

  if (casaComOCanal(impressora, pedido?.source)) return itens as T[];

  const filtrados = itens.filter((item) => {
    const cat = categoriaDoItem(item);
    return categorias.some((c) => texto(c) === cat);
  });

  // ── O ITEM QUE O SISTEMA NÃO SABE O QUE É SAI EM TODAS ──
  //
  // Item sem categoria, ou com a categoria da PLATAFORMA (o combo do iFood que
  // não casou com nenhum produto real, ver lib/categoria-do-item.ts): ninguém
  // sabe se é burger ou pizza, então ele sai em toda impressora que recebe o
  // pedido — inclusive na que já tem item seu. Antes só saía nas que ficariam
  // vazias: com a categoria real ligada na impressão (27/09/2026), a "Coca"
  // casada iria para o bar e o "Combo X-Bacon" não casado sairia SÓ no bar,
  // nunca na cozinha. Comanda a mais é papel; comanda que não sai é prejuízo.
  const semRotulo = itens.filter((item) => {
    const cat = categoriaDoItem(item);
    return !cat || ehCategoriaDeOrigem(cat, pedido?.source);
  });

  // ── A OPÇÃO DO COMBO SAI NA IMPRESSORA DA CATEGORIA DELA ──
  //
  // "Combo Heimdall" é da cozinha do burger, mas o suco escolhido dentro dele
  // é feito na cozinha da pizza (Ragnar, 27/09/2026). A impressora que pediu
  // a categoria da opção recebe uma linha própria — "Suco de Morango (do
  // Combo Heimdall)" — e a cozinha do combo continua recebendo o combo inteiro.
  // Só quando o combo NÃO sai nesta impressora: se sai, a opção já vem dentro.
  const noPapel = new Set<unknown>(filtrados);
  const dasOpcoes: T[] = [];
  for (const item of itens) {
    if (noPapel.has(item)) continue;
    for (const op of item.opcoesParaImpressao || []) {
      if (categorias.some((c) => texto(c) === texto(op.category))) dasOpcoes.push(linhaDaOpcao(item, op));
    }
  }

  if (filtrados.length > 0) {
    return [...itens.filter((item) => noPapel.has(item) || semRotulo.includes(item)), ...dasOpcoes] as T[];
  }

  if (!pedidas) return itens as T[];
  if (dasOpcoes.length > 0) return dasOpcoes;

  // ── NENHUM ITEM É DESTA IMPRESSORA ──
  //
  // Imprimia o pedido inteiro, sempre. Na Ragnar Burger (24/09/2026) isso
  // punha na impressora do BAR (Drinks, Refrigerantes) a comanda inteira de
  // todo pedido sem bebida — burger, batata, pastel —, e no balcão a de todo
  // pedido sem cerveja: a divisão por categoria só valia quando o pedido
  // tinha item daquela impressora.
  //
  // O resgate existe para o item que NENHUMA impressora pediu: o espelho do
  // iFood (categoria "iFood"), a categoria criada depois de configurar as
  // impressoras, o item sem categoria. Esse continua saindo aqui — comanda
  // que não sai é prejuízo, comanda a mais é papel. O item que outra
  // impressora já leva não vem para esta.
  const deNinguem = itens.filter((item) => {
    const cat = categoriaDoItem(item);
    return !cat || ehCategoriaDeOrigem(cat, pedido?.source) || !pedidas.has(cat);
  });
  return deNinguem.length > 0 ? (deNinguem as T[]) : null;
}

/**
 * O que ficou FORA desta impressora: quantos itens e quanto valem.
 *
 * A impressora que recebe só as suas categorias imprime o total do pedido
 * inteiro, e a diferença caía na conta do desconto do Assistente como
 * "Outros valores do pedido: R$ 36,00" — os dois sucos que foram para a outra
 * cozinha, na comanda de mesa da Ragnar Burger (24/09/2026). Com isto o
 * Assistente 1.2.24 imprime "Em outra impressora (2 itens): R$ 36,00" e a
 * conta do papel volta a fechar. Assistente antigo ignora o campo.
 *
 * `desta` tem de ser um recorte de `todos` (os mesmos objetos), que é o que
 * `itensParaImpressora` e o filtro do navegador devolvem. Nada ficou de fora
 * (ou o que ficou não tem preço) = `undefined`, e o campo nem viaja.
 */
export function restoDoPedido(
  todos: ReadonlyArray<unknown> | null | undefined,
  desta: ReadonlyArray<unknown> | null | undefined
): { itens: number; valor: number } | undefined {
  const aqui = new Set(desta || []);
  let itens = 0;
  let centavos = 0;
  for (const item of todos || []) {
    if (aqui.has(item)) continue;
    const i = (item || {}) as { quantity?: unknown; qty?: unknown; price?: unknown };
    const qtd = Math.max(1, Math.round(Number(i.quantity ?? i.qty) || 1));
    itens += qtd;
    centavos += Math.round((Number(i.price) || 0) * qtd * 100);
  }
  return itens > 0 && centavos > 0 ? { itens, valor: centavos / 100 } : undefined;
}

/* ── PEDIDO SÓ DE BEBIDA ───────────────────────────────────────────────────
 *
 * NIK Pizzas (27/09/2026): refrigerante vendido sozinho no balcão tem de sair
 * na impressora do balcão; pedido com pizza e refrigerante sai INTEIRO na
 * cozinha. Nenhuma das opções que existiam fazia isso:
 *   - "só bebida" puxa as bebidas de TODO pedido, e o refrigerante do pedido
 *     com pizza ia para o balcão, separado da pizza;
 *   - categoria "Bebidas" na impressora do balcão faz o mesmo;
 *   - e a cozinha, sem filtro, recebia também o refrigerante sozinho.
 * A decisão aqui é sobre o PEDIDO, não sobre o item: todo ele é bebida?
 *
 * Na dúvida o item NÃO é bebida — o erro manda a comanda para a cozinha, que
 * é como a loja imprimia até hoje, e nunca tira a comida da cozinha. */

/**
 * Um item do pedido é bebida por si só (não o combo que tem bebida dentro).
 * Exportada para a opção "não imprimir as bebidas da mesa"
 * (lib/bebida-da-mesa.ts), que tem de usar ESTA definição de bebida — e não
 * uma segunda lista que um dia discorda desta.
 */
export function itemEhBebida(item: ItemDoPedido | null | undefined, source: unknown, palavrasDaLoja?: string | string[] | null): boolean {
  if (!item) return false;
  if (item.isBeverage === true || item.menuProduct?.isBeverage === true) return true;

  const categoria = String(item.category ?? item.menuProduct?.category ?? "").trim();
  // A categoria da loja decide: "Refrigerantes" é bebida, "Combos" não é —
  // nem o "Combo Pizza + Coca", que tem coca no nome.
  if (categoria && !ehCategoriaDeOrigem(categoria, source)) return isBeverageCategory(categoria);

  // Sem categoria (ou só o espelho da plataforma): pelo nome, e nunca o que
  // tem cara de combo ("Pizza + Coca 2L").
  const nome = String(item.name ?? item.productName ?? item.menuProduct?.name ?? "");
  if (/\bcombo\b|\+/i.test(nome)) return false;
  return isBeverageName(nome, palavrasDaLoja || undefined);
}

/** Todos os itens do pedido são bebida? Pedido vazio não é. */
export function pedidoEhSoBebida(
  pedido: { source?: unknown; items?: ItemDoPedido[] | null },
  palavrasDaLoja?: string | string[] | null
): boolean {
  const itens = pedido?.items || [];
  return itens.length > 0 && itens.every((item) => itemEhBebida(item, pedido?.source, palavrasDaLoja));
}

/**
 * Alguma bebida no pedido: item que é bebida, ou bebida escolhida dentro do
 * combo — a Coca do "Combo Pizza G + Coca 2L", quando a escolha casa com um
 * produto da loja de categoria de bebida (`opcoesParaImpressao`, de
 * lib/categoria-do-item.ts). O combo em si continua sendo comida.
 */
export function pedidoTemBebida(
  pedido: { source?: unknown; items?: ItemDoPedido[] | null },
  palavrasDaLoja?: string | string[] | null
): boolean {
  return (pedido?.items || []).some(
    (item) =>
      itemEhBebida(item, pedido?.source, palavrasDaLoja) ||
      (item?.opcoesParaImpressao || []).some((op) =>
        itemEhBebida({ name: op.name, category: op.category }, pedido?.source, palavrasDaLoja)
      )
  );
}

/**
 * Tira ou deixa só as impressoras de "pedido só de bebida".
 *
 *   - Pedido só de bebida, e alguma dessas atende o módulo dele: só elas.
 *   - Comida com bebida: as de sempre, e também a marcada com
 *     `pedidoComBebida` (NIK, 30/09/2026: a pizza com refrigerante sai inteira
 *     na cozinha E no balcão, que é onde se separa a bebida).
 *   - Qualquer outro caso: todas MENOS elas — a do pedido só de bebida nunca
 *     recebe o pedido só de comida.
 *
 * O módulo é o que limita a regra: a do balcão marcada só em "Salão" pega o
 * refrigerante do balcão e da mesa; o refrigerante sozinho do iFood continua
 * na impressora do delivery.
 */
export function impressorasPeloPedidoSoDeBebida<P extends ImpressoraConfigurada>(
  impressoras: P[],
  pedido: { source?: unknown; items?: ItemDoPedido[] | null },
  palavrasDaLoja?: string | string[] | null
): P[] {
  const modulo = moduloDoPedido(pedido?.source as any);
  const deBebida = impressoras.filter((p) => p.pedidoSoDeBebida === true && impressoraAtendeModulo(p.modulos as any, modulo));
  if (deBebida.length > 0 && pedidoEhSoBebida(pedido, palavrasDaLoja)) return deBebida;
  const comBebida = deBebida.some((p) => p.pedidoComBebida === true) && pedidoTemBebida(pedido, palavrasDaLoja);
  return impressoras.filter(
    (p) => p.pedidoSoDeBebida !== true || (comBebida && p.pedidoComBebida === true && deBebida.includes(p))
  );
}

/**
 * Uma linha por impressora FÍSICA (o nome do Windows): duas linhas com o
 * mesmo nome fariam o mesmo papel sair duas vezes. Fica a primeira da lista —
 * menos quando a outra linha da mesma impressora é a de "pedido só de bebida".
 * Essa só chega aqui quando o pedido é dela (`impressorasPeloPedidoSoDeBebida`)
 * e leva o pedido INTEIRO; a linha comum levaria um pedaço dele, ou nada. A NIK
 * tem a EPSON do balcão em duas linhas (30/09/2026): com a primeira vencendo,
 * a pizza com refrigerante não sairia no balcão.
 */
export function umaPorImpressora<P extends ImpressoraConfigurada>(lista: P[]): P[] {
  const saida: P[] = [];
  const posicao = new Map<string, number>();
  for (const imp of lista) {
    const chave = texto(imp?.name);
    if (!chave) continue;
    const ondeEsta = posicao.get(chave);
    if (ondeEsta === undefined) {
      posicao.set(chave, saida.length);
      saida.push(imp);
    } else if (imp.pedidoSoDeBebida === true && saida[ondeEsta].pedidoSoDeBebida !== true) {
      saida[ondeEsta] = imp;
    }
  }
  return saida;
}

/**
 * Para quais impressoras este pedido vai, já com os itens de cada uma.
 *
 * `impressoras` vazio devolve lista vazia: quem chama decide o que fazer sem
 * configuração — o navegador detecta a impressora padrão, a fila cai na antiga.
 * `palavrasDeBebida` são as da loja (printerConfig.customBeverageKeywords).
 */
export function destinosDoPedido<T extends ItemDoPedido>(
  impressoras: ImpressoraConfigurada[],
  pedido: { source?: unknown; items?: T[] | null },
  /** Andares do salão e o número da mesa deste pedido (lib/andares-da-mesa.ts). */
  /** As palavras de bebida da loja (printerConfig.customBeverageKeywords). */
  opcoes: { palavrasDeBebida?: string | string[] | null } = {}
): { impressora: ImpressoraConfigurada; itens: T[] }[] {
  // ── DE QUAL LOJA É ESTE PEDIDO ──
  // Três marcas no iFood no mesmo painel: a impressora da Ragnar Pizza não
  // quer a comanda da Ragnar Burguer. Filtro por categoria e por canal não
  // separam uma marca da outra — para eles é tudo "iFood". Nenhuma impressora
  // marcada para a loja deste pedido = todas continuam candidatas, em vez de
  // engolir o pedido (regra de lib/loja-de-origem.ts).
  // Os ANDARES do salão (lib/andares-da-mesa.ts) não entram aqui: eles
  // decidem onde sai a CONTA da mesa, não a comanda da cozinha. A versão que
  // mandava a mesa inteira para a impressora do andar durou uma tarde
  // (27/09/2026): na Ragnar, todo pedido de mesa passou a sair também no
  // balcão ou no bar do andar — "deveria imprimir só no burger".
  const validas = impressorasDaLoja(
    (impressoras || []).filter((p) => p && texto(p.name)),
    pedido as PedidoComOrigem
  );

  // Pedido só de bebida vai só para a impressora dele; os outros nunca vão.
  //
  // ANTES de deduplicar: a loja cadastra a MESMA impressora duas vezes — uma
  // como sempre foi, outra com "pedido só de bebida" (NIK, 27/09/2026). Com a
  // deduplicação primeiro, sobrava a linha que viesse antes na lista, e a
  // outra regra sumia calada: ou o refrigerante sozinho ia para a cozinha, ou
  // o balcão parava de receber o pedido com pizza.
  const candidatasComRepeticao = impressorasPeloPedidoSoDeBebida(validas, pedido, opcoes.palavrasDeBebida);

  // Deduplica pela impressora FÍSICA (ver `umaPorImpressora`).
  const candidatas = umaPorImpressora(candidatasComRepeticao);

  // ── DE QUE MUNDO É ESTE PEDIDO ──
  // Nenhuma impressora marcada para este mundo = todas atendem. É o resgate
  // que o navegador (lib/print.ts) sempre teve e a fila da nuvem não tinha:
  // loja com todas as impressoras em "Balcão e mesa" recebia o delivery do
  // robô e do site pelo painel roteado por categoria, e pela fila com
  // `destinos` vazio — uma via só, na impressora padrão do Assistente, sem a
  // cozinha. O mesmo pedido saía de dois jeitos conforme houvesse aba aberta.
  const modulo = moduloDoPedido(pedido?.source as any);
  const doModulo = candidatas.filter((imp) => impressoraAtendeModulo(imp.modulos as any, modulo));
  const atendem = doModulo.length > 0 ? doModulo : candidatas;

  // Quem pede o quê, entre as que de fato recebem este pedido.
  const pedidas = categoriasPedidas(atendem, pedido);

  const destinos: { impressora: ImpressoraConfigurada; itens: T[] }[] = [];
  for (const imp of atendem) {
    const itens = itensDaImpressora(imp, pedido, pedidas);
    if (itens === null) continue;
    destinos.push({ impressora: imp, itens });
  }

  return destinos;
}

/** O sufixo do id da via do entregador (ver `viaDoEntregador`). */
export const SUFIXO_DA_VIA_DO_ENTREGADOR = "-via-entregador";

/**
 * Em qual impressora sai a VIA DO ENTREGADOR deste pedido — ou `null`.
 *
 * Pedido da Ragnar (Fabiano, 27/09/2026): "queria que saísse a resumida, a
 * ordem de serviço, e a nota do motoboy com QR code". A cozinha trabalha com a
 * comanda resumida (modelo "Cozinha sem valores"), e o motoboy precisa de um
 * papel completo — endereço, valores, pagamento, troco e o QR para puxar o
 * pedido no app. Uma impressora só tem um modelo, então a via do entregador é
 * um papel A MAIS, com o pedido inteiro, na impressora marcada para isso.
 *
 * Só no delivery da própria loja (lib/qr-puxar.ts, ehEntregaDaLoja) e numa
 * impressora só, entre as marcadas que atendem a loja e o mundo do pedido.
 *
 * Qual delas: a que RECEBEU MAIS ITENS deste pedido (`recebem`, os destinos
 * com a contagem). A Ragnar marcou a da pizza e a do hambúrguer (28/09/2026):
 * o pedido de pizza tira a via na pizza, o de hambúrguer no hambúrguer — é
 * onde o pedido fica pronto e o motoboy retira. Antes saía sempre na primeira
 * marcada, e o hambúrguer tirava a via na impressora da pizza. "Mais itens" e
 * não "recebeu algum" porque Refrigerantes está nas duas: o hambúrguer com
 * Coca também passa pela pizza, e é a comida que desempata. Empate (ou pedido
 * que passou pelas duas por igual) = uma via só, na primeira da lista. Nenhuma
 * marcada recebeu nada, ou quem chama não sabe dos destinos = a primeira marcada.
 */
export function impressoraDaViaDoEntregador<T extends ImpressoraConfigurada>(
  impressoras: T[] | null | undefined,
  pedido: PedidoComOrigem & { source?: unknown; deliveryType?: string | null },
  recebem?: { nome: string | null | undefined; itens: number }[]
): T | null {
  if (!ehEntregaDaLoja(pedido as any)) return null;
  const daLoja = impressorasDaLoja((impressoras || []).filter((p) => p && texto(p.name)), pedido);
  const modulo = moduloDoPedido(pedido?.source as any);
  const doModulo = daLoja.filter((imp) => impressoraAtendeModulo(imp.modulos as any, modulo));
  const candidatas = doModulo.length > 0 ? doModulo : daLoja;
  const marcadas = candidatas.filter((imp) => imp.viaDoEntregador === true);
  const itensDe = (imp: T) =>
    (recebem || []).reduce((n, r) => (texto(r.nome).toLowerCase() === texto(imp.name).toLowerCase() ? n + (Number(r.itens) || 0) : n), 0);
  let escolhida: T | null = marcadas[0] || null;
  let maior = 0;
  for (const imp of marcadas) {
    const n = itensDe(imp);
    if (n > maior) { maior = n; escolhida = imp; }
  }
  return escolhida;
}
