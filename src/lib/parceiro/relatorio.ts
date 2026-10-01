/**
 * O RELATÓRIO DO PARCEIRO — o que o portal do embaixador/vendedor mostra e o
 * que o admin abre por pessoa (pedido do Douglas, 30/09/2026, a partir do
 * Victor, que é embaixador e vendedor):
 *
 *   • em que papel ele está em cada loja (indicou, rede, carteira de vendas),
 *     e a loja que é "as duas coisas" contando só como embaixador;
 *   • quanto ele tem de comissão no mês até agora e o que o mês passado já
 *     pagou, está para vencer ou está atrasado — ele só recebe de quem paga;
 *   • quem está vendendo, quem parou, quem está em teste e quem está devendo,
 *     com a cobrança pronta para ele mesmo mandar do WhatsApp dele.
 *
 * A comissão é um percentual da MENSALIDADE da FireHub (não das vendas da
 * loja), e cai pelo split do Asaas quando a loja paga o boleto. O mês corrente
 * vem do ciclo OPEN que o cron recalcula de hora em hora (lib/billing.ts,
 * garantirCiclosDoMes) — o mesmo número que vira o boleto no dia 1º.
 */
import { prisma } from "@/lib/prisma";
import { getCurrentYearMonth, isExemptAccount } from "@/lib/billing";
import { atividadeDasLojas } from "@/lib/atividade-da-loja";
import {
  comissaoSobre, mensalidadeDoCiclo, mesesAntes, papelNaLoja, repasseNaLoja, resumirLojas,
  type CicloNasRegras, type LojaDoRelatorio, type LojaNasRegras, type Papel, type ParceiroNasRegras, type ResumoDoParceiro,
} from "@/lib/parceiro/regras";

export type RelatorioDoParceiro = {
  parceiro: {
    id: string;
    nome: string;
    email: string;
    telefone: string | null;
    codigo: string;
    ativo: boolean;
    temCarteira: boolean;
    isVendedor: boolean;
    percentuais: Record<Papel, number>;
    /** Os papéis que ele tem de fato (chips do topo e seções da estrutura). */
    papeis: Papel[];
  };
  /** Os embaixadores que ele trouxe (nível 2). */
  rede: { id: string; nome: string; codigo: string; ativo: boolean; temCarteira: boolean; lojas: number }[];
  meses: { atual: string; anterior: string; historico: string[] };
  geradoEm: string;
  lojas: LojaDoRelatorio[];
  resumo: ResumoDoParceiro;
};

const DIA = 86_400_000;

/** "2026-10" do instante, em Brasília. */
function mesEmBrasilia(quando: string | Date): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(new Date(quando));
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}

const SELECT_DA_LOJA = {
  id: true, name: true, storeName: true, storePhone: true, email: true, city: true, slug: true,
  createdAt: true, trialEndsAt: true, planPercent: true, isFranqueadoHakim: true, cpfCnpj: true,
  ambassadorId: true,
  ambassador: {
    select: {
      id: true, name: true, active: true, asaasWalletId: true, commissionPercent: true, parentAmbassadorId: true,
      parentAmbassador: { select: { id: true, active: true, asaasWalletId: true, level2Percent: true } },
    },
  },
  vendedorId: true,
  vendedor: { select: { id: true, name: true, active: true, isVendedor: true, asaasWalletId: true, sellerPercent: true } },
  vendedorStatus: true, vendedorAtribuidoEm: true, vendedorAtendidoEm: true,
} as const;

const SELECT_DO_CICLO = {
  franchiseeId: true, yearMonth: true, status: true, amountDue: true, amountPending: true,
  asaasPaymentId: true, asaasBoletoUrl: true, dueDate: true, paidAt: true, paidValue: true,
  paidNetValue: true, asaasStatus: true, notes: true,
} as const;

