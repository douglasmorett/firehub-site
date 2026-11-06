/**
 * COMANDA NUMERADA — o cartão que o cliente leva no self-service ou no bar.
 *
 * Pedido de clientes trazido pelo Victor (05/11/2026, cartão "155" do
 * MatchPoint Gourmet): cada pessoa tem o seu cartão e tudo o que consome entra
 * nele — o prato da balança, a bebida que o garçom lança — e o caixa fecha
 * pelo número do cartão.
 *
 * É uma `Table` com `tipo = "COMANDA"`: a conta, o fechamento, a impressão e o
 * caixa são os da mesa, sem caminho paralelo. O que muda é só onde aparece (as
 * comandas ficam fora do mapa de mesas) e o nome ("Comanda 155").
 *
 * A numeração é a mesma das mesas (`@@unique([franchiseeId, number])`): a loja
 * usa uma faixa própria para os cartões (mesas 1 a 30, comandas 101 a 300).
 *
 * Arquivo puro (sem banco): telas e rotas importam.
 */

export const TIPO_COMANDA = "COMANDA";

/** Teto de cartões criados de uma vez: uma faixa digitada errada (1 a 100000) não enche o banco. */
export const MAX_COMANDAS_POR_VEZ = 500;

export function ehComanda(t: { tipo?: string | null } | null | undefined): boolean {
  return t?.tipo === TIPO_COMANDA;
}

/** "Comanda 155" ou "Mesa 5" — o nome que vai no pedido, na comanda impressa e na conta. */
export function nomeDaMesa(t: { number: number; tipo?: string | null }): string {
  return `${ehComanda(t) ? "Comanda" : "Mesa"} ${t.number}`;
}

/**
 * A faixa de cartões a criar, conferida. Recusa número que já é mesa (o banco
 * recusaria igual) e faixa grande demais; os números que já são comanda são
 * pulados — criar de novo a mesma faixa não dá erro.
 */
export function faixaDeComandas(
  de: unknown,
  ate: unknown,
  existentes: { number: number; tipo?: string | null }[],
): { ok: true; numeros: number[] } | { ok: false; erro: string } {
  const a = Math.floor(Number(de));
  const b = Math.floor(Number(ate));
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < a) {
    return { ok: false, erro: "Informe a faixa dos cartões: do número X ao Y (ex.: 101 a 300)." };
  }
  if (b - a + 1 > MAX_COMANDAS_POR_VEZ) {
    return { ok: false, erro: `No máximo ${MAX_COMANDAS_POR_VEZ} cartões de uma vez.` };
  }
  const mesas = existentes.filter((t) => !ehComanda(t)).map((t) => t.number).filter((n) => n >= a && n <= b);
  if (mesas.length > 0) {
    const lista = mesas.slice(0, 5).join(", ") + (mesas.length > 5 ? "…" : "");
    return { ok: false, erro: `Os números ${lista} já são mesas. Escolha uma faixa acima das mesas (ex.: ${Math.max(...existentes.map((t) => t.number)) + 1} em diante).` };
  }
  const jaComanda = new Set(existentes.filter(ehComanda).map((t) => t.number));
  const numeros: number[] = [];
  for (let n = a; n <= b; n++) if (!jaComanda.has(n)) numeros.push(n);
  return { ok: true, numeros };
}

/**
 * O número lido pelo leitor de código de barras (ou digitado). O leitor USB
 * "digita" o código e um Enter; o Code 39 pode vir com os asteriscos de início
 * e fim, conforme a configuração do leitor.
 */
export function numeroLidoDoCartao(texto: unknown): number | null {
  const limpo = String(texto ?? "").replace(/\*/g, "").trim();
  if (!/^\d{1,6}$/.test(limpo)) return null;
  const n = Number(limpo);
  return n >= 1 ? n : null;
}

// ─── Código de barras (Code 39) ─────────────────────────────────────────────
//
// Code 39 e não QR: o leitor barato (laser, 1D) lê Code 39 de fábrica, e QR
// pede leitor 2D. Só dígitos: cada caractere são 9 elementos (barra, espaço,
// barra...), 3 deles largos. Sem dígito verificador, que é o padrão dos leitores.

const CODE39: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
  "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  "*": "nwnnwnwnn",
};

/**
 * As barras do número em Code 39, como retângulos para um <svg>: `x` e
 * `largura` em módulos (o estreito = 1, o largo = 3). `total` é a largura do
 * código inteiro, para o viewBox.
 */
export function barrasCode39(numero: number | string): { barras: { x: number; largura: number }[]; total: number } {
  const texto = `*${String(numero).replace(/\D/g, "")}*`;
  const barras: { x: number; largura: number }[] = [];
  let x = 0;
  for (const c of texto) {
    const padrao = CODE39[c];
    for (let i = 0; i < padrao.length; i++) {
      const largura = padrao[i] === "w" ? 3 : 1;
      if (i % 2 === 0) barras.push({ x, largura });
      x += largura;
    }
    x += 1; // espaço entre caracteres
  }
  return { barras, total: x - 1 };
}
