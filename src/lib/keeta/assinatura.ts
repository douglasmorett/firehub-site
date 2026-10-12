/**
 * lib/keeta/assinatura.ts — o `X-App-Signature` da Keeta, nos dois sentidos.
 *
 * FireHub → Keeta (toda chamada menos /oauth/token):
 *   base64( HMAC-SHA256( client_secret, URL [+ "&" + query ordenada] [+ "&" + corpo] ) )
 *   - URL completa, com esquema e host, sem `?query`;
 *   - query ordenada pela chave, `chave=valor` cru (sem url-encode), unida por `&`;
 *   - corpo: a string JSON exata que vai no fio; corpo vazio, `{}` ou só
 *     espaços é pulado (e o `&` dele também).
 *   Conferido contra a implementação de referência da doc e o script da coleção
 *   Postman oficial (scripts/teste-keeta-assinatura.ts tem os vetores).
 *
 * Keeta → FireHub (webhook de pedido e de autorização):
 *   base64( HMAC-SHA256( client_secret, corpo cru ) ).
 *   A doc não traz exemplo numérico: as primeiras chamadas reais vão para o
 *   payload cru com o resultado da conferência (lib/keeta/webhook).
 *
 * Quando a Keeta recusa a nossa, a mensagem diz a que ela esperava
 * ("Invalid signature, Keeta sig is XXXXX") — o api.ts loga isso.
 */
import { createHmac, timingSafeEqual } from "crypto";

export function textoParaAssinar(url: string, query?: Record<string, unknown> | null, corpo?: string | null): string {
  const partes = [url.split("?")[0]];
  const chaves = Object.keys(query || {}).sort();
  for (const k of chaves) {
    const v = (query as Record<string, unknown>)[k];
    partes.push(`&${k}=${v == null ? "" : String(v)}`);
  }
  const c = (corpo ?? "").trim();
  if (c && c !== "{}") partes.push(`&${corpo}`);
  return partes.join("");
}

export function hmacBase64(segredo: string, mensagem: string | Buffer): string {
  return createHmac("sha256", Buffer.from(segredo, "utf8")).update(mensagem).digest("base64");
}

export function assinarChamada(segredo: string, url: string, query?: Record<string, unknown> | null, corpo?: string | null): string {
  return hmacBase64(segredo, textoParaAssinar(url, query, corpo));
}

/** Confere a assinatura do webhook em tempo constante, sobre os bytes crus. */
export function webhookAssinadoPelaKeeta(segredo: string, corpoCru: string | Buffer, assinatura: string | null | undefined): boolean {
  if (!segredo || !assinatura) return false;
  const esperada = Buffer.from(hmacBase64(segredo, corpoCru));
  const recebida = Buffer.from(String(assinatura).trim());
  return esperada.length === recebida.length && timingSafeEqual(esperada, recebida);
}
