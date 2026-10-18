import crypto from "crypto";

/**
 * SESSÃO DO CLIENTE DO CARDÁPIO — a prova de que quem pede é o dono do telefone.
 *
 * O cardápio não tinha sessão: o telefone digitado é a identidade
 * (lib/cashback-no-banco.ts), e /api/customer-order é rota pública. Para o
 * cashback isso basta; para o Clube não — quem digitasse o telefone de um
 * assinante levaria o desconto que outra pessoa paga todo mês.
 *
 * Agora o login (POST /api/store-customer) devolve `sessao`: o id e o telefone
 * do cliente ASSINADOS com a chave das sessões (NEXTAUTH_SECRET), com validade.
 * O cardápio guarda no aparelho e manda no pedido; o servidor confere a
 * assinatura e o telefone. Sem a senha não se consegue uma sessão.
 *
 * Formato: `c1.<base64url do JSON {i,p,e}>.<hmac>` — sem dado além do id e do
 * telefone (que o próprio cliente já tem).
 */

const VALIDADE_DIAS = 180;

function chave(): string | null {
  return process.env.NEXTAUTH_SECRET || null;
}

function assinar(dados: string, k: string): string {
  return crypto.createHmac("sha256", k).update(`sessao-do-cliente:${dados}`).digest("base64url").slice(0, 43);
}

export type SessaoDoCliente = { clienteId: string; telefone: string };

/** null quando o servidor está sem a chave (aí o login funciona, só sem sessão). */
export function criarSessaoDoCliente(clienteId: string, telefone: string, agora: Date = new Date()): string | null {
  const k = chave();
  if (!k || !clienteId || !telefone) return null;
  const corpo = Buffer.from(
    JSON.stringify({ i: clienteId, p: String(telefone).replace(/\D/g, ""), e: Math.floor(agora.getTime() / 1000) + VALIDADE_DIAS * 86_400 }),
  ).toString("base64url");
  return `c1.${corpo}.${assinar(corpo, k)}`;
}

export function lerSessaoDoCliente(token: unknown, agora: Date = new Date()): SessaoDoCliente | null {
  const k = chave();
  if (!k || typeof token !== "string" || token.length > 600) return null;
  const partes = token.split(".");
  if (partes.length !== 3 || partes[0] !== "c1") return null;
  const [, corpo, assinatura] = partes;
  const esperada = assinar(corpo, k);
  if (assinatura.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada))) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
    if (typeof d?.i !== "string" || typeof d?.p !== "string" || typeof d?.e !== "number") return null;
    if (d.e * 1000 < agora.getTime()) return null;
    return { clienteId: d.i, telefone: d.p };
  } catch {
    return null;
  }
}
