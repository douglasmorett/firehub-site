/**
 * ─────────────────────────────────────────────────────────────
 *  MODO CONTINGÊNCIA no Assistente
 *  (Obsidian: Projetos/FireHub - Modo Contingência.md)
 * ─────────────────────────────────────────────────────────────
 *
 * Dorme até a loja ativar (tela "Modo Contingência" do painel → POST
 * /contingencia/parear). Ativado, mantém no computador do caixa:
 *
 *   runtime/   Node 22 e Postgres 17 — baixados das fontes oficiais (nodejs.org
 *              e registry.npmjs.org) e conferidos por hash FIXO aqui;
 *   app/<v>/   o FireHub desta versão da nuvem (GET /api/contingencia/pacote):
 *              a lista de arquivos vem ASSINADA pelo build (chave privada só no
 *              segredo do GitHub) e é conferida com a chave pública abaixo;
 *              cada arquivo é conferido pelo sha256 da lista;
 *   o supervisor (app/<v>/contingencia/supervisor.js), que faz a cópia,
 *              percebe a queda e sobe o FireHub local na porta da loja (7890).
 *
 * Durante a queda a fila de impressão passa a ser a do computador
 * (`baseDaFilaNaContingencia`, usada por server.js → baseDaFila).
 *
 * ── Segurança ───────────────────────────────────────────────────────────────
 *   - Nada roda sem assinatura válida: nem quem tomasse o servidor do FireHub
 *     conseguiria mandar código para as lojas sem a chave privada do build.
 *   - O servidor do Assistente aceita CORS de qualquer site. Por isso as
 *     rotas daqui que MUDAM algo só aceitam pedido feito NESTE computador
 *     (127.0.0.1) e vindo da página do FireHub (Origin https://firehubfood.com.br).
 *   - A "nuvem" do pareamento só pode ser o domínio oficial.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const { Readable } = require("stream");

const PASTA_FIREHUB = path.join(process.env.APPDATA || os.homedir(), "FireHub");
const PASTA = path.join(PASTA_FIREHUB, "contingencia");
const ARQUIVO_DO_PAREAMENTO = path.join(PASTA_FIREHUB, "contingencia.bin");
const PORTA_DA_LOJA = 7890;
const ESTADO_DA_LOJA = `http://127.0.0.1:${PORTA_DA_LOJA}/__contingencia/estado`;

/**
 * A chave PÚBLICA do pacote. A privada fica no segredo CONTINGENCIA_CHAVE_PRIVADA
 * do GitHub e assina a lista no build (scripts/contingencia/assinar-pacote.mjs).
 * Trocar o par = trocar esta chave e lançar um Assistente novo.
 */
