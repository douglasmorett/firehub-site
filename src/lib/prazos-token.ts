import crypto from "crypto";

/**
 * Token da extensão FireHub Prazos: `<contaId>.<assinatura>`.
 *
 * Mesma ideia do token da extensão interna (lib/extensao-token.ts), mas num
 * namespace próprio (`prazos:`): um token de loja FireHub não abre uma conta
 * de Prazos, nem o contrário. E aqui não existe formato antigo para aceitar —
 * a extensão nasceu assinada.
 *
 * O token não expira sozinho: quem corta o uso é o `status` da conta, lido no
 * banco a cada chamada. Assinatura sem pagamento vira BLOQUEADO na Cakto e a
 * próxima chamada da extensão já recebe 402, com o token ainda válido.
 *
 * Marca da senha (auditoria F125/F131): trocar a senha não derrubava o token.
 * O token emitido agora é `<contaId>.<marca>.<assinatura>`, com a marca da
 * senha (lib/sessao-conferida.ts) dentro do texto assinado; senha nova = marca
 * nova = token velho recusado em `resolverConta`. O formato sem marca
 * (`<contaId>.<assinatura>`, emitido antes) continua valendo, para nenhuma
 * extensão instalada cair no dia do deploy.
 */
import { marcaDaSenha } from "./sessao-conferida";

function chave(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET ausente: não dá para assinar o token da extensão de prazos.");
  return s;
}

function assinar(contaId: string): string {
  return crypto.createHmac("sha256", chave()).update(`prazos:${contaId}`).digest("hex").slice(0, 32);
}

// Prefixo próprio: a assinatura do formato com marca nunca vale pelo sem marca.
function assinarComMarca(contaId: string, marca: string): string {
  return crypto.createHmac("sha256", chave()).update(`prazos-senha:${contaId}:${marca}`).digest("hex").slice(0, 32);
}

/** `senhaHash` da conta: o token leva a marca da senha e cai quando ela muda. */
export function criarTokenDePrazos(contaId: string, senhaHash: string): string {
  const marca = marcaDaSenha(senhaHash);
  return `${contaId}.${marca}.${assinarComMarca(contaId, marca)}`;
}

/** `marca` null = token antigo, sem marca (não cai por troca de senha). */
export type LeituraDoTokenDePrazos = { valido: true; contaId: string; marca: string | null } | { valido: false };

function confere(esperada: string, recebida: string): boolean {
  const a = Buffer.from(esperada);
  const b = Buffer.from(recebida);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function lerTokenDePrazos(token: string | null | undefined): LeituraDoTokenDePrazos {
  const bruto = String(token || "").trim();
  const partes = bruto.split(".");
  if (partes.some((p) => !p)) return { valido: false };
  if (partes.length === 2) {
    const [contaId, assinatura] = partes;
    return confere(assinar(contaId), assinatura) ? { valido: true, contaId, marca: null } : { valido: false };
  }
  if (partes.length === 3) {
    const [contaId, marca, assinatura] = partes;
    return confere(assinarComMarca(contaId, marca), assinatura) ? { valido: true, contaId, marca } : { valido: false };
  }
  return { valido: false };
}

/** O token ainda vale para a senha de agora? Sem marca (token antigo): sempre. */
export function tokenValeParaASenha(leitura: { marca: string | null }, senhaHash: string): boolean {
  return leitura.marca === null || leitura.marca === marcaDaSenha(senhaHash);
}
