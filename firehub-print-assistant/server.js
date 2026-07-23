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
    fs.writeFileSync(tmpFile, dataBuffer);

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
    .replace(/ç/g, "c");
}

function buildEscPos(order, storeName, columns = 48) {
  const ESC = "\x1B", GS = "\x1D", LF = "\x0A";
  const INIT = ESC + "@";
  const BOLD_ON = ESC + "E\x01" + ESC + "G\x01"; // Negrito + Impressão Dupla (Double-Strike) para letras bem escuras!
  const BOLD_OFF = ESC + "E\x00" + ESC + "G\x00";
  const CENTER = ESC + "a\x01", LEFT = ESC + "a\x00";
  const DOUBLE_HEIGHT = GS + "!\x01";
  const DOUBLE_SIZE = GS + "!\x11";
  const DOUBLE_OFF = GS + "!\x00";
  const CUT = GS + "V\x00", FEED = ESC + "d\x04";

  const divider = "-".repeat(columns) + LF;

  const makeHeaderTitle = (title) => {
    const cleanT = cleanAscii(title).toUpperCase();
    const padLen = Math.max(0, Math.floor((columns - cleanT.length - 2) / 2));
    const dashes = "-".repeat(padLen);
    return dashes + " " + cleanT + " " + dashes + LF;
  };

  const rightAlign = (leftStr, rightStr) => {
    const l = cleanAscii(leftStr);
    const r = cleanAscii(rightStr);
    const sp = Math.max(1, columns - l.length - r.length);
    return l + " ".repeat(sp) + r + LF;
  };

  const makeBoxLine = (l, r) => {
    const cl = cleanAscii(l);
    const cr = cleanAscii(r);
    const innerWidth = Math.max(10, columns - 4);
    const sp = Math.max(1, innerWidth - cl.length - cr.length);
    return "| " + cl + " ".repeat(sp) + cr + " |" + LF;
  };

  const makeBoxText = (text) => {
    const ct = cleanAscii(text);
    const innerWidth = Math.max(10, columns - 4);
    const trimmed = ct.length > innerWidth ? ct.slice(0, innerWidth) : ct;
    const sp = Math.max(0, innerWidth - trimmed.length);
    return "| " + trimmed + " ".repeat(sp) + " |" + LF;
  };

  const boxBorder = "+" + "-".repeat(Math.max(10, columns - 2)) + "+" + LF;

  let res = INIT + ESC + "t\x03"; // Codepage 860 / Portuguese

  // 1. TOP HEADER (Número + Tipo + Tag)
  const seqNumStr = order.dailyOrderNumber || order.orderSeqNumber || (order.id ? order.id.slice(-4) : "");
  const seqTag = seqNumStr ? `${seqNumStr}  ` : "";
  const deliveryTypeTag = order.deliveryType === "DELIVERY" ? "DELIVERY" : "RETIRADA";
  const refTag = order.ifoodReference ? `#${order.ifoodReference}` : order.openDeliveryReference ? `#${order.openDeliveryReference}` : "";
  const headerLine = cleanAscii(`${seqTag}${deliveryTypeTag}  ${refTag}`.trim());

  const isIfoodDriver = order.deliveryBy === "IFOOD";

  res += CENTER + BOLD_ON + DOUBLE_SIZE + headerLine + LF + DOUBLE_OFF + BOLD_OFF;
  if (isIfoodDriver) {
    res += BOLD_ON + DOUBLE_HEIGHT + "*** MOTOBOY IFOOD (ENTREGA PARCEIRA) ***" + LF + "NAO USAR MOTOBOY DA LOJA!" + DOUBLE_OFF + BOLD_OFF + LF;
  }
  res += LEFT + divider;
  res += BOLD_ON + "Estabelecimento: " + cleanAscii(storeName || "HAKIM CENTRO").toUpperCase() + BOLD_OFF + LF;
  if (order.ifoodReference || order.openDeliveryReference || order.id) {
    res += "N. do Pedido: " + cleanAscii(order.ifoodReference || order.openDeliveryReference || order.id) + LF;
  }
  const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
  const timeStr = order.createdAt ? new Date(order.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  if (dateStr) res += "Data: " + dateStr + " " + timeStr + LF;

  // 2. CLIENTE SECTION
  res += LF + BOLD_ON + makeHeaderTitle("CLIENTE") + BOLD_OFF + LF;
  if (order.customerName) res += "Nome: " + cleanAscii(order.customerName) + LF;
  if (order.customerPhone) res += "Telefone: " + cleanAscii(order.customerPhone) + LF;
  res += "Qtd Pedidos: 1" + LF;

  // 3. ENTREGA SECTION
  if (order.deliveryType === "DELIVERY" && order.customerAddress) {
    res += LF + BOLD_ON + makeHeaderTitle("ENTREGA") + BOLD_OFF + LF;
    res += "Endereco: " + cleanAscii(order.customerAddress) + LF;
    if (order.notes && !order.notes.toLowerCase().includes("pedido ifood")) {
      res += "Obs: " + cleanAscii(order.notes) + LF;
    }
  }

  // 4. RESUMO DO PEDIDO SECTION (Inside Boxes!)
  res += LF + BOLD_ON + makeHeaderTitle("RESUMO DO PEDIDO") + BOLD_OFF + LF;

  if (order.items && order.items.length) {
    order.items.forEach(item => {
      const qty = item.qty || item.quantity || 1;
      const price = typeof item.price === "number" ? item.price * qty : 0;
      const priceStr = "R$ " + price.toFixed(2).replace(".", ",");
      const name = cleanAscii(item.name || item.menuProduct?.name || "Item");

      res += boxBorder;
      res += BOLD_ON + makeBoxLine(`Qtd: ${qty}x`, `Valor: ${priceStr}`) + BOLD_OFF;
      res += makeBoxText(name);

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
          const totalQty = (sel.quantity || 1) * qty;
          const qPrefix = totalQty > 1 ? `${totalQty}x ` : "";
          res += makeBoxText(`  - ${qPrefix}${sel.name}`);
        });
      }

      if (item.notes) {
        res += makeBoxText(`  Obs: ${item.notes}`);
      }

      res += boxBorder;
    });
  }

  // 5. TOTALS
  res += LF;
  const subtotal = order.items?.reduce((sum, it) => sum + ((it.price || 0) * (it.qty || it.quantity || 1)), 0) || order.totalAmount || 0;
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

  // TOTAL BOX
  const totalValStr = "R$ " + Number(order.totalAmount || 0).toFixed(2).replace(".", ",");
  res += boxBorder;
  res += BOLD_ON + DOUBLE_HEIGHT + makeBoxLine("Total:", totalValStr) + DOUBLE_OFF + BOLD_OFF;
  res += boxBorder;

  // 6. PAYMENT METHOD & SAFETY NOTE
  if (order.paymentMethod) {
    res += BOLD_ON + "Forma de Pagamento: " + cleanAscii(order.paymentMethod) + BOLD_OFF + LF;
  }

  res += divider;
  const isOnlinePayment = /pix|online|credito \(online\)|cartao \(online\)/i.test(cleanAscii(order.paymentMethod || ""));
  if (isOnlinePayment) {
    res += "Dica de Seguranca: Nao aceite cobrancas extras na entrega. Seu pedido ja esta pago." + LF;
    res += BOLD_ON + "[X] PAGO VIA " + (order.source === "IFOOD" ? "IFOOD" : order.source === "JOTAJA" ? "JOTAJA" : "ONLINE") + " - NAO COBRAR NA ENTREGA" + BOLD_OFF + LF;
  } else {
    res += BOLD_ON + "!! COBRAR DO CLIENTE NA ENTREGA: " + totalValStr + " !!" + BOLD_OFF + LF;
  }

  res += LF + CENTER + "Obrigado pela preferencia!" + LF + FEED + CUT;
  return Buffer.from(res, "binary");
}

