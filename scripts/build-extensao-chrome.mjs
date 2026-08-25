/**
 * Empacota a extensão FireHub para a Chrome Web Store.
 *
 * A pasta `firehub-ifood-extension/` continua sendo a de desenvolvimento
 * (com localhost, carregada sem compactação). Este script produz uma cópia
 * limpa em build/chrome-store/, própria para submissão:
 *
 *   - tira localhost do manifest e dos scripts (a revisão barra host amplo)
 *   - gera os ícones nos tamanhos certos (hoje os três são 512x512)
 *   - valida a sintaxe de cada .js depois da limpeza
 *   - fecha o .zip pronto para upload
 *   - separa os assets da ficha da loja (ícone 128 e screenshot 1280x800)
 *
 * Uso: npm run extensao:build
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import sharp from "sharp";

const raiz = path.resolve(import.meta.dirname, "..");
const origem = path.join(raiz, "firehub-ifood-extension");
const saida = path.join(raiz, "build", "chrome-store");
const pacote = path.join(saida, "extensao");
const assetsLoja = path.join(saida, "loja");

// Arquivos que não devem ir para a loja
const IGNORAR = new Set(["README.md", ".DS_Store", "Thumbs.db"]);

function limpar(dir) {
  // maxRetries: no Windows o antivírus costuma segurar o handle por um instante
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  fs.mkdirSync(dir, { recursive: true });
}

function copiar(de, para) {
  fs.mkdirSync(para, { recursive: true });
  for (const item of fs.readdirSync(de, { withFileTypes: true })) {
    if (IGNORAR.has(item.name)) continue;
    const origemItem = path.join(de, item.name);
    const destinoItem = path.join(para, item.name);
    if (item.isDirectory()) copiar(origemItem, destinoItem);
    else fs.copyFileSync(origemItem, destinoItem);
  }
}

/**
 * Tira os literais "http://localhost..." das listas de candidatos, levando junto
 * só a vírgula do próprio item — vírgula de outro elemento fica onde está.
 */
function tirarLocalhost(codigo) {
  const ITEM = `["']https?:\\/\\/localhost(?::\\d+)?[^"']*["']`;
  const temItem = new RegExp(ITEM);
  const linhas = codigo.split("\n");
  const saida = [];

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!temItem.test(linha)) {
      saida.push(linha);
      continue;
    }

    // Leva junto uma única vírgula: a de trás quando existe, senão a da frente.
    const limpa = linha
      .replace(new RegExp(`,[ \\t]*${ITEM}`, "g"), "")
      .replace(new RegExp(`${ITEM}[ \\t]*,[ \\t]*`, "g"), "")
      .replace(new RegExp(ITEM, "g"), "");

    if (limpa.trim() !== "") {
      saida.push(limpa);
      continue;
    }

    // A linha só existia para o localhost: some com ela. Se o item era o último
    // do array, a vírgula da linha de cima passa a sobrar.
    const proxima = linhas.slice(i + 1).find((l) => l.trim() !== "") || "";
    if (/^\s*[\]\}\)]/.test(proxima)) {
      const anterior = saida.findLastIndex((l) => l.trim() !== "");
      if (anterior >= 0) saida[anterior] = saida[anterior].replace(/,\s*$/, "");
    }
  }

  return saida.join("\n");
}

function listarArquivos(dir) {
  const saida = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const alvo = path.join(dir, item.name);
    if (item.isDirectory()) saida.push(...listarArquivos(alvo));
    else saida.push(alvo);
  }
  return saida;
}

/**
 * Fecha o .zip com o manifest na raiz e separador "/" nos caminhos.
 * O Compress-Archive do Windows grava "\" e embrulha tudo numa pasta pai —
 * a Chrome Web Store rejeita o pacote nos dois casos.
 */
