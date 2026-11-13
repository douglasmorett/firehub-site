/**
 * scripts/montar-semente.js — a SEMENTE do instalador completo do FireHub.
 *
 * A semente é o que o instalador completo leva dentro dele para o computador
 * da loja não depender de baixar nada na ativação (contingencia.js, "A
 * semente do instalador completo"):
 *
 *   <saida>/semente.json          o que tem dentro (versão, quantos, tamanho)
 *   <saida>/objetos/<sha256>      cada arquivo do FireHub, pelo hash — o mesmo
 *                                 formato de %APPDATA%\FireHub\contingencia\objetos
 *   <saida>/runtime/node.zip      Node 22 (hash fixo do contingencia.js)
 *   <saida>/runtime/postgres.tgz  Postgres 17 (hash fixo do contingencia.js)
 *
 * Os arquivos do FireHub saem da lista do pacote (<app>/contingencia/pacote.json),
 * a mesma que o build ASSINA (scripts/contingencia/assinar-pacote.mjs). Para o
 * instalador de verdade, <app> é o /app da imagem publicada (ghcr.io/…:<commit>,
 * ver .github/workflows/instalador-completo.yml): aí cada hash bate com a
 * lista assinada que a nuvem entrega na ativação. Com <app> de um build local,
 * a semente serve para TESTE — na ativação real só aproveita o que coincidir.
 * A semente nunca é assinada aqui: quem decide o que entra é a lista assinada.
 *
 *   node scripts/montar-semente.js --app <pasta do /app> --saida <pasta> [--runtime] [--cache <pasta>]
 *   node scripts/montar-semente.js --saida <pasta> --runtime        (só o Node e o Postgres)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

function argumento(nome) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : null;
}

function sha256DoArquivo(arquivo) {
  return crypto.createHash("sha256").update(fs.readFileSync(arquivo)).digest("hex");
}

/** A lista do pacote; sem ela, monta uma SEM assinatura com o mesmo script do build. */
function listaDoPacote(app) {
  const arquivo = path.join(app, "contingencia", "pacote.json");
  if (!fs.existsSync(arquivo)) {
    const script = path.resolve(__dirname, "..", "..", "scripts", "contingencia", "assinar-pacote.mjs");
    // Chave apontando para lugar nenhum: nada é assinado fora do GitHub.
    const r = spawnSync(process.execPath, [script, app], {
      stdio: "inherit",
      env: { ...process.env, CONTINGENCIA_CHAVE_PRIVADA_ARQUIVO: path.join(app, "sem-chave-aqui") },
    });
    if (r.status !== 0) throw new Error("Não consegui montar a lista do pacote.");
  }
  return JSON.parse(fs.readFileSync(arquivo, "utf8"));
}

function semearArquivos(app, saida) {
  const lista = listaDoPacote(app);
  const objetos = path.join(saida, "objetos");
  fs.mkdirSync(objetos, { recursive: true });
  let bytes = 0;
  let novos = 0;
  const vistos = new Set();
  for (const a of lista.arquivos) {
    if (!/^[0-9a-f]{64}$/.test(a.hash) || vistos.has(a.hash)) continue;
    vistos.add(a.hash);
    const destino = path.join(objetos, a.hash);
    if (fs.existsSync(destino)) {
      bytes += fs.statSync(destino).size;
      continue;
    }
    const origem = path.join(app, a.caminho);
    const dados = fs.readFileSync(origem);
    const h = crypto.createHash("sha256").update(dados).digest("hex");
    if (h !== a.hash) throw new Error(`A lista não confere com o arquivo: ${a.caminho}. Monte a lista de novo.`);
    fs.writeFileSync(destino, dados);
    bytes += dados.length;
    novos++;
  }
  return { versao: lista.versao, arquivos: vistos.size, novos, bytes };
}

async function baixarConferindo(url, destino, conferir) {
  if (fs.existsSync(destino) && conferir(fs.readFileSync(destino))) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  const dados = Buffer.from(await r.arrayBuffer());
  if (!conferir(dados)) throw new Error(`O hash de ${url} não confere: nada foi gravado.`);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, dados);
}

async function semearRuntime(saida, cache) {
  // Os hashes moram no contingencia.js: é ele que confere na loja.
  process.env.APPDATA = process.env.APPDATA || saida;
  const { NODE, POSTGRES } = require("../contingencia");
  const runtime = path.join(saida, "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  const confereNode = (d) => crypto.createHash("sha256").update(d).digest("hex") === NODE.sha256;
  const conferePg = (d) => crypto.createHash("sha512").update(d).digest("base64") === POSTGRES.sha512b64;
  for (const [nome, url, conferir] of [["node.zip", NODE.url, confereNode], ["postgres.tgz", POSTGRES.url, conferePg]]) {
    const destino = path.join(runtime, nome);
    const doCache = cache ? path.join(cache, nome) : null;
    if (doCache && fs.existsSync(doCache) && conferir(fs.readFileSync(doCache))) fs.copyFileSync(doCache, destino);
    await baixarConferindo(url, destino, conferir);
    if (doCache && !fs.existsSync(doCache)) {
      fs.mkdirSync(cache, { recursive: true });
      fs.copyFileSync(destino, doCache);
    }
  }
  return { node: NODE.pasta, postgres: POSTGRES.pasta, bytes: fs.statSync(path.join(runtime, "node.zip")).size + fs.statSync(path.join(runtime, "postgres.tgz")).size };
}

async function principal() {
  const app = argumento("--app");
  const saida = argumento("--saida");
  if (!saida) throw new Error("Uso: node scripts/montar-semente.js --app <pasta> --saida <pasta> [--runtime] [--cache <pasta>]");
  fs.mkdirSync(saida, { recursive: true });
  const descricaoAntiga = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(saida, "semente.json"), "utf8")); } catch { return {}; }
  })();
  const descricao = { ...descricaoAntiga, criadoEm: new Date().toISOString() };
  if (app) {
    const r = semearArquivos(path.resolve(app), saida);
    Object.assign(descricao, { versao: r.versao, arquivos: r.arquivos, bytesDoFireHub: r.bytes });
    console.log(`FireHub ${r.versao}: ${r.arquivos} arquivos (${r.novos} novos), ${(r.bytes / 1024 / 1024).toFixed(1)} MB.`);
  }
  if (process.argv.includes("--runtime")) {
    const r = await semearRuntime(saida, argumento("--cache"));
    Object.assign(descricao, { runtime: { node: r.node, postgres: r.postgres }, bytesDoRuntime: r.bytes });
    console.log(`Runtime: ${r.node} + ${r.postgres}, ${(r.bytes / 1024 / 1024).toFixed(1)} MB.`);
  }
  fs.writeFileSync(path.join(saida, "semente.json"), JSON.stringify(descricao, null, 2));
  console.log(`Semente em ${saida}.`);
}

if (require.main === module) {
  principal().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}

module.exports = { semearArquivos, sha256DoArquivo };
