/**
 * O gerador de QR Code do Assistente de impressão (firehub-print-assistant/
 * qr-code.js): é ele que desenha o QR do DANFE NFC-e como IMAGEM (GS v 0) na
 * impressora do perfil "legacy", que não entende o comando de QR (GS ( k). O
 * QR é obrigatório no DANFE (Ajuste SINIEF 19/16, cl. 10ª, §2º, II) — então o
 * desenho tem de ser um QR de verdade, lido por qualquer celular.
 *
 *   npx tsx scripts/teste-nfce-qrcode-do-assistente.ts
 *
 * A prova: a matriz do Assistente é conferida MÓDULO A MÓDULO contra o pacote
 * `qrcode` que o site usa (o SVG do DANFE na tela), com o conteúdo em bytes
 * UTF-8 e nível M (Manual do DANFE NFC-e v6.0, 4.5.2 e 4.5.3) — a versão, a
 * máscara e cada módulo — nas 40 versões, em textos de todos os tamanhos e
 * nos QR de verdade da NFC-e (v2 online e offline, v3). E, com a mesma versão
 * e a mesma máscara forçadas no pacote, a matriz tem de ser idêntica: isso
 * separa um erro de codificação (dados, correção, posição) de uma mera
 * escolha diferente de máscara.
 */
import { join } from "node:path";
import QRCode from "qrcode";
import { confere, RAIZ, terminar, verdade } from "./nfce-teste-apoio";

type Matriz = { versao: number; mascara: number; tamanho: number; modulos: boolean[][] };
const { matrizDoQrCode } = require(join(RAIZ, "firehub-print-assistant", "qr-code.js")) as { matrizDoQrCode: (texto: string) => Matriz };

/** A matriz do pacote `qrcode` (bytes UTF-8, nível M), opcionalmente com versão e máscara forçadas. */
function referencia(texto: string, forcar: { versao?: number; mascara?: number } = {}) {
  const q = QRCode.create([{ data: Buffer.from(texto, "utf8"), mode: "byte" }], {
    errorCorrectionLevel: "M",
    ...(forcar.versao ? { version: forcar.versao } : {}),
    ...(forcar.mascara != null ? { maskPattern: forcar.mascara as any } : {}),
  });
  const n = q.modules.size;
  return {
    versao: q.version,
    mascara: q.maskPattern as number,
    modulos: Array.from({ length: n }, (_, l) => Array.from({ length: n }, (_, c) => Boolean(q.modules.get(l, c)))),
  };
}

/** Onde as duas matrizes diferem (o primeiro módulo), ou null. */
function diferenca(a: boolean[][], b: boolean[][]): string | null {
  if (a.length !== b.length) return `tamanho ${a.length} × ${b.length}`;
  for (let l = 0; l < a.length; l++) for (let c = 0; c < a.length; c++) if (a[l][c] !== b[l][c]) return `módulo (${l}, ${c})`;
  return null;
}

// ─── 1. Os QR de verdade da NFC-e ────────────────────────────────────────────
console.log("\n— QR da NFC-e (Manual do DANFE v6.0, item 4) —");
const CHAVE = "53260964568087000180650010000001011234567891";
const reais: Array<[string, string]> = [
  ["v2 online (DF, homologação)", `http://www.fazenda.df.gov.br/nfce/qrcode?p=${CHAVE}|2|2|1|8C3F4F6C1A7B9C0D1E2F3A4B5C6D7E8F9A0B1C2D`],
  ["v2 offline (contingência)", `http://www.fazenda.df.gov.br/nfce/qrcode?p=${CHAVE}|2|2|29|15.60|6a6b6c6d6e6f707172737475767778797a7b7c7d|1|F1E2D3C4B5A69788796A5B4C3D2E1F0011223344`],
  ["v3 online", `http://www.fazenda.df.gov.br/nfce/qrcode?p=${CHAVE}|3|2`],
  ["v3 offline (assinatura em base64)", `http://www.fazenda.df.gov.br/nfce/qrcode?p=${CHAVE}|3|2|29|15.60|||${"QUJD".repeat(64)}==`],
];
for (const [nome, texto] of reais) {
  const meu = matrizDoQrCode(texto);
  const ref = referencia(texto);
  confere(`${nome}: versão, máscara e todos os módulos iguais aos do pacote qrcode`, [meu.versao, meu.mascara, diferenca(meu.modulos, ref.modulos)], [ref.versao, ref.mascara, null]);
}

// ─── 2. As 40 versões ───────────────────────────────────────────────────────
console.log("\n— As 40 versões, em textos de 1 a 2.331 bytes —");
{
  const versoes = new Set<number>();
  const erros: string[] = [];
  let mesmaMascara = 0;
  let casos = 0;
  for (let tamanho = 1; tamanho <= 2331; tamanho += tamanho < 300 ? 1 : 9) {
    // Texto que muda a cada tamanho (a máscara e o enchimento variam).
    const texto = Array.from({ length: tamanho }, (_, i) => String.fromCharCode(33 + ((i * 7 + tamanho) % 94))).join("");
    const meu = matrizDoQrCode(texto);
    const ref = referencia(texto);
    casos++;
    versoes.add(meu.versao);
    if (meu.versao !== ref.versao) {
      erros.push(`${tamanho} bytes: versão ${meu.versao} × ${ref.versao}`);
      continue;
    }
    if (meu.mascara === ref.mascara) mesmaMascara++;
    // Mesma versão e mesma máscara no pacote: a matriz tem de ser idêntica.
    const d = diferenca(meu.modulos, referencia(texto, { versao: meu.versao, mascara: meu.mascara }).modulos);
    if (d) erros.push(`${tamanho} bytes (versão ${meu.versao}, máscara ${meu.mascara}): ${d}`);
  }
  confere("as 40 versões foram cobertas", [...versoes].sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i + 1));
  confere(`${casos} textos: a matriz do Assistente é a do pacote (com a mesma versão e máscara)`, erros.slice(0, 5), []);
  confere(`${casos} textos: a máscara escolhida (menor penalidade) é a mesma do pacote`, mesmaMascara, casos);
}

// ─── 3. UTF-8 e limites ─────────────────────────────────────────────────────
console.log("\n— UTF-8 e o limite da versão 40 —");
{
  const acentos = "Pão de queijo — ação ☕ Brasília";
  const meu = matrizDoQrCode(acentos);
  const ref = referencia(acentos);
  confere("texto com acento e símbolo vai em bytes UTF-8 (Manual 4.5.3)", [meu.versao, diferenca(meu.modulos, ref.modulos)], [ref.versao, null]);
  confere("2.331 bytes (o máximo do nível M) ainda cabem na versão 40", matrizDoQrCode("x".repeat(2331)).versao, 40);
  let erro = "";
  try {
    matrizDoQrCode("x".repeat(2332));
  } catch (e: any) {
    erro = String(e?.message ?? e);
  }
  verdade("2.332 bytes: erro (não desenha um QR que ninguém lê)", /grande demais/.test(erro), erro);
  confere("a matriz é quadrada, 4 × versão + 17", [meu.tamanho, meu.modulos.length, meu.modulos.every((l) => l.length === meu.tamanho)], [meu.versao * 4 + 17, meu.versao * 4 + 17, true]);
}

terminar();