/** O relatório de um parceiro (Ambassador.id), ou null se ele não existe. */
export async function relatorioDoParceiro(parceiroId: string, agora = new Date()): Promise<RelatorioDoParceiro | null> {
  const p = await prisma.ambassador.findUnique({
    where: { id: parceiroId },
    select: {
      id: true, name: true, email: true, phone: true, code: true, active: true, asaasWalletId: true,
      commissionPercent: true, level2Percent: true, isVendedor: true, sellerPercent: true,
      subAmbassadors: { select: { id: true, name: true, code: true, active: true, asaasWalletId: true }, orderBy: { name: "asc" } },
    },
  });
  if (!p) return null;

  const regrasDoParceiro: ParceiroNasRegras = {
    id: p.id,
    active: p.active,
    temCarteira: !!p.asaasWalletId,
    isVendedor: p.isVendedor,
    commissionPercent: p.commissionPercent,
    level2Percent: p.level2Percent ?? 3,
    sellerPercent: p.sellerPercent,
  };

  const lojas = await prisma.user.findMany({
    where: {
      OR: [
        { ambassadorId: p.id },
        { ambassador: { parentAmbassadorId: p.id } },
        ...(p.isVendedor ? [{ vendedorId: p.id }] : []),
      ],
    },
    select: SELECT_DA_LOJA,
    orderBy: { createdAt: "desc" },
  });

  const mesAtual = getCurrentYearMonth(0);
  const mesAnterior = mesesAntes(mesAtual, 1);
  const historico = [3, 2, 1].map((n) => mesesAntes(mesAtual, n));
  const ids = lojas.map((l) => l.id);

  const [ciclos, atividade] = await Promise.all([
    ids.length
      ? prisma.franchiseeBillingCycle.findMany({
          where: {
            franchiseeId: { in: ids },
            OR: [{ yearMonth: { in: [mesAtual, ...historico] } }, { status: "CLOSED", amountPending: { gt: 0 } }],
          },
          select: SELECT_DO_CICLO,
        })
      : Promise.resolve([]),
    atividadeDasLojas(ids),
  ]);

  const ciclosDaLoja = new Map<string, Map<string, CicloNasRegras>>();
  for (const c of ciclos) {
    const m = ciclosDaLoja.get(c.franchiseeId) || new Map<string, CicloNasRegras>();
    m.set(c.yearMonth, c);
    ciclosDaLoja.set(c.franchiseeId, m);
  }

  const saida: LojaDoRelatorio[] = [];
  for (const l of lojas) {
    const regrasDaLoja: LojaNasRegras = {
      ambassadorId: l.ambassadorId,
      ambassador: l.ambassador
        ? {
            id: l.ambassador.id,
            active: l.ambassador.active,
            temCarteira: !!l.ambassador.asaasWalletId,
            commissionPercent: l.ambassador.commissionPercent,
            parentAmbassadorId: l.ambassador.parentAmbassadorId,
            parentAmbassador: l.ambassador.parentAmbassador
              ? {
                  id: l.ambassador.parentAmbassador.id,
                  active: l.ambassador.parentAmbassador.active,
                  temCarteira: !!l.ambassador.parentAmbassador.asaasWalletId,
                  level2Percent: l.ambassador.parentAmbassador.level2Percent ?? 3,
                }
              : null,
          }
        : null,
      vendedorId: l.vendedorId,
      vendedor: l.vendedor
        ? { id: l.vendedor.id, active: l.vendedor.active, isVendedor: l.vendedor.isVendedor, temCarteira: !!l.vendedor.asaasWalletId, sellerPercent: l.vendedor.sellerPercent }
        : null,
    };
    const papel = papelNaLoja(regrasDoParceiro, regrasDaLoja);
    if (!papel) continue;
    const pct = papel.percentual;

    const doMes = ciclosDaLoja.get(l.id) || new Map<string, CicloNasRegras>();
    const atual = mensalidadeDoCiclo(doMes.get(mesAtual) || null, mesAtual, mesAtual, agora);
    const anterior = mensalidadeDoCiclo(doMes.get(mesAnterior) || null, mesAnterior, mesAtual, agora);

    // Tudo que a loja deve de meses fechados e PODE pagar (tem boleto).
    const abertos = [...doMes.values()]
      .filter((c) => c.status === "CLOSED" && c.amountPending > 0)
      .map((c) => mensalidadeDoCiclo(c, c.yearMonth, mesAtual, agora))
      .filter((m) => m.situacao === "A_VENCER" || m.situacao === "VENCIDA")
      .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    const valorEmAberto = abertos.reduce((s, m) => s + m.valor, 0);
    const maisAntigoVencido = abertos.find((m) => m.situacao === "VENCIDA");

    const recebidoPorMes = historico
      .map((ym) => mensalidadeDoCiclo(doMes.get(ym) || null, ym, mesAtual, agora))
      .filter((m) => m.situacao === "PAGA")
      .map((m) => ({ yearMonth: m.yearMonth, valor: comissaoSobre(m.pago, pct), pagoEm: m.pagoEm }));

    const fimDoTeste = l.trialEndsAt ? new Date(l.trialEndsAt) : null;
    const emTeste = !!fimDoTeste && fimDoTeste.getTime() > agora.getTime();
    const a = atividade.get(l.id);
    const email = (l.email || "").toLowerCase().replace(/\s+/g, "");
    const naCarteira = p.isVendedor && l.vendedorId === p.id;

    saida.push({
      id: l.id,
      nome: l.storeName || l.name || "Loja sem nome",
      dono: l.name,
      cidade: l.city,
      telefone: l.storePhone,
      email: l.email,
      slug: l.slug,
      cadastradaEm: l.createdAt.toISOString(),
      papel: papel.papel,
      percentual: pct,
      tambemNaCarteira: papel.tambemNaCarteira,
      via: papel.papel === "REDE" && l.ambassador ? { id: l.ambassador.id, nome: l.ambassador.name } : null,
      vendedorDaLoja: l.vendedor && l.vendedor.id !== p.id ? l.vendedor.name : null,
      repasse: repasseNaLoja(regrasDoParceiro, regrasDaLoja, papel.papel),
      isenta: isExemptAccount(email) || l.planPercent === 0 || l.isFranqueadoHakim === true || email === "contatohakim@gmail.com",
      semCpfCnpj: !String(l.cpfCnpj || "").replace(/\D/g, ""),
      teste: {
        ativo: emTeste,
        ate: fimDoTeste ? fimDoTeste.toISOString() : null,
        diasRestantes: emTeste ? Math.max(0, Math.ceil((fimDoTeste!.getTime() - agora.getTime()) / DIA)) : 0,
      },
      uso: {
        situacao: !a || a.situacao === "NUNCA_VENDEU" ? "NUNCA_VENDEU" : a.situacao === "ATIVA" ? "ATIVA" : "PARADA",
        diasSemPedido: a?.diasSemPedido ?? null,
        pedidos7d: a?.pedidos7d ?? 0,
        ultimoPedidoEm: a?.ultimoPedidoEm ?? null,
      },
      carteira: naCarteira
        ? {
            atendimento: l.vendedorStatus === "ATENDIDO" ? "ATENDIDO" : "AGUARDANDO",
            atribuidoEm: l.vendedorAtribuidoEm ? l.vendedorAtribuidoEm.toISOString() : null,
            atendidoEm: l.vendedorAtendidoEm ? l.vendedorAtendidoEm.toISOString() : null,
          }
        : null,
      mesAtual: { ...atual, comissao: comissaoSobre(atual.valor, pct) },
      mesAnterior: { ...anterior, comissao: comissaoSobre(anterior.situacao === "PAGA" ? anterior.pago : anterior.valor, pct) },
      emAberto: abertos.length
        ? {
            valor: Math.round(valorEmAberto * 100) / 100,
            meses: abertos.length,
            vencida: !!maisAntigoVencido,
            diasDeAtraso: Math.max(0, ...abertos.map((m) => m.diasDeAtraso)),
            maisAntigo: abertos[0].yearMonth,
            boletoUrl: (maisAntigoVencido || abertos[0]).boletoUrl,
            comissaoParada: comissaoSobre(valorEmAberto, pct),
          }
        : null,
      recebidoPorMes,
    });
  }

  const redeComLojas = p.subAmbassadors.map((s) => ({
    id: s.id,
    nome: s.name,
    codigo: s.code,
    ativo: s.active,
    temCarteira: !!s.asaasWalletId,
    lojas: saida.filter((l) => l.via?.id === s.id).length,
  }));

  const papeis: Papel[] = [];
  if (p.commissionPercent > 0 || saida.some((l) => l.papel === "EMBAIXADOR")) papeis.push("EMBAIXADOR");
  if (p.subAmbassadors.length > 0 || saida.some((l) => l.papel === "REDE")) papeis.push("REDE");
  if (p.isVendedor) papeis.push("VENDEDOR");

  return {
    parceiro: {
      id: p.id,
      nome: p.name,
      email: p.email,
      telefone: p.phone,
      codigo: p.code,
      ativo: p.active,
      temCarteira: !!p.asaasWalletId,
      isVendedor: p.isVendedor,
      percentuais: { EMBAIXADOR: p.commissionPercent, REDE: p.level2Percent ?? 3, VENDEDOR: p.sellerPercent },
      papeis,
    },
    rede: redeComLojas,
    meses: { atual: mesAtual, anterior: mesAnterior, historico },
    geradoEm: agora.toISOString(),
    lojas: saida,
    resumo: resumirLojas(saida, { atual: mesAtual, anterior: mesAnterior, historico }, mesEmBrasilia),
  };
}
