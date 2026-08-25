/**
 * /src/lib/ifood-catalog.ts
 *
 * Catalog API v2.0 do iFood — o cardápio visto do lado de lá.
 *
 * Três coisas desta API custam caro se forem descobertas tarde:
 *
 *   1. `PUT /items` grava o item INTEIRO. Campo omitido é campo apagado. Por
 *      isso as alterações pontuais de preço e de pausa saem por PATCH, e não
 *      reenviando o item — que é, aliás, exatamente o que a homologação exige.
 *   2. A foto não vai junto com o item: sobe antes, em base64, e o que se
 *      guarda é o `imagePath` devolvido. O mesmo caminho serve para vários
 *      itens.
 *   3. Os PATCH em lote (`/products/price`, `/products/status`) são assíncronos:
 *      devolvem um `batchId` e só terminam quando o batch fica COMPLETED.
 *
 * A validação acontece aqui, antes de sair a chamada: os critérios de
 * homologação cobram que nenhum payload inválido chegue à API.
 */
import { chamarComContexto, type RespostaIfood } from "./ifood-http";
import type { ContextoIfood } from "./ifood-token";

/** O contexto já traz o merchantId e a cascata de credenciais. */
export type CtxCatalogo = ContextoIfood;

export type StatusCatalogo = "AVAILABLE" | "UNAVAILABLE";

const base = (merchantId: string) => `/catalog/v2.0/merchants/${merchantId}`;

/** Erro de validação nossa — nem chega a virar chamada HTTP. */
export class ErroValidacao extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroValidacao";
  }
}

// ── validações que os critérios cobram ──────────────────────────────────────
const LIMITE_TITULO = 100;
const LIMITE_DESCRICAO = 500;

export function validarTitulo(titulo: string, oQue = "nome") {
  const t = (titulo ?? "").trim();
  if (!t) throw new ErroValidacao(`Informe o ${oQue}.`);
  if (t.length > LIMITE_TITULO) {
    throw new ErroValidacao(`O ${oQue} passa de ${LIMITE_TITULO} caracteres (tem ${t.length}).`);
  }
  return t;
}

export function validarDescricao(descricao?: string | null) {
  const d = (descricao ?? "").trim();
  if (d.length > LIMITE_DESCRICAO) {
    throw new ErroValidacao(`A descrição passa de ${LIMITE_DESCRICAO} caracteres (tem ${d.length}).`);
  }
  return d;
}

export function validarPreco(valor: number, oQue = "preço") {
  if (typeof valor !== "number" || !Number.isFinite(valor)) {
    throw new ErroValidacao(`Informe um ${oQue} numérico.`);
  }
  if (valor <= 0) throw new ErroValidacao(`O ${oQue} precisa ser maior que zero.`);
  // O iFood trabalha com duas casas; mandar 12.3456 volta como erro de validação.
  return Math.round(valor * 100) / 100;
}

export function validarStatus(status: string): StatusCatalogo {
  if (status !== "AVAILABLE" && status !== "UNAVAILABLE") {
    throw new ErroValidacao('O status precisa ser "AVAILABLE" ou "UNAVAILABLE".');
  }
  return status;
}

// ── leitura ─────────────────────────────────────────────────────────────────

/** Os catálogos da loja. Toda loja tem pelo menos um. */
export function listarCatalogos(ctx: CtxCatalogo) {
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/catalogs`);
}

/** Categorias do cardápio. Com `comItens`, cada categoria vem com seus itens. */
export function listarCategorias(ctx: CtxCatalogo, comItens = false) {
  const q = comItens ? "?include_items=true" : "";
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/categories${q}`);
}

export function itensDaCategoria(ctx: CtxCatalogo, categoryId: string) {
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/categories/${categoryId}/items`);
}

/** O item com tudo junto: produto, grupos de complemento e opções. */
export function itemCompleto(ctx: CtxCatalogo, itemId: string) {
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/items/${itemId}/flat`);
}

/**
 * Itens que o cliente NÃO consegue comprar, com o motivo de cada um.
 * É o endpoint que responde "por que meu produto sumiu do app".
 */
export function itensBloqueados(ctx: CtxCatalogo, catalogId: string) {
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/catalogs/${catalogId}/unsellableItems`);
}

export function itensAVenda(ctx: CtxCatalogo, catalogId: string) {
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/catalogs/${catalogId}/sellableItems`);
}

// ── escrita ─────────────────────────────────────────────────────────────────

