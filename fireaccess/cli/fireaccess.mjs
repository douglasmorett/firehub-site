#!/usr/bin/env node
// FireAccess — CLI do atendente (Claude). Cada ação de tela devolve a tela de depois, salva em %TEMP%.
// Sem configurar nada usa o relay no ar e o token de ~/.fireaccess-token (FIREACCESS_URL/FIREACCESS_TOKEN trocam).
//
//   node fireaccess.mjs sessoes
//   node fireaccess.mjs info     <codigo>                Windows, administrador?, impressoras, telas
//   node fireaccess.mjs tela     <codigo>
//   node fireaccess.mjs clicar   <codigo> <x> <y> [direito|duplo]
//   node fireaccess.mjs mover    <codigo> <x> <y>
//   node fireaccess.mjs arrastar <codigo> <x1> <y1> <x2> <y2>
//   node fireaccess.mjs digitar  <codigo> "<texto>"
//   node fireaccess.mjs tecla    <codigo> <combo>        (ex.: enter, ctrl+v, win+r, alt+f4)
//   node fireaccess.mjs rolar    <codigo> <quanto> [x y] (negativo desce)
//   node fireaccess.mjs executar <codigo> "<PowerShell>" [--tempo=60]   devolve a saída (máx. 85 s)
//   node fireaccess.mjs abrir    <codigo> <programa|caminho|url> [argumentos...]   já como administrador
//   node fireaccess.mjs enviar   <codigo> <arquivo-local>  vai para Downloads\FireHub do cliente
//   node fireaccess.mjs encerrar <codigo>
//
// x/y são da imagem salva pelo último "tela" (largura até 1366).
// --esperar=<ms> em clicar/digitar/tecla/rolar troca a espera antes da tela de depois (padrão 500).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.env.FIREACCESS_URL || "https://firehubfood.com.br/fireaccess-relay").replace(/\/$/, "");
const TOKEN = process.env.FIREACCESS_TOKEN || (() => {
  try { return fs.readFileSync(path.join(os.homedir(), ".fireaccess-token"), "utf8").trim(); } catch { return ""; }
})();
if (!TOKEN) { console.error("Defina FIREACCESS_TOKEN ou crie ~/.fireaccess-token."); process.exit(1); }

