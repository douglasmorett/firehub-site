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
fs.mkdirSync(PASTA, { recursive: true });

/** codigo -> { ws, codigo, permitido, criadoEm, permitidoEm, maquina, pend: Map<id, resolve> } */
const sessoes = new Map();

function novoCodigo() {
  let c;
  do c = String(crypto.randomInt(100000, 1000000));
  while (sessoes.has(c));
  return c;
}

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

wss.on("connection", (ws) => {
  const codigo = novoCodigo();
  const s = { ws, codigo, permitido: false, criadoEm: Date.now(), permitidoEm: null, maquina: null, pend: new Map(), vivo: true };
  sessoes.set(codigo, s);
  ws.send(JSON.stringify({ tipo: "codigo", codigo, validadeMs: VALIDADE_DO_CODIGO_MS }));

  const expira = setTimeout(() => {
    if (!s.permitido) ws.close(4000, "codigo expirou");
  }, VALIDADE_DO_CODIGO_MS);

  ws.on("pong", () => (s.vivo = true));
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.tipo === "ola") {
      s.maquina = { nome: String(m.nome || "").slice(0, 80), usuario: String(m.usuario || "").slice(0, 80) };
    } else if (m.tipo === "permitido" && !s.permitido) {
      s.permitido = true;
      s.permitidoEm = Date.now();
      clearTimeout(expira);
      registrar(s, { evento: "permitido" });
    } else if (m.tipo === "resposta" && s.pend.has(m.id)) {
      const resolver = s.pend.get(m.id);
      s.pend.delete(m.id);
      resolver(m);
    }
  });
  ws.on("close", () => {
    clearTimeout(expira);
    sessoes.delete(codigo);
    for (const resolver of s.pend.values()) resolver({ erro: "sessão encerrada" });
    if (s.permitido) registrar(s, { evento: "encerrada" });
  });
});

setInterval(() => {
  for (const s of sessoes.values()) {
    if (!s.vivo) { s.ws.terminate(); continue; }
    s.vivo = false;
    s.ws.ping();
  }
}, 25_000).unref();

function mandarComando(s, comando) {
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const prazo = setTimeout(() => { s.pend.delete(id); resolve({ erro: "o computador não respondeu a tempo" }); }, PRAZO_DO_COMANDO_MS);
    s.pend.set(id, (r) => { clearTimeout(prazo); resolve(r); });
    s.ws.send(JSON.stringify({ tipo: "comando", id, comando }));
  });
}

// ── HTTP do atendente e do Douglas ─────────────────────────────────────────
const TIPOS = new Set(["tela", "clicar", "mover", "arrastar", "digitar", "tecla", "rolar"]);

function autorizado(req) {
  const h = req.headers.authorization || "";
  const dado = Buffer.from(h.replace(/^Bearer /, ""));
  const certo = Buffer.from(TOKEN);
  return dado.length === certo.length && crypto.timingSafeEqual(dado, certo);
}

function json(res, status, corpo) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corpo));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let t = "";
    req.on("data", (c) => { t += c; if (t.length > 100_000) req.destroy(); });
    req.on("end", () => { try { resolve(t ? JSON.parse(t) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// Aceita com ou sem o prefixo do proxy (firehubfood.com.br/fireaccess-relay/...).
const semPrefixo = (p) => p.replace(/^\/fireaccess-relay(?=\/|$)/, "") || "/";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const rota = semPrefixo(url.pathname);

  if (req.method === "GET" && (rota === "/" || rota === "/fireaccess")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return fs.createReadStream(path.join(aqui, "ver.html")).pipe(res);
  }
  if (req.method === "GET" && rota === "/saude") return json(res, 200, { ok: true });

  if (!autorizado(req)) return json(res, 401, { erro: "token" });

  if (req.method === "GET" && rota === "/sessoes") {
    return json(res, 200, [...sessoes.values()].map((s) => ({
      codigo: s.codigo, permitido: s.permitido, maquina: s.maquina,
      desde: new Date(s.permitidoEm || s.criadoEm).toISOString(),
    })));
  }

  const m = rota.match(/^\/sessoes\/(\d{6})\/(comando|encerrar)$/);
  if (req.method === "POST" && m) {
    const s = sessoes.get(m[1]);
    if (!s) return json(res, 404, { erro: "sessão não encontrada (código errado ou o cliente fechou)" });
    if (!s.permitido) return json(res, 403, { erro: "o cliente ainda não clicou em Permitir" });

    if (m[2] === "encerrar") {
      registrar(s, { evento: "encerrada pelo atendente" });
      s.ws.close(4001, "encerrada pelo atendente");
      return json(res, 200, { ok: true });
    }

    let corpo;
    try { corpo = await lerCorpo(req); } catch { return json(res, 400, { erro: "JSON inválido" }); }
    if (!TIPOS.has(corpo.tipo)) return json(res, 400, { erro: `tipo deve ser um de: ${[...TIPOS].join(", ")}` });
    const quem = url.searchParams.get("quem") === "douglas" ? "douglas" : "atendente";
    const soOlhando = corpo.tipo === "tela" && url.searchParams.get("ao_vivo") === "1";

    const r = await mandarComando(s, corpo);
    if (r.erro) {
      registrar(s, { quem, comando: corpo, erro: r.erro });
      return json(res, 502, { erro: r.erro });
    }
    // A tela ao vivo do Douglas não vai para o registro (seriam milhares de quadros);
    // toda ação e toda tela pedida pelo atendente vão.
    if (!soOlhando) {
      const tela = r.jpeg ? guardarTela(s, r.jpeg) : undefined;
      const { jpeg, ...resto } = r;
      registrar(s, { quem, comando: corpo, resultado: resto.ok ?? true, tela });
    }
    return json(res, 200, r);
  }

  json(res, 404, { erro: "rota" });
});

server.on("upgrade", (req, socket, head) => {
  if (semPrefixo(new URL(req.url, "http://x").pathname) !== "/agente") return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

server.listen(PORTA, () => console.log(`FireAccess relay na porta ${PORTA}`));