/** Cria uma categoria para agrupar itens. */
export function criarCategoria(
  ctx: CtxCatalogo,
  dados: { nome: string; status?: StatusCatalogo; template?: string; index?: number },
) {
  const name = validarTitulo(dados.nome, "nome da categoria");
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/categories`, {
    method: "POST",
    body: JSON.stringify({
      name,
      status: validarStatus(dados.status ?? "AVAILABLE"),
      template: dados.template ?? "DEFAULT",
      ...(typeof dados.index === "number" ? { index: dados.index } : {}),
    }),
  });
}

/**
 * Sobe uma imagem e devolve o `imagePath` que os itens usam.
 * Aceita jpg, jpeg e png, até 5 MB, sempre em data URI base64.
 */
export async function subirImagem(ctx: CtxCatalogo, dataUri: string): Promise<RespostaIfood<{ imagePath: string }>> {
  if (!/^data:image\/(png|jpe?g);base64,/i.test(dataUri)) {
    throw new ErroValidacao("A foto precisa ser PNG ou JPG.");
  }
  // O base64 cresce ~33% sobre o binário; 5 MB de arquivo dão ~6,8 MB de texto.
  const bytes = Math.ceil((dataUri.split(",")[1]?.length ?? 0) * 0.75);
  if (bytes > 5 * 1024 * 1024) {
    throw new ErroValidacao(`A foto tem ${(bytes / 1024 / 1024).toFixed(1)} MB. O limite do iFood é 5 MB.`);
  }
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/image/upload`, {
    method: "POST",
    body: JSON.stringify({ image: dataUri }),
  });
}

export type ComplementoNovo = {
  id?: string;
  productId?: string;
  nome: string;
  preco: number;
  status?: StatusCatalogo;
  imagePath?: string | null;
  descricao?: string | null;
  externalCode?: string | null;
};

export type GrupoComplementoNovo = {
  id?: string;
  nome: string;
  min?: number;
  max?: number;
  status?: StatusCatalogo;
  complementos: ComplementoNovo[];
};

export type ItemNovo = {
  id?: string;
  productId?: string;
  categoryId: string;
  nome: string;
  descricao?: string | null;
  preco: number;
  status?: StatusCatalogo;
  imagePath?: string | null;
  externalCode?: string | null;
  grupos?: GrupoComplementoNovo[];
};

const novoId = () => globalThis.crypto.randomUUID();

/**
 * Cria (ou reescreve) um item com produto, grupos de complemento e opções —
 * tudo numa chamada só, que é como a API foi desenhada.
 *
 * Devolve também os ids gerados, porque é com eles que os PATCH de preço e de
 * pausa vão trabalhar depois.
 */
export async function salvarItem(ctx: CtxCatalogo, item: ItemNovo) {
  const nome = validarTitulo(item.nome, "nome do item");
  const descricao = validarDescricao(item.descricao);
  const preco = validarPreco(item.preco, "preço do item");
  const status = validarStatus(item.status ?? "AVAILABLE");
  if (!item.categoryId) throw new ErroValidacao("Escolha a categoria do item.");

  const itemId = item.id ?? novoId();
  const productId = item.productId ?? novoId();

  // O item guarda preço e status; o nome, a descrição e a foto moram no produto.
  const produtos: any[] = [{
    id: productId,
    name: nome,
    ...(descricao ? { description: descricao } : {}),
    ...(item.imagePath ? { imagePath: item.imagePath } : {}),
    ...(item.externalCode ? { externalCode: item.externalCode } : {}),
  }];
  const optionGroups: any[] = [];
  const options: any[] = [];
  const idsGerados = {
    itemId,
    productId,
    grupos: [] as { id: string; nome: string; complementos: { id: string; productId: string; nome: string }[] }[],
  };

  for (const grupo of item.grupos ?? []) {
    const nomeGrupo = validarTitulo(grupo.nome, "nome do grupo de complementos");
    if (!grupo.complementos?.length) {
      throw new ErroValidacao(`O grupo "${nomeGrupo}" precisa de pelo menos um complemento.`);
    }
    const grupoId = grupo.id ?? novoId();
    const min = grupo.min ?? 0;
    const max = grupo.max ?? grupo.complementos.length;
    if (min > max) {
      throw new ErroValidacao(`No grupo "${nomeGrupo}", o mínimo não pode ser maior que o máximo.`);
    }

    const optionIds: string[] = [];
    const registroGrupo = { id: grupoId, nome: nomeGrupo, complementos: [] as any[] };

    for (const c of grupo.complementos) {
      const nomeC = validarTitulo(c.nome, "nome do complemento");
      const precoC = validarPreco(c.preco, "preço do complemento");
      const optionId = c.id ?? novoId();
      const produtoC = c.productId ?? novoId();
      optionIds.push(optionId);

      options.push({
        id: optionId,
        productId: produtoC,
        status: validarStatus(c.status ?? "AVAILABLE"),
        price: { value: precoC },
        ...(c.externalCode ? { externalCode: c.externalCode } : {}),
      });

      // O nome e a foto do complemento vivem no produto dele.
      produtos.push({
        id: produtoC,
        name: nomeC,
        ...(c.descricao ? { description: validarDescricao(c.descricao) } : {}),
        ...(c.imagePath ? { imagePath: c.imagePath } : {}),
        ...(c.externalCode ? { externalCode: c.externalCode } : {}),
      });

      registroGrupo.complementos.push({ id: optionId, productId: produtoC, nome: nomeC });
    }

    optionGroups.push({
      id: grupoId,
      name: nomeGrupo,
      min,
      max,
      status: validarStatus(grupo.status ?? "AVAILABLE"),
      optionIds,
    });
    idsGerados.grupos.push(registroGrupo);
  }

  const resposta = await chamarComContexto(ctx, `${base(ctx.merchantId)}/items`, {
    method: "PUT",
    body: JSON.stringify({
      item: {
        id: itemId,
        type: "DEFAULT",
        categoryId: item.categoryId,
        // O vínculo item → produto e item → grupos não aparece nos exemplos da
        // documentação, que omitem o miolo do objeto. Mandamos explícito: se a
        // API ignorar, não custa nada; se exigir, já está lá.
        productId,
        status,
        price: { value: preco },
        ...(item.externalCode ? { externalCode: item.externalCode } : {}),
        ...(optionGroups.length ? { optionGroups: optionGroups.map((g) => g.id) } : {}),
      },
      products: produtos,
      optionGroups,
      options,
    }),
  });

  return { resposta, ids: idsGerados };
}

