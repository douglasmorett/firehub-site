/**
 * ─────────────────────────────────────────────────────────────
 *  🔥 FireHub Assistente de Impressão
 *  Servidor HTTP local para comunicação com impressoras térmicas
 *  Porta: 7891 — Roda na bandeja do sistema (system tray)
 * ─────────────────────────────────────────────────────────────
 */
const express = require("express");
const cors = require("cors");
const { execSync, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = 7891;
const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "5mb" }));

/* ─── Permissão de loopback no navegador (Chrome/Edge 142+) ──────────────────
 *
 * O Chrome novo NEGA por padrão, sem nem perguntar, que um site público
 * (firehubfood.com.br) fale com localhost — a permissão "loopback-network"
 * nasce "denied". Foi assim que, em 27/08/2026, a tela de Impressoras passou
 * a dizer "Desconectado" com o Assistente rodando e saudável na mesma máquina
 * (Brasa Burguer), e a impressão disparada do navegador morreu junto, muda.
 *
 * A saída oficial é política de navegador: LoopbackNetworkAllowedForUrls
 * (e a irmã mais ampla LocalNetworkAccessAllowedForUrls) isenta o site das
 * checagens. O Chrome lê essas políticas também de HKCU — não precisa de
 * administrador — então o próprio Assistente garante a chave a cada início:
 * instalou/atualizou o Assistente, o painel volta a enxergá-lo. HKLM também é
 * tentado (pega quando rodando elevado) e cobre todos os usuários do PC.
 *
 * O navegador relê políticas do registro sozinho (em até ~90 min) ou na hora
 * em que é reaberto — reiniciar o Chrome aplica na hora.
 */
function liberarLoopbackNoNavegador() {
  if (process.platform !== "win32") return;
  const { exec } = require("child_process");
  const origens = ["https://firehubfood.com.br", "https://www.firehubfood.com.br"];
  const navegadores = ["Google\\Chrome", "Microsoft\\Edge"];
  const politicas = ["LoopbackNetworkAllowedForUrls", "LocalNetworkAccessAllowedForUrls"];
  for (const colmeia of ["HKCU", "HKLM"]) {
    for (const nav of navegadores) {
      for (const politica of politicas) {
        origens.forEach((origem, i) => {
          // Idempotente (/f sobrescreve). HKLM falha sem elevação — e tudo bem:
          // o HKCU do usuário da loja já resolve.
          exec(
            `reg add "${colmeia}\\Software\\Policies\\${nav}\\${politica}" /v ${i + 1} /t REG_SZ /d "${origem}" /f`,
            () => {}
          );
        });
      }
    }
  }
  console.log("[PrintServer] 🔓 Política de loopback do navegador garantida (Chrome/Edge).");
}
liberarLoopbackNoNavegador();

/* ─── Helpers ──────────────────────────────────────────────── */
const tmpDir = path.join(os.tmpdir(), "firehub-print");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

// Cria o script PowerShell de raw printing em disco (evita problemas de heredoc inline)
const PS_SCRIPT_PATH = path.join(tmpDir, "rawprint.ps1");
fs.writeFileSync(PS_SCRIPT_PATH, `
param([string]$PrinterName, [string]$FilePath)
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
  [StructLayout(LayoutKind.Sequential)] public struct DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.drv",SetLastError=true,CharSet=CharSet.Ansi)]
  public static extern bool OpenPrinter(string p, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv",SetLastError=true,CharSet=CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr h, int l, ref DOCINFOA di);
  [DllImport("winspool.drv",SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
  [DllImport("winspool.drv",SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv",SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr h);

  public static bool Send(string name, byte[] data) {
    if (string.IsNullOrEmpty(name)) return false;
    IntPtr h;
    if (!OpenPrinter(name, out h, IntPtr.Zero)) return false;
    var di = new DOCINFOA { pDocName="FireHub", pDataType="RAW" };
    if (!StartDocPrinter(h, 1, ref di)) { ClosePrinter(h); return false; }
    StartPagePrinter(h);
    IntPtr p = Marshal.AllocCoTaskMem(data.Length);
    Marshal.Copy(data, 0, p, data.Length);
    int w; WritePrinter(h, p, data.Length, out w);
    Marshal.FreeCoTaskMem(p);
    EndPagePrinter(h); EndDocPrinter(h); ClosePrinter(h);
    return true;
  }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
$ok = $false

if ($PrinterName -and $PrinterName.Trim() -ne "") {
  $ok = [RawPrint]::Send($PrinterName, $bytes)
}

if (-not $ok) {
  # Tenta buscar impressora padrão do Windows
  try {
    $defaultPrinter = (Get-WmiObject -Class Win32_Printer -ErrorAction SilentlyContinue | Where-Object { $_.Default -eq $true }).Name
    if ($defaultPrinter) { $ok = [RawPrint]::Send($defaultPrinter, $bytes) }
  } catch {}
}

if (-not $ok) {
  # Tenta primeira impressora USB / Térmica física instalada
  try {
    $anyPrinter = (Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.PortName -like "USB*" -or $_.PortName -like "LPT*" -or $_.DriverName -like "*elgin*" -or $_.DriverName -like "*pos*" -or $_.DriverName -like "*epson*" -or $_.DriverName -like "*bematech*" } | Select-Object -First 1).Name
    if ($anyPrinter) { $ok = [RawPrint]::Send($anyPrinter, $bytes) }
  } catch {}
}

if (-not $ok) {
  throw "Falha ao enviar dados para impressora ($PrinterName)"
}
Write-Output "OK"
`, "utf-8");

/**
 * Parse seguro de JSON com fallback via Regex se o encoding do Windows falhar
 */
function safeJsonParse(str) {
  if (!str) return null;
  try {
    const clean = str.replace(/^\uFEFF/, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    try {
      const names = [];
      const matches = str.matchAll(/"Name"\s*:\s*"([^"]+)"/gi);
      for (const m of matches) {
        if (m[1]) names.push({ Name: m[1] });
      }
      return names.length > 0 ? names : null;
    } catch {
      return null;
    }
  }
}

function dedupePrinters(list) {
  const seen = new Set();
  const res = [];
  for (const item of list) {
    if (item && item.name && !seen.has(item.name.toLowerCase())) {
      seen.add(item.name.toLowerCase());
      res.push(item);
    }
  }
  return res;
}

/* ─── Impressoras pelo registro do SISTEMA ───────────────────────────────
 *
 * O caminho HKCU (etapa 0) lê a lista do USUÁRIO logado, e ela vem vazia mais
 * do que se imagina: instalação feita por outra conta, PC que entrou no
 * domínio, Assistente rodando elevado (aí HKCU é a colmeia do administrador,
 * não a de quem está no balcão). Quando isso acontece, sobravam só as três
 * tentativas por PowerShell — e num PC de loja carregado o `Get-Printer` gasta
 * o timeout só carregando o módulo PrintManagement a frio.
 *
 * Foi exatamente o que aconteceu na Hakim Centro em 27/08/2026: os quatro
 * métodos falharam, o /status respondeu `printers: []`, e a tela de Impressoras
 * abriu com o dropdown vazio — sem como trocar ou cadastrar impressora.
 *
 * HKLM\...\Print\Printers é a lista do SISTEMA: uma subchave por impressora
 * instalada, independente de usuário e de elevação, lida pelo reg.exe em
 * milissegundos e sem PowerShell nenhum. De quebra traz porta e driver, que o
 * HKCU não traz — é com eles que a tela separa impressora de verdade de
 * "Microsoft Print to PDF".
 *
 * `chcp 65001` porque o reg.exe escreve na página de código do console (850 no
 * Windows pt-BR): sem isso, "Impressora Térmica" volta com o acento corrompido
 * e o OpenPrinter não acha esse nome.
 */
const CHAVE_IMPRESSORAS_SISTEMA = "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers";
const PREFIXO_IMPRESSORAS_SISTEMA = "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Print\\Printers\\";

function valorPorImpressoraNoRegistro(valor) {
  const cmd = `cmd /c "chcp 65001>nul & reg query "${CHAVE_IMPRESSORAS_SISTEMA}" /s /v "${valor}""`;
  const raw = execSync(cmd, { encoding: "utf-8", timeout: 6000, windowsHide: true });
  const mapa = new Map();
  const re = new RegExp("^\\s+" + valor + "\\s+REG_\\w+\\s*(.*)$", "i");
  let atual = null;
  for (const linha of raw.split(/\r?\n/)) {
    if (linha.startsWith(PREFIXO_IMPRESSORAS_SISTEMA)) {
      const nome = linha.slice(PREFIXO_IMPRESSORAS_SISTEMA.length).trim();
      // `reg query` sem /s lista só as filhas diretas; a barra que sobra seria
      // subchave de configuração (DsDriver, PrinterDriverData), não impressora.
      atual = nome && !nome.includes("\\") ? nome : null;
      if (atual && !mapa.has(atual)) mapa.set(atual, "");
      continue;
    }
    const m = linha.match(re);
    if (m && atual) mapa.set(atual, (m[1] || "").trim());
  }
  return mapa;
}

function impressorasPeloRegistroDoSistema() {
  const portas = valorPorImpressoraNoRegistro("Port");
  // O driver é um segundo `reg query` porque o reg.exe aceita um /v por vez.
  // Custa milissegundos, e sem ele a tela nao consegue distinguir a termica.
  let drivers = new Map();
  try { drivers = valorPorImpressoraNoRegistro("Printer Driver"); } catch {}

  const lista = [];
  for (const [name, port] of portas) {
    if (name) lista.push({ name, driver: drivers.get(name) || "", port: port || "", status: "online" });
  }
  return lista;
}

/**
 * Lista impressoras reais instaladas no Windows
 * (Registro do usuário -> Registro do sistema -> PowerShell UTF-8 -> WMI -> Texto puro)
 *
 * Guarda em `diagnosticoImpressoras` o que cada etapa devolveu. Quando a lista
 * volta vazia, esse rastro aparece no /status: sem ele a unica coisa que se via
 * era `printers: []`, sem dizer QUAL etapa falhou nem por que — e a loja fica a
 * quilometros de distancia.
 */
let diagnosticoImpressoras = [];

