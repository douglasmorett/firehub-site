import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const franchiseeId = user.ownerId || user.id;

    const products = await prisma.menuProduct.findMany({
      where: { franchiseeId, active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({ success: true, products });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const franchiseeId = user.ownerId || user.id;
    const body = await req.json();
    const { productId, ncm, cest, cfop, origem, csosn, pis, cofins } = body;

    if (!productId) return NextResponse.json({ error: "Product ID obrigatório" }, { status: 400 });

    // ── NADA DE NCM DE MENTIRA ───────────────────────────────────────────────
    // Aqui era `ncm: ncm || "2106.90.90"`. Produto salvo com o campo vazio
    // recebia esse NCM em silêncio e passava a aparecer como "Regular" na tela
    // fiscal — o lojista via o cardápio inteiro verde sem ter cadastrado um NCM
    // sequer. 2106.90.90 é "preparações alimentícias não especificadas": serve
    // para quase nada e classifica errado quase tudo, e classificação errada é
    // problema do lojista com a Receita, não nosso.
    //
    // Agora: NCM vazio fica vazio, e a tela mostra o produto como pendente.
    const problemas: string[] = [];
    const so = (v: unknown) => [...String(v ?? "")].filter((c) => c >= "0" && c <= "9").join("");

    if (ncm && so(ncm).length !== 8) problemas.push("NCM precisa ter 8 dígitos.");
    if (cfop && so(cfop).length !== 4) problemas.push("CFOP precisa ter 4 dígitos.");
    if (cest && so(cest).length !== 7) problemas.push("CEST precisa ter 7 dígitos (ou ficar vazio).");
    if (problemas.length > 0) {
      return NextResponse.json({ error: "dados_invalidos", mensagem: problemas.join(" ") }, { status: 400 });
    }

    const updated = await prisma.menuProduct.updateMany({
      where: { id: productId, franchiseeId },
      data: {
        // Guardamos só os dígitos: é o formato que vai no XML, e evita o mesmo
        // NCM entrar duas vezes escrito de jeitos diferentes.
        ncm: ncm ? so(ncm) : null,
        cest: cest ? so(cest) : null,
        // 5102 (venda dentro do estado) e 102 (Simples, sem crédito) são os
        // valores certos para a esmagadora maioria de restaurante, e diferente
        // do NCM eles NÃO variam por produto — por isso seguem como padrão.
        cfop: cfop ? so(cfop) : "5102",
        origem: origem || "0",
        csosn: csosn || "102",
        pis: pis || "49",
        cofins: cofins || "49",
      },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Produto não encontrado nesta loja" }, { status: 404 });
    }

    return NextResponse.json({ success: true, count: updated.count });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
