/**
 * lib/black-november-no-banco.ts — a Black November com o banco e o Asaas da
 * conta do FireHub. A regra mora em lib/black-november.ts.
 *
 * Tudo fica em `User.onboardingData.blackNovember2026` (Json que já existe,
 * sem coluna nova): exibições (1 por dia), "Não ver mais", a variante, as cobranças e o
 * anual pago. A escrita troca SÓ essa chave (`||` do jsonb), para não apagar
 * os outros campos do onboardingData, e é serializada por loja com um
 * advisory lock — o cartão em 12x manda um webhook por parcela, ao mesmo tempo.
 *
 * Modo simulado (prévia): PREVIEW_BLACK_NOVEMBER=1 não chama o Asaas — grava
 * uma cobrança "simulada" e devolve a URL e o corpo que iriam para lá.
 */
import { prisma } from "@/lib/prisma";
import { getAsaasKey } from "@/lib/asaas";
import { lojaIsenta, vendasQueContam, getCurrentYearMonth } from "@/lib/billing";
import {
  aplicarPagamento, CHAVE_DA_BLACK_NOVEMBER, corpoDaCobranca, FIM_DA_BLACK_NOVEMBER, lerEstado, lojaDaReferencia,
  quemVe, registrarEvento, VALOR_DO_ANUAL, varianteDaLoja,
  type CobrancaDaBlackNovember, type EstadoDaBlackNovember, type EventoDaJanela, type Forma, type Variante,
} from "@/lib/black-november";

export const previaDaBlackNovember = () => process.env.PREVIEW_BLACK_NOVEMBER === "1";

const CAMPOS_DA_LOJA = {
  id: true, role: true, ownerId: true, email: true, name: true, storeName: true, cpfCnpj: true,
  planPercent: true, isFranqueadoHakim: true, createdAt: true, trialEndsAt: true, storeTimezone: true, onboardingData: true,
} as const;

async function gravarEstado(lojaId: string, mudar: (e: EstadoDaBlackNovember) => EstadoDaBlackNovember | null) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `black-november:${lojaId}`);
    const u = await tx.user.findUnique({ where: { id: lojaId }, select: { onboardingData: true } });
    const novo = mudar(lerEstado(u?.onboardingData));
    if (!novo) return null;
    await tx.$executeRawUnsafe(
      `UPDATE "User" SET "onboardingData" = COALESCE("onboardingData", '{}'::jsonb) || jsonb_build_object($1::text, $2::jsonb) WHERE id = $3`,
      CHAVE_DA_BLACK_NOVEMBER, JSON.stringify(novo), lojaId,
    );
    return novo;
  });
}

/**
 * A janela aparece para esta sessão? `forcar` (só na prévia) mostra a
 * variante pedida, ignorando as regras.
 */
export async function situacaoDaBlackNovember(sessao: { email: string; acessoDoSuporte: boolean }, forcar?: Variante | null) {
  const loja = await prisma.user.findUnique({ where: { email: sessao.email }, select: CAMPOS_DA_LOJA });
  if (!loja) return { mostrar: false as const, motivo: "sem-loja" };
  const emTeste = !!loja.trialEndsAt && new Date(loja.trialEndsAt) > new Date();
  if (forcar && previaDaBlackNovember()) return { mostrar: true as const, variante: forcar, emTeste, previa: true };

  const agora = new Date();
  if (agora >= FIM_DA_BLACK_NOVEMBER) return { mostrar: false as const, motivo: "acabou" };
  const [embaixador, produtos] = await Promise.all([
    prisma.ambassador.count({ where: { active: true, OR: [{ linkedUserId: loja.id }, { email: { equals: loja.email, mode: "insensitive" } }] } }),
    prisma.menuProduct.count({ where: { franchiseeId: loja.id } }),
  ]);
  const regra = quemVe({
    agora,
    usuario: { role: loja.role, ownerId: loja.ownerId },
    acessoDoSuporte: sessao.acessoDoSuporte,
    loja,
    isenta: lojaIsenta(loja),
    embaixador: embaixador > 0,
    produtosNoCardapio: produtos,
    fuso: loja.storeTimezone || "America/Sao_Paulo",
  });
  if (!regra.mostrar) return { mostrar: false as const, motivo: regra.motivo };
  return { mostrar: true as const, variante: await varianteDaLojaNoBanco(loja.id, loja.storeTimezone), emTeste, previa: previaDaBlackNovember() };
}

export async function varianteDaLojaNoBanco(lojaId: string, fuso?: string | null): Promise<Variante> {
  const tz = fuso || "America/Sao_Paulo";
  const agora = new Date();
  const [passado, ultimos30Dias] = await Promise.all([
    prisma.franchiseeBillingCycle.findUnique({
      where: { franchiseeId_yearMonth: { franchiseeId: lojaId, yearMonth: getCurrentYearMonth(-1, tz) } },
      select: { totalSales: true },
    }),
    vendasQueContam(lojaId, new Date(agora.getTime() - 30 * 86400_000), agora),
  ]);
  return varianteDaLoja({ mesPassado: passado?.totalSales ?? 0, ultimos30Dias });
}

