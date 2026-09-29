/**
 * OPÇÃO PAUSADA NÃO SE VENDE, EM CANAL NENHUM.
 *
 * Pausar uma opção de combo (o sabor que acabou, a lata que não chegou) é
 * desligar o produto por trás dela: `MenuProduct.active = false`. Desde
 * 27/09/2026 o painel faz isso com 1 clique, no próprio chip da opção dentro
 * do combo (ComplementosDoCombo, em components/admin/MenuProductManager.tsx).
 *
 * As telas de escolha já escondiam a opção pausada — o ComboModal do site, do
 * PDV e das mesas, e o totem. Faltavam as portas que GRAVAM:
 *   - o robô do WhatsApp lia as opções sem `active`: oferecia o sabor pausado
 *     e o lançava no pedido;
 *   - o POST do site e o do totem conferiam o PRODUTO (ativo, do dia), mas não
 *     a opção escolhida dentro dele. A vitrine é cacheada por 60 s, o totem
 *     fica horas com o cardápio aberto e o "Repetir pedido" traz as escolhas
 *     do pedido antigo — os três mandavam o sabor que acabou.
 *
 * Só `active === false` pausa. Opção lida sem a coluna continua valendo:
 * recusar o pedido inteiro por falta de um campo na consulta é pior do que o
 * que se quer evitar.
 */
import { adicionaisDetalhados, minimoExigidoDoGrupo, opcoesBloqueadasEscolhidas, type EscolhasDoCombo, type GrupoDeCombo, type ProdutoComCombo } from "./preco-combo";

export type OpcaoComEstado = {
  maxPerItem?: number | null;
  menuProduct?: { name?: string | null; active?: boolean | null } | null;
};

export type PerguntaComEstado = {
  id?: string;
  title?: string | null;
  maxQty?: number | null;
  minQty?: number | null;
  items?: OpcaoComEstado[] | null;
};

type ProdutoComPerguntas = { comboGroups?: PerguntaComEstado[] | null };

export function opcaoPausada(opcao: OpcaoComEstado | null | undefined): boolean {
  return opcao?.menuProduct?.active === false;
}

/**
 * O produto só com as opções que se podem escolher agora. Devolve o MESMO
 * objeto quando nada está pausado, que é o caso de quase todo produto.
 */
export function semOpcoesPausadas<T extends ProdutoComPerguntas>(produto: T): T {
  const grupos = produto?.comboGroups;
  if (!Array.isArray(grupos) || !grupos.some((g) => (g?.items || []).some(opcaoPausada))) return produto;
  return {
    ...produto,
    comboGroups: grupos.map((g) => ({ ...g, items: (g?.items || []).filter((i) => !opcaoPausada(i)) })),
  };
}

/**
 * A pergunta OBRIGATÓRIA que as pausas deixaram sem como fechar: as opções
 * ativas, cada uma até o teto dela, não somam o mínimo exigido. O combo fixo
 * "X-Burger + Batata + Coca" (exige 3, cada uma no máx 1) trava ao pausar só
 * a Coca, não apenas quando tudo está pausado. A conta do teto é a do
 * ComboModal: `maxPerItem` quando existe, senão o teto da pergunta.
 *
 * Pergunta sem nenhuma opção pausada não entra: se ela não fecha, não foi a
 * pausa que a travou, e o que acontece com ela continua como estava.
 */
export function perguntaTravadaPelaPausa(grupo: PerguntaComEstado | null | undefined): boolean {
  const itens = grupo?.items || [];
  if (!itens.some(opcaoPausada)) return false;
  const exigido = minimoExigidoDoGrupo(grupo as GrupoDeCombo);
  if (exigido <= 0) return false;
  const teto = Math.max(1, Number(grupo?.maxQty) || 1);
  const cabe = itens
    .filter((i) => !opcaoPausada(i))
    .reduce((s, i) => s + (Number(i.maxPerItem) > 0 ? Math.min(Number(i.maxPerItem), teto) : teto), 0);
  return cabe < exigido;
}

/** O título da primeira pergunta travada pela pausa, ou null se o produto fecha. */
export function produtoTravadoPelaPausa(produto: ProdutoComPerguntas | null | undefined): string | null {
  for (const g of produto?.comboGroups || []) {
    if (perguntaTravadaPelaPausa(g)) return String(g?.title || "").trim() || "pergunta sem título";
  }
  return null;
}

/**
 * O produto do cardápio do robô do WhatsApp, com o título da pergunta travada
 * em `perguntaTravadaPelaPausa` quando a pausa o travou.
 *
 * Nada sai da lista, como o esgotado: é por ela que o nome pedido casa com o
 * cadastro. Tirar a opção pausada dali quebrava o pedido JÁ ENVIADO com o
 * sabor de antes da pausa: na reescrita do "acrescenta uma Coca", o sabor não
 * casava, ia para a observação e o item era recobrado sem ele. O que o robô
 * OFERECE sai de `semOpcoesPausadas`; o que ele GRAVA é conferido na tag final.
 */