function zipar(dirRaiz, destino) {
  const arquivos = listarArquivos(dirRaiz).map((abs) => ({
    nome: path.relative(dirRaiz, abs).split(path.sep).join("/"),
    dados: fs.readFileSync(abs),
  }));

  const partes = [];
  const central = [];
  let offset = 0;

  for (const { nome, dados } of arquivos) {
    const nomeBuf = Buffer.from(nome, "utf-8");
    const comprimido = zlib.deflateRawSync(dados, { level: 9 });
    const crc = zlib.crc32(dados);

    const local = Buffer.alloc(30 + nomeBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // bit 11: nome em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // hora
    local.writeUInt16LE(0x21, 12); // data fixa (1980-01-01) para build reprodutível
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nomeBuf.copy(local, 30);

    partes.push(local, comprimido);

    const cd = Buffer.alloc(46 + nomeBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comprimido.length, 20);
    cd.writeUInt32LE(dados.length, 24);
    cd.writeUInt16LE(nomeBuf.length, 28);
    cd.writeUInt32LE(offset, 42); // offset do local header
    nomeBuf.copy(cd, 46);
    central.push(cd);

    offset += local.length + comprimido.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(arquivos.length, 8);
  eocd.writeUInt16LE(arquivos.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  fs.writeFileSync(destino, Buffer.concat([...partes, centralBuf, eocd]));
  return arquivos.map((a) => a.nome);
}

async function main() {
  if (!fs.existsSync(origem)) {
    throw new Error(`Pasta da extensão não encontrada: ${origem}`);
  }

  limpar(saida);
  copiar(origem, pacote);

  // ── manifest: escopo de produção apenas ─────────────────────────────
  const manifestPath = path.join(pacote, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const ehLocal = (padrao) => /localhost|127\.0\.0\.1|vercel\.app/.test(padrao);

  manifest.host_permissions = (manifest.host_permissions || []).filter((p) => !ehLocal(p));
  manifest.content_scripts = (manifest.content_scripts || [])
    .map((cs) => ({ ...cs, matches: (cs.matches || []).filter((m) => !ehLocal(m)) }))
    .filter((cs) => cs.matches.length > 0);
  manifest.homepage_url = "https://firehubfood.com.br";
  manifest.minimum_chrome_version = "110";

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

  // ── scripts: nenhuma chamada sobrando para localhost ────────────────
  const jsFiles = listarArquivos(pacote).filter((f) => f.endsWith(".js"));
  for (const arquivo of jsFiles) {
    const antes = fs.readFileSync(arquivo, "utf-8");
    const depois = tirarLocalhost(antes);
    if (antes !== depois) fs.writeFileSync(arquivo, depois, "utf-8");
    execFileSync(process.execPath, ["--check", arquivo], { stdio: "pipe" });
  }

  // Só conta localhost dentro de string — comentário não vira requisição.
  const sobrou = listarArquivos(pacote).filter(
    (f) =>
      /\.(js|json|html)$/.test(f) &&
      /["'][^"'\n]*localhost[^"'\n]*["']/.test(fs.readFileSync(f, "utf-8"))
  );
  if (sobrou.length) {
    throw new Error("Ainda há referência a localhost em: " + sobrou.join(", "));
  }

  // ── ícones nos tamanhos reais ───────────────────────────────────────
  const iconeMestre = path.join(origem, "icons", "icon128.png");
  for (const tamanho of [16, 48, 128]) {
    await sharp(iconeMestre)
      .resize(tamanho, tamanho, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(pacote, "icons", `icon${tamanho}.png`));
  }

  // ── assets da ficha da loja ─────────────────────────────────────────
  fs.mkdirSync(assetsLoja, { recursive: true });
  await sharp(iconeMestre).resize(128, 128).png().toFile(path.join(assetsLoja, "icone-loja-128.png"));
  await sharp(path.join(raiz, "public", "images", "ifood_eta_banner.jpg"))
    .resize(1180, 700, { fit: "contain", background: "#FFFFFF" })
    .extend({ top: 50, bottom: 50, left: 50, right: 50, background: "#FFFFFF" })
    .jpeg({ quality: 92 })
    .toFile(path.join(assetsLoja, "screenshot-1280x800.jpg"));
  await sharp(path.join(raiz, "public", "images", "ifood_eta_banner.jpg"))
    .resize(440, 280, { fit: "cover" })
    .jpeg({ quality: 92 })
    .toFile(path.join(assetsLoja, "tile-promocional-440x280.jpg"));

  // ── zip ─────────────────────────────────────────────────────────────
  const zipPath = path.join(saida, `firehub-ifood-extension-v${manifest.version}.zip`);
  const dentro = zipar(pacote, zipPath);
  if (!dentro.includes("manifest.json")) {
    throw new Error("manifest.json precisa estar na raiz do zip");
  }

  const kb = (fs.statSync(zipPath).size / 1024).toFixed(0);
  console.log(`\n✅ Pacote da Chrome Web Store pronto`);
  console.log(`   ZIP .............. ${path.relative(raiz, zipPath)} (${kb} KB, ${dentro.length} arquivos)`);
  console.log(`   versão ........... ${manifest.version}`);
  console.log(`   hosts ............ ${manifest.host_permissions.join(", ")}`);
  console.log(`   assets da ficha .. ${path.relative(raiz, assetsLoja)}`);
  console.log(`\n   Suba o ZIP em https://chrome.google.com/webstore/devconsole`);
  console.log(`   Visibilidade: Não listada. Passo a passo: docs/EXTENSAO-CHROME-WEB-STORE.md\n`);
}

main().catch((e) => {
  console.error("\n❌ Falhou:", e.message, "\n");
  process.exit(1);
});