/** Abriu (conta o dia), fechou, "Não ver mais" ou clicou para pagar — vale em todo aparelho. */
export async function registrarNaJanela(lojaId: string, evento: EventoDaJanela, variante: Variante | null) {
  return gravarEstado(lojaId, (e) => registrarEvento(e, evento, variante, new Date()));
}

// ── ASAAS DA CONTA DO FIREHUB ───────────────────────────────────────────────

function baseDoAsaas(chave: string) {
  return chave.startsWith("$aact_prod") ? "https://api.asaas.com/v3" : "https://sandbox.asaas.com/v3";
}

async function asaas(chave: string, caminho: string, init?: { metodo?: string; corpo?: unknown }) {
  const res = await fetch(`${baseDoAsaas(chave)}${caminho}`, {
    method: init?.metodo || "GET",
    headers: { access_token: chave, "Content-Type": "application/json", "User-Agent": "firehub/1.0" },
    body: init?.corpo !== undefined ? JSON.stringify(init.corpo) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const dados: any = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, dados };
}

export class ErroDaBlackNovember extends Error {}

/**
 * "Quero aproveitar" (cartão 12x) ou "Prefiro Pix à vista". Reaproveita a
 * cobrança pendente da mesma forma (dois cliques não viram duas faturas).
 * Cliente do Asaas: o mesmo da mensalidade, pelo CPF/CNPJ; sem ele, cria
 * como o fechamento cria (lib/billing.ts › closeBillingCycle).
 */
export async function cobrarAnual(lojaId: string, forma: Forma) {
  if (new Date() >= FIM_DA_BLACK_NOVEMBER) throw new ErroDaBlackNovember("A Black November terminou em 30/11.");
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: CAMPOS_DA_LOJA });
  if (!loja) throw new ErroDaBlackNovember("Loja não encontrada.");
  const estado = lerEstado(loja.onboardingData);
  if (estado.anual && !estado.anual.estornadoEm) throw new ErroDaBlackNovember("O plano anual desta loja já está pago.");

  const simulado = previaDaBlackNovember();
  const chave = simulado ? null : getAsaasKey();
  const pendente = (estado.cobrancas || []).find((c) => c.forma === forma && c.status === "PENDENTE"
    && Date.now() - new Date(c.criadaEm).getTime() < 3 * 86400_000);
  if (pendente) {
    if (pendente.simulada || !chave) return { invoiceUrl: pendente.invoiceUrl, simulado: !!pendente.simulada, reaproveitada: true };
    const c = await asaas(chave, `/payments/${pendente.asaasPaymentId}`);
    if (c.ok && c.dados?.status === "PENDING" && !c.dados?.deleted) return { invoiceUrl: pendente.invoiceUrl, simulado: false, reaproveitada: true };
  }

  const doc = String(loja.cpfCnpj || "").replace(/\D/g, "");
  if (doc.length !== 11 && doc.length !== 14) {
    throw new ErroDaBlackNovember("Para gerar a cobrança, cadastre o CPF ou CNPJ da loja em Minha conta — ou fale com a gente no WhatsApp.");
  }

  let cobranca: CobrancaDaBlackNovember;
  let corpo: Record<string, unknown>;
  if (simulado) {
    const id = `pay_simulado_${Date.now().toString(36)}`;
    corpo = corpoDaCobranca(forma, "cus_simulado", lojaId, new Date());
    cobranca = {
      forma, asaasPaymentId: id, asaasInstallmentId: forma === "cartao" ? `ins_simulado_${id.slice(-6)}` : null,
      invoiceUrl: `https://www.asaas.com/i/${id.replace("pay_", "")}`, valor: VALOR_DO_ANUAL,
      criadaEm: new Date().toISOString(), status: "PENDENTE", simulada: true,
    };
  } else {
    if (!chave) throw new ErroDaBlackNovember("O pagamento não está configurado no servidor. Fale com a gente no WhatsApp.");
    let cliente: string | null = null;
    const busca = await asaas(chave, `/customers?cpfCnpj=${doc}`);
    if (busca.ok && busca.dados?.data?.length) cliente = busca.dados.data[0].id;
    if (!cliente) {
      const novo = await asaas(chave, "/customers", { metodo: "POST", corpo: { name: loja.storeName || loja.name, email: loja.email, cpfCnpj: doc } });
      if (!novo.ok || !novo.dados?.id) throw new ErroDaBlackNovember("O Asaas recusou o cadastro para a cobrança. Fale com a gente no WhatsApp.");
      cliente = novo.dados.id as string;
    }
    corpo = corpoDaCobranca(forma, cliente, lojaId, new Date());
    const r = await asaas(chave, "/payments", { metodo: "POST", corpo });
    if (!r.ok || !r.dados?.id || !r.dados?.invoiceUrl) {
      console.error(`[Black November] Asaas recusou a cobrança (${forma}) da loja ${lojaId}: ${JSON.stringify(r.dados?.errors || r.dados).slice(0, 300)}`);
      throw new ErroDaBlackNovember(r.dados?.errors?.[0]?.description || "O Asaas não gerou a cobrança. Fale com a gente no WhatsApp.");
    }
    cobranca = {
      forma, asaasPaymentId: r.dados.id, asaasInstallmentId: r.dados.installment || null, invoiceUrl: r.dados.invoiceUrl,
      valor: VALOR_DO_ANUAL, criadaEm: new Date().toISOString(), status: "PENDENTE",
    };
  }

  await gravarEstado(lojaId, (e) => ({ ...e, cobrancas: [...(e.cobrancas || []), cobranca] }));
  console.log(`[Black November] Cobrança ${forma} ${cobranca.asaasPaymentId}${simulado ? " (SIMULADA)" : ""} para a loja ${lojaId}.`);
  return { invoiceUrl: cobranca.invoiceUrl, simulado, reaproveitada: false, ...(simulado ? { corpo } : {}) };
}

