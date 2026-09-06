import { prisma } from "@/lib/prisma";
import { listarLojasAutorizadas, vincularLojas, getAuthToken, type LojaAutorizada } from "@/lib/food99-api";
import {
  lojas99DaConta,
  salvarLoja99,
  slotsDaConta,
  donosPorShopId,
  donosPorAppShopId,
  trocarAppShopId,
} from "@/lib/food99-lojas";

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

/**
 * Lojas que o 99Food JÁ vinculou ao app — com o app_shop_id que ELES
 * escolheram — e que nenhuma conta do FireHub reconhece ainda (ou que já são
 * desta conta).
 *
 * ── O que a v3 mostrou em 06/09/2026 ────────────────────────────────────────
 *
 * A página de autorização vincula, sim — mas com um id do 99Food (o próprio
 * shop_id, ou algo como `BCkpxsW2KAHowtV574U2-4253`), nunca com o nosso. As
 * três lojas do Lucas estavam vinculadas o dia inteiro, e o FireHub perguntava
 * pelo id dele. Reconhecer o id deles é o que fecha o autoatendimento: o
 * lojista autoriza, o 99Food vincula, e a tela adota o vínculo.
 */
export async function vinculadasSemDonoPara(
  lojaId: string
): Promise<
  | { ok: true; lojas: LojaAutorizada[]; deOutroIntegrador: LojaAutorizada[] }
  | { ok: false; erro: string; errno: number }
> {
  const r = await listarLojasAutorizadas();
  if (!r.ok) return { ok: false, erro: r.erro, errno: r.errno };

  const [donosApp, donosShop] = await Promise.all([donosPorAppShopId(), donosPorShopId()]);
  const semDono = r.lojas.filter((l) => {
    if (!l.vinculada || !l.appShopId) return false;
    const donoApp = donosApp.get(l.appShopId);
    const donoShop = donosShop.get(l.shopId);
    // Já é desta conta com este mesmo id → nada a adotar (o token já é lido
    // direto). Se pertence a OUTRA conta por qualquer um dos dois ids, não é
    // candidata: adivinhar aqui é despejar pedido na cozinha errada.
    if (donoApp === lojaId) return false;
    if (donoApp && donoApp !== lojaId) return false;
    if (donoShop && donoShop !== lojaId) return false;
    return true;
  });

  // ── "Vinculada" a quem? ─────────────────────────────────────────────────
  //
  // O getAuthorizedShops diz `bound_flag 1` para loja vinculada a QUALQUER
  // integrador, e o app_shop_id que vem junto é o do integrador que a tem.
  // Em 06/09 as três lojas do Lucas vinham "vinculadas" — ao Saipos e ao
  // Brendi, não ao FireHub — e o token por esses ids é 10101 para nós. A doc
  // do shopBind é explícita: "the store must be unbound". Uma loja por
  // integrador. Então só é adotável a que devolve token; as outras estão com
  // outro sistema, e a tela precisa dizer isso com todas as letras.
  const lojas: LojaAutorizada[] = [];
  const deOutroIntegrador: LojaAutorizada[] = [];
  for (const l of semDono) {
    const t = await getAuthToken(l.appShopId as string);
    (t.autorizada ? lojas : deOutroIntegrador).push(l);
  }
  return { ok: true, lojas, deOutroIntegrador };
}

/**
 * Adota um vínculo que o 99Food fez com o id DELES: confirma que o token vem
 * por esse id, grava a loja com ele e passa a usá-lo. Se a conta já tinha a
 * mesma loja gravada com um id antigo (reautorização), a linha é atualizada —
 * não duplicada.
 */
export async function adotarVinculo(lojaId: string, loja: LojaAutorizada): Promise<ResultadoVinculo> {
  if (!loja.appShopId) return { ok: false, erro: "o 99Food não informou o app_shop_id desta loja" };

  const t = await getAuthToken(loja.appShopId);
  if (!t.autorizada) {
    return { ok: false, erro: `o 99Food diz que a loja está vinculada, mas não devolve token para ${loja.appShopId}` };
  }

  const gravadas = await lojas99DaConta(lojaId).catch(() => []);
  const mesmaLoja = gravadas.find((g) => g.shopId === loja.shopId);
  let gravou = false;
  if (mesmaLoja && mesmaLoja.appShopId !== loja.appShopId) {
    gravou = await trocarAppShopId(lojaId, loja.shopId, loja.appShopId);
  }
  if (!gravou) {
    await salvarLoja99({ userId: lojaId, appShopId: loja.appShopId, shopId: loja.shopId, label: loja.nome }).catch(
      () => false
    );
  }
  await prisma.user
    .update({
      where: { id: lojaId },
      data: { food99AppId: loja.appShopId, food99MerchantId: loja.shopId, food99Connected: true },
    })
    .catch(() => null);

  console.log(
    `[99Food] vínculo adotado: conta ${lojaId} ↔ shop ${loja.shopId} (${loja.nome ?? "sem nome"}) com o app_shop_id do 99Food ${loja.appShopId}`
  );
  return {
    ok: true,
    appShopId: loja.appShopId,
    shopId: loja.shopId,
    nome: loja.nome,
    expiraEm: new Date(t.token.token_expiration_time * 1000).toISOString(),
  };
}

export async function religarVinculosDaConta(lojaId: string): Promise<{ religadas: string[]; erro?: string }> {
  const gravadas = (await lojas99DaConta(lojaId).catch(() => [])).filter((g) => g.shopId);
  if (gravadas.length === 0) return { religadas: [] };

  const r = await listarLojasAutorizadas();
  if (!r.ok) return { religadas: [], erro: r.erro };

  const religadas: string[] = [];

  // Caso 1: a loja segue vinculada, mas sob um id NOVO do 99Food (o lojista
  // reautorizou pela página deles). Adotar o id novo é o que religa.
  for (const g of gravadas) {
    const la = r.lojas.find((l) => l.shopId === g.shopId && l.vinculada && l.appShopId && l.appShopId !== g.appShopId);
    if (!la) continue;
    const a = await adotarVinculo(lojaId, la);
    if (a.ok) religadas.push(a.appShopId);
    else console.warn(`[99Food] adotar id novo de ${g.shopId} falhou: ${a.erro}`);
  }

  // Caso 2: a loja está autorizada e SEM vínculo — refaz com o mesmo id de antes.
  const pendentes = gravadas.filter((g) => r.lojas.some((l) => l.shopId === g.shopId && !l.vinculada));
  if (pendentes.length > 0) {
    const v = await vincularLojas(pendentes.map((g) => ({ shopId: g.shopId as string, appShopId: g.appShopId })));
    if (!v.ok) return { religadas, erro: v.erro };
    for (const s of v.sucesso) {
      console.log(`[99Food] vínculo religado: ${s.appShopId} ↔ shop ${s.shopId}`);
      religadas.push(s.appShopId);
      // A linha volta a contar como conectada — é o que a cobrança e a tela
      // leem. Sem isto a loja religada ficava `connected = false` para sempre.
      const g = gravadas.find((x) => x.shopId === s.shopId);
      await salvarLoja99({ userId: lojaId, appShopId: s.appShopId, shopId: s.shopId, label: g?.label ?? null }).catch(
        () => false
      );
    }
    for (const f of v.falha) console.warn(`[99Food] religar ${f.appShopId} ↔ shop ${f.shopId} recusado: ${f.motivo}`);
  }

  return { religadas };
}