async function api(caminho, corpo) {
  const r = await fetch(BASE + caminho, {
    method: corpo ? "POST" : "GET",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({ erro: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
  return j;
}

function salvar(codigo, r) {
  if (!r.jpeg) return;
  const arquivo = path.join(os.tmpdir(), `fireaccess-${codigo}-${Date.now()}.jpg`);
  fs.writeFileSync(arquivo, Buffer.from(r.jpeg, "base64"));
  console.log(`tela ${r.largura}x${r.altura}: ${arquivo}`);
}

// PowerShell: aspas simples por dentro de aspas simples viram duas.
const ps = (t) => `'${String(t).replace(/'/g, "''")}'`;

const INFO = `
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$so = Get-CimInstance Win32_OperatingSystem
"Computador: $env:COMPUTERNAME  Usuário: $env:USERNAME  Administrador: $(if ($admin) {'sim'} else {'NÃO'})"
"Windows: $($so.Caption) $($so.Version) $($so.OSArchitecture)"
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { "Tela: $($_.Bounds.Width)x$($_.Bounds.Height)$(if ($_.Primary) {' (principal)'})" }
"Impressoras:"
Get-Printer | ForEach-Object { "  $($_.Name)  [porta $($_.PortName), driver $($_.DriverName)]$(if ($_.PrinterStatus -ne 'Normal') {" status $($_.PrinterStatus)"})" }
$ass = Get-Process | Where-Object { $_.ProcessName -match 'assistente|firehub' } | Select-Object -ExpandProperty ProcessName -Unique
"Processos FireHub abertos: $(if ($ass) { $ass -join ', ' } else { 'nenhum' })"
`;

const args = process.argv.slice(2);
const opcoes = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
const [acao, codigo, ...resto] = args.filter((a) => !a.startsWith("--"));
const n = (v) => { const x = Number(v); if (!Number.isFinite(x)) throw new Error(`número inválido: ${v}`); return x; };
const esperar = opcoes.esperar != null ? { esperar: n(opcoes.esperar) } : {};

try {
  if (acao === "sessoes") {
    const lista = await api("/sessoes");
    if (!lista.length) console.log("nenhuma sessão aberta");
    for (const s of lista) {
      const m = s.maquina || {};
      const situacao = s.caiu ? "CAIU (reconectando)" : s.permitido ? "PERMITIDA" : "esperando Permitir";
      console.log(`${s.codigo}  ${situacao}  ${m.nome || "?"} (${m.usuario || "?"})  ${m.admin ? "administrador" : "SEM administrador"}  v${m.versao || "0.1"}  desde ${s.desde}`);
    }
  } else if (acao === "encerrar") {
    await api(`/sessoes/${codigo}/encerrar`, {});
    console.log("sessão encerrada");
  } else {
    if (!/^\d{6}$/.test(codigo || "")) throw new Error("informe o código de 6 dígitos");
    let comando;
    switch (acao) {
      case "tela": comando = { tipo: "tela" }; break;
      case "clicar": comando = { tipo: "clicar", x: n(resto[0]), y: n(resto[1]), botao: resto[2] === "direito" ? "direito" : "esquerdo", duplo: resto[2] === "duplo", ...esperar }; break;
      case "mover": comando = { tipo: "mover", x: n(resto[0]), y: n(resto[1]), ...esperar }; break;
      case "arrastar": comando = { tipo: "arrastar", x1: n(resto[0]), y1: n(resto[1]), x2: n(resto[2]), y2: n(resto[3]), ...esperar }; break;
      case "digitar": comando = { tipo: "digitar", texto: resto.join(" "), ...esperar }; break;
      case "tecla": comando = { tipo: "tecla", combo: resto[0], ...esperar }; break;
      case "rolar": comando = { tipo: "rolar", quanto: n(resto[0]), ...(resto[1] != null ? { x: n(resto[1]), y: n(resto[2]) } : {}), ...esperar }; break;
      case "executar": comando = { tipo: "executar", script: resto.join(" "), tempo: n(opcoes.tempo ?? 60) }; break;
      case "info": comando = { tipo: "executar", script: INFO, tempo: 30 }; break;
      case "abrir": {
        if (!resto[0]) throw new Error("informe o programa, caminho ou link");
        const lista = resto.slice(1);
        comando = { tipo: "executar", tempo: 20, script: `Start-Process -FilePath ${ps(resto[0])}${lista.length ? ` -ArgumentList ${lista.map(ps).join(",")}` : ""}; "aberto"` };
        break;
      }
      case "enviar": {
        const arquivo = resto.join(" ");
        const dado = fs.readFileSync(arquivo);
        if (dado.length > 30 * 1024 * 1024) throw new Error("máximo 30 MB; para maior, baixe no PC do cliente com executar (Invoke-WebRequest)");
        comando = { tipo: "enviar", nome: path.basename(arquivo), b64: dado.toString("base64") };
        break;
      }
      default: throw new Error("ação desconhecida (veja o topo do arquivo)");
    }
    const r = await api(`/sessoes/${codigo}/comando`, comando);
    if (r.saida != null) {
      process.stdout.write(String(r.saida).replace(/\s+$/, "") + "\n");
      if (!r.ok) { console.error(`(saiu com código ${r.codigoSaida})`); process.exitCode = 1; }
    } else if (r.caminho) console.log(`salvo no PC do cliente: ${r.caminho} (${r.bytes} bytes)`);
    else if (r.ok) console.log("ok");
    salvar(codigo, r);
  }
} catch (e) {
  console.error("erro:", e.message);
  process.exit(1);
}
