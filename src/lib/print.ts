/* ─────────────────────────────────────────────────────────────
   FireHub Print Engine
   Usa QZ Tray para impressão automática em impressoras térmicas
   ───────────────────────────────────────────────────────────── */

declare global { interface Window { qz: any } }

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

/* ─── Garante conexão QZ ─────────────────────────────────── */
async function ensureQZ(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!window.qz) return false;
  try {
    if (!window.qz.websocket.isActive()) {
      await window.qz.websocket.connect({
        host: "localhost",
        port: { secure: [8182], insecure: [8181] },
        retries: 2,
      });
    }
    return true;
  } catch {
    return false;
  }
}

/* ─── Gera conteúdo ESC/POS para impressora térmica 80mm ─── */
function buildReceiptESCPOS(order: PrintOrder, storeName: string): string[] {
  const line = (text: string) => `${text}\n`;
  const divider = () => `${"─".repeat(32)}\n`;
  const center = (text: string) => {
    const pad = Math.max(0, Math.floor((32 - text.length) / 2));
    return " ".repeat(pad) + text + "\n";
  };
  const right = (left: string, right: string) => {
    const space = Math.max(1, 32 - left.length - right.length);
    return left + " ".repeat(space) + right + "\n";
  };

  const lines: string[] = [];
  const time = new Date().toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });

  lines.push(center(storeName.toUpperCase()));
  lines.push(center(`FireHub — ${time}`));
  lines.push(divider());
  lines.push(center(`PEDIDO #${order.id.slice(-6).toUpperCase()}`));
  lines.push(center(order.deliveryType === "DELIVERY" ? "🛵 DELIVERY" : "🏪 RETIRADA"));
  lines.push(divider());
  lines.push(line(`Cliente: ${order.customerName}`));
  if (order.customerPhone) lines.push(line(`Tel: ${order.customerPhone}`));
  if (order.deliveryType === "DELIVERY" && order.customerAddress) {
    lines.push(line(`End: ${order.customerAddress}`));
  }
  lines.push(divider());

  // Itens
  order.items.forEach(item => {
    lines.push(right(`${item.qty}x ${item.name}`, `R$${(item.price * item.qty).toFixed(2)}`));
    if (item.notes) lines.push(line(`   ↳ ${item.notes}`));
  });

  lines.push(divider());
  if (order.deliveryFee && order.deliveryFee > 0) {
    lines.push(right("Taxa de entrega:", `R$${order.deliveryFee.toFixed(2)}`));
  }
  lines.push(right("TOTAL:", `R$${order.totalAmount.toFixed(2)}`));
  lines.push(right("Pagamento:", order.paymentMethod));
  if (order.notes) {
    lines.push(divider());
    lines.push(line(`OBS: ${order.notes}`));
  }
  lines.push(divider());
  lines.push(center("obrigado pela preferencia!"));
  lines.push("\n\n\n"); // feed de papel

  return lines;
}

/* ─── Imprime em uma impressora específica ───────────────── */
async function printToDevice(
  printerName: string,
  content: string[],
  copies = 1
): Promise<boolean> {
  try {
    const ok = await ensureQZ();
    if (!ok) return false;

    const config = window.qz.configs.create(printerName, {
      copies,
      encoding: "Cp1252",
    });

    const data = content.map(line => ({ type: "raw", format: "plain", data: line }));
    await window.qz.print(config, data);
    return true;
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

  const ok = await ensureQZ();
  if (!ok) return { success: false, printed: 0 };

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
    const content = buildReceiptESCPOS(filteredOrder, storeName);
    const result = await printToDevice(printer.name, content, printer.copies);
    if (result) printed++;
  }

  return { success: printed > 0, printed };
}

/* ─── Comanda de teste ───────────────────────────────────── */
export async function printTestReceipt(
  printerName: string,
  storeName: string,
  copies = 1
): Promise<boolean> {
  const testOrder: PrintOrder = {
    id: "TEST001",
    customerName: "Cliente Teste",
    customerPhone: "(11) 99999-9999",
    customerAddress: "Rua Exemplo, 123",
    deliveryType: "DELIVERY",
    paymentMethod: "PIX",
    items: [
      { name: "X-Burguer Duplo", qty: 2, price: 28.90 },
      { name: "Coca-Cola 600ml", qty: 1, price: 8.00 },
    ],
    totalAmount: 65.80,
    deliveryFee: 5.00,
    notes: "Sem cebola no burguer",
  };

  const content = buildReceiptESCPOS(testOrder, storeName);
  return printToDevice(printerName, content, copies);
}
