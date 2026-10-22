/**
 * Rota 100% automatizada — o ponto que vale para a rota automática (D3 do
 * plano, vault "FireHub - Plano despacho automático").
 *
 * O `customerLatLng` gravado, pela regra única de lib/ponto-do-pedido.ts
 * (`lerPontoGravado` + `pontoGravadoVale` na área da loja) — e o centro do
 * bairro NÃO serve: rota automática com pino aproximado é pior que rota
 * nenhuma. Sem ponto, o pedido fica de fora ("📍 sem localização — rota
 * manual").
 *
 * Um arquivo só para os dois lados: o servidor decide com ele (executar.ts)
 * e a Roteirização escreve o selo na lista de pendentes com ele, sem
 * perguntar ao servidor a cada consulta. Sem banco (ponto-do-pedido.ts é puro).
 */
import { lerPontoGravado, pontoGravadoVale, type AreaDaLoja, type Ponto } from "@/lib/ponto-do-pedido";

export function pontoParaRotaAutomatica(customerLatLng: unknown, ehMarketplace: boolean, area: AreaDaLoja | null | undefined): Ponto | null {
  const gravado = lerPontoGravado(customerLatLng, ehMarketplace);
  return gravado && gravado.fonte !== "bairro" && pontoGravadoVale(gravado, area, ehMarketplace) ? gravado.ponto : null;
}
