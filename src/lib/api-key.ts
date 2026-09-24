import { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

export interface AuthenticatedApiContext {
  franchiseeId: string;
  keyId: string;
  keyName: string;
  permissions: string[];
}

/**
 * Criptografa o token de API em hash SHA-256 para armazenamento seguro no banco
 */
export function hashApiKey(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Gera um novo par de Chave de API:
 * @returns { rawKey, keyPrefix, keyHash }
 */
export function generateApiKeyPair(prefix = "fh_live_") {
  const randomBytes = crypto.randomBytes(24).toString("hex");
  const rawKey = `${prefix}${randomBytes}`;
  const keyPrefix = rawKey.substring(0, 12) + "...";
  const keyHash = hashApiKey(rawKey);

  return { rawKey, keyPrefix, keyHash };
}

/** A chave que só manda avisos para o WhatsApp do dono (/api/v1/avisos). */
export const PERMISSAO_AVISOS = "avisos:write";

/**
 * Valida o cabeçalho de autorização em requisições de API pública.
 * Suporta os cabeçalhos:
 * - Authorization: Bearer fh_live_...
 * - X-FireHub-API-Key: fh_live_...
 *
 * ── `exige`: a permissão que a rota precisa ──────────────────────────────────
 * As rotas de pedidos e cardápio nasceram antes de as permissões valerem e
 * chamam sem `exige`: para elas, basta a chave ter alguma permissão de pedidos
 * ou de cardápio — toda chave criada até 24/09/2026 tem as quatro, então nada
 * muda para quem já integra.
 *
 * O que muda é a chave de AVISOS: ela fica colada numa ferramenta de terceiro
 * (o ManyChat), e por isso só abre /api/v1/avisos. Sem esta regra, a mesma
 * chave que manda "fulano pediu palestra" leria e alteraria os pedidos da loja.
 */
export async function authenticateApiKey(req: NextRequest, exige?: string): Promise<AuthenticatedApiContext | null> {
  const authHeader = req.headers.get("authorization");
  const xApiKey = req.headers.get("x-firehub-api-key");

  let rawToken = "";
  if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
    rawToken = authHeader.substring(7).trim();
  } else if (xApiKey) {
    rawToken = xApiKey.trim();
  }

  if (!rawToken) return null;

  const keyHash = hashApiKey(rawToken);

  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { keyHash },
    select: {
      id: true,
      franchiseeId: true,
      name: true,
      permissions: true,
      active: true,
    },
  });

  if (!apiKeyRecord || !apiKeyRecord.active) return null;

  let permissions: string[] = ["orders:read", "orders:write", "menu:read", "menu:write"];
  if (Array.isArray(apiKeyRecord.permissions)) {
    permissions = apiKeyRecord.permissions.map(String);
  }

  const pode = exige
    ? permissions.includes(exige)
    : permissions.some((p) => p.startsWith("orders:") || p.startsWith("menu:"));
  if (!pode) return null;

  // Atualizar timestamp de último uso de forma não-bloqueante — depois da
  // checagem de permissão, para "último uso" não contar chamada recusada.
  prisma.apiKey
    .update({
      where: { id: apiKeyRecord.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return {
    franchiseeId: apiKeyRecord.franchiseeId,
    keyId: apiKeyRecord.id,
    keyName: apiKeyRecord.name,
    permissions,
  };
}
