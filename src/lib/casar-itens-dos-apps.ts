/**
 * CASAR PRODUTO DO FIREHUB ↔ ITEM DO APP (iFood, 99) — as regras puras da
 * pausa nos apps pelo Bill (lib/assessor/pausa-nos-apps.ts). Sem banco e sem
 * rede: o teste é scripts/teste-casar-itens-dos-apps.ts.
 *
 * Douglas, 12/11/2026: depois de pausar no FireHub, o Bill pergunta "Posso
 * pausar no iFood e na 99 também?" e só pausa lá com o SIM.
 *
 * Ordem do casamento, do mais seguro para o menos:
 *   1. id do item gravado no espelho que o lojista vinculou ao produto
 *      (`codigoExterno` da linha com `vinculadoA` = produto) — só vale se esse
 *      id existir no cardápio do app agora;
 *   2. código: o "Código PDV" que o lojista digitou no app (`externalCode` no
 *      iFood, `app_external_id` na 99) igual ao `codigoPDV` ou ao id do produto;
 *   3. nome, sem acento/caixa/pontuação — o do produto e o do espelho
 *      vinculado (que é o nome como o app manda no pedido). Só casamento ÚNICO:
 *      dois itens com o mesmo nome = não pausa e diz por quê.
 */

export type ItemDoApp = {
  /** Id que o PATCH/updateItemStatus aceita. Vazio = o app não deu id (99 sem código). */
  id: string;
  nome: string;
  /** Código que o lojista digitou no app (Código PDV). */
  codigos: string[];
  /** false = só existe dentro de complemento (99: is_sold_separately=false). */
  avulso: boolean;
};

export type ProdutoParaCasar = {
  id: string;
  nome: string;
  /** codigoPDV (texto) e o id do produto. */
  codigos: string[];
  /** Nomes dos espelhos deste app vinculados ao produto. */
  nomesNoApp: string[];
  /** `codigoExterno` dos espelhos deste app vinculados ao produto. */
  idsNoApp: string[];
};

export type ProdutoCasado = { produtoId: string; nome: string; itemIds: string[] };

export type ResultadoDoCasamento = {
  casados: ProdutoCasado[];
  /** Nenhum item com esse nome/código no app. */
  naoAchados: string[];
  /** Mais de um item com esse nome no app: não dá para saber qual. */
  ambiguos: string[];
  /** Achou pelo nome, mas o app não deu id ao item (99 sem código): não dá pela API. */
  semCodigo: string[];
};

export function normalizarNome(t: string | null | undefined): string {
  return String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

export function casarProdutosComItens(produtos: ProdutoParaCasar[], itens: ItemDoApp[]): ResultadoDoCasamento {
  const r: ResultadoDoCasamento = { casados: [], naoAchados: [], ambiguos: [], semCodigo: [] };
  const comId = itens.filter((i) => i.id);
  const unicos = (lista: ItemDoApp[]) => Array.from(new Set(lista.map((i) => i.id)));

  for (const p of produtos) {
    // 1. id do espelho vinculado  2. Código PDV
    let achados = comId.filter((i) => p.idsNoApp.includes(i.id));
    if (!achados.length) achados = comId.filter((i) => i.codigos.some((c) => c && p.codigos.includes(c)));
    if (achados.length) {
      r.casados.push({ produtoId: p.id, nome: p.nome, itemIds: unicos(achados) });
      continue;
    }

    // 3. nome
    const nomes = new Set([p.nome, ...p.nomesNoApp].map(normalizarNome).filter(Boolean));
    const porNome = itens.filter((i) => nomes.has(normalizarNome(i.nome)));
    // O mesmo id listado duas vezes é um item só.
    const distintos = porNome.filter((i, idx) => !i.id || porNome.findIndex((o) => o.id === i.id) === idx);
    // Item avulso e opção de complemento com o mesmo nome: vale o avulso.
    const avulsos = distintos.filter((i) => i.avulso);
    const candidatos = distintos.length > 1 && avulsos.length ? avulsos : distintos;

    if (candidatos.length === 0) r.naoAchados.push(p.nome);
    else if (candidatos.length > 1) r.ambiguos.push(p.nome);
    else if (!candidatos[0].id) r.semCodigo.push(p.nome);
    else r.casados.push({ produtoId: p.id, nome: p.nome, itemIds: [candidatos[0].id] });
  }
  return r;
}

/**
 * Itens do catálogo do iFood (`GET .../catalogs/{id}/categories?includeItems=true`):
 * uma lista de categorias, cada uma com `items` ({ id, name, externalCode, status… }).
 */
export function itensDoCatalogoIfood(categorias: unknown): ItemDoApp[] {
  const lista: any[] = Array.isArray(categorias) ? categorias : [];
  const itens: ItemDoApp[] = [];
  for (const c of lista) {
    for (const it of Array.isArray(c?.items) ? c.items : []) {
      itens.push({
        id: texto(it?.id ?? it?.itemId),
        nome: texto(it?.name ?? it?.description),
        codigos: [texto(it?.externalCode)].filter(Boolean),
        avulso: true,
      });
    }
  }
  return itens;
}

/**
 * Itens do cardápio da 99 (`GET /v3/item/item/list`, data.items):
 * { app_item_id, item_name, app_external_id, is_sold_separately, status }.
 * Loja que montou o cardápio no portal da 99 sem código vem com
 * `app_item_id` "" (Fogo e Sabor, 12/11/2026): o item entra com id vazio e o
 * casamento o devolve em `semCodigo`.
 */
export function itensDoCardapio99(data: unknown): ItemDoApp[] {
  const lista: any[] = Array.isArray((data as any)?.items) ? (data as any).items : [];
  return lista.map((it) => ({
    id: texto(it?.app_item_id),
    nome: texto(it?.item_name),
    codigos: [texto(it?.app_external_id)].filter(Boolean),
    avulso: it?.is_sold_separately !== false,
  }));
}

/**
 * Corpo do `POST /v3/item/item/updateItemStatus` da 99 (doc oficial, Menu API ›
 * Update Item Status, lida em 12/11/2026): auth_token, app_item_ids (array de
 * texto) e status 1 = disponível / 2 = indisponível. A resposta traz
 * data.success e data.failed com os app_item_ids.
 */
export function corpoDoStatus99(authToken: string, appItemIds: string[], ativo: boolean) {
  return { auth_token: authToken, app_item_ids: appItemIds, status: ativo ? 1 : 2 };
}
