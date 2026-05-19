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

/* ─── ESC/POS control codes ──────────────────────────────── */
const ESC = '\x1B';
const GS  = '\x1D';
const LF  = '\x0A';

const CMD = {
  INIT:        ESC + '@',           // Inicializa impressora
  BOLD_ON:     ESC + 'E' + '\x01',  // Negrito ON
  BOLD_OFF:    ESC + 'E' + '\x00',  // Negrito OFF
  CENTER:      ESC + 'a' + '\x01',  // Alinhar centro
  LEFT:        ESC + 'a' + '\x00',  // Alinhar esquerda
  DOUBLE_ON:   GS  + '!' + '\x11',  // Texto duplo (largura+altura)
  DOUBLE_OFF:  GS  + '!' + '\x00',  // Texto normal
  CUT:         GS  + 'V' + '\x00',  // Cortar papel (full cut)
  FEED3:       ESC + 'd' + '\x03',  // Avança 3 linhas
};

const SEP = '--------------------------------' + LF;

/* ─── Gera conteúdo ESC/POS para impressora térmica ──────── */
function buildReceiptESCPOS(order: PrintOrder, storeName: string): string {
  const rightAlign = (left: string, right: string) => {
    const space = Math.max(1, 32 - left.length - right.length);
    return left + ' '.repeat(space) + right + LF;
  };

  const time = new Date().toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });

  let r = '';
  r += CMD.INIT;

  // Cabeçalho centralizado em destaque
  r += CMD.CENTER + CMD.DOUBLE_ON + CMD.BOLD_ON;
  r += storeName.toUpperCase() + LF;
  r += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  r += 'FireHub - ' + time + LF;
  r += SEP;

  // Número do pedido em destaque
  r += CMD.CENTER + CMD.DOUBLE_ON + CMD.BOLD_ON;
  r += 'PEDIDO #' + order.id.slice(-6).toUpperCase() + LF;
  r += CMD.DOUBLE_OFF + CMD.BOLD_OFF;
  r += (order.deliveryType === "DELIVERY" ? ">> DELIVERY <<" : ">> RETIRADA <<") + LF;
  r += SEP;

  // Dados do cliente (alinhado à esquerda)
  r += CMD.LEFT;
  r += 'Cliente: ' + order.customerName + LF;
  if (order.customerPhone) r += 'Tel: ' + order.customerPhone + LF;
  if (order.deliveryType === "DELIVERY" && order.customerAddress) {
    r += 'End: ' + order.customerAddress + LF;
  }
  r += SEP;

  // Itens
  r += CMD.BOLD_ON;
  r += rightAlign('Item', 'Valor');
  r += CMD.BOLD_OFF;
  order.items.forEach(item => {
    r += rightAlign(item.qty + 'x ' + item.name, 'R$' + (item.price * item.qty).toFixed(2));
    if (item.notes) r += '   > ' + item.notes + LF;
  });

  r += SEP;
  if (order.deliveryFee && order.deliveryFee > 0) {
    r += rightAlign('Taxa de entrega:', 'R$' + order.deliveryFee.toFixed(2));
  }

  // Total em destaque
  r += CMD.CENTER + CMD.DOUBLE_ON + CMD.BOLD_ON;
  r += 'TOTAL: R$' + order.totalAmount.toFixed(2) + LF;
  r += CMD.DOUBLE_OFF + CMD.BOLD_OFF;

  r += CMD.LEFT;
  r += rightAlign('Pagamento:', order.paymentMethod);

  if (order.notes) {
    r += SEP;
    r += 'OBS: ' + order.notes + LF;
  }

  r += SEP;
  r += CMD.CENTER;
  r += 'Obrigado pela preferencia!' + LF;
  r += CMD.FEED3;
  r += CMD.CUT;

  return r;
}

/* ─── Imprime em uma impressora específica ───────────────── */
async function printToDevice(
  printerName: string,
  content: string,
  copies = 1
): Promise<boolean> {
  try {
    const ok = await ensureQZ();
    if (!ok) return false;

    const config = window.qz.configs.create(printerName);

    for (let i = 0; i < copies; i++) {
      await window.qz.print(config, [{ type: "raw", format: "plain", data: content }]);
    }
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
