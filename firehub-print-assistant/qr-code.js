/* ─── QR Code em JavaScript puro (o DANFE NFC-e no perfil "legacy") ─────────
 *
 * A impressora no perfil "legacy" nao entende o comando de QR Code da termica
 * (GS ( k) — e o QR e OBRIGATORIO no DANFE NFC-e (Ajuste SINIEF 19/16, cl.
 * 10a, par. 2o, II; Manual de Padroes do DANFE NFC-e v6.0, item 4). Entao o
 * Assistente desenha a matriz do QR aqui e a manda como IMAGEM (GS v 0 — ver
 * buildDanfeEscPos em server.js), o comando de imagem que praticamente toda
 * termica ESC/POS entende. Sem QR nao sai DANFE.
 *
 * So o que o DANFE precisa, pela norma (ISO/IEC 18004:2015):
 *  - modo byte, com o conteudo em UTF-8 (o Manual pede UTF-8 — 4.5.3);
 *  - correcao de erro nivel M (Manual, 4.5.2);
 *  - versoes 1 a 40: a menor em que o conteudo cabe;
 *  - mascara pela menor penalidade (regras N1 a N4 da norma).
 *
 * Sem dependencia nova: o instalador leva este arquivo junto do server.js
 * (package.json -> build.files). O resultado e conferido modulo a modulo contra
 * o pacote `qrcode` que o site usa, nas 40 versoes
 * (scripts/teste-nfce-qrcode-do-assistente.ts). */
"use strict";

/* Codigos de correcao por bloco e numero de blocos no nivel M, versoes 1 a 40
   (ISO/IEC 18004:2015, tabela 9). O indice 0 nao e versao. */
