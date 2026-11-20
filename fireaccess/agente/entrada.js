// Fala com o entrada.ps1 (SendInput do Windows) por um PowerShell que fica aberto durante a sessão.
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TECLAS = {
  ctrl: 0x11, control: 0x11, shift: 0x10, alt: 0x12, win: 0x5b, windows: 0x5b,
  enter: 0x0d, tab: 0x09, esc: 0x1b, escape: 0x1b, backspace: 0x08, delete: 0x2e, del: 0x2e,
  espaco: 0x20, space: 0x20, up: 0x26, down: 0x28, left: 0x25, right: 0x27,
  cima: 0x26, baixo: 0x28, esquerda: 0x25, direita: 0x27,
  home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22, insert: 0x2d, printscreen: 0x2c,
};
for (let i = 1; i <= 12; i++) TECLAS["f" + i] = 0x6f + i;

function codigosDoCombo(combo) {
  return String(combo).toLowerCase().split("+").map((t) => t.trim()).map((t) => {
    if (TECLAS[t]) return TECLAS[t];
    if (/^[a-z0-9]$/.test(t)) return t.toUpperCase().charCodeAt(0);
    throw new Error(`tecla desconhecida: ${t}`);
  });
}

let ps = null;
let fila = [];
let buffer = "";

function iniciar() {
  if (ps) return;
  // Dentro do .exe o script está no asar; o PowerShell precisa de um arquivo de verdade.
  const destino = path.join(os.tmpdir(), "fireaccess-entrada.ps1");
  fs.writeFileSync(destino, fs.readFileSync(path.join(__dirname, "entrada.ps1"), "utf8"), "utf8");
  ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", destino], { windowsHide: true });
  fila.push({ resolve: () => {}, reject: () => {} }); // a linha "pronto"
  ps.stdout.on("data", (d) => {
    buffer += d.toString();
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const linha = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      const p = fila.shift();
      if (!p) continue;
      linha.startsWith("erro") ? p.reject(new Error(linha)) : p.resolve();
    }
  });
  ps.on("exit", () => { for (const p of fila) p.reject(new Error("entrada fechou")); fila = []; ps = null; });
}

function mandar(obj) {
  iniciar();
  return new Promise((resolve, reject) => {
    fila.push({ resolve, reject });
    ps.stdin.write(JSON.stringify(obj) + "\n");
  });
}

function parar() { if (ps) ps.kill(); }

module.exports = { mandar, parar, codigosDoCombo };
