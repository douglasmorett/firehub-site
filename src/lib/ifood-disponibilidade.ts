/**
 * A loja está aberta para o cliente do iFood agora?
 *
 * Usada pelo aviso "loja fechada no iFood" (api/cron/abertura-da-loja). Duas
 * fontes, nesta ordem:
 *
 *   1. A Merchant API (`/merchants/{id}/status`), com a credencial da loja. É a
 *      que diz o PORQUÊ ("Fora do horário", "Loja pausada") — vai na mensagem.
 *   2. A vitrine pública (`marketplace.ifood.com.br/v1/merchants/{id}`), o que
 *      o app do cliente lê: só `available`. Existe porque a primeira responde
 *      403 quando o aplicativo não tem o módulo Merchant liberado — foi o que
 *      voltou para a Hakim Centro em 25/09/2026 com as três credenciais —, e
 *      um aviso que depende de permissão que a loja não tem não avisa ninguém.
 *
 * Nenhuma das duas respondeu = `aberta: null`. "Não sei" nunca vira "fechada":
 * aviso falso ensina o dono a ignorar o verdadeiro.
 */
import { contextoIfood } from "@/lib/ifood-token";
import { chamarComContexto } from "@/lib/ifood-http";

export type DisponibilidadeNoIfood = {
  aberta: boolean | null;
  /** O motivo, quando o iFood diz ("Loja fechada — Fora do horário de funcionamento"). */
  motivo: string | null;
  fonte: "merchant" | "vitrine" | null;
};

/** Lê a resposta de `/merchants/{id}/status`: lista de operações, cada uma com `available` e `message`. */
export function lerStatusDoMerchant(data: unknown): { aberta: boolean; motivo: string | null } | null {
  const itens = (Array.isArray(data) ? data : data ? [data] : []).filter((s: any) => s && typeof s === "object");
  if (itens.length === 0) return null;
  if (!itens.some((s: any) => typeof s.available === "boolean")) return null;
  const aberta = itens.some((s: any) => s.available === true);
  if (aberta) return { aberta: true, motivo: null };
  const fechada: any = itens[0];
  const partes = [fechada?.message?.title, fechada?.message?.subtitle]
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter(Boolean);
  return { aberta: false, motivo: partes.length > 0 ? partes.join(" — ") : null };
}

async function pelaVitrine(merchantId: string, ponto?: { lat: number; lng: number } | null): Promise<boolean | null> {
  const qs = new URLSearchParams({ channel: "IFOOD" });
  if (ponto && Number.isFinite(ponto.lat) && Number.isFinite(ponto.lng)) {
    qs.set("latitude", String(ponto.lat));
    qs.set("longitude", String(ponto.lng));
  }
  try {
    const r = await fetch(`https://marketplace.ifood.com.br/v1/merchants/${encodeURIComponent(merchantId)}?${qs}`, {
      headers: { "User-Agent": "Mozilla/5.0 (FireHub)", Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j: any = await r.json().catch(() => null);
    return typeof j?.available === "boolean" ? j.available : null;
  } catch {
    return null;
  }
}

/**
 * @param integrada true quando o merchant está em IfoodIntegration (a busca
 *        da credencial vai por ele); false para o vínculo antigo em
 *        User.ifoodMerchantId, que o `contextoIfood` só acha sem merchantId.
 */
export async function disponibilidadeNoIfood(o: {
  email: string;
  merchantId: string;
  integrada: boolean;
  ponto?: { lat: number; lng: number } | null;
}): Promise<DisponibilidadeNoIfood> {
  try {
    const ctx = await contextoIfood({ email: o.email, merchantId: o.integrada ? o.merchantId : null });
    const r = await chamarComContexto(ctx, `/merchant/v1.0/merchants/${o.merchantId}/status`);
    const lido = r.ok ? lerStatusDoMerchant(r.data) : null;
    if (lido) return { ...lido, fonte: "merchant" };
  } catch {
    // Sem credencial ou loja desconectada: a vitrine ainda responde.
  }
  const aberta = await pelaVitrine(o.merchantId, o.ponto);
  return { aberta, motivo: null, fonte: aberta === null ? null : "vitrine" };
}
