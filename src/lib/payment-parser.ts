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
 * Universal payment parser for iFood, JotaJá, Brendi, PDV, and Website orders.
 * Strictly checks offline vs online payment flags to ensure delivery motoboys
 * ALWAYS know when to collect payment at delivery.
 *
 * BRENDI usa o mesmo bloco `payments` do Open Delivery (Abrasel) que o JotaJá:
 * methods[] + prepaid/pending. Errar aqui cobra o cliente duas vezes (ou deixa
 * o motoboy sem saber que precisa cobrar) — por isso a decisão online/offline
 * é sempre por flag explícita, nunca por adivinhação.
 */
export function parseOrderPaymentInfo(orderData: any, source: 'IFOOD' | 'JOTAJA' | 'BRENDI' | 'PDV' | 'SITE' = 'IFOOD'): ParsedPaymentInfo {
  const paymentsObj = orderData?.payments || {};
  const paymentMethods = paymentsObj.methods ?? (Array.isArray(paymentsObj) ? paymentsObj : []);
  const paymentList = Array.isArray(paymentMethods) ? paymentMethods : [];
  const listToIterate = paymentList.length > 0 ? paymentList : [{}];

  const totalPrepaid = typeof paymentsObj.prepaid === 'number' ? paymentsObj.prepaid : priceVal(paymentsObj.prepaid);
  const totalPending = typeof paymentsObj.pending === 'number' ? paymentsObj.pending : priceVal(paymentsObj.pending);

  let changeAmountTotal = 0;
  let hasChange = false;

  let anyExplicitOffline = totalPending > 0;
  let anyOnlinePrepaid = totalPrepaid > 0;

  const methodNames: string[] = [];

  for (const payment of listToIterate) {
    const rawName = (payment.name || payment.description || '').toString().trim();
    const rawMethod = (payment.method || '').toString().toUpperCase();
    // A Brendi manda valores em minúsculas ('credit', 'online' — visto na doc
    // da Saipos): sem normalizar a caixa do `type`, o pagamento online dela
    // cairia em "Cobrar na Entrega" e o cliente seria cobrado DUAS vezes.
    // Uppercase aqui não muda a decisão de nenhum canal que já mandava
    // maiúsculo — só deixa de punir quem manda minúsculo.
    const rawType = (payment.type || '').toString().toUpperCase();

    // 'PARTNET_PAYMENT' (sic — typo do próprio contrato, preservado na doc da
    // Saipos) é como a Brendi marca pagamento processado pela PLATAFORMA: é
    // pago online por definição. Aceitamos também a grafia corrigida, para o
    // dia em que consertarem o typo do lado deles.
    const isPartnerPayment = rawMethod === 'PARTNET_PAYMENT' || rawMethod === 'PARTNER_PAYMENT';

    const isCash = rawMethod === 'CASH' || rawMethod.includes('DINHEIR') || rawName.toLowerCase().includes('dinheir');

    // `change` sem sufixo é a variação Open Delivery que a Brendi usa para o
    // troco (JotaJá/iFood usam changeFor) — sem ele o motoboy sai sem troco.
    const pChange = payment.changeFor ?? payment.cash?.changeFor ?? payment.change;
    if (pChange !== undefined && pChange !== null) {
      changeAmountTotal += Number(pChange);
      hasChange = true;
    }

    const pOffline = payment.prepaid === false ||
      rawType === 'OFFLINE' ||
      rawType === 'PENDING' ||
      isCash;

    const pOnline = payment.prepaid === true ||
      rawType === 'ONLINE' ||
      rawType === 'PREPAID' ||
      isPartnerPayment ||
      rawMethod === 'DIGITAL_WALLET' ||
      rawMethod === 'ONLINE' ||
      rawMethod === 'IFOOD_PAY';

    if (pOffline) anyExplicitOffline = true;
    if (pOnline) anyOnlinePrepaid = true;

    let baseName = 'Cartão';
    if (isCash) {
      baseName = 'Dinheiro';
    } else if (rawMethod === 'DEBIT' || rawMethod.includes('DEBITO') || rawName.toLowerCase().includes('débit') || rawName.toLowerCase().includes('debit')) {
      baseName = 'Débito';
    } else if (rawMethod.includes('MEAL_VOUCHER') || rawMethod.includes('FOOD_VOUCHER') || rawMethod.includes('VALE') || rawMethod.includes('VR') || rawMethod.includes('VA') || rawMethod.includes('VOUCHER') || rawName.toLowerCase().includes('vale')) {
      baseName = 'Vale Refeição';
    } else if (rawMethod.includes('CREDIT') || rawMethod.includes('CREDITO') || rawName.toLowerCase().includes('crédit') || rawName.toLowerCase().includes('credit')) {
      baseName = 'Crédito';
    } else if (rawMethod.includes('PIX') || rawName.toLowerCase().includes('pix')) {
      baseName = 'Pix';
    } else if (rawMethod === 'DIGITAL_WALLET' || rawMethod === 'ONLINE' || rawMethod === 'IFOOD_PAY' || rawMethod === 'APP' || isPartnerPayment) {
      baseName = source === 'JOTAJA' ? 'JotaJá App' : source === 'BRENDI' ? 'Brendi App' : 'iFood App';
    }

    let displayMethod = rawName || baseName;
    displayMethod = displayMethod.replace(/\s*\((cobrar na entrega|pago online|online)\)/gi, '').trim();
    if (displayMethod) {
      methodNames.push(displayMethod);
    }
  }

  const isPrepaid = !anyExplicitOffline && anyOnlinePrepaid;

  const uniqueMethods = Array.from(new Set(methodNames));
  const finalMethodString = uniqueMethods.length > 0 ? uniqueMethods.join(' + ') : 'Cartão';

  let paymentMethod = '';
  if (isPrepaid) {
    paymentMethod = `${finalMethodString} (Pago Online)`;
  } else {
    paymentMethod = `${finalMethodString} (Cobrar na Entrega)`;
  }

  const changeAmount = hasChange ? changeAmountTotal : null;

  return {
    paymentMethod,
    isPrepaid,
    changeAmount,
    payMethodClean: finalMethodString,
  };
}
