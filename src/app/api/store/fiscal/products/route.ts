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
    // As regras da lib (as mesmas que a emissão aplica). A validação local
    // aceitava CFOP de entrada (1102) e CSOSN inexistente — o erro só
    // aparecia na hora de emitir, com a fila esperando.
    const { cfopValido, csosnValido, cstIcmsValido, origemValida } = await import("@/lib/fiscal-validacao");
    if (cfop && !cfopValido(cfop)) problemas.push("CFOP: 4 dígitos começando em 5, 6 ou 7 (venda é saída).");
    if (cest && so(cest).length !== 7) problemas.push("CEST precisa ter 7 dígitos (ou ficar vazio).");
    if (csosn && !(csosnValido(csosn) || cstIcmsValido(csosn))) {
      problemas.push("Situação tributária: CSOSN de 3 dígitos (Simples) ou CST de 2 dígitos (Regime Normal).");
    }
    if (origem !== undefined && origem !== null && origem !== "" && !origemValida(origem)) {
      problemas.push("Origem da mercadoria: 0 a 8.");
    }
    if (problemas.length > 0) {
      return NextResponse.json({ error: "dados_invalidos", mensagem: problemas.join(" ") }, { status: 400 });
    }

    // Só grava o que veio no corpo. O update antigo escrevia TODOS os campos
    // em toda chamada: um PUT que só trazia o NCM resetava CFOP/CSOSN/PIS/
    // COFINS personalizados para os padrões, em silêncio.
    const data: any = {};
    if ("ncm" in body) data.ncm = ncm ? so(ncm) : null;
    if ("cest" in body) data.cest = cest ? so(cest) : null;
    // 5102 (venda dentro do estado) e 102 (Simples, sem crédito) são os
    // valores certos para a esmagadora maioria de restaurante.
    if ("cfop" in body) data.cfop = cfop ? so(cfop) : "5102";
    if ("origem" in body) data.origem = String(origem ?? "0") || "0";
    if ("csosn" in body) data.csosn = csosn ? String(csosn).trim() : "102";
    if ("pis" in body) data.pis = pis || "49";
    if ("cofins" in body) data.cofins = cofins || "49";

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nenhum campo fiscal para atualizar." }, { status: 400 });
    }

    const updated = await prisma.menuProduct.updateMany({
      where: { id: productId, franchiseeId },
      data,
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: "Produto não encontrado nesta loja" }, { status: 404 });
    }

    return NextResponse.json({ success: true, count: updated.count });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
