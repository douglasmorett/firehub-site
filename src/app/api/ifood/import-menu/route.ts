/**
 * POST /api/ifood/import-menu
 * Importa o cardápio do restaurante usando a API oficial iFood Merchant (Catalog API).
 * 
 * Fluxo:
 *  1. Autentica com IFOOD_CLIENT_ID + IFOOD_CLIENT_SECRET → Bearer token
 *  2. GET /catalog/v2.0/merchants/{merchantId}/catalogs → lista catálogos
 *  3. GET /catalog/v2.0/merchants/{merchantId}/catalogs/{catalogId}/unsynchronized → itens
 *  4. Salva no banco como MenuProduct
 * 
 * O restaurante precisa ter o merchantId (UUID) cadastrado no perfil.
 * Se não tiver, extrai da URL do iFood como fallback.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const IFOOD_API = "https://merchant-api.ifood.com.br";

// ─── Autenticação OAuth2 iFood ──────────────────────────────────────────────
let _ifoodToken: string | null = null;
let _ifoodTokenExp = 0;

async function getIfoodToken(): Promise<string> {
  if (_ifoodToken && Date.now() < _ifoodTokenExp) return _ifoodToken;

  const clientId     = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Credenciais iFood não configuradas (IFOOD_CLIENT_ID / IFOOD_CLIENT_SECRET).");
  }

  const res = await fetch(`${IFOOD_API}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grantType:    "client_credentials",
      clientId,
      clientSecret,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`iFood auth falhou: ${res.status} — ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  _ifoodToken    = data.accessToken;
  _ifoodTokenExp = Date.now() + (data.expiresIn - 30) * 1000;
  return _ifoodToken!;
}

// ─── Lista catálogos do merchant ────────────────────────────────────────────
async function fetchCatalogs(merchantId: string, token: string) {
  const res = await fetch(
    `${IFOOD_API}/catalog/v2.0/merchants/${merchantId}/catalogs`,
    { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Erro ao buscar catálogos: ${res.status}`);
  return res.json();
}

// ─── Busca itens do catálogo ────────────────────────────────────────────────
async function fetchCatalogItems(merchantId: string, catalogId: string, token: string) {
  // Endpoint principal: unsynchronized (todos os itens ativos)
  const endpoints = [
    `${IFOOD_API}/catalog/v2.0/merchants/${merchantId}/catalogs/${catalogId}/unsynchronized`,
    `${IFOOD_API}/catalog/v1.0/merchants/${merchantId}/items`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch { /* try next */ }
  }
  return null;
}

// ─── Extrai merchantId da URL do iFood ─────────────────────────────────────
function extractMerchantId(url: string): string | null {
  const uuidMatch = url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return uuidMatch ? uuidMatch[1] : null;
}

// ─── Normaliza resposta da API de catálogo ──────────────────────────────────
function normalizeItems(data: any): Array<{
  name: string; description: string; price: number; category: string; imageUrl: string | null;
}> {
  const products: any[] = [];

  // Estrutura: { categories: [{ name, items: [...] }] }
  const categories: any[] =
    data?.categories ||
    data?.catalog?.categories ||
    data?.unsynchronized?.categories ||
    (Array.isArray(data) ? data : []);

  for (const cat of categories) {
    const catName = cat.name || cat.externalCode || "Cardápio";
    const items: any[] = cat.items || cat.products || cat.itens || [];

    for (const item of items) {
      const price =
        item.price?.value ??
        item.unitPrice ??
        item.originalValue ??
        item.sellingPrice ??
        0;

      const imageUrl =
        item.logoUrl ??
        item.imageUrl ??
        item.image?.url ??
        (item.imagePath ? `https://static-images.ifood.com.br/image/upload/${item.imagePath}` : null);

      products.push({
        name:        item.name || item.description || "Produto",
        description: item.description || item.details || item.ingredients || "",
        price:       typeof price === "number" ? price : parseFloat(String(price).replace(",", ".")) || 0,
        category:    catName,
        imageUrl,
      });

      // Sub-itens (produtos dentro de combo)
      if (item.garnishItems?.length) {
        for (const sub of item.garnishItems) {
          const subPrice = sub.price?.value ?? sub.unitPrice ?? 0;
          products.push({
            name:        sub.name || sub.description || "Adicional",
            description: sub.description || "",
            price:       typeof subPrice === "number" ? subPrice : parseFloat(String(subPrice)) || 0,
            category:    catName,
            imageUrl:    sub.logoUrl ?? sub.imageUrl ?? null,
          });
        }
      }
    }
  }

  return products.filter(p => p.name && p.price >= 0);
}

// ─── Handler Principal ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const franchiseeId = (session.user as any).id;
  const { ifoodUrl, merchantId: bodyMerchantId, mode = "preview" } = await req.json();

  // Pega o merchantId: do body direto ou extrai da URL
  const merchantId = bodyMerchantId || (ifoodUrl ? extractMerchantId(ifoodUrl) : null) ||
    // Tenta pegar do banco (iFood já configurado)
    (await prisma.user.findUnique({ where: { id: franchiseeId }, select: { ifoodMerchantId: true } }))?.ifoodMerchantId;

  if (!merchantId) {
    return NextResponse.json({
      error: "Merchant ID do iFood não encontrado. Cole a URL do seu restaurante no iFood ou configure a integração iFood primeiro.",
    }, { status: 400 });
  }

  try {
    const token = await getIfoodToken();

    // Busca lista de catálogos
    const catalogsData = await fetchCatalogs(merchantId, token);
    const catalogs: any[] = catalogsData?.catalogs || catalogsData || [];

    if (!catalogs.length) {
      return NextResponse.json({
        error: "Nenhum catálogo encontrado para este restaurante. Verifique se o merchantId está correto.",
      }, { status: 404 });
    }

    // Busca itens do primeiro catálogo ativo
    const activeCatalog = catalogs.find((c: any) => c.status === "AVAILABLE" || c.origin === "IFOOD") || catalogs[0];
    const itemsData = await fetchCatalogItems(merchantId, activeCatalog.catalogId || activeCatalog.id, token);

    const products = normalizeItems(itemsData || activeCatalog);

    if (products.length === 0) {
      return NextResponse.json({
        error: "Cardápio encontrado, mas sem produtos. O restaurante pode ter o cardápio privado ou sem itens ativos.",
      }, { status: 404 });
    }

    // ── PREVIEW ──
    if (mode === "preview") {
      return NextResponse.json({
        merchantId,
        catalogId: activeCatalog.catalogId || activeCatalog.id,
        count:      products.length,
        categories: [...new Set(products.map(p => p.category))],
        products:   products.slice(0, 80),
      });
    }

    // ── IMPORT ──
    const created: string[] = [];
    const skipped: string[] = [];

    for (const p of products) {
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
      message:  `✅ ${created.length} produtos importados da API oficial iFood!${skipped.length > 0 ? ` (${skipped.length} já existiam)` : ""}`,
    });

  } catch (err: any) {
    console.error("[iFood Import]", err.message);
    return NextResponse.json({
      error: `Erro na API do iFood: ${err.message}`,
    }, { status: 502 });
  }
}
