/**
 * FireHub Assistente de Impressão — Electron Main Process
 * Janela visual de status + ícone na bandeja do sistema (system tray)
 */
const { app, Tray, Menu, nativeImage, BrowserWindow, dialog } = require("electron");
const path = require("path");

const { execSync } = require("child_process");

// Mata qualquer processo antigo rodando na porta 7891 para garantir o carregamento do novo modelo
try {
  if (process.platform === "win32") {
    execSync('powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 7891 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"', { stdio: "ignore" });
  }
} catch (e) {}

process.on("uncaughtException", (err) => {
  if (err.code === "EADDRINUSE" || err.message?.includes("EADDRINUSE")) {
    console.log("[Main] Porta 7891 já em uso por outro assistente ativo.");
    return;
  }
  console.error("[Main] UncaughtException:", err);
});

// Inicia o servidor HTTP local na porta 7891
require("./server.js");

let tray = null;
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 420,
    resizable: false,
    autoHideMenuBar: true,
    title: "🔥 FireHub Assistente de Impressão",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>FireHub Assistente de Impressão</title>
      <style>
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0F172A; color: #F8FAFC; margin: 0; padding: 24px; text-align: center; }
        .card { background: #1E293B; border-radius: 16px; padding: 24px; border: 1px solid #334155; box-shadow: 0 10px 30px rgba(0,0,0,0.4); }
        .badge { background: #D1FAE5; color: #065F46; font-weight: 800; padding: 6px 16px; border-radius: 20px; display: inline-block; font-size: 0.85rem; margin-bottom: 12px; letter-spacing: 0.05em; }
        h2 { margin: 8px 0 12px; font-size: 1.35rem; color: #FFF; }
        p { color: #94A3B8; font-size: 0.88rem; line-height: 1.5; margin: 8px 0; }
        .footer { font-size: 0.78rem; color: #64748B; margin-top: 18px; line-height: 1.4; }
      </style>
    </head>
    <body>
      <div class="card">
        <div style="font-size: 44px; margin-bottom: 6px;">🔥</div>
        <div class="badge">STATUS: CONECTADO E ATIVO ✅</div>
        <h2>FireHub Assistente de Impressão</h2>
        <p>O servidor local está pronto em <strong>http://localhost:7891</strong>.</p>
        <p style="color: #CBD5E1; font-weight: 600;">Mantenha este programa aberto enquanto desejar a impressão automática nas suas impressoras (POS 80 / POS 58).</p>
      </div>
      <div class="footer">
        💡 Se você fechar esta janela, ela continuará rodando em segundo plano perto do relógio do Windows.
      </div>
    </body>
    </html>
  `;

  mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(htmlContent));

  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA2ElEQVQ4T2NkoBAwUqifgWoGMDIy/mcAAWTBf0ZGRkYWFpb/yGIgMUZQKIBcAhZnZPwPUwxyEboYMzMzI8gARjDDD8YvX74w/Pv3j4GJiQlFHiSGbACINUAAJAb2AjKAeIGBgQHFBSAvgF0AYiEYAPYCuhgDAwODlJQUAysrK4Hover6+fGT59+sSwd+9ehrNnzzJgcwHMBSAXgAMLmwEgVwgICDDIyckxKCgoMIiIiIBddeXKFYZjx44xnDt3juHnz5/YDUDxAhUNIDoNUNELVDQABgAAvlRYR+UjXbMAAAAASUVORK5CYII="
  );

  tray = new Tray(icon);
  tray.setToolTip("🔥 FireHub Assistente de Impressão — Ativo");

  const contextMenu = Menu.buildFromTemplate([
    { label: "🔥 FireHub Assistente", enabled: false },
    { label: "✅ Rodando em localhost:7891", enabled: false },
    { type: "separator" },
    {
      label: "🖥️ Abrir Janela do Assistente",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: "separator" },
    {
      label: "Sair do Assistente",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});
