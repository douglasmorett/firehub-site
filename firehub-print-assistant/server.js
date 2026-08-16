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
  const BOLD_ON = ESC + "E\x01"; // Negrito padrão ESC/POS (Emphasized)
  const BOLD_OFF = ESC + "E\x00";
  const CENTER = ESC + "a\x01", LEFT = ESC + "a\x00";
  const DOUBLE_HEIGHT = GS + "!\x01";
  const DOUBLE_SIZE = GS + "!\x11";
  const DOUBLE_OFF = GS + "!\x00";
  const CUT = GS + "V\x00", FEED = ESC + "d\x04";

  const divider = "-".repeat(columns) + LF;

  const makeHeaderTitle = (title) => {
    const cleanT = cleanAscii(title).toUpperCase();
    return cleanT + LF;
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
    const sp = Math.max(1, columns - cl.length - cr.length);
    return cl + " ".repeat(sp) + cr + LF;
  };

  const makeBoxText = (text) => {
    const ct = cleanAscii(text);
    const trimmed = ct.length > columns ? ct.slice(0, columns) : ct;
    return trimmed + LF;
  };

  // Separador horizontal sólido entre itens (underscores conectam na impressora térmica)
  const boxBorder = "_".repeat(columns) + LF;

  let res = INIT + ESC + "t\x03"; // Codepage 860 / Portuguese

  // === ATIVAR NEGRITO GLOBAL para toda a comanda (letras mais robustas) ===
  res += BOLD_ON;

  // 1. TOP HEADER (Número + Tipo + Tag)
  const seqNumStr = order.dailyOrderNumber || order.orderSeqNumber || (order.id ? order.id.slice(-4) : "");
  const seqTag = seqNumStr ? `${seqNumStr}  ` : "";
  const deliveryTypeTag = order.deliveryType === "DELIVERY" ? "DELIVERY" : "RETIRADA";
  const orderRef = order.ifoodReference || order.openDeliveryReference || (order.id ? order.id.slice(-6).toUpperCase() : "");
  const refTag = orderRef ? `#${orderRef}` : "";
  const headerLine = cleanAscii(`${seqTag}${deliveryTypeTag}  ${refTag}`.trim());

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

  res += CENTER + DOUBLE_SIZE + headerLine + LF + DOUBLE_OFF;
  if (isPartnerDriver) {
    res += DOUBLE_HEIGHT + `*** MOTOBOY ${partnerLabel} (ENTREGA PARCEIRA) ***` + LF + "NAO USAR MOTOBOY DA LOJA!" + DOUBLE_OFF + LF;
    if (pCode) {
      res += DOUBLE_HEIGHT + `CODIGO DE COLETA: #${pCode}` + DOUBLE_OFF + LF;
    }
  }
  res += LEFT + divider;
  res += "Estabelecimento: " + cleanAscii(storeName || "HAKIM CENTRO").toUpperCase() + LF;
  if (orderRef) {
    res += "N. do Pedido: " + cleanAscii(orderRef) + LF;
  }
  const dateStr = order.createdAt ? new Date(order.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";
  const timeStr = order.createdAt ? new Date(order.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
  if (dateStr) res += "Data: " + dateStr + " " + timeStr + LF;

  // 2. CLIENTE SECTION
  res += LF + CENTER + DOUBLE_HEIGHT + makeHeaderTitle("CLIENTE") + DOUBLE_OFF + LEFT + LF;
  if (order.customerName) res += "Nome: " + cleanAscii(order.customerName) + LF;
  if (order.customerPhone) res += "Telefone: " + cleanAscii(order.customerPhone) + LF;
  res += "Qtd Pedidos: 1" + LF;

  // 3. ENTREGA SECTION
  if (order.deliveryType === "DELIVERY" && order.customerAddress) {
    res += LF + CENTER + DOUBLE_HEIGHT + makeHeaderTitle("ENTREGA") + DOUBLE_OFF + LEFT + LF;
    res += "Endereco: " + cleanAscii(order.customerAddress) + LF;
    if (order.notes) {
      const cleanObs = cleanAscii(order.notes)
        .replace(/Pedido iFood #[A-Z0-9]+/gi, "")
        .replace(/🏷️?\s*Desconto R\$[\d.,]+\s*\([^)]*\)/gi, "")
        .replace(/\|\s*\|/g, "|")
        .replace(/^[\s|]+|[\s|]+$/g, "")
        .trim();
      if (cleanObs) {
        res += "Obs: " + cleanObs + LF;
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

  const INVERSE_ON = "\x1d\x42\x01";
  const INVERSE_OFF = "\x1d\x42\x00";

  const BEV_STAMP = BOLD_ON + " <=== BEBIDA" + BOLD_OFF;

  // 4. RESUMO DO PEDIDO SECTION (Inside Boxes!)
  res += LF + CENTER + DOUBLE_HEIGHT + makeHeaderTitle("RESUMO DO PEDIDO") + DOUBLE_OFF + LEFT + LF;

  if (order.items && order.items.length) {
    res += boxBorder;
    order.items.forEach((item, idx) => {
      const qty = item.qty || item.quantity || 1;
      const unitPrice = getItemEffectivePrice(item, order.items, order.totalAmount, order.deliveryFee || 0, order.discountTotal || 0);
      const price = unitPrice * qty;
      const priceStr = "R$ " + price.toFixed(2).replace(".", ",");
      let name = cleanAscii(item.name || item.menuProduct?.name || "Item");
      name = name.replace(/\s*\[\s*◄\s*BEBIDA\s*►\s*\]/gi, "").replace(/\s*<===\s*BEBIDA/gi, "").trim();

      const isItemBev = isBeverageItem(item);
      const itemLabel = isItemBev ? BOLD_ON + `${name}  <=== BEBIDA` + BOLD_OFF : name;
      res += makeBoxLine(`${qty}x ${itemLabel}`, priceStr);

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
          const selLabel = isSelBev ? BOLD_ON + `${selName}  <=== BEBIDA` + BOLD_OFF : selName;
          res += makeBoxText(`  - ${qPrefix}${selLabel}`);
        });
      }

      if (item.notes) {
        res += makeBoxText(`  Obs: ${item.notes}`);
      }
      res += boxBorder;
    });
  }

  if (hasBeverages) {
    res += CENTER + INVERSE_ON + "  !! ATENCAO: POSSUI BEBIDA NESTE PEDIDO !!  " + INVERSE_OFF + LEFT + LF;
    res += boxBorder;
  }

  // 5. TOTALS
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

  // TOTAL BOX — extra destaque com double-size
  const totalValStr = "R$ " + Number(order.totalAmount || 0).toFixed(2).replace(".", ",");
  res += boxBorder;
  res += DOUBLE_HEIGHT + makeBoxLine("Total:", totalValStr) + DOUBLE_OFF;
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
    res += BOLD_ON + "Forma de Pagamento: " + baseMethodName + BOLD_OFF + LF;
    res += DOUBLE_HEIGHT + "(Pago via " + onlineSource + " - NAO COBRAR)" + DOUBLE_OFF + LF;
  } else {
    res += BOLD_ON + "Forma de Pagamento: " + baseMethodName + BOLD_OFF + LF;
    res += DOUBLE_HEIGHT + "(COBRAR NA ENTREGA)" + DOUBLE_OFF + LF;

    if (order.changeAmount != null && Number(order.changeAmount) > 0) {
      const changeFor = Number(order.changeAmount);
      const totalVal = Number(order.totalAmount || 0);
      const changeToReturn = Math.max(0, changeFor - totalVal);
      const changeForStr = "R$ " + changeFor.toFixed(2).replace(".", ",");
      const changeToReturnStr = "R$ " + changeToReturn.toFixed(2).replace(".", ",");

      res += DOUBLE_HEIGHT + "Troco para: " + changeForStr + " (Levar " + changeToReturnStr + " de troco)" + DOUBLE_OFF + LF;
    }

    res += divider;
    res += DOUBLE_HEIGHT + "!! COBRAR DO CLIENTE NA ENTREGA: " + totalValStr + " !!" + DOUBLE_OFF + LF;
  }

  // Desliga negrito global no final
  res += BOLD_OFF;
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

/* ─── Deduplicação de Impressões (Trava de 2 HORAS anti-duplicidade) ─ */
const printedOrdersCache = new Map();

function getOrderDeduplicationKeys(order) {
  if (!order) return [];
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
  ].filter(Boolean);
}