function listPrinters() {
  const list = [];
  const diag = [];
  const anota = (etapa, resultado) => diag.push(`${etapa}: ${resultado}`);
  const encerra = () => { diagnosticoImpressoras = diag; };

  // 0. OS DOIS REGISTROS, SOMADOS. Ambos custam milissegundos e nenhum e
  // superconjunto do outro: o HKLM tem o que esta instalado na MAQUINA (com
  // porta e driver), o HKCU tem as conexoes do USUARIO logado, que incluem
  // impressora de rede mapeada so para ele. Somar os dois e a unica leitura que
  // nao perde impressora — nenhuma loja passa a enxergar menos do que enxergava.
  //
  // O HKLM vem primeiro de proposito: `dedupePrinters` mantem a PRIMEIRA
  // ocorrencia de cada nome, entao a entrada que sobrevive e a que traz porta e
  // driver. Sem eles a tela nao separa a termica do "Microsoft Print to PDF" e
  // o cadastro de impressora acaba chutando o primeiro nome da lista.
  try {
    const doSistema = impressorasPeloRegistroDoSistema();
    for (const p of doSistema) list.push(p);
    anota("registro do sistema (HKLM)", `${doSistema.length} impressora(s)`);
  } catch (e05) {
    anota("registro do sistema (HKLM)", `falhou - ${e05.message}`);
  }

  try {
    const raw = execSync('reg query "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\PrinterPorts"', { encoding: "utf-8", timeout: 4000 });
    const lines = raw.split(/\r?\n/);
    let achadas = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("HKEY_")) continue;
      const parts = trimmed.split(/\s{2,}/);
      if (parts.length >= 2) {
        const name = parts[0].trim();
        // A porta vem embutida no valor: "winspool,USB001,15,45".
        const campos = String(parts[parts.length - 1] || "").split(",");
        const port = campos.length > 1 ? campos[1].trim() : "";
        if (name) { list.push({ name, driver: "", port, status: "online" }); achadas++; }
      }
    }
    anota("registro do usuario (HKCU)", `${achadas} impressora(s)`);
  } catch (e0) {
    anota("registro do usuario (HKCU)", `falhou - ${e0.message}`);
  }

  if (list.length > 0) { encerra(); return dedupePrinters(list); }

  // 1. Tenta Get-Printer com UTF-8 explícito
  try {
    const cmd = `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Printer | Select-Object Name, DriverName, PortName | ConvertTo-Json -Compress"`;
    const raw = execSync(cmd, { encoding: "utf-8", timeout: 8000 });
    const parsed = safeJsonParse(raw);
    if (parsed) {
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const p of arr) {
        if (p && p.Name) list.push({ name: String(p.Name).trim(), driver: String(p.DriverName || "").trim(), port: String(p.PortName || "").trim(), status: "online" });
      }
    }
    anota("PowerShell Get-Printer", `${list.length} impressora(s)`);
  } catch (e1) {
    anota("PowerShell Get-Printer", `falhou - ${e1.message}`);
  }

  if (list.length > 0) { encerra(); return dedupePrinters(list); }

  // 2. Fallback Get-WmiObject Win32_Printer
  try {
    const cmd = `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-WmiObject Win32_Printer | Select-Object Name, DriverName, PortName | ConvertTo-Json -Compress"`;
    const raw = execSync(cmd, { encoding: "utf-8", timeout: 8000 });
    const parsed = safeJsonParse(raw);
    if (parsed) {
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const p of arr) {
        if (p && p.Name) list.push({ name: String(p.Name).trim(), driver: String(p.DriverName || "").trim(), port: String(p.PortName || "").trim(), status: "online" });
      }
    }
    anota("PowerShell Win32_Printer", `${list.length} impressora(s)`);
  } catch (e2) {
    anota("PowerShell Win32_Printer", `falhou - ${e2.message}`);
  }

  if (list.length > 0) { encerra(); return dedupePrinters(list); }

  // 3. Fallback super simples em Texto Puro (uma linha por impressora)
  try {
    const cmd = `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (Get-Printer).Name"`;
    const raw = execSync(cmd, { encoding: "utf-8", timeout: 6000 });
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const name of lines) {
      list.push({ name, driver: "", port: "", status: "online" });
    }
    anota("PowerShell (Get-Printer).Name", `${list.length} impressora(s)`);
  } catch (e3) {
    anota("PowerShell (Get-Printer).Name", `falhou - ${e3.message}`);
  }

  encerra();
  return dedupePrinters(list);
}

/* ─── Cache da lista de impressoras ──────────────────────────────────────
 *
 * O /status chamava listPrinters() a cada chamada, e a tela do site desiste em
 * 1,5s (AbortSignal.timeout no PrinterSetupClient). Num PC onde as duas etapas
 * de registro falham, as tres de PowerShell podem levar mais de 20s somadas — o
 * navegador aborta antes, a tela diz "Desconectado" e a loja conclui que o
 * Assistente morreu, com ele rodando perfeitamente. Servir do cache faz o
 * /status responder na hora, sempre.
 *
 * Consulta vazia NAO apaga o cache: uma falha passageira (antivirus ocupado,
 * PowerShell frio) esvaziaria o dropdown de quem estava funcionando. Some so o
 * que nunca foi encontrado.
 */
const TTL_CACHE_IMPRESSORAS = 30_000;
let cacheDeImpressoras = { lista: [], quando: 0 };

function listPrintersCached(forcar = false) {
  const agora = Date.now();
  if (!forcar && cacheDeImpressoras.quando && agora - cacheDeImpressoras.quando < TTL_CACHE_IMPRESSORAS) {
    return cacheDeImpressoras.lista;
  }
  let lista = [];
  try { lista = listPrinters(); } catch (e) { lista = []; }
  if (lista.length > 0 || cacheDeImpressoras.lista.length === 0) {
    cacheDeImpressoras = { lista, quando: agora };
  }
  return cacheDeImpressoras.lista;
}

// Aquece o cache logo depois de subir, para a primeira consulta da tela ja
// encontrar a lista pronta em vez de pagar a deteccao inteira na hora.
setTimeout(() => {
  try {
    const achadas = listPrintersCached(true);
    console.log(`[Impressoras] ${achadas.length} encontrada(s) — ${diagnosticoImpressoras.join(" | ")}`);
  } catch {}
}, 1000);

/**
 * Envia dados RAW para a impressora usando script PowerShell externo
 */
function rawPrint(printerName, dataBuffer) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(tmpDir, `receipt_${Date.now()}.bin`);
    // O stream carrega bytes de comando (0x00-0xFF). Gravar como UTF-8 transformaria
    // qualquer byte >= 0x80 em dois bytes e corromperia o comando (ex: GS W do 58mm).
    const payload = Buffer.isBuffer(dataBuffer) ? dataBuffer : Buffer.from(String(dataBuffer), "latin1");
    fs.writeFileSync(tmpFile, payload);

    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_SCRIPT_PATH}" -PrinterName "${printerName}" -FilePath "${tmpFile}"`;
    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
      if (err) {
        console.error("[Print] Erro:", stderr || err.message);
        reject(new Error(stderr || err.message));
      } else {
        console.log("[Print] OK ->", printerName);
        resolve(true);
      }
    });
  });
}

/* ─── ESC/POS builder ─────────────────────────────────────── */
function cleanAscii(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/º/g, ".")
    .replace(/ª/g, ".")
    .replace(/Ç/g, "C")
    .replace(/ç/g, "c")
    // Remove o que sobrou fora do ASCII imprimivel (emoji, simbolos).
    // Sem isto um emoji no nome do item vira byte alto e sai lixo na bobina.
    .replace(/[^\x20-\x7E\n]/g, "");
}

/**
 * `comboSelections` em lista, venha no formato que vier.
 *
 * O combo do cardapio online do FireHub e gravado como
 * `{ grupoId: { "Esfirra de Carne": 6, "Esfirra de Queijo": 4 } }`, e todo
 * lugar aqui exigia array: o objeto era descartado em silencio e a comanda
 * saia com "1x Combo 10 Esfirras Simples + 2 Bebidas" e mais NADA — sem os
 * sabores, sem a bebida. Pelo PDV e pelo iFood aparecia, porque esses mandam
 * array. O site passou a normalizar antes de enviar; isto aqui e a mesma regra
 * do lado de ca, para o Assistente nao depender de quem chama.
 */
function normalizarCombo(raw) {
  if (!raw) return [];

  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }

  if (parsed && !Array.isArray(parsed) && typeof parsed === "object") {
    const achatado = [];
    for (const grupo of Object.values(parsed)) {
      if (!grupo || typeof grupo !== "object" || Array.isArray(grupo)) continue;
      for (const [nome, qtd] of Object.entries(grupo)) {
        const n = Number(qtd);
        if (nome && Number.isFinite(n) && n > 0) achatado.push({ name: nome, quantity: n });
      }
    }
    parsed = achatado;
  }

  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((s) => (typeof s === "string" ? { name: s, quantity: 1 } : s))
    .filter((s) => s && s.name);
}

