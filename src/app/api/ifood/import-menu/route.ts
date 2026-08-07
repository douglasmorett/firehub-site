/**
 * POST /api/ifood/import-menu
 * Importa o cardápio via Merchant API oficial do iFood.
 * Quando o app estiver totalmente homologado (status "Distributed"), isso funciona automaticamente.
 * Enquanto isso, orienta o usuário a usar a importação via planilha.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// ─── Obtém token da Merchant API do iFood ────────────────────────────────────
async function getIfoodToken(): Promise<string | null> {
  const clientId = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const res = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grantType: "client_credentials",
        clientId,
        clientSecret,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.accessToken || null;
  } catch {
    return null;
  }
}

// ─── Busca catálogo via Merchant API ─────────────────────────────────────────
async function fetchCatalogViaAPI(merchantId: string, userAccessToken?: string | null): Promise<{
  restaurantName: string;
  products: Array<{ name: string; description: string; price: number; category: string; imageUrl: string | null }>;
} | null> {
  const token = userAccessToken || (await getIfoodToken());
  if (!token) return null;

  try {
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // 1. Tentar estrutura oficial iFood Catalog v1.0 (/catalogs -> /categories -> /items)
    const catalogsRes = await fetch(`https://merchant-api.ifood.com.br/catalog/v1.0/merchants/${merchantId}/catalogs`, { headers });

    if (catalogsRes.ok) {
      const catalogs: any[] = await catalogsRes.json();
      const catalogId = catalogs?.[0]?.id;

      if (catalogId) {
        const catRes = await fetch(`https://merchant-api.ifood.com.br/catalog/v1.0/merchants/${merchantId}/catalogs/${catalogId}/categories`, { headers });
        const itemsRes = await fetch(`https://merchant-api.ifood.com.br/catalog/v1.0/merchants/${merchantId}/catalogs/${catalogId}/items`, { headers });

        if (catRes.ok && itemsRes.ok) {
          const categories: any[] = await catRes.json();
          const items: any[] = await itemsRes.json();

          const catMap: Record<string, string> = {};
          for (const cat of categories) {
            catMap[cat.id] = cat.name || "Cardápio";
          }

          const normalized = (Array.isArray(items) ? items : []).map((i: any) => ({
            name: i.name || i.description || "",
            description: i.description || i.details || "",
            price: typeof i.price === "object" ? (i.price.value || 0) / 100 : (typeof i.price === "number" ? i.price : parseFloat(i.price) || 0),
            category: catMap[i.categoryId] || i.categoryName || "Cardápio",
            imageUrl: i.imagePath || i.imageUrl || i.logoUrl || null,
          })).filter((p: any) => p.name);

          if (normalized.length > 0) {
            return { restaurantName: "Cardápio iFood", products: normalized };
          }
        }
      }
    }

    // 2. Fallback direto para endpoints legados (/categories & /products)
    const catRes = await fetch(`https://merchant-api.ifood.com.br/catalog/v1.0/merchants/${merchantId}/categories`, { headers });
    const prodRes = await fetch(`https://merchant-api.ifood.com.br/catalog/v1.0/merchants/${merchantId}/products`, { headers });

    if (catRes.ok && prodRes.ok) {
      const categories: any[] = await catRes.json();
      const products: any[] = await prodRes.json();

      const catMap: Record<string, string> = {};
      for (const cat of categories) {
        catMap[cat.id || cat.externalCode] = cat.name || "Cardápio";
      }

      const normalized = (Array.isArray(products) ? products : []).map((p: any) => ({
        name: p.name || p.description || "",
        description: p.details || p.serving || "",
        price: typeof p.price === "object"
          ? (p.price.value || 0) / 100
          : (typeof p.price === "number" ? (p.price > 500 ? p.price / 100 : p.price) : parseFloat(p.price) || 0),
        category: catMap[p.categoryId || p.categoryCode] || p.categoryName || "Cardápio",
        imageUrl: p.logoUrl || p.imageUrl || null,
      })).filter((p: any) => p.name);

      return { restaurantName: "Cardápio iFood", products: normalized };
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Busca catálogo via iFood Marketplace Public API ──────────────────────────
async function fetchCatalogViaPublicAPI(merchantId: string): Promise<{
  restaurantName: string;
  products: Array<{ name: string; description: string; price: number; category: string; imageUrl: string | null }>;
} | null> {
  try {
    const urls = [
      `https://marketplace.ifood.com.br/v2/restaurants/${merchantId}/catalog`,
      `https://marketplace.ifood.com.br/v1/merchants/${merchantId}/catalog`,
      `https://marketplace.ifood.com.br/v1/restaurants/${merchantId}/menu`,
    ];

    for (const url of urls) {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json",
        },
      });

      if (!res.ok) continue;
      const data = await res.json();

      const categories = data?.data?.menu || data?.menu || data?.categories || data?.data?.categories || data?.data || [];
      if (!Array.isArray(categories) || categories.length === 0) continue;

      const products: any[] = [];
      const restaurantName = data?.data?.name || data?.name || "Cardápio iFood";

      for (const cat of categories) {
        const catName = cat.name || cat.title || "Cardápio";
        const items = cat.items || cat.products || [];

        for (const item of items) {
          const rawPrice = typeof item.price === "object" ? (item.price?.value ?? item.price?.unitPrice ?? 0) : item.price;
          const price = typeof rawPrice === "number" ? (rawPrice > 500 ? rawPrice / 100 : rawPrice) : parseFloat(rawPrice) || 0;

          const img = item.imagePath || item.imageUrl || item.logoUrl || null;
          const fullImg = img ? (img.startsWith("http") ? img : `https://static-images.ifood.com.br/image/upload/t_medium/pratos/${img}`) : null;

          if (item.name) {
            products.push({
              name: item.name,
              description: item.description || item.details || "",
              price: price || 0,
              category: catName,
              imageUrl: fullImg,
            });
          }
        }
      }

      if (products.length > 0) {
        return { restaurantName, products };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Busca catálogo via HTML NextData do Link Público ─────────────────────────
async function fetchCatalogViaPublicPage(ifoodUrl: string): Promise<{
  restaurantName: string;
  products: Array<{ name: string; description: string; price: number; category: string; imageUrl: string | null }>;
} | null> {
  if (!ifoodUrl || !ifoodUrl.includes("ifood.com.br")) return null;
  try {
    const res = await fetch(ifoodUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/);
    if (!match || !match[1]) return null;

    const nextData = JSON.parse(match[1]);
    const pageProps = nextData?.props?.pageProps;
    if (!pageProps) return null;

    const categories = pageProps?.initialState?.restaurant?.menu
      || pageProps?.menu
      || pageProps?.catalog
      || pageProps?.categoryResult
      || [];

    const restaurantName = pageProps?.initialState?.restaurant?.details?.name
      || pageProps?.restaurant?.name
      || "Cardápio iFood";

    const products: any[] = [];
    for (const cat of categories) {
      const catName = cat.name || cat.title || "Cardápio";
      const items = cat.items || cat.products || [];
      for (const item of items) {
        const rawPrice = typeof item.price === "object" ? (item.price?.value ?? item.price?.unitPrice ?? 0) : item.price;
        const price = typeof rawPrice === "number" ? (rawPrice > 500 ? rawPrice / 100 : rawPrice) : parseFloat(rawPrice) || 0;

        const img = item.imagePath || item.imageUrl || item.logoUrl || null;
        const fullImg = img ? (img.startsWith("http") ? img : `https://static-images.ifood.com.br/image/upload/t_medium/pratos/${img}`) : null;

        if (item.name) {
          products.push({
            name: item.name,
            description: item.description || item.details || "",
            price: price || 0,
            category: catName,
            imageUrl: fullImg,
          });
        }
      }
    }

    if (products.length > 0) {
      return { restaurantName, products };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Handler Principal ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const franchiseeId = (session.user as any).id;
  const { ifoodUrl, mode = "preview", categories } = await req.json();

  const dbUser = await prisma.user.findUnique({
    where: { id: franchiseeId },
    select: { ifoodMerchantId: true, ifoodAccessToken: true },
  });

  // Extrai merchant ID da URL, do corpo ou do usuário logado no banco
  const uuidFromUrl = ifoodUrl
    ? (ifoodUrl.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1] || null)
    : null;
  const merchantId = uuidFromUrl || dbUser?.ifoodMerchantId || null;

  // Se o usuário não informou link e não tem iFood conectado nas Integrações
  if (!ifoodUrl && !dbUser?.ifoodMerchantId) {
    return NextResponse.json({
      error: "not_connected",
      notConnected: true,
      message: "É necessário ativar sua integração com a conta iFood que você quer puxar o cardápio antes.",
    }, { status: 400 });
  }

  try {
    // 1. Tenta via Merchant API (Oficial v1.0)
    let catalogResult = merchantId ? await fetchCatalogViaAPI(merchantId, dbUser?.ifoodAccessToken) : null;

    // 2. Fallback: Tenta via iFood Public Marketplace API
    if (!catalogResult && merchantId) {
      catalogResult = await fetchCatalogViaPublicAPI(merchantId);
    }

    // 3. Fallback: Tenta via HTML NextData do Link Público
    if (!catalogResult && ifoodUrl) {
      catalogResult = await fetchCatalogViaPublicPage(ifoodUrl);
    }

    if (!catalogResult) {
      return NextResponse.json({
        error: "Não conseguimos localizar os produtos neste link. Verifique se o restaurante está ativo no iFood ou tente colar o link direto da loja.",
      }, { status: 404 });
    }

    const { restaurantName, products } = catalogResult;

    if (products.length === 0) {
      return NextResponse.json({
        error: "Cardápio encontrado, mas sem produtos. O restaurante pode ter o cardápio vazio ou restrito.",
      }, { status: 404 });
    }

    // ── PREVIEW ──
    if (mode === "preview") {
      const cats = [...new Set(products.map(p => p.category))];
      return NextResponse.json({
        restaurantName,
        count: products.length,
        categories: cats,
        products: products.slice(0, 80),
      });
    }

    // ── IMPORT ──
    const created: string[] = [];
    const skipped: string[] = [];

    // Filtrar produtos pelas categorias selecionadas pelo usuário
    let productsToImport = products;
    if (categories && Array.isArray(categories)) {
      const catSet = new Set(categories);
      productsToImport = products.filter(p => catSet.has(p.category));
    }

    for (const p of productsToImport) {

      try {
        const exists = await prisma.menuProduct.findFirst({
          where: { franchiseeId, name: { equals: p.name, mode: "insensitive" } },
        });
        if (exists) { skipped.push(p.name); continue; }

        await prisma.menuProduct.create({
          data: {
            franchiseeId,
            name:        p.name,
            description: p.description,
            price:       p.price,
            category:    p.category,
            imageUrl:    p.imageUrl,
            active:      true,
          },
        });
        created.push(p.name);
      } catch {
        skipped.push(p.name);
      }
    }

    return NextResponse.json({
      success:  true,
      imported: created.length,
      skipped:  skipped.length,
      message:  `✅ ${created.length} produtos importados do iFood!${skipped.length > 0 ? ` (${skipped.length} já existiam)` : ""}`,
    });

  } catch (err: any) {
    console.error("[iFood Import]", err.message);
    return NextResponse.json({
      error: err.message || "Erro ao importar cardápio do iFood.",
    }, { status: 502 });
  }
}
