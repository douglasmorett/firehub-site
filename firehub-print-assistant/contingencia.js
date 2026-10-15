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
 *
 * ── Nada pesado no processo principal (14/10/2026) ──────────────────────────
 * Este arquivo roda DENTRO do processo do Assistente — o mesmo que responde o
 * /status e imprime as comandas (server.js). Cada versão do FireHub tem ~9.200
 * arquivos: montar com mkdirSync/linkSync levava ~6 s e apagar com rmSync ~10 s,
 * com o Assistente surdo esse tempo todo. Na noite de 14/10, ao desativar a
 * contingência, o rmSync da cópia travou o Assistente, a vigia achou a "cópia
 * presa", derrubou todas e a impressão ficou ~5 min fora. Por isso: montar,
 * faxina e apagar só com fs.promises, poucos de cada vez (sem lotar o pool do
 * libuv, que também resolve o DNS da fila), e pasta velha é RENOMEADA para
 * "<nome>.apagar-<hora>" (instantâneo) e apagada em segundo plano.
 */
const fs = require("fs");
const fsp = fs.promises;
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
/** Última vez que a nuvem pareceu instável aos olhos do supervisor (ver anotarInstabilidade). Sem histórico = agora. */
let nuvemInstavelEm = Date.now();
/** Por que a troca de versão da cópia está esperando (null = não está). */
let trocaAdiada = null;
let manterAgendado = null;

function registro(linha) {
  try {
    fs.mkdirSync(PASTA, { recursive: true });
    fs.appendFileSync(path.join(PASTA, "assistente.log"), `[${new Date().toISOString()}] ${linha}\n`);
  } catch {
    /* sem disco: segue */
  }
}

// ── Disco sem travar o Assistente ───────────────────────────────────────────

/** Marca do que foi posto de lado para apagar ("app.apagar-1760000000000"). */
const SUFIXO_APAGAR = ".apagar-";
/** Quantas operações de disco de uma vez: o pool do libuv tem 4 vagas e o DNS da fila de impressão usa a mesma. */
const DE_CADA_VEZ = 2;

/** Roda `fazer` em cada item, `quantos` por vez. */
async function emFila(itens, quantos, fazer) {
  let i = 0;
  const trabalhador = async () => {
    while (i < itens.length) {
      const item = itens[i++];
      await fazer(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(quantos, itens.length) }, trabalhador));
}

async function existe(caminho) {
  try {
    await fsp.lstat(caminho);
    return true;
  } catch {
    return false;
  }
}

/**
 * Apaga uma árvore inteira devagar: arquivo por arquivo, DE_CADA_VEZ por vez.
 * O fs.promises.rm recursivo também não trava o processo, mas solta milhares de
 * operações de uma vez no pool — e o DNS da fila de impressão espera atrás.
 */
async function apagarArvore(raiz) {
  let st;
  try {
    st = await fsp.lstat(raiz);
  } catch {
    return;
  }
  const arquivos = [];
  const pastas = [];
  if (!st.isDirectory()) arquivos.push(raiz);
  const aVisitar = st.isDirectory() ? [raiz] : [];
  while (aVisitar.length) {
    const atual = aVisitar.pop();
    pastas.push(atual);
    let itens = [];
    try {
      itens = await fsp.readdir(atual, { withFileTypes: true });
    } catch {
      /* some no meio: segue */
    }
    for (const d of itens) (d.isDirectory() ? aVisitar : arquivos).push(path.join(atual, d.name));
  }
  await emFila(arquivos, DE_CADA_VEZ, async (a) => {
    try {
      await fsp.unlink(a);
    } catch (e) {
      // Somente leitura no Windows: tira a marca e tenta de novo.
      if (e && e.code === "EPERM") await fsp.chmod(a, 0o666).then(() => fsp.unlink(a)).catch(() => {});
    }
  });
  // Da mais funda para a raiz.
  for (const p of pastas.sort((a, b) => b.length - a.length)) await fsp.rmdir(p).catch(() => {});
  // O que sobrar (arquivo preso), o rm do Node tenta uma última vez.
  if (await existe(raiz)) await fsp.rm(raiz, { recursive: true, force: true, maxRetries: 2 });
}

