/**
 * lib/senha-aleatoria.ts — o número do pedido sorteado (347, 812, 129).
 *
 * ── POR QUE EXISTE ──────────────────────────────────────────────────────────
 *
 * Com a contagem 1, 2, 3, quem passa pelo balcão às 21h e vê "senha 184" sabe
 * quanto a loja vendeu no dia. O cliente da praça de alimentação pediu
 * (13/10/2026) para a senha sair embaralhada, e a opção é da loja
 * (`User.numeracaoAleatoria`, ligada no Painel de senhas).
 *
 * ── COMO NÃO REPETE ─────────────────────────────────────────────────────────
 *
 * Sortear e conferir no banco teria corrida: dois pedidos no mesmo segundo
 * podiam tirar o mesmo número — e duas comandas iguais fazem a cozinha
 * entregar trocado (já aconteceu com a contagem, ver lib/order-number.ts).
 *
 * Então o sorteio não é sorteio: o contador atômico de sempre continua
 * entregando 1, 2, 3… e este arquivo troca a POSIÇÃO pelo número que está
 * naquela posição de um embaralhamento fixo de 100–999. Posições diferentes
 * dão números diferentes, sem consultar nada. O embaralhamento muda a cada
 * período (cada fechamento de caixa), então a sequência de hoje não é a de
 * ontem.
 *
 * Passou de 900 pedidos no mesmo período (loja que nunca fecha o caixa), a
 * faixa cresce: 1000–9999 embaralhado, depois 10000–99999.
 */

/** As faixas em ordem: 3 dígitos, depois 4, depois 5. */
const FAIXAS = [
  { de: 100, ate: 999 },
  { de: 1000, ate: 9999 },
  { de: 10000, ate: 99999 },
];

/** Hash de texto em 32 bits (FNV-1a) — só para virar semente. */
function hash32(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Gerador pseudoaleatório pequeno e determinístico (mulberry32). */
function gerador(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cache = new Map<string, number[]>();

/** Os números da faixa, embaralhados sempre do mesmo jeito para a mesma semente. */
function embaralhado(faixa: { de: number; ate: number }, semente: string): number[] {
  const chave = `${faixa.de}:${semente}`;
  const pronto = cache.get(chave);
  if (pronto) return pronto;

  const lista: number[] = [];
  for (let n = faixa.de; n <= faixa.ate; n++) lista.push(n);
  const aleatorio = gerador(hash32(chave));
  for (let i = lista.length - 1; i > 0; i--) {
    const j = Math.floor(aleatorio() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }

  // Poucos períodos ativos por instância; o teto só impede crescer sem fim.
  if (cache.size > 200) cache.clear();
  cache.set(chave, lista);
  return lista;
}

/**
 * O número sorteado da posição `posicao` (1, 2, 3…) no período `semente`.
 * Mesma posição e mesma semente = mesmo número; posições diferentes nunca
 * repetem número.
 */
export function senhaDaPosicao(posicao: number, semente: string): number {
  let resto = Math.max(1, Math.floor(posicao));
  for (const faixa of FAIXAS) {
    const tamanho = faixa.ate - faixa.de + 1;
    if (resto <= tamanho) return embaralhado(faixa, semente)[resto - 1];
    resto -= tamanho;
  }
  // Mais de 99.900 pedidos sem fechar o caixa: segue contando depois da última faixa.
  return FAIXAS[FAIXAS.length - 1].ate + resto;
}
