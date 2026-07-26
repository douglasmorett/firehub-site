export interface ParsedPaymentInfo {
  paymentMethod: string;
  isPrepaid: boolean;
  changeAmount: number | null;
  payMethodClean: string;
}

function priceVal(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'object' && val.value !== undefined) return Number(val.value) || 0;
  return Number(val) || 0;
}

/**
 * Universal payment parser for iFood, JotaJá, PDV, and Website orders.
 * Strictly checks offline vs online payment flags to ensure delivery motoboys
 * ALWAYS know when to collect payment at delivery.
 */
export function parseOrderPaymentInfo(orderData: any, source: 'IFOOD' | 'JOTAJA' | 'PDV' | 'SITE' = 'IFOOD'): ParsedPaymentInfo {
  const paymentsObj = orderData?.payments || {};
  const paymentMethods = paymentsObj.methods ?? (Array.isArray(paymentsObj) ? paymentsObj : []);
  const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];
  const firstPayment = paymentList[0] || {};

  const totalPrepaid = typeof paymentsObj.prepaid === 'number' ? paymentsObj.prepaid : priceVal(paymentsObj.prepaid);
  const totalPending = typeof paymentsObj.pending === 'number' ? paymentsObj.pending : priceVal(paymentsObj.pending);

  // Cash payment & change calculation
  const cashPayment = paymentList.find((p: any) =>
    p.method === 'CASH' || (p.name && p.name.toLowerCase().includes('dinheir'))
  );
  const changeAmount = cashPayment?.changeFor ?? cashPayment?.cash?.changeFor ?? null;

  // STRICT EXPLICIT OFFLINE FLAG:
  // If platform says prepaid is false, or type is OFFLINE / PENDING, or pending amount > 0, or cash payment:
  const isExplicitOffline =
    firstPayment.prepaid === false ||
    firstPayment.type === 'OFFLINE' ||
    firstPayment.type === 'PENDING' ||
    totalPending > 0 ||
    Boolean(cashPayment);

  const isPrepaid = !isExplicitOffline && (
    totalPrepaid > 0 ||
    firstPayment.prepaid === true ||
    firstPayment.type === 'ONLINE' ||
    firstPayment.type === 'PREPAID' ||
    firstPayment.method === 'DIGITAL_WALLET' ||
    firstPayment.method === 'ONLINE' ||
    firstPayment.method === 'IFOOD_PAY'
  );

  const rawName = (firstPayment.name || firstPayment.description || '').toString().trim();
  const rawMethod = (firstPayment.method || '').toString().toUpperCase();

  let baseName = 'Cartão';
  if (cashPayment || rawMethod === 'CASH' || rawMethod.includes('DINHEIR') || rawName.toLowerCase().includes('dinheir')) {
    baseName = 'Dinheiro';
  } else if (rawMethod === 'DEBIT' || rawMethod.includes('DEBITO') || rawName.toLowerCase().includes('débit') || rawName.toLowerCase().includes('debit')) {
    baseName = 'Débito';
  } else if (rawMethod.includes('MEAL_VOUCHER') || rawMethod.includes('FOOD_VOUCHER') || rawMethod.includes('VALE') || rawMethod.includes('VR') || rawMethod.includes('VA') || rawMethod.includes('VOUCHER') || rawName.toLowerCase().includes('vale')) {
    baseName = 'Vale Refeição';
  } else if (rawMethod.includes('CREDIT') || rawMethod.includes('CREDITO') || rawName.toLowerCase().includes('crédit') || rawName.toLowerCase().includes('credit')) {
    baseName = 'Crédito';
  } else if (rawMethod.includes('PIX') || rawName.toLowerCase().includes('pix')) {
    baseName = 'Pix';
  } else if (rawMethod === 'DIGITAL_WALLET' || rawMethod === 'ONLINE' || rawMethod === 'IFOOD_PAY' || rawMethod === 'APP') {
    baseName = source === 'JOTAJA' ? 'JotaJá App' : 'iFood App';
  }

  // Use the exact descriptive name if available (e.g. "Pix qrcode (feito na maquina de cartão)"), otherwise baseName
  let displayMethod = rawName || baseName;
  displayMethod = displayMethod.replace(/\s*\((cobrar na entrega|pago online|online)\)/gi, '').trim();

  let paymentMethod = '';
  if (isPrepaid) {
    paymentMethod = `${displayMethod} (${source === 'JOTAJA' ? 'JotaJá' : 'iFood'} Pago Online)`;
  } else {
    paymentMethod = `${displayMethod} (Cobrar na Entrega)`;
  }

  return {
    paymentMethod,
    isPrepaid,
    changeAmount,
    payMethodClean: displayMethod,
  };
}
