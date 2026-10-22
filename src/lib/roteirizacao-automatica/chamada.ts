/**
 * Rota 100% automatizada — a CHAMADA do motoboy (Fase 2 do plano, vault
 * "FireHub - Plano despacho automático", D10/D11/D13): o que o push diz e
 * para quem vai. Puro de propósito (sem banco, sem rede): quem grava e manda
 * é executar.ts (`chamarARota`), usado pelo cron e pelo "Chamar de novo" /
 * "Trocar entregador" do card (POST /api/store/routes/chamar). O teste é
 * scripts/teste-roteirizacao-automatica.ts.
 *
 * Chamar NÃO é dar o pedido ao motoboy: grava só `RouteSchedule.chamadaEm` e
 * `chamadaMotoboyId`. O `CustomerOrder.motoboyId` continua nulo até alguém
 * escanear o QR (D7) — é o claim do puxar que decide quem leva.
 */

export type AvisoDaChamada = {
  titulo: string;
  corpo: string;
  dados: { tipo: "ROTA_PRONTA" | "ROTA_FOI_COM_OUTRO"; rotaId: string };
};

/** "#12, #15, #18" — em ordem de número; pedido sem número não aparece. */
function listaDeNumeros(numeros: (number | null | undefined)[]): string {
  return numeros
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b)
    .map((n) => `#${n}`)
    .join(", ");
}

/**
 * "🛵 Rota #7 pronta na loja · 3 entregas: #12, #15, #18. Vai lá buscar."
 * Para todos (ninguém na loja, ou "quem escanear primeiro"), a última frase
 * diz que é corrida: "Quem chegar primeiro sai com ela."
 */
export function avisoDaRotaPronta(
  rota: { id: string; routeNumber: string },
  numeros: (number | null | undefined)[],
  paraTodos: boolean,
): AvisoDaChamada {
  const lista = listaDeNumeros(numeros);
  const qtd = numeros.length;
  const entregas = `${qtd} entrega${qtd === 1 ? "" : "s"}${lista ? `: ${lista}` : ""}.`;
  return {
    titulo: `🛵 ${rota.routeNumber} pronta na loja`,
    corpo: `${entregas} ${paraTodos ? "Quem chegar primeiro sai com ela." : "Vai lá buscar."}`,
    dados: { tipo: "ROTA_PRONTA", rotaId: rota.id },
  };
}

/** Para quem ERA o chamado e deixou de ser (troca pela loja ou rechamada para outro). */
export function avisoDaRotaFoiComOutro(rota: { id: string; routeNumber: string }, nomeDoNovo: string | null | undefined): AvisoDaChamada {
  const primeiroNome = String(nomeDoNovo || "").trim().split(/\s+/)[0];
  return {
    titulo: `${rota.routeNumber} foi com ${primeiroNome || "outro entregador"}`,
    corpo: "A loja trocou o entregador desta rota.",
    dados: { tipo: "ROTA_FOI_COM_OUTRO", rotaId: rota.id },
  };
}

/** D10: o chamado recebe sozinho; chamada sem nome (null) vai para todos os livres. */
export function quemRecebeAChamada(motoboyId: string | null, livres: string[]): string[] {
  return motoboyId ? [motoboyId] : [...new Set(livres)];
}

/**
 * Quem perde a chamada e precisa saber: havia um chamado e o novo é OUTRO
 * motoboy. Chamar de novo o mesmo não avisa nada além do ROTA_PRONTA; abrir
 * para todos (novo = null) também não — o antigo é um dos livres e recebe o
 * "quem chegar primeiro sai com ela", e pode levar a rota.
 */
export function quemPerdeAChamada(anterior: string | null | undefined, novo: string | null): string | null {
  return anterior && novo && anterior !== novo ? anterior : null;
}
