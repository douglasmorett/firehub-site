/**
 * Teto para o código ERRADO da TV do Painel de senhas (lib/painel-de-senhas.ts).
 *
 * O código é a única senha da TV, e /tv/<código> o procura entre todas as
 * lojas: sem teto, dava para varrer os códigos e ler o painel de uma loja
 * qualquer (auditoria de 23/10/2026). Por isso:
 *   - só o código errado conta: a TV que funciona pergunta a cada 4 s e nunca
 *     gasta cota;
 *   - o mesmo código errado repetido conta UMA vez: as TVs que ficaram com o
 *     código velho depois da troca não travam a rede da loja — quem varre
 *     precisa de códigos diferentes.
 */
import { checkRateLimit, limiteEstourado } from "@/lib/rateLimit";

const JANELA_MS = 10 * 60_000;
export const CODIGOS_ERRADOS_POR_IP = 20;

/** Este IP já errou códigos demais na janela? Consulta sem contar. */
export function tvBloqueada(ip: string): boolean {
  return limiteEstourado(`tv-erros:${ip}`, CODIGOS_ERRADOS_POR_IP);
}

/** Anota um código errado (`codigo` pode levar a loja junto: "loja:código"). */
export function contarCodigoErrado(ip: string, codigo: string): void {
  if (checkRateLimit(`tv-errado:${ip}:${codigo}`, { windowMs: JANELA_MS, maxRequests: 1 }).allowed) {
    checkRateLimit(`tv-erros:${ip}`, { windowMs: JANELA_MS, maxRequests: CODIGOS_ERRADOS_POR_IP });
  }
}
