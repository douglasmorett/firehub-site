/**
 * Roda UMA vez quando uma instância nova do servidor sobe, e o Next só começa
 * a aceitar requisições depois que isto termina. É essa garantia de ordem que
 * este arquivo compra.
 */
export async function register() {
  // Só no runtime Node de um servidor de verdade — nunca no edge e nunca
  // durante o `next build` (os workers de prerender não precisam de DDL).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { garantirColunasDePreco } = await import("./lib/garantir-colunas");
  await garantirColunasDePreco();
}