const CHAVE_PUBLICA_DO_PACOTE = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAqiTUBgC4CNlBAtmKWqWXQv0sWwuYMDLNiogWOOdgjTs=
-----END PUBLIC KEY-----`;

/**
 * Só o domínio oficial. A prova automatizada aponta para uma nuvem de teste
 * local pelo ambiente — e isso só vale FORA do instalador: no Assistente
 * instalado (app.isPackaged) a variável é ignorada.
 */
function nuvemDeTeste() {
  try {
    const { app } = require("electron");
    if (!app || app.isPackaged !== false) return null;
  } catch {
    /* fora do Electron: só a prova roda assim */
  }
  return process.env.FIREHUB_CONTINGENCIA_NUVEM_DE_TESTE || null;
}
const NUVEM_DE_TESTE = nuvemDeTeste();
const NUVENS_ACEITAS = NUVEM_DE_TESTE ? [NUVEM_DE_TESTE] : ["https://firehubfood.com.br", "https://www.firehubfood.com.br"];
const ORIGENS_ACEITAS = NUVENS_ACEITAS;

/** O que vem de fora, com hash conferido. Trocar a versão = trocar o hash junto. */
const NODE = {
  url: "https://nodejs.org/dist/v22.15.1/node-v22.15.1-win-x64.zip",
  sha256: "7c7997d6ef2efd9525a54b033fc0be6f22549a5905f5da6573a41e61a436a1b5",
  pasta: "node-v22.15.1-win-x64",
};
const POSTGRES = {
  url: "https://registry.npmjs.org/@embedded-postgres/windows-x64/-/windows-x64-17.10.0-beta.17.tgz",
  sha512b64: "q6xIETTkv67i1QlTWz1LAKb3Z+vG2V3qrp+BjLEWhCQ9jE4hbbsQ/J/3wiOPFLJbuwak7CfHC9EUJG7txAbGKw==",
  pasta: "postgres-17.10",
};

let pareamento = null; // { lojaId, chave, segredoDoBilhete, nuvem }
let etapa = "desligada";
let progresso = null;
let erro = null;
let versaoEmUso = null;
let filho = null;
/** Supervisor de pé que não é filho deste processo (o Assistente reiniciou e ele seguiu). */
let adotado = false;
let reinicios = 0;
let parando = false;
let estadoDoSupervisor = null;
let mantendo = false;
let runtime = null;

function registro(linha) {
  try {
    fs.mkdirSync(PASTA, { recursive: true });
    fs.appendFileSync(path.join(PASTA, "assistente.log"), `[${new Date().toISOString()}] ${linha}\n`);
  } catch {
    /* sem disco: segue */
  }
}

// ── O pareamento, cifrado pelo cofre do Windows ─────────────────────────────

function cofre() {
  try {
    const { safeStorage } = require("electron");
    return safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage : null;
  } catch {
    return null;
  }
}

function lerPareamento() {
  try {
    if (!fs.existsSync(ARQUIVO_DO_PAREAMENTO)) return null;
    const c = cofre();
    if (!c) return null;
    const p = JSON.parse(c.decryptString(fs.readFileSync(ARQUIVO_DO_PAREAMENTO)));
    return p && p.chave && p.lojaId && NUVENS_ACEITAS.includes(p.nuvem) ? p : null;
  } catch (e) {
    registro(`Pareamento ilegível: ${e && e.message}`);
    return null;
  }
}

function gravarPareamento(p) {
  const c = cofre();
  if (!c) throw new Error("O cofre do Windows não está disponível neste computador.");
  fs.mkdirSync(PASTA_FIREHUB, { recursive: true });
  fs.writeFileSync(ARQUIVO_DO_PAREAMENTO, c.encryptString(JSON.stringify(p)));
}

// ── Baixar com conferência ──────────────────────────────────────────────────

async function baixar(url, destino, opcoes) {
  const { headers, sha256, sha512b64, aoAvancar } = opcoes || {};
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const temporario = `${destino}.baixando`;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15 * 60_000) });
  if (!r.ok || !r.body) throw new Error(`${url} → ${r.status}`);
  const total = Number(r.headers.get("content-length")) || 0;
  const h256 = crypto.createHash("sha256");
  const h512 = crypto.createHash("sha512");
  let feito = 0;
  await new Promise((ok, falha) => {
    const saida = fs.createWriteStream(temporario);
    const entrada = Readable.fromWeb(r.body);
    entrada.on("data", (pedaco) => {
      h256.update(pedaco);
      h512.update(pedaco);
      feito += pedaco.length;
      if (aoAvancar && total) aoAvancar(feito / total);
    });
    entrada.on("error", falha);
    saida.on("error", falha);
    saida.on("finish", ok);
    entrada.pipe(saida);
  });
  const conferiu = (!sha256 || h256.digest("hex") === sha256) && (!sha512b64 || h512.digest("base64") === sha512b64);
  if (!conferiu) {
    fs.rmSync(temporario, { force: true });
    throw new Error(`Arquivo adulterado ou incompleto: ${path.basename(destino)}`);
  }
  fs.renameSync(temporario, destino);
}

function extrair(arquivo, pasta) {
  fs.mkdirSync(pasta, { recursive: true });
  // O tar.exe do próprio Windows (10 1803+) abre .zip e .tgz. Pelo caminho
  // completo: um "tar" do Git que venha antes no PATH não abre .zip.
  const doWindows = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  const tar = fs.existsSync(doWindows) ? doWindows : "tar";
  return new Promise((ok, falha) =>
    execFile(tar, ["-xf", arquivo, "-C", pasta], { windowsHide: true }, (e) => (e ? falha(e) : ok())),
  );
}

async function garantirRuntime() {
  const nodeExe = path.join(PASTA, "runtime", NODE.pasta, "node.exe");
  if (!fs.existsSync(nodeExe)) {
    etapa = "baixando o Node";
    const zip = path.join(PASTA, "baixados", "node.zip");
    await baixar(NODE.url, zip, { sha256: NODE.sha256, aoAvancar: (p) => (progresso = p * 100) });
    await extrair(zip, path.join(PASTA, "runtime"));
    fs.rmSync(zip, { force: true });
  }
  const pgBin = path.join(PASTA, "runtime", POSTGRES.pasta, "package", "native", "bin");
  if (!fs.existsSync(path.join(pgBin, "postgres.exe"))) {
    etapa = "baixando o banco (Postgres)";
    const tgz = path.join(PASTA, "baixados", "postgres.tgz");
    await baixar(POSTGRES.url, tgz, { sha512b64: POSTGRES.sha512b64, aoAvancar: (p) => (progresso = p * 100) });
    await extrair(tgz, path.join(PASTA, "runtime", POSTGRES.pasta));
    fs.rmSync(tgz, { force: true });
  }
  progresso = null;
  return { nodeExe, pgBin };
}

// ── O pacote (o FireHub desta versão), conferido pela assinatura ────────────

async function nuvemJson(caminho) {
  const r = await fetch(`${pareamento.nuvem}${caminho}`, {
    headers: { authorization: `Bearer ${pareamento.chave}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`${caminho} → ${r.status}`);
  return r.json();
}

