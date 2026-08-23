/**
 * /src/lib/meta-oauth-state.ts
 *
 * Assinatura do parâmetro `state` do OAuth do Meta.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 * O fluxo anterior montava o state NO NAVEGADOR:
 *
 *     const state = btoa(JSON.stringify({ franchiseeId: user.id, investment }))
 *
 * e o callback confiava nele para decidir em QUAL loja gravar o token do
 * Facebook — sem sessão, sem assinatura, sem validade. Qualquer pessoa podia
 * trocar o `franchiseeId` por base64 e induzir um lojista a autorizar: o token
 * de anúncios dele (com permissão `ads_management`) era gravado na conta do
 * atacante, que passava a gastar o dinheiro da conta de anúncios da vítima.
 *
 * Agora o state é criado e assinado no SERVIDOR, com HMAC da mesma chave que
 * assina as sessões, e carrega:
 *   - a loja (do lado do servidor, nunca do navegador)
 *   - um nonce, para o mesmo state não ser reaproveitado
 *   - a hora de emissão, para expirar em 15 minutos
 *
 * O callback continua exigindo sessão E que a loja do state seja a mesma da
 * sessão. Assinatura sozinha não basta: sem o confronto com a sessão, um state
 * legítimo capturado ainda poderia ser usado de outro navegador.
 */
import crypto from "crypto";
import { segredoObrigatorio } from "./segredos";

const VALIDADE_MS = 15 * 60 * 1000;

export type ConteudoDoState = {
  franchiseeId: string;
  investment?: number;
  nonce: string;
  emitidoEm: number;
};

function assinar(payloadB64: string): string {
  return crypto
    .createHmac("sha256", segredoObrigatorio("NEXTAUTH_SECRET"))
    .update(payloadB64)
    .digest("base64url");
}

/** Cria o state assinado. Só o servidor consegue produzir um válido. */
export function criarState(franchiseeId: string, investment?: number): string {
  const conteudo: ConteudoDoState = {
    franchiseeId,
    investment,
    nonce: crypto.randomBytes(12).toString("base64url"),
    emitidoEm: Date.now(),
  };
  const payload = Buffer.from(JSON.stringify(conteudo)).toString("base64url");
  return `${payload}.${assinar(payload)}`;
}

export type ResultadoDoState =
  | { ok: true; dados: ConteudoDoState }
  | { ok: false; motivo: "formato" | "assinatura" | "expirado" };

/** Confere assinatura e validade. Não decide autorização — quem decide é a sessão. */
export function lerState(state: string | null | undefined): ResultadoDoState {
  if (!state || !state.includes(".")) return { ok: false, motivo: "formato" };

  const [payload, assinatura] = state.split(".");
  if (!payload || !assinatura) return { ok: false, motivo: "formato" };

  const esperada = assinar(payload);

  // Comparação em tempo constante. Tamanhos diferentes fazem timingSafeEqual
  // lançar, então o tamanho é conferido antes.
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, motivo: "assinatura" };
  }

  let dados: ConteudoDoState;
  try {
    dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, motivo: "formato" };
  }

  if (!dados?.franchiseeId || typeof dados.emitidoEm !== "number") {
    return { ok: false, motivo: "formato" };
  }
  if (Date.now() - dados.emitidoEm > VALIDADE_MS) {
    return { ok: false, motivo: "expirado" };
  }

  return { ok: true, dados };
}
