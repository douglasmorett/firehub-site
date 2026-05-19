/* ─────────────────────────────────────────────────────────────
   FireHub Print Engine
   Usa o Assistente FireHub (localhost:7891) para impressão
   ───────────────────────────────────────────────────────────── */

const ASSISTANT_URL = "http://localhost:7891";

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
};

type PrinterConfig = {
  autoprint: boolean;
  printers: PrinterEntry[];
};

/* ─── Verifica se o assistente está rodando ──────────────── */
async function isAssistantRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${ASSISTANT_URL}/status`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

/* ─── Imprime em uma impressora específica ───────────────── */
async function printToDevice(
  printerName: string,
  order: PrintOrder,
  storeName: string,
  copies = 1
): Promise<boolean> {
  try {
    const res = await fetch(`${ASSISTANT_URL}/print`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        printer: printerName,
        order: {
          id: order.id,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          customerAddress: order.customerAddress,
          deliveryType: order.deliveryType,
          paymentMethod: order.paymentMethod,
          items: order.items.map(i => ({ name: i.name, qty: i.qty, price: i.price, notes: i.notes })),
          totalAmount: order.totalAmount,
          deliveryFee: order.deliveryFee,
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
  if (!printerConfig.printers.length) return { success: false, printed: 0 };

  const running = await isAssistantRunning();
  if (!running) return { success: false, printed: 0 };

  let printed = 0;

  for (const printer of printerConfig.printers) {
    if (!printer.name) continue;

    // Filtra itens por categoria se configurado
    let itemsToPrint = order.items;
    if (printer.categories.length > 0) {
      itemsToPrint = order.items.filter(item => {
        const cat = itemCategories[item.name] || "";
        return printer.categories.includes(cat);
      });
      if (itemsToPrint.length === 0) continue; // pula se nenhum item dessa categoria
    }

    const filteredOrder = { ...order, items: itemsToPrint };
    const result = await printToDevice(printer.name, filteredOrder, storeName, printer.copies);
    if (result) printed++;
  }

  return { success: printed > 0, printed };
}

/* ─── Comanda de teste ───────────────────────────────────── */
export async function printTestReceipt(
  printerName: string,
  storeName: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${ASSISTANT_URL}/print-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ printer: printerName, storeName }),
    });
    const data = await res.json();
    return data.ok === true;
  } catch {
    return false;
  }
}