/* ─── Configuração Local & Fila da Nuvem ───────────────────── */
const CONFIG_FILE = path.join(tmpDir, "config.json");
let currentConfig = { franchiseeId: "", printer: "", paperWidth: "80mm" };
if (fs.existsSync(CONFIG_FILE)) {
  try { currentConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); } catch {}
}

app.post("/config", (req, res) => {
  const { franchiseeId, printer, paperWidth } = req.body || {};
  if (franchiseeId) currentConfig.franchiseeId = franchiseeId;
  if (printer) currentConfig.printer = printer;
  if (paperWidth) currentConfig.paperWidth = paperWidth;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
  console.log("[Config] Configuração atualizada:", currentConfig);
  res.json({ ok: true, config: currentConfig });
});

// Polling background da Fila de Impressão na Nuvem (roda a cada 3s)
setInterval(async () => {
  try {
    const fetch = (await import("node-fetch")).default || globalThis.fetch;
    const url = currentConfig.franchiseeId
      ? `https://firehubfood.com.br/api/store/print-queue?franchiseeId=${currentConfig.franchiseeId}`
      : `https://firehubfood.com.br/api/store/print-queue?all=true`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    if (jobs.length > 0) {
      for (const job of jobs) {
        const detectedPrinters = listPrinters();
        const targetPrinter = currentConfig.printer || (detectedPrinters[0]?.name);
        if (!targetPrinter) {
          console.warn("[CloudPrint] Nenhum nome de impressora configurado ou detectado");
          continue;
        }
        const cols = (job.paperWidth || currentConfig.paperWidth) === "58mm" ? 32 : 48;
        const escPosData = buildEscPos(job.order || {}, job.storeName || "FIREHUB", cols);
        await rawPrint(targetPrinter, escPosData);
        console.log(`[CloudPrint] ✅ Impresso job ${job.id} na impressora ${targetPrinter}`);
      }
    }
  } catch (err) {
    // Erros silenciosos quando offline
  }
}, 3000);

