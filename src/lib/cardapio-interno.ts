/**
 * /src/lib/cardapio-interno.ts
 *
 * Regra única de "o que é o cardápio PRÓPRIO da loja".
 *
 * A loja tem dois tipos de produto no mesmo banco:
 *
 *   1. o cardápio dela, cadastrado no painel;
 *   2. o espelho do catálogo das integrações (iFood, JotaJá), que entra pela
 *      sincronização só para o pedido de fora conseguir casar item com preço.
 *
 * O espelho não pode aparecer para quem atende: o balconista não vende pelo
 * iFood, o garçom não lança pelo iFood, e o cliente no totem muito menos. Ele
 * existe só para o pedido que chega pronto da plataforma.
 *
 * Por que virou arquivo: a exclusão estava escrita à mão dentro de
 * `api/admin/menu-products/route.ts` comparando com `["IFOOD", "JOTAJA", ...]`
 * em CAIXA ALTA — e a categoria gravada pela sincronização é `"iFood"`. O `in`
 * do Prisma no PostgreSQL diferencia maiúscula de minúscula, então o filtro
 * passava direto: dos 94 produtos ativos da Hakim Centro, os 94 chegavam ao PDV,
 * 36 deles espelho do iFood. O atendente rolava a lista passando por duplicata.
 *
 * Com uma função só, o dia que entrar outra integração é uma linha aqui.
 */

/**
 * Categorias que a sincronização usa para o espelho das plataformas.
 * Comparadas SEM diferenciar maiúscula de minúscula — foi exatamente essa
 * diferença que fez o filtro antigo não filtrar nada.
 */
export const CATEGORIAS_DE_INTEGRACAO = ["IFOOD", "JOTAJA", "JOTAJÁ", "ONLINE", "99FOOD"];

/**
 * Prefixos de `id` que só o espelho tem. A categoria sozinha não basta:
 *
 *   - o importador antigo do JotaJá gravava a categoria do item ("Esfirras")
 *     em vez do canal, e o espelho ia parar no meio do cardápio próprio;
 *   - o reparo de agosto/2026 (`scratch/fast_restore_kds.js`) criou um
 *     `restored-prod-<itemId>` para cada item de pedido órfão, usando o
 *     `source` do PEDIDO como categoria — daí a categoria "PRESENCIAL"
 *     aparecendo no painel com dois "Item Integrado" a R$ 1,90.
 *
 * Essas linhas não podem ser apagadas (são o nome do item em pedido antigo no
 * KDS e na impressão), mas também não são cardápio. O id é o que não mente:
 * quem cria espelho sempre carimba um prefixo próprio.
 */
export const PREFIXOS_DE_ESPELHO = ["ifood-", "jotaja-", "brendi-", "99food_", "restored-prod-"];

/**
 * Trecho de `where` do Prisma que remove o espelho das integrações.
 * Use em todo canal interno: PDV, mesa, totem, KDS.
 */
/**
 * ── O prefixo sozinho condenava cardápio de verdade ────────────────────────
 *
 * O id `ifood-…` dizia "isto é espelho" e bastava para sumir com o produto de
 * TODA tela de venda. Só que o espelho não fica espelho para sempre: quando o
 * cardápio da loja é IMPORTADO do sistema antigo, a importação reaproveita
 * esses mesmos ids. O produto ganha categoria própria, vira combo, recebe os
 * grupos e o preço — e segue carregando um id que nasceu de um pedido.
 *
 * Foi assim na Pastelaria da Paulista: o cardápio dela foi lançado por
 * importação, não montado à mão em cima de espelho.
 *
 * Ou seja: o prefixo diz como o registro NASCEU, não o que ele É hoje.
 *
 * Medido na Pastelaria da Paulista, em produção, pelo `?diagnostico=1`: dos 70
 * produtos que este filtro derrubava, 43 tinham id com prefixo `ifood-` e
 * **nenhum deles tinha categoria de integração**. 40 estavam ATIVOS e 38 eram
 * COMBO, com categoria real — "Pastel de Carne moída" em Pastéis de carne,
 * "Costela com mussarela", "Batata M", "Caldo verde", "Bobó de camarão".
 * Era o cardápio da loja inteiro, invisível na mesa, no balcão, no totem e no
 * cardápio online. Foi a queixa "muitos sabores de pastel não aparecem".
 *
 * ── Por que a categoria basta ──────────────────────────────────────────────
 *
 * Espelho NOVO nasce com `category: "iFood"` e os quatro canais em false
 * (src/lib/ifood-itens.ts) — a regra de categoria já o pega, e o prefixo não
 * acrescenta nada. O mesmo vale para o 99Food (`category: "99Food"`).
 *
 * Então o prefixo passa a excluir apenas o espelho que CONTINUA inativo, isto
 * é, o que ninguém adotou. Produto ativo, com categoria própria, é cardápio —
 * não importa como o id dele nasceu.
 *
 * A assimetria é deliberada: deixar escapar um espelho antigo custa uma linha
 * a mais na tela, que o lojista apaga; esconder 43 itens ativos custou venda,
 * em silêncio, por tempo indeterminado.
 */