function buildEscPos(order, storeName, columns = 48, profile = "safe") {
  // Largura saneada AQUI, e nao so no site: o assistente e alcancavel por
  // qualquer pagina em localhost e pela fila da nuvem, entao o site nunca e a
  // unica fonte. Sem isto um valor invalido viraria bytes arbitrarios no GS W
  // (NaN & 0xFF = 0, ou seja GS W 0 0 = area de impressao ZERO).
  const colsRaw = Number(columns);
  columns = Number.isFinite(colsRaw) ? Math.max(24, Math.min(64, Math.floor(colsRaw))) : 48;

  const ESC = "\x1B", GS = "\x1D", LF = "\x0A";
  const INIT = ESC + "@";
  const BOLD_ON = ESC + "E\x01";
  const BOLD_OFF = ESC + "E\x00";
  const CENTER = ESC + "a\x01", LEFT = ESC + "a\x00";
  const DOUBLE_HEIGHT = GS + "!\x01";
  const DOUBLE_SIZE = GS + "!\x11";
  const DOUBLE_OFF = GS + "!\x00";
  const CUT = GS + "V\x00", FEED = ESC + "d\x04";

  const divider = "-".repeat(columns) + LF;

  // Quebra por palavra. `indent` e a indentacao das linhas de continuacao.
  // Palavra unica maior que a linha e cortada no limite (nao ha alternativa).
  // Sem isto o texto sai numa linha unica e quem quebra e a IMPRESSORA, no
  // ponto que ela quiser -- foi assim que "Endereco: ... Ma / cae" apareceu.
  const wrap = (text, width, indent = 0) => {
    const t = cleanAscii(text).replace(/\s+/g, " ").trim();
    if (!t) return [];
    const w = Math.max(4, width);
    const out = [];
    let cur = "";
    const capacity = () => (out.length === 0 ? w : Math.max(1, w - indent));
    const flush = () => { if (cur) { out.push(cur); cur = ""; } };

    for (const rawWord of t.split(" ")) {
      let word = rawWord;
      while (word.length > capacity()) {
        if (cur) { flush(); continue; }   // fecha a linha em curso antes de cortar
        out.push(word.slice(0, capacity()));
        word = word.slice(capacity());
      }
      if (!word) continue;
      const cand = cur ? cur + " " + word : word;
      if (cand.length > capacity()) { flush(); cur = word; }
      else cur = cand;
    }
    flush();

    const pad = " ".repeat(indent);
    return out.map((l, i) => (i === 0 ? l : pad + l));
  };

  const wrapLines = (text, indent = 0) =>
    wrap(text, columns, indent).map(l => l + LF).join("");

  // Centralizacao NO CODIGO. Antes o titulo era centralizado pela IMPRESSORA
  // (ESC a 1) sobre a largura FISICA dela, enquanto o corpo era preenchido pelo
  // codigo ate `columns`: duas larguras de referencia no mesmo cupom. Agora o
  // layout inteiro e determinado por `columns`, seja qual for o perfil ESC/POS.
  const centerLine = (text) => {
    const t = cleanAscii(text).trim();
    // Se ja cabe, preserva o espacamento interno original: o cabecalho usa
    // espaco duplo como separador visual entre numero, tipo e referencia.
    if (t.length <= columns) {
      return " ".repeat(Math.max(0, Math.floor((columns - t.length) / 2))) + t + LF;
    }
    return wrap(t, columns)
      .map(l => " ".repeat(Math.max(0, Math.floor((columns - l.length) / 2))) + l + LF)
      .join("");
  };

  const makeHeaderTitle = (title) => centerLine(cleanAscii(title).toUpperCase());

  // rightAlign e makeBoxLine eram byte-a-byte identicas: viram uma so.
  // Em vez de TRUNCAR o rotulo (o que comia o fim do nome do produto), quebra
  // em linhas e alinha o valor a direita na ultima.
  const padLine = (leftStr, rightStr) => {
    const r = cleanAscii(rightStr);
    const room = Math.max(4, columns - r.length - 1); // pelo menos 1 espaco antes do valor
    const parts = wrap(leftStr, room, 2);
    if (!parts.length) return " ".repeat(Math.max(0, columns - r.length)) + r + LF;
    let out = "";
    for (let i = 0; i < parts.length - 1; i++) out += parts[i] + LF;
    const last = parts[parts.length - 1];
    out += last + " ".repeat(Math.max(1, columns - last.length - r.length)) + r + LF;
    return out;
  };
  const rightAlign = padLine;
  const makeBoxLine = padLine;

  // Nao trunca mais: sub-item de combo e observacao passam a quebrar com
  // indentacao, mantendo a margem de 2 espacos do modelo da Hakim.
  const makeBoxText = (text) =>
    wrap(text, Math.max(6, columns - 2), 2).map(l => "  " + l + LF).join("");

  // Tarja invertida ocupa a largura inteira; usa o texto curto quando o longo
  // nao couber (o literal fixo de 45 chars estourava em 42 e explodia em 32).
  const banner = (long, short) => {
    const t = (long.length + 4 <= columns) ? long : short;
    const total = Math.max(0, columns - t.length);
    const left = Math.floor(total / 2);
    return " ".repeat(left) + t + " ".repeat(total - left);
  };

  // Separador horizontal sólido entre itens
  const boxBorder = "_".repeat(columns) + LF;

  // Estado explicito da impressora. Sem isto, depois do ESC @ cada marca volta ao
  // default de fabrica/NVRAM dela: a Bematech rende 42 colunas em 80mm onde a
  // impressora da Hakim rende 48, e o texto montado para 48 quebra no meio do preco.
  // Como o envio e RAW (pDataType="RAW"), o driver do Windows nao corrige nada --
  // so estes bytes garantem o mesmo estado em qualquer marca.
  //
  // PERFIS (escposProfile, por impressora):
  //   safe   (PADRAO) so comandos de 1 parametro, universais desde a TM-T88.
  //          Numa impressora que ja esta em Fonte A sao no-op: nao mudam nada
  //          onde ja funciona, e firmware que os ignore nao tem parametro
  //          sobrando para cuspir como texto.
  //   full   safe + charset USA + entrelinha padrao + GEOMETRIA (GS L / GS W).
  //          GS L e GS W tem 2 parametros: firmware que nao os conhece imprime
  //          "L" + 2 NUL / "W@" + STX na PRIMEIRA linha. Alem disso GS W so
  //          ENCOLHE a area (a spec manda clampar ao maximo imprimivel), entao
  //          ele e endurecimento contra deriva -- nao e o que conserta uma
  //          impressora estreita. Quem conserta e o "columns" calibrado.
  //          So habilite depois que a regua provar que AQUELE modelo obedece.
  //   legacy exatamente os bytes das versoes antigas. Valvula de escape se
  //          alguma loja que ja funciona regredir.
  //
  // areaDots = columns * 12 assume Fonte A (celula 12x24 a 203dpi) E unidade de
  // movimento horizontal = 1 dot (que o ESC @ restaura da NVRAM do modelo).
  // E mais um motivo para "full" so ir para impressora calibrada.
  const areaDots = Math.max(192, Math.min(576, columns * 12));
  const PREAMBLE = {
    legacy: INIT + ESC + "t\x03",
    safe:
      INIT +                     // 1B 40       reset
      ESC + "t\x03" +            // 1B 74 03    codepage 860 (ESC @ restaura da NVRAM)
      ESC + "M\x00" +            // 1B 4D 00    Fonte A (celula 12x24)
      ESC + "!\x00" +            // 1B 21 00    zera negrito/dupla/sublinhado residual
      ESC + " \x00",             // 1B 20 00    espacamento lateral do caractere = 0
    full:
      INIT +
      ESC + "t\x03" +
      ESC + "R\x00" +            // 1B 52 00    charset internacional USA ("#" e "$" literais)
      ESC + "M\x00" +
      ESC + "!\x00" +
      ESC + " \x00" +
      ESC + "2" +                // 1B 32       entrelinha padrao 1/6"
      GS + "L\x00\x00" +         // 1D 4C 00 00 margem esquerda = 0 (antes do GS W: a
                                 //             spec valida margem+area no GS W)
      GS + "W" + String.fromCharCode(areaDots & 0xFF, (areaDots >> 8) & 0xFF),
  };

  let res = PREAMBLE[profile] || PREAMBLE.safe;

  // 1. TOP HEADER (Número + Tipo + Tag) — Usando DOUBLE_HEIGHT para não quebrar linha
  const seqNumStr = order.dailyOrderNumber || order.orderSeqNumber || (order.id ? order.id.slice(-4) : "");
  const deliveryTypeTag = order.deliveryType === "DELIVERY" ? "DELIVERY" : order.deliveryType === "MESA" ? "MESA" : "RETIRADA";
  const orderRef = order.ifoodReference || order.openDeliveryReference || (order.id ? order.id.slice(-6).toUpperCase() : "");
  const refTag = orderRef ? `#${orderRef}` : "";

  const headerLine = seqNumStr
    ? `(${seqNumStr}) ${deliveryTypeTag}  ${refTag}`.trim()
    : `${deliveryTypeTag}  ${refTag}`.trim();

  // DE QUAL loja iFood veio, quando a conta tem mais de uma no mesmo painel.
  // O servidor so manda `ifoodStoreName` nesse caso — numa loja so o campo vem
  // vazio e a comanda sai exatamente como sempre saiu. Sem isto, a comanda da
  // Ragnar Pizza e a da Ragnar Burguer sao identicas e o atendente nao sabe em
  // qual saco vai.
  const lojaOrigem = (order.ifoodStoreName || "").toString().trim();

  const dByStr = (order.deliveryBy || order.deliveredBy || "").toString().toUpperCase();
  const srcStr = (order.source || "").toString().toUpperCase();
  const odChannelStr = (order.openDeliveryChannel || "").toString().toUpperCase();

  // ── QUEM VAI ENTREGAR ────────────────────────────────────────────────
  //
  // A regra aqui aceitava o CODIGO DE COLETA como prova de entrega parceira.
  // O iFood emite codigo tambem em entrega propria (e o numero que o cliente
  // informa ao receber): medido na Hakim em 23/08/2026, 73 dos 80 pedidos do
  // dia tinham codigo e 70 eram entrega da loja. Resultado: a comanda saia
  // com "NAO USAR MOTOBOY DA LOJA!" em pedido que era da loja, enquanto o
  // painel mostrava a coisa certa.
  //
  // Agora quem decide e o servidor, que manda `entregaParceira` pronto
  // (src/lib/entrega-parceira.ts). O resto abaixo e so para o caso de vir um
  // pedido de versao antiga do servidor, sem esse campo -- e mesmo ai o
  // codigo de coleta nao entra na conta: prova de entrega parceira e quem
  // entrega, nunca a existencia de um numero.
  const decididoNoServidor = typeof order.entregaParceira === "boolean";
  const dModeStr = (order.deliveryMode || "").toString().toUpperCase();
  const ehLogistica = dByStr === "LOGISTICS" || dByStr === "PARTNER"
    || dModeStr === "LOGISTIC" || dModeStr === "PARTNER";
  const ehEntregaPropria = dByStr === "MERCHANT" || dByStr === "LOJA"
    || dByStr === "PROPRIO" || dByStr === "MERCHANT_DELIVERY";

  const is99FoodDriver = !ehEntregaPropria && (
    srcStr === "99FOOD" || odChannelStr === "99FOOD" || dByStr.includes("99")
  ) && (dByStr.includes("99") || ehLogistica);

  const isIfoodDriver = !ehEntregaPropria && (
    srcStr === "IFOOD" || dByStr.includes("IFOOD")
  ) && (
    dByStr.includes("IFOOD") || ehLogistica ||
    Boolean(order.ifoodDriverName) ||
    Boolean(order.ifoodDriverStatus && order.ifoodDriverStatus !== "UNASSIGNED")
  );

  const isPartnerDriver = decididoNoServidor
    ? order.entregaParceira === true
    : (is99FoodDriver || isIfoodDriver || (!ehEntregaPropria && ehLogistica));

  const partnerLabel = (decididoNoServidor && order.parceiroDaEntrega)
    ? String(order.parceiroDaEntrega).toUpperCase()
    : (is99FoodDriver ? "99FOOD" : (isIfoodDriver ? "IFOOD" : (srcStr || "PARCEIRO")));
  const pCode = order.ifoodPickupCode || order.openDeliveryPickupCode || "";

  res += DOUBLE_HEIGHT + BOLD_ON + centerLine(headerLine) + BOLD_OFF + DOUBLE_OFF;
  // Logo abaixo do numero, em destaque: e a primeira coisa que a cozinha
  // precisa saber quando a mesma impressora recebe tres marcas.
  if (lojaOrigem) {
    res += DOUBLE_HEIGHT + BOLD_ON + centerLine(cleanAscii(lojaOrigem).toUpperCase()) + BOLD_OFF + DOUBLE_OFF;
  }
  if (isPartnerDriver) {
    res += DOUBLE_HEIGHT + centerLine(`*** MOTOBOY ${partnerLabel} (ENTREGA PARCEIRA) ***`)
         + centerLine("NAO USAR MOTOBOY DA LOJA!") + DOUBLE_OFF;
    if (pCode) {
      res += DOUBLE_HEIGHT + centerLine(`CODIGO DE COLETA: #${pCode}`) + DOUBLE_OFF;
    }
  }
  res += LEFT + divider;
  res += wrapLines("Estabelecimento: " + cleanAscii(storeName || "FIREHUB").toUpperCase(), 2);
  if (orderRef) {
    res += "N. do Pedido: " + cleanAscii(orderRef) + LF;
  }
  const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
  const timeStr = order.createdAt ? new Date(order.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  if (dateStr) res += "Data: " + dateStr + " " + timeStr + LF;

  // 2. CLIENTE SECTION
  res += LF + DOUBLE_HEIGHT + makeHeaderTitle("CLIENTE") + DOUBLE_OFF + LF;
  if (order.customerName) res += wrapLines("Nome: " + cleanAscii(order.customerName), 2);
  if (order.customerPhone) res += wrapLines("Telefone: " + cleanAscii(order.customerPhone), 2);
  res += "Qtd Pedidos: 1" + LF;

  // 3. ENTREGA SECTION
  if (order.deliveryType === "DELIVERY" && order.customerAddress) {
    res += LF + DOUBLE_HEIGHT + makeHeaderTitle("ENTREGA") + DOUBLE_OFF + LF;
    res += wrapLines("Endereco: " + cleanAscii(order.customerAddress), 2);
    if (order.notes) {
      const cleanObs = cleanAscii(order.notes)
        .replace(/Pedido iFood #[A-Z0-9]+/gi, "")
        .replace(/🏷️?\s*Desconto R\$[\d.,]+\s*\([^)]*\)/gi, "")
        .replace(/\|\s*\|/g, "|")
        .replace(/^[\s|]+|[\s|]+$/g, "")
        .trim();
      if (cleanObs) {
        res += wrapLines("Obs: " + cleanObs, 2);
      }
    }
  }

  function getItemEffectivePrice(item, allItems, orderTotalAmount, deliveryFee = 0, discountTotal = 0) {
    let unitPrice = typeof item.price === "number" ? item.price : 0;
    if (unitPrice > 0) return unitPrice;

    if (item.comboSelections) {
      const parsed = normalizarCombo(item.comboSelections);
      if (parsed.length > 0) {
        const comboSum = parsed.reduce((acc, s) => acc + ((s.price || s.unitPrice || s.addition || 0) * (s.quantity || 1)), 0);
        if (comboSum > 0) return comboSum;
      }
    }

    const otherItemsSum = (allItems || []).reduce((sum, it) => {
      if (it === item || (it.id && item.id && it.id === item.id)) return sum;
      const p = typeof it.price === "number" ? it.price : 0;
      const q = it.qty || it.quantity || 1;
      return sum + p * q;
    }, 0);

    const expectedSubtotal = (orderTotalAmount || 0) - (deliveryFee || 0) + (discountTotal || 0);
    const diff = expectedSubtotal - otherItemsSum;
    const zeroPriceItems = (allItems || []).filter(it => !it.price || it.price === 0);
    const q = item.qty || item.quantity || 1;

    if (zeroPriceItems.length === 1 && diff > 0 && q > 0) {
      return diff / q;
    }

    return unitPrice;
  }

  const customKeywords = order.customBeverageKeywords || order.printerConfig?.customBeverageKeywords || "";
  const autoBeverageTag = order.printerConfig?.autoBeverageTag !== false; // Padrão: true

  const isBeverageName = (name) => {
    if (!name || !autoBeverageTag) return false;
    const cleanName = cleanAscii(name);
    const defaultPattern = "bebida|bebidas|refrigerante|refrigerantes|suco|sucos|cerveja|cervejas|agua|guarana|guaravita|coca|fanta|sprite|pepsi|soda|h2oh|monster|red bull|redbull|energetico|cha|mate|lata|2l|600ml|350ml|long neck|heineken|stella|budweiser|skol|brahma|antarctica|amstel|eisenbahn|sol|corona|smirnoff|ice|tonica|schweppes|del valle|tampico|kapo|suffresh|feel good|kombucha|vibe|tnt|bravus|skol beats|51|pitu|velho barreiro|corote|vodka|gin|whisky|whiskey|licor|vinho|espumante|champagne|chopp";

    let customPattern = "";
    if (customKeywords) {
      const list = typeof customKeywords === "string" ? customKeywords.split(",") : customKeywords;
      const cleanList = (Array.isArray(list) ? list : []).map(k => cleanAscii(String(k).trim())).filter(Boolean);
      if (cleanList.length > 0) {
        customPattern = "|" + cleanList.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      }
    }

    const bevRegex = new RegExp(`\\b(${defaultPattern}${customPattern})\\b`, "i");
    return bevRegex.test(cleanName);
  };

  const isBeverageItem = (item) => {
    if (!item) return false;
    if (item.isBeverage === true || item.isBeverage === "true") return true;
    if (!autoBeverageTag) return false;
    const cat = String(item.category || item.menuProduct?.category || "");
    const name = String(item.name || item.menuProduct?.name || "");
    return isBeverageName(cat) || isBeverageName(name);
  };

  const hasBeverages = (order.items || []).some(item => {
    if (isBeverageItem(item)) return true;
    if (normalizarCombo(item.comboSelections).some(s => isBeverageName(s.name))) return true;
    return false;
  });

  // ── IMPRESSORA SO DE BEBIDA ──────────────────────────────────────────
  //
  // Filtrar por CATEGORIA nao resolve a bebida que vem dentro de um combo: o
  // "Combo 2 + Guaravita" tem categoria "Combos", nao "Bebidas". A impressora
  // do bar entao ou nao recebia nada, ou recebia o combo inteiro — e o
  // barman lia uma comanda de comida para servir um refrigerante.
  //
  // Aqui a bebida e extraida de dentro do combo e vira uma linha propria. O
  // preco dela sai ZERO de proposito: o valor pertence ao combo, nao a ela, e
  // repetir o preco do combo em cada bebida somaria dinheiro que nao existe.
  const somenteBebidas = order?.somenteBebidas === true;

  const itensParaImprimir = (() => {
    const todos = order.items || [];
    if (!somenteBebidas) return todos;

    const saida = [];
    for (const item of todos) {
      if (isBeverageItem(item)) { saida.push(item); continue; }

      const escolhas = normalizarCombo(item.comboSelections).filter(s => isBeverageName(s.name));

      const qtdDoItem = item.qty || item.quantity || 1;
      for (const sel of escolhas) {
        saida.push({
          name: `${sel.name}  (do ${cleanAscii(item.name || "combo")})`,
          qty: (Number(sel.quantity) || 1) * qtdDoItem,
          price: 0,
          isBeverage: true,
        });
      }
    }
    return saida;
  })();

  // Nada de bebida neste pedido: esta impressora nao cospe papel em branco.
  if (somenteBebidas && itensParaImprimir.length === 0) return null;

  const INVERSE_ON = "\x1d\x42\x01";
  const INVERSE_OFF = "\x1d\x42\x00";

  /**
   * Pinta de preto a palavra BEBIDA numa linha JÁ montada e alinhada.
   *
   * Só a palavra, não a seta: é ela que o garçom procura de relance na pilha
   * de comandas. Trocar só "BEBIDA" também é o que sobrevive à quebra de
   * linha — `wrap` quebra nos espaços, então a palavra nunca chega partida.
   */
  const marcarBebida = (linha, ehBebida) =>
    ehBebida ? linha.replace("BEBIDA", INVERSE_ON + "BEBIDA" + INVERSE_OFF) : linha;

  // Comanda da COZINHA: mesmos itens, sem um preço na folha.
  //
  // O site tinha o botão "Cupom da Cozinha (Sem Valores)" desde sempre, e ele
  // saía com valores: o sinalizador parava no meio do caminho e aqui não havia
  // nada que o lesse. Quem monta o pedido na cozinha não precisa saber quanto
  // custa, e cupom com preço circulando no salão é o tipo de papel que acaba
  // na mão do cliente errado.
  const semValores = order?.semValores === true;

  // 4. RESUMO DO PEDIDO SECTION (Inside Boxes!)
  res += LF + DOUBLE_HEIGHT + makeHeaderTitle("RESUMO DO PEDIDO") + DOUBLE_OFF + LF;

  if (somenteBebidas) {
    res += LF + INVERSE_ON + banner("!! SO BEBIDAS DESTE PEDIDO !!", "!! SO BEBIDAS !!") + INVERSE_OFF + LF;
  }

  // A lista de itens e a filtrada; `order.items` continua sendo o segundo
  // argumento de getItemEffectivePrice porque o rateio do desconto so fecha
  // olhando o pedido INTEIRO, nao o pedaco que esta sendo impresso.
  if (itensParaImprimir.length) {
    res += boxBorder;
    itensParaImprimir.forEach((item, idx) => {
      const qty = item.qty || item.quantity || 1;
      const unitPrice = getItemEffectivePrice(item, order.items, order.totalAmount, order.deliveryFee || 0, order.discountTotal || 0);
      const price = unitPrice * qty;
      const priceStr = semValores ? "" : "R$ " + price.toFixed(2).replace(".", ",");
      let name = cleanAscii(item.name || item.menuProduct?.name || "Item");
      name = name.replace(/\s*\[\s*◄\s*BEBIDA\s*►\s*\]/gi, "").replace(/\s*<===\s*BEBIDA/gi, "").trim();

      const comboSels = normalizarCombo(item.comboSelections);

      // A tag no item PAI so vale para bebida avulsa — e a mesma regra da
      // previa na tela. Um combo cujo NOME tem a palavra "Bebidas" saia
      // marcado como se ele proprio fosse a bebida, inclusive quando a loja ja
      // tinha tirado a bebida de dentro dele. Dentro do combo, quem leva a tag
      // e a linha da bebida, logo abaixo.
      const isItemBev = comboSels.length === 0 && isBeverageItem(item);
      const bevTag = isItemBev ? "  <=== BEBIDA" : "";
      const itemLabel = `${name}${bevTag}`;
      // A inversão entra DEPOIS de montar a linha, nunca antes.
      //
      // INVERSE_ON e INVERSE_OFF são três bytes de controle cada, que o papel
      // não imprime mas o `.length` do JavaScript conta. Se entrassem no rótulo
      // antes de padLine, o alinhamento acharia a linha 6 caracteres mais longa
      // e empurraria a coluna do preço para a esquerda — ou quebraria a linha no
      // meio. É por isso que a faixa "CONTEM BEBIDA" sempre funcionou: lá a
      // inversão envolve a linha inteira, já montada.
      res += marcarBebida(makeBoxLine(`${qty}x ${itemLabel}`, priceStr), isItemBev);

      if (comboSels.length > 0) {
        comboSels.forEach((sel) => {
          const totalQty = sel.quantity || 1;
          const qPrefix = totalQty > 1 ? `${totalQty}x ` : "";
          let selName = cleanAscii(sel.name || "");
          selName = selName.replace(/\s*\[\s*◄\s*BEBIDA\s*►\s*\]/gi, "").replace(/\s*<===\s*BEBIDA/gi, "").trim();
          const isSelBev = isBeverageName(selName);
          const selBevTag = isSelBev ? "  <=== BEBIDA" : "";
          res += marcarBebida(makeBoxText(`  - ${qPrefix}${selName}${selBevTag}`), isSelBev);
        });
      }

      if (item.notes) {
        res += makeBoxText(`  Obs: ${item.notes}`);
      }
      res += boxBorder;
    });
  }

  if (hasBeverages) {
    res += INVERSE_ON + banner("!! ATENCAO: POSSUI BEBIDA NESTE PEDIDO !!", "!! CONTEM BEBIDA !!") + INVERSE_OFF + LF;
    res += boxBorder;
  }

  // 5. TOTALS
  // Comanda so de bebida tambem para aqui: ela mostra um pedaco do pedido, e
  // um total embaixo de um pedaco seria um numero que nao corresponde a nada.
  if (somenteBebidas) {
    res += LF + centerLine("-- COMANDA DE BEBIDAS --") + LF;
    res += LEFT + FEED + CUT;
    return Buffer.from(res, "binary");
  }

  // Na comanda da cozinha o papel acaba aqui: nada de subtotal, taxa, total,
  // forma de pagamento nem "COBRAR DO CLIENTE".
  if (semValores) {
    res += LF + centerLine("-- COMANDA DA COZINHA --") + LF;
    res += centerLine("(sem valores)") + LF;
    res += LEFT + FEED + CUT;
    return Buffer.from(res, "binary");
  }

  res += LF;
  const subtotal = order.items?.reduce((sum, it) => sum + (getItemEffectivePrice(it, order.items, order.totalAmount, order.deliveryFee || 0, order.discountTotal || 0) * (it.qty || it.quantity || 1)), 0) || order.totalAmount || 0;
  res += rightAlign("Subtotal:", "R$ " + Number(subtotal).toFixed(2).replace(".", ","));

  if (order.discountIfood && Number(order.discountIfood) > 0) {
    res += rightAlign("Desconto (iFood):", "-R$ " + Number(order.discountIfood).toFixed(2).replace(".", ","));
  }
  if (order.discountMerchant && Number(order.discountMerchant) > 0) {
    res += rightAlign("Desconto (Cupom - Loja):", "-R$ " + Number(order.discountMerchant).toFixed(2).replace(".", ","));
  } else if (!order.discountIfood && order.discountTotal && Number(order.discountTotal) > 0) {
    res += rightAlign("Desconto (Cupom - Loja):", "-R$ " + Number(order.discountTotal).toFixed(2).replace(".", ","));
  }

  const dFee = typeof order.deliveryFee === "number" ? order.deliveryFee : 0;
  const dFeeLabel = order.source === "IFOOD" ? "Taxa de Entrega (iFood):" : "Taxa de Entrega:";
  res += rightAlign(dFeeLabel, "R$ " + Number(dFee).toFixed(2).replace(".", ","));

  // TOTAL BOX — destaque limpo
  const totalValStr = "R$ " + Number(order.totalAmount || 0).toFixed(2).replace(".", ",");
  res += boxBorder;
  res += DOUBLE_HEIGHT + BOLD_ON + makeBoxLine("Total:", totalValStr) + BOLD_OFF + DOUBLE_OFF;
  res += boxBorder;

  // 6. PAYMENT METHOD & SAFETY NOTE
  const payMethodRaw = cleanAscii(order.paymentMethod || "");
  const payMethodClean = payMethodRaw.toLowerCase();
  const isExplicitOffline =
    /dinheiro|cobrar|maquin|entrega|pendente|troco|presencial|balc/i.test(payMethodClean) ||
    order.isPrepaid === false ||
    order.prepaid === false;

  const isOnlinePayment = !isExplicitOffline && (
    /pago online|online|prepaid|ifood pago|jotaja pago|jotaj\u00e1 pago|app/i.test(payMethodClean) ||
    order.isPrepaid === true
  );

  let baseMethodName = payMethodRaw
    .replace(/\s*\([^)]*\)/gi, "")
    .trim();
  if (!baseMethodName || baseMethodName.toUpperCase() === "OTHER") baseMethodName = "Cartao";

  const onlineSource = order.source === "IFOOD" ? "iFood" : order.source === "JOTAJA" ? "JotaJa" : "Online";

  if (isOnlinePayment) {
    res += BOLD_ON + wrapLines("Forma de Pagamento: " + baseMethodName, 2) + BOLD_OFF;
    res += DOUBLE_HEIGHT + wrapLines("(Pago via " + onlineSource + " - NAO COBRAR)", 2) + DOUBLE_OFF;
  } else {
    res += BOLD_ON + wrapLines("Forma de Pagamento: " + baseMethodName, 2) + BOLD_OFF;
    res += DOUBLE_HEIGHT + wrapLines("(COBRAR NA ENTREGA)", 2) + DOUBLE_OFF;

    if (order.changeAmount != null && Number(order.changeAmount) > 0) {
      const changeFor = Number(order.changeAmount);
      const totalVal = Number(order.totalAmount || 0);
      const changeToReturn = Math.max(0, changeFor - totalVal);
      const changeForStr = "R$ " + changeFor.toFixed(2).replace(".", ",");
      const changeToReturnStr = "R$ " + changeToReturn.toFixed(2).replace(".", ",");

      res += DOUBLE_HEIGHT + wrapLines("Troco para: " + changeForStr + " (Levar " + changeToReturnStr + " de troco)", 2) + DOUBLE_OFF;
    }

    res += divider;
    res += DOUBLE_HEIGHT + BOLD_ON + wrapLines("!! COBRAR DO CLIENTE NA ENTREGA: " + totalValStr + " !!", 2) + BOLD_OFF + DOUBLE_OFF;
  }

  // ── QR "PUXAR PEDIDO" ──────────────────────────────────────────────────
  //
  // So sai quando o servidor mandou `qrPuxarUrl` — ele ja decidiu tudo la
  // (entrega da loja, nao-parceira, flag da loja ligada). O QR carrega a URL
  // do app do motoboy com ?p=AAAAMMDD-numero: NADA de segredo no papel, o
  // numero ja esta impresso em corpo dobrado no topo desta mesma comanda.
  //
  // ESC/POS: GS ( k — o comando de QR do padrao Epson, que as POS-58/80
  // genericas seguem. Impressora que NAO conhece o comando simplesmente o
  // ignora (dados de funcao ficam fora do fluxo de texto), e o rodape com o
  // numero digitavel sai do mesmo jeito — o app aceita digitar o numero, entao
  // nenhuma loja fica sem o recurso por causa da impressora. No perfil
  // "legacy" o QR nem e tentado: e o perfil das impressoras que imprimem lixo
  // com comando desconhecido.
  if (order.qrPuxarUrl && profile !== "legacy") {
    const dadosQr = String(order.qrPuxarUrl);
    const len = dadosQr.length + 3;
    const pL = String.fromCharCode(len & 0xff);
    const pH = String.fromCharCode((len >> 8) & 0xff);
    res += LF + CENTER;
    res += GS + "(k" + "\x04\x00" + "\x31\x41" + "\x32\x00";            // modelo 2
    res += GS + "(k" + "\x03\x00" + "\x31\x43" + "\x06";                // modulo 6
    res += GS + "(k" + "\x03\x00" + "\x31\x45" + "\x31";                // correcao M
    res += GS + "(k" + pL + pH + "\x31\x50\x30" + dadosQr;              // dados
    res += GS + "(k" + "\x03\x00" + "\x31\x51\x30";                     // imprime
    res += LF + BOLD_ON + centerLine("MOTOBOY: escaneie para puxar") + BOLD_OFF;
    const codigoCurto = String(order.qrPuxarCodigo || "").split("-").pop() || "";
    if (codigoCurto) {
      res += centerLine("ou digite o numero " + codigoCurto + " no app");
    }
    res += LEFT;
  }

  res += LF + centerLine("Obrigado pela preferencia!") + LEFT + FEED + CUT;
  return Buffer.from(res, "binary");
}

