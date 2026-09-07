"use client";
import React, { useState, useRef, useEffect, useMemo, useDeferredValue } from "react";
import {
  ShoppingCart,
  Plus,
  Minus,
  X,
  MapPin,
  Search,
  Clock,
  Store,
  Truck,
  User,
  LogIn,
  History,
  Star,
  Flame,
  Gift,
  Package,
  Sparkles,
  Tag,
  ArrowRight,
  Check,
  ChevronRight,
  Trash2,
  Edit3
} from "lucide-react";
import dynamic from "next/dynamic";
// Fora do bundle inicial do cardapio: ~1.300 linhas que so entram em cena
// quando o cliente abre um produto ou paga online.
const ComboModal = dynamic(() => import("./ComboModal"), { ssr: false });
const PaymentGateway = dynamic(() => import("./PaymentGateway"), { ssr: false });
import { PAGAMENTO_ONLINE_ATIVO } from "@/lib/pagamento-online";
import { precoMinimoDoProduto, precoVariaPorEscolha } from "@/lib/preco-combo";
import FacebookPixel, { trackPixelEvent } from "./FacebookPixel";
import GoogleAnalytics, { trackGaEvent, lerGaClientId, lerGaSessionId } from "./GoogleAnalytics";
import { isStoreOpen } from "@/lib/store-hours";
import { diaDaSemanaEmSaoPaulo } from "@/lib/cardapio-interno";
import FloatingContactWidget from "@/components/FloatingContactWidget";
import "./store.css";

type MenuProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string | null;
  category: string;
  isCombo?: boolean;
  comboConfig?: any;
  comboGroups?: any[];
};

type CartItem = MenuProduct & {
  quantity: number;
  comboSelections?: any;
  notes?: string;
};

type Franchisee = {
  id: string;
  name: string;
  storeName: string | null;
  storePhone: string | null;
  storeAddress: string | null;
  storeBanner: string | null;
  storeLogo?: string | null;
  storeHours?: any;
  storeTimezone?: string | null;
  storeDeliveryOnly?: boolean;
  paymentFees?: any;
  deliveryZoneType?: string | null;
  deliveryZones?: any;
  deliveryConfig?: any;
  storeLoyalty?: any;
  storeCoupons?: any;
  showAddressOnMenu?: boolean;
  city: string | null;
  slug: string | null;
  storeOpen?: boolean;
  storePause?: any;
  facebookPixelId?: string | null;
  gaMeasurementId?: string | null;
  gtmContainerId?: string | null;
  ifoodMerchantId?: string | null;
  ifoodConnected?: boolean;
  ifoodWidgetId?: string | null;
  mpSellerId?: string | null;
  mpAccessToken?: string | null;
  hasOnlinePayment?: boolean;
};

type StoreRating = {
  average: number;
  count: number;
  reviews?: { rating: number; comment: string; customerName: string; createdAt: string }[];
};

