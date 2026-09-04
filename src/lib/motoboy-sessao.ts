/**
 * src/lib/motoboy-sessao.ts
 *
 * Sessão ASSINADA do app do motoboy — espelho de extensao-token.ts, que já
 * resolve exatamente este problema no projeto.
 *
 * Por que existe: o app do motoboy é uma página pública e a "sessão" era um
 * JSON solto no localStorage — qualquer rota que confiasse em `motoboyId` no
 * corpo confiava, na prática, em qualquer pessoa da internet. Para LER pedidos
 * já atribuídos isso era ruim; para o verbo novo de PUXAR pedido (o QR da
 * comanda) seria fatal: um endpoint público de escrita que destrava WhatsApp,
 * iFood conclude e NFC-e.
 *
 * O token: `v1.<motoboyId>.<storeId>.<expira>.<hmac>`, assinado com o
 * NEXTAUTH_SECRET. O hash da SENHA entra na assinatura de propósito: trocar ou
 * redefinir a senha invalida todas as sessões daquele entregador, sem coluna
 * nova e sem lista de revogação.
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

const VALIDADE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

function chave(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET ausente: não dá para assinar a sessão do motoboy.");
  return s;
}

function assinar(motoboyId: string, storeId: string, exp: number, hashSenha: string | null): string {
  const marcaDaSenha = crypto.createHash("sha256").update(String(hashSenha || "")).digest("hex").slice(0, 12);
  return crypto.createHmac("sha256", chave())
    .update(`motoboy:${motoboyId}:${storeId}:${exp}:${marcaDaSenha}`)
    .digest("hex").slice(0, 32);
}

export function criarSessaoDeMotoboy(motoboyId: string, storeId: string, hashSenha: string | null): string {
  const exp = Date.now() + VALIDADE_MS;
  return `v1.${motoboyId}.${storeId}.${exp}.${assinar(motoboyId, storeId, exp, hashSenha)}`;
}

/**
 * Confere assinatura, validade, existência, loja E `active` numa passada.
 * É async e lê o banco de propósito: a chave depende do hash da senha atual,
 * e a checagem de `active` exige a linha de qualquer jeito.
 * Devolve null para QUALQUER falha — quem chama responde 401 sem detalhar.
 */
export async function exigirMotoboy(req: NextRequest): Promise<{ id: string; name: string; franchiseeId: string } | null> {
  const bruto = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const partes = bruto.split(".");
  if (partes.length !== 5 || partes[0] !== "v1") return null;
  const [, motoboyId, storeId, expStr, sig] = partes;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;

  const mb = await prisma.motoboy.findUnique({
    where: { id: motoboyId },
    select: { id: true, name: true, franchiseeId: true, active: true, password: true },
  });
  if (!mb || !mb.active || mb.franchiseeId !== storeId) return null;

  const esperada = Buffer.from(assinar(motoboyId, storeId, exp, mb.password));
  const recebida = Buffer.from(sig);
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return null;

  return { id: mb.id, name: mb.name, franchiseeId: mb.franchiseeId };
}
