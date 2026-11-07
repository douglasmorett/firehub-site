/**
 * lib/keeta/cardapio.ts — o cardápio do FireHub, do jeito que a Keeta lê.
 *
 * A Keeta só aceita o cardápio INTEIRO (Open Delivery `GET /v1/merchant`): ela
 * puxa da URL que o onboarding registra em `getMerchantURL` (uma por loja,
 * com a `X-API-KEY` que só nós sabemos gerar) e refaz a leitura quando
 * recebe `merchantUpdate` com `entityType: MENU`. Pausar e reativar vai sem
 * puxar tudo: `ITEM_OFFER` e `OPTION` atualizam só o `status` (1.0.8).
 *
 * Os ids NÃO podem mudar entre um envio e outro (caso "itemOfferId
 * Consistency" da homologação): a Keeta trata id novo como item novo. Por isso
 * saem do produto e do NOME da pergunta, nunca do id do ComboGroup — o painel
 * apaga e recria as perguntas a cada salvamento (api/admin/menu-products PUT).
 *
 *   item      = id do produto (é também o externalCode que volta no pedido)
 *   oferta    = of-<produto>
 *   categoria = cat-<hash do nome>
 *   pergunta  = <produto>-g-<hash do título>
 *   opção     = <pergunta>-<produto da opção>
 *
 * Preço é o do DELIVERY (lib/preco-por-canal.ts): `value` é o que se cobra,
 * `originalValue` o de tabela quando há promoção. Horário do produto vira
 * `availabilities` em UTC (mesma conta do horário da loja).
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { cardapioDaLoja } from "@/lib/cardapio-da-loja";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { lerHorarioDoProduto } from "@/lib/cardapio-interno";
import { minimoExigidoDoGrupo } from "@/lib/preco-combo";
import { chamarKeeta, type ResultadoKeeta } from "./api";
import { lojaKeetaDoFranqueado, lojaDoMerchant } from "./lojas";
import { deslocamentoDoFuso, horarioParaKeeta, semanaParaKeeta } from "./loja-na-keeta";

// ── A URL e a chave do cardápio ──────────────────────────────────────────────

/** A `X-API-KEY` da loja: HMAC do merchantId com o segredo do app — nada gravado. */
export function chaveDoCardapio(merchantId: string): string {
  return createHmac("sha256", process.env.KEETA_CLIENT_SECRET || "").update(`cardapio:${merchantId}`).digest("base64url").slice(0, 40);
}

