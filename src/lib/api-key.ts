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

/**
 * Valida o cabeçalho de autorização em requisições de API pública.
 * Suporta os cabeçalhos:
 * - Authorization: Bearer fh_live_...
 * - X-FireHub-API-Key: fh_live_...
 */
export async function authenticateApiKey(req: NextRequest): Promise<AuthenticatedApiContext | null> {
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

  // Atualizar timestamp de último uso de forma não-bloqueante
  prisma.apiKey
    .update({
      where: { id: apiKeyRecord.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  let permissions: string[] = ["orders:read", "orders:write", "menu:read", "menu:write"];
  if (Array.isArray(apiKeyRecord.permissions)) {
    permissions = apiKeyRecord.permissions.map(String);
  }

  return {
    franchiseeId: apiKeyRecord.franchiseeId,
    keyId: apiKeyRecord.id,
    keyName: apiKeyRecord.name,
    permissions,
  };
}