const apagandoAgora = new Set();
function apagarEmSegundoPlano(caminho) {
  if (apagandoAgora.has(caminho)) return;
  apagandoAgora.add(caminho);
  apagarArvore(caminho)
    .catch((e) => registro(`Sobrou ${path.basename(caminho)} para apagar depois: ${e && e.message}`))
    .finally(() => apagandoAgora.delete(caminho));
}

/**
 * Tira uma pasta (ou arquivo) do caminho na hora: renomeia para
 * "<nome>.apagar-<hora>" e apaga em segundo plano. Se o Windows não deixar
 * renomear (arquivo aberto), apaga no lugar — assíncrono do mesmo jeito, mas
 * esperando, para quem chamou não escrever por cima do que ainda está saindo.
 */
async function tirarDoCaminho(caminho) {
  if (!(await existe(caminho))) return;
  const deLado = `${caminho}${SUFIXO_APAGAR}${Date.now()}`;
  try {
    await fsp.rename(caminho, deLado);
  } catch (e) {
    registro(`Não consegui pôr ${path.basename(caminho)} de lado (${(e && e.code) || e}); apagando no lugar.`);
    await apagarArvore(caminho).catch((err) => registro(`Não consegui apagar ${path.basename(caminho)}: ${err && err.message}`));
    return;
  }
  apagarEmSegundoPlano(deLado);
}

