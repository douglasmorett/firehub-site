// FireAccess — relay: liga o agente (PC do lojista) ao atendente (CLI) e ao Douglas (/fireaccess).
// O agente conecta por WebSocket de SAÍDA em /agente; o atendente usa HTTP com token.
//
//   FIREACCESS_TOKEN=... node server.mjs        (porta: PORT, padrão 8790)
//
// Regras do PLANO.md: comando só depois do "Permitir" do cliente; código vale 10 min;
// tudo registrado em registros/ (apagado depois de 30 dias).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT) || 8790;
const TOKEN = process.env.FIREACCESS_TOKEN;
if (!TOKEN || TOKEN.length < 24) {
  console.error("Defina FIREACCESS_TOKEN (24+ caracteres).");
  process.exit(1);
}
const PASTA = process.env.FIREACCESS_REGISTROS || path.join(aqui, "registros");
const DIAS_GUARDADOS = 30;
const VALIDADE_DO_CODIGO_MS = 10 * 60_000;
const PRAZO_DO_COMANDO_MS = 20_000;
const ESPERA_DA_VOLTA_MS = 90_000; // internet do cliente caiu: segura a sessão para o agente voltar
const ARQUIVO_MAX = 40 * 1024 * 1024; // "enviar": corpo em base64
fs.mkdirSync(PASTA, { recursive: true });

/** codigo -> sessão (ver novaSessao) */
const sessoes = new Map();

function novoCodigo() {
  let c;
  do c = String(crypto.randomInt(100000, 1000000));
  while (sessoes.has(c));
  return c;
}

const hash = (t) => crypto.createHash("sha256").update(Buffer.isBuffer(t) ? t : String(t)).digest("hex");

function registrar(s, dado) {
  const dia = new Date().toISOString().slice(0, 10);
  const linha = JSON.stringify({ em: new Date().toISOString(), codigo: s.codigo, maquina: s.maquina?.nome, ...dado });
  fs.appendFile(path.join(PASTA, `${dia}.jsonl`), linha + "\n", () => {});
}

function guardarTela(s, base64) {
  const pasta = path.join(PASTA, new Date().toISOString().slice(0, 10), s.codigo);
  fs.mkdirSync(pasta, { recursive: true });
  const arquivo = path.join(pasta, `${Date.now()}.jpg`);
  fs.writeFile(arquivo, Buffer.from(base64, "base64"), () => {});
  return path.relative(PASTA, arquivo);
}

function faxina() {
  const limite = Date.now() - DIAS_GUARDADOS * 86_400_000;
  for (const nome of fs.readdirSync(PASTA)) {
    const p = path.join(PASTA, nome);
    try {
      if (fs.statSync(p).mtimeMs < limite) fs.rmSync(p, { recursive: true, force: true });
    } catch {}
  }
}
faxina();
setInterval(faxina, 6 * 3600_000).unref();

// ── Agente ────────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true, maxPayload: 20 * 1024 * 1024 });

function novaSessao(ws, maquina) {
  const codigo = novoCodigo();
  const s = {
    ws, codigo, maquina, permitido: false, segredo: null, criadoEm: Date.now(), permitidoEm: null,
    pend: new Map(), caiuEm: null, aoVivo: false, assistidoEm: 0, quadro: null, seq: 0, esperandoQuadro: new Set(),
  };
  sessoes.set(codigo, s);
  s.expira = setTimeout(() => { if (!s.permitido) s.ws.close(4000, "codigo expirou"); }, VALIDADE_DO_CODIGO_MS);
  ws.send(JSON.stringify({ tipo: "codigo", codigo, validadeMs: VALIDADE_DO_CODIGO_MS }));
  return s;
}

function acabar(s, motivo) {
  clearTimeout(s.expira);
  clearTimeout(s.prazoDaVolta);
  sessoes.delete(s.codigo);
  for (const resolver of s.pend.values()) resolver({ erro: "sessão encerrada" });
  s.pend.clear();
  for (const f of s.esperandoQuadro) f(null);
  if (s.permitido) registrar(s, { evento: "encerrada", motivo });
}

