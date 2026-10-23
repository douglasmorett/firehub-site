/**
 * Rota 100% automatizada — a ORDEM DAS PARADAS PELA RUA, na hora de gravar
 * (Fase 3 do plano, vault "FireHub - Plano despacho automático").
 *
 * O planejador (planejador.ts) ordena em LINHA RETA: é a ordem que a prévia
 * mostra ao lojista, e a que vale se a rua não responder. Linha reta erra
 * justo onde dói: rio, linha do trem, avenida sem retorno — a parada "mais
 * perto" no mapa pode ser a mais longe de moto. Por isso, quando o ciclo GRAVA
 * a rota (executar.ts, "criar-rota" e a sequência do "acrescentar"), a ordem é
 * refeita com km de rua (`rotaEntre`, lib/distancia-por-rota.ts).
 *
 * O critério é o MENOR PERCURSO TOTAL a partir da loja, sem a volta
 * (`ordemDeMenorPercurso`, força bruta: até 6 paradas são 720 ordens). Até
 * 22/10/2026 era o vizinho mais próximo, guloso: na Rota #11 da Hakim gravou
 * 34 → 33 → 35 — do 34 foi ao 33, "mais perto", e teve de voltar ao 35; o
 * certo era 34 → 35 (desce para a avenida) → orla → 33 (Douglas, 21h20).
 *
 * As pernas: loja → cada parada e cada parada → cada outra, NOS DOIS
 * SENTIDOS — aqui a mão única pesa: com pernas iguais nos dois sentidos, o
 * guloso que achou 34 → 33 mais curto que 34 → 35 também teria o menor
 * total em 34 → 33 → 35; o 34 → 35 → 33 só ganha porque voltar do 33 ao 35
 * custa mais que ir do 35 ao 33. São n + n(n−1): 9 para 3 paradas, 36 para 6, quase todas do
 * cache de 60 dias (a loja → cliente já vem da cotação de frete; o sentido
 * "para fora" de cada par, da medida do encaixe no mesmo ciclo). Mesmo assim
 * o tempo é limitado (`TETO_DA_ORDEM_POR_RUA_MS`, 4 s por rota): o ciclo de
 * 20 s não pode ficar esperando o roteador. Qualquer perna sem medida, ou o
 * teto estourado, e a rota é gravada na ordem em linha reta (o mesmo menor
 * percurso) — meia ordem pela rua é pior que nenhuma (não dá para comparar
 * km de rua com km de reta).
 *
 * Puro de propósito: quem mede é o `medir` que vem de fora (o executar passa
 * o `rotaEntre`; o teste, um falso). Teste: scripts/teste-roteirizacao-automatica.ts.
 */
import { ordemDeMenorPercurso, ordenarParadas } from "./planejador";
import type { Ponto } from "@/lib/ponto-do-pedido";

/** O tempo total que uma rota tem para ser ordenada pela rua. */
export const TETO_DA_ORDEM_POR_RUA_MS = 4_000;

/** Acima disto (não acontece: `maxEntregasPorRota` vai até 6) as pernas crescem demais — linha reta. */
const MAX_PARADAS_PELA_RUA = 6;

/** Km de rua de `a` até `b`, ou null = não deu para medir. `prazo` = fim do tempo (epoch ms). */
export type Medir = (a: Ponto, b: Ponto, prazo: number) => Promise<number | null>;

export type OrdemDasParadas = {
  ordem: string[];
  fonte: "rua" | "linha-reta";
  /** Por que ficou em linha reta (só quando havia o que ordenar e a rua falhou). */
  falha?: string;
};

const porId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Menor percurso total a partir da loja, pela medida de `medir`. Empate fica
 * com o menor id (a mesma regra de `ordenarParadas`); pedido sem ponto vai
 * para o fim. NUNCA lança: `medir` que lança conta como perna sem medida.
 */
export async function ordenarParadasPorMedida(
  loja: Ponto,
  pedidos: { id: string; ponto: Ponto | null }[],
  medir: Medir,
  opcoes?: { tetoMs?: number },
): Promise<OrdemDasParadas> {
  const emLinhaReta = (falha?: string): OrdemDasParadas => ({ ordem: ordenarParadas(loja, pedidos), fonte: "linha-reta", ...(falha ? { falha } : {}) });
  const comPonto = pedidos.filter((p) => p.ponto).sort(porId);
  const semPonto = pedidos.filter((p) => !p.ponto).sort(porId);
  // Uma parada (ou nenhuma) não tem ordem a decidir.
  if (comPonto.length < 2) return emLinhaReta();
  if (comPonto.length > MAX_PARADAS_PELA_RUA) return emLinhaReta(`${comPonto.length} paradas (máximo ${MAX_PARADAS_PELA_RUA} pela rua)`);
  const tetoMs = opcoes?.tetoMs ?? TETO_DA_ORDEM_POR_RUA_MS;
  if (tetoMs <= 0) return emLinhaReta("sem tempo para medir");

  // Todas as pernas de uma vez; o teto vale para o total, não por perna.
  const pernas: { de: string | null; para: string; a: Ponto; b: Ponto }[] = [];
  for (const p of comPonto) pernas.push({ de: null, para: p.id, a: loja, b: p.ponto as Ponto });
  for (const p of comPonto) {
    for (const q of comPonto) if (p.id !== q.id) pernas.push({ de: p.id, para: q.id, a: p.ponto as Ponto, b: q.ponto as Ponto });
  }
  const prazo = Date.now() + tetoMs;
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<"estourou">((r) => { relogio = setTimeout(() => r("estourou"), tetoMs); });
  try {
    const medidas = await Promise.race([
      Promise.all(pernas.map((x) => medir(x.a, x.b, prazo).catch(() => null))),
      estouro,
    ]);
    if (medidas === "estourou") return emLinhaReta(`passou de ${tetoMs} ms`);
    if (medidas.some((km) => km == null || !Number.isFinite(km))) return emLinhaReta("uma perna sem medida de rua");
    const km = new Map(pernas.map((x, i) => [`${x.de ?? ""}>${x.para}`, medidas[i] as number]));
    const ordem = ordemDeMenorPercurso(
      comPonto.map((p) => p.id),
      (id) => km.get(`>${id}`) as number,
      (a, b) => km.get(`${a}>${b}`) as number,
    );
    return { ordem: [...ordem, ...semPonto.map((p) => p.id)], fonte: "rua" };
  } finally {
    clearTimeout(relogio);
  }
}
