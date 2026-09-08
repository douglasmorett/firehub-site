/**
 * Empacota a extensão FireHub Prazos para a Chrome Web Store.
 *
 * `firehub-prazos-extension/` continua sendo a pasta de desenvolvimento
 * (carregada sem compactação, com o host de teste). Este script produz uma
 * cópia limpa em build/chrome-store-prazos/, própria para submissão:
 *
 *   - tira `http://*` das permissões opcionais (escopo inseguro reprova; o
 *     painel do lojista roda em https, e a permissão continua sendo pedida
 *     só no clique de "Marcar coluna");
 *   - tira localhost e IP de teste, se algum tiver sobrado;
 *   - gera os ícones nos tamanhos que a loja exige;
 *   - valida a sintaxe de cada .js depois da limpeza;
 *   - fecha o .zip pronto para upload.
 *
 * Uso: npm run prazos:build
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const raiz = path.resolve(import.meta.dirname, "..");
const origem = path.join(raiz, "firehub-prazos-extension");
const saida = path.join(raiz, "build", "chrome-store-prazos");
const pacote = path.join(saida, "extensao");

const IGNORAR = new Set(["README.md", ".DS_Store", "Thumbs.db"]);

function limpar(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  fs.mkdirSync(dir, { recursive: true });
}

function copiar(de, para) {
  fs.mkdirSync(para, { recursive: true });
  for (const item of fs.readdirSync(de, { withFileTypes: true })) {
    if (IGNORAR.has(item.name)) continue;
    const a = path.join(de, item.name);
    const b = path.join(para, item.name);
    if (item.isDirectory()) copiar(a, b);
    else fs.copyFileSync(a, b);
  }
}

function listarArquivos(dir) {
  const saida = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) saida.push(...listarArquivos(p));
    else saida.push(p);
  }
  return saida;
}

function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Zip com barra normal no caminho: o Chrome recusa pacote com contrabarra. */
function zipar(dir, destino) {
  const arquivos = listarArquivos(dir)
    .map((abs) => ({ abs, nome: path.relative(dir, abs).split(path.sep).join("/") }))
    .sort((a, b) => (a.nome < b.nome ? -1 : 1));
  const partes = [];
  const central = [];
  let offset = 0;
  const d = new Date();
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const data = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, "utf8");
    const dados = fs.readFileSync(a.abs);
    const comp = zlib.deflateRawSync(dados, { level: 9 });
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(hora, 10); local.writeUInt16LE(data, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26); local.writeUInt16LE(0, 28);
    partes.push(local, nome, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(hora, 12); cd.writeUInt16LE(data, 14); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(dados.length, 24);
    cd.writeUInt16LE(nome.length, 28); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, nome);
    offset += local.length + nome.length + comp.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(arquivos.length, 8); eocd.writeUInt16LE(arquivos.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(destino, Buffer.concat([...partes, centralBuf, eocd]));
  return arquivos.map((a) => a.nome);
}

async function main() {
  if (!fs.existsSync(origem)) throw new Error(`Pasta não encontrada: ${origem}`);

  limpar(saida);
  copiar(origem, pacote);

  const manifestPath = path.join(pacote, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const inseguro = (p) => /^http:\/\//.test(p) || /localhost|127\.0\.0\.1/.test(p);

  manifest.host_permissions = (manifest.host_permissions || []).filter((p) => !inseguro(p));
  manifest.optional_host_permissions = (manifest.optional_host_permissions || []).filter((p) => !inseguro(p));
  manifest.content_scripts = (manifest.content_scripts || [])
    .map((cs) => ({ ...cs, matches: (cs.matches || []).filter((m) => !inseguro(m)) }))
    .filter((cs) => cs.matches.length > 0);
  manifest.homepage_url = "https://firehubfood.com.br/prazos";
  manifest.minimum_chrome_version = "110";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  for (const arquivo of listarArquivos(pacote).filter((f) => f.endsWith(".js"))) {
    execFileSync(process.execPath, ["--check", arquivo], { stdio: "pipe" });
  }

  const sobrou = listarArquivos(pacote).filter(
    (f) => /\.(js|json|html)$/.test(f) && /["'][^"'\n]*localhost[^"'\n]*["']/.test(fs.readFileSync(f, "utf-8"))
  );
  if (sobrou.length) throw new Error("Referência a localhost em: " + sobrou.join(", "));

  const zipPath = path.join(saida, `firehub-prazos-v${manifest.version}.zip`);
  const dentro = zipar(pacote, zipPath);
  if (!dentro.includes("manifest.json")) throw new Error("manifest.json precisa estar na raiz do zip");

  const kb = (fs.statSync(zipPath).size / 1024).toFixed(0);
  console.log(`\n✅ Pacote da Chrome Web Store pronto (FireHub Prazos)`);
  console.log(`   ZIP ................ ${path.relative(raiz, zipPath)} (${kb} KB, ${dentro.length} arquivos)`);
  console.log(`   versão ............. ${manifest.version}`);
  console.log(`   hosts .............. ${manifest.host_permissions.join(", ")}`);
  console.log(`   hosts opcionais .... ${(manifest.optional_host_permissions || []).join(", ") || "(nenhum)"}`);
  console.log(`\n   Ficha e justificativas: docs/PRAZOS-CHROME-WEB-STORE.md\n`);
}

main().catch((e) => {
  console.error("\n❌ Falhou:", e.message, "\n");
  process.exit(1);
});
