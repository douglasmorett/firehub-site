const ASAAS_HEADERS = (key: string) => ({
  "access_token": key,
  "User-Agent": "hakim-portal/1.0",
  "Content-Type": "application/json"
});

/**
 * Retorna a chave do Asaas de forma segura.
 * O Vercel interpreta `$` em env vars como referência a outra variável,
 * o que corrompe a chave do Asaas (que começa com `$aact_prod_...`).
 * Solução:
 * 1. Priorizar base64 em ASAAS_API_KEY_B64 (imune à interpolação).
 * 2. Suportar chave direta sem o '$' inicial (e.g. configurada como 'aact_prod_...').
 *    Nossos métodos adicionam o '$' automaticamente em runtime se estiver faltando,
 *    evitando qualquer interpolação ou corrupção do Vercel!
 */
export function getAsaasKey(): string | null {
  const formatKey = (key: string | undefined): string | null => {
    if (!key) return null;
    const trimmed = key.trim();
    if (trimmed.startsWith("$aact_")) return trimmed;
    if (trimmed.startsWith("aact_")) return "$" + trimmed;
    return null;
  };

  // 1. Tenta env var B64 (override limpo, se configurada)
  const b64 = process.env.ASAAS_API_KEY_B64;
  if (b64) {
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf8");
      const formatted = formatKey(decoded);
      if (formatted) return formatted;
    } catch (e) {
      console.error("[Asaas] Erro ao decodificar ASAAS_API_KEY_B64:", e);
    }
  }

  // 2. Env var direta (pode precisar de cuidado com '$' no Vercel)
  const direct = process.env.ASAAS_API_KEY;
  const formattedDirect = formatKey(direct);
  if (formattedDirect) return formattedDirect;

  console.error("[Asaas] ASAAS_API_KEY is not defined. Set ASAAS_API_KEY or ASAAS_API_KEY_B64 in your environment variables.");
  return null;
}

export type OverdueInfo = {
  blocked: boolean;
  payments: { id: string; value: number; dueDate: string; invoiceUrl: string | null; description: string }[];
};

export async function checkAsaasOverdue(cpfCnpj: string | null): Promise<OverdueInfo> {
  if (!cpfCnpj) return { blocked: false, payments: [] };
  
  const asaasKey = getAsaasKey();
  if (!asaasKey) return { blocked: false, payments: [] };

  try {
    const customerRes = await fetch(`https://api.asaas.com/v3/customers?cpfCnpj=${cpfCnpj}`, {
      headers: ASAAS_HEADERS(asaasKey)
    });
    const customerData = await customerRes.json();

    if (!customerRes.ok || !customerData.data || customerData.data.length === 0) {
      return { blocked: false, payments: [] };
    }

    const asaasCustomerId = customerData.data[0].id;

    const paymentsRes = await fetch(`https://api.asaas.com/v3/payments?customer=${asaasCustomerId}&status=OVERDUE`, {
      headers: ASAAS_HEADERS(asaasKey)
    });
    
    const paymentsData = await paymentsRes.json();

    if (paymentsRes.ok && paymentsData.data && paymentsData.data.length > 0) {
      return {
        blocked: true,
        payments: paymentsData.data.map((p: any) => ({
          id: p.id,
          value: p.value,
          dueDate: p.dueDate,
          invoiceUrl: p.invoiceUrl || p.bankSlipUrl || null,
          description: p.description || `Cobrança ${p.id}`,
        }))
      };
    }

    return { blocked: false, payments: [] };
  } catch (error) {
    console.error("Erro ao checar inadimplência no Asaas:", error);
    return { blocked: false, payments: [] };
  }
}

/**
 * Verifica se o cliente já possui 2 ou mais boletos pendentes (PENDING) no Asaas.
 * Diferente de checkAsaasOverdue (que verifica OVERDUE/vencidos),
 * esta função verifica boletos que foram gerados mas ainda não pagos,
 * mesmo que não estejam vencidos.
 * Regra: máximo de 2 boletos pendentes por cliente.
 */
export type PendingBoletosInfo = {
  blocked: boolean;
  pendingCount: number;
  payments: { id: string; value: number; dueDate: string; invoiceUrl: string | null; description: string }[];
};

