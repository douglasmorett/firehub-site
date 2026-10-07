/**
 * O que o cardápio público carrega do banco — o mesmo para o delivery
 * (/loja/[slug]) e para o cardápio da mesa pelo QR (/loja/[slug]/mesa/[codigo]).
 *
 * A única diferença entre os dois é o CANAL: o delivery mostra o que está
 * liberado para delivery, com o preço do delivery; a mesa mostra o que está
 * liberado para o salão (o mesmo que o garçom lança), com o preço do salão —
 * que é o preço que a conta da mesa cobra (lib/lancar-na-mesa.ts).
 */
import { prisma } from "@/lib/prisma";
import { orderByCardapio } from "@/lib/menu-order";
import { aplicarPrecoNoCardapio } from "@/lib/preco-por-canal";
import { SEM_PRODUTO_DE_INTEGRACAO, disponivelAgora, ehProdutoDeIntegracao } from "@/lib/cardapio-interno";
import { aplicarEstoqueNaVitrine, estoqueDaLojaOuVazio } from "@/lib/estoque-restante";
import { cuponsComCampanha } from "@/lib/campanha-converter";
import { filtroDoCardapio, minimoDeEstrelas } from "@/lib/avaliacoes-no-cardapio";
import { normalizarConfigFiscal } from "@/lib/fiscal-config";
import { documentoNoPedido } from "@/lib/fiscal-modo";

export const SELECT_DA_LOJA_NO_CARDAPIO = {
  id: true,
  name: true,
  storeName: true,
  storePhone: true,
  storeAddress: true,
  storeBanner: true,
  storeBannerVideo: true,
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
  // Pix pelo site (conta Asaas da loja). Só o interruptor: a chave cifrada
  // NÃO entra neste select — tudo aqui vai para o HTML do cardápio.
  pixOnlineAtivo: true,
  cartaoOnlineAtivo: true,
  showReviewsOnMenu: true,
  // A partir de quantas estrelas a avaliação aparece e conta aqui
  // (lib/avaliacoes-no-cardapio.ts).
  reviewsMinStars: true,
  showAddressOnMenu: true,
  allowScheduledOrders: true,
} as const;

export type CanalDoCardapio = "delivery" | "salao";

