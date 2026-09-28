/**
 * Onde a loja ENTREGA, desenhado no mapa — por cima do raio, da rota e do bairro.
 *
 * ── Por que existe (R&D Pizzaria, 27/09/2026) ─────────────────────────────
 *
 * A loja cobra por km (faixas de distância) e o círculo do raio atravessa a
 * Dutra: quem mora do outro lado da rodovia cai a 2 km em linha reta e a moto
 * não vai. O lojista queria "um mapa por km e outro por desenho, os dois
 * juntos" — e não dava: as faixas de km e as áreas desenhadas moram no MESMO
 * campo (`deliveryZones`), e a tela troca um pelo outro ao mudar o método. Ele
 * desenhou, salvou, voltou para o raio, e o desenho sumiu.
 *
 * O contorno de atendimento mora no `deliveryConfig`, ao lado das áreas de
 * risco, e não mexe no cadastro de faixas. Nos modos KM, ROTA e BAIRRO ele é
 * um LIMITE: endereço fora de todo contorno ativo é recusado; dentro, a taxa é
 * a da faixa (ou do bairro) de sempre. No modo POLIGONO ele não vale — ali as
 * próprias áreas desenhadas já são o contorno.
 *
 * ── Ordem das regras ─────────────────────────────────────────────────────
 *
 *   1. área de risco (lib/area-de-risco.ts) — vence tudo, inclusive isto;
 *   2. contorno de atendimento — fora dele é FORA;
 *   3. raio / rota / bairro — a taxa.
 *
 * Sem coordenada não se recusa ninguém, como na área de risco. E ponto
 * APROXIMADO (centro do bairro, rua homônima) fora do contorno não é FORA: é
 * "confirme no mapa" — decidir a fronteira com o ponto errado é recusar quem
 * mora do lado de cá.
 */
import { dentroDoPoligono } from "./area-de-risco";

export type LimiteDeAtendimento = {
  /** O nome que a loja deu ("Lado de cá da Dutra"). Aparece no motivo. */
  nome: string;
  /** Os vértices, em [lat, lng]. Mínimo 3. */
  pontos: [number, number][];
  /** Desligado fica guardado, mas não limita ninguém. */
  ativa?: boolean;
};

/**
 * Os contornos cadastrados, já validados. Aceita o `deliveryConfig` inteiro
 * ou só a lista — mesma leitura da área de risco.
 */
export function limitesDeAtendimento(configOuLista: unknown): LimiteDeAtendimento[] {
  const bruto = Array.isArray(configOuLista)
    ? configOuLista
    : ((configOuLista || {}) as Record<string, unknown>).limiteDeAtendimento;
  const lista = Array.isArray(bruto) ? bruto : [];
  return lista
    .map((a: any) => ({
      nome: String(a?.nome || "Onde a loja entrega").trim(),
      ativa: a?.ativa !== false,
      pontos: (Array.isArray(a?.pontos) ? a.pontos : [])
        .map((p: any) => [Number(p?.[0] ?? p?.lat), Number(p?.[1] ?? p?.lng)] as [number, number])
        .filter((p: [number, number]) => Number.isFinite(p[0]) && Number.isFinite(p[1])),
    }))
    .filter((a) => a.pontos.length >= 3);
}

/** A loja tem contorno ligado? Sem nenhum, a regra não existe e nada muda. */
export function temLimiteDeAtendimento(deliveryConfig: unknown): boolean {
  return limitesDeAtendimento(deliveryConfig).some((l) => l.ativa !== false);
}

/**
 * O ponto está FORA de todo contorno ativo? Devolve os nomes dos contornos
 * (para o motivo), ou null quando está dentro de algum, quando não há
 * contorno ligado, ou quando não há ponto.
 *
 * Vários contornos = a loja atende a UNIÃO deles (dois bairros separados
 * pela linha do trem, cada um com seu desenho).
 */
export function foraDoLimiteDeAtendimento(
  ponto: { lat: number; lng: number } | null | undefined,
  deliveryConfig: unknown,
): string | null {
  if (!ponto || !Number.isFinite(ponto.lat) || !Number.isFinite(ponto.lng)) return null;
  const ativos = limitesDeAtendimento(deliveryConfig).filter((l) => l.ativa !== false);
  if (ativos.length === 0) return null;
  if (ativos.some((l) => dentroDoPoligono(ponto, l.pontos))) return null;
  return ativos.map((l) => l.nome).join(", ");
}
