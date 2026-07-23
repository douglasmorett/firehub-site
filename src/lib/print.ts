/* ─────────────────────────────────────────────────────────────
   FireHub Print Engine
   Usa o Assistente FireHub (localhost:7891) para impressão
   ───────────────────────────────────────────────────────────── */

const ASSISTANT_URLS = ["http://localhost:7891", "http://127.0.0.1:7891"];

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
  paperWidth = "80mm"
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
          ifoodReference: (order as any).ifoodReference,
          openDeliveryReference: (order as any).openDeliveryReference,
          source: (order as any).source,
          notes: order.notes,
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
  itemCategories: Record<string, string> = {} // { "item name" => "categoria" }
): Promise<{ success: boolean; printed: number }> {
  const baseUrl = await getAssistantUrl();
  if (!baseUrl) return { success: false, printed: 0 };

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

  if (!printersToUse.length) return { success: false, printed: 0 };

  let printed = 0;

  for (const printer of printersToUse) {
    if (!printer.name) continue;

    // Filtra itens por categoria se configurado
    let itemsToPrint = order.items;
    if (printer.categories && printer.categories.length > 0) {
      itemsToPrint = order.items.filter(item => {
        const cat = itemCategories[item.name] || "";
        return printer.categories.includes(cat);
      });
      if (itemsToPrint.length === 0) continue;
    }

    const filteredOrder = { ...order, items: itemsToPrint };
    const result = await printToDevice(printer.name, filteredOrder, storeName, printer.copies || 1, printer.paperWidth || "80mm");
    if (result) printed++;
  }

  return { success: printed > 0, printed };
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