/** A lista do pacote, só se a assinatura do build confere. */
function listaAssinada(resposta) {
  const conteudo = resposta && typeof resposta.conteudo === "string" ? resposta.conteudo : "";
  const assinatura = resposta && typeof resposta.assinatura === "string" ? resposta.assinatura : "";
  if (!conteudo || !assinatura) throw new Error("O pacote desta versão não está assinado: a contingência não instala.");
  const ok = crypto.verify(
    null,
    Buffer.from(conteudo, "utf8"),
    crypto.createPublicKey(CHAVE_PUBLICA_DO_PACOTE),
    Buffer.from(assinatura, "base64"),
  );
  if (!ok) throw new Error("A assinatura do pacote não confere: nada foi baixado.");
  const lista = JSON.parse(conteudo);
  if (!lista || !lista.versao || !Array.isArray(lista.arquivos)) throw new Error("Lista do pacote inválida.");
  return lista;
}

function caminhoSeguro(base, rel) {
  const destino = path.resolve(base, rel);
  if (!destino.startsWith(path.resolve(base) + path.sep)) throw new Error(`Caminho fora do pacote: ${rel}`);
  return destino;
}

async function sincronizarPacote() {
  const lista = listaAssinada(await nuvemJson("/api/contingencia/pacote"));
  const versao = String(lista.versao).replace(/[^A-Za-z0-9_.-]/g, "");
  const dir = path.join(PASTA, "app", versao);
  if (fs.existsSync(path.join(dir, ".completo"))) return { versao, dir, nova: false };

  etapa = `baixando o FireHub (versão ${versao})`;
  const objetos = path.join(PASTA, "objetos");
  const arquivos = lista.arquivos.filter((a) => a && /^[0-9a-f]{64}$/.test(a.hash) && typeof a.caminho === "string");
  // Um download por hash: o mesmo conteúdo aparece em mais de um caminho.
  const porHash = new Map();
  for (const a of arquivos) if (!porHash.has(a.hash) && !fs.existsSync(path.join(objetos, a.hash))) porHash.set(a.hash, a);
  const faltam = [...porHash.values()];
  const totalBytes = faltam.reduce((s, a) => s + (Number(a.tamanho) || 0), 0) || 1;
  let feitos = 0;
  const fila = [...faltam];
  const trabalhador = async () => {
    for (let a = fila.shift(); a; a = fila.shift()) {
      await baixar(`${pareamento.nuvem}/api/contingencia/pacote/arquivo?hash=${a.hash}`, path.join(objetos, a.hash), {
        headers: { authorization: `Bearer ${pareamento.chave}` },
        sha256: a.hash,
      });
      feitos += Number(a.tamanho) || 0;
      progresso = (feitos / totalBytes) * 100;
    }
  };
  await Promise.all(Array.from({ length: 6 }, trabalhador));

  etapa = "montando o FireHub";
  const tmp = `${dir}.montando`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const a of arquivos) {
    const destino = caminhoSeguro(tmp, a.caminho);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    const origem = path.join(objetos, a.hash);
    try {
      fs.linkSync(origem, destino);
    } catch {
      fs.copyFileSync(origem, destino);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  fs.writeFileSync(path.join(dir, ".completo"), new Date().toISOString());
  progresso = null;
  return { versao, dir, nova: true };
}

/** Versões velhas: ficam a em uso, a que o supervisor ainda roda e a anterior. */
function faxina(...manter) {
  try {
    const apps = path.join(PASTA, "app");
    const versoes = fs.readdirSync(apps).filter((v) => !v.endsWith(".montando"));
    const fixas = manter.filter(Boolean);
    const porData = versoes
      .map((v) => ({ v, t: fs.statSync(path.join(apps, v)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .map((x) => x.v);
    const ficam = new Set([...fixas, ...porData.filter((v) => !fixas.includes(v)).slice(0, 1)]);
    for (const v of versoes) if (!ficam.has(v)) fs.rmSync(path.join(apps, v), { recursive: true, force: true });
  } catch {
    /* faxina é bônus */
  }
}

// ── O supervisor ────────────────────────────────────────────────────────────
//
// O supervisor NÃO morre junto com o Assistente (no Windows o processo filho
// segue de pé): o Assistente que reinicia — atualização dele, queda do
// programa — ADOTA o supervisor que achar na porta da loja, em vez de subir
// outro. Assim a loja não cai nem no meio de uma queda.

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** O estado do supervisor que estiver na porta da loja (nosso ou adotado), ou null. */
async function supervisorNaPorta() {
  try {
    const r = await fetch(ESTADO_DA_LOJA, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Há supervisor desta loja de pé — filho deste processo ou adotado. */
const supervisorVivo = () => !!filho || adotado;

async function ligarSupervisor(dir) {
  if (filho || adotado || !pareamento || !runtime) return;
  const deFora = await supervisorNaPorta();
  if (deFora && deFora.loja === pareamento.lojaId) {
    adotado = true;
    estadoDoSupervisor = deFora;
    etapa = "pronta";
    registro(`Supervisor já estava de pé (versão ${deFora.app || "?"}): segue com ele.`);
    return;
  }
  if (deFora) {
    // De outra ativação neste computador: para com cuidado antes do novo.
    registro("Supervisor de outra loja na porta: parando.");
    await pedirParaParar();
  }
  if (filho || adotado) return; // outro chamado ligou enquanto este esperava
  const js = path.join(dir, "contingencia", "supervisor.js");
  if (!fs.existsSync(js)) {
    erro = "O pacote desta versão não tem o supervisor da contingência.";
    return;
  }
  const arquivoDeLog = path.join(PASTA, "supervisor.log");
  try {
    if (fs.existsSync(arquivoDeLog) && fs.statSync(arquivoDeLog).size > 5 * 1024 * 1024) {
      fs.renameSync(arquivoDeLog, `${arquivoDeLog}.anterior`);
    }
  } catch {
    /* segue */
  }
  const log = fs.openSync(arquivoDeLog, "a");
  try {
    filho = spawn(runtime.nodeExe, [js], {
      cwd: dir,
      stdio: ["ignore", log, log],
      windowsHide: true,
      env: {
        ...process.env,
        CONTINGENCIA_NUVEM: pareamento.nuvem,
        CONTINGENCIA_CHAVE: pareamento.chave,
        CONTINGENCIA_SEGREDO_DO_BILHETE: pareamento.segredoDoBilhete,
        CONTINGENCIA_LOJA: pareamento.lojaId,
        CONTINGENCIA_APP: dir,
        CONTINGENCIA_PG_BIN: runtime.pgBin,
        CONTINGENCIA_PASTA: PASTA,
        CONTINGENCIA_NODE: runtime.nodeExe,
      },
    });
  } finally {
    fs.closeSync(log); // o filho já tem a cópia dele
  }
  etapa = "pronta";
  registro(`Supervisor ligado (versão ${versaoEmUso}).`);
  const este = filho;
  este.on("exit", (codigo) => {
    if (filho === este) filho = null;
    estadoDoSupervisor = null;
    if (parando || !pareamento) return;
    reinicios++;
    const espera = Math.min(60_000, 5_000 * reinicios);
    registro(`Supervisor parou (código ${codigo}); religa em ${espera / 1000} s.`);
    setTimeout(() => void ligarSupervisor(path.join(PASTA, "app", versaoEmUso || "")), espera);
  });
}

/** Pede ao supervisor da porta que pare (ele desliga o FireHub local e o banco) e espera a porta fechar. */
async function pedirParaParar() {
  try {
    await fetch(`http://127.0.0.1:${PORTA_DA_LOJA}/__contingencia/parar`, { method: "POST", signal: AbortSignal.timeout(3000) });
  } catch {
    /* já não responde */
  }
  const limite = Date.now() + 15_000;
  while (Date.now() < limite && (await supervisorNaPorta())) await esperar(500);
}

async function pararSupervisor() {
  if (!supervisorVivo()) return;
  parando = true;
  try {
    const p = filho;
    await pedirParaParar();
    if (p) {
      const limite = Date.now() + 5_000;
      while (filho === p && Date.now() < limite) await esperar(300);
      if (filho === p) p.kill();
    }
  } finally {
    filho = null;
    adotado = false;
    estadoDoSupervisor = null;
    parando = false;
  }
}

// ── O ciclo do Assistente ───────────────────────────────────────────────────

async function manter() {
  if (mantendo || !pareamento) return;
  mantendo = true;
  if (etapa === "desligada") etapa = "preparando";
  try {
    if (os.arch() !== "x64") throw new Error("A contingência precisa de Windows 64 bits.");
    erro = null;
    runtime = await garantirRuntime();
    const pacote = await sincronizarPacote();
    const s = estadoDoSupervisor;
    const vivo = supervisorVivo();
    // A versão que roda: a que o supervisor conta (o adotado pode ser de antes da última troca).
    const rodando = vivo ? (s && s.app) || versaoEmUso : null;
    // Troca só com a loja em paz: nuvem de pé e nada esperando para subir.
    const emPaz = !vivo || (s && s.modo === "normal" && !s.pendentes);
    if (emPaz && (pacote.versao !== versaoEmUso || (vivo && rodando !== pacote.versao))) {
      await pararSupervisor();
      versaoEmUso = pacote.versao;
      fs.writeFileSync(path.join(PASTA, "atual.txt"), versaoEmUso);
      reinicios = 0;
    }
    faxina(versaoEmUso, supervisorVivo() ? rodando : null);
    if (!supervisorVivo()) await ligarSupervisor(path.join(PASTA, "app", versaoEmUso));
  } catch (e) {
    erro = String((e && e.message) || e);
    registro(`Manutenção da contingência: ${erro}`);
    // Sem internet agora: se já há uma versão montada, liga com ela — é
    // justamente a hora em que a contingência é necessária.
    try {
      const atual = fs.readFileSync(path.join(PASTA, "atual.txt"), "utf8").trim();
      if (!versaoEmUso && atual && fs.existsSync(path.join(PASTA, "app", atual, ".completo"))) versaoEmUso = atual;
      if (runtime && versaoEmUso && !supervisorVivo()) await ligarSupervisor(path.join(PASTA, "app", versaoEmUso));
    } catch {
      /* primeira vez sem internet: nada a fazer */
    }
  } finally {
    mantendo = false;
  }
}

async function lerEstadoDoSupervisor() {
  if (!pareamento) return;
  const e = await supervisorNaPorta();
  if (e && e.loja === pareamento.lojaId) {
    estadoDoSupervisor = e;
    if (!filho && !adotado && !parando) {
      adotado = true;
      etapa = "pronta";
      registro(`Supervisor já estava de pé (versão ${e.app || "?"}): segue com ele.`);
    }
  } else {
    estadoDoSupervisor = null;
    // O adotado parou sozinho: o ciclo (a cada minuto) liga outro.
    if (adotado && !parando) adotado = false;
  }
}

/** Durante a queda, a fila de impressão é a do computador da loja. */
function baseDaFilaNaContingencia() {
  const modo = estadoDoSupervisor && estadoDoSupervisor.modo;
  return modo === "contingencia" || modo === "voltando" ? `http://127.0.0.1:${PORTA_DA_LOJA}` : null;
}

function estadoPublico() {
  const s = estadoDoSupervisor || {};
  return {
    ativa: !!pareamento,
    etapa,
    progresso,
    erro,
    versao: versaoEmUso,
    modo: s.modo || null,
    pronta: !!s.pronta,
    testando: !!s.testando,
    porta: PORTA_DA_LOJA,
    pendentes: s.pendentes || 0,
    memoriaTotalMb: Math.round(os.totalmem() / 1024 / 1024),
  };
}

// ── As rotas ────────────────────────────────────────────────────────────────

function daqui(req) {
  const r = (req.socket && req.socket.remoteAddress) || "";
  return r === "127.0.0.1" || r === "::1" || r === "::ffff:127.0.0.1";
}

function doFireHub(req) {
  return ORIGENS_ACEITAS.includes(String(req.headers.origin || ""));
}

function registrar(app) {
  app.get("/contingencia/estado", (_req, res) => res.json(estadoPublico()));

  app.post("/contingencia/parear", (req, res) => {
    if (!daqui(req) || !doFireHub(req)) return res.status(403).json({ error: "Só pela página do FireHub, neste computador." });
    const corpo = req.body || {};
    const { lojaId, chave, segredoDoBilhete, nuvem } = corpo;
    if (!lojaId || !chave || !segredoDoBilhete) return res.status(400).json({ error: "Ativação incompleta." });
    if (!NUVENS_ACEITAS.includes(String(nuvem))) return res.status(400).json({ error: "Endereço do FireHub inválido." });
    try {
      gravarPareamento({ lojaId: String(lojaId), chave: String(chave), segredoDoBilhete: String(segredoDoBilhete), nuvem: String(nuvem) });
    } catch (e) {
      return res.status(500).json({ error: String((e && e.message) || e) });
    }
    const outraLoja = pareamento && pareamento.lojaId !== String(lojaId);
    pareamento = lerPareamento();
    registro(`Contingência ativada para a loja ${lojaId}.`);
    // Outra loja neste computador (ou chave nova): o supervisor recomeça.
    pararSupervisor().then(() => {
      if (outraLoja) versaoEmUso = null;
      manter();
    });
    res.json({ ok: true });
  });

  app.post("/contingencia/desparear", async (req, res) => {
    if (!daqui(req) || !doFireHub(req)) return res.status(403).json({ error: "Só pela página do FireHub, neste computador." });
    pareamento = null;
    await pararSupervisor();
    fs.rmSync(ARQUIVO_DO_PAREAMENTO, { force: true });
    // A cópia da loja sai do computador; o Node e o Postgres baixados ficam.
    for (const pasta of ["banco", "app", "objetos"]) fs.rmSync(path.join(PASTA, pasta), { recursive: true, force: true });
    fs.rmSync(path.join(PASTA, "estado.json"), { force: true });
    etapa = "desligada";
    versaoEmUso = null;
    registro("Contingência desativada neste computador.");
    res.json({ ok: true });
  });

  app.post("/contingencia/testar", async (req, res) => {
    if (!daqui(req) || !doFireHub(req)) return res.status(403).json({ error: "Só pela página do FireHub, neste computador." });
    if (!supervisorVivo()) return res.status(409).json({ error: "A contingência ainda não está pronta neste computador." });
    try {
      const r = await fetch(`http://127.0.0.1:${PORTA_DA_LOJA}/__contingencia/testar`, { method: "POST", signal: AbortSignal.timeout(3000) });
      res.status(r.status).json(await r.json());
    } catch {
      res.status(503).json({ error: "O supervisor não respondeu." });
    }
  });
}

/** Sobe com o Assistente. Sem pareamento, não faz nada. */
function iniciar() {
  // O cofre do Windows só abre com o Electron pronto.
  const comecar = async () => {
    pareamento = lerPareamento();
    if (!pareamento) return;
    try {
      versaoEmUso = fs.readFileSync(path.join(PASTA, "atual.txt"), "utf8").trim() || null;
    } catch {
      versaoEmUso = null;
    }
    // Primeiro, adotar o supervisor que tenha ficado de pé (Assistente reiniciado).
    await lerEstadoDoSupervisor();
    await manter();
  };
  try {
    const { app } = require("electron");
    if (app && typeof app.isReady === "function" && !app.isReady()) app.whenReady().then(comecar);
    else comecar();
  } catch {
    comecar();
  }
  setInterval(() => void lerEstadoDoSupervisor(), 2000);
  // Atualização do FireHub da contingência: a cada 30 min (troca só com a loja em paz).
  setInterval(() => void manter(), 30 * 60_000);
  // Supervisor caiu e não voltou, ou a primeira tentativa falhou sem internet: tenta de novo.
  setInterval(() => {
    if (pareamento && !supervisorVivo() && !mantendo) void manter();
  }, 60_000);
}

module.exports = { registrar, iniciar, baseDaFilaNaContingencia, estadoPublico, listaAssinada };
