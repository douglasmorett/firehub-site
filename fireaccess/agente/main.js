// FireAccess — agente que roda no PC do lojista.
// Abre mostrando um código; só depois do "Permitir" do cliente aceita comandos do suporte.
// Regras do PLANO.md: faixa vermelha sempre visível, fechar corta na hora, conexão só de saída.
//
// Roda como administrador quando o usuário do Windows é administrador (o .exe pede na abertura,
// o cliente clica em Sim): assim o suporte consegue mexer em instalador e janela de administrador,
// e o que ele abre por "executar" já nasce como administrador, sem a janela do UAC.
const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const WebSocket = require("ws");
const entrada = require("./entrada");

const RELAY = process.env.FIREACCESS_URL
  || (process.argv.find((a) => a.startsWith("--relay=")) || "").slice(8)
  || "wss://firehubfood.com.br/fireaccess-relay/agente"; // app "fireaccess-relay" no Coolify, por caminho no domínio do site
const VERSAO = require("./package.json").version;
const LARGURA_BASE = 1366; // coordenadas dos comandos são numa imagem de até essa largura
const AO_VIVO = { largura: 1280, qualidade: 50, intervaloMs: 120 };
const RETOMAR_POR_MS = 90_000; // internet do cliente piscou: tenta voltar para a mesma sessão por até 1min30

if (!app.requestSingleInstanceLock()) app.quit();

const ADMIN = spawnSync("net", ["session"], { windowsHide: true }).status === 0;

let janela = null;
let faixa = null;
let ws = null;
let permitido = false;
let codigo = null;
let segredo = null; // só o agente e o relay sabem; serve para retomar a sessão depois de uma queda
let estado = { msg: "Conectando…", codigo: null, podePermitir: false, faixa: "● Suporte FireHub conectado" };

function mostrar(novo) {
  estado = { ...estado, ...novo };
  janela?.webContents.send("estado", estado);
  faixa?.webContents.send("estado", estado);
}

function abrirJanela() {
  janela = new BrowserWindow({
    width: 460, height: 460, resizable: false, maximizable: false, autoHideMenuBar: true,
    title: "FireAccess — Suporte FireHub",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  janela.loadFile("janela.html");
  janela.webContents.on("did-finish-load", () => mostrar({}));
  janela.on("closed", () => app.quit());
}

function abrirFaixa() {
  const area = screen.getPrimaryDisplay().workArea;
  const largura = 380, altura = 34;
  faixa = new BrowserWindow({
    width: largura, height: altura, x: Math.round(area.x + (area.width - largura) / 2), y: area.y,
    frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  faixa.setAlwaysOnTop(true, "screen-saver");
  faixa.loadFile("faixa.html");
  faixa.webContents.on("did-finish-load", () => mostrar({}));
  faixa.on("closed", () => app.quit());
}

// ── Conexão ───────────────────────────────────────────────────────────────
let retomarAte = 0;

function conectar() {
  const sock = new WebSocket(RELAY);
  ws = sock;
  sock.on("open", () => {
    if (permitido) return sock.send(JSON.stringify({ tipo: "retomar", codigo, segredo }));
    sock.send(JSON.stringify({
      tipo: "ola", versao: VERSAO, admin: ADMIN,
      nome: os.hostname(), usuario: os.userInfo().username,
      windows: `${os.release()} ${os.arch()}`, monitores: screen.getAllDisplays().length,
    }));
  });
  sock.on("message", async (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.tipo === "codigo") {
      codigo = m.codigo;
      mostrar({ codigo: m.codigo, podePermitir: true, msg: "Passe este código para o atendente e clique em Permitir." });
    } else if (m.tipo === "retomada") {
      retomarAte = 0;
      mostrar({ faixa: "● Suporte FireHub conectado" });
    } else if (m.tipo === "ao_vivo") {
      aoVivo = !!m.ligado;
      if (aoVivo) transmitir();
    } else if (m.tipo === "comando") {
      let resposta;
      try {
        if (!permitido) throw new Error("o cliente ainda não permitiu");
        resposta = await executar(m.comando);
      } catch (e) {
        resposta = { erro: e.message };
      }
      if (sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ tipo: "resposta", id: m.id, ...resposta }));
    }
  });
  sock.on("close", (cod, motivo) => {
    if (ws !== sock || saindo) return;
    aoVivo = false;
    const texto = String(motivo || "");
    if (permitido) {
      // Atendente encerrou, relay recusou a volta ou passou do prazo: acabou. A próxima pede Permitir de novo.
      if (cod === 4001 || cod === 4002 || cod === 1000) return encerrar();
      if (!retomarAte) retomarAte = Date.now() + RETOMAR_POR_MS;
      if (Date.now() > retomarAte) return encerrar();
      mostrar({ faixa: "● Internet caiu — reconectando…" });
      return setTimeout(conectar, 3000);
    }
    // Código vencido: pega outro na hora (o Permitir continua obrigatório).
    const expirou = texto === "codigo expirou";
    mostrar({ codigo: null, podePermitir: false, msg: expirou ? "O código venceu. Gerando outro…" : "Sem conexão com o FireHub. Tentando de novo…" });
    setTimeout(conectar, expirou ? 500 : 5000);
  });
  sock.on("error", (e) => console.error("FireAccess: erro de conexão:", e.message)); // o "close" cuida do resto
}

const enviar = (obj) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj));

