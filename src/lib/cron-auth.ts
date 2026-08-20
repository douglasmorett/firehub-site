/**
 * src/lib/cron-auth.ts
 * Helper centralizado para autenticação de rotas de cron jobs.
 * 
 * Na VPS (Docker), o cron-runner.js roda no mesmo container e faz chamadas
 * via localhost:3000. Essas chamadas internas são seguras e não precisam
 * de CRON_SECRET. Chamadas externas continuam exigindo o token.
 */
import { NextRequest } from "next/server";

/**
 * Verifica se a requisição ao cron é autorizada.
 * Retorna true se autorizado, false se deve ser rejeitado com 401.
 * 
 * Regras:
 * 1. Em development: sempre autorizado
 * 2. Se CRON_SECRET não está configurado: sempre autorizado (compatibilidade Vercel sem secret)
 * 3. Se a chamada vem de localhost/127.0.0.1 (cron-runner interno): sempre autorizado
 * 4. Se CRON_SECRET está configurado: exige Bearer token válido
 */
export function verifyCronAuth(req: NextRequest): boolean {
  // Development mode: sempre autorizado
  if (process.env.NODE_ENV === "development") return true;

  const cronSecret = process.env.CRON_SECRET;

  // Se CRON_SECRET não está configurado, permite tudo (compatibilidade)
  if (!cronSecret) return true;

  // Chamadas internas do cron-runner (mesmo container) — bypass seguro
  const host = req.headers.get("host") || "";
  const forwardedFor = req.headers.get("x-forwarded-for") || "";
  const isLocalCall =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("0.0.0.0") ||
    forwardedFor.startsWith("127.0.0.1") ||
    forwardedFor.startsWith("::1");

  if (isLocalCall) return true;

  // Chamadas externas: exigem Bearer token
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}
