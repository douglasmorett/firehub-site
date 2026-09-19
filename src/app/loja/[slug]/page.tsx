import { prisma } from "@/lib/prisma";
import { orderByCardapio } from "@/lib/menu-order";
import { aplicarPrecoNoCardapio } from "@/lib/preco-por-canal";
import { disponivelHoje, diaDaSemanaDaLoja } from "@/lib/cardapio-interno";
import { notFound, redirect } from "next/navigation";
import { slugAtualDeUmAntigo } from "@/lib/slug-da-loja";
import CustomerStorePage from "@/components/customer/CustomerStorePage";
import { cuponsComCampanha } from "@/lib/campanha-converter";

export const revalidate = 60; // ⚡ Cache de Borda (Edge) de 60 segundos


export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const franchisee = await prisma.user.findUnique({
    where: { slug },
    select: { storeName: true, name: true, city: true }
  });
  
  if (!franchisee) return { title: "Loja não encontrada" };
  
  const name = franchisee.storeName || franchisee.name;
  const descricao = franchisee.city
    ? `Peça online em ${name} — ${franchisee.city}. Cardápio, promoções e entrega.`
    : `Peça online em ${name}. Cardápio, promoções e entrega.`;

  // ── QUEM APARECE NA PRÉVIA É A LOJA ───────────────────────────────────────
  //
  // Só `title` e `description` não bastam: o WhatsApp lê as tags OpenGraph, e
  // sem um `openGraph` próprio aqui o Next herda o do layout raiz — a
  // propaganda do FireHub. O lojista mandava o link do cardápio dele e o
  // cliente via o nosso anúncio. A IMAGEM vem do opengraph-image.tsx desta
  // mesma pasta (a logo do lojista), que tem prioridade sobre este bloco.
  return {
    title: `${name} | Cardápio Online`,
    description: descricao,
    openGraph: {
      title: name,
      description: descricao,
      url: `/loja/${slug}`,
      siteName: name,
      locale: "pt_BR",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: name,
      description: descricao,
    },
  };
}

