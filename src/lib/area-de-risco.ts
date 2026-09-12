/**
 * Onde a loja NÃO entrega, por mais perto que seja.
 *
 * ── Por que raio não resolve ────────────────────────────────────────────────
 *
 * A área de entrega é um círculo (ou uma lista de bairros), e nenhum dos dois
 * consegue dizer "aqui não". A favela do outro lado da avenida está a 900 m e
 * cai dentro do raio de 3 km; o bairro inteiro está cadastrado, mas há três
 * ruas dele onde o entregador não sobe depois das 22h. Hoje a loja resolve isso
 * ligando para o cliente e cancelando o pedido — com a comida pronta.
 *
 * Área de risco é um polígono desenhado no mapa. Quem cai dentro dele não
 * fecha o pedido, e o cliente descobre ANTES de pagar.
 *
 * ── A regra vence a área de entrega ─────────────────────────────────────────
 *
 * A exclusão é checada primeiro e ganha de tudo: de raio, de bairro cadastrado,
 * de faixa de km. Se fosse o contrário, a loja desenharia a área e continuaria
 * recebendo o pedido — que é exatamente o problema que ela quis resolver.
 */

export type AreaDeRisco = {
  /** O nome que a loja deu. Aparece no motivo da recusa, para a equipe entender. */
  nome: string;
  /** Os vértices do polígono, em [lat, lng]. Mínimo 3. */
  pontos: [number, number][];
  /** Desligada fica guardada, mas não recusa ninguém. */
  ativa?: boolean;
};

/**
 * As áreas de risco cadastradas, já validadas.
 *
 * Aceita o `deliveryConfig` inteiro ou só a lista: o servidor tem o config em
 * mãos, a tela tem só o array. Uma função para os dois evita a validação
 * duplicada que sempre acaba divergindo.
 */
export function areasDeRisco(configOuLista: unknown): AreaDeRisco[] {
  const bruto = Array.isArray(configOuLista)
    ? configOuLista
    : ((configOuLista || {}) as Record<string, unknown>).areasDeRisco;
  const lista = Array.isArray(bruto) ? bruto : [];
  return lista
    .map((a: any) => ({
      nome: String(a?.nome || "Área sem nome").trim(),
      ativa: a?.ativa !== false,
      pontos: (Array.isArray(a?.pontos) ? a.pontos : [])
        .map((p: any) => [Number(p?.[0] ?? p?.lat), Number(p?.[1] ?? p?.lng)] as [number, number])
        .filter((p: [number, number]) => Number.isFinite(p[0]) && Number.isFinite(p[1])),
    }))
    // Menos de 3 vértices não é polígono: é linha, e não tem dentro.
    .filter((a) => a.pontos.length >= 3);
}

/**
 * O ponto está dentro do polígono?
 *
 * Ray casting: conta quantas vezes uma linha horizontal saindo do ponto cruza
 * as arestas. Ímpar = dentro. É o algoritmo clássico, sem dependência, e o
 * erro de projeção em escala de bairro é irrelevante — a diferença entre
 * tratar lat/lng como plano e como esfera, num polígono de 2 km, é de
 * centímetros.
 */
export function dentroDoPoligono(ponto: { lat: number; lng: number }, pontos: [number, number][]): boolean {
  const { lat: y, lng: x } = ponto;
  if (!Number.isFinite(x) || !Number.isFinite(y) || pontos.length < 3) return false;
  let dentro = false;
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    const [yi, xi] = pontos[i];
    const [yj, xj] = pontos[j];
    const cruza = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

/**
 * Este endereço cai numa área de risco? Devolve o NOME da área, ou null.
 *
 * Sem coordenadas não há como saber, e a resposta é null — a loja não pode
 * recusar um pedido por causa de um endereço que o mapa não achou.
 */
export function areaDeRiscoDoPonto(
  ponto: { lat: number; lng: number } | null | undefined,
  deliveryConfig: unknown,
): string | null {
  if (!ponto || !Number.isFinite(ponto.lat) || !Number.isFinite(ponto.lng)) return null;
  for (const area of areasDeRisco(deliveryConfig)) {
    if (area.ativa === false) continue;
    if (dentroDoPoligono(ponto, area.pontos)) return area.nome;
  }
  return null;
}

/** O centro aproximado de uma área, para centralizar o mapa nela. */
export function centroDaArea(area: AreaDeRisco): { lat: number; lng: number } | null {
  if (!area?.pontos?.length) return null;
  const soma = area.pontos.reduce((s, p) => ({ lat: s.lat + p[0], lng: s.lng + p[1] }), { lat: 0, lng: 0 });
  return { lat: soma.lat / area.pontos.length, lng: soma.lng / area.pontos.length };
}
