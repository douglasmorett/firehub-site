// FireAccess — agente que roda no PC do lojista.
// Abre mostrando um código; só depois do "Permitir" do cliente aceita comandos do suporte.
// Regras do PLANO.md: faixa vermelha sempre visível, fechar corta na hora, conexão só de saída.
const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require("electron");
const os = require("os");
const path = require("path");
const WebSocket = require("ws");
const entrada = require("./entrada");

const RELAY = process.env.FIREACCESS_URL
  || (process.argv.find((a) => a.startsWith("--relay=")) || "").slice(8)
  || "wss://firehubfood.com.br/fireaccess-relay/agente"; // app "fireaccess-relay" no Coolify, por caminho no domínio do site
const LARGURA_MAX = 1366;

if (!app.requestSingleInstanceLock()) app.quit();

let janela = null;
let faixa = null;
let ws = null;
let permitido = false;
let estado = { msg: "Conectando…", codigo: null, podePermitir: false };

function mostrar(novo) {
  estado = { ...estado, ...novo };
  janela?.webContents.send("estado", estado);
}

function abrirJanela() {
  janela = new BrowserWindow({
    width: 460, height: 440, resizable: false, maximizable: false, autoHideMenuBar: true,
    title: "FireAccess — Suporte FireHub",
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  janela.loadFile("janela.html");
  janela.webContents.on("did-finish-load", () => mostrar({}));
  janela.on("closed", () => app.quit());
}

function abrirFaixa() {
  const area = screen.getPrimaryDisplay().workArea;
  const largura = 360, altura = 34;
  faixa = new BrowserWindow({
    width: largura, height: altura, x: Math.round(area.x + (area.width - largura) / 2), y: area.y,
    frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, focusable: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  faixa.setAlwaysOnTop(true, "screen-saver");
  faixa.loadFile("faixa.html");
  faixa.on("closed", () => app.quit());
}

function conectar() {
  ws = new WebSocket(RELAY);
  ws.on("open", () => ws.send(JSON.stringify({ tipo: "ola", nome: os.hostname(), usuario: os.userInfo().username })));
  ws.on("message", async (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.tipo === "codigo") {
      mostrar({ codigo: m.codigo, podePermitir: true, msg: "Passe este código para o atendente e clique em Permitir." });
    } else if (m.tipo === "comando") {
      let resposta;
      try {
        if (!permitido) throw new Error("o cliente ainda não permitiu");
        resposta = await executar(m.comando);
      } catch (e) {
        resposta = { erro: e.message };
      }
      ws.send(JSON.stringify({ tipo: "resposta", id: m.id, ...resposta }));
    }
  });
  ws.on("close", (codigo, motivo) => {
    const texto = String(motivo || "");
    if (permitido) return encerrar(); // sessão acabou: sem reconectar, a próxima pede Permitir de novo
    // Código vencido: pega outro na hora (o Permitir continua obrigatório).
    const expirou = texto === "codigo expirou";
    mostrar({ codigo: null, podePermitir: false, msg: expirou ? "O código venceu. Gerando outro…" : "Sem conexão com o FireHub. Tentando de novo…" });
    setTimeout(conectar, expirou ? 500 : 5000);
  });
  ws.on("error", (e) => console.error("FireAccess: erro de conexão:", e.message)); // o "close" cuida da tela
}

// ── Tela ─────────────────────────────────────────────────────────────────
// Coordenadas dos comandos estão no espaço da imagem enviada (até 1366 de largura);
// aqui viram pixels físicos do monitor principal.
let escala = 1;

async function capturar() {
  const d = screen.getPrimaryDisplay();
  const fisico = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  // Pede a miniatura já no tamanho final: bem mais rápido que capturar inteiro e reduzir.
  const fator = Math.min(1, LARGURA_MAX / fisico.width);
  const alvo = { width: Math.round(fisico.width * fator), height: Math.round(fisico.height * fator) };
  const fontes = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: alvo });
  const fonte = fontes.find((f) => f.display_id === String(d.id)) || fontes[0];
  const img = fonte.thumbnail;
  const final = img.getSize();
  escala = fisico.width / final.width;
  return { jpeg: img.toJPEG(70).toString("base64"), largura: final.width, altura: final.height };
}

const px = (v) => Math.round(Number(v) * escala);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function executar(c) {
  switch (c.tipo) {
    case "tela": return capturar();
    case "mover": await entrada.mandar({ f: "mover", x: px(c.x), y: px(c.y) }); break;
    case "clicar": await entrada.mandar({ f: "clicar", x: px(c.x), y: px(c.y), direito: c.botao === "direito", duplo: !!c.duplo }); break;
    case "arrastar": await entrada.mandar({ f: "arrastar", x1: px(c.x1), y1: px(c.y1), x2: px(c.x2), y2: px(c.y2) }); break;
    case "rolar": await entrada.mandar({ f: "rolar", quanto: Number(c.quanto) || -3, ...(c.x != null ? { x: px(c.x), y: px(c.y) } : {}) }); break;
    case "digitar": await entrada.mandar({ f: "digitar", b64: Buffer.from(String(c.texto ?? ""), "utf8").toString("base64") }); break;
    case "tecla": await entrada.mandar({ f: "combo", vks: entrada.codigosDoCombo(c.combo) }); break;
    default: throw new Error(`comando desconhecido: ${c.tipo}`);
  }
  await esperar(500); // deixa a tela reagir; devolve como ficou
  return { ok: true, ...(await capturar()) };
}

// ── Permitir / Encerrar ───────────────────────────────────────────────────
ipcMain.on("permitir", () => {
  if (permitido || !ws || ws.readyState !== WebSocket.OPEN) return;
  permitido = true;
  ws.send(JSON.stringify({ tipo: "permitido" }));
  mostrar({ podePermitir: false, msg: "Suporte conectado. Para encerrar, clique em Encerrar na faixa vermelha." });
  abrirFaixa();
  janela.minimize();
});

let saindo = false;
function encerrar() {
  if (saindo) return;
  saindo = true;
  permitido = false;
  entrada.parar();
  try { ws?.close(1000, "encerrada pelo cliente"); } catch {}
  app.quit();
}
ipcMain.on("encerrar", encerrar);

app.whenReady().then(() => { abrirJanela(); conectar(); });
app.on("window-all-closed", encerrar);
app.on("before-quit", () => { permitido = false; entrada.parar(); });