/* ─── Configuração Local & Fila da Nuvem ───────────────────── */
// Config durável em %APPDATA%\FireHub. O config.json vivia em %TEMP%, que a
// limpeza de disco do Windows apaga — e junto ia a calibração de largura.
// Migra sozinho do caminho antigo na primeira execução.
const APP_DIR = path.join(process.env.APPDATA || os.homedir(), "FireHub");
try { if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true }); } catch {}
const CONFIG_FILE = path.join(APP_DIR, "config.json");
const LEGACY_CONFIG_FILE = path.join(tmpDir, "config.json");

const CONFIG_PADRAO = { franchiseeId: "", printer: "", paperWidth: "80mm", printers: [] };
let currentConfig = { ...CONFIG_PADRAO };
for (const arquivo of [CONFIG_FILE, LEGACY_CONFIG_FILE]) {
  if (!fs.existsSync(arquivo)) continue;
  try {
    currentConfig = { ...CONFIG_PADRAO, ...JSON.parse(fs.readFileSync(arquivo, "utf8")) };
    console.log("[Config] 📂 Configuração carregada de", arquivo);
    break;
  } catch {}
}

/* Resolve largura e perfil ESC/POS de UMA impressora, com precedência explícita:
   dica do job (site/nuvem) -> entrada dela em printers[] -> config global -> bobina.
   printers[] vazio NÃO significa "não há impressora": cai no fallback global,
   que é o caso de toda loja que nunca cadastrou impressora na UI. */
