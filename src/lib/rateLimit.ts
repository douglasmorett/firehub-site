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
 * Origem da requisição, para contagem de rate limit.
 *
 * Lia o PRIMEIRO endereço de X-Forwarded-For — que é justamente o que o cliente
 * escreve. Bastava mandar um X-Forwarded-For inventado e diferente a cada
 * requisição para cair sempre num balde novo: todo limite construído sobre isso
 * era contornável com um cabeçalho.
 *
 * A ordem agora é: cabeçalho que o próprio proxy escreve primeiro; e, no
 * encadeamento, o ÚLTIMO salto — o que o proxy mais próximo anexou — em vez do
 * primeiro, que veio de fora.
 */
export function getClientIp(req: Request): string {
  const direto = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  if (direto) return direto.trim();

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const saltos = forwarded.split(",").map(s => s.trim()).filter(Boolean);
    if (saltos.length) return saltos[saltos.length - 1];
  }
  return "unknown";
}
