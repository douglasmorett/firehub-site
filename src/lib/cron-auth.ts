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

  // Com o secret configurado, o Bearer certo autoriza de qualquer origem.
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader === `Bearer ${cronSecret}`) return true;
  }

  // Chamada interna do cron-runner (mesmo container, direto no localhost:3000).
  //
  // O critério antigo aceitava `x-forwarded-for: 127.0.0.1` — um header que o
  // CLIENTE escreve. Qualquer pessoa na internet disparava billing-close,
  // meta-ads-sync e afins com um curl. Agora:
  //   • x-forwarded-for NUNCA autoriza nada;
  //   • host localhost só vale se a requisição NÃO passou pelo proxy
  //     (o Traefik/Coolify sempre carimba x-forwarded-*; a chamada interna do
  //     cron-runner bate direto no Node e não tem esses headers).
  const host = req.headers.get("host") || "";
  const veioDoProxy =
    req.headers.has("x-forwarded-for") || req.headers.has("x-forwarded-host");
  const hostLocal =
    host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("0.0.0.0");

  if (hostLocal && !veioDoProxy) return true;

  // Externo sem o Bearer correto: recusado — inclusive quando CRON_SECRET não
  // está configurado (o fail-open antigo deixava a internet inteira rodar os
  // crons; o caminho interno acima mantém a VPS funcionando sem secret).
  return false;
}
