/**
 * Copia o código que MONTA A COMANDA no Assistente de Impressão para dentro do
 * site, para a prévia de "Personalizar impressão" rodar o MESMO código que
 * imprime.
 *
 *   node scripts/gerar-comanda-do-assistente.mjs            (regrava o arquivo)
 *   node scripts/gerar-comanda-do-assistente.mjs --conferir  (falha se estiver velho)
 *
 * ── Por que uma cópia gerada ────────────────────────────────────────────────
 *
 * A prévia era uma segunda implementação, em TypeScript, do que o Assistente
 * faz em JavaScript (lib/comanda-modelo.ts `montarComanda`). Duas cópias
 * divergem: em 23/09/2026 a Pizzaria do Costa escolheu 58 mm na tela, viu um
 * papel comportado e recebeu números em corpo triplo quebrando em três linhas.
 * A lista de diferenças tinha mais de vinte itens — letra só alta que a prévia
 * não sabia desenhar, avisos que ela nem mostrava, valores à direita juntados.
 *
 * O site em produção roda só com o que foi compilado (output standalone): a
 * pasta do Assistente não vai junto, então ler o server.js em tempo de
 * execução não funciona. Daí a cópia, commitada, com assinatura — e o
 * `--conferir` para ninguém subir um Assistente novo com a prévia velha.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVIDOR = path.join(raiz, "firehub-print-assistant", "server.js");
const PACOTE = path.join(raiz, "firehub-print-assistant", "package.json");
const DESTINO = path.join(raiz, "src", "lib", "gerado", "comanda-do-assistente.ts");

// As funções que o buildEscPos usa — a mesma lista dos testes do Assistente
// (firehub-print-assistant/scripts/teste-modelo-comanda.js). Função auxiliar
// nova no server.js que o buildEscPos chame tem que entrar aqui também, senão
// a prévia quebra com ReferenceError (e o --conferir avisa antes).
const FUNCOES = ["cleanAscii", "documentoDoCliente", "nomeSemDocumento", "normalizarCombo", "buildEscPos"];

const fonte = fs.readFileSync(SERVIDOR, "utf8").replace(/\r\n/g, "\n");
function recortar(nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  if (inicio < 0) throw new Error(`não achei function ${nome} em server.js`);
  let nivel = 0;
  let i = fonte.indexOf("{", inicio);
  for (; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}") { nivel--; if (nivel === 0) break; }
  }
  if (nivel !== 0) throw new Error(`chaves desbalanceadas em ${nome}`);
  return fonte.slice(inicio, i + 1);
}

const codigo = FUNCOES.map(recortar).join("\n\n");
const versao = JSON.parse(fs.readFileSync(PACOTE, "utf8")).version;
const assinatura = crypto.createHash("sha256").update(codigo).digest("hex").slice(0, 16);

const conteudo = `// @ts-nocheck
/* eslint-disable */
/**
 * GERADO por scripts/gerar-comanda-do-assistente.mjs — NÃO EDITE AQUI.
 *
 * É o código que monta a comanda no Assistente de Impressão
 * (firehub-print-assistant/server.js, versão ${versao}), copiado para a prévia
 * de "Personalizar impressão" desenhar o papel com o MESMO código que imprime.
 * Mudou o server.js? Rode o script de novo; \`--conferir\` falha enquanto esta
 * cópia estiver velha.
 */

// No navegador não há Buffer: o buildEscPos devolve o texto "binário" (um
// caractere por byte) em vez do Buffer que ele manda para a impressora.
const Buffer = { from: (texto) => texto };

${codigo}

export const VERSAO_DO_ASSISTENTE = ${JSON.stringify(versao)};
export const ASSINATURA_DO_CODIGO = ${JSON.stringify(assinatura)};

/** Os bytes ESC/POS da comanda, como o Assistente ${versao} manda para a impressora. */
export function comandaDoAssistente(order, storeName, columns, profile = "safe") {
  return buildEscPos(order, storeName, columns, profile);
}
`;

if (process.argv.includes("--conferir")) {
  const atual = fs.existsSync(DESTINO) ? fs.readFileSync(DESTINO, "utf8").replace(/\r\n/g, "\n") : "";
  if (atual !== conteudo) {
    console.error(`A prévia está VELHA: ${path.relative(raiz, DESTINO)} não é a cópia do server.js atual.`);
    console.error("Rode: node scripts/gerar-comanda-do-assistente.mjs");
    process.exit(1);
  }
  console.log(`Prévia em dia com o Assistente ${versao} (${assinatura}).`);
} else {
  fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
  fs.writeFileSync(DESTINO, conteudo);
  console.log(`Gravado ${path.relative(raiz, DESTINO)} — Assistente ${versao}, assinatura ${assinatura}.`);
}
