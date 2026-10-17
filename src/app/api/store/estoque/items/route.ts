import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lerNumeroBr } from "@/lib/cmv/numero";
import { conferirPausaPeloEstoque } from "@/lib/pausa-pelo-estoque-no-banco";

// O STAFF é um User com ownerId apontando para o dono da loja. Usando só o user.id,
// o funcionário caía num estoque paralelo vazio em vez do estoque da loja onde trabalha.
async function getFranchiseeId(session: any) {
  const email = session.user.email;
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, ownerId: true }
  });
  if (!user) return null;
  return user.ownerId || user.id;
}

/**
 * Os campos do CMV real no cadastro do insumo (lib/cmv): preparo e rendimento,
 * local na cozinha, contagem do dia, fora do CMV e o custo à mão. Só entra o
 * que veio no corpo — a tela antiga, que não manda nada disso, não apaga nada.
 */
function camposDoCmv(body: any): { dados: Record<string, unknown> } | { erro: string } {
  const dados: Record<string, unknown> = {};
  if (body.tipo !== undefined) dados.tipo = String(body.tipo).toUpperCase() === "PREPARO" ? "PREPARO" : "INSUMO";
  if (body.rendimento !== undefined) {
    if (body.rendimento === "" || body.rendimento === null) dados.rendimento = null;
    else {
      const n = lerNumeroBr(body.rendimento);
      if (!Number.isFinite(n) || n <= 0) return { erro: "O rendimento do preparo tem de ser maior que zero." };
      dados.rendimento = n;
    }
  }
  if (body.local !== undefined) dados.local = String(body.local || "").trim().slice(0, 40) || null;
  if (body.contagemDiaria !== undefined) dados.contagemDiaria = Boolean(body.contagemDiaria);
  if (body.entraNoCmv !== undefined) dados.entraNoCmv = body.entraNoCmv !== false;
  if (body.custoManual !== undefined) {
    if (body.custoManual === "" || body.custoManual === null) dados.unitCost = null;
    else {
      const n = lerNumeroBr(body.custoManual);
      if (!Number.isFinite(n) || n < 0) return { erro: "Custo inválido." };
      dados.unitCost = n;
    }
  }
  return { dados };
}