export default function CustomerStorePage({
  franchisee,
  menuProducts,
  storeCategories,
  storeRating
}: {
  franchisee: Franchisee;
  menuProducts: MenuProduct[];
  storeCategories?: { id: string; name: string; sortOrder: number }[];
  storeRating?: StoreRating;
}) {
  // Configuração de medição do Google DESTA loja. Só o que ela preencheu na
  // tela de Integrações — nunca uma medição do FireHub.
  const gaMeasurementId = (franchisee.gaMeasurementId || "").trim() || null;
  const gtmContainerId = (franchisee.gtmContainerId || "").trim() || null;

  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCheckout, setIsCheckout] = useState(false);

  // ── SACOLA QUE SOBREVIVE ────────────────────────────────────────────────
  // O carrinho vivia só no useState: trocar de app para pegar o cupom no
  // WhatsApp, atualizar a página ou o navegador descartar a aba = sacola
  // zerada e venda perdida. Persiste por loja, com validade curta (preço de
  // cardápio muda; e quem manda no valor final é sempre o servidor).
  const cartStorageKey = `fh_cart_${franchisee.slug || franchisee.id}`;
  const cartHydrated = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(cartStorageKey);
      if (raw) {
        const salvo = JSON.parse(raw);
        if (salvo && Array.isArray(salvo.items) && salvo.items.length > 0 && Date.now() - (salvo.at || 0) < 6 * 60 * 60 * 1000) {
          setCart(salvo.items);
        }
      }
    } catch { /* storage bloqueado: segue sem persistência */ }
    cartHydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!cartHydrated.current) return;
    try {
      if (cart.length === 0) localStorage.removeItem(cartStorageKey);
      else localStorage.setItem(cartStorageKey, JSON.stringify({ at: Date.now(), items: cart }));
    } catch { /* idem */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("Todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [comboProduct, setComboProduct] = useState<MenuProduct | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [deliveryType, setDeliveryType] = useState("DELIVERY");

  // O interruptor global manda. `franchisee.hasOnlinePayment` nunca é
  // preenchido por ninguém no sistema (o campo existe na interface e não tem
  // fonte), então `undefined !== false` deixava Pix e cartão online visíveis
  // em TODOS os cardápios sem controle nenhum — inclusive agora, com a
  // credencial de teste do Mercado Pago no ar.
  const hasOnlinePayment =
    PAGAMENTO_ONLINE_ATIVO && franchisee.hasOnlinePayment !== false;
  const [paymentMethod, setPaymentMethod] = useState(() => (hasOnlinePayment ? "PIX" : "DINHEIRO"));
  // "Troco para quanto?" — sem isso o motoboy chega sem troco e a entrega
  // trava na porta. Vazio = não precisa de troco.
  const [trocoPara, setTrocoPara] = useState("");

  const [notes, setNotes] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState<{ code: string; discount: number; pct?: number; isFreeShipping?: boolean } | null>(null);
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState("");
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Modais especiais de alto engajamento
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [showPromotionsModal, setShowPromotionsModal] = useState(false);
  const [showMyOrdersModal, setShowMyOrdersModal] = useState(false);

  // Busca rápida de pedidos
  const [myOrdersPhone, setMyOrdersPhone] = useState("");
  const [myOrdersLoading, setMyOrdersLoading] = useState(false);
  const [myOrdersList, setMyOrdersList] = useState<any[]>([]);
  const [myOrdersSearched, setMyOrdersSearched] = useState(false);

  // Customer login
  const [customer, setCustomer] = useState<any>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authPhone, setAuthPhone] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [authBirthDate, setAuthBirthDate] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  // Delivery fee & Address fields
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [deliveryFeeCalculated, setDeliveryFeeCalculated] = useState(false);
  const [deliveryAvailable, setDeliveryAvailable] = useState(true);
  const [deliveryDistanceKm, setDeliveryDistanceKm] = useState<number | null>(null);
  const [deliveryMaxRadiusKm, setDeliveryMaxRadiusKm] = useState<number | null>(null);
  const [customerStreet, setCustomerStreet] = useState("");
  const [customerNumber, setCustomerNumber] = useState("");
  const [customerNeighborhood, setCustomerNeighborhood] = useState("");
  const [customerComplement, setCustomerComplement] = useState("");
  const [neighborhoodSearch, setNeighborhoodSearch] = useState("");
  const [isNeighborhoodOpen, setIsNeighborhoodOpen] = useState(false);
  const [deliveryCalculating, setDeliveryCalculating] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [copiedReferral, setCopiedReferral] = useState(false);
  const [showVipTooltip, setShowVipTooltip] = useState(false);

  // Rating
  const [showRating, setShowRating] = useState(false);
  const [ratingValue, setRatingValue] = useState(5);
  const [ratingComment, setRatingComment] = useState("");
  const [ratingOrderId, setRatingOrderId] = useState<string | null>(null);

  // Pagamento Online
  const [showPayment, setShowPayment] = useState(false);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingAmount, setPendingAmount] = useState(0);

  const storeName = franchisee.storeName || franchisee.name;
  const storeStatus = isStoreOpen(franchisee.storeHours as any, undefined, franchisee.storeTimezone);
  // Fechada AGORA por qualquer motivo: horário, chave manual ou pausa. É o
  // que desarma o botão de finalizar antes de o cliente preencher tudo.
  const lojaFechadaAgora = !storeStatus.open || franchisee.storeOpen === false;

  // Verificar pausa programada
  const isPaused = (() => {
    const p = franchisee.storePause as any;
    if (!p?.active) return false;
    const today = new Date();
    const from = new Date(p.from + "T00:00");
    const to = new Date(p.to + "T23:59");
    return today >= from && today <= to;
  })();
  const pauseInfo = franchisee.storePause as any;

  // O dia é o de SÃO PAULO, não o do aparelho de quem abre o cardápio nem o do
  // servidor (que roda em UTC e vira o dia às 21h de Brasília). Este filtro é a
  // segunda barreira: /loja/[slug] já corta a promoção fora do dia no servidor.
  const currentDayCode = diaDaSemanaEmSaoPaulo();

  const parseAvailableDays = (val: any): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === "string") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        return val.split(",").map(s => s.trim());
      }
    }
    return [];
  };

  const isAvailableToday = (p: any, dayCode: string): boolean => {
    const days = parseAvailableDays(p.availableDays);
    if (days.length === 0) return true;
    return days.map(d => d.toUpperCase()).includes(dayCode.toUpperCase());
  };

  // "99food" entrou na lista: o webhook do 99Food cria pseudo-produtos nessa
  // categoria (retratos do pedido, para a comanda) e eles estavam aparecendo
  // como uma ABA comprável no cardápio público — itens duplicados, com preço
  // congelado do dia do pedido, vendáveis de verdade.
  const isIntegrationCategory = (catName: string) => {
    if (!catName) return false;
    const c = catName.trim().toLowerCase();
    return c === "jotajá" || c === "jotaja" || c === "jota já" || c === "ifood" || c === "99food" || c.includes("jotajá") || c.includes("jotaja") || c.includes("ifood") || c.includes("99food");
  };

  const activeTodayProducts = useMemo(() => {
    return menuProducts.filter(p => isAvailableToday(p, currentDayCode) && !isIntegrationCategory(p.category));
  }, [menuProducts, currentDayCode]);

  const categories = useMemo(() => {
    const activeCats = Array.from(new Set(activeTodayProducts.map(p => (p.category || "").trim()).filter(c => c.length > 0 && !isIntegrationCategory(c))));
    
    if (storeCategories && storeCategories.length > 0) {
      const orderMap = new Map<string, number>();
      storeCategories.forEach((sc, idx) => {
        orderMap.set(sc.name.toLowerCase().trim(), sc.sortOrder ?? idx);
      });
      activeCats.sort((a, b) => {
        const orderA = orderMap.has(a.toLowerCase().trim()) ? orderMap.get(a.toLowerCase().trim())! : 999;
        const orderB = orderMap.has(b.toLowerCase().trim()) ? orderMap.get(b.toLowerCase().trim())! : 999;
        return orderA - orderB;
      });
    }
    
    return ["Todos", ...activeCats];
  }, [activeTodayProducts, storeCategories]);

  const promoProducts = useMemo(() => {
    return activeTodayProducts.filter(p => {
      const tags = (p as any).tags || "";
      const name = p.name.toLowerCase();
      const cat = (p.category || "").toLowerCase();
      return tags.includes("Promoção") || tags.includes("Oferta") || name.includes("promo") || cat.includes("promo");
    });
  }, [activeTodayProducts]);

  // DESTAQUES DA CASA: Apenas os marcados explicitamente pelo lojista
  const highlightProducts = useMemo(() => {
    return activeTodayProducts.filter(p => {
      const tags = (p as any).tags || "";
      return tags.includes("⭐ Destaque") || tags.includes("Destaque") || tags.includes("Destaque da Casa");
    });
  }, [activeTodayProducts]);

  // AVALIAÇÕES PARA O RODAPÉ (Avaliações positivas de 4 e 5 estrelas)
  const positiveReviews = useMemo(() => {
    return (storeRating?.reviews || []).filter(r => r.rating >= 4);
  }, [storeRating]);

  // Adia o filtro para depois do paint da tecla: a digitacao fica fluida
  // mesmo com cardapio grande.
  const deferredSearch = useDeferredValue(searchTerm);
  const filtered = useMemo(() => {
    if (!deferredSearch) return activeTodayProducts;
    const s = deferredSearch.toLowerCase().trim();
    return activeTodayProducts.filter(p => {
      const pCat = (p.category || "").toLowerCase();
      const pName = p.name.toLowerCase();
      const pDesc = (p.description || "").toLowerCase();
      return pName.includes(s) || pDesc.includes(s) || pCat.includes(s);
    });
  }, [activeTodayProducts, deferredSearch]);

  const grouped: Record<string, MenuProduct[]> = useMemo(() => {
    const g: Record<string, MenuProduct[]> = {};
    // Garantir ordem correta das categorias
    categories.filter(c => c !== "Todos").forEach(cat => {
      g[cat] = [];
    });
    filtered.forEach(p => {
      const cat = (p.category || "").trim();
      if (!cat) return;
      if (!g[cat]) g[cat] = [];
      g[cat].push(p);
    });
    // Remove categorias vazias
    Object.keys(g).forEach(cat => {
      if (g[cat].length === 0) delete g[cat];
    });
    return g;
  }, [filtered, categories]);

  const delivConfig = (franchisee as any)?.deliveryConfig || {};
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);

  // Pedido Mínimo da Loja — separado por tipo de recebimento.
  //
  // O mínimo existe para cobrir o custo da entrega, tanto que a descrição do
  // campo no painel fala em "pedido de entrega" e o robô do WhatsApp promete ao
  // cliente que retirada não tem mínimo. O cardápio, porém, cobrava o valor de
  // todo mundo — inclusive de quem ia buscar no balcão, que não gera custo
  // nenhum de entrega.
  //
  // `minimumOrderValuePickup` ausente = loja que nunca configurou: herda o
  // mínimo da entrega, que é exatamente como o cardápio sempre se comportou.
  // Zero = retirada sem mínimo.
  const storeMinOrderDelivery = Number(delivConfig.minimumOrderValue || 0);
  const pickupMinConfigured =
    delivConfig.minimumOrderValuePickup !== undefined &&
    delivConfig.minimumOrderValuePickup !== null &&
    delivConfig.minimumOrderValuePickup !== "";
  const storeMinOrderPickup = pickupMinConfigured
    ? Number(delivConfig.minimumOrderValuePickup) || 0
    : storeMinOrderDelivery;
  const pickupAvailable = !franchisee.storeDeliveryOnly;

  // O mínimo que vale agora é o do caminho que o cliente escolheu.
  const storeMinOrder = deliveryType === "PICKUP" ? storeMinOrderPickup : storeMinOrderDelivery;
  const isBelowMinOrder = Boolean(storeMinOrder > 0 && cartTotal > 0 && cartTotal < storeMinOrder);
  const remainingForMinOrder = storeMinOrder > 0 ? Math.max(0, storeMinOrder - cartTotal) : 0;

  // Na sacola ele ainda não escolheu como recebe, então travar pelo mínimo da
  // entrega esconderia a retirada de quem já tinha direito a ela. Aqui só
  // barra o valor que não alcança nenhum dos dois caminhos.
  const minOrderToLeaveCart = pickupAvailable
    ? Math.min(storeMinOrderDelivery, storeMinOrderPickup)
    : storeMinOrderDelivery;
  const isBelowCartMin = Boolean(minOrderToLeaveCart > 0 && cartTotal > 0 && cartTotal < minOrderToLeaveCart);
  const remainingForCartMin = minOrderToLeaveCart > 0 ? Math.max(0, minOrderToLeaveCart - cartTotal) : 0;

  // Fecha o pedido, mas só retirando. Dizer isso agora, e não no último clique
  // depois do endereço inteiro digitado.
  const somenteRetiradaPorValor = Boolean(
    pickupAvailable &&
    cartTotal > 0 &&
    storeMinOrderDelivery > storeMinOrderPickup &&
    cartTotal < storeMinOrderDelivery &&
    cartTotal >= storeMinOrderPickup
  );

  // Fidelidade, Cashback, Carimbos, Indicação & Níveis VIP
  const loyalty = (franchisee.storeLoyalty as any) || {};
  const isCashbackActive = Boolean(loyalty.cashbackActive === true && Number(loyalty.rate || 0) > 0);
  const baseCashbackRate = Number(loyalty.rate || 0);
  const cashbackMinOrder = Number(loyalty.minOrderValue || 0);
  const cashbackMaxRedeemPercent = Number(loyalty.maxRedeemPercent || 50);

  // Módulos adicionais
  const isStampsActive = Boolean(loyalty.stampsActive);
  const stampGoal = Number(loyalty.stampGoal || 10);
  const stampMinOrder = Number(loyalty.stampMinOrder || 30);
  const stampRewardValue = Number(loyalty.stampRewardValue || 25);

  const isReferralActive = Boolean(loyalty.referralActive);
  const friendDiscount = Number(loyalty.friendDiscount || 10);
  const referrerReward = Number(loyalty.referrerReward || 10);

  const isVipActive = Boolean(loyalty.vipActive);
  const bronzeCashback = Number(loyalty.bronzeCashback || 0);
  const silverMinSpend = Number(loyalty.silverMinSpend || 150);
  const silverCashback = Number(loyalty.silverCashback || 1);
  const goldMinSpend = Number(loyalty.goldMinSpend || 350);
  const goldCashback = Number(loyalty.goldCashback || 2);

  // Gastos do Cliente nos últimos 30 dias (Mês)
  const customerOrdersList = myOrdersList || [];
  const thirtyDaysAgo = useMemo(() => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), []);
  const monthlySpent = useMemo(() => {
    return customerOrdersList
      .filter(o => new Date(o.createdAt) >= thirtyDaysAgo && o.status !== "CANCELADO")
      .reduce((acc, o) => acc + (Number(o.totalAmount) || 0), 0);
  }, [customerOrdersList, thirtyDaysAgo]);

  // Carimbos acumulados
  const validStampOrders = useMemo(() => {
    return customerOrdersList.filter(o => o.status !== "CANCELADO" && (Number(o.totalAmount) >= stampMinOrder || !stampMinOrder)).length;
  }, [customerOrdersList, stampMinOrder]);
  const currentStamps = validStampOrders % stampGoal;
  const remainingStamps = Math.max(0, stampGoal - currentStamps);

  // Nível VIP do Cliente
  const vipTier = useMemo(() => {
    if (monthlySpent >= goldMinSpend && goldMinSpend > 0) {
      return {
        name: "Ouro",
        icon: "🥇",
        badge: "VIP Ouro",
        bonus: goldCashback,
        nextGoal: null,
        remaining: 0,
        nextSpend: goldMinSpend,
        color: "#92400E",
        bg: "#FEF3C7",
        border: "#FCD34D",
        progress: 100
      };
    }
    if (monthlySpent >= silverMinSpend && silverMinSpend > 0) {
      const needed = goldMinSpend - monthlySpent;
      const progress = goldMinSpend > silverMinSpend ? Math.min(100, Math.round(((monthlySpent - silverMinSpend) / (goldMinSpend - silverMinSpend)) * 100)) : 100;
      return {
        name: "Prata",
        icon: "🥈",
        badge: "VIP Prata",
        bonus: silverCashback,
        nextGoal: "Ouro",
        remaining: Math.max(0, needed),
        nextSpend: goldMinSpend,
        color: "#475569",
        bg: "#F1F5F9",
        border: "#CBD5E1",
        progress
      };
    }
    const needed = silverMinSpend - monthlySpent;
    const progress = silverMinSpend > 0 ? Math.min(100, Math.round((monthlySpent / silverMinSpend) * 100)) : 0;
    return {
      name: "Bronze",
      icon: "🥉",
      badge: "VIP Bronze",
      bonus: bronzeCashback,
      nextGoal: "Prata",
      remaining: Math.max(0, needed),
      nextSpend: silverMinSpend,
      color: "#C2410C",
      bg: "#FFF7ED",
      border: "#FFEDD5",
      progress
    };
  }, [monthlySpent, goldMinSpend, silverMinSpend, goldCashback, silverCashback, bronzeCashback]);

  // Taxa total de cashback somando o bônus VIP do cliente
  const cashbackRate = baseCashbackRate + (customer && isVipActive ? vipTier.bonus : 0);

  const [useCashback, setUseCashback] = useState(false);
  const customerCashbackBalance = Number(customer?.cashbackBalance || 0);

  const maxCashbackDiscount = Math.min(
    customerCashbackBalance,
    (cartTotal * cashbackMaxRedeemPercent) / 100
  );
  const cashbackDiscountApplied = useCashback ? maxCashbackDiscount : 0;

  const cashbackEarnedOnOrder = isCashbackActive && cartTotal >= cashbackMinOrder
    ? (cartTotal * (cashbackRate / 100))
    : 0;

  const isFreeShippingConfigActive = Boolean(delivConfig.freeShippingActive === true || delivConfig.freeShippingActive === "true");
  const freeShippingThreshold = isFreeShippingConfigActive && Number(delivConfig.freeShippingMinValue) > 0 ? Number(delivConfig.freeShippingMinValue) : null;
  const isFreeShippingByMin = Boolean(freeShippingThreshold && cartTotal >= freeShippingThreshold);
  const remainingForFreeShipping = freeShippingThreshold ? Math.max(0, freeShippingThreshold - cartTotal) : 0;
  const freeShippingProgress = freeShippingThreshold ? Math.min(100, (cartTotal / freeShippingThreshold) * 100) : 0;

  const isFreeShippingEffective = Boolean(isFreeShippingByMin || couponApplied?.isFreeShipping);
  const effectiveDeliveryFee = (deliveryType === "DELIVERY" && !isFreeShippingEffective && deliveryFeeCalculated && deliveryFee !== null)
    ? deliveryFee
    : 0;
  // Cupom percentual recalcula sobre o carrinho ATUAL — o valor gravado no
  // "Aplicar" congelava e divergia do total quando o cliente mexia na sacola.
  const discount = couponApplied
    ? (couponApplied.isFreeShipping
        ? 0
        : (couponApplied as any).pct != null
          ? cartTotal * (Number((couponApplied as any).pct) / 100)
          : couponApplied.discount)
    : 0;
  const itemsTotal = Math.max(0, cartTotal - discount - cashbackDiscountApplied);
  const finalTotal = itemsTotal + (deliveryType === "DELIVERY" && !isFreeShippingEffective && deliveryFeeCalculated && deliveryFee !== null ? deliveryFee : 0);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  const addToCart = (product: MenuProduct, cs?: any, extraSum: number = 0, qty: number = 1, itemNotes?: string) => {
    if (product.isCombo && (product.comboGroups?.length || product.comboConfig) && !cs) {
      setComboProduct(product);
      return;
    }
    const finalPrice = product.price + extraSum;
    setCart(prev => {
      if (cs) {
        return [...prev, {
          ...product,
          id: product.id + '_' + Date.now(),
          price: finalPrice,
          quantity: qty || 1,
          comboSelections: cs,
          notes: itemNotes || ""
        }];
      }
      // Produto simples COM observação vira linha própria: agrupar "sem
      // cebola" com o mesmo item sem observação apagava o recado da cozinha.
      if (itemNotes && itemNotes.trim()) {
        return [...prev, {
          ...product,
          id: product.id + '_' + Date.now(),
          price: finalPrice,
          quantity: qty || 1,
          notes: itemNotes.trim()
        }];
      }
      const ex = prev.find(i => i.id === product.id && !i.comboSelections && !(i as any).notes);
      if (ex) return prev.map(i => (i.id === product.id && !i.comboSelections && !(i as any).notes) ? { ...i, quantity: i.quantity + (qty || 1) } : i);
      return [...prev, { ...product, price: finalPrice, quantity: qty || 1 }];
    });
    trackPixelEvent("AddToCart", { content_name: product.name, value: finalPrice * (qty || 1), currency: "BRL" });
    // Mesmo momento, nomenclatura do GA4. Os nomes são os recomendados
    // (`add_to_cart`, `begin_checkout`, `purchase`): só eles alimentam os
    // relatórios de monetização e as conversões do Google Ads — nome inventado
    // entra como evento personalizado e não vira receita em lugar nenhum.
    trackGaEvent("add_to_cart", {
      currency: "BRL",
      value: finalPrice * (qty || 1),
      items: [{
        item_id: String(product.id).split("_")[0],
        item_name: product.name,
        quantity: qty || 1,
        price: finalPrice,
      }],
    });
  };

  const removeFromCart = (id: string) => setCart(prev => {
    const e = prev.find(i => i.id === id);
    if (e && e.quantity > 1) return prev.map(i => i.id === id ? { ...i, quantity: i.quantity - 1 } : i);
    return prev.filter(i => i.id !== id);
  });

  // +1 numa linha JÁ existente da sacola. O "+" chamava addToCart de novo e,
  // para combo (ou item com observação), isso criava uma LINHA DUPLICADA em
  // vez de subir a quantidade.
  const incrementInCart = (id: string) =>
    setCart(prev => prev.map(i => i.id === id ? { ...i, quantity: i.quantity + 1 } : i));

  const deleteFromCart = (id: string) => setCart(prev => prev.filter(i => i.id !== id));
  const clearCart = () => setCart([]);
  const getQty = (id: string) => cart.find(i => i.id === id)?.quantity || 0;

  // ── REPETIR UM PEDIDO ANTERIOR ────────────────────────────────────────────
  //
  // O preço NUNCA vem do pedido antigo. Cada item é reconstruído a partir do
  // produto que está no cardápio agora: se a esfirra subiu de R$ 8 para R$ 9,
  // a sacola recebe R$ 9. Repetir com o valor congelado colocaria o cliente
  // para fechar um pedido por um preço que a loja não pratica mais — e o
  // prejuízo (ou a discussão no balcão) seria do lojista.
  //
  // `comboSelections` foi gravado de formas diferentes ao longo do tempo: às
  // vezes array, às vezes string JSON, às vezes string JSON DENTRO de string.
  // Por isso o parse desenrola até duas vezes antes de desistir.
  const lerSelecoes = (bruto: any): any[] => {
    let v = bruto;
    for (let i = 0; i < 2 && typeof v === "string"; i++) {
      try { v = JSON.parse(v); } catch { return []; }
    }
    return Array.isArray(v) ? v : [];
  };

  const [resumoRepeticao, setResumoRepeticao] = useState<
    null | { adicionados: number; forasDoCardapio: string[]; mudaramDePreco: { nome: string; de: number; para: number }[] }
  >(null);

  const repetirPedido = (pedido: any) => {
    const itens = pedido?.items || [];
    if (!itens.length) return;

    const forasDoCardapio: string[] = [];
    const mudaramDePreco: { nome: string; de: number; para: number }[] = [];
    const novos: CartItem[] = [];

    for (const it of itens) {
      const idProduto = it?.menuProduct?.id;
      // O cardápio de hoje é a fonte da verdade — não o pedido antigo.
      const atual = idProduto ? menuProducts.find(p => p.id === idProduto) : undefined;
      const nome = it?.menuProduct?.name || it?.productName || "Item";

      // Saiu do cardápio ou foi desativado: não entra na sacola caladamente.
      if (!atual || it?.menuProduct?.active === false) {
        forasDoCardapio.push(nome);
        continue;
      }

      // O preço do combo é `base de hoje + adicionais escolhidos`. Conferido
      // contra pedidos reais: "Monte seu Combo" gravado a R$ 49,88 = base
      // R$ 46,90 + R$ 2,98 de adicionais, e o "Combo do Solteiro" a R$ 41,84 =
      // base de R$ 34,90 na época + R$ 6,94 — hoje a base é R$ 39,86, e é essa
      // diferença que o aviso mostra ao cliente.
      //
      // LIMITE CONHECIDO: o preço do ADICIONAL vem gravado na seleção, então um
      // adicional que mudou de preço entra pelo valor antigo. A base, que é a
      // maior parte do valor, vem sempre do cardápio atual. Para fechar isso de
      // vez seria preciso casar cada seleção com o item de combo atual — os ids
      // gravados são de origem externa e não batem com MenuProduct.
      const selecoes = lerSelecoes(it.comboSelections);
      const extraSum = selecoes.reduce(
        (s: number, sel: any) => s + (Number(sel?.price) || 0) * (Number(sel?.quantity) || 1),
        0
      );

      const precoNovo = atual.price + extraSum;
      const precoAntigo = Number(it.price) || 0;
      if (precoAntigo > 0 && Math.abs(precoNovo - precoAntigo) >= 0.01) {
        mudaramDePreco.push({ nome, de: precoAntigo, para: precoNovo });
      }

      const qtd = Number(it.quantity) || 1;
      const temCombo = selecoes.length > 0;

      novos.push({
        ...atual,
        // Combo e item com observação viram linha própria, como no addToCart:
        // agrupar pelo id do produto misturaria escolhas diferentes do mesmo combo.
        id: temCombo || it.notes ? `${atual.id}_${Date.now()}_${novos.length}` : atual.id,
        price: precoNovo,
        quantity: qtd,
        ...(temCombo ? { comboSelections: selecoes } : {}),
        ...(it.notes ? { notes: String(it.notes) } : {}),
      } as CartItem);
    }

    if (novos.length === 0) {
      setResumoRepeticao({ adicionados: 0, forasDoCardapio, mudaramDePreco });
      return;
    }

    setCart(prev => {
      const copia = [...prev];
      for (const n of novos) {
        // Item simples e sem observação soma na linha existente, em vez de
        // criar duas linhas iguais quando o cliente repete com a sacola cheia.
        const iguais = !n.comboSelections && !n.notes;
        const idx = iguais ? copia.findIndex(i => i.id === n.id && !i.comboSelections && !(i as any).notes) : -1;
        if (idx >= 0) copia[idx] = { ...copia[idx], quantity: copia[idx].quantity + n.quantity };
        else copia.push(n);
      }
      return copia;
    });

    const valorTotal = novos.reduce((s, n) => s + n.price * n.quantity, 0);
    trackPixelEvent("AddToCart", { content_name: "Repetir pedido", value: valorTotal, currency: "BRL" });
    trackGaEvent("add_to_cart", {
      currency: "BRL",
      value: valorTotal,
      items: novos.map(n => ({
        item_id: String(n.id).split("_")[0],
        item_name: n.name,
        quantity: n.quantity,
        price: n.price,
      })),
    });

    setResumoRepeticao({ adicionados: novos.length, forasDoCardapio, mudaramDePreco });
  };

  /** O pedido mais recente que dá para repetir. */
  const ultimoPedido = myOrdersList && myOrdersList.length > 0 ? myOrdersList[0] : null;

  // Cliente identificado já chega com o histórico carregado: sem isto o botão
  // "Pedir de novo" da sacola só apareceria depois de ele abrir Pedidos e
  // buscar na mão — que é justamente o trabalho que o botão deveria poupar.
  useEffect(() => {
    const tel = customer?.phone || customerPhone;
    if (!tel || myOrdersList.length > 0 || myOrdersLoading) return;
    if (String(tel).replace(/\D/g, "").length < 8) return;
    fetchMyOrders(tel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.phone]);

  const isManualScrollRef = useRef(false);

  const scrollToCategory = (cat: string) => {
    setSelectedCategory(cat);
    isManualScrollRef.current = true;
    if (cat === "Todos") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => { isManualScrollRef.current = false; }, 600);
      return;
    }
    const el = sectionRefs.current[cat] || sectionRefs.current[cat.trim()];
    if (el) {
      const yOffset = -120;
      const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
      setTimeout(() => { isManualScrollRef.current = false; }, 600);
    } else {
      isManualScrollRef.current = false;
    }
  };

  // Scroll Spy: destaca a aba da categoria atual conforme o cliente rola a página
  useEffect(() => {
    if (searchTerm) return;
    const handleScroll = () => {
      if (isManualScrollRef.current) return;
      const scrollPos = window.scrollY + 160;
      if (scrollPos < 380) {
        if (selectedCategory !== "Todos") setSelectedCategory("Todos");
        return;
      }
      for (let i = categories.length - 1; i >= 0; i--) {
        const cat = categories[i];
        if (cat === "Todos") continue;
        const el = sectionRefs.current[cat] || sectionRefs.current[cat.trim()];
        if (el) {
          const top = el.getBoundingClientRect().top + window.pageYOffset;
          if (scrollPos >= top) {
            if (selectedCategory !== cat) setSelectedCategory(cat);
            break;
          }
        }
      }
    };

    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = 0; handleScroll(); });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (rafId) cancelAnimationFrame(rafId); };
  }, [categories, searchTerm, selectedCategory]);

  const fetchMyOrders = async (phoneToFetch?: string) => {
    const raw = phoneToFetch || myOrdersPhone || customer?.phone || customerPhone;
    if (!raw) return;
    const clean = raw.replace(/\D/g, "");
    if (clean.length < 8) return;
    setMyOrdersLoading(true);
    setMyOrdersSearched(true);
    try {
      // A loja vai junto: a rota passou a escopar a busca por ela (sem isso,
      // o telefone puxava pedidos de TODAS as lojas — dado de cliente alheio).
      const res = await fetch(
        `/api/store-customer?phone=${encodeURIComponent(clean)}&franchiseeId=${encodeURIComponent(franchisee.id)}`
      );
      if (res.ok) {
        const d = await res.json();
        setMyOrdersList(d.orders || []);
      }
    } catch {
      // ignore
    } finally {
      setMyOrdersLoading(false);
    }
  };

  const applyCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError("");
    const cleanCode = couponCode.trim().toUpperCase();
    const storeCoupons = (franchisee as any).storeCoupons || [];
    const found = storeCoupons.find((c: any) => c.code?.toUpperCase() === cleanCode && c.active !== false);

    if (found) {
      if (found.minOrderValue && cartTotal < found.minOrderValue) {
        setCouponError(`⚠️ Válido para pedidos a partir de R$ ${Number(found.minOrderValue).toFixed(2).replace(".", ",")}.`);
        setCouponApplied(null);
        setCouponLoading(false);
        return;
      }
      if (found.type === "free_shipping") {
        setCouponApplied({ code: found.code, discount: deliveryFee || 0, isFreeShipping: true });
      } else if (found.type === "fixed") {
        const fixedVal = typeof found.discount === "number" ? found.discount : 10;
        setCouponApplied({ code: found.code, discount: fixedVal, isFreeShipping: false });
      } else {
        const pct = typeof found.discount === "number" ? found.discount : 10;
        setCouponApplied({ code: found.code, discount: cartTotal * (pct / 100), pct, isFreeShipping: false });
      }
      setCouponLoading(false);
    } else {
      try {
        const res = await fetch(`/api/validate-coupon?code=${cleanCode}&franchiseeId=${franchisee.id}`);
        if (res.ok) {
          const d = await res.json();
          if (d.minOrderValue && cartTotal < d.minOrderValue) {
            setCouponError(`⚠️ Válido para pedidos a partir de R$ ${Number(d.minOrderValue).toFixed(2).replace(".", ",")}.`);
            setCouponApplied(null);
            setCouponLoading(false);
            return;
          }
          const isFree = d.type === "free_shipping";
          const isFixed = d.type === "fixed";
          const calcDiscount = isFree ? (deliveryFee || 0) : isFixed ? (d.discount || 0) : cartTotal * ((d.discount || 10) / 100);
          setCouponApplied({ code: cleanCode, discount: calcDiscount, pct: (!isFree && !isFixed) ? (d.discount || 10) : undefined, isFreeShipping: isFree });
        } else {
          setCouponError("Cupom inválido ou expirado.");
          setCouponApplied(null);
        }
      } catch {
        setCouponError("Cupom inválido ou expirado.");
        setCouponApplied(null);
      } finally {
        setCouponLoading(false);
      }
    }
  };

  // Customer auth
  const handleAuth = async () => {
    setAuthError(""); setAuthLoading(true);
    try {
      const res = await fetch("/api/store-customer", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: authMode,
          phone: authPhone,
          password: authPassword,
          name: authName,
          birthDate: authBirthDate || null,
        })
      });
      const data = await res.json();
      if (res.ok) {
        setCustomer(data);
        setCustomerName(data.name);
        setCustomerPhone(data.phone);
        if (data.address) setCustomerAddress(data.address);
        setShowAuth(false);
        localStorage.setItem("storeCustomer", JSON.stringify({ id: data.id, phone: data.phone }));
      } else { setAuthError(data.error || "Erro"); }
    } catch { setAuthError("Erro de conexão."); }
    finally { setAuthLoading(false); }
  };

  const handleLogout = () => {
    setCustomer(null);
    localStorage.removeItem("storeCustomer");
  };

  useEffect(() => {
    const saved = localStorage.getItem("storeCustomer");
    if (saved) {
      try {
        const { phone } = JSON.parse(saved);
        if (phone) { setAuthPhone(phone); }
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (mobileCartOpen) {
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = '100%';
      return () => {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, scrollY);
      };
    }
  }, [mobileCartOpen]);

  // Botão VOLTAR do celular com a sacola aberta: fecha a etapa em vez de sair
  // do site. Checkout → volta para a sacola; sacola → cardápio.
  //
  // O efeito depende SÓ de mobileCartOpen: com isCheckout nas deps, avançar
  // para o checkout re-executava o efeito, o cleanup disparava history.back()
  // e o popstate devolvia o cliente para a sacola — o "Continuar" não saía do
  // lugar. A etapa atual vive num ref, fora do ciclo do efeito.
  const isCheckoutRef = useRef(isCheckout);
  isCheckoutRef.current = isCheckout;
  useEffect(() => {
    if (!mobileCartOpen) return;
    let fechadoPeloBack = false;
    try { window.history.pushState({ fhSacola: true }, ""); } catch {}
    const onPop = () => {
      if (isCheckoutRef.current) {
        setIsCheckout(false);
        // Devolve a entrada consumida: o próximo voltar fecha a sacola.
        try { window.history.pushState({ fhSacola: true }, ""); } catch {}
      } else {
        fechadoPeloBack = true;
        setMobileCartOpen(false);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!fechadoPeloBack) { try { window.history.back(); } catch {} }
    };
  }, [mobileCartOpen]);

  const paymentOptions = (() => {
    const base: { k: string; l: string }[] = [];
    if (hasOnlinePayment) {
      base.push(
        { k: "PIX", l: "💰 Pix (Online)" },
        { k: "CREDITO_ONLINE", l: "💳 Cartão de Crédito (Online)" }
      );
    }
    // Pix na ENTREGA (cliente paga na chave da loja quando recebe).
    // Sem isto, desligar o Pix online deixava o cardápio sem NENHUMA forma de
    // Pix — e Pix é hoje a forma mais usada. A loja perderia venda por causa
    // de uma mudança que era só para esconder o pagamento pelo site.
    //
    // A chave é PIX_ENTREGA, não PIX: "PIX" está em ONLINE_METHODS e abriria o
    // modal de pagamento online. Como o nome contém "ENTREGA", o financeiro já
    // o classifica como presencial e ele não entra no saldo do gateway.
    if (!hasOnlinePayment) {
      base.push({ k: "PIX_ENTREGA", l: "💰 Pix (na entrega)" });
    }

    base.push(
      { k: "DINHEIRO", l: "💵 Dinheiro" },
      { k: "DEBITO", l: "💳 Débito (Entrega)" },
      { k: "CREDITO", l: "💳 Crédito (Entrega)" }
    );
    const fees = franchisee.paymentFees as any;
    if (fees?.VOUCHER?.active && fees.VOUCHER.brands) {
      const activeBrands = fees.VOUCHER.brands.filter((b: any) => b.active);
      if (activeBrands.length > 0) {
        activeBrands.forEach((b: any) => {
          base.push({ k: `VOUCHER_${b.name}`, l: `🎟️ ${b.name}` });
        });
      } else {
        base.push({ k: "VOUCHER", l: "🎟️ Voucher" });
      }
    } else {
      base.push({ k: "VOUCHER", l: "🎟️ Voucher" });
    }
    return base;
  })();

  const isNeighborhoodType = franchisee.deliveryZoneType === "NEIGHBORHOOD" || (
    franchisee.deliveryZoneType !== "RADIUS" && franchisee.deliveryZoneType !== "DISTANCE" && franchisee.deliveryZoneType !== "KM" &&
    Array.isArray(franchisee.deliveryZones) && franchisee.deliveryZones.some((z: any) => z && z.name && !z.km && !z.radius)
  );

  const availableNeighborhoods = useMemo(() => {
    if (!Array.isArray(franchisee.deliveryZones)) return [];
    return (franchisee.deliveryZones as any[])
      .filter((z: any) => z && z.name)
      .map((z: any) => ({
        name: String(z.name).trim(),
        fee: Number(z.fee) || 0,
        time: z.time ? Number(z.time) : null
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [franchisee.deliveryZones]);

  const filteredNeighborhoods = useMemo(() => {
    if (!neighborhoodSearch.trim()) return availableNeighborhoods;
    const q = neighborhoodSearch.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return availableNeighborhoods.filter(n =>
      n.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q)
    );
  }, [availableNeighborhoods, neighborhoodSearch]);

  const handleUseGpsLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      alert("Geolocalização não é suportada pelo seu navegador.");
      return;
    }
    setGpsLoading(true);
    setDeliveryCalculating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          // Reverse geocode para obter rua, número e bairro
          try {
            const rev = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`, {
              headers: { "Accept-Language": "pt-BR" }
            });
            if (rev.ok) {
              const revData = await rev.json();
              const addr = revData.address || {};
              const road = addr.road || addr.pedestrian || addr.street || addr.footway || "";
              const houseNum = addr.house_number || "";
              const neigh = addr.suburb || addr.neighbourhood || addr.city_district || "";
              if (road) setCustomerStreet(road);
              if (houseNum) setCustomerNumber(houseNum);
              if (neigh && !isNeighborhoodType) setCustomerNeighborhood(neigh);
            }
          } catch (e) {
            console.warn("Reverse geocode timeout / failed:", e);
          }

          // Consultar rota api/delivery-fee com lat e lng
          const res = await fetch(`/api/delivery-fee?franchiseeId=${franchisee.id}&lat=${latitude}&lng=${longitude}`);
          if (res.ok) {
            const data = await res.json();
            if (data.available === false) {
              setDeliveryFee(0);
              setDeliveryFeeCalculated(true);
              setDeliveryAvailable(false);
              setDeliveryDistanceKm(data.distanceKm || null);
              setDeliveryMaxRadiusKm(data.maxRadiusKm || null);
              setDeliveryMessage(data.message || "Endereço fora da área de entrega da loja.");
            } else {
              setDeliveryFee(Number(data.fee) || 0);
              setDeliveryFeeCalculated(true);
              setDeliveryAvailable(true);
              setDeliveryDistanceKm(data.distanceKm || null);
              setDeliveryMaxRadiusKm(data.maxRadiusKm || null);
              setDeliveryMessage(data.message || `Distância calculada: ~${data.distanceKm} km`);
            }
          }
        } catch (err) {
          console.error(err);
        } finally {
          setGpsLoading(false);
          setDeliveryCalculating(false);
        }
      },
      (err) => {
        setGpsLoading(false);
        setDeliveryCalculating(false);
        alert("Não foi possível obter sua localização. Por favor, digite seu endereço.");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const calcDeliveryFee = async (neighborhood?: string, customAddress?: string) => {
    const neigh = neighborhood !== undefined ? neighborhood : customerNeighborhood;
    if (neighborhood !== undefined) setCustomerNeighborhood(neighborhood);

    const zones = (franchisee.deliveryZones as any[]) || [];
    const zoneType = franchisee.deliveryZoneType || "RADIUS";
    const defaultStoreFee = Number(delivConfig.deliveryFee || delivConfig.defaultFee || (Array.isArray(zones) && zones[0]?.fee) || 5);

    if (isNeighborhoodType && availableNeighborhoods.length > 0) {
      if (!neigh) {
        setDeliveryFee(null);
        setDeliveryFeeCalculated(false);
        setDeliveryAvailable(true);
        setDeliveryMessage("");
        return;
      }
      const searchTarget = neigh.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const found = availableNeighborhoods.find(z => {
        const zClean = z.name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return zClean === searchTarget || searchTarget.includes(zClean) || zClean.includes(searchTarget);
      });

      if (found) {
        setDeliveryFee(Number(found.fee) || 0);
        setDeliveryFeeCalculated(true);
        setDeliveryAvailable(true);
        setDeliveryMessage(`Bairro atendido: ${found.name}`);
      } else {
        setDeliveryFee(0);
        setDeliveryFeeCalculated(true);
        setDeliveryAvailable(false);
        setDeliveryMessage("Bairro não atendido pela loja. Selecione um bairro da lista.");
      }
      return;
    }

    const fullStreet = customerStreet.trim();
    const fullNum = customerNumber.trim();
    const fullNeigh = (neigh || customerNeighborhood || "").trim();
    const addrQuery = customAddress || `${fullStreet}, ${fullNum} - ${fullNeigh}, ${franchisee.city || ""}`.trim();

    if (!fullStreet || !fullNum || (!isNeighborhoodType && !fullNeigh) || addrQuery.length < 5) {
      setDeliveryFee(null);
      setDeliveryFeeCalculated(false);
      setDeliveryAvailable(true);
      setDeliveryMessage(isNeighborhoodType ? "Informe a rua e número." : "Informe rua, número e bairro para calcular.");
      return;
    }

    setDeliveryCalculating(true);
    try {
      const res = await fetch(
        `/api/delivery-fee?franchiseeId=${franchisee.id}&street=${encodeURIComponent(fullStreet)}&number=${encodeURIComponent(fullNum)}&neighborhood=${encodeURIComponent(fullNeigh)}&address=${encodeURIComponent(addrQuery)}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.available === false) {
          setDeliveryFee(0);
          setDeliveryFeeCalculated(true);
          setDeliveryAvailable(false);
          setDeliveryDistanceKm(data.distanceKm || null);
          setDeliveryMaxRadiusKm(data.maxRadiusKm || null);
          setDeliveryMessage(data.message || "Endereço fora da área de entrega.");
        } else {
          setDeliveryFee(data.fee !== undefined ? Number(data.fee) : defaultStoreFee);
          setDeliveryFeeCalculated(true);
          setDeliveryAvailable(true);
          setDeliveryDistanceKm(data.distanceKm || null);
          setDeliveryMaxRadiusKm(data.maxRadiusKm || null);
          setDeliveryMessage(data.message || "");
        }
      } else {
        // Sem resposta valida nao se assume taxa nem area: pede novo calculo.
        setDeliveryFee(null);
        setDeliveryFeeCalculated(false);
        setDeliveryAvailable(false);
        setDeliveryMessage("Não consegui calcular a entrega agora. Toque em Recalcular.");
      }
    } catch {
      setDeliveryFee(null);
      setDeliveryFeeCalculated(false);
      setDeliveryAvailable(false);
      setDeliveryMessage("Não consegui calcular a entrega agora. Toque em Recalcular.");
    } finally {
      setDeliveryCalculating(false);
    }
  };

  // Cálculo automático ao preencher Rua, Número e Bairro no modo Raio
  useEffect(() => {
    if (deliveryType !== "DELIVERY") return;
    if (isNeighborhoodType) return;
    const street = customerStreet.trim();
    const num = customerNumber.trim();
    const neigh = customerNeighborhood.trim();
    if (street.length < 3 || !num || neigh.length < 2) return;

    const timer = setTimeout(() => {
      calcDeliveryFee(neigh, `${street}, ${num} - ${neigh}, ${franchisee.city || ""}`.trim());
    }, 700);

    return () => clearTimeout(timer);
  }, [customerStreet, customerNumber, customerNeighborhood, deliveryType, isNeighborhoodType]);

  const ONLINE_METHODS = ["PIX", "CREDITO_ONLINE", "ONLINE", "MERCADOPAGO", "CARTAO_ONLINE"];

  const submitReview = async () => {
    if (!ratingOrderId) return;
    try {
      const res = await fetch("/api/order-review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: ratingOrderId, rating: ratingValue, comment: ratingComment, customerName: customer?.name || customerName || "Cliente" })
      });
      if (res.ok) {
        alert("Obrigado pela sua avaliação! ⭐");
        setShowRating(false);
      }
    } catch { alert("Erro ao enviar avaliação."); }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    // Primeiro de tudo: fechou, não cria pedido — com o motivo e o horário,
    // não um "Loja fechada.." genérico depois do formulário inteiro.
    if (lojaFechadaAgora) {
      alert(`🔴 A loja está fechada agora${!storeStatus.open && storeStatus.text ? ` — ${storeStatus.text}` : ""}. Seus itens ficam na sacola para quando abrir!`);
      return;
    }
    if (storeMinOrder > 0 && cartTotal < storeMinOrder) {
      const qual = deliveryType === "PICKUP" ? "para retirada" : "para entrega";
      const saidaPelaRetirada =
        deliveryType === "DELIVERY" && pickupAvailable && cartTotal >= storeMinOrderPickup
          ? ` Se preferir, escolha "Retirar no Balcão" — o mínimo ${storeMinOrderPickup > 0 ? `é de R$ ${storeMinOrderPickup.toFixed(2).replace(".", ",")}` : "não se aplica"} nesse caso.`
          : "";
      alert(`⚠️ O pedido mínimo desta loja ${qual} é de R$ ${storeMinOrder.toFixed(2).replace(".", ",")}. Por favor, adicione mais R$ ${remainingForMinOrder.toFixed(2).replace(".", ",")} em itens para continuar.${saidaPelaRetirada}`);
      return;
    }
    if (!customerName.trim()) { alert("Por favor, informe seu nome."); return; }
    if (!customerPhone.trim()) { alert("Por favor, informe seu WhatsApp / telefone."); return; }
    let finalAddress = "";
    if (deliveryType === "DELIVERY") {
      if (isNeighborhoodType && availableNeighborhoods.length > 0) {
        if (!customerNeighborhood.trim() || !deliveryFeeCalculated) {
          alert("⚠️ Por favor, selecione seu Bairro na lista de bairros atendidos pela loja.");
          return;
        }
      } else {
        if (!customerNeighborhood.trim()) {
          alert("Por favor, informe seu Bairro de entrega.");
          return;
        }
      }
      if (!customerStreet.trim()) { alert("Por favor, informe a Rua / Logradouro de entrega."); return; }
      if (!customerNumber.trim()) { alert("Por favor, informe o Número do endereço."); return; }
      if (!deliveryAvailable) {
        alert(deliveryMessage || "Este endereço está fora da área de entrega da loja. Por favor, revise o endereço ou escolha 'Retirar no Balcão'.");
        return;
      }
      if (!deliveryFeeCalculated && !isFreeShippingEffective) {
        alert("⚠️ Por favor, aguarde o cálculo da taxa de entrega do seu endereço.");
        return;
      }
      finalAddress = `${customerStreet.trim()}, ${customerNumber.trim()} - ${customerNeighborhood.trim()}${customerComplement.trim() ? ` (${customerComplement.trim()})` : ""}`;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/customer-order", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          franchiseeId: franchisee.id,
          franchiseeSlug: franchisee.slug,
          customerName, customerPhone,
          customerAddress: deliveryType === "DELIVERY" ? finalAddress : null,
          deliveryType, paymentMethod, notes,
          // Troco em dinheiro: vai para a cozinha/motoboy junto do pedido.
          changeAmount: (() => {
            if (paymentMethod !== "DINHEIRO" || !trocoPara.trim()) return null;
            const v = parseFloat(trocoPara.replace(",", "."));
            return Number.isFinite(v) && v >= finalTotal ? v : null;
          })(),
          deliveryFee: effectiveDeliveryFee,
          couponCode: couponApplied?.code || null,
          cashbackUsed: cashbackDiscountApplied > 0 ? cashbackDiscountApplied : 0,
          items: cart.map(i => ({ menuProductId: i.id.split("_")[0], quantity: i.quantity, comboSelections: i.comboSelections || null, notes: i.notes || "" })),
          // Cookies do GA4 desta pessoa. O `purchase` que o SERVIDOR manda
          // (src/lib/ga-purchase.ts) precisa deles para cair no mesmo visitante
          // e na mesma sessão — sem eles a venda vira "Direct" e o anúncio que
          // trouxe o cliente não leva o crédito.
          gaClientId: lerGaClientId(),
          gaSessionId: lerGaSessionId(gaMeasurementId),
        })
      });
      if (res.ok) {
        const d = await res.json();
        // O `eventID` é o que faz o Meta entender que este Purchase e o que o
        // SERVIDOR manda (src/lib/meta-purchase.ts) são o MESMO evento, e contar
        // uma venda só. Sem ele, toda venda contaria duas vezes — o ROAS dobra
        // e o algoritmo aprende errado.
        //
        // `content_ids` habilita o Anúncio Dinâmico: é o que permite o anúncio
        // mostrar exatamente o prato que a pessoa olhou.
        trackPixelEvent(
          "Purchase",
          {
            value: finalTotal,
            currency: "BRL",
            order_id: d.orderId,
            content_type: "product",
            content_ids: cart.map(i => i.id.split("_")[0]),
            contents: cart.map(i => ({ id: i.id.split("_")[0], quantity: i.quantity })),
            num_items: cart.reduce((s, i) => s + i.quantity, 0),
          },
          `purchase:${d.orderId}`
        );
        // No GA4 quem impede a venda de entrar duas vezes é o `transaction_id`:
        // o navegador e o servidor mandam o MESMO id (o do pedido), e o GA4
        // descarta a transação repetida.
        trackGaEvent("purchase", {
          transaction_id: d.orderId,
          currency: "BRL",
          value: finalTotal,
          shipping: effectiveDeliveryFee || 0,
          items: cart.map(i => ({
            item_id: i.id.split("_")[0],
            item_name: i.name,
            quantity: i.quantity,
            price: i.price,
          })),
        });
        const pmUpper = (paymentMethod || "").toUpperCase();
        // Comparação EXATA: com includes(), "PIX_ENTREGA".includes("PIX") era
        // true e o cliente do pagamento na entrega caía no modal do gateway —
        // que está desligado — com o pedido JÁ criado na cozinha.
        const isOnline = ONLINE_METHODS.includes(pmUpper);
        if (isOnline) {
          setPendingOrderId(d.orderId);
          setPendingAmount(finalTotal);
          setShowPayment(true);
          // Mantém os itens no carrinho até a confirmação do pagamento
        } else {
          setOrderSuccess(d.orderId);
          setCart([]);
          setIsCheckout(false);
          setMobileCartOpen(false);
        }
      } else { const d = await res.json(); alert(d.error || "Erro."); }
    } catch { alert("Erro ao conectar."); } finally { setLoading(false); }
  };

  // ===== ORDER TRACKING =====
  const [trackingStatus, setTrackingStatus] = useState("NOVO");
  const STATUSES = [
    { key: "NOVO", label: "Pedido Enviado", icon: "📩", desc: "Aguardando confirmação da loja" },
    { key: "ACEITO", label: "Aceito", icon: "✅", desc: "A loja confirmou seu pedido" },
    { key: "PREPARANDO", label: "Preparando", icon: "👨‍🍳", desc: "Seu pedido está sendo preparado" },
    { key: "SAIU_ENTREGA", label: "Saiu para Entrega", icon: "🛵", desc: "O entregador está a caminho" },
    { key: "ENTREGUE", label: "Entregue", icon: "🎉", desc: "Pedido finalizado. Bom apetite!" },
    { key: "CANCELADO", label: "Cancelado", icon: "❌", desc: "Pedido cancelado pela loja" },
  ];

  useEffect(() => {
    if (!orderSuccess) return;
    const poll = setInterval(async () => {
      // Em segundo plano nao gasta bateria/rede do cliente.
      if (document.visibilityState === "hidden") return;
      try {
        const r = await fetch(`/api/customer-order/status?id=${orderSuccess}`);
        if (r.ok) {
          const d = await r.json();
          setTrackingStatus(d.status);
          // Estado final: nada mais vai mudar — para de consultar.
          if (d.status === "ENTREGUE" || d.status === "CANCELADO") clearInterval(poll);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(poll);
  }, [orderSuccess]);

  if (orderSuccess) {
    const currentIdx = STATUSES.findIndex(s => s.key === trackingStatus);
    const isCancelled = trackingStatus === "CANCELADO";
    const isDelivered = trackingStatus === "ENTREGUE";

    return (
      <div className="order-success-bg">
        <div className="order-success-card" style={{ maxWidth: "420px" }}>
          <div className="order-success-icon">{isCancelled ? "❌" : isDelivered ? "🎉" : "📦"}</div>
          <h1 className="order-success-title">{isCancelled ? "Pedido Cancelado" : isDelivered ? "Pedido Entregue!" : "Acompanhe seu Pedido"}</h1>
          <p className="order-success-sub">Pedido recebido por <strong>{storeName}</strong></p>
          <div className="order-code-box">
            <p className="order-code-label">Código do Pedido</p>
            <p className="order-code">#{orderSuccess.slice(-6).toUpperCase()}</p>
          </div>

          {!isCancelled && (
            <div style={{ margin: "1.25rem 0", textAlign: "left" }}>
              {STATUSES.filter(s => s.key !== "CANCELADO").map((s, i) => {
                const done = i <= currentIdx;
                const active = i === currentIdx;
                return (
                  <div key={s.key} style={{ display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: i < 4 ? "0" : "0" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "32px" }}>
                      <div style={{
                        width: "32px", height: "32px", borderRadius: "50%",
                        background: done ? "linear-gradient(135deg, #16A34A, #22C55E)" : "#E2E8F0",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "0.9rem", color: done ? "white" : "#94A3B8",
                        boxShadow: active ? "0 0 0 4px rgba(22,163,74,0.2)" : "none",
                        transition: "all 0.3s ease",
                        animation: active ? "pulse 2s infinite" : "none"
                      }}>{done ? "✓" : (i + 1)}</div>
                      {i < 4 && <div style={{ width: "2px", height: "28px", background: done && i < currentIdx ? "#22C55E" : "#E2E8F0", transition: "all 0.3s" }} />}
                    </div>
                    <div style={{ paddingTop: "4px", paddingBottom: i < 4 ? "12px" : "0" }}>
                      <p style={{ fontWeight: active ? 800 : 600, fontSize: "0.85rem", color: done ? "#111" : "#94A3B8" }}>
                        {s.icon} {s.label}
                      </p>
                      {active && <p style={{ fontSize: "0.72rem", color: "#666", marginTop: "2px" }}>{s.desc}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {isCancelled && (
            <p style={{ color: "#EF4444", fontWeight: 600, fontSize: "0.85rem", margin: "1rem 0" }}>
              A loja cancelou este pedido. Entre em contato para mais informações.
            </p>
          )}

          {!isDelivered && !isCancelled && (
            <p style={{ fontSize: "0.72rem", color: "#999", textAlign: "center" }}>🔄 Atualizando automaticamente...</p>
          )}

          {franchisee.storePhone && <a href={`https://wa.me/55${franchisee.storePhone.replace(/\D/g, "")}`} target="_blank" className="order-whatsapp">💬 Falar no WhatsApp</a>}

          {!isCancelled && (
            <a
              href={`/loja/${franchisee.slug}/pedido/${orderSuccess}`}
              style={{
                display: "block", width: "100%", padding: "12px", borderRadius: "14px",
                background: "linear-gradient(135deg, #1E293B, #0F172A)", color: "#fff",
                fontWeight: 700, fontSize: "0.9rem", textAlign: "center", textDecoration: "none",
                marginBottom: "8px", boxSizing: "border-box",
              }}
            >
              📍 Abrir Rastreamento ao Vivo
            </a>
          )}
          <button onClick={() => { setOrderSuccess(null); setTrackingStatus("NOVO"); }} className="order-new-btn">Fazer Novo Pedido</button>
        </div>
      </div>
    );
  }

  // ===== CART SIDEBAR CONTENT =====
  const cartContentJSX = (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, height: "100%", overflow: "hidden" }}>
      {/* BANNER GAMIFICADO DE FRETE GRÁTIS */}
      {freeShippingThreshold && (
        <div style={{
          padding: "10px 14px",
          background: isFreeShippingByMin ? "linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)" : "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)",
          borderBottom: isFreeShippingByMin ? "1.5px solid #86EFAC" : "1.5px dashed #FDE68A",
          flexShrink: 0,
          textAlign: "left",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", marginBottom: "5px" }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 800, color: isFreeShippingByMin ? "#166534" : "#92400E", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>{isFreeShippingByMin ? "🎉" : "🚚"}</span>
              {isFreeShippingByMin ? (
                <span><strong>PARABÉNS!</strong> Você ganhou <strong style={{ color: "#16A34A" }}>FRETE GRÁTIS!</strong></span>
              ) : (
                <span>Faltam <strong style={{ color: "#D97706", fontSize: "0.9rem" }}>R$ {remainingForFreeShipping.toFixed(2).replace(".", ",")}</strong> para <strong style={{ color: "#16A34A" }}>FRETE GRÁTIS!</strong></span>
              )}
            </div>
            <span style={{ fontSize: "0.72rem", fontWeight: 800, color: isFreeShippingByMin ? "#166534" : "#B45309", background: isFreeShippingByMin ? "#BBF7D0" : "#FEF08A", padding: "2px 6px", borderRadius: "10px" }}>
              {Math.round(freeShippingProgress)}%
            </span>
          </div>
          <div style={{ width: "100%", height: "6px", backgroundColor: isFreeShippingByMin ? "#BBF7D0" : "#FDE68A", borderRadius: "999px", overflow: "hidden" }}>
            <div style={{
              width: `${Math.max(4, freeShippingProgress)}%`,
              height: "100%",
              background: isFreeShippingByMin ? "linear-gradient(90deg, #22C55E 0%, #16A34A 100%)" : "linear-gradient(90deg, #F59E0B 0%, #10B981 100%)",
              borderRadius: "999px",
              transition: "width 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
            }} />
          </div>
        </div>
      )}

      {/* HEADER DA SACOLA */}
      <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {isCheckout && (
            <button
              type="button"
              onClick={() => setIsCheckout(false)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#64748B", padding: "2px 4px", fontSize: "0.82rem", fontWeight: 700, display: "flex", alignItems: "center" }}
              title="Voltar para a sacola"
            >
              ← Voltar
            </button>
          )}
          <h3 style={{ margin: 0, fontWeight: 800, fontSize: "1.05rem", color: "#0F172A" }}>
            {isCheckout ? "Finalizar Pedido" : "Sua sacola"}
          </h3>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {!isCheckout && cart.length > 0 && (
            <button
              type="button"
              // Um toque aqui apagava a sacola INTEIRA sem perguntar — e o
              // botão fica a um dedo do X de fechar. Confirmação obrigatória.
              onClick={() => { if (window.confirm("Esvaziar a sacola? Todos os itens serão removidos.")) clearCart(); }}
              style={{ background: "none", border: "none", color: "#64748B", fontWeight: 800, fontSize: "0.75rem", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.04em", padding: "10px 8px" }}
            >
              Limpar
            </button>
          )}
          <button className="mob-close-btn" onClick={() => setMobileCartOpen(false)} style={{ cursor: "pointer", background: "none", border: "none" }}><X size={20} /></button>
        </div>
      </div>

      {/* CORPO DA SACOLA COM ROLAGEM INDEPENDENTE */}
      <div className="cart-body" style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem", minHeight: 0 }}>
        {!isCheckout ? (
          cart.length === 0 ? (
            <div className="cart-empty" style={{ padding: "2.5rem 1rem", textAlign: "center", color: "#94A3B8" }}>
              <ShoppingCart size={42} style={{ opacity: 0.3, marginBottom: "8px" }} />
              <p style={{ fontWeight: 700, fontSize: "0.95rem", color: "#64748B", margin: "0 0 4px" }}>Sua sacola está vazia</p>
              <p style={{ fontSize: "0.8rem", margin: 0 }}>Adicione itens do cardápio para começar seu pedido.</p>

              {/* ── REPETIR O ÚLTIMO PEDIDO ────────────────────────────────────
                  Sacola vazia é onde o cliente que já comprou aqui está a um
                  clique de comprar de novo. Quem tem pedido carregado repete
                  direto; quem não está identificado recebe o convite para
                  entrar, em vez de um vazio sem saída. */}
              {ultimoPedido ? (
                <div style={{ marginTop: 20, borderTop: "1px dashed #E2E8F0", paddingTop: 18 }}>
                  <p style={{ fontSize: "0.8rem", color: "#475569", margin: "0 0 10px", lineHeight: 1.5 }}>
                    Seu último pedido foi<br />
                    <strong style={{ color: "#0F172A" }}>
                      {(ultimoPedido.items || [])
                        .slice(0, 3)
                        .map((it: any) => `${it.quantity}x ${it.menuProduct?.name || it.productName || "item"}`)
                        .join(", ")}
                      {(ultimoPedido.items || []).length > 3 && ` +${(ultimoPedido.items || []).length - 3}`}
                    </strong>
                  </p>
                  <button
                    onClick={() => repetirPedido(ultimoPedido)}
                    style={{
                      width: "100%", padding: "12px", borderRadius: 12, border: "none",
                      background: "#059669", color: "#fff", fontWeight: 800,
                      fontSize: "0.88rem", cursor: "pointer",
                    }}
                  >
                    🔁 Pedir de novo
                  </button>
                  <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "8px 0 0", lineHeight: 1.4 }}>
                    Os itens entram na sacola pelo preço de hoje.
                  </p>
                </div>
              ) : (
                <div style={{ marginTop: 20, borderTop: "1px dashed #E2E8F0", paddingTop: 18 }}>
                  <p style={{ fontSize: "0.8rem", color: "#475569", margin: "0 0 10px", lineHeight: 1.5 }}>
                    Já pediu aqui antes?
                  </p>
                  <button
                    onClick={() => {
                      if (customer) {
                        // Já identificado: só faltava carregar o histórico.
                        fetchMyOrders(customer?.phone || customerPhone);
                        setShowMyOrdersModal(true);
                      } else {
                        setAuthMode("login");
                        setShowAuth(true);
                      }
                    }}
                    style={{
                      width: "100%", padding: "12px", borderRadius: 12,
                      border: "1.5px solid #059669", background: "#F0FDF4",
                      color: "#047857", fontWeight: 800, fontSize: "0.85rem", cursor: "pointer",
                    }}
                  >
                    {customer ? "🔁 Ver meus pedidos e repetir" : "Entre na sua conta e repita seu último pedido"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {cart.map(item => {
                const itemTotal = item.price * item.quantity;
                const formattedSelections = item.comboSelections ? Object.entries(item.comboSelections).flatMap(([_, gObj]: any) => Object.entries(gObj).filter(([_, q]) => (q as number) > 0).map(([name, q]) => `${(q as number) > 1 ? `${q}x ` : ""}${name}`)) : [];

                return (
                  <div
                    key={item.id}
                    style={{
                      background: "#FFFFFF",
                      border: "1.5px solid #E2E8F0",
                      borderRadius: "14px",
                      padding: "12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.02)"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A", lineHeight: 1.3 }}>
                          {item.quantity}x {item.name}
                        </div>
                        {formattedSelections.length > 0 && (
                          <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: "3px", lineHeight: 1.35 }}>
                            {formattedSelections.map((sel, sIdx) => (
                              <div key={sIdx}>• {sel}</div>
                            ))}
                          </div>
                        )}
                        {item.notes && (
                          <div style={{ fontSize: "0.72rem", color: "#92400E", backgroundColor: "#FEF3C7", padding: "2px 6px", borderRadius: "4px", marginTop: "4px", display: "inline-block" }}>
                            📝 {item.notes}
                          </div>
                        )}
                      </div>

                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>
                          R$ {itemTotal.toFixed(2).replace(".", ",")}
                        </div>
                        {item.imageUrl && (
                          <img src={item.imageUrl} alt={item.name} style={{ width: "38px", height: "38px", objectFit: "cover", borderRadius: "8px", marginTop: "4px" }} />
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "4px", borderTop: "1px dashed #F1F5F9" }}>
                      <button
                        onClick={() => deleteFromCart(item.id)}
                        style={{ background: "none", border: "none", color: "#94A3B8", fontSize: "0.8rem", cursor: "pointer", padding: "8px 0", fontWeight: 600 }}
                      >
                        Remover
                      </button>

                      <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", backgroundColor: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: "999px", padding: "3px 6px" }}>
                        <button
                          type="button"
                          onClick={() => removeFromCart(item.id)}
                          style={{
                            width: "34px",
                            height: "34px",
                            minWidth: "34px",
                            minHeight: "34px",
                            maxWidth: "34px",
                            maxHeight: "34px",
                            borderRadius: "50%",
                            background: "#FFFFFF",
                            border: "1.5px solid #CBD5E1",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            padding: 0,
                            margin: 0,
                            flexShrink: 0,
                            lineHeight: 1,
                            boxSizing: "border-box",
                            color: "#475569",
                            fontWeight: 800,
                            fontSize: "0.85rem",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                          }}
                          title="Diminuir"
                        >
                          -
                        </button>
                        <span style={{ fontSize: "0.88rem", fontWeight: 800, minWidth: "18px", textAlign: "center", color: "#0F172A" }}>
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => incrementInCart(item.id)}
                          style={{
                            width: "34px",
                            height: "34px",
                            minWidth: "34px",
                            minHeight: "34px",
                            maxWidth: "34px",
                            maxHeight: "34px",
                            borderRadius: "50%",
                            background: "#16A34A",
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            padding: 0,
                            margin: 0,
                            flexShrink: 0,
                            lineHeight: 1,
                            boxSizing: "border-box",
                            color: "#FFFFFF",
                            fontWeight: 800,
                            fontSize: "0.95rem",
                            boxShadow: "0 2px 4px rgba(22,163,74,0.3)"
                          }}
                          title="Aumentar"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* CUPOM DE DESCONTO */}
              <div style={{ marginTop: "0.25rem", padding: "0.75rem 0" }}>
                {!showCouponInput && !couponApplied ? (
                  <button
                    onClick={() => setShowCouponInput(true)}
                    style={{ background: "none", border: "none", color: "#2563EB", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", padding: 0 }}
                  >
                    🏷️ Que tal usar um cupom de desconto?
                  </button>
                ) : (
                  <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "12px", padding: "10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569" }}>Cupom de Desconto</span>
                      {!couponApplied && (
                        <button onClick={() => setShowCouponInput(false)} style={{ background: "none", border: "none", color: "#94A3B8", fontSize: "0.72rem", cursor: "pointer" }}>Cancelar</button>
                      )}
                    </div>
                    {couponApplied ? (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#DCFCE7", border: "1px solid #86EFAC", padding: "6px 10px", borderRadius: "8px" }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: "0.82rem", color: "#166534" }}>🏷️ {couponApplied.code}</div>
                          <div style={{ fontSize: "0.72rem", color: "#15803D" }}>
                            {couponApplied.isFreeShipping
                              ? "Frete Grátis Aplicado!"
                              : `Desconto de R$ ${discount.toFixed(2).replace(".", ",")}`}
                          </div>
                        </div>
                        <button onClick={() => setCouponApplied(null)} style={{ background: "none", border: "none", color: "#DC2626", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer" }}>Remover</button>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: "6px" }}>
                        <input
                          type="text"
                          placeholder="Digite seu cupom"
                          value={couponCode}
                          onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                          style={{ flex: 1, padding: "6px 10px", borderRadius: "8px", border: "1px solid #CBD5E1", fontSize: "0.82rem", textTransform: "uppercase", fontWeight: 700 }}
                        />
                        <button
                          onClick={applyCoupon}
                          disabled={couponLoading || !couponCode.trim()}
                          style={{ padding: "6px 12px", borderRadius: "8px", background: "#2563EB", color: "#FFF", border: "none", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", opacity: couponLoading || !couponCode.trim() ? 0.6 : 1 }}
                        >
                          {couponLoading ? "..." : "Aplicar"}
                        </button>
                      </div>
                    )}
                    {couponError && <p style={{ margin: "4px 0 0", color: "#DC2626", fontSize: "0.72rem", fontWeight: 600 }}>{couponError}</p>}
                  </div>
                )}
              </div>

              {/* AVISO DE PEDIDO MÍNIMO (SE HOUVER) */}
              {isBelowCartMin && (
                <div style={{
                  padding: "10px 12px",
                  background: "#FFFBEB",
                  border: "1px solid #FDE68A",
                  borderRadius: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  margin: "4px 0"
                }}>
                  <span style={{ fontSize: "1.2rem", flexShrink: 0 }}>⚠️</span>
                  <div style={{ fontSize: "0.78rem", color: "#92400E", lineHeight: 1.35 }}>
                    <div style={{ fontWeight: 800 }}>Pedido Mínimo da Loja: R$ {minOrderToLeaveCart.toFixed(2).replace(".", ",")}</div>
                    <div>Adicione mais <strong>R$ {remainingForCartMin.toFixed(2).replace(".", ",")}</strong> para continuar.</div>
                    {storeMinOrderDelivery > minOrderToLeaveCart && (
                      <div style={{ marginTop: "3px" }}>Para <strong>entrega</strong>, o mínimo é R$ {storeMinOrderDelivery.toFixed(2).replace(".", ",")}.</div>
                    )}
                  </div>
                </div>
              )}

              {/* Alcança a retirada, mas não a entrega. */}
              {somenteRetiradaPorValor && (
                <div style={{
                  padding: "10px 12px",
                  background: "#EFF6FF",
                  border: "1px solid #BFDBFE",
                  borderRadius: "12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  margin: "4px 0"
                }}>
                  <span style={{ fontSize: "1.2rem", flexShrink: 0 }}>🛍️</span>
                  <div style={{ fontSize: "0.78rem", color: "#1E40AF", lineHeight: 1.35 }}>
                    <div style={{ fontWeight: 800 }}>Abaixo de R$ {storeMinOrderDelivery.toFixed(2).replace(".", ",")} a loja não entrega.</div>
                    <div>Mas você pode <strong>retirar no balcão</strong>{storeMinOrderPickup > 0 ? ` — mínimo de R$ ${storeMinOrderPickup.toFixed(2).replace(".", ",")}` : " — sem valor mínimo"}. É só continuar.</div>
                  </div>
                </div>
              )}

              {/* CARD DE BENEFÍCIO CASHBACK SE ATIVO */}
              {isCashbackActive && cashbackEarnedOnOrder > 0 && (
                <div style={{
                  padding: "8px 12px",
                  background: "linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)",
                  border: "1px solid #A7F3D0",
                  borderRadius: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  margin: "4px 0"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", fontWeight: 700, color: "#065F46" }}>
                    <span>🎁</span>
                    <span>Cashback neste pedido:</span>
                  </div>
                  <span style={{ fontSize: "0.82rem", fontWeight: 900, color: "#059669" }}>
                    +R$ {cashbackEarnedOnOrder.toFixed(2).replace(".", ",")}
                  </span>
                </div>
              )}

              {/* RESUMO DOS VALORES */}
              <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: "0.75rem", display: "flex", flexDirection: "column", gap: "5px", fontSize: "0.84rem", color: "#64748B" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Subtotal</span>
                  <span style={{ fontWeight: 700, color: "#0F172A" }}>R$ {cartTotal.toFixed(2).replace(".", ",")}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>Taxa de entrega</span>
                  <span style={{ fontWeight: 700, color: (deliveryType === "PICKUP" || isFreeShippingByMin || couponApplied?.isFreeShipping) ? "#16A34A" : (deliveryFeeCalculated && effectiveDeliveryFee > 0) ? "#0F172A" : "#64748B" }}>
                    {deliveryType === "PICKUP" ? (
                      "Retirada no local (Grátis)"
                    ) : isFreeShippingByMin ? (
                      "Grátis 🎉"
                    ) : couponApplied?.isFreeShipping ? (
                      "Grátis (Cupom) 🎉"
                    ) : deliveryCalculating ? (
                      "Calculando..."
                    ) : (deliveryFeeCalculated && effectiveDeliveryFee > 0) ? (
                      `R$ ${effectiveDeliveryFee.toFixed(2).replace(".", ",")}`
                    ) : (deliveryFeeCalculated && effectiveDeliveryFee === 0) ? (
                      "Grátis 🎉"
                    ) : (
                      <span style={{ fontStyle: "italic", color: "#94A3B8", fontWeight: 600 }}>A calcular no endereço</span>
                    )}
                  </span>
                </div>
                {discount > 0 && !couponApplied?.isFreeShipping && (
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#16A34A" }}>
                    <span>Desconto</span>
                    <span style={{ fontWeight: 700 }}>- R$ {discount.toFixed(2).replace(".", ",")}</span>
                  </div>
                )}
                {cashbackDiscountApplied > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#7C3AED" }}>
                    <span>Desconto Cashback</span>
                    <span style={{ fontWeight: 700 }}>- R$ {cashbackDiscountApplied.toFixed(2).replace(".", ",")}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.05rem", fontWeight: 900, color: "#0F172A", marginTop: "4px", paddingTop: "6px", borderTop: "1px dashed #E2E8F0" }}>
                  <span>Total</span>
                  <span>R$ {finalTotal.toFixed(2).replace(".", ",")}</span>
                </div>
              </div>
            </div>
          )
        ) : (
          /* TELA DE IDENTIFICAÇÃO E FINALIZAÇÃO COM CAMPOS SEPARADOS */
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* TIPO DE ENTREGA */}
            <div>
              <label className="checkout-label">Como deseja receber seu pedido? *</label>
              <div className="checkout-type-row">
                <button
                  type="button"
                  onClick={() => {
                    // Trocar para entrega abaixo do mínimo dela levaria o
                    // cliente a preencher o endereço todo para só então
                    // descobrir que não fecha.
                    if (storeMinOrderDelivery > 0 && cartTotal < storeMinOrderDelivery) {
                      alert(`⚠️ Para entrega, o pedido mínimo é de R$ ${storeMinOrderDelivery.toFixed(2).replace(".", ",")} — faltam R$ ${(storeMinOrderDelivery - cartTotal).toFixed(2).replace(".", ",")}. Você pode adicionar mais itens ou seguir com a retirada no balcão.`);
                      return;
                    }
                    setDeliveryType("DELIVERY");
                    if (isNeighborhoodType) {
                      if (customerNeighborhood) calcDeliveryFee(customerNeighborhood);
                      else { setDeliveryFee(null); setDeliveryFeeCalculated(false); }
                    } else {
                      if (customerStreet && customerNumber) calcDeliveryFee(customerNeighborhood);
                      else { setDeliveryFee(null); setDeliveryFeeCalculated(false); }
                    }
                  }}
                  className={`checkout-type-btn ${deliveryType === "DELIVERY" ? "active" : ""}`}
                >
                  🛵 Entrega (Delivery)
                </button>
                {/* Loja "Somente Delivery" não oferece retirada: o botão
                    existia mesmo assim e o cliente escolhia um modo que a
                    loja não atende. */}
                {!franchisee.storeDeliveryOnly && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeliveryType("PICKUP");
                      setDeliveryFee(0);
                      setDeliveryFeeCalculated(true);
                      setDeliveryAvailable(true);
                      setDeliveryMessage("Retirada no balcão selecionada.");
                    }}
                    className={`checkout-type-btn ${deliveryType === "PICKUP" ? "active" : ""}`}
                  >
                    🛍️ Retirar no Balcão
                  </button>
                )}
              </div>
            </div>

            {/* SEU NOME */}
            <div>
              <label className="checkout-label">Seu Nome Completo *</label>
              <input
                className="checkout-input"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder="Ex: Maria Silva"
              />
            </div>

            {/* SEU WHATSAPP */}
            <div>
              <label className="checkout-label">Seu WhatsApp (com DDD) *</label>
              <input
                className="checkout-input"
                type="tel"
                maxLength={16}
                autoComplete="tel"
                value={customerPhone}
                // A classe estava `[^ds()+-]`, sem as barras: em vez de "tudo que
                // não for dígito ou espaço", ela lia "tudo que não for a letra d,
                // a letra s ou um destes símbolos" — e apagava TODOS OS DÍGITOS.
                // Digitar "(22) 99999-8888" resultava em "()-". O campo é
                // obrigatório, então o cardápio inteiro parou de fechar pedido em
                // todas as lojas desde 27/08, e a loja só descobriu porque o
                // cliente foi reclamar pelo WhatsApp.
                onChange={e => setCustomerPhone(e.target.value.replace(/[^\d\s()+-]/g, ""))}
                placeholder="Ex: (11) 99999-9999"
              />
            </div>

            {deliveryType === "DELIVERY" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", background: "#F8FAFC", padding: "12px", borderRadius: "14px", border: "1px solid #E2E8F0" }}>
                {!isNeighborhoodType && (
                  <button
                    type="button"
                    onClick={handleUseGpsLocation}
                    disabled={gpsLoading || deliveryCalculating}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      padding: "8px 12px",
                      background: "#EFF6FF",
                      border: "1.5px solid #BFDBFE",
                      borderRadius: "10px",
                      color: "#1D4ED8",
                      fontSize: "0.80rem",
                      fontWeight: 800,
                      cursor: (gpsLoading || deliveryCalculating) ? "not-allowed" : "pointer",
                      transition: "all 0.2s"
                    }}
                  >
                    {gpsLoading ? "⏳ Obtendo sua localização..." : "📍 Usar minha localização atual (GPS)"}
                  </button>
                )}

                <div>
                  <label className="checkout-label" style={{ fontSize: "0.82rem" }}>Rua / Logradouro *</label>
                  <input
                    className="checkout-input"
                    value={customerStreet}
                    onChange={e => setCustomerStreet(e.target.value)}
                    placeholder="Ex: Rua São Paulo, Av. Brasil"
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr", gap: "0.5rem" }}>
                  <div>
                    <label className="checkout-label" style={{ fontSize: "0.82rem" }}>Número *</label>
                    <input
                      className="checkout-input"
                      inputMode="numeric"
                      value={customerNumber}
                      onChange={e => setCustomerNumber(e.target.value)}
                      placeholder="Ex: 98 ou S/N"
                    />
                  </div>

                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
                      <label className="checkout-label" style={{ fontSize: "0.82rem", margin: 0 }}>Bairro *</label>
                      {isNeighborhoodType && customerNeighborhood && (
                        <button
                          type="button"
                          onClick={() => {
                            setCustomerNeighborhood("");
                            setNeighborhoodSearch("");
                            setDeliveryFee(null);
                            setDeliveryFeeCalculated(false);
                            setDeliveryAvailable(true);
                            setDeliveryMessage("");
                            setIsNeighborhoodOpen(true);
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#2563EB",
                            fontSize: "0.70rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            padding: 0
                          }}
                        >
                          ✏️ Trocar
                        </button>
                      )}
                    </div>

                    {isNeighborhoodType && availableNeighborhoods.length > 0 ? (
                      <div style={{ position: "relative" }}>
                        {customerNeighborhood ? (
                          <div
                            onClick={() => {
                              setIsNeighborhoodOpen(true);
                              setNeighborhoodSearch("");
                            }}
                            style={{
                              padding: "8px 10px",
                              background: "#ECFDF5",
                              border: "1.5px solid #10B981",
                              borderRadius: "8px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between"
                            }}
                          >
                            <div style={{ fontSize: "0.84rem", fontWeight: 800, color: "#065F46", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              📍 {customerNeighborhood}
                            </div>
                            <span style={{ fontSize: "0.72rem", fontWeight: 800, color: "#059669", background: "#D1FAE5", padding: "2px 6px", borderRadius: "4px" }}>
                              {effectiveDeliveryFee > 0 ? `R$ ${effectiveDeliveryFee.toFixed(2).replace('.', ',')}` : isFreeShippingByMin ? 'Grátis' : 'Grátis'}
                            </span>
                          </div>
                        ) : (
                          <div>
                            <input
                              className="checkout-input"
                              value={neighborhoodSearch}
                              onChange={e => {
                                setNeighborhoodSearch(e.target.value);
                                setIsNeighborhoodOpen(true);
                              }}
                              onFocus={() => setIsNeighborhoodOpen(true)}
                              placeholder="🔍 Digite seu bairro..."
                              style={{
                                borderColor: isNeighborhoodOpen ? "#2563EB" : undefined
                              }}
                            />

                            {/* DROPDOWN FLUTUANTE DE BAIRROS */}
                            {isNeighborhoodOpen && (
                              <div
                                style={{
                                  position: "absolute",
                                  top: "calc(100% + 4px)",
                                  left: 0,
                                  right: 0,
                                  maxHeight: "200px",
                                  overflowY: "auto",
                                  background: "#FFFFFF",
                                  borderRadius: "10px",
                                  border: "1.5px solid #3B82F6",
                                  boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.15)",
                                  zIndex: 100,
                                  padding: "4px"
                                }}
                              >
                                <div style={{ padding: "4px 8px", fontSize: "0.68rem", fontWeight: 800, color: "#64748B", borderBottom: "1px solid #F1F5F9" }}>
                                  Selecione o bairro ({filteredNeighborhoods.length} disponíveis)
                                </div>
                                {filteredNeighborhoods.length > 0 ? (
                                  filteredNeighborhoods.map((z, idx) => (
                                    <div
                                      key={idx}
                                      onClick={() => {
                                        setCustomerNeighborhood(z.name);
                                        setDeliveryFee(Number(z.fee) || 0);
                                        setDeliveryFeeCalculated(true);
                                        setDeliveryAvailable(true);
                                        setDeliveryMessage(`Bairro selecionado: ${z.name}`);
                                        setNeighborhoodSearch("");
                                        setIsNeighborhoodOpen(false);
                                      }}
                                      style={{
                                        padding: "7px 8px",
                                        borderRadius: "6px",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        transition: "background 0.15s"
                                      }}
                                      onMouseEnter={e => (e.currentTarget.style.background = "#F0FDF4")}
                                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                                    >
                                      <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1E293B" }}>
                                        📍 {z.name}
                                      </span>
                                      <span style={{ fontSize: "0.75rem", fontWeight: 800, color: z.fee > 0 ? "#16A34A" : "#059669", background: "#F0FDF4", padding: "2px 6px", borderRadius: "4px" }}>
                                        {z.fee > 0 ? `R$ ${z.fee.toFixed(2).replace('.', ',')}` : "Grátis"}
                                      </span>
                                    </div>
                                  ))
                                ) : (
                                  <div style={{ padding: "10px", textAlign: "center" }}>
                                    <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#DC2626", marginBottom: "4px" }}>
                                      ❌ Bairro não atendido
                                    </div>
                                    <div style={{ fontSize: "0.70rem", color: "#64748B", marginBottom: "6px" }}>
                                      Selecione um dos bairros atendidos:
                                    </div>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: "3px", justifyContent: "center" }}>
                                      {availableNeighborhoods.map((z, i) => (
                                        <button
                                          key={i}
                                          type="button"
                                          onClick={() => {
                                            setCustomerNeighborhood(z.name);
                                            setDeliveryFee(Number(z.fee) || 0);
                                            setDeliveryFeeCalculated(true);
                                            setDeliveryAvailable(true);
                                            setDeliveryMessage(`Bairro selecionado: ${z.name}`);
                                            setNeighborhoodSearch("");
                                            setIsNeighborhoodOpen(false);
                                          }}
                                          style={{
                                            background: "#F1F5F9",
                                            border: "1px solid #CBD5E1",
                                            borderRadius: "5px",
                                            padding: "2px 6px",
                                            fontSize: "0.70rem",
                                            fontWeight: 700,
                                            cursor: "pointer",
                                            color: "#1E293B"
                                          }}
                                        >
                                          {z.name}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <input
                        className="checkout-input"
                        value={customerNeighborhood}
                        onChange={e => setCustomerNeighborhood(e.target.value)}
                        onBlur={() => calcDeliveryFee(customerNeighborhood)}
                        placeholder="Ex: Centro"
                      />
                    )}
                  </div>
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "3px" }}>
                    <label className="checkout-label" style={{ fontSize: "0.82rem", margin: 0 }}>Complemento / Ponto de Referência</label>
                    <span style={{ fontSize: "0.68rem", color: "#94A3B8" }}>Opcional</span>
                  </div>
                  <input
                    className="checkout-input"
                    value={customerComplement}
                    onChange={e => setCustomerComplement(e.target.value)}
                    placeholder="Ex: Apto 12, Bloco B, Próximo à padaria"
                  />
                </div>

                {/* STATUS TAXA DE ENTREGA EM TEMPO REAL */}
                <div style={{
                  padding: "9px 12px",
                  borderRadius: "10px",
                  background: !deliveryAvailable ? "#FEF2F2" : isFreeShippingByMin ? "#ECFDF5" : (deliveryFeeCalculated && effectiveDeliveryFee > 0) ? "#F0FDF4" : deliveryCalculating ? "#EFF6FF" : "#F8FAFC",
                  border: `1.5px solid ${!deliveryAvailable ? "#FCA5A5" : isFreeShippingByMin ? "#86EFAC" : (deliveryFeeCalculated && effectiveDeliveryFee > 0) ? "#86EFAC" : deliveryCalculating ? "#BFDBFE" : "#E2E8F0"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                  marginTop: "2px"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "1rem" }}>
                      {!deliveryAvailable ? "⛔" : deliveryCalculating ? "⏳" : isFreeShippingByMin ? "🎉" : (deliveryFeeCalculated && effectiveDeliveryFee > 0) ? "🛵" : "📍"}
                    </span>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "0.80rem", fontWeight: 800, color: !deliveryAvailable ? "#DC2626" : isFreeShippingByMin ? "#166534" : (deliveryFeeCalculated && effectiveDeliveryFee > 0) ? "#166534" : "#475569" }}>
                        {!deliveryAvailable ? (
                          "Fora da Área de Entrega"
                        ) : deliveryCalculating ? (
                          "Verificando endereço e raio..."
                        ) : isFreeShippingByMin ? (
                          "Frete Grátis Aplicado! 🎉"
                        ) : (deliveryFeeCalculated && effectiveDeliveryFee > 0) ? (
                          `Taxa de Entrega: R$ ${effectiveDeliveryFee.toFixed(2).replace(".", ",")}`
                        ) : (deliveryFeeCalculated && effectiveDeliveryFee === 0) ? (
                          "Entrega Grátis! 🎉"
                        ) : (
                          isNeighborhoodType ? "Selecione seu bairro acima" : "Preencha rua, número e bairro para calcular"
                        )}
                      </span>
                      {deliveryMessage && (
                        <span style={{ fontSize: "0.70rem", color: !deliveryAvailable ? "#DC2626" : "#15803D", fontWeight: 600 }}>
                          {deliveryMessage}
                        </span>
                      )}
                    </div>
                  </div>
                  {!isNeighborhoodType && (
                    <button
                      type="button"
                      onClick={() => calcDeliveryFee(customerNeighborhood, `${customerStreet} ${customerNumber}, ${customerNeighborhood}, ${franchisee.city || ""}`.trim())}
                      disabled={deliveryCalculating}
                      style={{
                        background: "#FFFFFF",
                        border: "1px solid #CBD5E1",
                        padding: "3px 8px",
                        borderRadius: "6px",
                        fontSize: "0.70rem",
                        fontWeight: 700,
                        color: "#475569",
                        cursor: "pointer",
                        flexShrink: 0
                      }}
                    >
                      🔄 Recalcular
                    </button>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="checkout-label">Forma de Pagamento</label>
              <div className="checkout-type-row" style={{ flexWrap: "wrap" }}>
                {paymentOptions.map(pm => (
                  <button key={pm.k} type="button" onClick={() => setPaymentMethod(pm.k)} className={`checkout-type-btn ${paymentMethod === pm.k ? "active" : ""}`} style={{ flex: "1 1 30%", fontSize: "0.78rem", minHeight: "44px" }}>{pm.l}</button>
                ))}
              </div>
              {/* Dinheiro sem pergunta de troco = motoboy sem troco na porta. */}
              {paymentMethod === "DINHEIRO" && (
                <div style={{ marginTop: "8px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "10px", padding: "10px 12px" }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 700, color: "#92400E", display: "block", marginBottom: "4px" }}>
                    💵 Troco para quanto? <span style={{ fontWeight: 500 }}>(deixe vazio se não precisar)</span>
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={trocoPara}
                    onChange={e => setTrocoPara(e.target.value.replace(/[^\d.,]/g, ""))}
                    placeholder={`Ex: ${Math.ceil((finalTotal + 10) / 10) * 10}`}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #FCD34D", fontSize: "16px", outline: "none", boxSizing: "border-box", background: "#fff" }}
                  />
                  {(() => {
                    const v = parseFloat(trocoPara.replace(",", "."));
                    if (trocoPara.trim() && Number.isFinite(v) && v > 0 && v < finalTotal) {
                      return (
                        <div style={{ fontSize: "0.75rem", color: "#DC2626", fontWeight: 600, marginTop: "4px" }}>
                          O valor é menor que o total do pedido (R$ {finalTotal.toFixed(2).replace(".", ",")}).
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>
              )}
            </div>

            <div>
              <label className="checkout-label">Observações do Pedido</label>
              <textarea rows={2} className="checkout-input" style={{ resize: "vertical" }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex: Sem cebola, caprichar no molho..." />
            </div>

            {/* Resumo no Checkout */}
            <div style={{ padding: "8px 12px", background: "#F1F5F9", borderRadius: "10px", fontSize: "0.8rem", color: "#475569" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Subtotal:</span>
                <span style={{ fontWeight: 700 }}>R$ {cartTotal.toFixed(2).replace(".", ",")}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Entrega:</span>
                <span style={{ fontWeight: 700, color: (deliveryType === "PICKUP" || isFreeShippingByMin || couponApplied?.isFreeShipping) ? "#16A34A" : (deliveryFeeCalculated && effectiveDeliveryFee > 0) ? "#0F172A" : "#64748B" }}>
                  {deliveryType === "PICKUP" ? (
                    "Retirada (Grátis)"
                  ) : isFreeShippingByMin ? (
                    "Grátis 🎉"
                  ) : couponApplied?.isFreeShipping ? (
                    "Grátis (Cupom) 🎉"
                  ) : deliveryCalculating ? (
                    "Calculando..."
                  ) : (deliveryFeeCalculated && effectiveDeliveryFee > 0) ? (
                    `R$ ${effectiveDeliveryFee.toFixed(2).replace(".", ",")}`
                  ) : (deliveryFeeCalculated && effectiveDeliveryFee === 0) ? (
                    "Grátis 🎉"
                  ) : (
                    <span style={{ fontStyle: "italic", color: "#94A3B8", fontWeight: 600 }}>A calcular</span>
                  )}
                </span>
              </div>
              {cashbackDiscountApplied > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "#7C3AED", fontWeight: 700 }}>
                  <span>Desconto Cashback:</span>
                  <span>- R$ {cashbackDiscountApplied.toFixed(2).replace(".", ",")}</span>
                </div>
              )}
              {discount > 0 && !couponApplied?.isFreeShipping && (
                <div style={{ display: "flex", justifyContent: "space-between", color: "#16A34A", fontWeight: 700 }}>
                  <span>Desconto (Cupom):</span>
                  <span>- R$ {discount.toFixed(2).replace(".", ",")}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, color: "#0F172A", fontSize: "0.92rem", marginTop: "4px", paddingTop: "4px", borderTop: "1px dashed #CBD5E1" }}>
                <span>Total a Pagar:</span>
                <span>R$ {finalTotal.toFixed(2).replace(".", ",")}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FOOTER FIXO DA SACOLA (SEMPRE VISÍVEL NO RODAPÉ) */}
      {cart.length > 0 && (
        <div style={{ padding: "0.85rem 1.25rem", borderTop: "1.5px solid #E2E8F0", background: "#FFFFFF", flexShrink: 0, boxShadow: "0 -4px 12px rgba(0,0,0,0.03)" }}>
          {!isCheckout ? (
            <button
              type="button"
              onClick={() => {
                if (isBelowCartMin) {
                  alert(`⚠️ O pedido mínimo desta loja é de R$ ${minOrderToLeaveCart.toFixed(2).replace(".", ",")}. Por favor, adicione mais R$ ${remainingForCartMin.toFixed(2).replace(".", ",")} em itens para continuar.`);
                  return;
                }
                // Só dá para retirada: já entra no checkout com ela marcada, em
                // vez de deixar o cliente preencher o endereço para levar um
                // "não atingiu o mínimo" no último clique.
                if (somenteRetiradaPorValor) {
                  setDeliveryType("PICKUP");
                  setDeliveryFee(0);
                  setDeliveryFeeCalculated(true);
                  setDeliveryAvailable(true);
                  setDeliveryMessage("Retirada no balcão selecionada.");
                }
                setIsCheckout(true);
                trackPixelEvent("InitiateCheckout", { value: finalTotal, currency: "BRL" });
                trackGaEvent("begin_checkout", {
                  currency: "BRL",
                  value: finalTotal,
                  items: cart.map(i => ({
                    item_id: i.id.split("_")[0],
                    item_name: i.name,
                    quantity: i.quantity,
                    price: i.price,
                  })),
                });
              }}
              style={{
                width: "100%",
                padding: "13px",
                borderRadius: "12px",
                border: "none",
                background: isBelowCartMin ? "#94A3B8" : "#0F172A",
                color: "#FFFFFF",
                fontWeight: 800,
                fontSize: "0.95rem",
                cursor: isBelowCartMin ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                boxShadow: isBelowCartMin ? "none" : "0 4px 14px rgba(15, 23, 42, 0.25)",
                transition: "all 0.2s ease"
              }}
            >
              <span>{isBelowCartMin ? `Falta R$ ${remainingForCartMin.toFixed(2).replace(".", ",")}` : "Continuar pedido"}</span>
              <span>R$ {finalTotal.toFixed(2).replace(".", ",")}</span>
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {/* Loja fechada: o botão AVISA em vez de deixar preencher tudo
                  para levar um alert genérico no último clique. */}
              <button
                type="button"
                onClick={handleCheckout}
                disabled={loading || lojaFechadaAgora}
                style={{
                  width: "100%",
                  padding: "13px",
                  borderRadius: "12px",
                  border: "none",
                  background: lojaFechadaAgora ? "#E2E8F0" : "linear-gradient(135deg, #059669, #047857)",
                  color: lojaFechadaAgora ? "#64748B" : "#FFFFFF",
                  fontWeight: 900,
                  fontSize: "0.95rem",
                  cursor: loading || lojaFechadaAgora ? "not-allowed" : "pointer",
                  boxShadow: lojaFechadaAgora ? "none" : "0 4px 14px rgba(5, 150, 105, 0.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px"
                }}
              >
                {lojaFechadaAgora
                  ? `🔴 Loja fechada${!storeStatus.open && storeStatus.text ? ` • ${storeStatus.text}` : ""}`
                  : loading ? "Enviando pedido..." : `✓ Finalizar Pedido • R$ ${finalTotal.toFixed(2).replace(".", ",")}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ===== MAIN RENDER =====
  return (
    <div className="saipos-store">
      {/* Dois campos no schema guardam a mesma coisa: `facebookPixelId` (preenchido
          na tela de Integrações) e `metaPixelId` (preenchido pelo módulo de tráfego
          pago ao conectar a conta). Aceitar os dois evita o caso em que o lojista
          conecta o Facebook, o pixel é descoberto e salvo, e mesmo assim o cardápio
          não dispara nada por estar olhando só um dos campos. */}
      {(franchisee.facebookPixelId || (franchisee as any).metaPixelId) && (
        <FacebookPixel pixelId={(franchisee.facebookPixelId || (franchisee as any).metaPixelId) as string} />
      )}

      {/* Google Analytics 4 / Tag Manager da LOJA. Mesmo desenho do pixel: o
          lojista pode ter só o GA4 ("G-"), só o container do GTM ("GTM-") ou
          os dois — mas quem já mede o GA4 por dentro do container não deve
          preencher os dois, senão a mesma venda é contada duas vezes. */}
      {(gaMeasurementId || gtmContainerId) && (
        <GoogleAnalytics measurementId={gaMeasurementId} gtmId={gtmContainerId} />
      )}

      {/* BANNER DE PAUSA */}
      {isPaused && (
        <div style={{ background: "linear-gradient(135deg,#B91C1C,#DC2626)", color: "#fff", padding: "1rem 1.5rem", textAlign: "center" }}>
          <p style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: "4px" }}>📅 Loja Temporariamente Fechada</p>
          <p style={{ fontSize: "0.85rem", opacity: 0.9, margin: 0 }}>
            Motivo: {pauseInfo?.reason || "Pausa programada"} · Retorna em {new Date((pauseInfo?.to || "") + "T12:00").toLocaleDateString("pt-BR")}
          </p>
        </div>
      )}

      {/* Loja manualmente fechada */}
      {!isPaused && franchisee.storeOpen === false && (
        <div style={{ background: "#374151", color: "#fff", padding: "0.6rem 1.5rem", textAlign: "center", fontSize: "0.85rem", fontWeight: 700 }}>
          🔴 Loja fechada no momento · Em breve voltamos!
        </div>
      )}

      {/* BANNER PANORÂMICO */}
      {franchisee.storeBanner && (
        <div className="store-banner">
          <img src={franchisee.storeBanner} alt={storeName} fetchPriority="high" decoding="async" />
          <div className="store-banner-overlay" />
        </div>
      )}

      {/* STORE HEADER */}
      <div className="store-header">
        <div className="store-header-inner">
          {franchisee.storeLogo ? (
            <img src={franchisee.storeLogo} alt="Logo" className="store-logo" />
          ) : (
            <div className="store-logo-placeholder"><Store size={28} color="white" /></div>
          )}

          <div className="store-info">
            <h1 className="store-name">{storeName}</h1>
            {franchisee.showAddressOnMenu !== false && franchisee.storeAddress && (
              <div className="store-address"><MapPin size={13} /><span>{franchisee.storeAddress}</span></div>
            )}
            <div className="store-meta">
              <span className={`store-status ${storeStatus.open ? "open" : "closed"}`}>
                <Clock size={12} /> {storeStatus.text}
              </span>

              {/* AVALIAÇÕES CLICÁVEIS */}
              {storeRating && storeRating.count > 0 && (
                <button
                  type="button"
                  onClick={() => setShowReviewsModal(true)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    color: "#D97706",
                    background: "#FFFBEB",
                    border: "1px solid #FCD34D",
                    padding: "2px 9px",
                    borderRadius: "20px",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                    transition: "transform 0.15s ease",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "scale(1.04)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "scale(1)")}
                  title="Clique para ver todas as avaliações dos clientes"
                >
                  <Star size={13} fill="#F59E0B" color="#F59E0B" />
                  <span>{storeRating.average.toFixed(1)}</span>
                  <span style={{ fontWeight: 600, color: "#92400E" }}>({storeRating.count})</span>
                </button>
              )}

              {franchisee.storeDeliveryOnly && (
                <span className="store-delivery-tag">• Somente Delivery</span>
              )}
            </div>
          </div>

          {/* HEADER ACTION BUTTONS */}
          <div className="store-header-actions" style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
            {promoProducts.length > 0 && (
              <button
                onClick={() => setShowPromotionsModal(true)}
                style={{
                  background: "linear-gradient(135deg, #EF4444, #F97316)",
                  border: "none",
                  borderRadius: "10px",
                  padding: "6px 12px",
                  cursor: "pointer",
                  color: "white",
                  fontSize: "0.78rem",
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  boxShadow: "0 2px 6px rgba(239, 68, 68, 0.3)"
                }}
              >
                <Flame size={14} /> Ofertas
                <span style={{ background: "white", color: "#DC2626", borderRadius: "10px", padding: "1px 6px", fontSize: "0.7rem", fontWeight: 900 }}>
                  {promoProducts.length}
                </span>
              </button>
            )}

            <button
              onClick={() => {
                setShowMyOrdersModal(true);
                if (customer?.phone || customerPhone) {
                  fetchMyOrders(customer?.phone || customerPhone);
                }
              }}
              style={{
                background: "rgba(15, 23, 42, 0.06)",
                border: "1px solid #E2E8F0",
                borderRadius: "10px",
                padding: "6px 12px",
                cursor: "pointer",
                color: "#1E293B",
                fontSize: "0.78rem",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: "4px"
              }}
            >
              <Package size={14} /> Pedidos
            </button>

            {customer && customerCashbackBalance > 0 && (
              <div
                style={{
                  background: "linear-gradient(135deg, #10B981, #059669)",
                  color: "#FFFFFF",
                  borderRadius: "10px",
                  padding: "5px 9px",
                  fontSize: "0.76rem",
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  boxShadow: "0 2px 6px rgba(16, 185, 129, 0.25)"
                }}
                title="Seu saldo de cashback acumulado nesta loja"
              >
                💰 R$ {customerCashbackBalance.toFixed(2).replace(".", ",")}
              </div>
            )}

            {customer && isVipActive && (
              <div
                style={{
                  position: "relative",
                  display: "inline-flex",
                  alignItems: "center",
                }}
                onMouseEnter={() => setShowVipTooltip(true)}
                onMouseLeave={() => setShowVipTooltip(false)}
              >
                <div
                  style={{
                    background: vipTier.bg,
                    border: `1.5px solid ${vipTier.border}`,
                    color: vipTier.color,
                    borderRadius: "10px",
                    padding: "5px 10px",
                    fontSize: "0.76rem",
                    fontWeight: 900,
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    cursor: "pointer",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                    transition: "transform 0.15s ease"
                  }}
                  onClick={() => setShowVipTooltip(!showVipTooltip)}
                >
                  <span style={{ fontSize: "0.95rem" }}>{vipTier.icon}</span>
                  <span>{vipTier.name}</span>
                  {vipTier.bonus > 0 && (
                    <span style={{ background: "rgba(0,0,0,0.08)", padding: "1px 5px", borderRadius: "6px", fontSize: "0.68rem" }}>
                      +{vipTier.bonus}%
                    </span>
                  )}
                </div>

                {showVipTooltip && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      right: 0,
                      width: "240px",
                      background: "#0F172A",
                      color: "#FFFFFF",
                      borderRadius: "12px",
                      padding: "10px 12px",
                      fontSize: "0.75rem",
                      lineHeight: 1.4,
                      zIndex: 100,
                      boxShadow: "0 10px 25px rgba(0,0,0,0.3)",
                      border: "1px solid #334155"
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: "0.82rem", color: "#FCD34D", marginBottom: "3px", display: "flex", alignItems: "center", gap: "4px" }}>
                      <span>{vipTier.icon}</span> Nível VIP {vipTier.name}
                    </div>
                    <div>
                      {vipTier.bonus > 0
                        ? `Você ganha +${vipTier.bonus}% de cashback extra em todos os seus pedidos (Total: ${cashbackRate}% de volta)!`
                        : `Gaste mais este mês para subir para Prata 🥈 e ganhar mais cashback!`}
                    </div>
                    {vipTier.nextGoal && (
                      <div style={{ marginTop: "6px", paddingTop: "6px", borderTop: "1px dashed #334155", color: "#94A3B8" }}>
                        Faltam <strong style={{ color: "#38BDF8" }}>R$ {vipTier.remaining.toFixed(2).replace(".", ",")}</strong> em compras este mês para atingir o nível <strong style={{ color: "#FCD34D" }}>{vipTier.nextGoal}</strong>.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {customer ? (
              <button onClick={() => setShowHistory(!showHistory)} style={{ background: "rgba(15, 23, 42, 0.06)", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "6px 12px", cursor: "pointer", color: "#1E293B", fontSize: "0.78rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "4px" }}>
                <User size={14} /> {customer.name.split(" ")[0]}
              </button>
            ) : (
              <button onClick={() => setShowAuth(true)} style={{ background: "rgba(15, 23, 42, 0.06)", border: "1px solid #E2E8F0", borderRadius: "10px", padding: "6px 12px", cursor: "pointer", color: "#1E293B", fontSize: "0.78rem", fontWeight: 700, display: "flex", alignItems: "center", gap: "4px" }}>
                <LogIn size={14} /> Entrar
              </button>
            )}

            <button className="header-cart-btn" onClick={() => setMobileCartOpen(true)}>
              <ShoppingCart size={18} />{cartCount > 0 && <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{cartCount}</span>}
            </button>
          </div>
        </div>
      </div>

      {/* SEARCH BAR */}
      <div className="store-search-bar">
        <div className="store-search-inner">
          <div className="store-search-wrap">
            <Search size={18} />
            <input type="text" className="store-search-input" placeholder="Buscar no cardápio..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
          </div>
        </div>
      </div>

      {/* CATEGORY TABS */}
      <div className="store-cats">
        {promoProducts.length > 0 && (
          <button
            onClick={() => setShowPromotionsModal(true)}
            style={{
              padding: "0.35rem 1rem",
              borderRadius: "20px",
              fontSize: "0.82rem",
              fontWeight: 800,
              whiteSpace: "nowrap",
              cursor: "pointer",
              border: "none",
              background: "linear-gradient(135deg, #EF4444, #F97316)",
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              gap: "4px",
              boxShadow: "0 2px 6px rgba(239, 68, 68, 0.25)"
            }}
          >
            <Flame size={13} /> Ofertas do Dia
          </button>
        )}
        {categories.map(c => (
          <button key={c} onClick={() => scrollToCategory(c)} className={`store-cat-btn ${selectedCategory === c ? "active" : ""}`}>{c}</button>
        ))}
      </div>

      {/* CONTENT */}
      <div className="store-content">
        <div className="store-products">

          {/* ===== VITRINE DE DESTAQUES (Apenas produtos marcados como Destaque) ===== */}
          {selectedCategory === "Todos" && !searchTerm && highlightProducts.length > 0 && (
            <div style={{ marginBottom: "2rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.85rem" }}>
                <h2 style={{ fontSize: "1.15rem", fontWeight: 800, margin: 0, color: "#0F172A" }}>
                  ⭐ Destaques da Casa
                </h2>
                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#16A34A", backgroundColor: "#DCFCE7", padding: "2px 8px", borderRadius: "12px" }}>
                  Mais pedidos
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "14px" }}>
                {highlightProducts.map(p => {
                  const q = getQty(p.id);
                  return (
                    <div
                      key={`highlight_${p.id}`}
                      onClick={() => setComboProduct(p)}
                      style={{
                        backgroundColor: "#FFFFFF",
                        borderRadius: "16px",
                        border: q > 0 ? "1.5px solid #16A34A" : "1px solid #E2E8F0",
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                        cursor: "pointer",
                        boxShadow: "0 4px 14px rgba(0,0,0,0.04)",
                        transition: "all 0.2s ease"
                      }}
                    >
                      {p.imageUrl && (
                        <div style={{ width: "100%", height: "180px", overflow: "hidden", position: "relative", backgroundColor: "#F8FAFC" }}>
                          <img src={p.imageUrl} alt={p.name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "contain", padding: "4px" }} />
                          {p.isCombo && (
                            <span style={{ position: "absolute", top: "10px", left: "10px", background: "rgba(15,23,42,0.85)", color: "#fff", padding: "3px 8px", borderRadius: "6px", fontSize: "0.68rem", fontWeight: 800 }}>
                              COMBO
                            </span>
                          )}
                        </div>
                      )}
                      <div style={{ padding: "1rem", display: "flex", flexDirection: "column", flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A", marginBottom: "4px" }}>
                          {p.name}
                        </div>
                        {p.description && (
                          <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "0 0 8px 0", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                            {p.description}
                          </p>
                        )}
                        {isCashbackActive && (
                          <div style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            background: "linear-gradient(135deg, #ECFDF5, #DCFCE7)",
                            border: "1px solid #A7F3D0",
                            borderRadius: "8px",
                            padding: "3px 8px",
                            fontSize: "0.72rem",
                            fontWeight: 800,
                            color: "#047857",
                            marginBottom: "6px",
                            width: "fit-content"
                          }}>
                            💸 Ganhe R$ {((p.price * cashbackRate) / 100).toFixed(2).replace(".", ",")} de volta ({cashbackRate}%)
                          </div>
                        )}
                        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "8px" }}>
                          <span style={{ fontWeight: 900, fontSize: "1.05rem", color: "#059669" }}>
                            {precoVariaPorEscolha(p as any) && <span style={{ fontSize: "0.72rem", color: "#64748B", fontWeight: 600 }}>a partir de </span>}
                            R$ {precoMinimoDoProduto(p as any).toFixed(2).replace(".", ",")}
                          </span>
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setComboProduct(p);
                            }}
                            style={{
                              padding: "6px 14px",
                              borderRadius: "8px",
                              border: "none",
                              backgroundColor: "#059669",
                              color: "#fff",
                              fontWeight: 700,
                              fontSize: "0.8rem",
                              cursor: "pointer"
                            }}
                          >
                            {p.isCombo ? "Montar" : "+ Pedir"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* LISTAGEM DE CATEGORIAS & PRODUTOS */}
          {Object.keys(grouped).length === 0 ? (
            <div style={{ textAlign: "center", padding: "3rem 0", color: "#94A3B8" }}>Nenhum item encontrado.</div>
          ) : Object.entries(grouped).map(([cat, prods]) => (
            <div key={cat} className="store-section" ref={el => { sectionRefs.current[cat] = el; }}>
              <h2 className="store-section-title">{cat}</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {prods.map(p => {
                  const q = getQty(p.id);
                  return (
                    <div key={p.id} className={`product-card ${q > 0 ? "in-cart" : ""}`} onClick={() => setComboProduct(p)}>
                      {p.imageUrl && <img src={p.imageUrl} alt="" className="product-img" loading="lazy" decoding="async" />}
                      <div className="product-info">
                        <div className="product-name">
                          {p.name}
                          {p.isCombo && <span className="product-combo-tag">📦 COMBO</span>}
                        </div>
                        {p.description && <p className="product-desc">{p.description}</p>}
                        {(p as any).tags && (() => {
                          try {
                            const t = JSON.parse((p as any).tags);
                            return t.length > 0 ? (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", margin: "4px 0" }}>
                                {t.map((tag: string) => {
                                  const colorMap: Record<string, { bg: string; color: string }> = {
                                    "🔥 Mais Vendido": { bg: "#FEF2F2", color: "#DC2626" },
                                    "✨ Novo": { bg: "#F5F3FF", color: "#7C3AED" },
                                    "🏷️ Promoção": { bg: "#F0FDF4", color: "#16A34A" },
                                    "🌱 Vegano": { bg: "#DCFCE7", color: "#15803D" },
                                    "🌶️ Picante": { bg: "#FEF3C7", color: "#D97706" },
                                    "⭐ Destaque": { bg: "#FEFCE8", color: "#CA8A04" },
                                    "❄️ Gelado": { bg: "#EFF6FF", color: "#2563EB" },
                                    "🎉 Especial do Dia": { bg: "#FDF2F8", color: "#BE185D" },
                                  };
                                  const c = colorMap[tag] || { bg: "#F8FAFC", color: "#475569" };
                                  return (
                                    <span key={tag} style={{ fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: "20px", background: c.bg, color: c.color }}>
                                      {tag}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : null;
                          } catch { return null; }
                        })()}
                        {isCashbackActive && (
                          <div style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "3px",
                            background: "#F0FDF4",
                            border: "1px solid #BBF7D0",
                            borderRadius: "6px",
                            padding: "1px 6px",
                            fontSize: "0.68rem",
                            fontWeight: 800,
                            color: "#15803D",
                            margin: "3px 0 2px 0",
                            width: "fit-content"
                          }}>
                            💸 +R$ {((p.price * cashbackRate) / 100).toFixed(2).replace(".", ",")} de cashback
                          </div>
                        )}
                        <p className="product-price">
                          {precoVariaPorEscolha(p as any) && <span className="product-price-from">A partir de </span>}
                          R$ {precoMinimoDoProduto(p as any).toFixed(2).replace(".", ",")}
                        </p>
                      </div>
                      <div className="product-actions">
                        {q === 0 ? (
                          <button className="add-btn" onClick={e => { e.stopPropagation(); setComboProduct(p); }}><Plus size={18} /></button>
                        ) : (
                          <div className="qty-controls">
                            <button className="qty-btn-minus" onClick={e => { e.stopPropagation(); removeFromCart(p.id); }}><Minus size={14} /></button>
                            <span className="qty-num">{q}</span>
                            <button className="qty-btn-plus" onClick={e => { e.stopPropagation(); addToCart(p); }}><Plus size={14} /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* ===== SEÇÃO DE AVALIAÇÕES POSITIVAS NO FINAL ===== */}
          {positiveReviews.length > 0 && (
            <div style={{ marginTop: "2rem", paddingBottom: "2rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1rem" }}>
                <h2 style={{ fontWeight: 800, fontSize: "1.1rem", margin: 0 }}>⭐ Avaliações dos clientes</h2>
                <div
                  onClick={() => setShowReviewsModal(true)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "#FFF7ED",
                    border: "1px solid #FCD34D",
                    borderRadius: "20px",
                    padding: "3px 12px",
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    color: "#92400E",
                    cursor: "pointer"
                  }}
                >
                  <Star size={12} fill="#F59E0B" color="#F59E0B" />
                  {storeRating?.average.toFixed(1)} ({storeRating?.count} avaliações)
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "12px" }}>
                {positiveReviews.slice(0, 6).map((r, i) => (
                  <div key={i} style={{ background: "#fff", borderRadius: "14px", padding: "1rem 1.25rem", border: "1px solid #F1F5F9", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg, #E63946, #C62828)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: "0.82rem" }}>
                        {r.customerName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p style={{ fontWeight: 700, fontSize: "0.82rem", margin: 0 }}>{r.customerName.split(" ")[0]}</p>
                        <p style={{ fontSize: "0.65rem", color: "#94A3B8", margin: 0 }}>{new Date(r.createdAt).toLocaleDateString("pt-BR")}</p>
                      </div>
                      <div style={{ marginLeft: "auto", display: "flex", gap: "2px" }}>
                        {[1,2,3,4,5].map(n => <Star key={n} size={11} fill={n <= r.rating ? "#F59E0B" : "none"} color={n <= r.rating ? "#F59E0B" : "#CBD5E1"} />)}
                      </div>
                    </div>
                    <p style={{ fontSize: "0.82rem", color: "#475569", margin: 0, lineHeight: 1.5 }}>"{r.comment}"</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ===== DESKTOP SIDEBAR ===== */}
        <div className={`desk-cart${isCheckout ? " checkout-aberto" : ""}`} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* CARD DINÂMICO DE BENEFÍCIOS, VIP, CARIMBOS E INDIQUE & GANHE */}
          <div style={{ background: "#FFFFFF", borderRadius: "16px", border: "1.5px solid #E2E8F0", padding: "1.1rem", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* Header Geral de Benefícios */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "1.3rem" }}>🎁</span>
                <span style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>
                  Benefícios & Fidelidade
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.72rem", fontWeight: 800, color: "#059669", background: "#ECFDF5", padding: "2px 8px", borderRadius: "12px" }}>
                <Sparkles size={12} /> Ativo
              </div>
            </div>

            {/* MÓDULO 1: NÍVEIS VIP */}
            {isVipActive && (
              <div style={{ background: vipTier.bg, border: `1px solid ${vipTier.border}`, borderRadius: "12px", padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 800, fontSize: "0.84rem", color: vipTier.color }}>
                    <span>{vipTier.icon}</span>
                    <span>{customer ? `Você é VIP ${vipTier.name}` : "Programa Níveis VIP"}</span>
                  </div>
                  {vipTier.bonus > 0 && (
                    <span style={{ background: "rgba(0,0,0,0.08)", padding: "1px 6px", borderRadius: "6px", fontSize: "0.7rem", fontWeight: 800, color: vipTier.color }}>
                      +{vipTier.bonus}% Cashback Extra
                    </span>
                  )}
                </div>

                {customer ? (
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "#475569", lineHeight: 1.35 }}>
                      Gasto no mês (30 dias): <strong>R$ {monthlySpent.toFixed(2).replace(".", ",")}</strong>
                    </div>
                    {vipTier.nextGoal ? (
                      <div style={{ marginTop: "6px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", fontWeight: 700, color: "#475569", marginBottom: "3px" }}>
                          <span>Próximo nível: <strong>{vipTier.nextGoal} {vipTier.nextGoal === "Ouro" ? "🥇" : "🥈"}</strong></span>
                          <span>Faltam R$ {vipTier.remaining.toFixed(2).replace(".", ",")}</span>
                        </div>
                        <div style={{ width: "100%", height: "5px", background: "rgba(0,0,0,0.08)", borderRadius: "6px", overflow: "hidden" }}>
                          <div style={{ width: `${vipTier.progress}%`, height: "100%", background: vipTier.color, borderRadius: "6px", transition: "width 0.3s ease" }} />
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: "0.73rem", color: "#92400E", fontWeight: 700, marginTop: "4px" }}>
                        🎉 Parabéns! Você atingiu o nível máximo VIP da loja!
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: "0.75rem", color: "#64748B", lineHeight: 1.35 }}>
                    Suba de nível conforme suas compras no mês e ganhe até +{goldCashback}% de cashback extra! <button type="button" onClick={() => setShowAuth(true)} style={{ background: "none", border: "none", color: "#7C3AED", fontWeight: 800, padding: 0, cursor: "pointer" }}>Faça login</button> para ver seu nível.
                  </div>
                )}
              </div>
            )}

            {/* MÓDULO 2: CARTÃO DE CARIMBOS (DIGITAL) */}
            {isStampsActive && (
              <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "12px", padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 800, fontSize: "0.82rem", color: "#0F172A" }}>
                    <span>🎫</span>
                    <span>Cartão Fidelidade</span>
                  </div>
                  <span style={{ fontSize: "0.74rem", fontWeight: 800, color: "#7C3AED", background: "#EDE9FE", padding: "1px 6px", borderRadius: "6px" }}>
                    {currentStamps} / {stampGoal} Carimbos
                  </span>
                </div>

                {/* Grade de Carimbos */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", margin: "8px 0" }}>
                  {Array.from({ length: stampGoal }).map((_, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: "26px",
                        height: "26px",
                        borderRadius: "50%",
                        background: idx < currentStamps ? "#7C3AED" : "#FFFFFF",
                        border: idx < currentStamps ? "2px solid #6D28D9" : "1.5px dashed #CBD5E1",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.68rem",
                        fontWeight: 800,
                        color: idx < currentStamps ? "#FFFFFF" : "#94A3B8",
                        boxShadow: idx < currentStamps ? "0 1px 4px rgba(124, 58, 237, 0.3)" : "none"
                      }}
                      title={idx < currentStamps ? `Carimbo ${idx + 1} Conquistado! 🪙` : `Carimbo ${idx + 1}`}
                    >
                      {idx < currentStamps ? "🪙" : (idx + 1)}
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: "0.74rem", color: "#475569", lineHeight: 1.35 }}>
                  {customer ? (
                    remainingStamps === 0 ? (
                      <span style={{ color: "#16A34A", fontWeight: 800 }}>🎉 Você completou a cartela! Ganhou {loyalty.stampRewardType === "product" ? "1 Prêmio Especial" : `R$ ${stampRewardValue.toFixed(2).replace(".", ",")} de desconto`}!</span>
                    ) : (
                      <span>Faltam <strong>{remainingStamps} carimbos</strong> para você ganhar <strong>{loyalty.stampRewardType === "product" ? "1 Prêmio Especial" : `R$ ${stampRewardValue.toFixed(2).replace(".", ",")} OFF`}</strong>!</span>
                    )
                  ) : (
                    <span>Ganhe 1 carimbo a cada pedido acima de R$ {stampMinOrder.toFixed(2).replace(".", ",")}. Complete {stampGoal} e ganhe seu prêmio!</span>
                  )}
                </div>
              </div>
            )}

            {/* MÓDULO 3: INDIQUE E GANHE */}
            {isReferralActive && (
              <div style={{ background: "#FAF5FF", border: "1px solid #E9D5FF", borderRadius: "12px", padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 800, fontSize: "0.82rem", color: "#6B21A8", marginBottom: "4px" }}>
                  <span>🎁</span>
                  <span>Indique e Ganhe R$ {referrerReward.toFixed(2).replace(".", ",")}</span>
                </div>
                <p style={{ fontSize: "0.74rem", color: "#7E22CE", margin: "0 0 6px 0", lineHeight: 1.35 }}>
                  Seus amigos ganham <strong>R$ {friendDiscount.toFixed(2).replace(".", ",")} OFF</strong> no 1º pedido e você ganha <strong>R$ {referrerReward.toFixed(2).replace(".", ",")}</strong> de volta em saldo!
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const link = typeof window !== 'undefined' ? `${window.location.origin}/loja/${franchisee.slug}?ref=${customer?.phone || 'amigo'}` : '';
                    navigator.clipboard?.writeText(link);
                    setCopiedReferral(true);
                    setTimeout(() => setCopiedReferral(false), 2500);
                  }}
                  style={{
                    width: "100%",
                    padding: "6px 10px",
                    borderRadius: "8px",
                    border: "1px solid #D8B4FE",
                    background: copiedReferral ? "#DCFCE7" : "#FFFFFF",
                    color: copiedReferral ? "#15803D" : "#7C3AED",
                    fontSize: "0.75rem",
                    fontWeight: 800,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    transition: "all 0.2s"
                  }}
                >
                  {copiedReferral ? "✅ Link de Indicação Copiado!" : "📋 Copiar Link de Indicação"}
                </button>
              </div>
            )}

            {/* MÓDULO 4: CASHBACK PADRÃO */}
            {isCashbackActive && (
              <div style={{ fontSize: "0.75rem", color: "#059669", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: "10px", padding: "8px 10px", lineHeight: 1.35, display: "flex", alignItems: "center", gap: "6px" }}>
                <span>💰</span>
                <span>
                  Ganhe <strong>{cashbackRate}% de volta</strong> em saldo em todos os seus pedidos acima de R$ {cashbackMinOrder.toFixed(2).replace(".", ",")}.
                </span>
              </div>
            )}
          </div>

          {/* CARD DA SACOLA
              Navegando (sacola): fica grudado no topo com rolagem interna — bom
              para acompanhar o total enquanto o cliente escolhe os itens.
              No CHECKOUT: cresce por inteiro e quem rola e a PAGINA. Antes o
              card ficava preso em calc(100vh - 100px) e o formulario inteiro
              (endereco, pagamento, troco, observacao) ficava espremido numa
              barra de rolagem interna — o cliente tinha que rolar dentro da
              caixinha para conseguir digitar. */}
          <div style={{
            background: "#FFFFFF",
            borderRadius: "16px",
            border: "1.5px solid #E2E8F0",
            overflow: "hidden",
            boxShadow: "0 4px 20px rgba(0,0,0,0.04)",
            display: "flex",
            flexDirection: "column",
            // Sem teto de altura no checkout: o cart-body (flex:1 + overflow
            // auto) passa a caber no proprio conteudo e a barra interna some.
            maxHeight: isCheckout ? "none" : "calc(100vh - 100px)",
            position: isCheckout ? "static" : "sticky",
            top: "80px",
          }}>
            {cartContentJSX}
          </div>
        </div>
      </div>

      {/* MOBILE BOTTOM BAR */}
      {cartCount > 0 && !mobileCartOpen && (
        <div className="mob-bar">
          <button className="mob-bar-btn" onClick={() => setMobileCartOpen(true)}>
            <span>🛒 Ver sacola ({cartCount})</span>
            <span>R$ {finalTotal.toFixed(2).replace(".", ",")}</span>
          </button>
        </div>
      )}

      {/* MOBILE CART BOTTOM SHEET */}
      {mobileCartOpen && (
        <div className="mob-cart-overlay" onClick={() => setMobileCartOpen(false)}>
          <div className="mob-cart-sheet" onClick={e => e.stopPropagation()}>
            {cartContentJSX}
          </div>
        </div>
      )}

      {/* TELA DE PRODUTO (bottom-sheet) — combo E produto simples.
          Antes só combos abriam; produto simples caía direto na sacola com um
          toque em qualquer ponto do card: compra acidental na rolagem, sem
          descrição completa, sem observação e sem o botão claro de confirmar. */}
      {comboProduct && (
        <ComboModal
          product={{
            id: comboProduct.id,
            name: comboProduct.name,
            description: comboProduct.description,
            price: comboProduct.price,
            imageUrl: comboProduct.imageUrl,
            comboGroups: (comboProduct.isCombo && comboProduct.comboGroups) || []
          }}
          onClose={() => setComboProduct(null)}
          onConfirm={(selections, extraSum, qty, comboNotes) => {
            const temGrupos = Boolean(comboProduct.isCombo && comboProduct.comboGroups?.length);
            // Produto sem grupos não carrega comboSelections vazio — senão a
            // sacola e a cozinha tratariam um item simples como combo.
            addToCart(
              comboProduct,
              temGrupos ? selections : undefined,
              temGrupos ? extraSum : 0,
              qty,
              comboNotes
            );
            setComboProduct(null);
          }}
        />
      )}

      {/* MODAL DE AVALIAÇÕES COMPLETAS (Mostra todas as avaliações no popup) */}
      {showReviewsModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={() => setShowReviewsModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", padding: "24px", maxWidth: "520px", width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #F1F5F9", paddingBottom: "12px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "1.4rem" }}>⭐</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#0F172A" }}>Avaliações dos Clientes</h3>
                  {storeRating && (
                    <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>
                      Média: <strong>{storeRating.average.toFixed(1)}</strong> ({storeRating.count} avaliações registradas)
                    </p>
                  )}
                </div>
              </div>
              <button onClick={() => setShowReviewsModal(false)} style={{ background: "#F1F5F9", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontWeight: 800 }}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px" }}>
              {storeRating?.reviews && storeRating.reviews.length > 0 ? (
                storeRating.reviews.map((r, i) => (
                  <div key={i} style={{ background: "#F8FAFC", borderRadius: "12px", padding: "14px", border: "1px solid #E2E8F0" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "linear-gradient(135deg, #E63946, #C62828)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: "0.8rem" }}>
                          {r.customerName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: "0.84rem", color: "#0F172A" }}>{r.customerName}</div>
                          <div style={{ fontSize: "0.68rem", color: "#94A3B8" }}>{new Date(r.createdAt).toLocaleDateString("pt-BR")}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "2px" }}>
                        {[1,2,3,4,5].map(n => (
                          <Star key={n} size={13} fill={n <= r.rating ? "#F59E0B" : "none"} color={n <= r.rating ? "#F59E0B" : "#CBD5E1"} />
                        ))}
                      </div>
                    </div>
                    {r.comment && (
                      <p style={{ fontSize: "0.82rem", color: "#334155", margin: "4px 0 0", lineHeight: 1.45 }}>
                        "{r.comment}"
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94A3B8" }}>
                  <Star size={40} style={{ opacity: 0.2, marginBottom: "8px" }} />
                  <p style={{ fontSize: "0.9rem" }}>Esta loja ainda não possui avaliações registradas.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE PROMOÇÕES / OFERTAS DO DIA */}
      {showPromotionsModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={() => setShowPromotionsModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", padding: "24px", maxWidth: "680px", width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #F1F5F9", paddingBottom: "12px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "1.4rem" }}>🔥</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#0F172A" }}>Ofertas & Promoções</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Descontos e combos especiais selecionados para você</p>
                </div>
              </div>
              <button onClick={() => setShowPromotionsModal(false)} style={{ background: "#F1F5F9", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontWeight: 800 }}>✕</button>
            </div>

            {/* CARTÃO DE CARIMBOS DENTRO DO MODAL DE OFERTAS / PROMOÇÕES */}
            {isStampsActive && (
              <div style={{ background: "#FAF5FF", border: "1.5px solid #E9D5FF", borderRadius: "14px", padding: "12px 16px", marginBottom: "16px", display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 800, fontSize: "0.86rem", color: "#6B21A8" }}>
                    <span>🎫</span>
                    <span>Seu Cartão Fidelidade de Carimbos</span>
                  </div>
                  <span style={{ fontSize: "0.76rem", fontWeight: 800, color: "#7C3AED", background: "#EDE9FE", padding: "2px 8px", borderRadius: "8px" }}>
                    {currentStamps} de {stampGoal} Carimbos
                  </span>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "4px 0" }}>
                  {Array.from({ length: stampGoal }).map((_, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: "30px",
                        height: "30px",
                        borderRadius: "50%",
                        background: idx < currentStamps ? "#7C3AED" : "#FFFFFF",
                        border: idx < currentStamps ? "2px solid #6D28D9" : "1.5px dashed #CBD5E1",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.75rem",
                        fontWeight: 800,
                        color: idx < currentStamps ? "#FFFFFF" : "#94A3B8",
                        boxShadow: idx < currentStamps ? "0 1px 4px rgba(124, 58, 237, 0.3)" : "none"
                      }}
                    >
                      {idx < currentStamps ? "🪙" : (idx + 1)}
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: "0.78rem", color: "#7E22CE", lineHeight: 1.35 }}>
                  {customer ? (
                    remainingStamps === 0 ? (
                      <strong style={{ color: "#15803D" }}>🎉 Parabéns! Cartela completa! Ganhou {loyalty.stampRewardType === "product" ? "1 Prêmio Grátis" : `R$ ${stampRewardValue.toFixed(2).replace(".", ",")} de desconto`}!</strong>
                    ) : (
                      <span>Faltam <strong>{remainingStamps} carimbos</strong> para você ganhar <strong>{loyalty.stampRewardType === "product" ? "1 Prêmio Grátis" : `R$ ${stampRewardValue.toFixed(2).replace(".", ",")} de desconto`}</strong>!</span>
                    )
                  ) : (
                    <span>Ganhe 1 carimbo a cada pedido acima de R$ {stampMinOrder.toFixed(2).replace(".", ",")}. Complete {stampGoal} e ganhe seu prêmio!</span>
                  )}
                </div>
              </div>
            )}

            <div style={{ flex: 1, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px", paddingRight: "4px" }}>
              {promoProducts.length > 0 ? (
                promoProducts.map(p => {
                  const q = getQty(p.id);
                  return (
                    <div
                      key={`promo_${p.id}`}
                      onClick={() => {
                        setShowPromotionsModal(false);
                        setComboProduct(p);
                      }}
                      style={{
                        background: "#FFFFFF",
                        border: "1.5px solid #FCA5A5",
                        borderRadius: "14px",
                        padding: "12px",
                        display: "flex",
                        gap: "10px",
                        cursor: "pointer",
                        boxShadow: "0 2px 8px rgba(239,68,68,0.06)",
                        position: "relative"
                      }}
                    >
                      {p.imageUrl && (
                        <img src={p.imageUrl} alt={p.name} style={{ width: "65px", height: "65px", borderRadius: "10px", objectFit: "cover" }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ background: "#FEE2E2", color: "#DC2626", padding: "1px 6px", borderRadius: "4px", fontSize: "0.65rem", fontWeight: 800 }}>
                          🔥 OFERTA
                        </span>
                        <div style={{ fontWeight: 800, fontSize: "0.85rem", color: "#0F172A", marginTop: "2px" }}>{p.name}</div>
                        <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginTop: "4px" }}>
                          <span style={{ fontWeight: 900, fontSize: "0.95rem", color: "#059669" }}>
                            {precoVariaPorEscolha(p as any) && <span style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 600 }}>a partir de </span>}
                            R$ {precoMinimoDoProduto(p as any).toFixed(2).replace(".", ",")}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ textAlign: "center", padding: "3rem 1rem", color: "#94A3B8", gridColumn: "1 / -1" }}>
                  <Flame size={40} style={{ opacity: 0.2, marginBottom: "8px" }} />
                  <p>Nenhuma promoção ativa no momento.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE MEUS PEDIDOS & ACOMPANHAMENTO */}
      {showMyOrdersModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }} onClick={() => setShowMyOrdersModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", padding: "24px", maxWidth: "480px", width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #F1F5F9", paddingBottom: "12px", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "1.4rem" }}>📦</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#0F172A" }}>Meus Pedidos</h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>Consulte o status e histórico de pedidos</p>
                </div>
              </div>
              <button onClick={() => setShowMyOrdersModal(false)} style={{ background: "#F1F5F9", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontWeight: 800 }}>✕</button>
            </div>

            {/* BUSCADOR POR WHATSAPP */}
            <div style={{ marginBottom: "16px", background: "#F8FAFC", padding: "12px", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
              <label style={{ fontSize: "0.76rem", fontWeight: 700, color: "#475569", display: "block", marginBottom: "6px" }}>
                Digite seu WhatsApp para buscar seus pedidos:
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  placeholder="(21) 99999-9999"
                  value={myOrdersPhone}
                  onChange={e => setMyOrdersPhone(e.target.value)}
                  style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1.5px solid #CBD5E1", fontSize: "0.85rem", outline: "none" }}
                />
                <button
                  type="button"
                  onClick={() => fetchMyOrders(myOrdersPhone)}
                  disabled={myOrdersLoading}
                  style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "#0F172A", color: "#fff", fontWeight: 700, fontSize: "0.82rem", cursor: "pointer" }}
                >
                  {myOrdersLoading ? "Buscando..." : "Buscar"}
                </button>
              </div>
            </div>

            {/* LISTA DE PEDIDOS */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
              {myOrdersList.length > 0 ? (
                myOrdersList.map(o => (
                  <div key={o.id} style={{ background: "#FFFFFF", border: "1.5px solid #E2E8F0", borderRadius: "14px", padding: "14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                      <span style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>#{o.id.slice(-6).toUpperCase()}</span>
                      <span style={{ padding: "2px 8px", borderRadius: "6px", fontSize: "0.7rem", fontWeight: 800, background: o.status === "ENTREGUE" ? "#DCFCE7" : "#FEF3C7", color: o.status === "ENTREGUE" ? "#15803D" : "#B45309" }}>
                        {o.status}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: "8px" }}>
                      {o.items?.map((it: any) => `${it.quantity}x ${it.menuProduct?.name || "Item"}`).join(", ")}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #F1F5F9", paddingTop: "8px", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A" }}>R$ {Number(o.totalAmount || 0).toFixed(2).replace(".", ",")}</span>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {/* Repetir joga os mesmos itens na sacola, sempre pelo preço
                            de hoje — ver repetirPedido(). */}
                        <button
                          onClick={() => {
                            repetirPedido(o);
                            setShowMyOrdersModal(false);
                          }}
                          style={{ padding: "5px 12px", borderRadius: "8px", border: "none", background: "#059669", color: "#fff", fontWeight: 800, fontSize: "0.75rem", cursor: "pointer" }}
                        >
                          🔁 Repetir pedido
                        </button>
                        <button
                          onClick={() => {
                            setOrderSuccess(o.id);
                            setTrackingStatus(o.status);
                            setShowMyOrdersModal(false);
                          }}
                          style={{ padding: "5px 12px", borderRadius: "8px", border: "1px solid #3B82F6", background: "#EFF6FF", color: "#1D4ED8", fontWeight: 700, fontSize: "0.75rem", cursor: "pointer" }}
                        >
                          Acompanhar →
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              ) : myOrdersSearched ? (
                <div style={{ textAlign: "center", padding: "2rem 1rem", color: "#94A3B8" }}>
                  <Package size={36} style={{ opacity: 0.3, marginBottom: "6px" }} />
                  <p style={{ fontSize: "0.85rem" }}>Nenhum pedido encontrado para este telefone.</p>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "2rem 1rem", color: "#94A3B8" }}>
                  <p style={{ fontSize: "0.85rem" }}>Digite seu número acima para ver seus pedidos recentes.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── RESULTADO DO "PEDIR DE NOVO" ────────────────────────────────────
          O cliente precisa saber o que mudou desde a última vez ANTES de
          fechar o pedido. Repetir em silêncio um item que subiu de preço, ou
          esconder que um produto saiu do cardápio, vira reclamação na entrega. */}
      {resumoRepeticao && (
        <div
          onClick={() => setResumoRepeticao(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100000, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, padding: 22, maxWidth: 400, width: "100%", boxShadow: "0 25px 60px rgba(0,0,0,0.3)" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: "1.1rem", fontWeight: 900, color: "#0F172A" }}>
              {resumoRepeticao.adicionados > 0 ? "🔁 Itens na sua sacola" : "Não deu para repetir"}
            </h3>

            {resumoRepeticao.adicionados > 0 && (
              <p style={{ margin: "0 0 12px", fontSize: "0.85rem", color: "#475569", lineHeight: 1.5 }}>
                {resumoRepeticao.adicionados} {resumoRepeticao.adicionados === 1 ? "item foi adicionado" : "itens foram adicionados"} pelo preço de hoje.
              </p>
            )}

            {resumoRepeticao.mudaramDePreco.length > 0 && (
              <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
                <div style={{ fontWeight: 800, fontSize: "0.8rem", color: "#92400E", marginBottom: 6 }}>
                  Mudou de preço desde o seu último pedido:
                </div>
                {resumoRepeticao.mudaramDePreco.map((m, i) => (
                  <div key={i} style={{ fontSize: "0.78rem", color: "#78350F", lineHeight: 1.6 }}>
                    • {m.nome}: <s>R$ {m.de.toFixed(2).replace(".", ",")}</s>{" "}
                    <strong>R$ {m.para.toFixed(2).replace(".", ",")}</strong>
                  </div>
                ))}
              </div>
            )}

            {resumoRepeticao.forasDoCardapio.length > 0 && (
              <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
                <div style={{ fontWeight: 800, fontSize: "0.8rem", color: "#991B1B", marginBottom: 6 }}>
                  Não está mais disponível:
                </div>
                {resumoRepeticao.forasDoCardapio.map((n, i) => (
                  <div key={i} style={{ fontSize: "0.78rem", color: "#7F1D1D", lineHeight: 1.6 }}>• {n}</div>
                ))}
              </div>
            )}

            <button
              onClick={() => setResumoRepeticao(null)}
              style={{ width: "100%", padding: 12, borderRadius: 12, border: "none", background: "#0F172A", color: "#fff", fontWeight: 800, fontSize: "0.88rem", cursor: "pointer", marginTop: 4 }}
            >
              {resumoRepeticao.adicionados > 0 ? "Ver minha sacola" : "Fechar"}
            </button>
          </div>
        </div>
      )}

      {/* AUTH MODAL */}
      {showAuth && (
        <div className="mob-cart-overlay" onClick={() => setShowAuth(false)} style={{ zIndex: 9999 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: "16px", padding: "1.5rem", maxWidth: "380px", width: "90%", margin: "auto", position: "relative", top: "50%", transform: "translateY(-50%)" }}>
            <button onClick={() => setShowAuth(false)} style={{ position: "absolute", top: "12px", right: "12px", background: "none", border: "none", cursor: "pointer" }}><X size={20} /></button>
            <h2 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "0.5rem" }}>{authMode === "login" ? "🔐 Entrar" : "📝 Criar Conta"}</h2>
            <p style={{ fontSize: "0.8rem", color: "#666", marginBottom: "1rem" }}>
              {authMode === "login" ? "Entre com seu telefone e senha" : "Crie sua conta para salvar seus dados"}
            </p>
            {authError && <p style={{ color: "#EF4444", fontSize: "0.8rem", marginBottom: "0.5rem", fontWeight: 600 }}>❌ {authError}</p>}
            {authMode === "register" && (
              <>
                <div style={{ marginBottom: "0.75rem" }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: "4px" }}>Seu Nome</label>
                  <input value={authName} onChange={e => setAuthName(e.target.value)} placeholder="João Silva" style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.9rem", boxSizing: "border-box" }} />
                </div>
                <div style={{ marginBottom: "0.75rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                    <label style={{ fontSize: "0.78rem", fontWeight: 600 }}>🎂 Data de Aniversário</label>
                    <span style={{ fontSize: "0.68rem", color: "#64748B", fontWeight: 600 }}>Opcional</span>
                  </div>
                  <input 
                    type="date"
                    value={authBirthDate} 
                    onChange={e => setAuthBirthDate(e.target.value)} 
                    style={{ width: "100%", padding: "8px 12px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.85rem", boxSizing: "border-box", color: "#334155" }} 
                  />
                  <p style={{ fontSize: "0.7rem", color: "#7C3AED", margin: "4px 0 0", fontWeight: 600, lineHeight: 1.3 }}>
                    🎁 Não é obrigatório, mas queremos lembrar do seu dia e te presentear!
                  </p>
                </div>
              </>
            )}
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: "4px" }}>WhatsApp / Telefone</label>
              <input value={authPhone} onChange={e => setAuthPhone(e.target.value)} placeholder="(21) 99999-9999" style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.9rem", boxSizing: "border-box" }} />
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: "4px" }}>Senha</label>
              <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="••••••" style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.9rem", boxSizing: "border-box" }} />
            </div>
            <button onClick={handleAuth} disabled={authLoading} style={{ width: "100%", padding: "12px", borderRadius: "12px", border: "none", background: "linear-gradient(135deg, #E63946, #FF6B35)", color: "white", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer" }}>
              {authLoading ? "Aguarde..." : (authMode === "login" ? "Entrar" : "Criar Conta")}
            </button>
            <p style={{ textAlign: "center", fontSize: "0.78rem", marginTop: "0.75rem", color: "#666" }}>
              {authMode === "login" ? "Não tem conta? " : "Já tem conta? "}
              <button onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }} style={{ background: "none", border: "none", color: "#E63946", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>
                {authMode === "login" ? "Criar conta" : "Fazer login"}
              </button>
            </p>
          </div>
        </div>
      )}

      {/* CUSTOMER HISTORY DROPDOWN */}
      {showHistory && customer && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9998 }} onClick={() => setShowHistory(false)}>
          <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "80px", right: "16px", background: "white", borderRadius: "16px", padding: "1.25rem", maxWidth: "360px", width: "90%", maxHeight: "70vh", overflowY: "auto", boxShadow: "0 20px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1rem" }}>👋 Olá, {customer.name.split(" ")[0]}!</h3>
              <button onClick={() => setShowHistory(false)} style={{ background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: "0.8rem", color: "#666", marginBottom: "0.5rem" }}>📱 {customer.phone}</p>
            {customer.address && <p style={{ fontSize: "0.8rem", color: "#666", marginBottom: "0.75rem" }}>📍 {customer.address}</p>}
            <button onClick={handleLogout} style={{ width: "100%", padding: "8px", borderRadius: "10px", border: "1.5px solid #EF4444", background: "none", color: "#EF4444", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
              Sair da Conta
            </button>
          </div>
        </div>
      )}

      {/* RATING MODAL */}
      {showRating && (
        <div className="mob-cart-overlay" onClick={() => setShowRating(false)} style={{ zIndex: 9999 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: "16px", padding: "1.5rem", maxWidth: "380px", width: "90%", margin: "auto", position: "relative", top: "50%", transform: "translateY(-50%)", textAlign: "center" }}>
            <h2 style={{ fontWeight: 800, fontSize: "1.2rem", marginBottom: "0.5rem" }}>⭐ Avaliar Pedido</h2>
            <p style={{ fontSize: "0.8rem", color: "#666", marginBottom: "1rem" }}>Como foi sua experiência?</p>
            <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "1rem" }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setRatingValue(n)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "2rem", opacity: n <= ratingValue ? 1 : 0.3, transition: "all 0.15s", transform: n <= ratingValue ? "scale(1.1)" : "scale(0.9)" }}>⭐</button>
              ))}
            </div>
            <textarea value={ratingComment} onChange={e => setRatingComment(e.target.value)} placeholder="Deixe um comentário (opcional)..." rows={3} style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1.5px solid #E2E8F0", fontSize: "0.85rem", boxSizing: "border-box", resize: "vertical", marginBottom: "1rem" }} />
            <button onClick={submitReview} style={{ width: "100%", padding: "12px", borderRadius: "12px", border: "none", background: "linear-gradient(135deg, #F59E0B, #EF4444)", color: "white", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer" }}>
              Enviar Avaliação
            </button>
          </div>
        </div>
      )}

      {/* PAYMENT GATEWAY MODAL */}
      {showPayment && pendingOrderId && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.65)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(4px)" }}
          onClick={async () => {
            // Um toque ACIDENTAL fora do modal cancelava o pedido inteiro sem
            // perguntar — no meio do Pix, com o QR na tela.
            if (!window.confirm("Cancelar o pagamento? O pedido será cancelado.")) return;
            setShowPayment(false);
            if (pendingOrderId) {
              try {
                await fetch(`/api/customer-order/${pendingOrderId}/status`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ status: "CANCELADO", cancellationReason: "Pagamento fechado pelo cliente" })
                });
              } catch {}
            }
            setPendingOrderId(null);
            setIsCheckout(true);
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: "white", borderRadius: "24px", padding: "1.75rem", maxWidth: "440px", width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,0.3)", position: "relative" }}>
            <PaymentGateway
              orderId={pendingOrderId}
              amount={pendingAmount}
              initialMethod={paymentMethod === "CREDITO_ONLINE" ? "credit_card" : "pix"}
              onPaid={() => {
                setShowPayment(false);
                setCart([]); // Carrinho é limpo APENAS após pagamento aprovado!
                setIsCheckout(false);
                setMobileCartOpen(false);
                setOrderSuccess(pendingOrderId);
              }}
              onError={(msg) => {
                console.warn("Payment error:", msg);
              }}
              onCancel={async () => {
                setShowPayment(false);
                if (pendingOrderId) {
                  try {
                    await fetch(`/api/customer-order/${pendingOrderId}/status`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "CANCELADO", cancellationReason: "Pagamento online cancelado pelo cliente" })
                    });
                  } catch {}
                }
                setPendingOrderId(null);
                setIsCheckout(true);
              }}
            />
          </div>
        </div>
      )}

      {/* CONTACT WIDGET */}
      {franchisee.ifoodWidgetId && franchisee.ifoodMerchantId && (
        <FloatingContactWidget
          ifoodWidgetId={franchisee.ifoodWidgetId}
          ifoodMerchantId={franchisee.ifoodMerchantId}
        />
      )}
    </div>
  );
}