function ligarAgente(ws, s) {
  ws.vivo = true;
  ws.on("pong", () => (ws.vivo = true));
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.tipo === "permitido" && !s.permitido) {
      s.permitido = true;
      s.permitidoEm = Date.now();
      s.segredo = typeof m.segredo === "string" && m.segredo.length >= 32 ? hash(m.segredo) : null;
      clearTimeout(s.expira);
      registrar(s, { evento: "permitido", maquina: s.maquina });
    } else if (m.tipo === "encerrado") {
      s.encerrando = "encerrada pelo cliente";
    } else if (m.tipo === "resposta" && s.pend.has(m.id)) {
      const resolver = s.pend.get(m.id);
      s.pend.delete(m.id);
      resolver(m);
    } else if (m.tipo === "quadro" && m.jpeg) {
      const { tipo, ...q } = m;
      s.quadro = { ...q, seq: ++s.seq };
      for (const f of s.esperandoQuadro) f(s.quadro);
      s.esperandoQuadro.clear();
    }
  });
  ws.on("close", (cod) => {
    if (s.ws !== ws) return; // já trocou por uma conexão nova
    if (cod === 1000 && !s.encerrando) s.encerrando = "encerrada pelo cliente";
    s.aoVivo = false;
    for (const resolver of s.pend.values()) resolver({ erro: "o computador do cliente desconectou" });
    s.pend.clear();
    if (!s.permitido || !s.segredo || s.encerrando) return acabar(s, s.encerrando || "agente fechou");
    // Permitida: dá um tempo para o agente voltar (internet do cliente piscou).
    s.caiuEm = Date.now();
    registrar(s, { evento: "caiu" });
    s.prazoDaVolta = setTimeout(() => acabar(s, "não voltou depois da queda"), ESPERA_DA_VOLTA_MS);
  });
}

wss.on("connection", (ws) => {
  // A primeira mensagem diz se é PC novo ("ola") ou a volta de uma sessão permitida ("retomar").
  const semResposta = setTimeout(() => ws.close(4003, "sem ola"), 10_000);
  ws.once("message", (raw) => {
    clearTimeout(semResposta);
    let m;
    try { m = JSON.parse(raw); } catch { return ws.close(4003, "mensagem inválida"); }
    if (m.tipo === "retomar") {
      const s = sessoes.get(String(m.codigo));
      if (!s || !s.caiuEm || !s.segredo || hash(m.segredo) !== s.segredo) return ws.close(4002, "sessao nao existe mais");
      clearTimeout(s.prazoDaVolta);
      s.caiuEm = null;
      s.ws = ws;
      ligarAgente(ws, s);
      registrar(s, { evento: "voltou" });
      ws.send(JSON.stringify({ tipo: "retomada" }));
      return;
    }
    const corta = (v, n = 80) => String(v ?? "").slice(0, n);
    const maquina = {
      nome: corta(m.nome), usuario: corta(m.usuario), versao: corta(m.versao, 20),
      admin: m.admin === true, windows: corta(m.windows, 40), monitores: Number(m.monitores) || 1,
    };
    ligarAgente(ws, novaSessao(ws, maquina));
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.vivo) { ws.terminate(); continue; }
    ws.vivo = false;
    ws.ping();
  }
}, 25_000).unref();

// Tela ao vivo: o agente só transmite enquanto alguém está olhando.
setInterval(() => {
  for (const s of sessoes.values()) {
    if (s.aoVivo && Date.now() - s.assistidoEm > 8000) {
      s.aoVivo = false;
      s.ws.send(JSON.stringify({ tipo: "ao_vivo", ligado: false }));
    }
  }
}, 2000).unref();

function mandarComando(s, comando, prazoMs) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const prazo = setTimeout(() => { s.pend.delete(id); resolve({ erro: "o computador não respondeu a tempo" }); }, prazoMs);
    s.pend.set(id, (r) => { clearTimeout(prazo); resolve(r); });
    s.ws.send(JSON.stringify({ tipo: "comando", id, comando }));
  });
}

// ── HTTP do atendente e do Douglas ─────────────────────────────────────────
const TIPOS = new Set(["tela", "clicar", "mover", "arrastar", "digitar", "tecla", "rolar", "executar", "enviar", "lote", "navegador"]);

function autorizado(req) {
  const h = req.headers.authorization || "";
  const dado = Buffer.from(h.replace(/^Bearer /, ""));
  const certo = Buffer.from(TOKEN);
  return dado.length === certo.length && crypto.timingSafeEqual(dado, certo);
}

function json(res, status, corpo) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(corpo));
}

