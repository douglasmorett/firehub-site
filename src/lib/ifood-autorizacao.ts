/**
 * /src/lib/ifood-autorizacao.ts
 *
 * A loja do iFood ainda autoriza o FireHub?
 *
 * Comunicado do iFood de 27/10/2026: a partir de 16/11/2026, loja parada no
 * iFood há 90 dias ou mais pode perder a autorização com a integradora. Daí em
 * diante toda chamada com aquele merchant volta 403, e a autorização antiga
 * não volta sozinha — o lojista tem que autorizar de novo. Sem isto a loja
 * seguia "🟢 Ativa" na tela de Integrações, o painel batia 403 no polling a
 * cada rodada e ninguém avisava o lojista.
 *
 * ── QUEM DECIDE É A LISTA DE LOJAS DO TOKEN, NÃO UM 403 ─────────────────────
 *
 * Um 403 sozinho não prova nada: neste app o módulo Merchant não é liberado
 * por loja (todo GET /merchants/{id} volta 403), a borda do iFood devolve 403
 * "Access Denied" de vez em quando (lib/ifood-acao-pendente.ts) e a cascata de
 * tokens tenta credencial errada antes da certa (lib/ifood-http.ts). Por isso
 * a pergunta é a que o iFood recomenda: a loja está entre as vinculadas ao
 * token? Essa lista vem de dois lugares, e vale a UNIÃO:
 *
 *   1. GET /merchant/v1.0/merchants — a resposta oficial. Neste app ela volta
 *      `200 []` (as lojas só autorizam Order e Events; ver ifood-api.ts), então
 *      hoje ela confirma que a API respondeu, mas não lista ninguém;
 *   2. o `merchant_scope` do próprio token (merchantsDoToken), que o iFood
 *      assina e reemite a cada renovação — é a mesma lista, do jeito que este
 *      app consegue ler.
 *
 * Só cai a loja que não aparece em NENHUMA das duas, no token que o FireHub usa
 * para ela, com o GET respondendo 200 e sem o app central enxergando a loja.
 * Qualquer dúvida (sem token novo, GET falhou) deixa tudo como está e tenta na
 * próxima volta. E quem reaparece na lista volta a "conectada" sozinha.
 *
 * O campo é `IfoodIntegration.connected`, que já existia e ficava sempre true:
 * `active` continua sendo "o lojista quer esta loja aqui", e `connected` passa
 * a dizer "o iFood ainda autoriza".
 */
import { prisma } from "./prisma";
import { getIfoodToken, merchantsDoToken } from "./ifood-api";
import { chamarIfood } from "./ifood-http";
import { gruposDePollingIfood } from "./ifood-token";

/** As lojas que um token enxerga, ou null quando o iFood não respondeu 200. */
async function lojasDoToken(token: string): Promise<Set<string> | null> {
  const r = await chamarIfood<any[]>(token, "/merchant/v1.0/merchants", { tentativasMax: 1 });
  if (!r.ok) return null;
  const daApi = Array.isArray(r.data) ? r.data.map((m) => String(m?.id || "")).filter(Boolean) : [];
  return new Set([...daApi, ...merchantsDoToken(token)]);
}

/**
 * A regra, sem rede nem banco: quem sai e quem volta.
 *
 * `servidas` são as lojas cujo token respondeu ao GET /merchants nesta volta
 * (as outras ficam como estão); `vinculadas`, a união do que os tokens da loja
 * e o central enxergam.
 */
export function decidirAutorizacao(
  integracoes: { merchantId: string; connected: boolean }[],
  servidas: Set<string>,
  vinculadas: Set<string>,
): { perderam: string[]; voltaram: string[] } {
  const perderam: string[] = [];
  const voltaram: string[] = [];
  for (const i of integracoes) {
    if (!servidas.has(i.merchantId)) continue;
    const autorizada = vinculadas.has(i.merchantId);
    if (i.connected && !autorizada) perderam.push(i.merchantId);
    if (!i.connected && autorizada) voltaram.push(i.merchantId);
  }
  return { perderam, voltaram };
}

/**
 * Confere as lojas iFood de UMA loja do FireHub e grava em `connected` o que
 * mudou. Chamado pelo cron do iFood, uma loja por rodada (api/cron/ifood-poll).
 */
export async function conferirAutorizacaoIfood(lojaId: string, nome: string, log: string[]): Promise<void> {
  // Os grupos primeiro: é aqui que os tokens vencidos são renovados, e a
  // leitura das integrações logo abaixo já pega o token novo de cada uma.
  const grupos = await gruposDePollingIfood(lojaId);
  const integracoes = await prisma.ifoodIntegration.findMany({
    where: { userId: lojaId, active: true },
    select: { merchantId: true, connected: true, accessToken: true },
  });
  if (integracoes.length === 0 || grupos.length === 0) return;

  const servidas = new Set<string>();
  const vinculadas = new Set<string>();
  for (const g of grupos) {
    if (g.merchants.length === 0) continue;
    const doToken = await lojasDoToken(g.token);
    if (!doToken) {
      log.push(`[autorização] ${nome}: GET /merchants não respondeu 200 — confiro na próxima volta`);
      continue;
    }
    g.merchants.forEach((m) => servidas.add(m));
    doToken.forEach((m) => vinculadas.add(m));
  }
  if (servidas.size === 0) return;

  // Token próprio que não serviu nesta volta (renovação falhou agora e a loja
  // caiu no token do usuário): o último escopo dele ainda vale. Renovação que
  // falha não é prova de que o iFood tirou a autorização.
  const tokensDosGrupos = new Set(grupos.map((g) => g.token));
  for (const i of integracoes) {
    if (i.accessToken && !tokensDosGrupos.has(i.accessToken)) {
      merchantsDoToken(i.accessToken).forEach((m) => vinculadas.add(m));
    }
  }

  // O central também atende a loja (lib/ifood-token.ts, cascata): o que ele
  // enxerga continua autorizado. Sem central, ou com ele fora, fica só o resto.
  if (process.env.IFOOD_CENTRAL_FALLBACK !== "off") {
    try {
      const doCentral = await lojasDoToken(await getIfoodToken());
      doCentral?.forEach((m) => vinculadas.add(m));
    } catch {
      /* central indisponível: não muda a conta de quem tem token próprio */
    }
  }

  const { perderam, voltaram } = decidirAutorizacao(integracoes, servidas, vinculadas);
  if (perderam.length > 0) {
    await prisma.ifoodIntegration.updateMany({
      where: { userId: lojaId, merchantId: { in: perderam } },
      data: { connected: false },
    });
    log.push(`[autorização] ${nome}: o iFood não lista mais ${perderam.join(", ")} — marcada(s) para autorizar de novo`);
    console.warn(`[iFood Autorização] ${nome} (${lojaId}): ${perderam.join(", ")} fora das lojas do token — connected=false.`);
  }
  if (voltaram.length > 0) {
    await prisma.ifoodIntegration.updateMany({
      where: { userId: lojaId, merchantId: { in: voltaram } },
      data: { connected: true },
    });
    log.push(`[autorização] ${nome}: ${voltaram.join(", ")} autorizada(s) de novo`);
    console.log(`[iFood Autorização] ${nome} (${lojaId}): ${voltaram.join(", ")} voltou a ser listada — connected=true.`);
  }
}
