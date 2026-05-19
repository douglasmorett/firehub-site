/**
 * FireHub Assistente de Impressão — Electron Main Process
 * Roda na bandeja do sistema (system tray) como ícone
 */
const { app, Tray, Menu, nativeImage, BrowserWindow, dialog } = require("electron");
const path = require("path");

// Inicia o servidor HTTP
require("./server.js");

let tray = null;

function createTray() {
  // Cria ícone 16x16 programaticamente (círculo vermelho FireHub)
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA2ElEQVQ4T2NkoBAwUqifgWoGMDIy/mcAAWTBf0ZGRkYWFpb/yGIgMUZQKIBcAhZnZPwPUwxyEboYMzMzI8gARjDDD8YvX74w/Pv3j4GJiQlFHiSGbACINUAAJAb2AjKAeIGBgQHFBSAvgF0AYiEYAPYCuhgDAwODlJQUAysrK4OoqCjD169fGT59+sSwd+9ehrNnzzJgcwHMBSAXgAMLmwEgVwgICDDIyckxKCgoMIiIiIBddeXKFYZjx44xnDt3juHnz5/YDUDxAhUNIDoNUNELVDQABgAAvlRYR+UjXbMAAAAASUVORK5CYII="
  );

  tray = new Tray(icon);
  tray.setToolTip("🔥 FireHub Assistente de Impressão — Ativo");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "🔥 FireHub Assistente",
      enabled: false,
    },
    {
      label: "✅ Rodando em localhost:7891",
      enabled: false,
    },
    { type: "separator" },
    {
      label: "📋 Impressoras detectadas",
      click: () => {
        const { execSync } = require("child_process");
        try {
          const raw = execSync('powershell -NoProfile -Command "Get-Printer | Select-Object Name | ConvertTo-Json"', { encoding: "utf-8" });
          const printers = JSON.parse(raw);
          const arr = Array.isArray(printers) ? printers : [printers];
          const list = arr.map(p => `• ${p.Name}`).join("\n");
          dialog.showMessageBox({ type: "info", title: "Impressoras", message: "Impressoras detectadas:", detail: list });
        } catch {
          dialog.showMessageBox({ type: "error", title: "Erro", message: "Não foi possível listar impressoras." });
        }
      },
    },
    { type: "separator" },
    {
      label: "Sair",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Clique duplo mostra info
  tray.on("double-click", () => {
    dialog.showMessageBox({
      type: "info",
      title: "FireHub Assistente de Impressão",
      message: "🔥 FireHub Assistente de Impressão",
      detail: "Versão 1.0\nServidor ativo em http://localhost:7891\n\nMantenha o assistente aberto para a impressão automática funcionar.",
    });
  });
}

app.whenReady().then(() => {
  createTray();
  // Não mostra janela — só tray
  app.dock && app.dock.hide(); // macOS
});

// Evita que fechar a janela mate o app
app.on("window-all-closed", (e) => {
  e.preventDefault();
});