export async function checkAsaasPendingBoletos(cpfCnpj: string | null): Promise<PendingBoletosInfo> {
  if (!cpfCnpj) return { blocked: false, pendingCount: 0, payments: [] };

  const asaasKey = getAsaasKey();
  if (!asaasKey) return { blocked: false, pendingCount: 0, payments: [] };

  try {
    const customerRes = await fetch(`https://api.asaas.com/v3/customers?cpfCnpj=${cpfCnpj}`, {
      headers: ASAAS_HEADERS(asaasKey)
    });
    const customerData = await customerRes.json();

    if (!customerRes.ok || !customerData.data || customerData.data.length === 0) {
      return { blocked: false, pendingCount: 0, payments: [] };
    }

    const asaasCustomerId = customerData.data[0].id;

    const paymentsRes = await fetch(`https://api.asaas.com/v3/payments?customer=${asaasCustomerId}&status=PENDING&limit=10`, {
      headers: ASAAS_HEADERS(asaasKey)
    });

    const paymentsData = await paymentsRes.json();

    if (paymentsRes.ok && paymentsData.data && paymentsData.data.length >= 2) {
      console.warn(`[Asaas] Cliente ${cpfCnpj} possui ${paymentsData.data.length} boletos pendentes — bloqueado por acúmulo.`);
      return {
        blocked: true,
        pendingCount: paymentsData.data.length,
        payments: paymentsData.data.map((p: any) => ({
          id: p.id,
          value: p.value,
          dueDate: p.dueDate,
          invoiceUrl: p.invoiceUrl || p.bankSlipUrl || null,
          description: p.description || `Cobrança ${p.id}`,
        }))
      };
    }

    return { blocked: false, pendingCount: paymentsData.data?.length || 0, payments: [] };
  } catch (error) {
    console.error("Erro ao checar boletos pendentes no Asaas:", error);
    return { blocked: false, pendingCount: 0, payments: [] };
  }
}


export async function getAsaasDashboardData(month: number, year: number) {
  const asaasKey = getAsaasKey();
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
  const asaasKey = getAsaasKey();
  if (!asaasKey) {
    console.warn("[Asaas] Chave não configurada — cobrança não gerada.");
    return null;
  }

  const BASE = asaasKey.startsWith("$aact_prod")
    ? "https://api.asaas.com/v3"
    : "https://sandbox.asaas.com/v3";

  try {
    // 1. Busca ou cria cliente
    let customerId: string | null = null;
    const cleanCpfCnpj = opts.cpfCnpj ? opts.cpfCnpj.replace(/\D/g, "") : "";

    if (cleanCpfCnpj) {
      try {
        const searchRes = await fetch(
          `${BASE}/customers?cpfCnpj=${encodeURIComponent(cleanCpfCnpj)}`,
          { headers: ASAAS_HEADERS(asaasKey) }
        );
        if (searchRes.ok) {
          const data = await searchRes.json();
          if (data.data?.length > 0) customerId = data.data[0].id;
        }
      } catch (err) {
        console.error("Erro ao buscar cliente por CPF/CNPJ no Asaas:", err);
      }
    }

    if (!customerId) {
      const payload: any = {
        name: opts.userName || opts.userEmail,
        email: opts.userEmail,
      };
      if (cleanCpfCnpj) {
        payload.cpfCnpj = cleanCpfCnpj;
      }

      let createRes = await fetch(`${BASE}/customers`, {
        method: "POST",
        headers: ASAAS_HEADERS(asaasKey),
        body: JSON.stringify(payload)
      });
      let createData = await createRes.json();

      if (!createRes.ok) {
        console.error("Erro criar cliente Asaas:", JSON.stringify(createData));
        
        // Se falhou e tinha CPF/CNPJ, tenta criar sem ele como fallback
        if (payload.cpfCnpj) {
          console.warn("Tentando criar cliente Asaas sem CPF/CNPJ...");
          delete payload.cpfCnpj;
          createRes = await fetch(`${BASE}/customers`, {
            method: "POST",
            headers: ASAAS_HEADERS(asaasKey),
            body: JSON.stringify(payload)
          });
          createData = await createRes.json();
        }
      }

      if (createRes.ok) {
        customerId = createData.id;
      } else {
        console.error("Erro criar cliente Asaas (fallback):", JSON.stringify(createData));
      }
    }

    if (!customerId) return null;

    // 2. Cria cobrança (boleto) com vencimento em 7 dias
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);

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