/* --- Deteccao automatica de largura --------------------------------------
 * Pergunta ao driver do Windows a AREA IMPRIMIVEL da impressora selecionada.
 * Usa PrintableArea, nao PaperSize: numa 58mm o papel tem 57,9mm mas so
 * 47,9mm sao imprimiveis, e e a area que decide quantas colunas cabem.
 *
 *   203 dpi = 7,992 dots/mm  e a Fonte A ocupa 12 dots por caractere
 *   => colunas = mm * 7,992 / 12 = mm * 2/3
 *
 * O preambulo "safe" emite ESC M 0 (Fonte A), entao a conta e consistente
 * com o que a impressora realmente usa.
 *
 * Medido em hardware real:
 *   POS-80  area 71,9mm -> 47,9 -> 48 colunas
 *   POS-58  area 47,9mm -> 31,9 -> 32 colunas
 *   Bematech MP-4200 em papel estreito: 63mm -> 42 colunas, batendo com a
 *   familia 21/28/42/56 documentada para o modelo.
 * ----------------------------------------------------------------------- */
const COLS_SCRIPT_PATH = path.join(tmpDir, "printwidth.ps1");
fs.writeFileSync(COLS_SCRIPT_PATH, `
param([string]$PrinterName)
try {
  Add-Type -AssemblyName System.Drawing
  $ps = New-Object System.Drawing.Printing.PrinterSettings
  $ps.PrinterName = $PrinterName
  if ($ps.IsValid) { [Math]::Round($ps.DefaultPageSettings.PrintableArea.Width, 2) } else { 0 }
} catch { 0 }
`, "utf-8");