const EC_POR_BLOCO = [0,
  10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26,
  26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const BLOCOS = [0,
  1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16,
  17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
/* Os dois bits do nivel M nas informacoes de formato (L = 01, M = 00, Q = 11, H = 10). */
const BITS_DO_NIVEL_M = 0;

/* Bits da area de dados (dados + correcao) de cada versao: o simbolo menos os
   padroes fixos (localizadores, alinhamento, temporizacao, formato e versao). */
function bitsDaArea(versao) {
  let n = (16 * versao + 128) * versao + 64;
  if (versao >= 2) {
    const alinhamentos = Math.floor(versao / 7) + 2;
    n -= (25 * alinhamentos - 10) * alinhamentos - 55;
    if (versao >= 7) n -= 36;
  }
  return n;
}
const codigosTotais = (versao) => Math.floor(bitsDaArea(versao) / 8);
const codigosDeDados = (versao) => codigosTotais(versao) - EC_POR_BLOCO[versao] * BLOCOS[versao];
/* Bits do contador de caracteres no modo byte: 8 ate a versao 9, 16 depois. */
const bitsDoContador = (versao) => (versao <= 9 ? 8 : 16);

/* ── Corpo de Galois GF(256), polinomio 0x11D ─────────────────────────────── */
const EXP = new Array(512);
const LOG = new Array(256);
(function montarTabelas() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const multiplicar = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/* O gerador de Reed-Solomon de grau `grau`: o produto de (x - a^i), i = 0 ate
   grau - 1, com os coeficientes do maior para o menor (o primeiro e 1). */
function gerador(grau) {
  let g = [1];
  for (let i = 0; i < grau; i++) {
    const novo = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      novo[j] ^= g[j];
      novo[j + 1] ^= multiplicar(g[j], EXP[i]);
    }
    g = novo;
  }
  return g;
}

/* Os codigos de correcao de um bloco: o resto da divisao dos dados pelo gerador. */
function correcao(dados, grau) {
  const g = gerador(grau);
  const resto = new Array(grau).fill(0);
  for (const byte of dados) {
    const fator = byte ^ resto.shift();
    resto.push(0);
    for (let j = 0; j < grau; j++) resto[j] ^= multiplicar(g[j + 1], fator);
  }
  return resto;
}

/* Os codigos de dados: modo byte, contador, os bytes, terminador e o
   enchimento 0xEC/0x11 ate a capacidade da versao. */
function codigosDosDados(bytes, versao) {
  const bits = [];
  const por = (valor, tamanho) => {
    for (let i = tamanho - 1; i >= 0; i--) bits.push((valor >>> i) & 1);
  };
  por(0x4, 4);
  por(bytes.length, bitsDoContador(versao));
  for (const b of bytes) por(b, 8);
  const capacidade = codigosDeDados(versao) * 8;
  por(0, Math.min(4, capacidade - bits.length));
  por(0, (8 - (bits.length % 8)) % 8);
  for (let enchimento = 0xec; bits.length < capacidade; enchimento ^= 0xec ^ 0x11) por(enchimento, 8);
  const codigos = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codigos.push(b);
  }
  return codigos;
}

/* Divide em blocos, calcula a correcao de cada um e intercala: primeiro os
   dados (bloco a bloco, posicao a posicao), depois a correcao. */
function codigosFinais(dados, versao) {
  const blocos = BLOCOS[versao];
  const grau = EC_POR_BLOCO[versao];
  const total = codigosTotais(versao);
  const curtos = blocos - (total % blocos);
  const dadosNoCurto = Math.floor(total / blocos) - grau;
  const partes = [];
  let k = 0;
  for (let i = 0; i < blocos; i++) {
    const tamanho = dadosNoCurto + (i < curtos ? 0 : 1);
    const d = dados.slice(k, k + tamanho);
    k += tamanho;
    partes.push({ d, ec: correcao(d, grau) });
  }
  const saida = [];
  for (let i = 0; i <= dadosNoCurto; i++) for (const p of partes) if (i < p.d.length) saida.push(p.d[i]);
  for (let i = 0; i < grau; i++) for (const p of partes) saida.push(p.ec[i]);
  return saida;
}

/* Os centros dos padroes de alinhamento de uma versao (linha = coluna). */
function centrosDeAlinhamento(versao) {
  if (versao === 1) return [];
  const quantos = Math.floor(versao / 7) + 2;
  const passo = versao === 32 ? 26 : Math.ceil((versao * 4 + 4) / (quantos * 2 - 2)) * 2;
  const centros = [6];
  for (let pos = versao * 4 + 17 - 7; centros.length < quantos; pos -= passo) centros.splice(1, 0, pos);
  return centros;
}

/* As oito mascaras (l = linha, c = coluna). */
const MASCARAS = [
  (l, c) => (l + c) % 2 === 0,
  (l) => l % 2 === 0,
  (l, c) => c % 3 === 0,
  (l, c) => (l + c) % 3 === 0,
  (l, c) => (Math.floor(l / 2) + Math.floor(c / 3)) % 2 === 0,
  (l, c) => ((l * c) % 2) + ((l * c) % 3) === 0,
  (l, c) => (((l * c) % 2) + ((l * c) % 3)) % 2 === 0,
  (l, c) => (((l + c) % 2) + ((l * c) % 3)) % 2 === 0,
];

/* As informacoes de formato (nivel + mascara, BCH 15,5), nas duas copias, e o
   modulo escuro fixo. */
function desenharFormato(m, fixo, n, mascara) {
  const dados = (BITS_DO_NIVEL_M << 3) | mascara;
  let resto = dados;
  for (let i = 0; i < 10; i++) resto = (resto << 1) ^ ((resto >>> 9) * 0x537);
  const bits = ((dados << 10) | resto) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1;
  const por = (l, c, escuro) => {
    m[l][c] = escuro;
    fixo[l][c] = true;
  };
  for (let i = 0; i <= 5; i++) por(i, 8, bit(i));
  por(7, 8, bit(6));
  por(8, 8, bit(7));
  por(8, 7, bit(8));
  for (let i = 9; i < 15; i++) por(8, 14 - i, bit(i));
  for (let i = 0; i < 8; i++) por(8, n - 1 - i, bit(i));
  for (let i = 8; i < 15; i++) por(n - 15 + i, 8, bit(i));
  por(n - 8, 8, true);
}

/* A penalidade de uma matriz ja mascarada (ISO/IEC 18004, 7.8.3): N1 corridas
   de cinco ou mais da mesma cor, N2 blocos 2x2 da mesma cor, N3 o padrao
   1:1:3:1:1 com quatro claros de um lado, N4 o desvio da metade escura. */
function penalidade(m, n) {
  let pontos = 0;
  for (let a = 0; a < n; a++) {
    let corLinha = null;
    let naLinha = 0;
    let corColuna = null;
    let naColuna = 0;
    for (let b = 0; b < n; b++) {
      if (m[a][b] === corLinha) naLinha++;
      else {
        if (naLinha >= 5) pontos += 3 + naLinha - 5;
        corLinha = m[a][b];
        naLinha = 1;
      }
      if (m[b][a] === corColuna) naColuna++;
      else {
        if (naColuna >= 5) pontos += 3 + naColuna - 5;
        corColuna = m[b][a];
        naColuna = 1;
      }
    }
    if (naLinha >= 5) pontos += 3 + naLinha - 5;
    if (naColuna >= 5) pontos += 3 + naColuna - 5;
  }
  for (let l = 0; l < n - 1; l++) {
    for (let c = 0; c < n - 1; c++) {
      const v = m[l][c];
      if (v === m[l][c + 1] && v === m[l + 1][c] && v === m[l + 1][c + 1]) pontos += 3;
    }
  }
  for (let a = 0; a < n; a++) {
    let naLinha = 0;
    let naColuna = 0;
    for (let b = 0; b < n; b++) {
      naLinha = ((naLinha << 1) & 0x7ff) | (m[a][b] ? 1 : 0);
      naColuna = ((naColuna << 1) & 0x7ff) | (m[b][a] ? 1 : 0);
      if (b >= 10) {
        if (naLinha === 0x5d0 || naLinha === 0x05d) pontos += 40;
        if (naColuna === 0x5d0 || naColuna === 0x05d) pontos += 40;
      }
    }
  }
  let escuros = 0;
  for (let l = 0; l < n; l++) for (let c = 0; c < n; c++) if (m[l][c]) escuros++;
  pontos += Math.abs(Math.ceil((escuros * 100) / (n * n) / 5) - 10) * 10;
  return pontos;
}

/* A matriz do QR Code do texto: { versao, mascara, tamanho, modulos } — com
   modulos[linha][coluna] = true para o modulo escuro, sem a zona de silencio.
   Lanca erro quando o texto nao cabe na versao 40. */
function matrizDoQrCode(texto) {
  const bytes = Array.from(Buffer.from(String(texto), "utf8"));
  let versao = 0;
  for (let v = 1; v <= 40; v++) {
    if (4 + bitsDoContador(v) + bytes.length * 8 <= codigosDeDados(v) * 8) {
      versao = v;
      break;
    }
  }
  if (!versao) throw new Error(`conteudo grande demais para um QR Code (${bytes.length} bytes)`);

  const n = versao * 4 + 17;
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  const fixo = Array.from({ length: n }, () => new Array(n).fill(false));
  const por = (l, c, escuro) => {
    m[l][c] = escuro;
    fixo[l][c] = true;
  };

  // Temporizacao, localizadores (com a borda clara) e alinhamento.
  for (let i = 0; i < n; i++) {
    por(6, i, i % 2 === 0);
    por(i, 6, i % 2 === 0);
  }
  for (const [lc, cc] of [[3, 3], [3, n - 4], [n - 4, 3]]) {
    for (let dl = -4; dl <= 4; dl++) {
      for (let dc = -4; dc <= 4; dc++) {
        const l = lc + dl;
        const c = cc + dc;
        if (l < 0 || l >= n || c < 0 || c >= n) continue;
        const d = Math.max(Math.abs(dl), Math.abs(dc));
        por(l, c, d !== 2 && d !== 4);
      }
    }
  }
  const centros = centrosDeAlinhamento(versao);
  const ultimo = centros.length - 1;
  for (let i = 0; i < centros.length; i++) {
    for (let j = 0; j < centros.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ultimo) || (i === ultimo && j === 0)) continue;
      for (let dl = -2; dl <= 2; dl++) {
        for (let dc = -2; dc <= 2; dc++) por(centros[i] + dl, centros[j] + dc, Math.max(Math.abs(dl), Math.abs(dc)) !== 1);
      }
    }
  }

  // Formato (reservado agora, o valor certo entra com a mascara) e versao (7+).
  desenharFormato(m, fixo, n, 0);
  if (versao >= 7) {
    let resto = versao;
    for (let i = 0; i < 12; i++) resto = (resto << 1) ^ ((resto >>> 11) * 0x1f25);
    const bits = (versao << 12) | resto;
    for (let i = 0; i < 18; i++) {
      const escuro = ((bits >>> i) & 1) === 1;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      por(b, a, escuro);
      por(a, b, escuro);
    }
  }

  // Os dados, em zigue-zague de baixo para cima, duas colunas por vez,
  // pulando a coluna 6 (temporizacao).
  const codigos = codigosFinais(codigosDosDados(bytes, versao), versao);
  const totalDeBits = codigos.length * 8;
  let i = 0;
  for (let direita = n - 1; direita >= 1; direita -= 2) {
    if (direita === 6) direita = 5;
    const subindo = ((direita + 1) & 2) === 0;
    for (let k = 0; k < n; k++) {
      const l = subindo ? n - 1 - k : k;
      for (let j = 0; j < 2; j++) {
        const c = direita - j;
        if (fixo[l][c]) continue;
        m[l][c] = i < totalDeBits && ((codigos[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }

  // A mascara de menor penalidade (o formato de cada uma entra na conta).
  const aplicar = (k) => {
    for (let l = 0; l < n; l++) for (let c = 0; c < n; c++) if (!fixo[l][c] && MASCARAS[k](l, c)) m[l][c] = !m[l][c];
  };
  let mascara = 0;
  let menor = Infinity;
  for (let k = 0; k < 8; k++) {
    desenharFormato(m, fixo, n, k);
    aplicar(k);
    const p = penalidade(m, n);
    aplicar(k);
    if (p < menor) {
      menor = p;
      mascara = k;
    }
  }
  aplicar(mascara);
  desenharFormato(m, fixo, n, mascara);
  return { versao, mascara, tamanho: n, modulos: m };
}

module.exports = { matrizDoQrCode };
