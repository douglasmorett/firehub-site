import { ipRealDoSalto } from "./ip-do-cloudflare";
/**
 * Rate limiter simples em memória para proteger rotas sensíveis.
 * Em produção com múltiplas instâncias, considerar Redis/KV.
 */

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

// Limpa entradas expiradas a cada 60 segundos
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of rateLimitMap.entries()) {
      if (now > value.resetTime) {
        rateLimitMap.delete(key);
      }
    }
  }, 60_000);
}

export interface RateLimitConfig {
  windowMs: number;    // Janela de tempo em ms
  maxRequests: number; // Máximo de requests na janela
}

export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = { windowMs: 60_000, maxRequests: 10 }
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(identifier, { count: 1, resetTime: now + config.windowMs });
    return { allowed: true, remaining: config.maxRequests - 1, resetIn: config.windowMs };
  }

  entry.count++;
  const remaining = Math.max(0, config.maxRequests - entry.count);
  const resetIn = entry.resetTime - now;

  if (entry.count > config.maxRequests) {
    return { allowed: false, remaining: 0, resetIn };
  }

  return { allowed: true, remaining, resetIn };
}

/**
 * Já gastou as `maxRequests` da janela? Só consulta, não conta. Para limitar
 * só o que dá ERRADO (senha, código): confere com isto antes e chama
 * checkRateLimit na falha — quem acerta nunca gasta cota.
 */
export function limiteEstourado(identifier: string, maxRequests: number): boolean {
  const entry = rateLimitMap.get(identifier);
  return !!entry && Date.now() <= entry.resetTime && entry.count >= maxRequests;
}

/**
 * Origem da requisição, para contagem de rate limit.
 *
 * Lia o PRIMEIRO endereço de X-Forwarded-For — que é justamente o que o cliente
 * escreve. Bastava mandar um X-Forwarded-For inventado e diferente a cada
 * requisição para cair sempre num balde novo: todo limite construído sobre isso
 * era contornável com um cabeçalho.
 *
 * A ordem agora prioriza o ÚLTIMO salto de X-Forwarded-For — o endereço que o
 * proxy MAIS PRÓXIMO (Traefik/Coolify) anexa, e que o cliente não consegue
 * forjar (o que ele manda fica ANTES na lista). Só se não houver XFF é que se
 * recorre a cf-connecting-ip / x-real-ip.
 *
 * Por que NÃO confiar em x-real-ip / cf-connecting-ip primeiro: nesta infra
 * (atrás do Traefik, sem Cloudflare) nada garante que o proxy sobrescreva
 * esses cabeçalhos. Um atacante mandava `x-real-ip: <aleatório>` a cada
 * requisição, caía sempre num balde novo e furava todo rate-limit — brute
 * force de senha, flood de pedidos, enumeração. O XFF-último-salto é o único
 * valor que o proxy sempre carimba.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const saltos = forwarded.split(",").map(s => s.trim()).filter(Boolean);
    // Atrás do Cloudflare o último salto é a borda dele; aí o cliente de
    // verdade vem no cf-connecting-ip (lib/ip-do-cloudflare.ts).
    if (saltos.length) return ipRealDoSalto(saltos[saltos.length - 1], req.headers.get("cf-connecting-ip"));
  }

  const direto = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  if (direto) return direto.trim();

  return "unknown";
}