const colunasCache = new Map();

function detectarColunasPeloDriver(printerName) {
  const nome = String(printerName || "").trim();
  if (!nome) return null;
  if (colunasCache.has(nome)) return colunasCache.get(nome);

  let colunas = null;
  try {
    const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${COLS_SCRIPT_PATH}" -PrinterName "${nome.replace(/"/g, "")}"`;
    const saida = execSync(cmd, { encoding: "utf-8", timeout: 8000, windowsHide: true });
    const centesimos = parseFloat(String(saida).trim().replace(",", "."));
    if (Number.isFinite(centesimos) && centesimos > 0) {
      const mm = centesimos * 0.254;          // centesimos de polegada -> mm
      const c = Math.round(mm * 2 / 3);
      if (c >= 24 && c <= 64) {
        colunas = c;
        console.log(`[Colunas] 📏 ${nome}: area ${mm.toFixed(1)}mm -> ${c} colunas`);
      } else {
        console.log(`[Colunas] ⚠️ ${nome}: ${c} colunas fora da faixa 24-64, ignorado`);
      }
    }
  } catch (e) {
    console.log(`[Colunas] ⚠️ driver de "${nome}" nao respondeu: ${e.message}`);
  }

  colunasCache.set(nome, colunas); // cacheia inclusive o null, para nao repetir
  return colunas;
}

function resolvePrinterProfile(printerName, jobHints) {
  const hints = jobHints || {};
  const doJob = Array.isArray(hints.printerConfig && hints.printerConfig.printers)
    ? hints.printerConfig.printers
    : [];
  const lista = doJob.concat(currentConfig.printers || []);
  const chave = String(printerName || "").toLowerCase().trim();
  const hit = (chave && lista.find(p => String(p.name || "").toLowerCase().trim() === chave))
    || lista[0]
    || {};

  const paperWidth = hints.paperWidth || hit.paperWidth || currentConfig.paperWidth || "80mm";
  const bruto = Number(hints.columns != null ? hints.columns : hit.columns);
  // Prioridade: (1) colunas configuradas na mao, (2) o que o driver do Windows
  // informa, (3) o palpite pelo 58/80. So chega em (3) se o driver nao responder.
  const columns = (Number.isFinite(bruto) && bruto >= 24 && bruto <= 64)
    ? Math.floor(bruto)
    : (detectarColunasPeloDriver(printerName || currentConfig.printer)
       || (paperWidth === "58mm" ? 32 : 48));
  const profile = hints.escposProfile || hit.escposProfile || currentConfig.escposProfile || "safe";
  const copies = Number(hit.copies) > 0 ? Number(hit.copies) : 1;

  return { paperWidth, columns, profile, copies };
}

app.post("/config", (req, res) => {
  const { franchiseeId, printer, paperWidth, printers, escposProfile, domain } = req.body || {};
  if (franchiseeId) currentConfig.franchiseeId = franchiseeId;
  // O host do FireHub, mandado pela tela de Impressoras. Sem ele o Assistente
  // usava um padrão MORTO (firehubfood.com, sem .br) e a fila da nuvem nunca
  // respondeu para ninguém. Só hostname válido entra — nada de URL completa.
  if (typeof domain === "string" && /^[a-z0-9.-]+$/i.test(domain.trim()) && domain.trim().length > 3) {
    currentConfig.domain = domain.trim();
  }
  if (printer) currentConfig.printer = printer;
  if (paperWidth) currentConfig.paperWidth = paperWidth;
  if (escposProfile) currentConfig.escposProfile = escposProfile;
  // Array completo: único jeito de atender Cozinha 80mm + Bar 58mm no mesmo PC.
  if (Array.isArray(printers)) currentConfig.printers = printers;
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
  } catch (e) {
    console.error("[Config] ⚠️ Não foi possível gravar", CONFIG_FILE, "-", e.message);
  }
  console.log("[Config] Configuração atualizada:", currentConfig);
  res.json({ ok: true, config: currentConfig });
});

/* ─── Deduplicação de Impressões (Trava de 2 HORAS anti-duplicidade) ─ */
const printedOrdersCache = new Map();

/**
 * Chaves que identificam "este pedido JA foi impresso".
 *
 * Elas eram montadas so com dados do PEDIDO — id, referencia da plataforma,
 * numero do dia, cliente+valor. O nome da impressora nao entrava em nenhuma.
 *
 * Com DUAS impressoras configuradas, o site manda um POST /print para cada uma
 * (o laco em src/lib/print.ts esta correto, sem break). O primeiro imprimia; o
 * segundo chegava milissegundos depois com o MESMO order.id, caia na trava de
 * 2 horas e era engolido — respondendo ok:true, entao nem erro aparecia. Na
 * pratica a loja configurava Cozinha e Bar e so a Cozinha imprimia, para
 * sempre, sem nenhuma mensagem dizendo por que.
 *
 * Com a impressora na chave, a protecao continua inteira onde ela serve — o
 * mesmo pedido duas vezes na MESMA impressora segue bloqueado — e para de
 * bloquear o que nunca foi duplicata: o mesmo pedido em impressoras
 * diferentes, que e exatamente o que a loja pediu ao cadastrar duas.
 */
function getOrderDeduplicationKeys(order, printerName) {
  if (!order) return [];
  const imp = String(printerName || "").toLowerCase().trim();
  const cleanCustomer = String(order.customerName || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const amount = Number(order.totalAmount || 0).toFixed(2);
  const seq = order.dailyOrderNumber || order.orderSeqNumber || "";

  // A chave cliente+valor SO vale quando o pedido NAO tem identidade propria
  // (importacao manual sem id, payload avulso). Com id/referencia presentes,
  // ela e um falso positivo em serie: o mesmo cliente pedindo DUAS VEZES o
  // mesmo combo em 2h e um pedido novo legitimo — e em cardapio de preco
  // fixo (99Food: 36,99 / 39,99 / 65,00) isso acontece toda noite. Foi
  // flagrado em producao: Vagner pediu 2x o combo de 39,99 e a segunda
  // comanda seria engolida por esta chave.
  const temIdentidade = Boolean(order.id || order.ifoodReference || order.openDeliveryReference || order.openDeliveryOrderId);

  return [
    order.id ? `id_${order.id}` : null,
    order.ifoodReference ? `ifood_${order.ifoodReference}` : null,
    order.openDeliveryReference ? `jotaja_${order.openDeliveryReference}` : null,
    order.openDeliveryOrderId ? `opd_${order.openDeliveryOrderId}` : null,
    // seq_ na mesma condicao: a numeracao REINICIA a meia-noite, e numa loja
    // que vira a madrugada o #1 de ontem as 23h colide com o #1 de hoje as
    // 00h30 — dentro da janela de 2h, a comanda de hoje seria engolida.
    (!temIdentidade && seq) ? `seq_${seq}` : null,
    (!temIdentidade && cleanCustomer && amount && amount !== "0.00") ? `cust_${cleanCustomer}_${amount}` : null
  ]
    .filter(Boolean)
    .map(k => `${imp}::${k}`);
}

function isOrderAlreadyPrinted(order, printerName) {
  if (!order) return false;
  const keys = getOrderDeduplicationKeys(order, printerName);

  const now = Date.now();
  for (const k of keys) {
    const printedAt = printedOrdersCache.get(String(k));
    if (printedAt && (now - printedAt) < 7200000) { // 2 horas de trava anti-duplicidade
      return true;
    }
  }
  return false;
}

function markOrderAsPrinted(order, printerName) {
  if (!order) return;
  const now = Date.now();
  const keys = getOrderDeduplicationKeys(order, printerName);

  for (const k of keys) {
    printedOrdersCache.set(String(k), now);
  }

  if (printedOrdersCache.size > 2000) {
    for (const [k, time] of printedOrdersCache.entries()) {
      if (now - time > 7200000) printedOrdersCache.delete(k);
    }
  }
}

/* ─── Fila Serial de Impressão (FIFO Queue — Evita gargalos, spooler lock e ordem errada) ─ */
const printJobQueue = [];
let isProcessingPrintQueue = false;

async function processPrintQueue() {
  if (isProcessingPrintQueue) return;
  isProcessingPrintQueue = true;

  while (printJobQueue.length > 0) {
    const job = printJobQueue.shift();
    const { printer, order, storeName, copies = 1, paperWidth, columns, escposProfile, force = false, resolve, reject } = job;

    try {
      let targetPrinter = printer || currentConfig.printer;
      if (!targetPrinter) {
        const detected = listPrintersCached();
        if (detected.length > 0) targetPrinter = detected[0].name;
      }
      if (!targetPrinter) {
        reject(new Error("Impressora não especificada e nenhuma detectada"));
        continue;
      }

      // Se for clique manual (force = true), previne duplo-clique acidental nos últimos 5s
      if (force) {
        // A impressora entra aqui pelo mesmo motivo: sem ela, os dois jobs do
        // mesmo pedido saem do navegador em sequencia imediata e o segundo cai
        // sempre dentro dos 5 segundos. O proprio site ja conhecia a armadilha —
        // printTestReceipt usa id `TESTE_${Date.now()}` justamente para dribla-la.
        const impManual = String(targetPrinter || "").toLowerCase().trim();
        const manualKey = `${impManual}::manual_${order?.id || order?.openDeliveryReference || order?.dailyOrderNumber}`;
        const lastManual = printedOrdersCache.get(manualKey);
        if (lastManual && (Date.now() - lastManual) < 5000) {
          console.log(`[PrintServer] ⚠️ Duplo clique manual ignorado no pedido #${order?.dailyOrderNumber || order?.id}.`);
          resolve({ ok: true, duplicated: true, message: "Duplo clique manual ignorado." });
          continue;
        }
        printedOrdersCache.set(manualKey, Date.now());
      } else if (isOrderAlreadyPrinted(order, targetPrinter)) {
        console.log(`[PrintServer] ⚠️ Pedido #${order?.dailyOrderNumber || order?.ifoodReference || order?.openDeliveryReference || order?.id} já impresso nos últimos 120 min. Ignorando duplicação automática.`);
        resolve({ ok: true, duplicated: true, message: "Pedido já impresso recentemente." });
        continue;
      }

      // Largura e perfil resolvidos POR IMPRESSORA (job -> printers[] -> global)
      const perfil = resolvePrinterProfile(targetPrinter, { paperWidth, columns, escposProfile });
      const cols = perfil.columns;
      const data = buildEscPos(order || {}, storeName || "FIREHUB", cols, perfil.profile);

      // Impressora so de bebida num pedido sem bebida nenhuma: nao ha o que
      // imprimir. Marcar como impresso aqui seria pior do que inutil — a
      // trava anti-duplicidade guardaria um pedido que nunca saiu.
      if (!data) {
        console.log(`[PrintServer] Nada de bebida no pedido #${order?.dailyOrderNumber || order?.id}. ${targetPrinter} nao imprime.`);
        resolve({ ok: true, skipped: true, message: "Sem bebidas neste pedido." });
        continue;
      }

      markOrderAsPrinted(order, targetPrinter);

      for (let i = 0; i < copies; i++) {
        await rawPrint(targetPrinter, data);
      }

      // Pausa de 150ms entre impressões para liberar a spooler do Windows com segurança
      await new Promise(r => setTimeout(r, 150));

      resolve({ ok: true, message: `Impresso em ${targetPrinter} (${copies}x - ${cols} cols - perfil ${perfil.profile})` });
    } catch (e) {
      console.error("[PrintServer] Erro ao imprimir job:", e.message);
      reject(e);
    }
  }

  isProcessingPrintQueue = false;
}