// GET: List all stock items for the logged-in franchisee
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const franchiseeId = await getFranchiseeId(session);
    if (!franchiseeId) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    // `active: false` é insumo ARQUIVADO (ver o DELETE abaixo). Ele continua
    // no banco com histórico e fichas técnicas inteiros — só sai da lista.
    // `null` conta como ativo: a coluna nasceu depois dos insumos que já
    // existiam, e um `active: true` cru sumiria com o estoque de todo mundo
    // no primeiro deploy.
    const items = await prisma.stockItem.findMany({
      where: { franchiseeId, NOT: { active: false } },
      orderBy: { name: "asc" },
      // A receita do preparo (massa, recheio): o custo dele sai daqui.
      include: { componentes: { select: { insumoId: true, quantidade: true } } },
    });

    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error("[Stock Items GET] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

// POST: Create a new stock item
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const franchiseeId = await getFranchiseeId(session);
    if (!franchiseeId) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    const body = await req.json();
    const { name, quantity, unit, minQuantity, unitCost } = body;
    const extras = camposDoCmv(body);
    if ("erro" in extras) return NextResponse.json({ error: extras.erro }, { status: 400 });

    if (!name) return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });

    // Verificar duplicado
    const existing = await prisma.stockItem.findFirst({
      where: { franchiseeId, name: { equals: name, mode: "insensitive" } }
    });

    if (existing) {
      return NextResponse.json({ error: "Já existe um item com este nome no estoque." }, { status: 400 });
    }

    const item = await prisma.stockItem.create({
      data: {
        franchiseeId,
        name,
        quantity: Number(quantity) || 0,
        unit: unit || "un",
        minQuantity: minQuantity !== undefined && minQuantity !== "" ? Number(minQuantity) : null,
        unitCost: unitCost !== undefined && unitCost !== "" ? Number(unitCost) : null,
        ...extras.dados,
      }
    });

    // Se a quantidade inicial for diferente de zero, registrar transação inicial
    if (Number(quantity) !== 0) {
      await prisma.stockTransaction.create({
        data: {
          stockItemId: item.id,
          quantity: Number(quantity),
          type: "INPUT",
          notes: "Saldo inicial de estoque"
        }
      });
    }

    return NextResponse.json({ success: true, item });
  } catch (error: any) {
    console.error("[Stock Items POST] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

// PUT: Update an existing stock item
export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const franchiseeId = await getFranchiseeId(session);
    if (!franchiseeId) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    const body = await req.json();
    const { id, name, unit, minQuantity } = body;
    const extras = camposDoCmv(body);
    if ("erro" in extras) return NextResponse.json({ error: extras.erro }, { status: 400 });

    if (!id) return NextResponse.json({ error: "ID é obrigatório" }, { status: 400 });

    const existing = await prisma.stockItem.findUnique({ where: { id } });
    if (!existing || existing.franchiseeId !== franchiseeId) {
      return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });
    }

    // A receita do preparo: troca a lista inteira. Os componentes têm de ser
    // insumos DESTA loja, e o preparo não entra na própria receita.
    let componentes: { insumoId: string; quantidade: number }[] | null = null;
    if (Array.isArray(body.componentes)) {
      componentes = [];
      for (const c of body.componentes) {
        const insumoId = String(c?.insumoId || "");
        const quantidade = lerNumeroBr(c?.quantidade);
        if (!insumoId) continue;
        if (insumoId === id) return NextResponse.json({ error: "O preparo não pode entrar na própria receita." }, { status: 400 });
        if (!Number.isFinite(quantidade) || quantidade <= 0) return NextResponse.json({ error: "Há um componente sem quantidade." }, { status: 400 });
        componentes.push({ insumoId, quantidade });
      }
      const ids = Array.from(new Set(componentes.map((c) => c.insumoId)));
      if (ids.length !== componentes.length) return NextResponse.json({ error: "Um insumo aparece duas vezes na receita." }, { status: 400 });
      if (ids.length) {
        const daLoja = await prisma.stockItem.count({ where: { id: { in: ids }, franchiseeId } });
        if (daLoja !== ids.length) return NextResponse.json({ error: "Um componente não é do estoque desta loja." }, { status: 400 });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.update({
        where: { id },
        data: {
          name: name || existing.name,
          unit: unit || existing.unit,
          minQuantity: minQuantity !== undefined ? (minQuantity !== "" ? Number(minQuantity) : null) : existing.minQuantity,
          ...extras.dados,
        }
      });
      if (componentes) {
        await tx.componenteDoPreparo.deleteMany({ where: { preparoId: id } });
        if (componentes.length) await tx.componenteDoPreparo.createMany({ data: componentes.map((c) => ({ preparoId: id, ...c })) });
      }
      return item;
    });

    return NextResponse.json({ success: true, item: updated });
  } catch (error: any) {
    console.error("[Stock Items PUT] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}

// DELETE: Delete a stock item
export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const franchiseeId = await getFranchiseeId(session);
    if (!franchiseeId) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return NextResponse.json({ error: "ID é obrigatório" }, { status: 400 });

    const existing = await prisma.stockItem.findUnique({ where: { id } });
    if (!existing || existing.franchiseeId !== franchiseeId) {
      return NextResponse.json({ error: "Item não encontrado" }, { status: 404 });
    }

    // ── ARQUIVAR, NUNCA APAGAR ────────────────────────────────────────────
    //
    // Era `prisma.stockItem.delete` FÍSICO. A cascata do schema levava junto,
    // em silêncio e sem volta:
    //   · TODAS as StockTransaction do insumo — o histórico inteiro dele;
    //   · TODAS as ProductRecipe que o usam — ou seja, a linha desse insumo
    //     na ficha técnica de TODOS os produtos do cardápio.
    // Um clique na lixeira apagava semanas de cadastro de ficha técnica de
    // produtos que nem estavam na tela, e nada avisava. O `active` de
    // soft-delete já existia documentado no schema e nenhuma rota usava.
    //
    // Arquivar preserva histórico e ficha técnica: o insumo some da lista e da
    // busca, e a baixa automática do que já estava configurado continua
    // funcionando — que é o comportamento que o lojista espera de "remover da
    // minha lista", e não "apagar a contabilidade".
    await prisma.stockItem.updateMany({
      where: { id, franchiseeId },
      data: { active: false },
    });

    // Insumo arquivado não conta mais como "acabou": o que ele segurava
    // pausado pelo estoque pode voltar.
    await conferirPausaPeloEstoque(franchiseeId, [id]);

    return NextResponse.json({ success: true, message: "Insumo arquivado." });
  } catch (error: any) {
    console.error("[Stock Items DELETE] Erro:", error);
    return NextResponse.json({ error: error.message || "Erro interno" }, { status: 500 });
  }
}
