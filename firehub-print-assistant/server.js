/**
 * ─────────────────────────────────────────────────────────────
 *  🔥 FireHub Assistente de Impressão
 *  Servidor HTTP local para comunicação com impressoras térmicas
 *  Porta: 7891
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
 * Envia dados RAW para a impressora usando a API do Windows Print Spooler
 * Usa PowerShell + .NET interop para envio raw (mesmo método que QZ Tray usa internamente)
 */
function rawPrint(printerName, dataBuffer) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(tmpDir, `receipt_${Date.now()}.bin`);
    fs.writeFileSync(tmpFile, dataBuffer);

    // PowerShell script que usa a Windows API diretamente para raw printing
    const ps = `
$ErrorActionPreference = 'Stop'
Add-Type @'
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
'@
$bytes = [System.IO.File]::ReadAllBytes('${tmpFile.replace(/\\/g, "\\\\")}')
$ok = [RawPrint]::Send('${printerName.replace(/'/g, "''")}', $bytes)
if (-not $ok) { throw "Falha ao enviar dados para impressora" }
Write-Output "OK"
`;
    exec(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, " ")}"`,
      { timeout: 15000 },
      (err, stdout, stderr) => {
        // Limpa arquivo temporário
        try { fs.unlinkSync(tmpFile); } catch (_) {}

        if (err) {
          console.error("[Print] Erro:", stderr || err.message);
          reject(new Error(stderr || err.message));
        } else {
          console.log("[Print] OK ->", printerName);
          resolve(true);
        }
      }
    );
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
  // Cabeçalho
  r += CENTER + DOUBLE_ON + BOLD_ON + (storeName || "FIREHUB").toUpperCase() + LF;
  r += DOUBLE_OFF + BOLD_OFF;
  r += SEP;
  // Pedido
  if (order.id) {
    r += CENTER + DOUBLE_ON + BOLD_ON;
    r += "PEDIDO #" + (order.id || "").toString().slice(-6).toUpperCase() + LF;
    r += DOUBLE_OFF + BOLD_OFF;
  }
  if (order.deliveryType) {
    r += CENTER + (order.deliveryType === "DELIVERY" ? ">> DELIVERY <<" : ">> RETIRADA <<") + LF;
  }
  r += SEP;
  // Cliente
  r += LEFT;
  if (order.customerName) r += "Cliente: " + order.customerName + LF;
  if (order.customerPhone) r += "Tel: " + order.customerPhone + LF;
  if (order.customerAddress) r += "End: " + order.customerAddress + LF;
  r += SEP;
  // Itens
  if (order.items && order.items.length) {
    r += BOLD_ON + rightAlign("Item", "Valor") + BOLD_OFF;
    order.items.forEach(item => {
      const price = typeof item.price === "number" ? item.price * (item.qty || item.quantity || 1) : 0;
      r += rightAlign((item.qty || item.quantity || 1) + "x " + (item.name || ""), "R$" + price.toFixed(2));
      if (item.notes) r += "   > " + item.notes + LF;
    });
    r += SEP;
  }
  // Total
  if (order.totalAmount !== undefined) {
    r += CENTER + DOUBLE_ON + BOLD_ON;
    r += "TOTAL: R$" + Number(order.totalAmount).toFixed(2) + LF;
    r += DOUBLE_OFF + BOLD_OFF;
  }
  if (order.paymentMethod) {
    r += LEFT + rightAlign("Pagamento:", order.paymentMethod);
  }
  if (order.notes) { r += SEP + LEFT + "OBS: " + order.notes + LF; }
  r += SEP + CENTER + "Obrigado pela preferencia!" + LF;
  r += FEED + CUT;
  return Buffer.from(r, "binary");
}

/* ─── Rotas ────────────────────────────────────────────────── */

// Status + printers
app.get("/status", (req, res) => {
  const printers = listPrinters();
  res.json({
    ok: true,
    version: "1.0.0",
    name: "FireHub Assistente de Impressão",
    printers,
  });
});

app.get("/printers", (req, res) => {
  res.json(listPrinters());
});

// Imprimir comanda formatada
app.post("/print", async (req, res) => {
  try {
    const { printer, order, storeName, copies = 1, columns = 48 } = req.body;
    if (!printer) return res.status(400).json({ error: "Impressora não especificada" });

    const data = buildEscPos(order || {}, storeName || "FIREHUB", columns);
    for (let i = 0; i < copies; i++) {
      await rawPrint(printer, data);
    }
    res.json({ ok: true, message: `Impresso em ${printer} (${copies}x)` });
  } catch (e) {
    console.error("[/print]", e);
    res.status(500).json({ error: e.message });
  }
});

// Imprimir dados raw direto (base64)
app.post("/print-raw", async (req, res) => {
  try {
    const { printer, data, copies = 1 } = req.body;
    if (!printer || !data) return res.status(400).json({ error: "Dados faltando" });

    const buf = Buffer.from(data, "base64");
    for (let i = 0; i < copies; i++) {
      await rawPrint(printer, buf);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Teste de impressão
app.post("/print-test", async (req, res) => {
  try {
    const { printer, storeName = "FIREHUB", columns = 48 } = req.body;
    if (!printer) return res.status(400).json({ error: "Impressora não especificada" });

    const testOrder = {
      id: "TESTE001",
      customerName: "Cliente Teste",
      customerPhone: "(11) 99999-9999",
      deliveryType: "DELIVERY",
      customerAddress: "Rua Exemplo, 123",
      paymentMethod: "PIX",
      items: [
        { name: "X-Burguer Duplo", qty: 2, price: 28.90 },
        { name: "Coca-Cola 600ml", qty: 1, price: 8.00 },
        { name: "Batata Frita Grande", qty: 1, price: 14.50 },
      ],
      totalAmount: 80.30,
      notes: "Sem cebola no burguer",
    };

    const data = buildEscPos(testOrder, storeName, columns);
    await rawPrint(printer, data);
    res.json({ ok: true, message: "Impressão de teste enviada!" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ─── Start ────────────────────────────────────────────────── */
app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("  🔥 FireHub Assistente de Impressão");
  console.log("  ──────────────────────────────────");
  console.log(`  ✅ Rodando em http://localhost:${PORT}`);
  console.log(`  📋 Impressoras: http://localhost:${PORT}/printers`);
  console.log("");
  console.log("  Mantenha esta janela aberta para");
  console.log("  impressão automática funcionar.");
  console.log("");
});
