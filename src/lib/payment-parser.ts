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

  const rawMethod = (firstPayment.method || firstPayment.name || '').toString().toUpperCase();

  let baseName = 'Cartão';
  if (cashPayment || rawMethod === 'CASH' || rawMethod.includes('DINHEIR')) {
    baseName = 'Dinheiro';
  } else if (rawMethod === 'DEBIT' || rawMethod.includes('DEBITO')) {
    baseName = 'Débito';
  } else if (rawMethod.includes('MEAL_VOUCHER') || rawMethod.includes('FOOD_VOUCHER') || rawMethod.includes('VALE') || rawMethod.includes('VR') || rawMethod.includes('VA') || rawMethod.includes('VOUCHER')) {
    baseName = 'Vale Refeição';
  } else if (rawMethod.includes('CREDIT') || rawMethod.includes('CREDITO')) {
    baseName = 'Crédito';
  } else if (rawMethod === 'PIX') {
    baseName = 'Pix';
  } else if (rawMethod === 'DIGITAL_WALLET' || rawMethod === 'ONLINE' || rawMethod === 'IFOOD_PAY' || rawMethod === 'APP') {
    baseName = source === 'JOTAJA' ? 'JotaJá App' : 'iFood App';
  }

  let paymentMethod = '';
  if (isPrepaid) {
    paymentMethod = `${baseName} (${source === 'JOTAJA' ? 'JotaJá' : 'iFood'} Pago Online)`;
  } else {
    paymentMethod = `${baseName} (Cobrar na Entrega)`;
  }

  return {
    paymentMethod,
    isPrepaid,
    changeAmount,
    payMethodClean: baseName,
  };
}
