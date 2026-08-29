import { montarZip } from "../src/lib/zip.ts";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zipteste-"));
const zipPath = path.join(dir, "pacote.zip");
const buf = montarZip([
  { nome: "vendas.csv", conteudo: "data;valor\n2026-08-29;10,50\n" },
  { nome: "xml/nota-1.xml", conteudo: "<nfeProc>acentuação çãé</nfeProc>" },
]);
fs.writeFileSync(zipPath, buf);
console.log("zip escrito:", buf.length, "bytes");

// Descompacta com o próprio Windows (Expand-Archive) — se ele abrir, abre em
// qualquer lugar. É o teste que importa: o contador vai abrir com duplo clique.
const saida = path.join(dir, "saida");
execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${saida}' -Force"`, { stdio: "pipe" });

const csv = fs.readFileSync(path.join(saida, "vendas.csv"), "utf8");
const xml = fs.readFileSync(path.join(saida, "xml", "nota-1.xml"), "utf8");
let falhas = 0;
if (csv !== "data;valor\n2026-08-29;10,50\n") { console.log("FALHOU csv:", JSON.stringify(csv)); falhas++; }
else console.log("  ok  csv volta idêntico");
if (xml !== "<nfeProc>acentuação çãé</nfeProc>") { console.log("FALHOU xml:", JSON.stringify(xml)); falhas++; }
else console.log("  ok  xml com acento volta idêntico");
if (!fs.existsSync(path.join(saida, "xml"))) { console.log("FALHOU: subpasta não criada"); falhas++; }
else console.log("  ok  subpasta preservada");

fs.rmSync(dir, { recursive: true, force: true });
console.log(falhas === 0 ? "\nZIP OK (aberto pelo Windows)\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