export const SEM_PRODUTO_DE_INTEGRACAO = {
  NOT: [
    { category: { in: CATEGORIAS_DE_INTEGRACAO, mode: "insensitive" as const } },
    ...PREFIXOS_DE_ESPELHO.map((prefixo) => ({
      AND: [{ id: { startsWith: prefixo } }, { active: false }],
    })),
  ],
};

/**
 * Versão para filtrar em memória, quando os produtos já vieram do banco.
 * O `id` é opcional para não quebrar quem só tem a categoria em mãos.
 *
 * O prefixo obedece à MESMA regra do `where` acima: sozinho ele não condena —
 * só condena espelho que ninguém adotou, isto é, com `ativo === false`
 * explícito. Esta função dizia o contrário (prefixo bastava) e era exatamente
 * a versão antiga da regra que o comentário acima manda não usar; as telas de
 * mesa e balcão tinham cópias dela e esconderam 8 dos 13 pastéis de carne da
 * Pastelaria da Paulista. Quem não sabe se o produto está ativo não passa o
 * terceiro argumento — e aí só a categoria decide, que é o lado seguro.
 */
export function ehProdutoDeIntegracao(
  categoria: string | null | undefined,
  id?: string | null,
  ativo?: boolean | null
): boolean {
  if (id && ativo === false && PREFIXOS_DE_ESPELHO.some((prefixo) => id.startsWith(prefixo))) return true;
  if (!categoria) return false;
  return CATEGORIAS_DE_INTEGRACAO.includes(categoria.trim().toUpperCase());
}

/**
 * Dia da semana em São Paulo, no formato que `availableDays` grava.
 *
 * `new Date().getDay()` responde pelo fuso do servidor, que roda em UTC. Depois
 * das 21h de Brasília o servidor já virou o dia: a promoção de sexta sumia do
 * cardápio às 21h de quinta e continuava no ar até as 21h de sexta.
 */
export function diaDaSemanaEmSaoPaulo(ref: Date = new Date()): string {
  const sigla = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(ref);

  const mapa: Record<string, string> = {
    Sun: "DOM", Mon: "SEG", Tue: "TER", Wed: "QUA", Thu: "QUI", Fri: "SEX", Sat: "SAB",
  };
  return mapa[sigla] ?? "DOM";
}

/**
 * O produto está disponível hoje?
 *
 * `availableDays` é um JSON com as siglas dos dias. Ausente, vazio ou ilegível
 * significa "todo dia" — nunca esconder produto por causa de campo mal gravado.
 */
export function disponivelHoje(availableDays: unknown, hoje = diaDaSemanaEmSaoPaulo()): boolean {
  if (!availableDays) return true;
  try {
    const dias = typeof availableDays === "string" ? JSON.parse(availableDays) : availableDays;
    if (!Array.isArray(dias) || dias.length === 0) return true;
    return dias.includes(hoje);
  } catch {
    return true;
  }
}

/**
 * IDs dos produtos que existem SÓ para ser opção dentro de um combo.
 *
 * "4 Nuggets", "Adicional de Catupiry", "Adicional carne seca": para o banco
 * são MenuProduct como qualquer outro, porque é assim que um ComboGroupItem
 * aponta para eles. Mas ninguém vende um "Adicional de Catupiry" avulso — ele
 * só faz sentido dentro da pergunta do combo que o oferece.
 *
 * Sem esta regra eles apareciam como card no cardápio do garçom, todos a
 * R$ 0,00, empurrando o cardápio de verdade para baixo. Pior: lançar um deles
 * somava zero na comanda — o garçom achava que tinha lançado o adicional e o
 * cliente levava de graça.
 *
 * ── Por que NÃO se exige mais que ele esteja dentro de um combo ────────────
 *
 * Exigia-se, e isso deixava passar o pior caso. Medido na Pastelaria da
 * Paulista, em produção: dos 101 itens da categoria "Adicionais", só 55
 * estavam vinculados a algum combo. Os outros 46 — "Catupiry", "Bacon",
 * "Banana", "Cheddar" — não estavam em combo nenhum, escapavam da regra e
 * viravam card de R$ 0,00 no cardápio do garçom. Era a queixa "esses
 * complementos não têm que aparecer".
 *
 * E a condição nunca protegeu nada: um item sem preço em canal algum e sem
 * grupo próprio NÃO PODE ser lançado numa comanda — somaria zero. Estar ou
 * não dentro de um combo não muda isso.
 *
 * Duas condições, e as duas importam:
 *   1. ele não tem grupos próprios — senão seria um combo vendável, e há
 *      combo de preço base R$ 0,00 cujo valor inteiro está nas opções (o
 *      "Nugget" da Hakim, e todo o cardápio da Paulista). Esse precisa
 *      continuar à venda;
 *   2. ele não tem preço em NENHUM canal — quem tem preço se vende sozinho,
 *      como a "Coca 500ml" que é item de cardápio E opção de combo.
 *
 * ── Por que a condição 3 olha os quatro preços ─────────────────────────────
 *
 * Ela olhava só `price`, e isso quebrou quando o preço por canal entrou. Duas
 * armadilhas, e as duas já morderam:
 *
 *   a) Esta função é chamada por quem JÁ resolveu o preço do canal
 *      (menu-products com `?canal=`, chatbot-ai com "delivery"). Ali `price`
 *      não é mais o preço próprio do produto: é o preço NAQUELE canal. Um item
 *      com preço só no delivery vira `price: 0` no salão e sumia da mesa —
 *      exatamente a queixa da Pastelaria da Paulista, onde 120 dos 142 itens
 *      têm preço base zero.
 *
 *   b) Zero deixou de significar "não tem preço" e passou a significar também
 *      "não tem preço NESTE canal". Item que a loja vende no balcão mas não no
 *      delivery é legítimo, e some do canal onde ele existe.
 *
 * Por isso: tem preço em qualquer um dos quatro campos, não é adicional. E
 * quem chama deve passar os produtos CRUS — com as colunas por canal ainda no
 * objeto. Passar a lista já resolvida continua funcionando (cai no `price`),
 * só perde a proteção do item que tem preço em outro canal.
 *
 * Recebe a lista COMPLETA do cardápio: quem é opção só se descobre olhando os
 * combos dos outros.
 */
