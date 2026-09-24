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

export type ImpressoraConfigurada = {
  name?: string | null;
  label?: string | null;
  categories?: string[] | null;
  copies?: number | null;
  paperWidth?: string | null;
  columns?: number | null;
  escposProfile?: string | null;
  modulos?: ModuloDePedido[] | null;
  somenteBebidas?: boolean | null;
  /** true = uma linha por unidade no papel desta impressora. */
  separarItens?: boolean | null;
  /** QR do motoboy no rodapé. Ausente = ligado (ver lib/qr-puxar.ts). */
  qrPuxar?: boolean | null;
  /** De quais lojas recebe (chaves de lib/loja-de-origem.ts). Vazio = todas. */
  lojas?: string[] | null;
};

type ItemDoPedido = {
  name?: string | null;
  category?: string | null;
  menuProduct?: { name?: string | null; category?: string | null } | null;
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
    if (!imp || imp.somenteBebidas === true) continue;
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
  if (filtrados.length > 0) return filtrados as T[];

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

/**
 * Para quais impressoras este pedido vai, já com os itens de cada uma.
 *
 * `impressoras` vazio devolve lista vazia: quem chama decide o que fazer sem
 * configuração — o navegador detecta a impressora padrão, a fila cai na antiga.
 */
export function destinosDoPedido<T extends ItemDoPedido>(
  impressoras: ImpressoraConfigurada[],
  pedido: { source?: unknown; items?: T[] | null }
): { impressora: ImpressoraConfigurada; itens: T[] }[] {
  // ── DE QUAL LOJA É ESTE PEDIDO ──
  // Três marcas no iFood no mesmo painel: a impressora da Ragnar Pizza não
  // quer a comanda da Ragnar Burguer. Filtro por categoria e por canal não
  // separam uma marca da outra — para eles é tudo "iFood". Nenhuma impressora
  // marcada para a loja deste pedido = todas continuam candidatas, em vez de
  // engolir o pedido (regra de lib/loja-de-origem.ts).
  const validas = impressorasDaLoja(
    (impressoras || []).filter((p) => p && texto(p.name)),
    pedido as PedidoComOrigem
  );

  // Deduplica pela impressora FÍSICA: duas linhas apontando para o mesmo nome
  // do Windows fariam o mesmo papel sair duas vezes.
  const vistas = new Set<string>();
  const unicas: ImpressoraConfigurada[] = [];
  for (const imp of validas) {
    const chave = texto(imp.name);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    unicas.push(imp);
  }

  // Quem pede o quê, entre as que de fato recebem este pedido.
  const modulo = moduloDoPedido(pedido?.source as any);
  const pedidas = categoriasPedidas(
    unicas.filter((imp) => impressoraAtendeModulo(imp.modulos as any, modulo)),
    pedido
  );

  const destinos: { impressora: ImpressoraConfigurada; itens: T[] }[] = [];
  for (const imp of unicas) {
    const itens = itensParaImpressora(imp, pedido, pedidas);
    if (itens === null) continue;
    destinos.push({ impressora: imp, itens });
  }

  return destinos;
}
