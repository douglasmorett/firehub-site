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

/**
 * Lista impressoras reais instaladas no Windows (Registry -> PowerShell UTF-8 -> WMI -> Plain Text)
 */
function listPrinters() {
  const list = [];

  // 0. REGISTRY WINDOWS PRINTERPORTS (Ultra-rápido, 2ms, 100% confiável no Windows sem depender de PowerShell)
  try {
    const raw = execSync('reg query "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\PrinterPorts"', { encoding: "utf-8", timeout: 4000 });
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("HKEY_")) continue;
      const parts = trimmed.split(/\s{2,}/);
      if (parts.length >= 2) {
        const name = parts[0].trim();
        if (name) list.push({ name, driver: "", port: "", status: "online" });
      }
    }
  } catch (e0) {}

  if (list.length > 0) return dedupePrinters(list);

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
  } catch (e1) {}

  if (list.length > 0) return dedupePrinters(list);

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
  } catch (e2) {}

  if (list.length > 0) return dedupePrinters(list);

  // 3. Fallback super simples em Texto Puro (uma linha por impressora)
  try {
    const cmd = `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; (Get-Printer).Name"`;
    const raw = execSync(cmd, { encoding: "utf-8", timeout: 6000 });
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const name of lines) {
      list.push({ name, driver: "", port: "", status: "online" });
    }
  } catch (e3) {}

  return dedupePrinters(list);
}

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

  const dByStr = (order.deliveryBy || order.deliveredBy || "").toString().toUpperCase();
  const srcStr = (order.source || "").toString().toUpperCase();
  const odChannelStr = (order.openDeliveryChannel || "").toString().toUpperCase();

  const is99FoodDriver = (
    srcStr === "99FOOD" ||
    odChannelStr === "99FOOD" ||
    dByStr === "99FOOD" ||
    dByStr.includes("99")
  ) && (
    dByStr === "99FOOD" ||
    dByStr.includes("99") ||
    dByStr === "LOGISTICS" ||
    dByStr === "PARTNER" ||
    Boolean(order.ifoodPickupCode) ||
    Boolean(order.openDeliveryPickupCode)
  );

  const isIfoodDriver = (
    srcStr === "IFOOD" ||
    dByStr === "IFOOD" ||
    dByStr.includes("IFOOD")
  ) && (
    dByStr === "IFOOD" ||
    dByStr.includes("IFOOD") ||
    dByStr === "LOGISTICS" ||
    dByStr === "PARTNER" ||
    Boolean(order.ifoodPickupCode)
  );

  const isPartnerDriver = is99FoodDriver || isIfoodDriver || (
    (dByStr === "LOGISTICS" || dByStr === "PARTNER") && dByStr !== "MERCHANT"
  );

  const partnerLabel = is99FoodDriver ? "99FOOD" : (isIfoodDriver ? "IFOOD" : (srcStr || "PARCEIRO"));
  const pCode = order.ifoodPickupCode || order.openDeliveryPickupCode || "";

  res += DOUBLE_HEIGHT + BOLD_ON + centerLine(headerLine) + BOLD_OFF + DOUBLE_OFF;
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
      try {
        const parsed = typeof item.comboSelections === "string" ? JSON.parse(item.comboSelections) : item.comboSelections;
        if (Array.isArray(parsed) && parsed.length > 0) {
          const comboSum = parsed.reduce((acc, s) => acc + ((s.price || s.unitPrice || s.addition || 0) * (s.quantity || 1)), 0);
          if (comboSum > 0) return comboSum;
        }
      } catch {}
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
    if (item.comboSelections) {
      try {
        const parsed = typeof item.comboSelections === "string" ? JSON.parse(item.comboSelections) : item.comboSelections;
        if (Array.isArray(parsed) && parsed.some(s => isBeverageName(s.name))) return true;
      } catch {}
    }
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

      let escolhas = [];
      try {
        const parsed = typeof item.comboSelections === "string" ? JSON.parse(item.comboSelections) : item.comboSelections;
        if (Array.isArray(parsed)) escolhas = parsed.filter(s => s && s.name && isBeverageName(s.name));
      } catch {}

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

      const isItemBev = isBeverageItem(item);
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

      const comboSels = (() => {
        if (!item.comboSelections) return [];
        try {
          const parsed = typeof item.comboSelections === "string" ? JSON.parse(item.comboSelections) : item.comboSelections;
          if (Array.isArray(parsed)) return parsed.filter((s) => s.name);
          return [];
        } catch { return []; }
      })();

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
  const { franchiseeId, printer, paperWidth, printers, escposProfile } = req.body || {};
  if (franchiseeId) currentConfig.franchiseeId = franchiseeId;
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

  return [
    order.id ? `id_${order.id}` : null,
    order.ifoodReference ? `ifood_${order.ifoodReference}` : null,
    order.openDeliveryReference ? `jotaja_${order.openDeliveryReference}` : null,
    order.openDeliveryOrderId ? `opd_${order.openDeliveryOrderId}` : null,
    seq ? `seq_${seq}` : null,
    (cleanCustomer && amount && amount !== "0.00") ? `cust_${cleanCustomer}_${amount}` : null
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
        const detected = listPrinters();
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
    const domain = currentConfig.domain || "firehubfood.com";
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
  const printers = listPrinters();
  res.json({
    ok: true,
    app: "FireHub-Thermal-Printer-v2",
    version: VERSAO_ASSISTENTE,
    name: "FireHub Assistente de Impressão",
    printers,
    config: currentConfig
  });
});
app.get("/printers", (req, res) => res.json(listPrinters()));

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
      const detected = listPrinters();
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
      const detected = listPrinters();
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
        printers: listPrinters(),
      }));

      ws.on("message", (msg) => {
        try {
          const payload = JSON.parse(msg.toString());
          if (payload.action === "getPrinters" || payload.action === "status") {
            ws.send(JSON.stringify({
              type: "status",
              ok: true,
              app: "FireHub-Thermal-Printer-v2",
              printers: listPrinters(),
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
