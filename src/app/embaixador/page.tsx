import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AmbassadorDashboard from "@/components/ambassador/AmbassadorDashboard";
import AmbassadorLoginForm from "@/components/ambassador/AmbassadorLoginForm";
import type { LojaDaCarteiraDeVendas, LojaInadimplente } from "@/components/ambassador/SecoesDoEmbaixador";
import { cobrancasDasLojas, comissaoDasLojas, mediaMensalDaComissao, SELECT_DA_LOJA_NA_CARTEIRA } from "@/lib/comissao-da-carteira";
import { atividadeDasLojas } from "@/lib/atividade-da-loja";
import { ganhaComoVendedor, SELECT_DO_EMBAIXADOR_DA_LOJA } from "@/lib/vendedores";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portal do Embaixador - FireHub" };

/**
 * O portal do embaixador é o lugar ÚNICO de quem é embaixador e vendedor
 * (pedido do dono, 27/09/2026): as lojas que ele indicou (comissão de
 * embaixador), a rede de nível 2, a carteira de vendas (os 3% de quem ele
 * atende), a média do que recebe por mês e a inadimplência das lojas dele,
 * com a cobrança pronta no WhatsApp. /vendedor continua existindo.
 */
export default async function EmbaixadorPage() {
  const session = await getServerSession(authOptions);

  // Se não estiver autenticado ou não for AMBASSADOR, exibe tela de login do embaixador
  if (!session?.user?.email || (session.user as any).role !== "AMBASSADOR") {
    return <AmbassadorLoginForm />;
  }

  const sessionUser = session.user as any;

  // Busca o embaixador por ID ou e-mail de forma resiliente
  const ambassador = await prisma.ambassador.findFirst({
    where: {
      OR: [
        ...(sessionUser.id ? [{ id: sessionUser.id }] : []),
        ...(sessionUser.email ? [{ email: { equals: sessionUser.email, mode: "insensitive" as const } }] : [])
      ]
    },
    include: {
      referredStores: {
        select: SELECT_DA_LOJA_NA_CARTEIRA,
        orderBy: { createdAt: "desc" }
      },
      // Rede de nível 2: os embaixadores que ELE trouxe. As lojas deles pagam
      // `level2Percent` para este embaixador aqui. Para por aqui — não existe
      // terceiro nível, então não há include aninhado.
      subAmbassadors: {
        where: { active: true },
        select: {
          id: true,
          name: true,
          code: true,
          referredStores: {
            select: SELECT_DA_LOJA_NA_CARTEIRA,
            orderBy: { createdAt: "desc" }
          }
        }
      },
      // A carteira de VENDAS (lib/vendedores.ts): lojas que o admin pôs com ele.
      carteira: {
        select: {
          ...SELECT_DA_LOJA_NA_CARTEIRA, ...SELECT_DO_EMBAIXADOR_DA_LOJA,
          vendedorStatus: true, vendedorAtribuidoEm: true, vendedorAtendidoEm: true,
        },
        orderBy: { vendedorAtribuidoEm: "desc" },
      },
    }
  });

  if (!ambassador) {
    return <AmbassadorLoginForm />;
  }

  // A conta mora em lib/comissao-da-carteira.ts — a mesma do vendedor.
  const calcularLojas = comissaoDasLojas;

  const storesData = await calcularLojas(ambassador.referredStores, ambassador.commissionPercent);

  // Nível 2: as lojas de cada embaixador da rede, valendo `level2Percent`.
  const nivel2Percent = ambassador.level2Percent ?? 3;
  const rede = await Promise.all(
    ambassador.subAmbassadors.map(async (sub) => {
      const lojas = await calcularLojas(sub.referredStores, nivel2Percent);
      return {
        id: sub.id,
        name: sub.name,
        code: sub.code,
        storesCount: lojas.length,
        activeStores: lojas.filter((l) => l.status === "ACTIVE").length,
        monthSales: lojas.reduce((acc, l) => acc + l.monthSales, 0),
        monthIncome: lojas.reduce((acc, l) => acc + l.ambassadorProfit, 0),
      };
    })
  );

  // Carteira de vendas: só quem é vendedor. Loja que ele mesmo indicou não
  // rende os 3% (ganhaComoVendedor) — ali ele já ganha como embaixador.
  const pctDeVendas = (l: { ambassadorId?: string | null; ambassador?: { parentAmbassadorId?: string | null } | null }) =>
    ganhaComoVendedor(ambassador.id, l) ? ambassador.sellerPercent : 0;
  const carteira = ambassador.isVendedor ? ambassador.carteira : [];
  const [vendasData, atividade] = await Promise.all([
    calcularLojas(carteira, pctDeVendas),
    atividadeDasLojas(carteira.map((l) => l.id)),
  ]);
  const lojasDeVendas: LojaDaCarteiraDeVendas[] = vendasData.map((l) => {
    const c = carteira.find((x) => x.id === l.id)!;
    return {
      id: l.id, storeName: l.storeName, storePhone: l.storePhone, city: l.city, slug: l.slug,
      status: l.status, trialDaysRemaining: l.trialDaysRemaining, monthSales: l.monthSales,
      platformFee: l.platformFee, ambassadorProfit: l.ambassadorProfit,
      atendimento: c.vendedorStatus === "ATENDIDO" ? "ATENDIDO" : "AGUARDANDO",
      atribuidoEm: c.vendedorAtribuidoEm ? c.vendedorAtribuidoEm.toISOString() : null,
      atividade: atividade.get(l.id) || null,
      suaIndicacao: !ganhaComoVendedor(ambassador.id, c),
    };
  });

  // Totais consolidados da carteira
  const networkIncome = rede.reduce((acc, r) => acc + r.monthIncome, 0);
  const currentMonthIncome = storesData.reduce((acc, s) => acc + s.ambassadorProfit, 0);
  const totalPortfolioSales = storesData.reduce((acc, s) => acc + s.monthSales, 0);
  const totalPlatformFees = storesData.reduce((acc, s) => acc + s.platformFee, 0);
  const comissaoDeVendas = lojasDeVendas.reduce((acc, l) => acc + l.ambassadorProfit, 0);

  // Inadimplência: todas as lojas dele (indicadas, rede e vendas), sem repetir.
  const lojasDaRede = ambassador.subAmbassadors.flatMap((s) => s.referredStores);
  const todasAsLojas = new Map<string, { storeName: string; storePhone: string | null; vinculos: Set<string> }>();
  const registrar = (lista: { id: string; storeName: string | null; name: string; storePhone: string | null }[], vinculo: string) => {
    for (const l of lista) {
      const atual = todasAsLojas.get(l.id) || { storeName: l.storeName || l.name, storePhone: l.storePhone, vinculos: new Set<string>() };
      atual.vinculos.add(vinculo);
      todasAsLojas.set(l.id, atual);
    }
  };
  registrar(ambassador.referredStores, "você indicou");
  registrar(lojasDaRede, "rede");
  registrar(carteira, "carteira de vendas");
  const cobrancas = await cobrancasDasLojas([...todasAsLojas.keys()]);
  const inadimplentes: LojaInadimplente[] = [...cobrancas.entries()]
    .map(([id, cobranca]) => ({ id, storeName: todasAsLojas.get(id)!.storeName, storePhone: todasAsLojas.get(id)!.storePhone, vinculo: [...todasAsLojas.get(id)!.vinculos].join(" + "), cobranca }))
    .sort((a, b) => Number(b.cobranca.vencida) - Number(a.cobranca.vencida) || b.cobranca.pendente - a.cobranca.pendente);

  // Média do que entrou de verdade nos últimos 3 meses, nas três carteiras.
  const mediaMensal = await mediaMensalDaComissao([
    { ids: ambassador.referredStores.map((l) => l.id), percentual: ambassador.commissionPercent },
    { ids: lojasDaRede.map((l) => l.id), percentual: nivel2Percent },
    { ids: carteira.map((l) => l.id), percentual: (id) => pctDeVendas(carteira.find((l) => l.id === id) || {}) },
  ]);

  return (
    <AmbassadorDashboard
      ambassador={{
        id: ambassador.id,
        name: ambassador.name,
        email: ambassador.email,
        phone: ambassador.phone,
        code: ambassador.code,
        commissionPercent: ambassador.commissionPercent,
        asaasWalletId: ambassador.asaasWalletId,
        active: ambassador.active
      }}
      stores={storesData}
      network={{
        level2Percent: nivel2Percent,
        ambassadors: rede,
        monthIncome: networkIncome,
        storesCount: rede.reduce((acc, r) => acc + r.storesCount, 0),
      }}
      currentMonthIncome={currentMonthIncome}
      totalPortfolioSales={totalPortfolioSales}
      totalPlatformFees={totalPlatformFees}
      extras={{
        nomeDoEmbaixador: ambassador.name,
        previsaoDoMes: currentMonthIncome + networkIncome + comissaoDeVendas,
        mediaMensal,
        inadimplentes,
        vendas: ambassador.isVendedor ? { sellerPercent: ambassador.sellerPercent, lojas: lojasDeVendas } : null,
      }}
    />
  );
}
