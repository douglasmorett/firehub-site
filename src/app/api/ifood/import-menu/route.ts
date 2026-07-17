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
async function fetchCatalogViaAPI(merchantId: string): Promise<{
  restaurantName: string;
  products: Array<{ name: string; description: string; price: number; category: string; imageUrl: string | null }>;
} | null> {
  const token = await getIfoodToken();
  if (!token) return null;

  try {
    // Busca categorias
    const catRes = await fetch(
      `https://merchant-api.ifood.com.br/catalog/v1.0/merchants/${merchantId}/categories`,
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );
    if (!catRes.ok) return null;
    const categories: any[] = await catRes.json();

    // Busca produtos
    const prodRes = await fetch(
      `https://merchant-api.ifood.com.br/catalog/v1.0/merchants/${merchantId}/products`,
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );
    if (!prodRes.ok) return null;
    const products: any[] = await prodRes.json();

    // Mapeia categoria pelo id
    const catMap: Record<string, string> = {};
    for (const cat of categories) {
      catMap[cat.id || cat.externalCode] = cat.name || "Cardápio";
    }

    const normalized = (Array.isArray(products) ? products : []).map((p: any) => ({
      name: p.name || p.description || "",
      description: p.details || p.serving || "",
      price: typeof p.price === "object"
        ? (p.price.value || 0) / 100
        : (typeof p.price === "number" ? p.price / 100 : parseFloat(p.price) || 0),
      category: catMap[p.categoryId || p.categoryCode] || p.categoryName || "Cardápio",
      imageUrl: p.logoUrl || p.imageUrl || null,
    })).filter((p: any) => p.name);

    return { restaurantName: "Cardápio iFood", products: normalized };
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


  // Extrai merchant ID da URL ou usa o armazenado nas variáveis de ambiente
  const uuidFromUrl = ifoodUrl
    ? (ifoodUrl.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1] || null)
    : null;
  const merchantId = uuidFromUrl || process.env.IFOOD_MERCHANT_UUID || null;

  if (!merchantId) {
    return NextResponse.json({
      error: "Não foi possível identificar o restaurante. Cole o link completo do iFood (com o UUID no final).",
    }, { status: 400 });
  }

  try {
    // Tenta via Merchant API (funciona quando app está homologado)
    const catalogResult = await fetchCatalogViaAPI(merchantId);

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
