/**
 * Rota 100% automatizada — a ORDEM DAS PARADAS PELA RUA, na hora de gravar
 * (Fase 3 do plano, vault "FireHub - Plano despacho automático").
 *
 * O planejador (planejador.ts) continua puro e em LINHA RETA: é a ordem que a
 * prévia mostra ao lojista, e a que vale se a rua não responder. Linha reta
 * erra justo onde dói: rio, linha do trem, avenida sem retorno — a parada "mais
 * perto" no mapa pode ser a mais longe de moto. Por isso, quando o ciclo GRAVA
 * a rota (executar.ts, "criar-rota" e a sequência do "acrescentar"), a ordem é
 * refeita com o mesmo vizinho mais próximo, só que medindo km de rua
 * (`rotaEntre`, lib/distancia-por-rota.ts) da loja até cada parada e entre as
 * paradas.
 *
 * São no máximo 6 paradas (`maxEntregasPorRota`): ≤ 20 pernas, quase todas do
 * cache de 60 dias depois da primeira vez. Mesmo assim o tempo é limitado
 * (`TETO_DA_ORDEM_POR_RUA_MS`, 3 s por rota): o ciclo de 20 s não pode ficar
 * esperando o roteador. Qualquer perna sem medida, ou o teto estourado, e a
 * rota é gravada na ordem em linha reta — meia ordem pela rua é pior que
 * nenhuma (não dá para comparar km de rua com km de reta).
 *
 * Puro de propósito: quem mede é o `medir` que vem de fora (o executar passa
 * o `rotaEntre`; o teste, um falso). Teste: scripts/teste-roteirizacao-automatica.ts.
 */
import { ordenarParadas } from "./planejador";
import type { Ponto } from "@/lib/ponto-do-pedido";

/** O tempo total que uma rota tem para ser ordenada pela rua. */
export const TETO_DA_ORDEM_POR_RUA_MS = 3_000;

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
 * Vizinho mais próximo a partir da loja, pela medida de `medir`. Empate fica
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

  const prazo = Date.now() + tetoMs;
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<"estourou">((r) => { relogio = setTimeout(() => r("estourou"), tetoMs); });
  try {
    const ordem: string[] = [];
    let atual = loja;
    const resto = [...comPonto];
    while (resto.length > 0) {
      // A última parada não tem com quem comparar: não gasta perna.
      if (resto.length === 1) { ordem.push(resto[0].id); break; }
      // As pernas de um passo vão juntas; o teto vale para o total, não por perna.
      const medidas = await Promise.race([
        Promise.all(resto.map((p) => medir(atual, p.ponto as Ponto, prazo).catch(() => null))),
        estouro,
      ]);
      if (medidas === "estourou") return emLinhaReta(`passou de ${tetoMs} ms`);
      if (medidas.some((km) => km == null || !Number.isFinite(km))) return emLinhaReta("uma perna sem medida de rua");
      let melhor = 0;
      for (let i = 1; i < resto.length; i++) if ((medidas[i] as number) < (medidas[melhor] as number)) melhor = i;
      const [proximo] = resto.splice(melhor, 1);
      ordem.push(proximo.id);
      atual = proximo.ponto as Ponto;
    }
    return { ordem: [...ordem, ...semPonto.map((p) => p.id)], fonte: "rua" };
  } finally {
    clearTimeout(relogio);
  }
}
