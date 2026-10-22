/**
 * Copia do Assistente (firehub-print-assistant/server.js) as funções que
 * montam os BYTES da comanda (buildEscPos e as quatro que ela usa) para
 * src/lib/app-firehub/comanda-escpos.gerado.ts.
 *
 * Por quê: o celular com a impressora Bluetooth (app FireHub) imprime a mesma
 * comanda do PC. Em vez de reescrever 1.800 linhas no app — e ter duas comandas
 * que divergem —, o servidor monta os bytes com o código do próprio Assistente
 * e o celular só os entrega à impressora.
 *
 * server.js não pode ser importado (sobe servidor, toca no Electron), então as
 * funções são recortadas do fonte — o mesmo recorte dos testes do Assistente
 * (firehub-print-assistant/scripts/teste-mesa-na-comanda.js).
 *
 * Rodar depois de mexer na comanda do Assistente:
 *   node scripts/gerar-comanda-do-celular.mjs
 * O teste scripts/teste-comanda-do-celular.ts falha se o gerado ficar velho.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FUNCOES = ["cleanAscii", "documentoDoCliente", "nomeSemDocumento", "normalizarCombo", "buildEscPos"];
export const DESTINO = path.join(raiz, "src", "lib", "app-firehub", "comanda-escpos.gerado.ts");

function recortar(fonte, nome) {
  const inicio = fonte.indexOf(`function ${nome}(`);
  if (inicio < 0) throw new Error(`nao achei function ${nome}`);
  let nivel = 0, i = fonte.indexOf("{", inicio);
  for (; i < fonte.length; i++) {
    if (fonte[i] === "{") nivel++;
    else if (fonte[i] === "}") { nivel--; if (nivel === 0) break; }
  }
  if (nivel !== 0) throw new Error(`chaves desbalanceadas em ${nome}`);
  return fonte.slice(inicio, i + 1);
}

export function gerar() {
  const fonte = fs.readFileSync(path.join(raiz, "firehub-print-assistant", "server.js"), "utf8");
  const versao = JSON.parse(fs.readFileSync(path.join(raiz, "firehub-print-assistant", "package.json"), "utf8")).version;
  return [
    "// @ts-nocheck",
    "/* eslint-disable */",
    `// GERADO por scripts/gerar-comanda-do-celular.mjs a partir de firehub-print-assistant/server.js (Assistente ${versao}).`,
    "// NÃO EDITE AQUI: mude no Assistente e rode o script de novo.",
    "",
    ...FUNCOES.map((n) => recortar(fonte, n) + "\n"),
    "export { buildEscPos };",
    "",
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  fs.writeFileSync(DESTINO, gerar());
  console.log(`ok: ${path.relative(raiz, DESTINO)}`);
}
