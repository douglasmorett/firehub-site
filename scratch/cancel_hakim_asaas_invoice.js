const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getAsaasKey = () => {
  const b64 = process.env.ASAAS_API_KEY_B64;
  if (b64) {
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf8").trim();
      if (decoded.startsWith("$aact_")) return decoded;
      if (decoded.startsWith("aact_")) return "$" + decoded;
    } catch (e) {}
  }
  const direct = process.env.ASAAS_API_KEY;
  if (direct) {
    const trimmed = direct.trim();
    if (trimmed.startsWith("$aact_")) return trimmed;
    if (trimmed.startsWith("aact_")) return "$" + trimmed;
  }
  return null;
};

async function cancelAsaasPayment(paymentId, key) {
  if (!key || !paymentId) return;
  console.log(`[ASAAS] Cancelando cobrança ${paymentId}...`);
  try {
    const res = await fetch(`https://api.asaas.com/v3/payments/${paymentId}`, {
      method: "DELETE",
      headers: {
        "access_token": key,
        "User-Agent": "hakim-portal/1.0",
        "Content-Type": "application/json"
      }
    });
    const data = await res.json();
    console.log(`[ASAAS] Resposta do cancelamento de ${paymentId}:`, data);
  } catch (err) {
    console.error(`[ASAAS] Erro ao deletar ${paymentId}:`, err);
  }
}

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: 'contatohakim@gmail.com' },
    include: { billingCycles: true }
  });

  if (!user) {
    console.log('Usuário contatohakim@gmail.com não encontrado.');
    return;
  }

  // Set planPercent to 0 on User
  await prisma.user.update({
    where: { id: user.id },
    data: { planPercent: 0 }
  });
  console.log('✅ User planPercent set to 0 (Isento).');

  const key = getAsaasKey();
  if (key) {
    // 1. Cancel pay_syf4k7rxnroqfzkw directly if known
    await cancelAsaasPayment('pay_syf4k7rxnroqfzkw', key);

    // 2. Check if customer has any other OVERDUE or PENDING payments on Asaas by CPF/CNPJ
    if (user.cpfCnpj) {
      try {
        const custRes = await fetch(`https://api.asaas.com/v3/customers?cpfCnpj=${user.cpfCnpj}`, {
          headers: { "access_token": key }
        });
        const custData = await custRes.json();
        if (custData.data && custData.data.length > 0) {
          const custId = custData.data[0].id;
          const payRes = await fetch(`https://api.asaas.com/v3/payments?customer=${custId}`, {
            headers: { "access_token": key }
          });
          const payData = await payRes.json();
          if (payData.data) {
            for (const p of payData.data) {
              if (['PENDING', 'OVERDUE'].includes(p.status)) {
                await cancelAsaasPayment(p.id, key);
              }
            }
          }
        }
      } catch (e) {
        console.error('Erro ao consultar pagamentos Asaas:', e);
      }
    }
  } else {
    console.log('⚠️ Asaas API key not found in environment.');
  }

  // Update all billing cycles for contatohakim@gmail.com to status PAID and amountPending 0
  const updatedCycles = await prisma.franchiseeBillingCycle.updateMany({
    where: { franchiseeId: user.id },
    data: {
      status: 'PAID',
      amountPending: 0,
      asaasPaymentId: null,
      asaasBoletoUrl: null
    }
  });

  console.log(`✅ ${updatedCycles.count} ciclos de faturamento atualizados para ISENTO / PAGO.`);
}

main().finally(() => prisma.$disconnect());