// ── Tela ─────────────────────────────────────────────────────────────────
// "Base" = a tela física reduzida para até 1366 de largura. Toda coordenada de comando está nela;
// aqui vira pixel físico do monitor principal. A tela ao vivo vem menor, mas diz qual é a base.
function monitor() {
  const d = screen.getPrimaryDisplay();
  const fisico = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  const f = Math.min(1, LARGURA_BASE / fisico.width);
  return { d, fisico, base: { width: Math.round(fisico.width * f), height: Math.round(fisico.height * f) } };
}

async function capturar(larguraMax = LARGURA_BASE, qualidade = 70) {
  const { d, fisico, base } = monitor();
  // Pede a miniatura já no tamanho final: bem mais rápido que capturar inteiro e reduzir.
  const f = Math.min(1, larguraMax / fisico.width);
  const alvo = { width: Math.round(fisico.width * f), height: Math.round(fisico.height * f) };
  const fontes = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: alvo });
  const fonte = fontes.find((x) => x.display_id === String(d.id)) || fontes[0];
  const img = fonte.thumbnail;
  const final = img.getSize();
  return {
    jpeg: img.toJPEG(qualidade).toString("base64"), largura: final.width, altura: final.height,
    baseLargura: base.width, baseAltura: base.height,
  };
}

const px = (v) => { const { fisico, base } = monitor(); return Math.round(Number(v) * fisico.width / base.width); };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// Tela ao vivo para o Douglas: o agente manda quadros sozinho enquanto alguém está olhando.
let aoVivo = false;
let transmitindo = false;
async function transmitir() {
  if (transmitindo) return;
  transmitindo = true;
  try {
    while (aoVivo && permitido && ws?.readyState === WebSocket.OPEN) {
      const t = Date.now();
      try { enviar({ tipo: "quadro", ...(await capturar(AO_VIVO.largura, AO_VIVO.qualidade)) }); } catch {}
      // Não acumula quadro na fila quando a internet do cliente é lenta.
      while (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount > 64 * 1024) await esperar(30);
      await esperar(Math.max(0, AO_VIVO.intervaloMs - (Date.now() - t)));
    }
  } finally { transmitindo = false; }
}

