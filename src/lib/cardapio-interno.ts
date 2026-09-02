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
export const SEM_PRODUTO_DE_INTEGRACAO = {
  NOT: [
    { category: { in: CATEGORIAS_DE_INTEGRACAO, mode: "insensitive" as const } },
    ...PREFIXOS_DE_ESPELHO.map((prefixo) => ({ id: { startsWith: prefixo } })),
  ],
};

/**
 * Versão para filtrar em memória, quando os produtos já vieram do banco.
 * O `id` é opcional para não quebrar quem só tem a categoria em mãos.
 */
export function ehProdutoDeIntegracao(
  categoria: string | null | undefined,
  id?: string | null
): boolean {
  if (id && PREFIXOS_DE_ESPELHO.some((prefixo) => id.startsWith(prefixo))) return true;
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
 * Três condições, e as três importam:
 *   1. alguém o usa como opção de combo;
 *   2. ele não tem grupos próprios — senão seria um combo vendável, e há
 *      combo de preço base R$ 0,00 cujo valor inteiro está nas opções (o
 *      "Nugget" da Hakim). Esse precisa continuar à venda;
 *   3. o preço próprio é zero — quem tem preço se vende sozinho, como a
 *      "Coca 500ml" que é item de cardápio E opção de combo.
 *
 * Recebe a lista COMPLETA do cardápio: quem é opção só se descobre olhando os
 * combos dos outros.
 */
export function idsSoDeOpcaoDeCombo(produtos: any[]): Set<string> {
  const usadosComoOpcao = new Set<string>();
  for (const p of produtos || []) {
    for (const grupo of p?.comboGroups || []) {
      for (const item of grupo?.items || []) {
        const id = item?.menuProduct?.id ?? item?.menuProductId;
        if (id) usadosComoOpcao.add(String(id));
      }
    }
  }

  const soOpcao = new Set<string>();
  if (usadosComoOpcao.size === 0) return soOpcao;

  for (const p of produtos || []) {
    if (!p?.id || !usadosComoOpcao.has(String(p.id))) continue;
    if ((p.comboGroups || []).length > 0) continue;
    if ((Number(p.price) || 0) > 0) continue;
    soOpcao.add(String(p.id));
  }
  return soOpcao;
}
