/**
 * A ÂNCORA DO CEP — o pedido sem ponto (Wabiz) cai onde as entregas COM ponto
 * (iFood, 99, pino do cliente, posição da loja) da mesma quadra e conjunto
 * caíram.
 *
 * ── Por que existe (NIK Esfihas, Sobradinho/DF, 18/10/2026) ────────────────
 *
 * "Pedido veio errado no mapa" todo dia, ~8 correções por noite. A Wabiz não
 * manda ponto; manda o CEP, e em Sobradinho cada CEP é uma quadra + conjunto
 * (73030-037 = "Quadra 3 Conjunto G", nos Correios). O mapa aberto (OSM) tem
 * a mesma "Quadra 3 Conjunto G" em CINCO lugares do DF (Sobradinho, Sobradinho
 * II, Lago Norte ×2, Planaltina) e o Photon troca o conjunto ("Conjunto D-8"
 * vira outro). O lojista: "se puxar pelo CEP dá certo, os endereços aqui são
 * muito parecidos".
 *
 * Quem sabe onde fica a Quadra 3 Conjunto G são as entregas que já foram lá
 * com ponto de verdade: o iFood da NIK manda o ponto em todo pedido, e em 120
 * dias foram ~1.000 entregas em ~200 quadras/conjuntos. Medido nelas (cada
 * entrega contra a mediana das OUTRAS do mesmo conjunto): metade a menos de
 * 40 m, 98% a menos de 300 m. É o quarteirão — melhor que qualquer leitura do
 * texto.
 *
 * ── A chave ────────────────────────────────────────────────────────────────
 *
 * "v:<lugar>|<quadra>|cj<conjunto>", a mesma forma da vizinhança das
 * correções (lib/ponto-do-pedido.ts, `chaveDaVizinhanca`), com o LUGAR pelo
 * nome do bairro:
 *   - do lado do pedido com CEP, rua e bairro dos Correios: "Quadra 3
 *     Conjunto G" / "Sobradinho" → "v:sobradinho|q3|cjg";
 *   - do lado da entrega com ponto, o texto como o app escreve: "Q 3 Conj G,
 *     12 - Sobradinho - Brasília" → "v:sobradinho|q3|cjg".
 * "Sobradinho I" é "Sobradinho". O parêntese dos Correios ("Setor Oeste
 * (Sobradinho II)") só vale como lugar quando o bairro é um SETOR da região
 * (oeste, leste…); "Condomínio Império dos Nobres (Sobradinho)" tem uma
 * Quadra 1 Conjunto G própria, a 5 km da Quadra 1 Conjunto G de Sobradinho, e
 * não pode herdar o ponto dela.
 *
 * Pura (o teste roda sem rede nem banco: scripts/teste-ancora-do-cep.ts). A
 * leitura das entregas mora em lib/ponto-aprendido.ts (`ancorasDaLoja`).
 */
import { chaveDaVizinhanca, distanciaKm, quadraEConjunto, type Ponto } from "./ponto-do-pedido";

/** Mais espalhadas que isto, as entregas da chave não são um quarteirão (o mesmo corte da vizinhança). */
export const ESPALHAMENTO_MAXIMO_DA_ANCORA_KM = 0.8;

const semAcento = (t: unknown) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** "Sobradinho II" → "sobradinho 2"; "Sobradinho I" e "Sobradinho 1" → "sobradinho". */
export function lugarComparavel(nome: unknown): string {
  const palavras = semAcento(nome)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((x) => (x === "ii" ? "2" : x === "iii" ? "3" : x === "i" ? "1" : x));
  if (palavras.length > 1 && palavras[palavras.length - 1] === "1") palavras.pop();
  return palavras.join(" ").slice(0, 40);
}

/** Os lugares do bairro dos Correios: o nome e, num setor da região ("Setor Oeste (Sobradinho II)"), a região. */
export function lugaresDoBairroDoCep(bairro: unknown): string[] {
  const b = String(bairro ?? "").trim();
  if (!b) return [];
  const m = b.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  const principal = lugarComparavel(m ? m[1] : b);
  const saida = principal ? [principal] : [];
  if (m && /^setor (oeste|leste|norte|sul|central)$/.test(principal)) {
    const regiao = lugarComparavel(m[2]);
    if (regiao && !saida.includes(regiao)) saida.push(regiao);
  }
  return saida;
}

/**
 * As chaves do pedido pelo que os Correios dizem do CEP. Rua sem quadra E
 * conjunto ("Quadra 8", "Rodovia DF-425") não tem âncora.
 */
export function chavesDaAncoraPeloCep(viaCep: { rua?: string | null; bairro?: string | null } | null | undefined): string[] {
  const rua = String(viaCep?.rua ?? "")
    // "Conjunto AR 14 Conjunto 4" (Sobradinho II, nos Correios): o primeiro "Conjunto" é do setor.
    .replace(/^\s*conjunto\s+(?=(ar|q[a-z]{0,3})\s*\d)/i, "");
  const qc = quadraEConjunto(rua);
  if (!qc) return [];
  return lugaresDoBairroDoCep(viaCep?.bairro).map((l) => `v:${l}|${qc}`);
}

/**
 * A chave de uma entrega COM ponto pelo texto dela (iFood, 99, site). Texto
 * com CEP tem o lugar pelo CEP ("v:73030|…"), que não é o lugar pelo nome:
 * fica de fora (a correção da loja já tem a vizinhança própria).
 */
export function chaveDaAncoraPeloTexto(endereco: unknown): string | null {
  const v = chaveDaVizinhanca(endereco);
  if (!v) return null;
  const [lugar, ...resto] = v.slice(2).split("|");
  if (/^\d+$/.test(lugar)) return null;
  const l = lugarComparavel(lugar);
  return l ? `v:${l}|${resto.join("|")}` : null;
}

export type Ancora = Ponto & { entregas: number };

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

/**
 * As âncoras das entregas com ponto: a mediana (por eixo) de cada chave.
 * Entregas espalhadas por mais de 800 m não são um quarteirão — a chave fica
 * sem âncora (o mesmo nome em dois lugares, ou ponto errado demais).
 */
export function ancorasDasEntregas(entregas: { endereco: unknown; ponto: Ponto }[]): Map<string, Ancora> {
  const porChave = new Map<string, Ponto[]>();
  for (const e of entregas) {
    const k = chaveDaAncoraPeloTexto(e.endereco);
    if (!k || !Number.isFinite(e.ponto?.lat) || !Number.isFinite(e.ponto?.lng)) continue;
    const l = porChave.get(k) || [];
    l.push(e.ponto);
    porChave.set(k, l);
  }
  const saida = new Map<string, Ancora>();
  for (const [k, pontos] of porChave) {
    const centro = { lat: mediana(pontos.map((p) => p.lat)), lng: mediana(pontos.map((p) => p.lng)) };
    const longe = Math.max(...pontos.map((p) => distanciaKm(centro, p)));
    if (longe > ESPALHAMENTO_MAXIMO_DA_ANCORA_KM) continue;
    saida.set(k, { ...centro, entregas: pontos.length });
  }
  return saida;
}

/** A âncora do pedido: a primeira chave do CEP que tem entregas. */
export function ancoraDoPedido(chaves: string[], ancoras: Map<string, Ancora>): Ancora | null {
  for (const k of chaves) {
    const a = ancoras.get(k);
    if (a) return a;
  }
  return null;
}