// ── alterações pontuais (os PATCH que a homologação exige) ──────────────────

export function atualizarPrecoItem(
  ctx: CtxCatalogo,
  dados: { itemId: string; preco: number; precoOriginal?: number },
) {
  const value = validarPreco(dados.preco, "preço do item");
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/items/price`, {
    method: "PATCH",
    body: JSON.stringify({
      itemId: dados.itemId,
      price: {
        value,
        ...(dados.precoOriginal ? { originalValue: validarPreco(dados.precoOriginal, "preço original") } : {}),
      },
    }),
  });
}

export function atualizarStatusItem(ctx: CtxCatalogo, dados: { itemId: string; status: StatusCatalogo }) {
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/items/status`, {
    method: "PATCH",
    body: JSON.stringify({ itemId: dados.itemId, status: validarStatus(dados.status) }),
  });
}

export function atualizarPrecoComplemento(
  ctx: CtxCatalogo,
  dados: { optionId: string; preco: number; precoOriginal?: number },
) {
  const value = validarPreco(dados.preco, "preço do complemento");
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/options/price`, {
    method: "PATCH",
    body: JSON.stringify({
      optionId: dados.optionId,
      price: {
        value,
        ...(dados.precoOriginal ? { originalValue: validarPreco(dados.precoOriginal, "preço original") } : {}),
      },
    }),
  });
}

export function atualizarStatusComplemento(
  ctx: CtxCatalogo,
  dados: { optionId: string; status: StatusCatalogo },
) {
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/options/status`, {
    method: "PATCH",
    body: JSON.stringify({ optionId: dados.optionId, status: validarStatus(dados.status) }),
  });
}

/** Pausa ou reativa um grupo inteiro de complementos. */
export function atualizarStatusGrupo(
  ctx: CtxCatalogo,
  dados: { optionGroupId: string; status: StatusCatalogo },
) {
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/optionGroups/status`, {
    method: "PATCH",
    body: JSON.stringify({ optionGroupId: dados.optionGroupId, status: validarStatus(dados.status) }),
  });
}

// ── lote ────────────────────────────────────────────────────────────────────

/**
 * Atualiza preços de vários produtos numa chamada. Assíncrono: devolve batchId.
 * Os critérios pedem 100+ itens em até 10 segundos — é por aqui que se chega lá.
 */
export function precosEmLote(
  ctx: CtxCatalogo,
  itens: { externalCode?: string; productId?: string; preco: number; recursos?: ("ITEM" | "OPTION")[] }[],
) {
  const body = itens.map((i) => ({
    ...(i.externalCode ? { externalCode: i.externalCode } : {}),
    ...(i.productId ? { productId: i.productId } : {}),
    price: { value: validarPreco(i.preco) },
    resources: i.recursos ?? ["ITEM"],
  }));
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/products/price`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function statusEmLote(
  ctx: CtxCatalogo,
  itens: { externalCode?: string; productId?: string; status: StatusCatalogo; recursos?: ("ITEM" | "OPTION")[] }[],
) {
  const body = itens.map((i) => ({
    ...(i.externalCode ? { externalCode: i.externalCode } : {}),
    ...(i.productId ? { productId: i.productId } : {}),
    status: validarStatus(i.status),
    resources: i.recursos ?? ["ITEM"],
  }));
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/products/status`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** Acompanha um lote até o iFood terminar de processá-lo. */
export function statusDoLote(ctx: CtxCatalogo, batchId: string) {
  return chamarComContexto(ctx, `${base(ctx.merchantId)}/batch/${batchId}`);
}
