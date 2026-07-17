/**
 * POST /api/admin/import-csv
 * Importa produtos de cardápio via texto CSV/TSV colado pelo usuário.
 * Colunas aceitas: nome, categoria, preço, descrição (em qualquer ordem)
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Detecta separador: vírgula, ponto-e-vírgula ou tab
  const firstLine = lines[0];
  const sep = firstLine.includes("\t") ? "\t"
    : firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";

  const rawHeaders = lines[0].split(sep).map(h =>
    h.replace(/^["']|["']$/g, "").trim().toLowerCase()
  );

  // Mapeia headers para campos padronizados
  const mapHeader = (h: string): string => {
    if (/nome|name|produto|item/.test(h)) return "name";
    if (/categ/.test(h)) return "category";
    if (/pre[çc]o|price|valor|value/.test(h)) return "price";
    if (/desc/.test(h)) return "description";
    if (/imag|url|foto|photo/.test(h)) return "imageUrl";
    return h;
  };

  const headers = rawHeaders.map(mapHeader);

  return lines.slice(1).map(line => {
    const values = line.split(sep).map(v => v.replace(/^["']|["']$/g, "").trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { if (values[i] !== undefined) row[h] = values[i]; });
    return row;
  }).filter(row => row.name);
}

function parsePrice(val: string): number {
  if (!val) return 0;
  const clean = val.replace(/[^\d.,]/g, "").replace(",", ".");
  return parseFloat(clean) || 0;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const { csvText, mode = "preview", categories } = await req.json();

  if (!csvText?.trim()) {
    return NextResponse.json({ error: "Cole o conteúdo da planilha no campo acima." }, { status: 400 });
  }

  const rows = parseCSV(csvText);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Nenhum produto encontrado. Verifique o formato da planilha." }, { status: 400 });
  }

  // Normaliza produtos
  const products = rows.map(row => ({
    name: row.name || "",
    description: row.description || "",
    price: parsePrice(row.price || row.valor || "0"),
    category: row.category || "Cardápio",
    imageUrl: row.imageUrl || null,
  })).filter(p => p.name && p.price >= 0);

  if (mode === "preview") {
    const categories = [...new Set(products.map(p => p.category))];
    return NextResponse.json({
      count: products.length,
      categories,
      products: products.slice(0, 80),
    });
  }

  // Import mode
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
        where: { franchiseeId: user.id, name: { equals: p.name, mode: "insensitive" } },
      });
      if (exists) { skipped.push(p.name); continue; }

      await prisma.menuProduct.create({
        data: {
          franchiseeId: user.id,
          name: p.name,
          description: p.description,
          price: p.price,
          category: p.category,
          imageUrl: p.imageUrl,
          active: true,
        },
      });
      created.push(p.name);
    } catch {
      skipped.push(p.name);
    }
  }

  return NextResponse.json({
    success: true,
    imported: created.length,
    skipped: skipped.length,
    message: `✅ ${created.length} produtos importados!${skipped.length > 0 ? ` (${skipped.length} já existiam)` : ""}`,
  });
}
