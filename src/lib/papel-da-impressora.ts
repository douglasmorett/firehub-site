/**
 * Lê os bytes ESC/POS que o Assistente manda para a impressora e devolve o
 * papel como ele sai: linha a linha, com o tamanho de CADA letra.
 *
 * ── Por que ler os bytes, e não desenhar de novo ────────────────────────────
 *
 * A prévia de "Personalizar impressão" desenhava a comanda por conta própria e
 * mentia em corpo: não sabia fazer letra só alta (a maioria das linhas grandes
 * do Assistente), mostrava 58 mm com letra MAIOR que 80 mm e nunca deixava ver
 * o papel estreito. Lendo os bytes, a prévia sabe exatamente o que a cabeça da
 * impressora recebe — o tamanho, o negrito, a tarja preta, o QR — e o desenho
 * não tem mais como divergir do papel (ver scripts/gerar-comanda-do-assistente.mjs).
 *
 * Arquivo puro, sem imports: roda no navegador e nos testes.
 */

/** Um pedaço de linha com o mesmo formato. */
export type Trecho = {
  texto: string;
  /** Multiplicador de largura (GS !): 1, 2, 3... */
  largura: number;
  /** Multiplicador de altura (GS !): 1, 2, 3... */
  altura: number;
  /** Fonte B (ESC M 1): 3/4 da largura da fonte A. */
  fonteB: boolean;
  negrito: boolean;
  /** Tarja preta (GS B 1). */
  invertido: boolean;
};

export type LinhaDoPapel = {
  trechos: Trecho[];
  /** Alinhamento da PRÓPRIA impressora (ESC a) quando a linha começou. */
  alinhamento: "esquerda" | "centro" | "direita";
  /** Um QR impresso nesta posição, com o tamanho em pontos da cabeça. */
  qr?: { pontos: number };
  /** Linha em branco de avanço de papel (ESC d / LF vazio). */
  vazia?: boolean;
};

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/**
 * Quantos módulos tem o QR para `bytes` de dado (modo byte, correção M, que é
 * o que o Assistente pede: GS ( k ... 0x45 0x31). Versão v tem 17 + 4v módulos.
 */
function modulosDoQr(bytes: number): number {
  // Capacidade em bytes, correção M, versões 1 a 10.
  const capacidade = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  const v = capacidade.findIndex((c) => bytes <= c) + 1 || 11;
  return 17 + 4 * v;
}