/**
 * Webhook do Asaas (externalReference "black-november:<loja>") e conferência
 * do cron. Pago: grava o anual (12 meses) e apaga no Asaas a OUTRA cobrança
 * pendente (pagou no Pix, o cartão não pode continuar aberto).
 */
export async function registrarPagamentoDaBlackNovember(
  pagamento: { id?: string; externalReference?: string | null; status?: string; installment?: string | null },
  evento?: string | null,
): Promise<ReturnType<typeof aplicarPagamento>["resultado"]> {
  const lojaId = lojaDaReferencia(pagamento.externalReference);
  if (!lojaId) return "SEM_COBRANCA";
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { trialEndsAt: true, storeTimezone: true } });
  if (!loja) return "SEM_COBRANCA";
  const feito: { resultado: ReturnType<typeof aplicarPagamento>["resultado"]; apagar: CobrancaDaBlackNovember[] } = { resultado: "SEM_MUDANCA", apagar: [] };
  await gravarEstado(lojaId, (e) => {
    const r = aplicarPagamento(e, pagamento, evento, { agora: new Date(), fimDoTeste: loja.trialEndsAt, fuso: loja.storeTimezone || "America/Sao_Paulo" });
    feito.resultado = r.resultado;
    feito.apagar = r.apagar;
    return r.estado;
  });
  const { resultado, apagar } = feito;
  const chave = getAsaasKey();
  for (const c of apagar) {
    if (c.simulada || !chave) continue;
    const caminho = c.asaasInstallmentId ? `/installments/${c.asaasInstallmentId}` : `/payments/${c.asaasPaymentId}`;
    const r = await asaas(chave, caminho, { metodo: "DELETE" }).catch(() => null);
    if (!r?.ok) console.error(`[Black November] Não consegui apagar a cobrança ${c.asaasPaymentId} da loja ${lojaId} — apagar no Asaas à mão.`);
  }
  if (resultado === "PAGO") console.log(`[Black November] Loja ${lojaId} PAGOU o anual (${pagamento.id}).`);
  if (resultado === "ESTORNADO") console.warn(`[Black November] Anual da loja ${lojaId} ESTORNADO (${pagamento.id}): a mensalidade volta a ser cobrada.`);
  return resultado;
}

/** Rede de segurança do webhook (cron mensalidades-pagas): confere as cobranças pendentes. */
export async function conferirBlackNovemberNoAsaas() {
  const chave = getAsaasKey();
  if (!chave) return 0;
  const lojas = await prisma.$queryRawUnsafe<{ id: string; estado: EstadoDaBlackNovember }[]>(
    `SELECT id, "onboardingData"->$1 AS estado FROM "User" WHERE "onboardingData"->$1->'cobrancas' IS NOT NULL LIMIT 200`,
    CHAVE_DA_BLACK_NOVEMBER,
  );
  let pagas = 0;
  for (const l of lojas) {
    if (l.estado?.anual && !l.estado.anual.estornadoEm) continue;
    for (const c of l.estado?.cobrancas || []) {
      if (c.status !== "PENDENTE" || c.simulada) continue;
      const r = await asaas(chave, `/payments/${c.asaasPaymentId}`);
      if (!r.ok) continue;
      const res = await registrarPagamentoDaBlackNovember({ ...r.dados, externalReference: `black-november:${l.id}` }, null);
      if (res === "PAGO") { pagas++; break; }
    }
  }
  return pagas;
}
