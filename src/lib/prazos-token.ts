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
 */
function chave(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET ausente: não dá para assinar o token da extensão de prazos.");
  return s;
}

function assinar(contaId: string): string {
  return crypto.createHmac("sha256", chave()).update(`prazos:${contaId}`).digest("hex").slice(0, 32);
}

export function criarTokenDePrazos(contaId: string): string {
  return `${contaId}.${assinar(contaId)}`;
}

export type LeituraDoTokenDePrazos = { valido: true; contaId: string } | { valido: false };

export function lerTokenDePrazos(token: string | null | undefined): LeituraDoTokenDePrazos {
  const bruto = String(token || "").trim();
  const partes = bruto.split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) return { valido: false };
  const [contaId, assinatura] = partes;
  const esperada = Buffer.from(assinar(contaId));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) {
    return { valido: false };
  }
  return { valido: true, contaId };
}