function lerCorpo(req, max) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let tamanho = 0;
    req.on("data", (c) => {
      tamanho += c.length;
      if (tamanho > max) { reject(new Error("grande demais")); req.destroy(); return; }
      partes.push(c);
    });
    req.on("end", () => { try { const t = Buffer.concat(partes).toString("utf8"); resolve(t ? JSON.parse(t) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

const resumo = (s) => ({
  codigo: s.codigo, permitido: s.permitido, maquina: s.maquina, caiu: !!s.caiuEm,
  desde: new Date(s.permitidoEm || s.criadoEm).toISOString(),
});

// Aceita com ou sem o prefixo do proxy (firehubfood.com.br/fireaccess-relay/...).
const semPrefixo = (p) => p.replace(/^\/fireaccess-relay(?=\/|$)/, "") || "/";

// As sessões só existem na memória: um erro solto que derrubasse o processo derrubava todo atendimento
// em andamento (20/11, sessão do Victor caiu com 502 e o log recomeçou do zero). Erro de uma requisição
// responde 500 e fica no log; o relay continua de pé.
process.on("unhandledRejection", (e) => console.error("FireAccess relay: promessa sem tratamento:", e?.stack || e));
process.on("uncaughtException", (e) => console.error("FireAccess relay: erro não tratado:", e?.stack || e));

const server = http.createServer((req, res) => {
  atender(req, res).catch((e) => {
    console.error("FireAccess relay: falha atendendo", req.method, req.url, e?.stack || e);
    try { if (!res.headersSent) json(res, 500, { erro: "falha no relay" }); else res.end(); } catch {}
  });
});

async function atender(req, res) {
  const url = new URL(req.url, "http://x");
  const rota = semPrefixo(url.pathname);

  if (req.method === "GET" && (rota === "/" || rota === "/fireaccess")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return fs.createReadStream(path.join(aqui, "ver.html")).pipe(res);
  }
  if (req.method === "GET" && rota === "/saude") return json(res, 200, { ok: true, sessoes: sessoes.size });

  if (!autorizado(req)) return json(res, 401, { erro: "token" });

  if (req.method === "GET" && rota === "/sessoes") return json(res, 200, [...sessoes.values()].map(resumo));

  const m = rota.match(/^\/sessoes\/(\d{6})\/(comando|encerrar|quadro)$/);
  if (!m) return json(res, 404, { erro: "rota" });
  const s = sessoes.get(m[1]);
  if (!s) return json(res, 404, { erro: "sessão não encontrada (código errado ou o cliente fechou)" });
  if (!s.permitido) return json(res, 403, { erro: "o cliente ainda não clicou em Permitir" });
  if (s.caiuEm) return json(res, 503, { erro: "a internet do cliente caiu; o FireAccess está reconectando (tente de novo em alguns segundos)" });

  // Tela ao vivo: devolve o quadro mais novo que "depois"; segura até 8 s esperando um.
  if (req.method === "GET" && m[2] === "quadro") {
    s.assistidoEm = Date.now();
    if (!s.aoVivo) { s.aoVivo = true; s.ws.send(JSON.stringify({ tipo: "ao_vivo", ligado: true })); }
    const depois = Number(url.searchParams.get("depois")) || 0;
    if (s.quadro && s.quadro.seq > depois) return json(res, 200, s.quadro);
    const q = await new Promise((resolve) => {
      const f = (x) => { clearTimeout(t); resolve(x); };
      const t = setTimeout(() => { s.esperandoQuadro.delete(f); resolve(null); }, 8000);
      s.esperandoQuadro.add(f);
    });
    return q ? json(res, 200, q) : json(res, 204, {});
  }

  if (req.method !== "POST") return json(res, 405, { erro: "método" });

  if (m[2] === "encerrar") {
    registrar(s, { evento: "encerrada pelo atendente" });
    s.encerrando = "encerrada pelo atendente";
    s.ws.close(4001, "encerrada pelo atendente");
    return json(res, 200, { ok: true });
  }

  let corpo;
  try { corpo = await lerCorpo(req, ARQUIVO_MAX); } catch (e) { return json(res, 400, { erro: e.message === "grande demais" ? "arquivo grande demais (máx. 30 MB)" : "JSON inválido" }); }
  if (!TIPOS.has(corpo.tipo)) return json(res, 400, { erro: `tipo deve ser um de: ${[...TIPOS].join(", ")}` });
  const quem = url.searchParams.get("quem") === "douglas" ? "douglas" : "atendente";

  const prazo = corpo.tipo === "executar" ? (Math.min(Math.max(Number(corpo.tempo) || 60, 1), 85) + 10) * 1000
    : corpo.tipo === "enviar" ? 120_000
    : corpo.tipo === "lote" ? Math.min(PRAZO_DO_COMANDO_MS + (Array.isArray(corpo.passos) ? corpo.passos.length : 0) * 2_000 + 10_000, 120_000)
    : corpo.tipo === "navegador" ? 45_000
    : PRAZO_DO_COMANDO_MS + Math.min(Number(corpo.esperar) || 0, 10_000);
  const r = await mandarComando(s, corpo, prazo);

  // O que vai para o registro: o comando inteiro, menos o conteúdo do arquivo enviado.
  const noRegistro = corpo.tipo === "enviar"
    ? { tipo: "enviar", nome: corpo.nome, bytes: Buffer.byteLength(String(corpo.b64 || ""), "base64"), sha256: hash(Buffer.from(String(corpo.b64 || ""), "base64")) }
    : corpo;
  if (r.erro) {
    registrar(s, { quem, comando: noRegistro, erro: r.erro });
    return json(res, 502, { erro: r.erro });
  }
  const tela = r.jpeg ? guardarTela(s, r.jpeg) : undefined;
  const { jpeg, id, tipo, ...resto } = r;
  registrar(s, { quem, comando: noRegistro, resultado: resto.ok ?? true, ...(resto.saida != null ? { saida: String(resto.saida).slice(0, 4000) } : {}), tela });
  return json(res, 200, r);
}

server.on("upgrade", (req, socket, head) => {
  if (semPrefixo(new URL(req.url, "http://x").pathname) !== "/agente") return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

server.listen(PORTA, () => console.log(`FireAccess relay na porta ${PORTA}`));
