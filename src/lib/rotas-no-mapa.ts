/**
 * Quais rotas viram LINHA no mapa da roteirização — e por onde a linha passa.
 *
 * Lucas (Frangoso, 13/10/2026), que despacha a noite inteira por esta tela:
 * "quando despacha, vai para aquele monte de rota, monte de linha… fica um
 * monte de cor de linha, um monte de coisa doida, e o pedido fica embolado;
 * essa semana o motoboy não viu um pedido por causa disso".
 *
 * A aba ROTAS desenhava uma linha saindo da loja para CADA rota das últimas
 * 24 h — despachada ou não — e a linha passava também pelo ponto de pedido
 * que já tinha saído do mapa (entregue há mais de 10 s): linha para lugar
 * nenhum, por cima dos pinos que ainda importam.
 *
 * A regra agora:
 *   - linha da rota que AINDA NÃO SAIU (montada, à espera do motoboy) — é a
 *     que o lojista está conferindo;
 *   - linha da rota que ele pediu para ver ("Ver no mapa" no card), mesmo
 *     despachada — consultar continua possível, só não é imposto;
 *   - fora da aba ROTAS, nenhuma (a linha da SELEÇÃO em montagem é outra,
 *     desenhada à parte pela tela);
 *   - a linha só liga pinos que estão no mapa.
 *
 * E a linha segue a RUA (Douglas, 22/10/2026 21h15: a linha reta passava
 * "por cima de muros e casas"; tem que ser como o Google): cada perna (loja →
 * 1ª parada → … na ordem gravada, a `routeSequence`) vem desenhada pelo
 * roteador (POST /api/store/routes/desenho, `chaveDaPerna`/`linhaPelaRua`);
 * perna sem desenho fica reta, como antes.
 *
 * Puro, sem React nem Leaflet: scripts/teste-rotas-no-mapa.ts.
 */

export type Ponto = { lat: number; lng: number };

/** O mínimo de uma rota para decidir a linha (o RouteItem da tela serve). */
export type RotaNoMapa = { id: string; status?: string | null; orders: { id: string }[] };

/**
 * A rota já saiu com o motoboy?
 *
 * A tela guarda o status já traduzido ("🚀 Despachada" / "⏳ Aguardando
 * Despacho"); o servidor manda "DISPATCHED". Os dois valem. "Aguardando
 * Despacho" contém "Despach", não "Despachada" — não confunde.
 */
export function rotaJaDespachada(rota: { status?: string | null } | null | undefined): boolean {
  const s = String(rota?.status || "");
  return s.includes("Despachada") || s.trim().toUpperCase() === "DISPATCHED";
}

/** As rotas que ganham linha no mapa, na ordem em que vieram. */
export function rotasComLinha<R extends RotaNoMapa>(
  rotas: R[],
  { aba, rotaEmFoco }: { aba: string; rotaEmFoco: string | null },
): R[] {
  if (aba !== "ROTAS") return [];
  return rotas.filter((r) => !rotaJaDespachada(r) || r.id === rotaEmFoco);
}

/**
 * Os pontos da linha: a loja (quando se sabe onde ela fica) e, na ordem da
 * rota, cada pedido que tem pino no mapa. `noMapa` é a coordenada de quem tem
 * pino — pedido entregue, cancelado ou ainda sem endereço localizado não entra.
 * Menos de dois pontos não é linha: volta vazio.
 */
export function pontosDaLinha(
  rota: RotaNoMapa,
  noMapa: Record<string, Ponto | undefined>,
  loja: Ponto | null,
): [number, number][] {
  const pontos: [number, number][] = loja ? [[loja.lat, loja.lng]] : [];
  for (const o of rota.orders) {
    const c = noMapa[o.id];
    if (c) pontos.push([c.lat, c.lng]);
  }
  return pontos.length > 1 ? pontos : [];
}

/**
 * Tira do mapa de coordenadas quem não tem mais pino.
 *
 * As coordenadas achadas pela geocodificação só cresciam durante a noite —
 * e eram elas que davam ponto às linhas de pedido já entregue. Devolve o
 * MESMO objeto quando não há o que tirar, para o React não redesenhar o mapa
 * à toa.
 */
export function podarCoordenadas<T>(mapa: Record<string, T>, ficam: Set<string>): Record<string, T> {
  const saem = Object.keys(mapa).filter((id) => !ficam.has(id));
  if (saem.length === 0) return mapa;
  const novo = { ...mapa };
  for (const id of saem) delete novo[id];
  return novo;
}

/** Quantas pernas a tela pede de uma vez ao desenho pela rua (a API recusa mais). */
export const PERNAS_POR_PEDIDO_DE_DESENHO = 12;

/**
 * A chave de uma perna (de → para) a ~1 m (5 casas): a mesma perna da mesma
 * rota a cada 4 s da consulta acha o desenho já guardado, sem pedir de novo.
 */
export function chaveDaPerna(de: [number, number], para: [number, number]): string {
  const c = (n: number) => n.toFixed(5);
  return `${c(de[0])},${c(de[1])}>${c(para[0])},${c(para[1])}`;
}

/** As pernas da linha, em ordem: loja → 1ª parada, 1ª → 2ª, … */
export function pernasDaLinha(pontos: [number, number][]): { de: [number, number]; para: [number, number]; chave: string }[] {
  const pernas: { de: [number, number]; para: [number, number]; chave: string }[] = [];
  for (let i = 1; i < pontos.length; i++) pernas.push({ de: pontos[i - 1], para: pontos[i], chave: chaveDaPerna(pontos[i - 1], pontos[i]) });
  return pernas;
}

/**
 * A linha da rota pela rua: cada perna com desenho entra com o desenho dele
 * (que começa e termina na rua, perto dos pinos — a linha vai do pino até a
 * rua e volta, para não ficar solta); perna sem desenho fica reta, como antes.
 */
export function linhaPelaRua(
  pontos: [number, number][],
  desenhoDe: (chave: string) => [number, number][] | null | undefined,
): [number, number][] {
  if (pontos.length < 2) return pontos;
  const linha: [number, number][] = [pontos[0]];
  for (const perna of pernasDaLinha(pontos)) {
    const desenho = desenhoDe(perna.chave);
    if (desenho && desenho.length >= 2) linha.push(...desenho);
    linha.push(perna.para);
  }
  return linha;
}