export function marcarTravadoPelaPausa<T extends ProdutoComPerguntas>(produto: T): T & { perguntaTravadaPelaPausa?: string } {
  const travada = produtoTravadoPelaPausa(produto);
  return travada ? { ...produto, perguntaTravadaPelaPausa: travada } : produto;
}

/**
 * As opções ESCOLHIDAS que estão pausadas, pelo nome.
 *
 * A escolha casa com a opção pelo mesmo caminho que a cobra
 * (`adicionaisDetalhados`): pelo grupo quando ele veio, senão pelo nome. Se o
 * grupo não existe mais (o formulário do combo recria as perguntas a cada
 * salvamento, e a sacola guardou o id antigo), vale o nome em qualquer
 * pergunta — como no preço. Nome que existe ativo em outra pergunta não
 * recusa: sem saber de qual veio, fica a favor do cliente.
 */
export function opcoesPausadasEscolhidas(
  produto: ProdutoComPerguntas | null | undefined,
  escolhas: EscolhasDoCombo
): string[] {
  const grupos = produto?.comboGroups || [];
  if (!grupos.some((g) => (g?.items || []).some(opcaoPausada))) return [];
  const pausadas: string[] = [];
  const paraCasar = { price: 0, comboGroups: grupos } as unknown as ProdutoComCombo;
  for (const e of adicionaisDetalhados(paraCasar, escolhas)) {
    const doGrupo = e.grupoId ? grupos.filter((g) => g?.id === e.grupoId) : [];
    const onde = doGrupo.length > 0 ? doGrupo : grupos;
    const mesmas = onde.flatMap((g) => g?.items || []).filter((i) => i?.menuProduct?.name === e.nome);
    if (mesmas.length > 0 && mesmas.every(opcaoPausada) && !pausadas.includes(e.nome)) pausadas.push(e.nome);
  }
  return pausadas;
}

export type ItemComEscolhas = { menuProductId?: string | null; comboSelections?: unknown };

export type PausaNaTag =
  | { tipo: "combo"; produto: string; pergunta: string }
  | { tipo: "opcao"; produto: string; opcoes: string[] };

/**
 * A tag final do robô escolheu algo pausado? Cada item é conferido contra o
 * cardápio do robô (o de `marcarTravadoPelaPausa`, com as pausadas dentro).
 *
 * Só conta o que é NOVO. Quando a tag reescreve um pedido JÁ ENVIADO, o
 * sabor que estava nele antes da pausa a loja já recebeu: recusá-lo travaria
 * o "acrescenta uma Coca". O combo travado que já estava no pedido também
 * passa, pelo mesmo motivo.
 */
export function pausaNaTagDoRobo(
  itens: ItemComEscolhas[],
  produtos: any[],
  enviado: ItemComEscolhas[] = []
): PausaNaTag | null {
  for (const i of itens || []) {
    const produto = (produtos || []).find((p) => p?.id && p.id === i?.menuProductId);
    if (!produto) continue;
    const nome = String(produto.name || "").split("|")[0].trim();
    const doEnviado = (enviado || []).filter((e) => e?.menuProductId === i.menuProductId);
    if (produto.perguntaTravadaPelaPausa && doEnviado.length === 0) {
      return { tipo: "combo", produto: nome, pergunta: String(produto.perguntaTravadaPelaPausa) };
    }
    // + a opção que outra escolha bloqueia (a meia pizza com a Pequena, Serpa).
    const barradas = (esc: EscolhasDoCombo) => [...opcoesPausadasEscolhidas(produto, esc), ...opcoesBloqueadasEscolhidas(produto, esc)];
    const jaEstavam = new Set(doEnviado.flatMap((e) => barradas(e.comboSelections as EscolhasDoCombo)));
    const novas = barradas(i.comboSelections as EscolhasDoCombo).filter((n) => !jaEstavam.has(n));
    if (novas.length > 0) return { tipo: "opcao", produto: nome, opcoes: novas };
  }
  return null;
}

/** O que o robô diz ao cliente quando a tag esbarra numa pausa. */
export function mensagemDaPausaNaTag(p: PausaNaTag): string {
  return p.tipo === "combo"
    ? `Poxa, o *${p.produto}* está indisponível agora — acabaram as opções de "${p.pergunta}". 😕 Quer trocar por outro item do cardápio?`
    : `Poxa, ${fraseDaOpcaoIndisponivel(p.produto, p.opcoes)} 😕 Quer escolher outra opção?`;
}

/** `"Calabresa" está indisponível agora em "Esfiha Combo".` — a frase da recusa. */
export function fraseDaOpcaoIndisponivel(produto: string, opcoes: string[]): string {
  const nomes = opcoes.map((n) => `"${n}"`);
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes.join("");
  return `${lista} ${nomes.length > 1 ? "estão indisponíveis" : "está indisponível"} agora em "${produto}".`;
}