export default async function PublicStorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  
  const franchisee = await prisma.user.findUnique({
    where: { slug },
    select: { 
      id: true, 
      name: true, 
      storeName: true, 
      storePhone: true, 
      storeAddress: true, 
      storeBanner: true,
      storeLogo: true,
      storeHours: true,
      storeTimezone: true,
      storeDeliveryOnly: true,
      storeLatLng: true,
      paymentFees: true,
      deliveryZoneType: true,
      deliveryZones: true,
      deliveryConfig: true,
      storeLoyalty: true,
      storeCoupons: true,
      city: true,
      slug: true,
      storeOpen: true,
      storePause: true,
      facebookPixelId: true,
      metaPixelId: true,
      gaMeasurementId: true,
      gtmContainerId: true,
      ifoodMerchantId: true,
      ifoodConnected: true,
      ifoodWidgetId: true,
      mpSellerId: true,
      showReviewsOnMenu: true,
      showAddressOnMenu: true,
      allowScheduledOrders: true,
    }
  });

  // ── O ENDEREÇO ANTIGO CONTINUA LEVANDO À LOJA ───────────────────────
  //
  // Trocar o nome da loja troca o link do cardápio. Sem isto, o QR já
  // impresso em centenas de comandas, o link no perfil do Instagram e o
  // print salvo no WhatsApp do cliente morreriam todos na hora em que o
  // lojista corrigisse o nome — que é justamente o que a gente quer que ele
  // faça.
  if (!franchisee) {
    const atual = await slugAtualDeUmAntigo(prisma as any, slug);
    if (atual) redirect(`/loja/${atual}`);
    notFound();
  }

  const showReviews = (franchisee as any).showReviewsOnMenu !== false;

  const [menuProducts, storeCategories, reviewsData, recentReviews] = await Promise.all([
    prisma.menuProduct.findMany({
      // activeDelivery entra no filtro porque este É o delivery. O campo existia
      // desde sempre e a tela de cadastro já oferecia o toggle, mas o cardápio
      // online nunca o consultou: desmarcar "Delivery" não tirava o item daqui.
      //
      // Também é o que permite um produto existir SÓ como opção de combo (o
      // "Frango" que é sabor do mini pastel, a batata que acompanha): ele
      // precisa estar ativo para o grupo enxergá-lo — os itens do combo vêm por
      // outra query, abaixo, sem este filtro — sem virar um item solto de R$ 0,00
      // no meio do cardápio.
      // `apenasEmCombo` fora da LISTA: o molho que só existe dentro da pergunta
      // do combo aparecia como item avulso nas Entradas ("Molho BBQ R$ 4,00"
      // antes do primeiro lanche — visto na importação da Ragnar). Ele continua
      // alcançável pelos combos, porque os itens de grupo vêm ANINHADOS pelo
      // produto-pai (comboGroups → items → menuProduct), sem passar por aqui.
      // NOT em vez de `apenasEmCombo: false` para cobrir NULL de linha antiga.
      where: { active: true, activeDelivery: true, franchiseeId: franchisee.id, NOT: { apenasEmCombo: true } },
      orderBy: await orderByCardapio(),
      // SELECT explícito: com include, TODAS as colunas do produto iam
      // serializadas para o HTML público — inclusive `cost` (o CUSTO de
      // insumo do lojista, visível para qualquer concorrente com F12) e os
      // dados fiscais. Vai só o que o cardápio mostra.
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        // Consumido logo abaixo por aplicarPrecoNoCardapio e REMOVIDO do
        // payload: o HTML público mostra um preço só, já resolvido.
        priceDelivery: true,
        imageUrl: true,
        category: true,
        isCombo: true,
        comboConfig: true,
        tags: true,
        // Sem esta linha a promoção de dia específico vendia TODO DIA. O campo
        // sempre esteve gravado certo no banco (["SEG","QUA","SEX"]), mas este
        // SELECT explícito não o pedia: o produto chegava com `availableDays`
        // undefined — e "sem dias" quer dizer "todo dia". A esfirra de segunda
        // aparecia no domingo, e a saída do lojista era desativar o item na mão.
        availableDays: true,
        comboGroups: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            title: true,
            maxQty: true,
            minQty: true,
            // Como a pergunta cobra várias escolhas (pizza meio a meio cobra o
            // sabor mais caro ou a média). Sem este campo o cardápio somaria os
            // sabores e anunciaria o dobro do preço. Ver lib/preco-combo.ts.
            priceRule: true,
            sortOrder: true,
            items: {
              // A ordem escolhida pelo lojista (setinhas do cadastro).
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                additionalPrice: true,
                // Idem: resolvido abaixo e removido do payload. Nas lojas de
                // cardápio no molde iFood/Anota AI é AQUI que mora o preço —
                // o produto tem base zero e quem cobra é a opção de tamanho.
                additionalPriceDelivery: true,
                maxPerItem: true,
                optionNote: true,
                menuProduct: { select: { id: true, name: true, active: true, imageUrl: true, description: true, price: true } }
              }
            }
          }
        }
      }
    }),
    prisma.menuCategory.findMany({
      where: { franchiseeId: franchisee.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    showReviews
      ? prisma.storeReview.aggregate({
          where: { franchiseeId: franchisee.id },
          _avg: { rating: true },
          _count: { rating: true }
        })
      : Promise.resolve(null),
    showReviews
      ? prisma.storeReview.findMany({
          where: { franchiseeId: franchisee.id, comment: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 15,
          include: {
            customer: { select: { name: true } },
            order: { select: { customerName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  let storeRating = undefined;
  if (showReviews && reviewsData) {
    storeRating = {
      average: reviewsData._avg?.rating || 0,
      count: reviewsData._count?.rating || 0,
      reviews: (recentReviews || []).map((r: any) => ({
        rating: r.rating,
        comment: r.comment || "",
        customerName: r.order?.customerName || r.customer?.name || "Cliente",
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  // Este É o delivery: se a loja tem preço próprio do canal, é ele que o
  // cliente vê — e a coluna sai do payload, para o HTML público mostrar um
  // preço só. Loja sem preço por canal continua exatamente como era.
  // O corte por dia acontece AQUI, no servidor, e não no navegador do cliente:
  // `new Date().getDay()` responde pelo fuso do APARELHO de quem abre o
  // cardápio, e no render do servidor responde em UTC — depois das 21h de
  // Brasília os dois já viraram o dia, e a promoção de sexta aparecia na
  // quinta à noite. `disponivelHoje` decide pelo fuso de São Paulo.
  //
  // Item fora do dia nem entra no payload: além de não aparecer, não vai no
  // HTML público. Quem é opção DENTRO de combo continua intacto — as opções
  // vêm pela consulta aninhada, que este filtro não toca.
  const hojeNaLoja = diaDaSemanaDaLoja(franchisee.storeTimezone);
  const menuDoDia = (menuProducts as any[]).filter((p) => disponivelHoje(p.availableDays, hojeNaLoja));

  const menuComPrecoDoCanal = aplicarPrecoNoCardapio(menuDoDia as any[], "delivery");

  return (
    <CustomerStorePage
      franchisee={{
        ...franchisee,
        // O cupom da campanha "converter para site próprio" entra na lista de
        // cupons da loja: o QR da comanda do iFood/99Food abre este cardápio
        // com ?cupom=, e o site o aplica como qualquer outro cupom
        // (lib/campanha-converter.ts). Cupom cadastrado à mão com o mesmo
        // código continua valendo o dele.
        storeCoupons: cuponsComCampanha(franchisee.storeCoupons, franchisee.storeLoyalty),
      } as any}
      menuProducts={menuComPrecoDoCanal as any}
      storeCategories={storeCategories as any}
      storeRating={storeRating}
    />
  );
}