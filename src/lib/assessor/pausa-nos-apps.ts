/**
 * BILL PAUSA NOS APPS — "acabou a esfirra de frango, pausa" → o Bill pausa no
 * FireHub (cardapio.ts) e pergunta "Posso pausar no iFood e na 99 também?".
 * Com o SIM, `pausar_nos_apps` pausa lá. Mesma coisa para reativar.
 *
 * Douglas, 12/11/2026. Keeta fica de fora: a API dela não tem pausa por item.
 *
 *   iFood → Catalog v2 (lib/ifood-catalog.ts): lê o catálogo e manda
 *           PATCH /items/status por item. Só com token do app DISTRIBUÍDO: o
 *           centralizado só tem Order/Events, então ele sai da lista de
 *           credenciais. Sem distribuído = "reconecte o iFood em Integrações".
 *   99    → GET /v3/item/item/list (nome ↔ app_item_id) e
 *           POST /v3/item/item/updateItemStatus (lib/food99-api.ts).
 *
 * O casamento produto ↔ item do app está em lib/casar-itens-dos-apps.ts.
 * Vai para o mesmo histórico da pausa (AssessorRegistro PAUSADO/REATIVADO),
 * com `refs.nosApps`: o "desfaz" volta só nos apps (desfazerNosApps).
 */
import { prisma } from "@/lib/prisma";
import { ORIGENS } from "@/lib/espelho-de-integracao";
import { contextoDoPedido, type ContextoIfood } from "@/lib/ifood-token";
import { atualizarStatusItem, listarCategorias } from "@/lib/ifood-catalog";
import { mensagemDeErro } from "@/lib/ifood-http";
import { cardapioDaLoja, getAuthToken, mudarStatusDosItens } from "@/lib/food99-api";
import { lojas99DaConta } from "@/lib/food99-lojas";
import {
  casarProdutosComItens, itensDoCardapio99, itensDoCatalogoIfood, type ProdutoParaCasar, type ResultadoDoCasamento,
} from "@/lib/casar-itens-dos-apps";
import type { ContextoDoAssessor } from "./ferramentas";
import { comAutor } from "./painel";

export const AVISO_IFOOD_SO_CENTRAL =
  "No iFood, faça pelo app do iFood: a conexão desta loja não deixa o Bill mexer no cardápio de lá (para deixar, reconecte o iFood em Integrações).";
const RECONECTAR_IFOOD = "A conexão do iFood desta loja não deixa mexer no cardápio: reconecte o iFood em Integrações. Por enquanto, faça pelo app do iFood.";
const RECONECTAR_99 = "A 99 não deu a autorização da loja: reconecte a 99 em Integrações. Por enquanto, faça pelo app da 99.";
/** "Sim" sem dizer os itens vale para a pausa/reativação feita há pouco. */
const JANELA_DA_ULTIMA_PAUSA_MS = 30 * 60_000;

export type AppsDaLoja = {
  /** Lojas do iFood com autorização do app distribuído (merchantId). */
  ifood: string[];
  /** Tem iFood, mas só pelo centralizado: não dá para pausar item por aqui. */
  ifoodSoCentral: boolean;
  /** Lojas da 99 (app_shop_id). */
  food99: string[];
};

/** Quais apps a loja tem conectados. Sem rede: só o que está gravado. */
export async function appsDaLoja(franchiseeId: string): Promise<AppsDaLoja> {
  const [u, integracoes, lojas99] = await Promise.all([
    prisma.user.findUnique({
      where: { id: franchiseeId },
      select: { ifoodConnected: true, ifoodMerchantId: true, ifoodAccessToken: true, ifoodRefreshToken: true, food99Connected: true },
    }),
    prisma.ifoodIntegration.findMany({
      where: { userId: franchiseeId, active: true },
      orderBy: { createdAt: "asc" },
      select: { merchantId: true, accessToken: true, refreshToken: true },
    }),
    lojas99DaConta(franchiseeId),
  ]);
  // Mesma leitura do cron loja-sem-conexao: integração ativa ou o merchant antigo do User.
  const merchants = Array.from(
    new Set([...integracoes.map((i) => i.merchantId), ...(u?.ifoodConnected && u.ifoodMerchantId ? [u.ifoodMerchantId] : [])].filter(Boolean)),
  );
  // Token próprio (integração ou User) é do app distribuído (lib/ifood-token.ts).
  const temDistribuido = integracoes.some((i) => i.accessToken || i.refreshToken) || Boolean(u?.ifoodAccessToken || u?.ifoodRefreshToken);
  const conectadas99 = lojas99.filter((l) => l.connected).map((l) => l.appShopId);
  // Sem linha na Food99Store, a loja antiga usa o id da conta como app_shop_id (api/admin/99food-cardapio).
  const food99 = conectadas99.length ? conectadas99 : u?.food99Connected ? [franchiseeId] : [];
  return { ifood: temDistribuido ? merchants : [], ifoodSoCentral: merchants.length > 0 && !temDistribuido, food99 };
}