/** Restos ".apagar-" de uma faxina que o Assistente não terminou (fechou no meio). */
async function apagarRestos(pasta) {
  let nomes = [];
  try {
    nomes = await fsp.readdir(pasta);
  } catch {
    return;
  }
  for (const n of nomes) if (n.includes(SUFIXO_APAGAR)) apagarEmSegundoPlano(path.join(pasta, n));
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

/** O arquivo do esquema do Prisma dentro do pacote: é com ele que o FireHub local fala com o banco. */
const ESQUEMA_DO_PRISMA = /(^|\/)node_modules\/\.prisma\/client\/schema\.prisma$/;

/** O hash do schema.prisma do pacote (null se a lista não tiver). Duas versões com o mesmo hash usam o mesmo banco. */
function hashDoEsquemaNaLista(arquivos) {
  const candidatos = (arquivos || []).filter((a) => a && typeof a.caminho === "string" && ESQUEMA_DO_PRISMA.test(a.caminho));
  candidatos.sort((a, b) => a.caminho.length - b.caminho.length);
  return candidatos.length ? candidatos[0].hash : null;
}

/** O que a versão montada leva (gravado ao montar): os hashes dos arquivos e o do esquema. */
function listaDaVersaoParaGravar(versao, arquivos) {
  return { versao, hashes: [...new Set(arquivos.map((a) => a.hash))], esquema: hashDoEsquemaNaLista(arquivos) };
}

async function lerListaDaVersao(versao) {
  if (!versao) return null;
  try {
    const l = JSON.parse(await fsp.readFile(path.join(PASTA, "app", versao, ".lista.json"), "utf8"));
    return l && Array.isArray(l.hashes) ? l : null;
  } catch {
    return null;
  }
}

/** A contingência foi desativada no meio do trabalho: para de mexer no disco. */
function seguirSoAtivada() {
  if (!pareamento) throw new Error("A contingência foi desativada no meio da manutenção.");
}

/**
 * Monta a versão em "<dir>.montando" com hardlink de cada objeto (ou cópia,
 * se o disco não deixar) e só então troca o nome para <dir>: quem olha a pasta
 * nunca vê versão pela metade. Tudo assíncrono e DE_CADA_VEZ por vez.
 */
async function montarVersao(versao, arquivos, dir, objetos, conferir = seguirSoAtivada) {
  const tmp = `${dir}.montando`;
  await tirarDoCaminho(tmp);
  const destinos = arquivos.map((a) => ({ destino: caminhoSeguro(tmp, a.caminho), origem: path.join(objetos, a.hash) }));
  // As pastas primeiro, uma vez cada (antes era um mkdirSync por arquivo).
  const pastas = [...new Set(destinos.map((d) => path.dirname(d.destino)))].sort();
  for (const p of pastas) {
    conferir();
    await fsp.mkdir(p, { recursive: true });
  }
  await emFila(destinos, DE_CADA_VEZ, async ({ destino, origem }) => {
    conferir();
    try {
      await fsp.link(origem, destino);
    } catch {
      await fsp.copyFile(origem, destino);
    }
  });
  await fsp.writeFile(path.join(tmp, ".lista.json"), JSON.stringify(listaDaVersaoParaGravar(versao, arquivos)));
  await tirarDoCaminho(dir);
  await fsp.rename(tmp, dir);
  await fsp.writeFile(path.join(dir, ".completo"), new Date().toISOString());
}

async function sincronizarPacote() {
  const resposta = await nuvemJson("/api/contingencia/pacote");
  const lista = listaAssinada(resposta);
  // Fora da parte assinada, só um conselho: "a loja está no expediente" (a troca
  // pode esperar se o esquema do banco não mudou). Nunca muda o que é instalado.
  const adiar = resposta && typeof resposta.adiar === "string" && resposta.adiar ? resposta.adiar : null;
  const versao = String(lista.versao).replace(/[^A-Za-z0-9_.-]/g, "");
  const dir = path.join(PASTA, "app", versao);
  const arquivos = lista.arquivos.filter((a) => a && /^[0-9a-f]{64}$/.test(a.hash) && typeof a.caminho === "string");
  const esquema = hashDoEsquemaNaLista(arquivos);
  if (await existe(path.join(dir, ".completo"))) {
    // Montada por um Assistente de antes da lista: grava agora (a faxina dos objetos depende dela).
    if (!(await existe(path.join(dir, ".lista.json")))) {
      await fsp.writeFile(path.join(dir, ".lista.json"), JSON.stringify(listaDaVersaoParaGravar(versao, arquivos))).catch(() => {});
    }
    return { versao, dir, nova: false, esquema, adiar };
  }

  etapa = `baixando o FireHub (versão ${versao})`;
  const objetos = path.join(PASTA, "objetos");
  await fsp.mkdir(objetos, { recursive: true });
  // Um readdir em vez de um existsSync por arquivo (9.200 deles: ~0,5 s parado).
  const jaTem = new Set(await fsp.readdir(objetos).catch(() => []));
  // Um download por hash: o mesmo conteúdo aparece em mais de um caminho.
  const porHash = new Map();
  for (const a of arquivos) if (!porHash.has(a.hash) && !jaTem.has(a.hash)) porHash.set(a.hash, a);
  const faltam = [...porHash.values()];
  const totalBytes = faltam.reduce((s, a) => s + (Number(a.tamanho) || 0), 0) || 1;
  let feitos = 0;
  const fila = [...faltam];
  const trabalhador = async () => {
    for (let a = fila.shift(); a; a = fila.shift()) {
      seguirSoAtivada();
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
  const inicio = Date.now();
  await montarVersao(versao, arquivos, dir, objetos);
  registro(`Versão ${versao} montada (${arquivos.length} arquivos, ${faltam.length} baixados) em ${Math.round((Date.now() - inicio) / 1000)} s.`);
  progresso = null;
  return { versao, dir, nova: true, esquema, adiar };
}

/** Os objetos (por hash) que nenhuma versão que fica usa — e restos de download. */
function objetosQueSobram(nomes, hashesQueFicam) {
  return nomes.filter((n) => (/^[0-9a-f]{64}$/.test(n) && !hashesQueFicam.has(n)) || n.endsWith(".baixando"));
}

/**
 * objetos/ guarda cada arquivo por hash para a PRÓXIMA versão baixar só o que
 * mudou. As versões montadas não dependem dele (hardlink mantém os dados).
 * Sai o que nenhuma versão que fica usa. Só com a lista da versão em uso: sem
 * ela (montada antes desta faxina existir) apagaria a base da próxima troca.
 */
async function faxinaDosObjetos(versoesQueFicam, emUso) {
  const listaEmUso = await lerListaDaVersao(emUso);
  if (!listaEmUso) return;
  const ficam = new Set(listaEmUso.hashes);
  for (const v of versoesQueFicam) {
    if (v === emUso) continue;
    const l = await lerListaDaVersao(v);
    if (l) for (const h of l.hashes) ficam.add(h);
  }
  const objetos = path.join(PASTA, "objetos");
  const sobram = objetosQueSobram(await fsp.readdir(objetos).catch(() => []), ficam);
  if (!sobram.length) return;
  await emFila(sobram, DE_CADA_VEZ, (n) => fsp.unlink(path.join(objetos, n)).catch(() => {}));
  registro(`Faxina: ${sobram.length} arquivo(s) que nenhuma versão usa saíram de objetos/.`);
}

/** Versões velhas: ficam a em uso, a que o supervisor ainda roda, a recém-baixada e a anterior. */
async function faxina(emUso, ...outrasQueFicam) {
  try {
    const apps = path.join(PASTA, "app");
    await apagarRestos(PASTA);
    await apagarRestos(apps);
    const versoes = (await fsp.readdir(apps)).filter((v) => !v.endsWith(".montando") && !v.includes(SUFIXO_APAGAR));
    const fixas = [emUso, ...outrasQueFicam].filter(Boolean);
    const comData = [];
    for (const v of versoes) {
      const st = await fsp.stat(path.join(apps, v)).catch(() => null);
      if (st) comData.push({ v, t: st.mtimeMs });
    }
    const porData = comData.sort((a, b) => b.t - a.t).map((x) => x.v);
    const ficam = new Set([...fixas, ...porData.filter((v) => !fixas.includes(v)).slice(0, 1)]);
    for (const v of versoes) if (!ficam.has(v)) await tirarDoCaminho(path.join(apps, v));
    await faxinaDosObjetos(versoes.filter((v) => ficam.has(v)), emUso);
  } catch {
    /* faxina é bônus */
  }
}

// ── O supervisor ────────────────────────────────────────────────────────────
//
// O supervisor sobe DESLIGADO do Assistente (spawn com `detached`). Sem isso o
// libuv põe o filho num job do Windows com KILL_ON_JOB_CLOSE e ele morre junto
// com o Assistente — atualização, vigia, travamento: cada um derrubava a
// contingência por ~1 min e matava o Postgres sem desligar (14/10/2026). Agora
// o Assistente que reinicia ADOTA o supervisor que achar na porta da loja, em
// vez de subir outro. Em troca, quem desativa ou desinstala tem de pedir para
// ele parar (/contingencia/desparear e build/installer.nsh): sozinho, ele
// ficaria de pé até o Windows reiniciar.

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

// O pid do supervisor fica anotado: é o único jeito de encerrar o ADOTADO (não
// é filho deste processo) quando ele não atende o /parar, e de não subir um
// segundo enquanto o primeiro ainda está ligando o banco (a porta só abre
// depois). Vale só no mesmo boot do Windows: depois o número é de outro programa.
const ARQUIVO_DO_PID = path.join(PASTA, "supervisor.pid");
const inicioDoWindows = () => Date.now() - os.uptime() * 1000;

function anotarPid(pid) {
  try {
    fs.writeFileSync(ARQUIVO_DO_PID, JSON.stringify({ pid, inicioDoWindows: inicioDoWindows(), em: Date.now() }));
  } catch {
    /* sem a anotação, só não dá para encerrar à força o adotado */
  }
}

function pidAnotado() {
  try {
    const a = JSON.parse(fs.readFileSync(ARQUIVO_DO_PID, "utf8"));
    if (!a || !Number.isInteger(a.pid) || Math.abs(Number(a.inicioDoWindows) - inicioDoWindows()) > 5 * 60_000) return null;
    return a;
  } catch {
    return null;
  }
}

function esquecerPid(pid) {
  const a = pidAnotado();
  if (!a || a.pid === pid) fs.rm(ARQUIVO_DO_PID, { force: true }, () => {});
}

/** A saída do `tasklist /FO CSV /NH` diz que esse pid é um node.exe? */
function pidEhNode(saida, pid) {
  return new RegExp(`^"node\\.exe","${Number(pid)}"`, "im").test(String(saida || ""));
}

function supervisorAnotadoDePe(pid) {
  return new Promise((ok) =>
    execFile("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 10_000 }, (e, saida) =>
      ok(!e && pidEhNode(saida, pid)),
    ),
  );
}

/** Encerra à força (com a árvore: FireHub local e Postgres) o supervisor do pid anotado. */
async function encerrarPeloPidAnotado(motivo) {
  const a = pidAnotado();
  if (!a || !(await supervisorAnotadoDePe(a.pid))) return false;
  registro(`${motivo}: encerrando o supervisor à força (pid ${a.pid}).`);
  await new Promise((ok) => execFile("taskkill", ["/PID", String(a.pid), "/T", "/F"], { windowsHide: true, timeout: 15_000 }, () => ok()));
  esquecerPid(a.pid);
  return true;
}

function esperarSair(p, ms) {
  if (!p || p.exitCode !== null || p.signalCode !== null) return Promise.resolve(true);
  return new Promise((ok) => {
    const fim = () => {
      clearTimeout(prazo);
      ok(true);
    };
    const prazo = setTimeout(() => {
      p.off("exit", fim);
      ok(false);
    }, ms);
    p.once("exit", fim);
  });
}

/** Prazo para o supervisor que acabou de ser ligado abrir a porta (a 1ª subida de versão nova chega a ~50 s pelo antivírus). */
const PRAZO_PARA_ABRIR_A_PORTA_MS = 90_000;

async function ligarSupervisor(dir) {
  if (filho || adotado || !pareamento || !runtime) return;
  let deFora = await supervisorNaPorta();
  if (!deFora) {
    // Um supervisor de pé que ainda não abriu a porta (o Assistente reiniciou
    // no meio da subida dele): espera em vez de subir um segundo, que brigaria
    // pelo mesmo Postgres. Não abriu no prazo = travado: sai à força.
    // Ligado há tempo e mudo: ainda ganha 30 s (pode ser só um soluço do /estado).
    const anotado = pidAnotado();
    if (anotado && (await supervisorAnotadoDePe(anotado.pid))) {
      const limite = Math.max((Number(anotado.em) || 0) + PRAZO_PARA_ABRIR_A_PORTA_MS, Date.now() + 30_000);
      while (!deFora && Date.now() < limite) {
        await esperar(2000);
        deFora = await supervisorNaPorta();
      }
      if (!deFora) await encerrarPeloPidAnotado("Supervisor de pé sem abrir a porta da loja");
    }
  }
  if (filho || adotado || !pareamento) return; // outro chamado ligou (ou desativaram) enquanto este esperava
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
    await encerrarSupervisor(null);
  }
  if (filho || adotado || !pareamento) return; // outro chamado ligou enquanto este esperava
  const js = path.join(dir, "contingencia", "supervisor.js");
  if (!(await existe(js))) {
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
      // Fora do job do Assistente (ver o topo desta seção). Sem `unref`: o
      // "exit" abaixo continua valendo enquanto este Assistente estiver vivo.
      detached: true,
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
  const este = filho;
  if (este.pid) anotarPid(este.pid);
  registro(`Supervisor ligado (versão ${versaoEmUso}, pid ${este.pid}).`);
  este.on("exit", (codigo) => {
    if (filho === este) filho = null;
    esquecerPid(este.pid);
    estadoDoSupervisor = null;
    if (parando || !pareamento) return;
    reinicios++;
    const espera = Math.min(60_000, 5_000 * reinicios);
    registro(`Supervisor parou (código ${codigo}); religa em ${espera / 1000} s.`);
    setTimeout(() => void ligarSupervisor(path.join(PASTA, "app", versaoEmUso || "")), espera);
  });
}

/**
 * Pede ao supervisor da porta que pare (ele desliga o FireHub local e o banco
 * direito) e espera a porta fechar. Devolve se fechou.
 */
async function pedirParaParar(prazoMs = 15_000) {
  try {
    await fetch(`http://127.0.0.1:${PORTA_DA_LOJA}/__contingencia/parar`, { method: "POST", signal: AbortSignal.timeout(3000) });
  } catch {
    /* já não responde */
  }
  const limite = Date.now() + prazoMs;
  while (Date.now() < limite) {
    if (!(await supervisorNaPorta())) return true;
    await esperar(500);
  }
  return !(await supervisorNaPorta());
}

/**
 * Para o supervisor com cuidado: /parar, e de novo se não atender (em 14/10 o
 * primeiro pedido se perdia e quase toda troca matava o Postgres à força — o
 * banco subia depois em "recovery"). Só então à força: pelo processo, se é
 * filho deste Assistente; pelo pid anotado, se é o adotado.
 */
async function encerrarSupervisor(p) {
  let fechou = await pedirParaParar(15_000);
  if (!fechou) {
    registro("O supervisor não atendeu o /parar em 15 s: pedindo de novo.");
    fechou = await pedirParaParar(10_000);
  }
  if (p) {
    if (await esperarSair(p, fechou ? 5_000 : 1_000)) return;
    registro(`O supervisor não atendeu o /parar: encerrando à força (pid ${p.pid}).`);
    try {
      p.kill();
    } catch {
      /* já saiu */
    }
    await esperarSair(p, 5_000);
  } else if (!fechou) {
    await encerrarPeloPidAnotado("O supervisor não atendeu o /parar");
  }
}

async function pararSupervisor() {
  if (!supervisorVivo()) return;
  parando = true;
  try {
    // Espera o "exit" do filho ainda com `parando` ligado: antes o finally
    // limpava a marca primeiro e o "exit" atrasado registrava "religa em 5 s".
    await encerrarSupervisor(filho);
  } finally {
    filho = null;
    adotado = false;
    estadoDoSupervisor = null;
    parando = false;
  }
}

// ── A troca de versão da cópia ──────────────────────────────────────────────
//
// Trocar a versão desliga a porta da loja por ~20-35 s (o supervisor novo
// sobe o banco e o FireHub local de novo). Em 14/10 a cópia trocou duas vezes
// no pico do jantar. Agora só troca:
//   • com o supervisor em modo normal, sem nada esperando para subir;
//   • com a nuvem ESTÁVEL há 5 min (nenhuma falha vista pelo supervisor);
//   • fora do expediente (o servidor diz em `adiar`) — MAS só quando o esquema
//     do banco é o mesmo: o supervisor velho aplica o esquema novo da nuvem na
//     cópia, e o FireHub local velho (Prisma antigo) quebraria justo na queda.
//     Esquema diferente: troca assim que a nuvem estiver estável.

const NUVEM_ESTAVEL_MS = 5 * 60_000;
/** Sem conferir a nuvem há mais que isto (`ultimoOkEm`), o supervisor não está vendo a nuvem de pé. */
const SEM_OK_HA_MS = 60_000;

/** Anota quando o supervisor viu a nuvem instável (falha, modo fora do normal, sem resposta boa há 1 min). */
function anotarInstabilidade(e, agora = Date.now()) {
  if (!e) return;
  const ok = Date.parse(e.ultimoOkEm || "");
  const instavel = e.modo !== "normal" || Number(e.falhas) > 0 || (Number.isFinite(ok) && agora - ok > SEM_OK_HA_MS);
  if (instavel) nuvemInstavelEm = agora;
}

/**
 * A regra da troca, sem efeito nenhum (scripts/teste-contingencia-assistente.js).
 * `estado` é o /__contingencia/estado do supervisor; `adiar` é o motivo do
 * servidor para segurar (loja no expediente) ou null; `mesmoEsquema` diz se o
 * schema.prisma da versão nova é o da versão que roda.
 */
function decidirTroca({ vivo, estado, agora, nuvemInstavelEm: instavelEm, adiar, mesmoEsquema }) {
  if (!vivo) return { trocar: true, motivo: "sem supervisor de pé" };
  if (!estado) return { trocar: false, motivo: "o supervisor não respondeu agora", tentarDeNovoEmMs: 2 * 60_000 };
  if (estado.modo !== "normal") return { trocar: false, motivo: `a loja está em modo ${estado.modo}`, tentarDeNovoEmMs: 2 * 60_000 };
  if (estado.pendentes) return { trocar: false, motivo: `${estado.pendentes} mudança(s) esperando subir`, tentarDeNovoEmMs: 2 * 60_000 };
  if (Number(estado.falhas) > 0) return { trocar: false, motivo: "o supervisor está vendo falhas da nuvem", tentarDeNovoEmMs: 2 * 60_000 };
  const estavelHa = agora - (Number(instavelEm) || 0);
  if (estavelHa < NUVEM_ESTAVEL_MS) {
    return {
      trocar: false,
      motivo: `a nuvem está estável há só ${Math.max(0, Math.round(estavelHa / 1000))} s (precisa de ${NUVEM_ESTAVEL_MS / 60_000} min)`,
      tentarDeNovoEmMs: NUVEM_ESTAVEL_MS - estavelHa + 5_000,
    };
  }
  if (adiar && mesmoEsquema) return { trocar: false, motivo: `${adiar}; o esquema do banco é o mesmo, então a cópia troca fora do expediente` };
  return { trocar: true, motivo: adiar ? `${adiar}, mas o esquema do banco mudou: troca já` : "loja em paz" };
}

function agendarManter(ms) {
  if (manterAgendado) return;
  manterAgendado = setTimeout(() => {
    manterAgendado = null;
    void manter();
  }, Math.max(30_000, ms));
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
    if (pacote.versao !== versaoEmUso || (vivo && rodando !== pacote.versao)) {
      const listaRodando = vivo ? await lerListaDaVersao(rodando) : null;
      const mesmoEsquema = !!pacote.esquema && !!listaRodando && listaRodando.esquema === pacote.esquema;
      const d = decidirTroca({ vivo, estado: s, agora: Date.now(), nuvemInstavelEm, adiar: pacote.adiar, mesmoEsquema });
      if (d.trocar) {
        registro(`Trocando a cópia ${rodando || versaoEmUso || "-"} → ${pacote.versao} (${d.motivo}).`);
        trocaAdiada = null;
        await pararSupervisor();
        versaoEmUso = pacote.versao;
        fs.writeFileSync(path.join(PASTA, "atual.txt"), versaoEmUso);
        reinicios = 0;
      } else {
        if (trocaAdiada !== d.motivo) registro(`Troca da cópia para ${pacote.versao} adiada: ${d.motivo}.`);
        trocaAdiada = d.motivo;
        if (d.tentarDeNovoEmMs) agendarManter(d.tentarDeNovoEmMs);
      }
    } else {
      trocaAdiada = null;
    }
    // Primeiro a loja volta a ter contingência; a faxina (que pode levar uns
    // segundos de disco) vem depois.
    const rodandoAgora = supervisorVivo() ? rodando : null;
    if (!supervisorVivo()) await ligarSupervisor(path.join(PASTA, "app", versaoEmUso));
    await faxina(versaoEmUso, rodandoAgora, pacote.versao);
  } catch (e) {
    erro = String((e && e.message) || e);
    registro(`Manutenção da contingência: ${erro}`);
    // Sem internet agora: se já há uma versão montada, liga com ela — é
    // justamente a hora em que a contingência é necessária.
    try {
      const atual = fs.readFileSync(path.join(PASTA, "atual.txt"), "utf8").trim();
      if (!versaoEmUso && atual && fs.existsSync(path.join(PASTA, "app", atual, ".completo"))) versaoEmUso = atual;
      if (pareamento && runtime && versaoEmUso && !supervisorVivo()) await ligarSupervisor(path.join(PASTA, "app", versaoEmUso));
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
    anotarInstabilidade(e);
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
    trocaAdiada,
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
    // O supervisor vive fora do Assistente: se não for parado aqui, fica de pé
    // até o Windows reiniciar. O adotado também (encerrarSupervisor pelo pid).
    if (supervisorVivo()) await pararSupervisor();
    else if (await supervisorNaPorta()) await encerrarSupervisor(null);
    fs.rmSync(ARQUIVO_DO_PAREAMENTO, { force: true });
    // A cópia da loja sai do computador; o Node e o Postgres baixados ficam.
    // Antes era rmSync de ~9 mil arquivos POR versão: o Assistente ficava surdo,
    // a vigia o derrubava e a impressão parava (14/10). Agora as pastas mudam
    // de nome na hora e somem em segundo plano.
    for (const pasta of ["banco", "app", "objetos"]) await tirarDoCaminho(path.join(PASTA, pasta));
    await fsp.rm(path.join(PASTA, "estado.json"), { force: true }).catch(() => {});
    etapa = "desligada";
    versaoEmUso = null;
    trocaAdiada = null;
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

/** Sobe com o Assistente. Sem pareamento, não faz nada (além de terminar uma faxina interrompida). */
function iniciar() {
  // O cofre do Windows só abre com o Electron pronto.
  const comecar = async () => {
    // Pastas postas de lado por um Assistente que fechou antes de apagá-las.
    void apagarRestos(PASTA).then(() => apagarRestos(path.join(PASTA, "app")));
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

module.exports = {
  registrar,
  iniciar,
  baseDaFilaNaContingencia,
  estadoPublico,
  listaAssinada,
  // Para os testes (scripts/teste-contingencia-assistente.js):
  decidirTroca,
  hashDoEsquemaNaLista,
  objetosQueSobram,
  pidEhNode,
  montarVersao,
  tirarDoCaminho,
  apagarArvore,
  NUVEM_ESTAVEL_MS,
};
