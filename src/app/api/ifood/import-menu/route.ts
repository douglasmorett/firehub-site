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
  const merchantId = uuidFromUrl || dbUser?.ifoodMerchantId || process.env.IFOOD_MERCHANT_UUID || null;

  if (!merchantId) {
    return NextResponse.json({
      error: "Não foi possível identificar a loja no iFood. Conecte sua loja iFood primeiro em Integrações.",
    }, { status: 400 });
  }

  try {
    // Tenta via Merchant API (usando o token do lojista ou credencial distribuída)
    const catalogResult = await fetchCatalogViaAPI(merchantId, dbUser?.ifoodAccessToken);

    if (!catalogResult) {
      // App ainda não homologado — orienta para importação via planilha
      return NextResponse.json({
        error: "api_not_ready",
        apiNotReady: true,
        merchantId,
      }, { status: 503 });
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