/** "Posso pausar no iFood e na 99 também?" — null quando não há app para perguntar. */
export function perguntaDosApps(apps: AppsDaLoja, ativo: boolean): string | null {
  const onde = [apps.ifood.length ? "no iFood" : null, apps.food99.length ? "na 99" : null].filter(Boolean);
  if (!onde.length) return null;
  return `Posso ${ativo ? "reativar" : "pausar"} ${onde.join(" e ")} também?`;
}

type ResultadoNoApp = {
  app: "iFood" | "99";
  loja?: string;
  /** merchantId (iFood) ou app_shop_id (99). */
  onde?: string;
  feitos: string[];
  naoAchados: string[];
  erros: string[];
  /** O que de fato mudou lá (para o desfazer). */
  itemIds: string[];
};

const naoAchadosDoCasamento = (c: ResultadoDoCasamento, app: string) => [
  ...c.naoAchados,
  ...c.ambiguos.map((n) => `${n} (mais de um item com esse nome no ${app})`),
  ...c.semCodigo.map((n) => `${n} (o item não tem código na ${app}: só pelo app)`),
];

/** O contexto do iFood da loja sem o token do centralizado (o Catalog só abre no distribuído). */
async function ctxDoCatalogo(franchiseeId: string, merchantId: string): Promise<ContextoIfood | null> {
  const ctx = await contextoDoPedido({ franchiseeId, ifoodStoreMerchant: merchantId });
  const credenciais = ctx.credenciais.filter((c) => c.origem !== "central");
  return credenciais.length ? { ...ctx, merchantId, credenciais } : null;
}

async function noIfood(franchiseeId: string, merchantId: string, produtos: ProdutoParaCasar[], ativo: boolean): Promise<ResultadoNoApp> {
  const r: ResultadoNoApp = { app: "iFood", onde: merchantId, feitos: [], naoAchados: [], erros: [], itemIds: [] };
  try {
    const ctx = await ctxDoCatalogo(franchiseeId, merchantId);
    if (!ctx) return { ...r, erros: [RECONECTAR_IFOOD] };
    r.loja = ctx.label;
    const cat = await listarCategorias(ctx, true);
    if (!cat.ok) return { ...r, erros: [cat.status === 401 || cat.status === 403 ? RECONECTAR_IFOOD : mensagemDeErro(cat)] };
    const casamento = casarProdutosComItens(produtos, itensDoCatalogoIfood(cat.data));
    r.naoAchados = naoAchadosDoCasamento(casamento, "iFood");
    for (const p of casamento.casados) {
      let tudo = true;
      for (const itemId of p.itemIds) {
        const s = await atualizarStatusItem(ctx, { itemId, status: ativo ? "AVAILABLE" : "UNAVAILABLE" });
        if (s.ok) r.itemIds.push(itemId);
        else {
          tudo = false;
          r.erros.push(`${p.nome}: ${mensagemDeErro(s)}`);
        }
      }
      if (tudo) r.feitos.push(p.nome);
    }
  } catch (err: any) {
    r.erros.push(err?.message || "Não deu para falar com o iFood.");
  }
  return r;
}

