import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import StoreOrdersDashboard from "@/components/customer/StoreOrdersDashboard";
import { lojasDeOrigemDaConta } from "@/lib/lojas-de-origem-da-conta";
import { resolverLojaNoMapa } from "@/lib/ponto-da-loja-servidor";
import type { LojaDeOrigem } from "@/lib/loja-de-origem";

export const dynamic = "force-dynamic";

export default async function FranchiseeCustomerOrdersPage() {
  // Autenticação FORA de try/catch — redirect() não pode ser capturado
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[PedidosClientes] Erro ao obter sessão:", err);
    return null;
  });
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  // Busca do usuário FORA do try/catch — redirect() precisa propagar
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: {
      id: true,
      name: true,
      storeName: true,
      storeAddress: true,
      storePhone: true,
      slug: true,
      city: true,
      role: true,
      // Quais módulos este funcionário pode usar. O painel precisa para saber
      // se desenha o botão de editar pedido (lib/edicao-de-pedido.ts) — sem
      // isto a tela decidiria pelo `role` sozinho e todo funcionário veria um
      // botão que a API recusa.
      permissions: true,
      ownerId: true,
      // Quem manda no grupo de lojas: sem ele, lojasDeOrigemDaConta enxerga
      // só a loja logada e o selo da marca some em conta com grupo.
      accountGroupId: true,
      storeHours: true,
      storeDeliveryOnly: true,
      storeLogo: true,
      storeLatLng: true,
      storeTimezone: true,
      allowScheduledOrders: true,
      // O que esta loja mostra na barra do painel. Ausente = tudo ligado.
      painelPedidosConfig: true,
      // O que o app dos entregadores faz na entrega (modal "App Motoboys").
      appMotoboyConfig: true,
    },
  }).catch((err) => {
    console.error("[PedidosClientes] Erro ao buscar usuário:", err);
    return null;
  });
  if (!user) redirect("/login");

  const targetFranchiseeId = (user as any).ownerId || user.id;

  // De qual MARCA é cada pedido — a mesma lista que a tela de Impressoras
  // usa para escolher de quais lojas cada impressora recebe. Vem vazia
  // quando a conta não tem o que separar, e aí o selo não aparece.
  //
  // `.catch` porque isto é enfeite do cartão: uma consulta a mais não pode
  // derrubar a tela de pedidos, que é a tela onde a loja trabalha.
  const lojasDeOrigem: LojaDeOrigem[] = await lojasDeOrigemDaConta(
    targetFranchiseeId,
    (user as any).accountGroupId || null,
  ).catch(() => []);

  // === MULTI-LOJAS: Resolver IDs das lojas ativas ===
  const cookieStore = await cookies();
  const activeStore = cookieStore.get('firehub_active_store')?.value;

  let franchiseeIds: string[] = [targetFranchiseeId];

  if (activeStore === 'all') {
    const groupStores = await prisma.user.findMany({
      where: { OR: [{ id: targetFranchiseeId }, { accountGroupId: targetFranchiseeId }] },
      select: { id: true }
    });
    if (groupStores.length > 0) franchiseeIds = groupStores.map(s => s.id);
  } else if (activeStore && activeStore !== targetFranchiseeId) {
    const targetStore = await prisma.user.findUnique({ where: { id: activeStore }, select: { id: true, accountGroupId: true } });
    if (targetStore && (targetStore.id === targetFranchiseeId || targetStore.accountGroupId === targetFranchiseeId)) {
      franchiseeIds = [activeStore];
    }
  }

  // Busca do caixa aberto, motoboys e pedidos
  let orders: any[] = [];
  let activeCashSessionOpenedAt: string | null = null;
  let motoboys: any[] = [];
  try {
    let [ordersRes, cashSessionRes, motoboysRes] = await Promise.all([
      prisma.customerOrder.findMany({
        where: {
          franchiseeId: { in: franchiseeIds },
          // CRIANDO_IA entra aqui de propósito.
          //
          // O painel TEM o cartão "🤖 IA criando pedido..." pronto
          // (StoreOrdersDashboard: rótulo, cor e o bucket de "novos"), e o feed
          // de polling (/api/customer-order/poll) devolve esses rascunhos. Só a
          // carga inicial da página os excluía — então, ao abrir o painel, o
          // pedido que a IA estava montando ficava invisível até o primeiro
          // poll. Era o relato do dono: "quando alguns começam a fazer o pedido
          // ele não demonstra na caixinha no nosso painel".
          //
          // Rascunho continua fora da impressão e da cozinha; quem cuida disso é
          // o GlobalPrintListener e o /api/kds, cada um com seu próprio filtro.
        },
        include: {
          items: {
            include: {
              menuProduct: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                  imageUrl: true,
                  category: true,
                  active: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      prisma.cashSession.findFirst({
        where: { franchiseeId: { in: franchiseeIds }, status: "OPEN" },
        select: { openedAt: true },
        orderBy: { openedAt: "desc" },
      }),
      prisma.motoboy.findMany({
        where: { franchiseeId: { in: franchiseeIds }, active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, phone: true },
      }),
      prisma.customerOrder.findMany({
        where: {
          franchiseeId: { in: franchiseeIds },
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    orders = ordersRes;

    motoboys = motoboysRes;
    if (cashSessionRes?.openedAt) {
      activeCashSessionOpenedAt = cashSessionRes.openedAt.toISOString();
    }
  } catch (err) {
    console.error("[PedidosClientes] Erro ao buscar pedidos/caixa/motoboys:", err);
    orders = [];
  }

  // ── O MAPA DA ROTEIRIZAÇÃO ABRE ONDE A LOJA ESTÁ ─────────────────────────
  //
  // O modal de roteirização recebe daqui o ponto da loja. Ele vinha do usuário
  // logado e, sem `storeLatLng` salvo, virava Rio das Ostras — o padrão antigo
  // do código — mesmo com o endereço cadastrado. Ver lib/ponto-da-loja-servidor.
  const idDaLojaNoMapa = franchiseeIds.length === 1 ? franchiseeIds[0] : targetFranchiseeId;
  const lojaDoMapa =
    idDaLojaNoMapa === user.id
      ? user
      : (await prisma.user
          .findUnique({
            where: { id: idDaLojaNoMapa },
            select: { id: true, storeAddress: true, city: true, storeLatLng: true },
          })
          .catch(() => null)) || user;
  // Prazo curto: esta é a tela onde a loja trabalha, e ela não pode esperar um
  // geocodificador de fora. Se não der tempo na primeira vez, o resultado cai
  // no cache e a próxima abertura (ou a aba /store/roteirizacao) já tem o ponto.
  const noMapa = await resolverLojaNoMapa(lojaDoMapa, { prazoMs: 1200 });

  return (
    <StoreOrdersDashboard
      user={{
        ...user,
        storeAddress: noMapa.endereco || user.storeAddress,
        city: noMapa.cidade || user.city,
        storeLatLng: noMapa.ponto,
      }}
      orders={orders}
      // De qual MARCA é cada pedido. Sem isto o selo da loja só saía para o
      // iFood (que grava o nome na linha do pedido) e o do 99Food vinha sem
      // marca nenhuma. Vazio quando a conta não tem o que separar.
      lojasDeOrigem={lojasDeOrigem}
      isFranqueado={user.role === "FRANCHISEE" || user.role === "STAFF"}
      initialCashSessionOpenedAt={activeCashSessionOpenedAt}
      initialMotoboys={motoboys}
      activeStoreId={activeStore || targetFranchiseeId}
    />
  );
}