/**
 * O produto tem preço em ALGUM canal?
 *
 * Os quatro campos contam, e nenhum sozinho basta: `price` é o preço de
 * tabela e os três por canal o substituem onde estiverem preenchidos. Quando a
 * lista já vem com o preço do canal resolvido, as colunas específicas não
 * existem mais no objeto e sobra o `price` — que ali já é o do canal.
 */
function temPrecoEmAlgumCanal(p: any): boolean {
  const positivo = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  };
  return positivo(p?.price) || positivo(p?.priceSalao) || positivo(p?.priceDelivery) || positivo(p?.priceTotem);
}

export function idsSoDeOpcaoDeCombo(produtos: any[]): Set<string> {
  const naoVendaveis = new Set<string>();

  // Quem é oferecido DENTRO da pergunta de algum combo deste cardápio.
  const selecionadoEmCombo = new Set<string>();
  for (const prod of produtos || []) {
    for (const grupo of prod?.comboGroups || []) {
      for (const item of grupo?.items || []) {
        const id = item?.menuProduct?.id ?? item?.menuProductId;
        if (id) selecionadoEmCombo.add(String(id));
      }
    }
  }

  for (const p of produtos || []) {
    if (!p?.id) continue;

    // 1. O CARIMBO — a definição, e ela vence tudo.
    //
    // "Complemento é tudo aquilo que é criado e selecionado dentro do combo".
    // Quem nasce pela pergunta do combo (MenuProductManager.criarOpcaoNaHora)
    // sai carimbado, e continua complemento MESMO COM PREÇO — um adicional de
    // R$ 3,00 não é item avulso.
    if (p.apenasEmCombo === true) { naoVendaveis.add(String(p.id)); continue; }

    // 2. Combo com pergunta própria: SEMPRE vendável.
    //
    // Preço R$ 0,00 aqui é normal e não quer dizer nada: no molde iFood o
    // pastel é um combo de base zero e o valor sai da opção de tamanho. Todos
    // os 143 itens da Pastelaria da Paulista são assim.
    if ((p.comboGroups || []).length > 0) continue;

    // 3. Cardápio ANTIGO, cadastrado antes do carimbo existir.
    //
    // Aqui não há como saber quem nasceu dentro do combo, então vale o que dá
    // para observar: o item é oferecido dentro de alguma pergunta, OU está na
    // categoria que o próprio cadastro usa para as opções ("Adicionais").
    //
    // A segunda metade não é preciosismo: dos 101 adicionais da Paulista, 46
    // não estavam vinculados a combo nenhum — vieram soltos da importação — e
    // eram justamente os que viravam card de R$ 0,00 na tela do garçom.
    //
    // O preço entra só como TRAVA DE SEGURANÇA, nunca como definição: item com
    // preço próprio se vende sozinho (a "Coca 500ml" que é item de cardápio E
    // opção de combo), então na dúvida ele APARECE. Errar mostrando um
    // adicional custa uma linha feia na tela; errar escondendo custa venda.
    const ehAdicionalPorCategoria =
      String(p.category || "").trim().toLowerCase() === "adicionais";
    const pareceOpcao = selecionadoEmCombo.has(String(p.id)) || ehAdicionalPorCategoria;

    if (pareceOpcao && !temPrecoEmAlgumCanal(p)) naoVendaveis.add(String(p.id));
  }

  return naoVendaveis;
}