/* ─── Rotas ────────────────────────────────────────────────── */
app.get("/status", (req, res) => {
  const printers = listPrinters();
  res.json({
    ok: true,
    app: "FireHub-Thermal-Printer-v2",
    version: "2.0.0",
    name: "FireHub Assistente de Impressão",
    printers,
    config: currentConfig
  });
});
app.get("/printers", (req, res) => res.json(listPrinters()));

app.post("/print", async (req, res) => {
  try {
    const { printer, order, storeName, copies = 1, paperWidth = "80mm", columns } = req.body;
    let targetPrinter = printer || currentConfig.printer;
    if (!targetPrinter) {
      const detected = listPrinters();
      if (detected.length > 0) targetPrinter = detected[0].name;
    }
    if (!targetPrinter) return res.status(400).json({ error: "Impressora não especificada e nenhuma detectada" });

    const cols = columns || (paperWidth === "58mm" ? 32 : 48);
    const data = buildEscPos(order || {}, storeName || "FIREHUB", cols);
    for (let i = 0; i < copies; i++) await rawPrint(targetPrinter, data);
    res.json({ ok: true, message: `Impresso em ${targetPrinter} (${copies}x - ${cols} cols)` });
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
    const { printer, storeName, paperWidth = "80mm" } = req.body;
    let targetPrinter = printer || currentConfig.printer;
    if (!targetPrinter) {
      const detected = listPrinters();
      if (detected.length > 0) targetPrinter = detected[0].name;
    }
    if (!targetPrinter) return res.status(400).json({ error: "Impressora não especificada" });

    const cols = paperWidth === "58mm" ? 32 : 48;
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
      notes: `Impressão de Teste FireHub (${paperWidth})`,
    };
    const data = buildEscPos(dummyOrder, storeName || "FIREHUB TESTE", cols);
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