/** Os bytes ("binário", um caractere por byte) viram linhas de papel. */
export function lerPapel(escpos: string): LinhaDoPapel[] {
  const linhas: LinhaDoPapel[] = [];
  let estado = { largura: 1, altura: 1, fonteB: false, negrito: false, invertido: false };
  let alinhamento: LinhaDoPapel["alinhamento"] = "esquerda";
  let atual: LinhaDoPapel = { trechos: [], alinhamento };
  let tamanhoDoModulo = 3;
  let dadosDoQr = 0;

  const novoTrecho = () => ({ texto: "", ...estado });
  const acrescentar = (ch: string) => {
    const ultimo = atual.trechos[atual.trechos.length - 1];
    if (
      ultimo &&
      ultimo.largura === estado.largura && ultimo.altura === estado.altura &&
      ultimo.fonteB === estado.fonteB && ultimo.negrito === estado.negrito &&
      ultimo.invertido === estado.invertido
    ) {
      ultimo.texto += ch;
    } else {
      const t = novoTrecho();
      t.texto = ch;
      atual.trechos.push(t);
    }
  };
  const fecharLinha = () => {
    const vazia = atual.trechos.length === 0 && !atual.qr;
    linhas.push(vazia ? { ...atual, vazia: true } : atual);
    atual = { trechos: [], alinhamento };
  };

  for (let i = 0; i < escpos.length; i++) {
    const c = escpos.charCodeAt(i);
    if (c === ESC) {
      const cmd = escpos[i + 1];
      const n = escpos.charCodeAt(i + 2);
      switch (cmd) {
        case "@":
          estado = { largura: 1, altura: 1, fonteB: false, negrito: false, invertido: false };
          alinhamento = "esquerda";
          i += 1;
          break;
        case "E": estado = { ...estado, negrito: (n & 1) === 1 }; i += 2; break;
        case "M": estado = { ...estado, fonteB: (n & 1) === 1 }; i += 2; break;
        case "!":
          // Modo de impressão antigo: bit0 fonte B, bit3 negrito, bit4 altura, bit5 largura.
          estado = {
            ...estado,
            fonteB: (n & 0x01) !== 0,
            negrito: (n & 0x08) !== 0,
            altura: n & 0x10 ? 2 : 1,
            largura: n & 0x20 ? 2 : 1,
          };
          i += 2;
          break;
        case "a":
          alinhamento = n === 1 || n === 49 ? "centro" : n === 2 || n === 50 ? "direita" : "esquerda";
          if (atual.trechos.length === 0) atual.alinhamento = alinhamento;
          i += 2;
          break;
        case "d":
          // Avança n linhas em branco.
          if (atual.trechos.length) fecharLinha();
          for (let k = 0; k < n; k++) fecharLinha();
          i += 2;
          break;
        case "t": case "R": case " ": case "-": case "3":
          i += 2;
          break;
        default:
          // ESC 2 (espaço de linha padrão) e comandos de um byte.
          i += 1;
      }
      continue;
    }
    if (c === GS) {
      const cmd = escpos[i + 1];
      const n = escpos.charCodeAt(i + 2);
      if (cmd === "!") {
        estado = { ...estado, largura: ((n >> 4) & 0x0f) + 1, altura: (n & 0x0f) + 1 };
        i += 2;
      } else if (cmd === "B") {
        estado = { ...estado, invertido: (n & 1) === 1 };
        i += 2;
      } else if (cmd === "V") {
        // Corte: o modo com avanço (65/66) leva um byte a mais.
        i += n === 65 || n === 66 ? 3 : 2;
      } else if (cmd === "L" || cmd === "W") {
        i += 3;
      } else if (cmd === "(" && escpos[i + 2] === "k") {
        // QR: GS ( k pL pH cn fn [dados]. Guarda o tamanho do módulo e dos
        // dados; o desenho acontece no "imprimir" (fn 0x51).
        const pL = escpos.charCodeAt(i + 3);
        const pH = escpos.charCodeAt(i + 4);
        const tamanho = pL + 256 * pH;
        const fn = escpos.charCodeAt(i + 6);
        if (fn === 0x43) tamanhoDoModulo = escpos.charCodeAt(i + 7) || 3;
        if (fn === 0x50) dadosDoQr = Math.max(0, tamanho - 3);
        if (fn === 0x51) {
          if (atual.trechos.length) fecharLinha();
          atual.qr = { pontos: modulosDoQr(dadosDoQr) * tamanhoDoModulo };
          atual.alinhamento = alinhamento;
          fecharLinha();
        }
        i += 4 + tamanho;
      } else {
        i += 2;
      }
      continue;
    }
    if (c === LF) {
      fecharLinha();
      continue;
    }
    if (c < 0x20) continue;
    acrescentar(escpos[i]);
  }
  if (atual.trechos.length || atual.qr) fecharLinha();
  // O avanço final antes do corte não é papel que o lojista lê.
  while (linhas.length && linhas[linhas.length - 1].vazia) linhas.pop();
  return linhas;
}

/**
 * A geometria da cabeça de impressão para ESTA impressora.
 *
 * `pontos` é a largura útil (58 mm → 384, 80 mm → 576) e `celula` a largura de
 * uma letra da fonte A em pontos. Colunas a mais que o normal do papel
 * encolhem a letra (é a impressora que imprime mais letras por linha); colunas
 * A MENOS não aumentam a letra: é o papel sendo montado mais estreito que a
 * bobina, com a faixa da direita vazia — e a prévia precisa mostrar isso.
 * A exceção é a Bematech de 42 colunas, cuja fonte de fábrica é mais larga.
 */
export function geometriaDaImpressora(paperWidth: string | null | undefined, colunas: number) {
  const papel58 = String(paperWidth || "").startsWith("58");
  const pontos = papel58 ? 384 : 576;
  const nativas = papel58 ? 32 : 48;
  const celula = colunas >= nativas || (!papel58 && colunas === 42) ? pontos / colunas : pontos / nativas;
  return {
    pontos,
    celula,
    /** Colunas a menos que o papel comporta: a faixa da direita sai vazia. */
    estreitoDemais: colunas < nativas && !(!papel58 && colunas === 42),
    nativas,
  };
}

/** Largura, em pontos, de um trecho no papel. */
export function larguraDoTrecho(t: Trecho, celula: number): number {
  return t.texto.length * celula * (t.fonteB ? 0.75 : 1) * t.largura;
}
