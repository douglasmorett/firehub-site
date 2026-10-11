import type { VeredictoDeEntrega } from "@/lib/area-de-entrega";

/**
 * A PÁGINA DE ENTRADA DO GRUPO: um link só para todas as lojas.
 *
 * Quem tem duas ou mais lojas (franquia, filial no outro lado da cidade)
 * divulga um link e o cliente cai na loja que entrega para ele. Pedido do
 * Douglas (10/10/2026), a partir do site da Jerrajê (Rio das Ostras) e do
 * caso da Pizzaria 17 + Pizzaria 17 Aeroporto (Macaé).
 *
 * ── Como a Jerrajê faz (Expresso Delivery) ───────────────────────────────
 *
 * O cliente escolhe a cidade e o bairro em duas listas; cada bairro foi
 * cadastrado À MÃO dizendo de qual unidade ele é, e a página mostra o cartão
 * da unidade com o link do cardápio dela. Bairro fora da lista = "Não
 * Localizado".
 *
 * ── Como a gente faz ─────────────────────────────────────────────────────
 *
 * Nada de cadastro novo: cada loja do grupo JÁ tem a área de entrega dela
 * (bairros, raio em km ou desenho no mapa). A página pergunta onde o cliente
 * está (bairro da lista, endereço/CEP ou GPS) e passa a resposta pela MESMA
 * `avaliarEntrega` do checkout, loja por loja. Assim a escolha da página
 * nunca discorda da taxa que o cardápio vai cobrar.
 *
 * Quando MAIS DE UMA atende, a página mostra todas e o cliente escolhe
 * (Douglas, 10/10/2026: "mostrar as duas e deixar a pessoa escolher"). A
 * primeira, com o selo, é a mais perto quando a distância de todas é
 * conhecida (GPS ou endereço); só com o bairro não há ponto do cliente, e aí
 * vem a de entrega mais barata e depois a mais rápida.
 */

export type ResultadoDaLoja = {
  lojaId: string;
  veredicto: Pick<VeredictoDeEntrega, "resultado" | "taxa" | "tempoMin" | "distanciaKm" | "bairro">;
  /** Linha reta do cliente até a loja, quando os dois pontos são conhecidos. */
  distanciaRetaKm?: number | null;
};

export type Escolha =
  /** `lojaId` é a primeira da lista; `tambemAtendem`, as outras que também entregam ali. `porDistancia` diz o critério da ordem. */
  | { tipo: "ATENDE"; lojaId: string; tambemAtendem: string[]; porDistancia: boolean }
  /** Nenhuma área respondeu com certeza (mapa fora, loja sem área): a mais perto em linha reta. */
  | { tipo: "MAIS_PERTO"; lojaId: string }
  | { tipo: "NENHUMA" };

const infinito = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? Number.POSITIVE_INFINITY : n);

/** Qual loja do grupo fica com o cliente. Pura: o servidor e o teste chamam a mesma. */
export function escolherLoja(resultados: ResultadoDaLoja[]): Escolha {
  const distancia = (r: ResultadoDaLoja) => r.distanciaRetaKm ?? r.veredicto.distanciaKm ?? null;
  const atendem = resultados.filter((r) => r.veredicto.resultado === "ATENDE");
  // Distância só ordena quando TODAS têm: misturar "a 2 km" com "sem
  // distância" poria na frente uma loja só porque a outra não tem pino.
  const porDistancia = atendem.length > 1 && atendem.every((r) => distancia(r) != null);
  atendem.sort((a, b) =>
    (porDistancia ? infinito(distancia(a)) - infinito(distancia(b)) : 0) ||
    infinito(a.veredicto.taxa) - infinito(b.veredicto.taxa) ||
    infinito(a.veredicto.tempoMin) - infinito(b.veredicto.tempoMin),
  );
  if (atendem.length > 0) {
    return { tipo: "ATENDE", lojaId: atendem[0].lojaId, tambemAtendem: atendem.slice(1).map((r) => r.lojaId), porDistancia };
  }

  // FORA de todas é resposta: nenhuma loja entrega ali. Só a dúvida (mapa
  // não achou, loja sem área) cai na mais perto — chutar uma loja que disse
  // "não entrego aí" mandaria o cliente para um checkout que vai recusar.
  const emDuvida = resultados
    .filter((r) => r.veredicto.resultado === "DESCONHECIDO" && r.distanciaRetaKm != null && Number.isFinite(r.distanciaRetaKm))
    .sort((a, b) => infinito(a.distanciaRetaKm) - infinito(b.distanciaRetaKm));
  if (emDuvida.length > 0) return { tipo: "MAIS_PERTO", lojaId: emDuvida[0].lojaId };
  return { tipo: "NENHUMA" };
}

/** Distância em linha reta (haversine), em km. */
export function distanciaRetaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type BairroDaLista = { nome: string; cidade: string };

/**
 * Os bairros que o cliente pode escolher na lista: a soma dos bairros
 * cadastrados pelas lojas que entregam por bairro, sem repetir. Loja por km
 * ou por desenho não tem lista — para ela o cliente digita o endereço ou usa
 * o GPS.
 */
export function bairrosDoGrupo(lojas: { cidade: string | null; bairros: string[] }[]): BairroDaLista[] {
  const vistos = new Map<string, BairroDaLista>();
  for (const loja of lojas) {
    const cidade = (loja.cidade || "").trim();
    for (const nome of loja.bairros) {
      const limpo = nome.trim();
      if (!limpo) continue;
      const chave = `${cidade}|${limpo}`.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (!vistos.has(chave)) vistos.set(chave, { nome: limpo, cidade });
    }
  }
  return [...vistos.values()].sort((a, b) => a.cidade.localeCompare(b.cidade, "pt-BR") || a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * O bairro onde a LOJA fica, tirado do endereço dela ("Rua X, 55 - Jardim
 * Aeroporto, Macaé - RJ" → "Jardim Aeroporto"). Quando duas lojas entregam no
 * mesmo bairro, é o que ajuda o cliente a escolher a mais perto sem mapa.
 * Nulo quando o endereço não segue o formato "rua - bairro, cidade".
 */
export function bairroDoEndereco(endereco: string | null | undefined): string | null {
  const partes = String(endereco || "").split(" - ");
  if (partes.length < 2) return null;
  const bairro = partes[1].split(",")[0].trim();
  return bairro && !/^\d/.test(bairro) && bairro.length <= 60 ? bairro : null;
}