async function na99(appShopId: string, produtos: ProdutoParaCasar[], ativo: boolean): Promise<ResultadoNoApp> {
  const r: ResultadoNoApp = { app: "99", onde: appShopId, feitos: [], naoAchados: [], erros: [], itemIds: [] };
  try {
    const t = await getAuthToken(appShopId);
    if (!t.autorizada) return { ...r, erros: [RECONECTAR_99] };
    const menu = await cardapioDaLoja(t.token.auth_token);
    if (menu.errno !== 0) return { ...r, erros: [`A 99 não devolveu o cardápio (${menu.errmsg}).`] };
    const casamento = casarProdutosComItens(produtos, itensDoCardapio99(menu.data));
    r.naoAchados = naoAchadosDoCasamento(casamento, "99");
    const ids = casamento.casados.flatMap((c) => c.itemIds);
    if (!ids.length) return r;
    const s = await mudarStatusDosItens(t.token.auth_token, ids, ativo);
    if (s.errno !== 0) return { ...r, erros: [`A 99 recusou (${s.errno} ${s.errmsg}).`] };
    const falhou = new Set((s.data?.failed || []).map(String));
    for (const p of casamento.casados) {
      const ruins = p.itemIds.filter((id) => falhou.has(id));
      r.itemIds.push(...p.itemIds.filter((id) => !falhou.has(id)));
      if (ruins.length) r.erros.push(`${p.nome}: a 99 não aceitou`);
      else r.feitos.push(p.nome);
    }
  } catch (err: any) {
    r.erros.push(err?.message || "Não deu para falar com a 99.");
  }
  return r;
}

/** Os itens da pausa/reativação que o Bill acabou de fazer no FireHub. */
async function ultimaPausaNoFireHub(franchiseeId: string): Promise<{ ids: string[]; ativo: boolean } | null> {
  const regs = await prisma.assessorRegistro.findMany({
    where: { franchiseeId, desfeitoEm: null, tipo: { in: ["PAUSADO", "REATIVADO"] }, criadoEm: { gte: new Date(Date.now() - JANELA_DA_ULTIMA_PAUSA_MS) } },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
    take: 10,
    select: { refs: true },
  });
  const doFireHub = regs.map((r) => (r.refs || {}) as any).find((refs) => !refs.nosApps && Array.isArray(refs.ids) && refs.ids.length);
  return doFireHub ? { ids: doFireHub.ids.map(String), ativo: doFireHub.ativo === true } : null;
}

/** Produtos da loja com o que os espelhos de cada app sabem deles. */
async function produtosParaCasar(franchiseeId: string, ids: string[]) {
  const [produtos, espelhos] = await Promise.all([
    prisma.menuProduct.findMany({
      where: { id: { in: ids }, franchiseeId, origemIntegracao: null },
      select: { id: true, name: true, codigoPDV: true },
    }),
    prisma.menuProduct.findMany({
      where: { franchiseeId, vinculadoA: { in: ids }, origemIntegracao: { in: [ORIGENS.IFOOD, ORIGENS.FOOD99] } },
      select: { vinculadoA: true, name: true, codigoExterno: true, origemIntegracao: true },
    }),
  ]);
  const para = (origem: string): ProdutoParaCasar[] =>
    produtos.map((p) => {
      const meus = espelhos.filter((e) => e.vinculadoA === p.id && e.origemIntegracao === origem);
      return {
        id: p.id,
        nome: p.name,
        codigos: [...(p.codigoPDV != null ? [String(p.codigoPDV)] : []), p.id],
        nomesNoApp: meus.map((e) => e.name).filter(Boolean),
        idsNoApp: meus.map((e) => e.codigoExterno || "").filter(Boolean),
      };
    });
  return { produtos, ifood: para(ORIGENS.IFOOD), food99: para(ORIGENS.FOOD99) };
}

