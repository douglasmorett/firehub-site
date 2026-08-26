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
};

type ItemDoPedido = {
  name?: string | null;
  category?: string | null;
  menuProduct?: { name?: string | null; category?: string | null } | null;
};

const texto = (v: unknown) => String(v ?? "").toLowerCase().trim();

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
 * Os itens que ESTA impressora deve imprimir deste pedido.
 *
 * Devolve `null` quando a impressora não deve imprimir NADA — hoje só acontece
 * quando ela não atende o módulo do pedido.
 */
export function itensParaImpressora<T extends ItemDoPedido>(
  impressora: ImpressoraConfigurada,
  pedido: { source?: unknown; items?: T[] | null }
): T[] | null {
  const itens = pedido?.items || [];
  const modulo: ModuloDePedido = moduloDoPedido(pedido?.source as any);

  if (!impressoraAtendeModulo(impressora.modulos as any, modulo)) return null;

  // Só bebida NÃO passa pelo filtro de categoria, e isso é o ponto: o combo tem
  // categoria "Combos", seria descartado, e a bebida de dentro dele nunca seria
  // encontrada. Vai o pedido inteiro; quem extrai a bebida é o Assistente, que
  // é onde mora a lista de palavras que definem bebida.
  if (impressora.somenteBebidas === true) return itens as T[];

  const categorias = (impressora.categories || []).filter(Boolean);
  if (categorias.length === 0) return itens as T[];

  if (casaComOCanal(impressora, pedido?.source)) return itens as T[];

  const filtrados = itens.filter((item) => {
    const cat = texto(item?.category ?? item?.menuProduct?.category);
    return categorias.some((c) => texto(c) === cat);
  });

  // Nenhum item casou — nome de categoria sutilmente diferente, item sem
  // categoria, cardápio importado. Imprime tudo em vez de engolir o pedido:
  // comanda que não sai é prejuízo, comanda a mais é papel.
  return (filtrados.length > 0 ? filtrados : itens) as T[];
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
  const validas = (impressoras || []).filter((p) => p && texto(p.name));

  // Deduplica pela impressora FÍSICA: duas linhas apontando para o mesmo nome
  // do Windows fariam o mesmo papel sair duas vezes.
  const vistas = new Set<string>();
  const destinos: { impressora: ImpressoraConfigurada; itens: T[] }[] = [];

  for (const imp of validas) {
    const chave = texto(imp.name);
    if (vistas.has(chave)) continue;
    vistas.add(chave);

    const itens = itensParaImpressora(imp, pedido);
    if (itens === null) continue;
    destinos.push({ impressora: imp, itens });
  }

  return destinos;
}
