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
    IntPtr h;
    if (!OpenPrinter(name, out h, IntPtr.Zero)) return false;
    var di = new DOCINFOA { pDocName="FireHub", pDataType="RAW" };
    StartDocPrinter(h, 1, ref di);
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
$ok = [RawPrint]::Send($PrinterName, $bytes)
if (-not $ok) { throw "Falha ao enviar dados para impressora" }
Write-Output "OK"
`, "utf-8");

/**
 * Lista impressoras do Windows via PowerShell
 */
function listPrinters() {
  try {
    const cmd = `powershell -NoProfile -Command "Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus | ConvertTo-Json"`;
    const raw = execSync(cmd, { encoding: "utf-8", timeout: 10000 });
    const parsed = JSON.parse(raw);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map((p) => ({
      name: p.Name,
      driver: p.DriverName || "",
      port: p.PortName || "",
      status: p.PrinterStatus === 0 ? "online" : "offline",
    }));
  } catch (e) {
    console.error("[Printers] Erro ao listar:", e.message);
    return [];
  }
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
function buildEscPos(order, storeName, columns = 48) {
  const ESC = "\x1B", GS = "\x1D", LF = "\x0A";
  const INIT = ESC+"@", BOLD_ON = ESC+"E\x01", BOLD_OFF = ESC+"E\x00";
  const CENTER = ESC+"a\x01", LEFT = ESC+"a\x00";
  const DOUBLE_ON = GS+"!\x11", DOUBLE_OFF = GS+"!\x00";
  const CUT = GS+"V\x00", FEED = ESC+"d\x04";
  const SEP = "-".repeat(columns) + LF;

  const rightAlign = (l, r) => {
    const sp = Math.max(1, columns - l.length - r.length);
    return l + " ".repeat(sp) + r + LF;
  };

  let r = INIT;
  r += CENTER + DOUBLE_ON + BOLD_ON + (storeName || "FIREHUB").toUpperCase() + LF;
  r += DOUBLE_OFF + BOLD_OFF + SEP;
  if (order.id) {
    r += CENTER + DOUBLE_ON + BOLD_ON;
    r += "PEDIDO #" + (order.id || "").toString().slice(-6).toUpperCase() + LF;
    r += DOUBLE_OFF + BOLD_OFF;
  }
  if (order.deliveryType) {
    r += CENTER + (order.deliveryType === "DELIVERY" ? ">> DELIVERY <<" : ">> RETIRADA <<") + LF;
  }
  r += SEP + LEFT;
  if (order.customerName) r += "Cliente: " + order.customerName + LF;
  if (order.customerPhone) r += "Tel: " + order.customerPhone + LF;
  if (order.customerAddress) r += "End: " + order.customerAddress + LF;
  r += SEP;
  if (order.items && order.items.length) {
    r += BOLD_ON + rightAlign("Item", "Valor") + BOLD_OFF;
    order.items.forEach(item => {
      const price = typeof item.price === "number" ? item.price * (item.qty || item.quantity || 1) : 0;
      r += rightAlign((item.qty || item.quantity || 1) + "x " + (item.name || ""), "R$" + price.toFixed(2));
      if (item.notes) r += "   > " + item.notes + LF;
    });
    r += SEP;
  }
  if (order.totalAmount !== undefined) {
    r += CENTER + DOUBLE_ON + BOLD_ON;
    r += "TOTAL: R$" + Number(order.totalAmount).toFixed(2) + LF;
    r += DOUBLE_OFF + BOLD_OFF;
  }
  if (order.paymentMethod) r += LEFT + rightAlign("Pagamento:", order.paymentMethod);
  if (order.notes) { r += SEP + LEFT + "OBS: " + order.notes + LF; }
  r += SEP + CENTER + "Obrigado pela preferencia!" + LF + FEED + CUT;
  return Buffer.from(r, "binary");
}

/* ─── Rotas ────────────────────────────────────────────────── */
app.get("/status", (req, res) => {
  res.json({ ok: true, version: "1.0.0", name: "FireHub Assistente de Impressão", printers: listPrinters() });
});
app.get("/printers", (req, res) => res.json(listPrinters()));

app.post("/print", async (req, res) => {
  try {
    const { printer, order, storeName, copies = 1, paperWidth = "80mm", columns } = req.body;
    if (!printer) return res.status(400).json({ error: "Impressora não especificada" });
    const cols = columns || (paperWidth === "58mm" ? 32 : 48);
    const data = buildEscPos(order || {}, storeName || "FIREHUB", cols);
    for (let i = 0; i < copies; i++) await rawPrint(printer, data);
    res.json({ ok: true, message: `Impresso em ${printer} (${copies}x - ${cols} cols)` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/print-raw", async (req, res) => {
  try {
    const { printer, data, copies = 1 } = req.body;
    if (!printer || !data) return res.status(400).json({ error: "Dados faltando" });
    const buf = Buffer.from(data, "base64");
    for (let i = 0; i < copies; i++) await rawPrint(printer, buf);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/print-test", async (req, res) => {
  try {
    const { printer, storeName, paperWidth = "80mm" } = req.body;
    if (!printer) return res.status(400).json({ error: "Impressora não especificada" });
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
    await rawPrint(printer, data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── Start ────────────────────────────────────────────────── */
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("  🔥 FireHub Assistente de Impressão v1.0");
  console.log("  ────────────────────────────────────────");
  console.log(`  ✅ Rodando em http://localhost:${PORT}`);
  console.log(`  📋 Impressoras: http://localhost:${PORT}/printers`);
  console.log("");
  console.log("  Mantenha esta janela aberta para");
  console.log("  impressão automática funcionar.");
  console.log("");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`[PrintServer] Porta ${PORT} já em uso por outro assistente ativo.`);
  } else {
    console.error("[PrintServer] Erro no servidor de impressão:", err);
  }
});
