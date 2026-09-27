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
import { impressorasParaAMesa, temImpressoraDoAndar, type AndarDaMesa } from "./andares-da-mesa";
import { isBeverageCategory, isBeverageName } from "./beverage";

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
  /** true = uma linha por unidade no papel desta impressora. */
  separarItens?: boolean | null;
  /** QR do motoboy no rodapé. Ausente = ligado (ver lib/qr-puxar.ts). */
  qrPuxar?: boolean | null;
  /** De quais lojas recebe (chaves de lib/loja-de-origem.ts). Vazio = todas. */
  lojas?: string[] | null;
};

type ItemDoPedido = {
  name?: string | null;
  productName?: string | null;
  category?: string | null;
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
  // vem para cá foi `impressorasPeloPedidoSoDeBebida`, e tudo nele é bebida.
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
  if (filtrados.length > 0) {
    const desta = new Set<unknown>(filtrados);
    return itens.filter((item) => desta.has(item) || semRotulo.includes(item)) as T[];
  }

  if (!pedidas) return itens as T[];

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

/** Um item do pedido é bebida por si só (não o combo que tem bebida dentro). */
function itemEhBebida(item: ItemDoPedido | null | undefined, source: unknown, palavrasDaLoja?: string | string[] | null): boolean {
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
 * Tira ou deixa só as impressoras de "pedido só de bebida".
 *
 *   - Pedido só de bebida, e alguma dessas atende o módulo dele: só elas.
 *   - Qualquer outro caso: todas MENOS elas — a do pedido só de bebida nunca
 *     recebe comida, nem parte de pedido com comida.
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
  return impressoras.filter((p) => p.pedidoSoDeBebida !== true);
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
  salao?: { andares?: AndarDaMesa[] | null; mesa?: unknown },
  /** As palavras de bebida da loja (printerConfig.customBeverageKeywords). */
  opcoes: { palavrasDeBebida?: string | string[] | null } = {}
): { impressora: ImpressoraConfigurada; itens: T[] }[] {
  // ── DE QUAL LOJA É ESTE PEDIDO ──
  // Três marcas no iFood no mesmo painel: a impressora da Ragnar Pizza não
  // quer a comanda da Ragnar Burguer. Filtro por categoria e por canal não
  // separam uma marca da outra — para eles é tudo "iFood". Nenhuma impressora
  // marcada para a loja deste pedido = todas continuam candidatas, em vez de
  // engolir o pedido (regra de lib/loja-de-origem.ts).
  // ── DE QUAL ANDAR É ESTA MESA ──
  // A impressora do térreo não recebe a comanda da mesa do segundo andar, e a
  // do andar da mesa recebe a MESA INTEIRA, sem o filtro de categoria dela.
  // Vem ANTES das categorias: o bar do outro andar não pode "pedir" a bebida
  // desta mesa e tirá-la da impressora deste andar.
  const daLoja = impressorasDaLoja(
    (impressoras || []).filter((p) => p && texto(p.name)),
    pedido as PedidoComOrigem
  );
  const andares = salao?.andares || [];
  const validas = impressorasParaAMesa(daLoja, andares, salao?.mesa);

  // Pedido só de bebida vai só para a impressora dele; os outros nunca vão.
  //
  // ANTES de deduplicar: a loja cadastra a MESMA impressora duas vezes — uma
  // como sempre foi, outra com "pedido só de bebida" (NIK, 27/09/2026). Com a
  // deduplicação primeiro, sobrava a linha que viesse antes na lista, e a
  // outra regra sumia calada: ou o refrigerante sozinho ia para a cozinha, ou
  // o balcão parava de receber o pedido com pizza.
  const candidatasComRepeticao = impressorasPeloPedidoSoDeBebida(validas, pedido, opcoes.palavrasDeBebida);

  // Deduplica pela impressora FÍSICA: duas linhas apontando para o mesmo nome
  // do Windows fariam o mesmo papel sair duas vezes.
  const semRepetir = (lista: ImpressoraConfigurada[]) => {
    const vistas = new Set<string>();
    const saida: ImpressoraConfigurada[] = [];
    for (const imp of lista) {
      const chave = texto(imp.name);
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      saida.push(imp);
    }
    return saida;
  };
  const candidatas = semRepetir(candidatasComRepeticao);

  // Quem pede o quê, entre as que de fato recebem este pedido. Com impressora
  // de andar recebendo a mesa inteira, a impressora do OUTRO andar também
  // conta como quem pediu: o drink do bar do piso de cima já sai na do térreo,
  // e não precisa ir de resgate para uma cozinha vazia.
  const modulo = moduloDoPedido(pedido?.source as any);
  const basePedidas = temImpressoraDoAndar(validas, andares, salao?.mesa) ? semRepetir(daLoja) : candidatas;
  const pedidas = categoriasPedidas(
    basePedidas.filter((imp) => impressoraAtendeModulo(imp.modulos as any, modulo)),
    pedido
  );

  const destinos: { impressora: ImpressoraConfigurada; itens: T[] }[] = [];
  for (const imp of candidatas) {
    const itens = itensParaImpressora(imp, pedido, pedidas);
    if (itens === null) continue;
    destinos.push({ impressora: imp, itens });
  }

  return destinos;
}