function isOrderAlreadyPrinted(order) {
  if (!order) return false;
  const keys = getOrderDeduplicationKeys(order);

  const now = Date.now();
  for (const k of keys) {
    const printedAt = printedOrdersCache.get(String(k));
    if (printedAt && (now - printedAt) < 7200000) { // 2 horas de trava anti-duplicidade
      return true;
    }
  }
  return false;
}

function markOrderAsPrinted(order) {
  if (!order) return;
  const now = Date.now();
  const keys = getOrderDeduplicationKeys(order);

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
    const { printer, order, storeName, copies = 1, paperWidth = "80mm", columns, force = false, resolve, reject } = job;

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
        const manualKey = `manual_${order?.id || order?.openDeliveryReference || order?.dailyOrderNumber}`;
        const lastManual = printedOrdersCache.get(manualKey);
        if (lastManual && (Date.now() - lastManual) < 5000) {
          console.log(`[PrintServer] ⚠️ Duplo clique manual ignorado no pedido #${order?.dailyOrderNumber || order?.id}.`);
          resolve({ ok: true, duplicated: true, message: "Duplo clique manual ignorado." });
          continue;
        }
        printedOrdersCache.set(manualKey, Date.now());
      } else if (isOrderAlreadyPrinted(order)) {
        console.log(`[PrintServer] ⚠️ Pedido #${order?.dailyOrderNumber || order?.ifoodReference || order?.openDeliveryReference || order?.id} já impresso nos últimos 120 min. Ignorando duplicação automática.`);
        resolve({ ok: true, duplicated: true, message: "Pedido já impresso recentemente." });
        continue;
      }

      markOrderAsPrinted(order);

      const cols = columns || (paperWidth === "58mm" ? 32 : 48);
      const data = buildEscPos(order || {}, storeName || "FIREHUB", cols);

      for (let i = 0; i < copies; i++) {
        await rawPrint(targetPrinter, data);
      }

      // Pausa de 150ms entre impressões para liberar a spooler do Windows com segurança
      await new Promise(r => setTimeout(r, 150));

      resolve({ ok: true, message: `Impresso em ${targetPrinter} (${copies}x - ${cols} cols)` });
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
    const fetch = (await import("node-fetch")).default || globalThis.fetch;
    const domain = currentConfig.domain || "firehubfood.com";
    const url = currentConfig.franchiseeId
      ? `https://${domain}/api/store/print-queue?franchiseeId=${currentConfig.franchiseeId}`
      : `https://${domain}/api/store/print-queue?all=true`;
    const res = await fetch(url);
    if (!res.ok) return;
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
        enqueuePrintJob({
          printer: currentConfig.printer,
          order: job.order,
          storeName: job.storeName || "FIREHUB",
          copies: 1,
          paperWidth: job.paperWidth || currentConfig.paperWidth,
          force: false
        }).catch(() => {});
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
    const { printer, order, storeName, copies = 1, paperWidth = "80mm", columns, force = false } = req.body;
    const result = await enqueuePrintJob({ printer, order, storeName, copies, paperWidth, columns, force });
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
