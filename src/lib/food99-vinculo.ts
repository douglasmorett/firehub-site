import { prisma } from "@/lib/prisma";
import { listarLojasAutorizadas, vincularLojas, type LojaAutorizada } from "@/lib/food99-api";
import { lojas99DaConta, salvarLoja99, slotsDaConta, donosPorShopId } from "@/lib/food99-lojas";

/**
 * /src/lib/food99-vinculo.ts — a "etapa 2" do 99Food, por API.
 *
 * ── O que ninguém tinha entendido até 06/09/2026 ────────────────────────────
 *
 * No 99Food, o lojista AUTORIZA o app (etapa 1, na página do getUrl) e o
 * desenvolvedor VINCULA a loja a um app_shop_id (etapa 2). Só a etapa 2 cria o
 * token, e só ela faz a loja aparecer no shop/list e no webhook. A doc oficial
 * tem os dois endpoints da etapa 2 — `getAuthorizedShops` (quem autorizou e
 * espera) e `shopBind` (vincula, e já devolve o token) — e o swagger v1 que o
 * FireHub usava não tinha nenhum dos dois.
 *
 * O FireHub fazia só a etapa 1 e esperava o token aparecer. Para a Brasa
 * Burguer alguém completou a etapa 2 à mão no portal em agosto; para o
 * Frangoso ninguém completou, e a tela dizia "não autorizada" para uma loja
 * que tinha autorizado três vezes.
 *
 * ── O que este módulo garante ───────────────────────────────────────────────
 *
 * - `vincularParaConta`: fecha a etapa 2 para UMA loja autorizada, com o id
 *   desta conta (a primeira loja fica com o id da conta, as seguintes com
 *   `<id>-2`, `<id>-3`… — ver slotsDaConta). Se a loja já teve linha aqui,
 *   reusa o app_shop_id antigo: webhook, histórico e cobrança continuam
 *   batendo.
 * - `autorizadasLivresPara`: o que esta conta PODE reivindicar — autorizadas,
 *   sem vínculo, e sem dono em outra conta do FireHub. O getAuthorizedShops
 *   lista as lojas de todos os clientes; sem esse filtro, a conta A vincularia
 *   a loja da conta B.
 * - `religarVinculosDaConta`: a loja que já era desta conta e perdeu o vínculo
 *   (segue autorizada, `bound_flag` 0) volta com o mesmo id, sem ninguém
 *   clicar. É o cron de abertura quem chama — e é o que traz a Brasa de volta.
 */

export type ResultadoVinculo =
  | { ok: true; appShopId: string; shopId: string; nome: string | null; expiraEm: string }
  | { ok: false; erro: string };

export async function vincularParaConta(
  lojaId: string,
  loja: { shopId: string; nome: string | null }
): Promise<ResultadoVinculo> {
  const gravadas = await lojas99DaConta(lojaId).catch(() => []);
  const jaTemLinha = gravadas.find((g) => g.shopId === loja.shopId);
  const { proximo } = slotsDaConta(lojaId, gravadas);
  const appShopId =
    jaTemLinha?.appShopId ?? (gravadas.some((g) => g.appShopId === lojaId) ? proximo : lojaId);

  const v = await vincularLojas([{ shopId: loja.shopId, appShopId }]);
  if (!v.ok) return { ok: false, erro: v.erro };

  const feito = v.sucesso.find((s) => s.shopId === loja.shopId);
  if (!feito) {
    const f = v.falha.find((x) => x.shopId === loja.shopId);
    return { ok: false, erro: f ? `o 99Food recusou o vínculo: ${f.motivo}` : "o 99Food não confirmou o vínculo" };
  }

  // Tabela primeiro (é ela que aceita a segunda loja), colunas do User depois
  // (plano B de tudo que ainda as lê).
  await salvarLoja99({ userId: lojaId, appShopId, shopId: loja.shopId, label: loja.nome }).catch(() => false);
  await prisma.user
    .update({
      where: { id: lojaId },
      data: { food99AppId: appShopId, food99MerchantId: loja.shopId, food99Connected: true },
    })
    .catch(() => null);

  console.log(
    `[99Food] vínculo criado: conta ${lojaId} ↔ shop ${loja.shopId} (${loja.nome ?? "sem nome"}) como app_shop_id ${appShopId}`
  );
  return {
    ok: true,
    appShopId,
    shopId: loja.shopId,
    nome: loja.nome,
    expiraEm: new Date(feito.expiraEm * 1000).toISOString(),
  };
}

export async function autorizadasLivresPara(
  lojaId: string
): Promise<{ ok: true; livres: LojaAutorizada[]; total: number } | { ok: false; erro: string; errno: number }> {
  const r = await listarLojasAutorizadas();
  if (!r.ok) return { ok: false, erro: r.erro, errno: r.errno };

  const donos = await donosPorShopId();
  const livres = r.lojas.filter((l) => {
    if (l.vinculada) return false;
    const dono = donos.get(l.shopId);
    return !dono || dono === lojaId;
  });
  return { ok: true, livres, total: r.lojas.length };
}

export async function religarVinculosDaConta(lojaId: string): Promise<{ religadas: string[]; erro?: string }> {
  const gravadas = (await lojas99DaConta(lojaId).catch(() => [])).filter((g) => g.shopId);
  if (gravadas.length === 0) return { religadas: [] };

  const r = await listarLojasAutorizadas();
  if (!r.ok) return { religadas: [], erro: r.erro };

  const pendentes = gravadas.filter((g) => r.lojas.some((l) => l.shopId === g.shopId && !l.vinculada));
  if (pendentes.length === 0) return { religadas: [] };

  const v = await vincularLojas(pendentes.map((g) => ({ shopId: g.shopId as string, appShopId: g.appShopId })));
  if (!v.ok) return { religadas: [], erro: v.erro };

  for (const s of v.sucesso) console.log(`[99Food] vínculo religado: ${s.appShopId} ↔ shop ${s.shopId}`);
  for (const f of v.falha) console.warn(`[99Food] religar ${f.appShopId} ↔ shop ${f.shopId} recusado: ${f.motivo}`);
  return { religadas: v.sucesso.map((s) => s.appShopId) };
}
