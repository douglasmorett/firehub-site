/**
 * O token do link pessoal da escala (/escala/<código>/minha/<token>) — sem
 * banco, para o teste (scripts/teste-escala-da-equipe.ts) conferir também.
 *
 * "tipo + id da pessoa" assinado (HMAC) junto com o código do link da loja:
 * ninguém inventa o de um colega, e "gerar link novo" na loja invalida todos —
 * como o link do grupo. O token se confere sozinho, sem tabela.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { ehTipoDePessoa, type TipoDePessoa } from "./regras";

const LETRA: Record<TipoDePessoa, string> = { equipe: "e", motoboy: "m", freelancer: "f" };
const DA_LETRA: Record<string, TipoDePessoa> = { e: "equipe", m: "motoboy", f: "freelancer" };

/** A assinatura (hex, 24 letras). */
export function assinaturaDoLink(segredo: string, codigo: string, tipo: TipoDePessoa, id: string): string {
  return createHmac("sha256", segredo).update(`escala-pessoal|${codigo}|${tipo}|${id}`).digest("hex").slice(0, 24);
}

export function tokenDaPessoa(segredo: string, codigo: string, tipo: TipoDePessoa, id: string): string {
  return `${LETRA[tipo]}${id}-${assinaturaDoLink(segredo, codigo, tipo, id)}`;
}

/** O token vale para este código de link? Devolve quem é — ou nulo (token velho, inventado ou de outra loja). */
export function lerTokenDaPessoa(segredo: string, codigo: string, token: string): { tipo: TipoDePessoa; id: string } | null {
  const m = /^([emf])([A-Za-z0-9_-]{6,64})-([0-9a-f]{24})$/.exec(String(token || ""));
  if (!m) return null;
  const tipo = DA_LETRA[m[1]];
  if (!ehTipoDePessoa(tipo)) return null;
  const certa = Buffer.from(assinaturaDoLink(segredo, codigo, tipo, m[2]));
  const veio = Buffer.from(m[3]);
  return certa.length === veio.length && timingSafeEqual(certa, veio) ? { tipo, id: m[2] } : null;
}
