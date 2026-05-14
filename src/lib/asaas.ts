const ASAAS_HEADERS = (key: string) => ({
  "access_token": key,
  "User-Agent": "hakim-portal/1.0",
  "Content-Type": "application/json"
});

export async function checkAsaasOverdue(cpfCnpj: string | null): Promise<boolean> {
  if (!cpfCnpj) return false;
  
  const asaasKey = process.env.ASAAS_API_KEY;
  if (!asaasKey) return false;

  try {
    const customerRes = await fetch(`https://api.asaas.com/v3/customers?cpfCnpj=${cpfCnpj}`, {
      headers: ASAAS_HEADERS(asaasKey)
    });
    const customerData = await customerRes.json();

    if (!customerRes.ok || !customerData.data || customerData.data.length === 0) {
      return false;
    }

    const asaasCustomerId = customerData.data[0].id;

    const paymentsRes = await fetch(`https://api.asaas.com/v3/payments?customer=${asaasCustomerId}&status=OVERDUE`, {
      headers: ASAAS_HEADERS(asaasKey)
    });
    
    const paymentsData = await paymentsRes.json();

    if (paymentsRes.ok && paymentsData.data && paymentsData.data.length > 0) {
      return true;
    }

    return false;
  } catch (error) {
    console.error("Erro ao checar inadimplência no Asaas:", error);
    return false;
  }
}

export async function getAsaasDashboardData(month: number, year: number) {
  const asaasKey = process.env.ASAAS_API_KEY;
  if (!asaasKey) return null;

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;

  try {
    const [receivedRes, pendingRes, overdueRes] = await Promise.all([
      fetch(`https://api.asaas.com/v3/payments?status=RECEIVED&dueDateStart=${startDate}&dueDateEnd=${endDate}&limit=100`, {
        headers: ASAAS_HEADERS(asaasKey)
      }),
      fetch(`https://api.asaas.com/v3/payments?status=PENDING&limit=100`, {
        headers: ASAAS_HEADERS(asaasKey)
      }),
      fetch(`https://api.asaas.com/v3/payments?status=OVERDUE&limit=100`, {
        headers: ASAAS_HEADERS(asaasKey)
      })
    ]);

    const [receivedData, pendingData, overdueData] = await Promise.all([
      receivedRes.json(),
      pendingRes.json(),
      overdueRes.json()
    ]);

    const sumValues = (payments: any[]) =>
      payments?.reduce((acc: number, p: any) => acc + (p.value || 0), 0) || 0;

    return {
      received: {
        count: receivedData?.totalCount || 0,
        value: sumValues(receivedData?.data || [])
      },
      pending: {
        count: pendingData?.totalCount || 0,
        value: sumValues(pendingData?.data || [])
      },
      overdue: {
        count: overdueData?.totalCount || 0,
        value: sumValues(overdueData?.data || [])
      }
    };
  } catch (error) {
    console.error("Erro ao buscar dados do Asaas:", error);
    return null;
  }
}

/**
 * Cria uma cobrança no Asaas e retorna { paymentId, boletoUrl } ou null se falhar.
 * Reutilizada pelo checkout normal e checkout de emergência.
 */
export async function createAsaasPayment(opts: {
  userName: string;
  userEmail: string;
  cpfCnpj: string;
  totalAmount: number;
  orderId: string;
  description?: string;
}): Promise<{ paymentId: string; boletoUrl: string | null } | null> {
  const asaasKey = process.env.ASAAS_API_KEY;
  if (!asaasKey) {
    console.warn("ASAAS_API_KEY não configurada — cobrança não gerada.");
    return null;
  }

  const BASE = asaasKey.startsWith("$aact_prod")
    ? "https://api.asaas.com/v3"
    : "https://sandbox.asaas.com/v3";

  try {
    // 1. Busca ou cria cliente
    let customerId: string | null = null;

    if (opts.cpfCnpj) {
      const searchRes = await fetch(
        `${BASE}/customers?cpfCnpj=${encodeURIComponent(opts.cpfCnpj)}`,
        { headers: ASAAS_HEADERS(asaasKey) }
      );
      if (searchRes.ok) {
        const data = await searchRes.json();
        if (data.data?.length > 0) customerId = data.data[0].id;
      }
    }

    if (!customerId) {
      const createRes = await fetch(`${BASE}/customers`, {
        method: "POST",
        headers: ASAAS_HEADERS(asaasKey),
        body: JSON.stringify({
          name: opts.userName || opts.userEmail,
          email: opts.userEmail,
          cpfCnpj: opts.cpfCnpj || ""
        })
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        console.error("Erro criar cliente Asaas:", JSON.stringify(createData));
        return null;
      }
      customerId = createData.id;
    }

    if (!customerId) return null;

    // 2. Cria cobrança (boleto) com vencimento em 10 dias
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 10);

    const shortId = opts.orderId.slice(-6).toUpperCase();
    const payRes = await fetch(`${BASE}/payments`, {
      method: "POST",
      headers: ASAAS_HEADERS(asaasKey),
      body: JSON.stringify({
        customer: customerId,
        billingType: "BOLETO",
        value: opts.totalAmount,
        dueDate: dueDate.toISOString().split("T")[0],
        description: opts.description || `Pedido #${shortId} — Hakim Congelados`,
        externalReference: opts.orderId
      })
    });

    const payData = await payRes.json();
    if (!payRes.ok) {
      console.error("Erro Asaas payment:", JSON.stringify(payData));
      return null;
    }

    console.log(`[Asaas] payment=${payData.id} invoiceUrl=${payData.invoiceUrl}`);
    return {
      paymentId: payData.id,
      boletoUrl: payData.invoiceUrl || payData.bankSlipUrl || null
    };
  } catch (error) {
    console.error("Erro ao criar pagamento Asaas:", error);
    return null;
  }
}
