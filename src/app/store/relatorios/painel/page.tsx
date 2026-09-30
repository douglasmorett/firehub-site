import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import RelatoriosClient from "./RelatoriosClient";
import { lojasDeOrigemDaConta } from "@/lib/lojas-de-origem-da-conta";
import { lerAcerto, ganhoDoPedido } from "@/lib/ganho-do-entregador";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { canalDoPedido, chaveDoCanal } from "@/lib/canal-do-pedido";
import {
  categoriaDoItem, categoriaDoProduto, categoriasDoFiltro, escolhasDoItem, montarMapasDoRelatorio, opcoesDoItem,
} from "@/lib/itens-do-relatorio";

export const dynamic = "force-dynamic";

export default async function StoreRelatoriosPage() {
  const session = await getServerSession(authOptions).catch((err) => {
    console.error("[Relatorios] Erro ao obter sessão:", err);
    return null;
  });
  if (!session) redirect("/login");

  const role = (session.user as any)?.role;
  if (role !== "FRANCHISEE" && role !== "ADMIN" && role !== "STAFF") redirect("/login");

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: {
      id: true,
      storeName: true,
      role: true,
      ownerId: true,
      timeAlertConfig: true,
      // Para montar o filtro "de qual loja veio" (lib/lojas-de-origem-da-conta.ts).
      accountGroupId: true,
    }
  }).catch((err) => {
    console.error("[Relatorios] Erro ao buscar usuário:", err);
    return null;
  });
  if (!user) redirect("/login");

  // ── DE QUAL LOJA ────────────────────────────────────────────────────────
  // O ADMIN recebia os pedidos de TODAS as lojas do sistema (medido em
  // 24/09/2026: ~16 MB só de prop, e no ritmo atual estouraria a memória do
  // servidor em alguns meses). Agora ele vê a loja ativa do seletor, como nas
  // outras telas de admin (cookie firehub_active_store), ou a dele.
  const lojaAtivaDoAdmin = user.role === "ADMIN" ? (await cookies()).get("firehub_active_store")?.value : undefined;
  const targetFranchiseeId = lojaAtivaDoAdmin && lojaAtivaDoAdmin !== "all"
    ? lojaAtivaDoAdmin
    : (user as any).ownerId || user.id;

  const since = new Date();
  since.setDate(since.getDate() - 365); // Últimos 365 dias

  // A régua de venda é a dos relatórios novos (lib/relatorios/base.ts), com
  // uma diferença: o CANCELADO continua vindo, porque este painel conta os
  // cancelamentos. O pedido do totem esperando pagamento e o rascunho do robô
  // não são venda nem cancelamento — contavam como venda aqui.
  const franchiseeFilter = {
    franchiseeId: targetFranchiseeId,
    createdAt: { gte: since },
    status: { notIn: ["AGUARDANDO_PAGAMENTO", "CRIANDO_IA"] },
  };

  let orders: any[] = [];
  let products: any[] = [];

  try {
    orders = await prisma.customerOrder.findMany({
      where: franchiseeFilter,
      // SÓ as colunas que esta página usa. Sem o select vinham as ~90 colunas,
      // com os JSONs pesados e o QR do Pix: 3,7 KB por pedido saindo do banco
      // para 1,1 KB usados (medido em 24/09/2026) — egress do Neon pago à toa.
      // Quem lê o quê: a serialização abaixo, chaveDoCanal/canalDoPedido
      // (lib/canal-do-pedido.ts) e ganhoDoPedido (lib/ganho-do-entregador.ts).
      select: {
        id: true, franchiseeId: true, createdAt: true, status: true, totalAmount: true, deliveryFee: true,
        // `tableSessionId` e `parentOrderId`: a conta das VENDAS da régua única
        // (lib/relatorios/regua-da-venda.ts, atendimentosDaVenda) — a mesa de
        // três rodadas é uma venda, e o acréscimo é do pedido-pai.
        deliveryType: true, paymentMethod: true, source: true, tableSessionId: true, parentOrderId: true,
        ifoodStoreMerchant: true, food99AppShopId: true, food99ShopId: true,
        ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryChannel: true, openDeliveryReference: true,
        motoboyId: true, motoboyFee: true, deliveryDistance: true,
        acceptedAt: true, readyAt: true, dispatchedAt: true, deliveredAt: true,
        kdsProductionAt: true, kdsFinishingAt: true, scheduledDatetime: true,
        items: {
          include: {
            menuProduct: {
              select: {
                id: true,
                name: true,
                category: true,
                cost: true,
                // Sem `active`, todo produto de id `ifood-` seria tratado como
                // espelho — inclusive o cardápio importado que nasceu de um
                // pedido (lib/categoria-do-item.ts, ehItemDeEspelho).
                active: true,
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    const menuFilter = { franchiseeId: targetFranchiseeId };

    products = await prisma.menuProduct.findMany({
      where: menuFilter,
      select: {
        id: true,
        franchiseeId: true,
        name: true,
        category: true,
        price: true,
        cost: true,
        active: true,
        // O que `idsSoDeOpcaoDeCombo` precisa para dizer quem é complemento
        // (borda, adicional): o carimbo, os preços por canal e quem aparece
        // dentro da pergunta de algum combo. E o preço de cada opção no grupo:
        // é o valor da borda do balcão e do site, que não o gravam no pedido
        // (lib/itens-do-relatorio.ts, opcoesDoItem).
        apenasEmCombo: true,
        priceSalao: true,
        priceDelivery: true,
        priceTotem: true,
        comboGroups: {
          select: {
            items: {
              select: {
                menuProductId: true,
                additionalPrice: true,
                additionalPriceSalao: true,
                additionalPriceDelivery: true,
                additionalPriceTotem: true,
              },
            },
          },
        },
      },
      orderBy: [{ category: "asc" }, { name: "asc" }]
    });
  } catch (err) {
    console.error("[Relatorios] Erro ao carregar dados:", err);
  }

  // ── QUANTO A LOJA PAGA POR CADA ENTREGA ──────────────────────────────────
  //
  // NÃO é `deliveryFee` (o que o cliente ou o app pagou) e NÃO é `motoboyFee`
  // (que nunca chega a ser gravado: 0 de 11.388 entregas em 60 dias, medido em
  // 22/09/2026). O valor real depende do acerto de CADA entregador — diária,
  // por km, por entrega, escada própria — e a conta é a de
  // lib/ganho-do-entregador.ts, a MESMA do fechamento de motoboys. Duas contas
  // diferentes para o mesmo dinheiro é o que o lojista descobre discutindo com
  // o entregador.
  //
  // Sai daqui, no servidor, porque precisa do acerto dos entregadores e das
  // zonas da loja — dados que não devem viajar para o navegador.
  let custoPorPedido = new Map<string, number | null>();
  try {
    const dono = await prisma.user.findUnique({
      where: { id: targetFranchiseeId },
      select: { deliveryConfig: true, deliveryZones: true },
    });
    const regraDeRepasse = lerRegraDeRepasse(dono?.deliveryConfig);
    const entregadores = await prisma.motoboy.findMany({ where: { franchiseeId: targetFranchiseeId } });
    const acertoDe = new Map(entregadores.map((m) => [m.id, lerAcerto(m as any)]));

    for (const o of orders) {
      // Entrega sem entregador atribuído fica como `null`, não como zero: o
      // relatório precisa dizer "não dá para saber" em vez de afirmar que
      // custou nada. Ver o cartão de entregas no cliente.
      const acerto = o.motoboyId ? acertoDe.get(o.motoboyId) : null;
      if (!acerto) { custoPorPedido.set(o.id, null); continue; }
      custoPorPedido.set(o.id, ganhoDoPedido({
        acerto,
        pedido: o,
        regraDaLoja: regraDeRepasse,
        zonas: dono?.deliveryZones,
        ehMarketplace: canalDoPedido(o).ehMarketplace,
      }).valor);
    }
  } catch (err) {
    // Sem o custo, o relatório mostra a CONTAGEM de entregas e diz que o gasto
    // não pôde ser apurado. Nunca zero — zero é uma afirmação.
    console.error("[Relatorios] Erro ao calcular o custo das entregas:", err);
    custoPorPedido = new Map();
  }

  // A categoria de verdade de cada item e a borda que vem DENTRO da pizza —
  // o porquê está em lib/itens-do-relatorio.ts. Um mapa por loja.
  const mapasDe = montarMapasDoRelatorio(products);

  // Serializa os pedidos para passar para o Client Component
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

  const serializedOrders = orders.map(o => ({
    id: o.id,
    totalAmount: o.totalAmount,
    deliveryFee: o.deliveryFee || 0,
    status: o.status,
    deliveryType: o.deliveryType,
    paymentMethod: o.paymentMethod || "Não informado",
    source: o.source || "ONLINE",
    // A plataforma pela régua do sistema inteiro (lib/canal-do-pedido.ts) — a
    // mesma do selo do painel e da comanda. Só o `source` errava o pedido do
    // Open Delivery antigo e o de iFood gravado com outro rótulo.
    canal: chaveDoCanal(o),
    // ── DE QUAL LOJA VEIO ────────────────────────────────────────────────
    // As chaves que lib/loja-de-origem.ts lê para dizer se este pedido é da
    // Ragnar Pizza ou da Ragnar Burguer. São os MESMOS campos que o painel e
    // o roteamento de impressão usam — nada exclusivo do relatório.
    franchiseeId: o.franchiseeId,
    // Para contar VENDAS, e não lançamentos (RelatoriosClient, atendimentosDaVenda).
    tableSessionId: o.tableSessionId || null,
    parentOrderId: o.parentOrderId || null,
    ifoodStoreMerchant: o.ifoodStoreMerchant || null,
    food99AppShopId: o.food99AppShopId || null,
    food99ShopId: o.food99ShopId || null,
    // O que a LOJA paga ao entregador por este pedido. `null` = não dá para
    // saber (sem entregador atribuído) — e null não é zero.
    custoDaEntrega: custoPorPedido.has(o.id) ? custoPorPedido.get(o.id) : null,
    temEntregador: Boolean(o.motoboyId),
    createdAt: o.createdAt.toISOString(),
    // Marcos da operação (ver src/lib/order-stages.ts). Nulos nos pedidos
    // anteriores à medição — o relatório conta só o que foi medido.
    acceptedAt: iso(o.acceptedAt),
    readyAt: iso(o.readyAt),
    dispatchedAt: iso(o.dispatchedAt),
    deliveredAt: iso(o.deliveredAt),
    kdsProductionAt: iso(o.kdsProductionAt),
    kdsFinishingAt: iso(o.kdsFinishingAt),
    // O prazo do pedido agendado não é createdAt + 45min; sem isto o relatório
    // acusaria atraso em pedido que o cliente marcou para dali a duas horas.
    scheduledDatetime: iso(o.scheduledDatetime),
    items: o.items.map((i: any) => {
      const mapas = mapasDe(o.franchiseeId);
      // O canal decide em que coluna de preço a opção sem preço no pedido
      // (balcão, site, totem) foi cobrada.
      const opcoes = opcoesDoItem(i, mapas, chaveDoCanal(o));
      const escolhas = escolhasDoItem(i);
      return {
        id: i.id,
        quantity: i.quantity,
        price: i.price,
        productId: i.menuProductId,
        // O nome gravado no pedido quando o produto foi apagado (a linha dizia
        // "Produto Removido" tendo o nome ali do lado, em productName).
        productName: i.menuProduct?.name || String(i.productName || "").split(" | ")[0] || "Produto removido",
        productCategory: categoriaDoItem(i, mapas),
        productCost: i.menuProduct?.cost || 0,
        ...(opcoes.length > 0 ? { opcoes } : {}),
        ...(escolhas.length > 0 ? { escolhas } : {}),
      };
    }),
  }));

  const serializedProducts = products.map(p => {
    const { categoria, espelho } = categoriaDoProduto(p, mapasDe(p.franchiseeId));
    return {
      id: p.id,
      name: p.name,
      category: categoria,
      price: p.price,
      cost: p.cost || 0,
      active: p.active,
      espelho,
    };
  });

  const categorias = categoriasDoFiltro(serializedProducts, serializedOrders.flatMap((o) => o.items));

  // As lojas de origem da conta, com nome. Volta VAZIA quando não há o que
  // separar (uma loja no iFood, uma no 99, sem grupo) — e aí o filtro por loja
  // some da tela sozinho, em vez de oferecer uma opção só.
  const lojasDeOrigem = await lojasDeOrigemDaConta(targetFranchiseeId, (user as any).accountGroupId || null)
    .catch((err) => {
      console.error("[Relatorios] Erro ao montar as lojas de origem:", err);
      return [];
    });

  return (
    <RelatoriosClient
      orders={serializedOrders}
      products={serializedProducts}
      categorias={categorias}
      storeName={user.storeName || "Minha Loja"}
      timeAlertConfig={(user as any).timeAlertConfig || null}
      lojasDeOrigem={lojasDeOrigem}
    />
  );
}
