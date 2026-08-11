/* ─────────────────────────────────────────────────────────────
   FireHub Print Engine
   Usa o Assistente FireHub (localhost:7891) para impressão
   ───────────────────────────────────────────────────────────── */

const ASSISTANT_URLS = [
  "http://localhost:7899", "http://127.0.0.1:7899",
  "http://localhost:7900", "http://127.0.0.1:7900",
  "http://localhost:7901", "http://127.0.0.1:7901",
  "http://localhost:7891", "http://127.0.0.1:7891",
];

type OrderItem = { name: string; qty: number; price: number; notes?: string };

type PrintOrder = {
  id: string;
  customerName: string;
  customerPhone?: string;
  customerAddress?: string;
  deliveryType: "DELIVERY" | "RETIRADA";
  paymentMethod: string;
  items: OrderItem[];
  totalAmount: number;
  deliveryFee?: number;
  notes?: string;
  createdAt?: string;
};

type PrinterEntry = {
  id: string;
  name: string;
  label: string;
  categories: string[];
  copies: number;
  paperWidth?: "58mm" | "80mm";
};

type PrinterConfig = {
  autoprint: boolean;
  printers: PrinterEntry[];
};

/* ─── Tenta obter URL ativa do assistente (localhost ou 127.0.0.1) ── */
async function getAssistantUrl(): Promise<string | null> {
  for (const url of ASSISTANT_URLS) {
    try {
      const res = await fetch(`${url}/status`, { signal: AbortSignal.timeout(2000) });
      const data = await res.json();
      if (data.ok) return url;
    } catch {}
  }
  return null;
}

/* ─── Verifica se o assistente está rodando ──────────────── */
async function isAssistantRunning(): Promise<boolean> {
  const activeUrl = await getAssistantUrl();
  return activeUrl !== null;
}

/* ─── Imprime em uma impressora específica ───────────────── */
async function printToDevice(
  printerName: string,
  order: PrintOrder,
  storeName: string,
  copies = 1,
  paperWidth = "80mm",
  force = false,
  printerConfig?: PrinterConfig
): Promise<boolean> {
  try {
    const baseUrl = await getAssistantUrl();
    if (!baseUrl) return false;

    let targetPrinter = printerName;
    if (!targetPrinter) {
      const printers = await fetch(`${baseUrl}/printers`).then(r => r.json()).catch(() => []);
      if (Array.isArray(printers) && printers.length > 0) {
        targetPrinter = printers[0].name;
      }
    }
    if (!targetPrinter) return false;

    const res = await fetch(`${baseUrl}/print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        printer: targetPrinter,
        paperWidth,
        force,
        printerConfig: {
          autoBeverageTag: (printerConfig as any)?.autoBeverageTag !== false,
          customBeverageKeywords: (printerConfig as any)?.customBeverageKeywords || "",
        },
        order: {
          id: order.id,
          dailyOrderNumber: (order as any).dailyOrderNumber,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          customerAddress: order.customerAddress,
          deliveryType: order.deliveryType,
          paymentMethod: order.paymentMethod,
          items: order.items.map(i => ({ name: i.name, qty: i.qty, price: i.price, notes: i.notes, comboSelections: (i as any).comboSelections })),
          totalAmount: order.totalAmount,
          deliveryFee: order.deliveryFee,
          discountTotal: (order as any).discountTotal,
          discountIfood: (order as any).discountIfood,
          discountMerchant: (order as any).discountMerchant,
          changeAmount: (order as any).changeAmount,
          ifoodReference: (order as any).ifoodReference,
          ifoodPickupCode: (order as any).ifoodPickupCode,
          openDeliveryReference: (order as any).openDeliveryReference,
          source: (order as any).source,
          notes: order.notes,
          createdAt: order.createdAt,
          printerConfig: {
            autoBeverageTag: (printerConfig as any)?.autoBeverageTag !== false,
            customBeverageKeywords: (printerConfig as any)?.customBeverageKeywords || "",
          },
        },
        storeName,
        copies,
      }),
    });
    const data = await res.json();
    return data.ok === true;
  } catch (err) {
    console.error("[FireHub Print]", err);
    return false;
  }
}

/* ─── Função principal: imprime o pedido roteando por categoria ─ */
export async function printOrder(
  order: PrintOrder,
  storeName: string,
  printerConfig: PrinterConfig,
  itemCategories: Record<string, string> = {}, // { "item name" => "categoria" }
  force = false
): Promise<{ success: boolean; printed: number; attempted: boolean }> {
  const baseUrl = await getAssistantUrl();
  if (!baseUrl) return { success: false, printed: 0, attempted: false };

  let printersToUse = printerConfig?.printers || [];
  if (!printersToUse.length || printersToUse.every(p => !p.name)) {
    const detected = await fetch(`${baseUrl}/printers`).then(r => r.json()).catch(() => []);
    if (Array.isArray(detected) && detected.length > 0) {
      printersToUse = [{
        id: "detected",
        name: detected[0].name,
        label: "Impressora Padrão",
        categories: [],
        copies: 1,
        paperWidth: "80mm"
      }];
    }
  }

  if (!printersToUse.length) return { success: false, printed: 0, attempted: true };

  // Deduplica impressoras para a mesma impressora física não receber o pedido 2x
  const uniquePrinters: PrinterEntry[] = [];
  const seenPrinterNames = new Set<string>();
  for (const p of printersToUse) {
    const key = (p.name || "").toLowerCase().trim();
    if (key && !seenPrinterNames.has(key)) {
      seenPrinterNames.add(key);
      uniquePrinters.push(p);
    }
  }

  let printed = 0;

  for (const printer of uniquePrinters) {
    if (!printer.name) continue;

    // Filtra itens por categoria se configurado
    let itemsToPrint = order.items;
    if (printer.categories && printer.categories.length > 0) {
      const matchesChannel = printer.categories.some(c => {
        const cLower = c.toLowerCase().trim();
        const srcLower = (order as any).source?.toLowerCase()?.trim() || "";
        return cLower === srcLower || (cLower === "ifood" && srcLower === "ifood") || (cLower === "jotaja" && srcLower === "jotaja") || (cLower === "jotajá" && srcLower === "jotaja");
      });

      if (!matchesChannel) {
        itemsToPrint = order.items.filter(item => {
          const cat = (itemCategories[item.name] || (item as any).category || "").toLowerCase().trim();
          return printer.categories.some(c => c.toLowerCase().trim() === cat);
        });
      }

      // Se nenhum item foi filtrado (ex: nome da categoria sutilmente diferente), imprime tudo para não perder o pedido!
      if (itemsToPrint.length === 0) {
        itemsToPrint = order.items;
      }
    }

    const filteredOrder = { ...order, items: itemsToPrint };
    const result = await printToDevice(printer.name, filteredOrder, storeName, printer.copies || 1, printer.paperWidth || "80mm", force, printerConfig);
    if (result) printed++;
  }

  return { success: printed > 0, printed, attempted: true };
}

/* ─── Comanda de teste ───────────────────────────────────── */
export async function printTestReceipt(
  printerName: string,
  storeName: string,
  paperWidth: "58mm" | "80mm" = "80mm"
): Promise<boolean> {
  try {
    const baseUrl = await getAssistantUrl();
    if (!baseUrl) return false;
    const res = await fetch(`${baseUrl}/print-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printer: printerName, storeName, paperWidth }),
    });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}