function enqueuePrintJob(jobParams) {
  return new Promise((resolve, reject) => {
    printJobQueue.push({ ...jobParams, resolve, reject });
    processPrintQueue();
  });
}

// Polling background da Fila de Impressão na Nuvem (roda a cada 3s)
setInterval(async () => {
  try {
    // Sem loja identificada não há fila: puxar sem franchiseeId traria pedido
    // de outras lojas para esta impressora. O site envia esse id no POST /config.
    if (!currentConfig.franchiseeId) return;

    const fetchFn = globalThis.fetch || (await import("node-fetch")).default;
    const domain = currentConfig.domain || "firehubfood.com.br";
    const url = `https://${domain}/api/store/print-queue?franchiseeId=${encodeURIComponent(currentConfig.franchiseeId)}`;
    const res = await fetchFn(url);
    if (!res.ok) return;
    const data = await res.json();
    const rawJobs = Array.isArray(data.jobs) ? data.jobs : [];
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
    const jobs = rawJobs.filter(j => {
      const orderTime = j.order?.createdAt ? new Date(j.order.createdAt).getTime() : Date.now();
      return orderTime >= sixHoursAgo;
    });
    if (jobs.length > 0) {
      // Ordenação estrita FIFO por número de comanda (ex: #87 antes de #88) e horário
      jobs.sort((a, b) => {
        const seqA = Number(a.order?.dailyOrderNumber || a.order?.orderSeqNumber || 0);
        const seqB = Number(b.order?.dailyOrderNumber || b.order?.orderSeqNumber || 0);
        if (seqA && seqB && seqA !== seqB) return seqA - seqB;
        const timeA = a.order?.createdAt ? new Date(a.order.createdAt).getTime() : 0;
        const timeB = b.order?.createdAt ? new Date(b.order.createdAt).getTime() : 0;
        return timeA - timeB;
      });

      for (const job of jobs) {
        // O SERVIDOR ja decidiu para quem este pedido vai, com as mesmas
        // regras do navegador: qual impressora, com quais itens, e se e uma
        // comanda so de bebida.
        //
        // Antes daqui saia sempre `currentConfig.printer` — a impressora
        // antiga, uma so, sem filtro nenhum. A mesa e o balcao imprimem por
        // esta fila, entao categoria, modulo e 'so bebida' nunca valeram
        // para eles: a comanda de mesa saia inteira na impressora do bar.
        const destinos = Array.isArray(job.destinos) ? job.destinos.filter(d => d && d.printer) : [];

        if (destinos.length === 0) {
          // Loja sem impressora cadastrada, ou servidor antigo que ainda nao
          // manda `destinos`. Comporta-se como sempre se comportou.
          const alvo = currentConfig.printer;
          const perfil = resolvePrinterProfile(alvo, job);
          enqueuePrintJob({
            printer: alvo,
            order: job.order,
            storeName: job.storeName || "FIREHUB",
            copies: perfil.copies,
            paperWidth: perfil.paperWidth,
            columns: perfil.columns,
            escposProfile: perfil.profile,
            force: false
          }).catch(() => {});
          continue;
        }

        for (const destino of destinos) {
          const perfil = resolvePrinterProfile(destino.printer, destino);
          enqueuePrintJob({
            printer: destino.printer,
            // Os itens ja vem filtrados para ESTA impressora, e a marca de
            // so-bebida viaja dentro do pedido porque e la que buildEscPos
            // a le.
            order: {
              ...job.order,
              items: Array.isArray(destino.items) ? destino.items : job.order?.items,
              somenteBebidas: destino.somenteBebidas === true,
            },
            storeName: job.storeName || "FIREHUB",
            copies: Number(destino.copies) > 0 ? Number(destino.copies) : perfil.copies,
            paperWidth: destino.paperWidth || perfil.paperWidth,
            columns: destino.columns || perfil.columns,
            escposProfile: destino.escposProfile || perfil.profile,
            force: false
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    // Erros silenciosos quando offline
  }
}, 3000);

/* ─── Rotas ────────────────────────────────────────────────── */
/**
 * Versão REAL do Assistente que está rodando nesta máquina.
 *
 * O /status devolvia "2.0.0" fixo no código, que não mudava nunca e não
 * correspondia ao package.json. Com isso não havia como saber, olhando de
 * fora, qual build cada loja tem — e as lojas ficaram em versões diferentes
 * sem ninguém perceber, cada uma congelada no dia em que instalou. Foi assim
 * que a mesma comanda saiu com a BEBIDA em preto numa loja e em texto puro
 * na outra.
 */
const VERSAO_ASSISTENTE = (() => {
  try { return require("./package.json").version; } catch { return "desconhecida"; }
})();

app.get("/status", (req, res) => {
  // ?fresh=1 ignora o cache — e o que o botao "Atualizar" da tela manda depois
  // que a loja pluga uma impressora nova e quer ve-la aparecer agora.
  const printers = listPrintersCached(req.query.fresh === "1");
  res.json({
    ok: true,
    app: "FireHub-Thermal-Printer-v2",
    version: VERSAO_ASSISTENTE,
    name: "FireHub Assistente de Impressão",
    printers,
    // Por que a lista veio como veio. So aparece quando ela esta VAZIA, que e o
    // unico caso em que interessa: e a diferenca entre saber qual etapa falhou
    // e ficar adivinhando a quilometros da loja.
    ...(printers.length === 0 ? { printersDiag: diagnosticoImpressoras } : {}),
    config: currentConfig
  });
});
// ?fresh=1 refaz a deteccao ignorando o cache — e o que o botao "Atualizar" da
// tela de Impressoras precisa depois de plugar uma impressora nova.
app.get("/printers", (req, res) => res.json(listPrintersCached(req.query.fresh === "1")));

app.post("/print", async (req, res) => {
  try {
    const { printer, order, storeName, copies = 1, paperWidth, columns, escposProfile, force = false } = req.body;
    const result = await enqueuePrintJob({ printer, order, storeName, copies, paperWidth, columns, escposProfile, force });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/print-raw", async (req, res) => {
  try {
    const { printer, data, copies = 1 } = req.body;
    let targetPrinter = printer || currentConfig.printer;
    if (!targetPrinter) {
      const detected = listPrintersCached();
      if (detected.length > 0) targetPrinter = detected[0].name;
    }
    if (!targetPrinter || !data) return res.status(400).json({ error: "Dados ou impressora faltando" });
    const buf = Buffer.from(data, "base64");
    for (let i = 0; i < copies; i++) await rawPrint(targetPrinter, buf);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/print-test", async (req, res) => {
  try {
    const { printer, storeName, paperWidth, columns, escposProfile } = req.body;
    let targetPrinter = printer || currentConfig.printer;
    if (!targetPrinter) {
      const detected = listPrintersCached();
      if (detected.length > 0) targetPrinter = detected[0].name;
    }
    if (!targetPrinter) return res.status(400).json({ error: "Impressora não especificada" });

    const perfil = resolvePrinterProfile(targetPrinter, { paperWidth, columns, escposProfile });
    const cols = perfil.columns;
    const dummyOrder = {
      id: "TESTE",
      customerName: "Cliente Teste FireHub",
      customerPhone: "(00) 00000-0000",
      customerAddress: "Rua Exemplo, 123 - Centro - Cidade/UF",
      deliveryType: "DELIVERY",
      paymentMethod: "Pix (Online)",
      items: [
        { name: "Item Teste 1 (58mm/80mm)", qty: 1, price: 15.00 },
        { name: "Item Teste 2 Comanda", qty: 2, price: 10.00 },
      ],
      totalAmount: 35.00,
      notes: `Impressão de Teste FireHub (${perfil.paperWidth} / ${cols} colunas)`,
    };
    const data = buildEscPos(dummyOrder, storeName || "FIREHUB TESTE", cols, perfil.profile);
    await rawPrint(targetPrinter, data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── WebSocket Server ─────────────────────────────────────── */
const { WebSocketServer } = require("ws");

function attachWebSocket(httpServer) {
  try {
    const wss = new WebSocketServer({ server: httpServer });
    wss.on("connection", (ws) => {
      console.log("[WebSocket] Cliente conectado");
      ws.send(JSON.stringify({
        type: "status",
        ok: true,
        app: "FireHub-Thermal-Printer-v2",
        printers: listPrintersCached(),
      }));

      ws.on("message", (msg) => {
        try {
          const payload = JSON.parse(msg.toString());
          if (payload.action === "getPrinters" || payload.action === "status") {
            ws.send(JSON.stringify({
              type: "status",
              ok: true,
              app: "FireHub-Thermal-Printer-v2",
              printers: listPrintersCached(),
            }));
          }
        } catch {}
      });
    });
  } catch (err) {
    console.error("[WebSocket] Erro ao iniciar WS:", err);
  }
}

/* ─── Start com fallback de portas (7899, 7900, 7901, 7891) ── */
const PORTS = [7899, 7900, 7901, 7891];
let server;

function startServer(portIndex = 0) {
  if (portIndex >= PORTS.length) {
    console.error("[PrintServer] Erro: Não foi possível vincular a nenhuma porta.");
    return;
  }

  const currentPort = PORTS[portIndex];
  server = app.listen(currentPort, "0.0.0.0", () => {
    console.log("");
    console.log("  🔥 FireHub Assistente de Impressão v2.0 (HTTP + WebSocket)");
    console.log("  ────────────────────────────────────────");
    console.log(`  ✅ Rodando em http://localhost:${currentPort} & ws://localhost:${currentPort}`);
    console.log(`  📋 Impressoras: http://localhost:${currentPort}/printers`);
    console.log("");
    attachWebSocket(server);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(`[PrintServer] Porta ${currentPort} ocupada. Tentando próxima porta...`);
      startServer(portIndex + 1);
    } else {
      console.error("[PrintServer] Erro no servidor de impressão:", err);
    }
  });
}

startServer(0);

/* ─── Atualização automática ───────────────────────────────────────────
 *
 * O Assistente era congelado no dia da instalação: cada correção exigia
 * baixar o instalador de novo, desinstalar e reinstalar — em CADA loja, à
 * mão. Na prática ninguém fazia, e as lojas foram ficando cada uma numa
 * versão (foi assim que a mesma comanda saía diferente em duas lojas).
 *
 * Agora ele se atualiza sozinho: pergunta ao servidor qual é a versão
 * atual (a MESMA constante que a tela de Impressoras usa), e quando existe
 * uma mais nova baixa o instalador oficial do site e o roda em modo
 * silencioso (/S), que reinstala por cima no mesmo lugar e preserva a
 * configuração — ela mora em %APPDATA%\FireHub, fora da pasta do programa.
 * Ao final, religa o próprio executável. Quem estiver com o PC ligado e
 * internet recebe a versão nova em até 6 horas, sem tocar em nada.
 *
 * Guarda-corpos, porque atualização que dá errado é impressora muda:
 *   - download conferido por tamanho (instalador tem ~70MB; resposta de
 *     erro tem bytes) antes de qualquer execução;
 *   - versão que falhou não é tentada de novo por 24h (sem laço de queda);
 *   - FIREHUB_UPDATE_DRY=1 faz tudo menos instalar — é o modo de teste;
 *   - qualquer erro vira log e o Assistente segue imprimindo como está.
 */
const UPDATE_DRY = process.env.FIREHUB_UPDATE_DRY === "1";
const VERSAO_LOCAL_UPDATE = process.env.FIREHUB_FAKE_VERSION || VERSAO_ASSISTENTE;
let atualizacaoEmAndamento = false;
const tentativasDeVersao = new Map(); // versao -> timestamp da última falha

function logUpdate(msg) {
  const linha = `[${new Date().toISOString()}] ${msg}`;
  console.log("[AutoUpdate]", msg);
  try { fs.appendFileSync(path.join(APP_DIR, "update.log"), linha + "\n"); } catch {}
}

function versaoRemotaEhMaisNova(remota, local) {
  const a = String(remota || "").split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(local || "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

async function verificarAtualizacao() {
  if (atualizacaoEmAndamento) return;
  let versaoAlvo = null;
  try {
    const fetchFn = globalThis.fetch || (await import("node-fetch")).default;
    const domain = currentConfig.domain || "firehubfood.com.br";
    const res = await fetchFn(`https://${domain}/api/assistente/versao`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return;
    const info = await res.json();
    if (!info?.versao || !info?.url) return;

    versaoAlvo = info.versao;
    if (!versaoRemotaEhMaisNova(info.versao, VERSAO_LOCAL_UPDATE)) return;

    const ultimaFalha = tentativasDeVersao.get(info.versao) || 0;
    if (Date.now() - ultimaFalha < 24 * 3600_000) return;

    atualizacaoEmAndamento = true;
    logUpdate(`Versão ${info.versao} disponível (local: ${VERSAO_LOCAL_UPDATE}). Baixando ${info.url}`);

    const resExe = await fetchFn(info.url, { signal: AbortSignal.timeout(10 * 60_000) });
    if (!resExe.ok) throw new Error(`download HTTP ${resExe.status}`);
    const buf = Buffer.from(await resExe.arrayBuffer());

    // Instalador de verdade tem dezenas de MB. Uma página de erro tem KB —
    // executar isso seria rodar lixo com cara de .exe.
    if (buf.length < 20 * 1024 * 1024) throw new Error(`download suspeito: só ${buf.length} bytes`);

    const exePath = path.join(APP_DIR, `FireHub-Assistente-Update-${info.versao}.exe`);
    fs.writeFileSync(exePath, buf);
    logUpdate(`Baixado: ${exePath} (${(buf.length / 1048576).toFixed(1)} MB)`);

    if (UPDATE_DRY) {
      logUpdate("FIREHUB_UPDATE_DRY=1 — instalação NÃO executada (modo de teste).");
      atualizacaoEmAndamento = false;
      return;
    }

    // O instalador não sobrescreve arquivos de um programa aberto, então a
    // sequência é: dispara um cmd órfão que espera este processo morrer,
    // instala em silêncio no mesmo lugar (o NSIS lembra o diretório) e
    // religa o executável. A config sobrevive porque mora em %APPDATA%.
    const { spawn } = require("child_process");
    const relancar = process.execPath && /\.exe$/i.test(process.execPath) && !/node\.exe$/i.test(process.execPath)
      ? ` & start "" "${process.execPath}"`
      : "";
    // ~5s antes de instalar (era ~3s): o Assistente precisa ter saido de
    // verdade primeiro, e a saida agora tem uma rede de seguranca que dispara
    // em 3s. Instalar por cima do executavel ainda aberto e o jeito conhecido
    // de deixar a loja sem Assistente nenhum.
    const comando = `ping -n 6 127.0.0.1 >nul & "${exePath}" /S & ping -n 4 127.0.0.1 >nul${relancar}`;
    logUpdate(`Instalando ${info.versao} em silêncio e reiniciando.`);
    const filho = spawn("cmd.exe", ["/c", comando], { detached: true, stdio: "ignore", windowsHide: true });
    filho.unref();

    setTimeout(() => {
      try {
        const { app } = require("electron");
        if (app) {
          // `isQuitting` NAO era marcado aqui, e sem ela o quit simplesmente
          // nao acontece: o main.js segura o fechamento da janela
          // (`if (!app.isQuitting) e.preventDefault()`) para o programa seguir
          // na bandeja. O Assistente continuava de pe e o instalador rodava por
          // cima de um executavel EM USO — que e o momento exato em que uma
          // atualizacao vira impressora muda. O menu "Sair" da bandeja sempre
          // marcou; este caminho tinha ficado para tras.
          app.isQuitting = true;
          app.quit();
          // Rede de seguranca: se ainda assim algo segurar o quit, sai na marra
          // antes de o instalador tocar nos arquivos (ele espera ~5s).
          setTimeout(() => { try { process.exit(0); } catch {} }, 1500);
          return;
        }
      } catch {}
      process.exit(0);
    }, 1500);
  } catch (e) {
    logUpdate(`Falha na atualização: ${e?.message}`);
    // A versão que falhou fica marcada e não é tentada de novo por 24h —
    // sem isso, um instalador corrompido no site viraria download em loop.
    tentativasDeVersao.set(versaoAlvo || "ultima", Date.now());
    atualizacaoEmAndamento = false;
  }
}

// 90s depois de ligar (deixa a impressão subir primeiro) e a cada 6 horas.
setTimeout(verificarAtualizacao, 90_000);
setInterval(verificarAtualizacao, 6 * 3600_000);
