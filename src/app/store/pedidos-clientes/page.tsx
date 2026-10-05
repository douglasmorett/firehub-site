import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import StoreOrdersDashboard from "@/components/customer/StoreOrdersDashboard";
import AvisosDoDia from "@/components/customer/AvisosDoDia";
import AvisoDeAcrescimo from "@/components/customer/AvisoDeAcrescimo";
import { lojasDeOrigemDaConta } from "@/lib/lojas-de-origem-da-conta";
import { resolverLojaNoMapa } from "@/lib/ponto-da-loja-servidor";
import type { LojaDeOrigem } from "@/lib/loja-de-origem";
import { MESA_DA_COMANDA } from "@/lib/mesa-na-comanda";
import { DIAS_ATIVO_SEM_PERIODO, filtroDoFeed } from "@/lib/filtro-do-feed";
import { lojasDaVisao } from "@/lib/loja-ativa";

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
  // Não depende de nada abaixo: começa já e é esperada no fim, junto com o
  // ponto do mapa — cada ida ao banco em fila era tempo a mais no clique.
  const lojasDeOrigemP: Promise<LojaDeOrigem[]> = lojasDeOrigemDaConta(
    targetFranchiseeId,
    (user as any).accountGroupId || null,
  ).catch(() => []);

  // === MULTI-LOJAS: Resolver IDs das lojas ativas ===
  const cookieStore = await cookies();
  const activeStore = cookieStore.get('firehub_active_store')?.value;

  // A loja é a da SESSÃO (a troca de loja troca a conta); o cookie só liga o
  // "Todas as Lojas" (lib/loja-ativa.ts). A mesma regra do feed
  // (/api/customer-order/poll), senão a lista inicial e a do feed divergem.
  const { lojaIds: franchiseeIds } = await lojasDaVisao(
    { id: user.id, ownerId: (user as any).ownerId, role },
    activeStore,
  );

  // O ponto da loja no mapa só depende de QUAL loja: corre em paralelo com
  // os pedidos em vez de esperar por eles.
  const idDaLojaNoMapa = franchiseeIds.length === 1 ? franchiseeIds[0] : targetFranchiseeId;
  const noMapaP = (async () => {
    const lojaDoMapa =
      idDaLojaNoMapa === user.id
        ? user
        : (await prisma.user
            .findUnique({
              where: { id: idDaLojaNoMapa },
              select: { id: true, storeAddress: true, city: true, storeLatLng: true },
            })
            .catch(() => null)) || user;
    return resolverLojaNoMapa(lojaDoMapa, { prazoMs: 1200 });
  })();
  // Falha aqui continua estourando lá embaixo, onde é esperada (como antes);
  // isto só impede o Node de tratá-la como "rejeição sem dono" enquanto os
  // pedidos ainda estão sendo lidos.
  noMapaP.catch(() => {});

  // Busca do caixa aberto, motoboys e pedidos
  let orders: any[] = [];
  let activeCashSessionOpenedAt: string | null = null;
  let motoboys: any[] = [];
  try {
    // ── A LISTA INICIAL É A MESMA DO FEED ─────────────────────────────────
    //
    // Vinham os 200 pedidos mais recentes da loja, de QUALQUER data e com
    // todas as colunas — e a tela troca essa lista inteira pela do feed
    // (/api/customer-order/poll) na primeira rodada, segundos depois. Agora a
    // abertura usa o MESMO filtro do feed (lib/filtro-do-feed.ts) na janela
    // padrão dele (últimas 24 h + o que está em andamento), que cobre tudo o
    // que a primeira rodada mostra: o que a tela "já conhecia" ao abrir
    // continua sendo o que ela conhecia antes — nada vira pedido "novo"
    // (bipe/impressão) por engano.
    const agoraDaAbertura = Date.now();
    let [ordersRes, cashSessionRes, motoboysRes] = await Promise.all([
      prisma.customerOrder.findMany({
        where: filtroDoFeed({
          validFranchiseeIds: franchiseeIds,
          from: new Date(agoraDaAbertura - 24 * 60 * 60 * 1000),
          to: new Date(agoraDaAbertura + 24 * 60 * 60 * 1000),
          ATIVO_SEM_PERIODO_DESDE: new Date(agoraDaAbertura - DIAS_ATIVO_SEM_PERIODO * 24 * 60 * 60 * 1000),
        }),
        // O filtro do feed já inclui o que estava aqui:
        //
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
        //
        // Pedido pelo site cancelado sem nunca ter sido pago fica de fora,
        // como no feed: não é cancelamento da loja (lib/pagamento-na-entrega.ts).
        include: {
          // A mesa e o garçom da conta, como no feed (/api/customer-order/poll):
          // a comanda impressa antes do primeiro poll sai igual à de depois.
          tableSession: MESA_DA_COMANDA,
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
  const [lojasDeOrigem, noMapa] = await Promise.all([lojasDeOrigemP, noMapaP]);

  return (
    <>
      {/* Cancelamento e disputa do dia: janela e som SÓ nesta tela. Montado
          no layout, abria em cima do KDS; o dono quer o aviso aqui e em mais
          lugar nenhum (25/09/2026). Regras em lib/avisos-do-dia.ts. */}
      <AvisosDoDia />
      {/* Cliente pedindo pelo WhatsApp para acrescentar num pedido que já está
          na cozinha: a loja aceita ou recusa (lib/acrescimo-do-pedido.ts). */}
      <AvisoDeAcrescimo />
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
    </>
  );
}