// ── Comandos ─────────────────────────────────────────────────────────────
async function executar(c) {
  switch (c.tipo) {
    case "tela": return capturar();
    case "executar": return rodarPowerShell(String(c.script || ""), Number(c.tempo) || 60);
    case "enviar": return receberArquivo(c);
    case "mover": await entrada.mandar({ f: "mover", x: px(c.x), y: px(c.y) }); break;
    case "clicar": await entrada.mandar({ f: "clicar", x: px(c.x), y: px(c.y), direito: c.botao === "direito", duplo: !!c.duplo }); break;
    case "arrastar": await entrada.mandar({ f: "arrastar", x1: px(c.x1), y1: px(c.y1), x2: px(c.x2), y2: px(c.y2) }); break;
    case "rolar": await entrada.mandar({ f: "rolar", quanto: Number(c.quanto) || -3, ...(c.x != null ? { x: px(c.x), y: px(c.y) } : {}) }); break;
    case "digitar": await entrada.mandar({ f: "digitar", b64: Buffer.from(String(c.texto ?? ""), "utf8").toString("base64") }); break;
    case "tecla": await entrada.mandar({ f: "combo", vks: entrada.codigosDoCombo(c.combo) }); break;
    default: throw new Error(`comando desconhecido: ${c.tipo}`);
  }
  await esperar(Number(c.esperar) >= 0 ? Math.min(Number(c.esperar), 10_000) : 500); // deixa a tela reagir
  return { ok: true, ...(await capturar()) };
}

// PowerShell no PC do cliente, com a mesma permissão do FireAccess (administrador, se ele for).
// Programa aberto daqui com Start-Process já nasce como administrador: sem janela do UAC.
const SAIDA_MAX = 200_000;
function rodarPowerShell(script, tempoS) {
  const tempo = Math.min(Math.max(tempoS, 1), 85) * 1000;
  const arquivo = path.join(os.tmpdir(), `fireaccess-${crypto.randomUUID()}.ps1`);
  // BOM: o PowerShell 5 lê o arquivo como UTF-8 (acento no caminho, no nome da impressora…).
  fs.writeFileSync(arquivo, "﻿[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$ProgressPreference = 'SilentlyContinue'\n" + script, "utf8");
  return new Promise((resolve) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", arquivo], { windowsHide: true });
    let saida = "";
    const juntar = (d) => { if (saida.length < SAIDA_MAX) saida += d.toString("utf8"); };
    p.stdout.on("data", juntar);
    p.stderr.on("data", juntar);
    let estourou = false;
    const prazo = setTimeout(() => { estourou = true; spawnSync("taskkill", ["/pid", String(p.pid), "/t", "/f"], { windowsHide: true }); }, tempo);
    p.on("close", (codigoSaida) => {
      clearTimeout(prazo);
      fs.rm(arquivo, () => {});
      resolve({
        ok: !estourou && codigoSaida === 0, codigoSaida,
        saida: saida.slice(0, SAIDA_MAX) + (estourou ? `\n[parado: passou de ${tempo / 1000}s — para instalador demorado use Start-Process sem -Wait]` : ""),
      });
    });
  });
}

// Arquivo mandado pelo atendente (driver, instalador…): vai para Downloads\FireHub.
function receberArquivo(c) {
  const nome = path.basename(String(c.nome || "arquivo")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120) || "arquivo";
  const pasta = path.join(os.homedir(), "Downloads", "FireHub");
  fs.mkdirSync(pasta, { recursive: true });
  const destino = path.join(pasta, nome);
  const dado = Buffer.from(String(c.b64 || ""), "base64");
  fs.writeFileSync(destino, dado);
  return { ok: true, caminho: destino, bytes: dado.length };
}

// ── Permitir / Encerrar ───────────────────────────────────────────────────
ipcMain.on("permitir", () => {
  if (permitido || !ws || ws.readyState !== WebSocket.OPEN) return;
  permitido = true;
  segredo = crypto.randomBytes(32).toString("hex");
  enviar({ tipo: "permitido", segredo });
  mostrar({ podePermitir: false, msg: "Suporte conectado. Para encerrar, clique em Encerrar na faixa vermelha." });
  abrirFaixa();
  janela.minimize();
});

let saindo = false;
function encerrar() {
  if (saindo) return;
  saindo = true;
  permitido = false;
  aoVivo = false;
  entrada.parar();
  try { enviar({ tipo: "encerrado" }); ws?.close(1000, "encerrada pelo cliente"); } catch {}
  setTimeout(() => app.quit(), 300); // deixa o aviso sair antes de fechar
}
ipcMain.on("encerrar", encerrar);

app.whenReady().then(() => { abrirJanela(); conectar(); });
app.on("window-all-closed", encerrar);
app.on("before-quit", () => { permitido = false; entrada.parar(); });