export async function pausarNosApps(args: any, ctx: ContextoDoAssessor) {
  let ids: string[] = Array.isArray(args?.produtoIds) ? args.produtoIds.map(String).filter(Boolean) : [];
  let ativo: boolean | null = typeof args?.ativo === "boolean" ? args.ativo : null;
  if (!ids.length) {
    const ultima = await ultimaPausaNoFireHub(ctx.franchiseeId);
    if (!ultima) return { ok: false, erro: "Não achei a pausa que acabou de ser feita: busque o item (buscar_no_cardapio) e mande os produtoIds e ativo." };
    ids = ultima.ids;
    ativo = ultima.ativo;
  }
  if (ativo === null) return { ok: false, erro: "Diga se é para pausar (ativo=false) ou reativar (ativo=true)." };

  const pedidos: string[] = Array.isArray(args?.apps) ? args.apps.map((a: unknown) => String(a).toUpperCase()) : [];
  const querIfood = !pedidos.length || pedidos.includes("IFOOD");
  const quer99 = !pedidos.length || pedidos.some((a) => a === "99" || a === "99FOOD");

  const apps = await appsDaLoja(ctx.franchiseeId);
  const { produtos, ifood, food99 } = await produtosParaCasar(ctx.franchiseeId, ids);
  if (!produtos.length) return { ok: false, erro: "Esses itens não são do cardápio desta loja." };

  const resultados: ResultadoNoApp[] = [];
  if (querIfood) {
    if (apps.ifood.length) for (const m of apps.ifood) resultados.push(await noIfood(ctx.franchiseeId, m, ifood, ativo));
    else if (apps.ifoodSoCentral) resultados.push({ app: "iFood", feitos: [], naoAchados: [], erros: [RECONECTAR_IFOOD], itemIds: [] });
  }
  if (quer99) for (const s of apps.food99) resultados.push(await na99(s, food99, ativo));
  if (!resultados.length) return { ok: false, erro: "A loja não tem iFood nem 99 conectados para o Bill mexer." };

  const verbo = ativo ? "Reativado" : "Pausado";
  const feitos = resultados.filter((r) => r.feitos.length);
  const resumo = feitos.length
    ? `${verbo} ${feitos.map((r) => `${r.app === "iFood" ? "no iFood" : "na 99"}${r.loja && apps.ifood.length > 1 ? ` (${r.loja})` : ""}: ${r.feitos.join(", ")}`).join(" · ")}`
    : "";

  if (feitos.length) {
    try {
      await prisma.assessorRegistro.create({
        data: {
          franchiseeId: ctx.franchiseeId,
          tipo: ativo ? "REATIVADO" : "PAUSADO",
          resumo: resumo.slice(0, 500),
          refs: comAutor({
            ids: produtos.map((p) => p.id),
            ativo,
            nosApps: {
              ifood: resultados.filter((r) => r.app === "iFood" && r.itemIds.length).map((r) => ({ merchantId: r.onde, itemIds: r.itemIds })),
              food99: resultados.filter((r) => r.app === "99" && r.itemIds.length).map((r) => ({ appShopId: r.onde, itemIds: r.itemIds })),
            },
          }, ctx) as any,
          canal: ctx.canal,
          telefone: ctx.telefone || null,
        },
      });
    } catch {}
  }

  return {
    ok: feitos.length > 0,
    resumo: resumo || undefined,
    porApp: resultados.map((r) => ({
      app: r.app,
      loja: apps.ifood.length > 1 && r.app === "iFood" ? r.loja : undefined,
      [ativo ? "reativados" : "pausados"]: r.feitos,
      naoAchei: r.naoAchados.length ? r.naoAchados : undefined,
      erros: r.erros.length ? r.erros : undefined,
    })),
    observacao: "Diga por app o que foi feito. O que não achei ou deu erro, o dono faz pelo app (iFood/99).",
  };
}

/** O "desfaz" de um registro com `nosApps`: volta o status lá, só nos itens que mudaram. */
export async function desfazerNosApps(refs: any, ctx: ContextoDoAssessor) {
  const voltaPara = !refs.ativo;
  let tentou = 0;
  let deu = 0;
  for (const l of refs.nosApps?.ifood || []) {
    const c = l.merchantId ? await ctxDoCatalogo(ctx.franchiseeId, l.merchantId).catch(() => null) : null;
    for (const itemId of l.itemIds || []) {
      tentou++;
      const s = c ? await atualizarStatusItem(c, { itemId, status: voltaPara ? "AVAILABLE" : "UNAVAILABLE" }).catch(() => null) : null;
      if (s?.ok) deu++;
    }
  }
  for (const l of refs.nosApps?.food99 || []) {
    const ids: string[] = l.itemIds || [];
    if (!ids.length) continue;
    tentou += ids.length;
    const t = l.appShopId ? await getAuthToken(l.appShopId).catch(() => null) : null;
    if (!t?.autorizada) continue;
    const s = await mudarStatusDosItens(t.token.auth_token, ids, voltaPara).catch(() => null);
    if (s?.errno === 0) deu += ids.length - (s.data?.failed || []).length;
  }
  if (tentou > 0 && deu === 0) throw new Error("Não consegui desfazer nos apps (iFood/99).");
}