export async function propsDoCardapio(franchisee: any, canal: CanalDoCardapio) {
  // O CPF/CNPJ na nota fiscal (lib/fiscal-modo → documentoNoPedido): só a
  // regra pública vai para o cardápio. Lido À PARTE de propósito — o
  // fiscalConfig tem tokens cifrados e o caminho do certificado, e o
  // `franchisee` do select de cima vai inteiro para o HTML.
  const fiscal = await prisma.user.findUnique({ where: { id: franchisee.id }, select: { fiscalConfig: true } }).catch(() => null);
  const notaFiscal = documentoNoPedido(normalizarConfigFiscal(fiscal?.fiscalConfig));

  const showReviews = (franchisee as any).showReviewsOnMenu !== false;
  const avaliacoesQueEntram = filtroDoCardapio(minimoDeEstrelas((franchisee as any).reviewsMinStars));

  const [menuProducts, storeCategories, reviewsData, recentReviews] = await Promise.all([
    prisma.menuProduct.findMany({
      // activeDelivery entra no filtro porque este É o delivery. O campo existia
      // desde sempre e a tela de cadastro já oferecia o toggle, mas o cardápio
      // online nunca o consultou: desmarcar "Delivery" não tirava o item daqui.
      // Na mesa vale o do SALÃO (activeGarcom) — o que o garçom lança — e sem
      // os produtos de integração, a mesma regra de lib/lancar-na-mesa.ts.
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
      where: canal === "salao"
        ? { active: true, activeGarcom: true, franchiseeId: franchisee.id, AND: [{ NOT: { apenasEmCombo: true } }, SEM_PRODUTO_DE_INTEGRACAO] }
        : { active: true, activeDelivery: true, franchiseeId: franchisee.id, NOT: { apenasEmCombo: true } },
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
        // Consumidos logo abaixo por aplicarPrecoNoCardapio e REMOVIDOS do
        // payload: o HTML público mostra um preço só, já resolvido.
        priceDelivery: true,
        priceSalao: true,
        // Idem: vira `price` + `precoDe` (o riscado) e some do payload.
        promoPrice: true,
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
        // Idem para o horário (a marmita das 9h às 14h): sem ele no SELECT, o
        // item de horário vendia o dia todo.
        availableHours: true,
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
                additionalPriceSalao: true,
                maxPerItem: true,
                optionNote: true,
                // Meia pizza que custa conforme o tamanho (lib/meio-a-meio.ts).
                precoPorEscolha: true,
                // Promoção da opção ("só a Grande"): resolvida com o canal.
                promoAdditionalPrice: true,
                // priceSalao: a opção que é produto cobra o preço do salão na
                // conta da mesa (lib/lancar-na-mesa.ts) — a vitrine da mesa
                // tem que mostrar o mesmo. No delivery é retirado sem efeito.
                menuProduct: { select: { id: true, name: true, active: true, imageUrl: true, description: true, price: true, priceSalao: true } }
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
          where: { franchiseeId: franchisee.id, ...avaliacoesQueEntram },
          _avg: { rating: true },
          _count: { rating: true }
        })
      : Promise.resolve(null),
    showReviews
      ? prisma.storeReview.findMany({
          where: { franchiseeId: franchisee.id, comment: { not: null }, ...avaliacoesQueEntram },
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
  // quinta à noite. `disponivelAgora` decide pelo fuso da loja — o dia e,
  // desde 02/10/2026, o horário do produto (a marmita das 9h às 14h). A página
  // é cacheada por 60 s: o item entra e sai da vitrine com até 1 min de atraso,
  // e o POST do pedido confere de novo na hora de gravar.
  //
  // Item fora do dia nem entra no payload: além de não aparecer, não vai no
  // HTML público. Quem é opção DENTRO de combo continua intacto — as opções
  // vêm pela consulta aninhada, que este filtro não toca.
  // ── O ESPELHO DAS INTEGRAÇÕES NÃO É CARDÁPIO DA LOJA ────────────────────
  //
  // O canal "salao" já filtrava (SEM_PRODUTO_DE_INTEGRACAO no `where`); o
  // delivery — que é o cardápio público, o site que a loja divulga — não.
  // Resultado medido em 07/10/2026: 239 produtos da categoria "99Food" à
  // venda no site PRÓPRIO de 10 lojas, com o preço do marketplace. Na NIK
  // eram 39, e entre eles a "Esfiha Creme de Ninho com Kit Kat" que o
  // lojista tinha tirado do cardápio dele no dia anterior: ele apagava de um
  // lado e ela continuava no site pelo outro, a R$ 19,90 em vez de R$ 14,90.
  //
  // Aqui o filtro é em MEMÓRIA, não no `where`, por causa da rede de
  // segurança abaixo. E condena só pela CATEGORIA: a consulta já exige
  // `active: true`, então a regra do prefixo (que só vale para espelho
  // INATIVO) não tem como condenar cardápio real importado com id
  // `ifood-…` — o caso que já escondeu 43 itens vendáveis uma vez.
  const semEspelho = (menuProducts as any[]).filter(
    (p) => !ehProdutoDeIntegracao(p.category, p.id, p.active),
  );
  // REDE DE SEGURANÇA: loja que ainda não montou cardápio próprio e vive do
  // espelho ficaria com a página VAZIA — pior do que mostrar o espelho. A
  // DUGABURGUER estava exatamente assim (0 produtos próprios, 5 de espelho,
  // 51 pedidos em 30 dias). Sem cardápio próprio, nada muda para ela; no dia
  // em que importar o dela, o espelho sai sozinho.
  const menuSemEspelho = semEspelho.length > 0 ? semEspelho : (menuProducts as any[]);

  const menuDoDia = menuSemEspelho.filter((p) => disponivelAgora(p, franchisee.storeTimezone));

  // Estoque disponível: o que esgotou fecha, igual ao iFood. O que ainda tem
  // leva o restante junto, para o carrinho não deixar pedir mais do que há —
  // o servidor confere de novo na hora de gravar (esta página é cacheada).
  const menuComEstoque = aplicarEstoqueNaVitrine(menuDoDia, await estoqueDaLojaOuVazio(franchisee.id));

  const menuComPrecoDoCanal = aplicarPrecoNoCardapio(menuComEstoque as any[], canal);

  return {
    franchisee: {
      ...franchisee,
      // O cupom da campanha "converter para site próprio" entra na lista de
      // cupons da loja: o QR da comanda do iFood/99Food abre este cardápio
      // com ?cupom=, e o site o aplica como qualquer outro cupom
      // (lib/campanha-converter.ts). Cupom cadastrado à mão com o mesmo
      // código continua valendo o dele.
      storeCoupons: cuponsComCampanha(franchisee.storeCoupons, franchisee.storeLoyalty),
      notaFiscal,
    } as any,
    menuProducts: menuComPrecoDoCanal as any,
    storeCategories: storeCategories as any,
    storeRating,
  };
}