export function chaveDoCardapioConfere(merchantId: string, recebida: string | null | undefined): boolean {
  if (!process.env.KEETA_CLIENT_SECRET || !recebida) return false;
  const a = Buffer.from(chaveDoCardapio(merchantId));
  const b = Buffer.from(String(recebida));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function urlDoCardapio(urlBase: string, merchantId: string) {
  return { baseURL: `${urlBase}/api/keeta/cardapio/${encodeURIComponent(merchantId)}`, apiKey: chaveDoCardapio(merchantId) };
}

// ── Montar ───────────────────────────────────────────────────────────────────

const hash = (s: string) => createHash("sha1").update(s.trim().toLowerCase()).digest("hex").slice(0, 12);
const corta = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const reais = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const preco = (valor: unknown, de?: unknown) => ({ value: reais(valor), originalValue: reais(de ?? valor) });
const imagem = (url: unknown) => (typeof url === "string" && /^https:\/\//i.test(url) ? { URL: url } : undefined);
const situacao = (ok: boolean) => (ok ? "AVAILABLE" : "UNAVAILABLE");

const DIA_DO_FIREHUB: Record<string, number> = { SEG: 0, TER: 1, QUA: 2, QUI: 3, SEX: 4, SAB: 5, DOM: 6 };

/** Dias e horário do produto → weekHours da Keeta. Null = vende sempre (sem availability). */
export function horarioDoProdutoParaKeeta(availableDays: unknown, availableHours: unknown, deslocamentoMin: number) {
  let dias: number[] = [];
  try {
    const lidos = typeof availableDays === "string" ? JSON.parse(availableDays) : availableDays;
    if (Array.isArray(lidos)) dias = [...new Set(lidos.map((d) => DIA_DO_FIREHUB[String(d).trim().toUpperCase()]).filter((d) => d !== undefined))];
  } catch {}
  const horario = lerHorarioDoProduto(availableHours);
  if ((dias.length === 0 || dias.length === 7) && !horario) return null;
  if (dias.length === 0) dias = [0, 1, 2, 3, 4, 5, 6];
  const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const ini = horario ? min(horario.de) : 0;
  let fim = horario ? min(horario.ate) : 1440;
  if (fim <= ini) fim += 1440; // o caldo das 18h às 02h
  return semanaParaKeeta(dias.sort().map((dia) => ({ dia, ini, fim })), deslocamentoMin);
}

/**
 * O cardápio pronto (sem rede). `produtos` é o que `cardapioDaLoja(…,
 * "delivery")` devolve — preço do delivery já aplicado.
 */
export function cardapioParaKeeta(params: {
  merchantId: string;
  lojaId: string;
  nomeDaLoja: string;
  email: string | null;
  telefone: string | null;
  storeHours: unknown;
  produtos: any[];
  deslocamentoMin: number;
  agora?: Date;
}) {
  const m = params.merchantId;
  const items = new Map<string, any>();
  const categorias = new Map<string, any>();
  const itemOffers: any[] = [];
  const optionGroups: any[] = [];
  const availabilities: any[] = [];

  const item = (id: string, p: any, ativo: boolean) => {
    if (items.has(id)) return;
    items.set(id, {
      id,
      name: corta(p?.name, 150) || "Item",
      ...(corta(p?.description, 1000) ? { description: corta(p.description, 1000) } : {}),
      externalCode: id,
      status: situacao(ativo),
      ...(imagem(p?.imageUrl) ? { image: imagem(p.imageUrl) } : {}),
      unit: "UN",
    });
  };

  for (const p of params.produtos) {
    // Complemento não é item avulso; fora do delivery não vai para a Keeta.
    if (p?.apenasEmCombo || p?.activeDelivery === false) continue;
    const nomeDaCategoria = corta(p.category, 150) || "Cardápio";
    const catId = `cat-${hash(nomeDaCategoria)}`;
    if (!categorias.has(catId)) {
      categorias.set(catId, { id: catId, index: categorias.size, name: nomeDaCategoria, externalCode: catId, status: "AVAILABLE", itemOfferId: [] });
    }
    const cat = categorias.get(catId);

    item(p.id, p, p.active !== false && !p.esgotado);

    const gruposDoProduto: string[] = [];
    const titulosUsados = new Map<string, number>();
    (Array.isArray(p.comboGroups) ? p.comboGroups : []).forEach((g: any, gi: number) => {
      const titulo = corta(g?.title, 150) || `Escolha ${gi + 1}`;
      const repeticao = titulosUsados.get(titulo.toLowerCase()) || 0;
      titulosUsados.set(titulo.toLowerCase(), repeticao + 1);
      const grupoId = `${p.id}-g-${hash(titulo)}${repeticao ? `-${repeticao}` : ""}`;
      const vistos = new Set<string>();
      const options = (Array.isArray(g?.items) ? g.items : [])
        .filter((o: any) => o?.menuProductId && !vistos.has(o.menuProductId) && vistos.add(o.menuProductId))
        .map((o: any, oi: number) => {
          const ativo = o.menuProduct?.active !== false;
          item(o.menuProductId, o.menuProduct, ativo);
          return { id: `${grupoId}-${o.menuProductId}`, itemId: o.menuProductId, index: oi, status: situacao(ativo), price: preco(o.additionalPrice, o.adicionalDe) };
        });
      if (options.length === 0) return;
      const max = Math.max(1, Number(g?.maxQty) || 1);
      optionGroups.push({
        id: grupoId,
        index: gi,
        name: titulo,
        externalCode: grupoId,
        status: "AVAILABLE",
        minPermitted: minimoExigidoDoGrupo({ maxQty: max, minQty: g?.minQty } as any),
        maxPermitted: max,
        options,
      });
      gruposDoProduto.push(grupoId);
    });

    const semana = horarioDoProdutoParaKeeta(p.availableDays, p.availableHours, params.deslocamentoMin);
    if (semana && semana.length > 0) availabilities.push({ id: `av-${p.id}`, hours: semana });

    const ofertaId = `of-${p.id}`;
    itemOffers.push({
      id: ofertaId,
      itemId: p.id,
      index: cat.itemOfferId.length,
      status: situacao(p.active !== false && !p.esgotado),
      price: preco(p.price, p.precoDe),
      ...(gruposDoProduto.length ? { optionGroupsId: gruposDoProduto } : {}),
      ...(semana && semana.length > 0 ? { availabilityId: [`av-${p.id}`] } : {}),
    });
    cat.itemOfferId.push(ofertaId);
  }

  const semanaDaLoja = horarioParaKeeta(params.storeHours, params.deslocamentoMin);
  const fone = String(params.telefone || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  const cats = [...categorias.values()];

  return {
    lastUpdate: (params.agora || new Date()).toISOString(),
    id: m,
    status: "AVAILABLE",
    basicInfo: {
      contactEmails: params.email ? [params.email] : [],
      contactPhones: { commercialNumber: fone ? `55-${fone}` : "" },
    },
    services: [
      {
        id: `${m}-delivery`,
        serviceType: "DELIVERY",
        menuId: `${m}-menu`,
        serviceHours: {
          id: `${m}-horario`,
          weekHours: semanaDaLoja.length > 0
            ? semanaDaLoja
            : [{ dayOfWeek: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"], timePeriods: { startTime: "00:00:00.000Z", endTime: "23:59:00.000Z" } }],
        },
      },
    ],
    menus: [{ id: `${m}-menu`, name: corta(params.nomeDaLoja, 500) || "Cardápio", externalCode: params.lojaId, categoryId: cats.map((c) => c.id) }],
    categories: cats,
    itemOffers,
    items: [...items.values()],
    optionGroups,
    availabilities,
  };
}

/** O cardápio da loja ligada a este merchantId, ou null. */
export async function cardapioDoMerchant(merchantId: string) {
  const vinculo = await lojaDoMerchant(merchantId);
  if (!vinculo?.ativa) return null;
  const lojaId = vinculo.franchiseeId;
  const [loja, produtos, fuso] = await Promise.all([
    prisma.user.findUnique({ where: { id: lojaId }, select: { storeName: true, email: true, storePhone: true, storeHours: true } }),
    cardapioDaLoja(lojaId, "delivery"),
    fusoDaLoja(lojaId),
  ]);
  return cardapioParaKeeta({
    merchantId,
    lojaId,
    nomeDaLoja: loja?.storeName || "",
    email: loja?.email || null,
    telefone: loja?.storePhone || null,
    storeHours: loja?.storeHours,
    produtos,
    deslocamentoMin: deslocamentoDoFuso(fuso),
  });
}

// ── Avisar a Keeta ───────────────────────────────────────────────────────────

const semVinculo: ResultadoKeeta = { ok: false, status: 0, erro: "Loja não está conectada na Keeta", repetir: false };

/** "Puxe o cardápio de novo": a Keeta relê a URL do onboarding. */
export async function enviarCardapioParaKeeta(lojaId: string): Promise<ResultadoKeeta & { itens?: number }> {
  const v = await lojaKeetaDoFranqueado(lojaId);
  if (!v?.ativa) return semVinculo;
  const cardapio = await cardapioDoMerchant(v.merchantId);
  if (!cardapio || cardapio.itemOffers.length === 0) return { ok: false, status: 0, erro: "O cardápio do delivery está vazio no FireHub.", repetir: false };
  const r = await chamarKeeta("POST", `/v1/merchantUpdate/${encodeURIComponent(v.merchantId)}`, {
    corpo: { entityType: "MENU", updatedObjects: cardapio.menus },
  });
  return { ...r, itens: cardapio.itemOffers.length };
}

/**
 * Pausou ou reativou produto no painel: a oferta dele e toda opção que usa
 * esse produto vão para a Keeta só com o status. Loja sem Keeta = nada.
 */
export async function avisarKeetaDaPausa(lojaId: string, produtoIds: string[]): Promise<void> {
  const v = await lojaKeetaDoFranqueado(lojaId).catch(() => null);
  if (!v?.ativa || produtoIds.length === 0) return;
  const cardapio = await cardapioDoMerchant(v.merchantId);
  if (!cardapio) return;
  const ids = new Set(produtoIds);
  const ofertas = cardapio.itemOffers.filter((o) => ids.has(o.itemId));
  const opcoes = cardapio.optionGroups.flatMap((g) => g.options).filter((o: any) => ids.has(o.itemId));
  const url = `/v1/merchantUpdate/${encodeURIComponent(v.merchantId)}`;
  for (const [entityType, objetos] of [["ITEM_OFFER", ofertas], ["OPTION", opcoes]] as const) {
    if (objetos.length === 0) continue;
    const r = await chamarKeeta("POST", url, { corpo: { entityType, updatedObjects: objetos } });
    console.log(`[Keeta] ${r.ok ? "⏸️" : "❌"} ${entityType} ${objetos.length} da loja ${lojaId}: ${r.ok ? "ok" : r.erro}`);
  }
}

/** Mudou o produto (preço, nome, horário, perguntas…): a Keeta relê o cardápio. Loja sem Keeta = nada. */
export async function avisarKeetaDoCardapio(lojaId: string): Promise<void> {
  const v = await lojaKeetaDoFranqueado(lojaId).catch(() => null);
  if (!v?.ativa) return;
  const r = await enviarCardapioParaKeeta(lojaId);
  console.log(`[Keeta] ${r.ok ? "📋" : "❌"} cardápio da loja ${lojaId} (${r.itens ?? 0} itens): ${r.ok ? "ok" : r.erro}`);
}
