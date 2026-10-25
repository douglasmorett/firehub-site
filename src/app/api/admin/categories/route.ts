import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chaveDaCategoria, planoDeApagar, planoDeRenomear, renomearNasConfigs } from "@/lib/categoria-renomear";
import { podeComoNaTela, type QuemPede } from "@/lib/permissoes-da-equipe";

// ─── ESCOPO POR LOJA (isolamento multi-tenant) ──────────────────────────────
// O que era explorável antes: PUT e DELETE já conferiam o dono, mas o PATCH
// (reordenar/renomear em lote) e a leitura do ADMIN não conferiam nada. Um
// ADMIN operando dentro de uma loja específica reordenava/renomeava/criava
// categoria em TODAS as franquias — e o updateMany/findFirst por nome sem
// filtro chegava a alterar a categoria homônima do vizinho. Agora todo verbo
// resolve a loja da sessão (ownerId || id) e o ADMIN respeita o cookie
// firehub_active_store, mesmo padrão de /api/store/dynamic-eta.

type Scope = {
  id: string;
  role: string;
  isAdmin: boolean;
  targetFranchiseeId: string;  // loja do usuário logado (funcionário usa a do dono)
  adminStoreId: string | null; // loja ativa escolhida pelo ADMIN
  quem: QuemPede;
};

// Criar, renomear, reordenar e apagar categoria é da tela Cardápio: o
// funcionário só com a caixinha "Cardápio", como em menu-products. Ler continua
// livre — KDS e PDV leem daqui (auditoria de 23/10/2026).
const semCardapio = () => NextResponse.json({ error: "Sua conta não tem acesso ao Cardápio." }, { status: 403 });

async function getScope(
  req: NextRequest
): Promise<{ scope: Scope; error: null } | { scope: null; error: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { scope: null, error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true, ownerId: true, permissions: true },
  });
  if (!user) {
    return { scope: null, error: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };
  }

  const isAdmin = user.role === "ADMIN";
  const activeStoreId =
    req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value || null;

  return {
    scope: {
      id: user.id,
      role: user.role,
      isAdmin,
      targetFranchiseeId: user.ownerId || user.id,
      adminStoreId: isAdmin && activeStoreId && activeStoreId !== "all" ? activeStoreId : null,
      quem: user,
    },
    error: null,
  };
}

// Filtro de leitura/edição em lote. Franqueado: só a própria loja. ADMIN dentro
// de uma loja: aquela loja + as categorias globais (franchiseeId null), que são
// as que o próprio ADMIN cria — se elas sumissem da lista, o cadastro de
// produto travaria ("cadastre pelo menos uma categoria"). ADMIN sem loja ativa:
// visão global de antes.
function scopeFilter(scope: Scope): any {
  if (!scope.isAdmin) return { franchiseeId: scope.targetFranchiseeId };
  if (scope.adminStoreId) {
    return { OR: [{ franchiseeId: scope.adminStoreId }, { franchiseeId: null }] };
  }
  return {};
}

// Loja em que novas categorias devem nascer.
function writeFranchiseeId(scope: Scope): string | null {
  return scope.isAdmin ? scope.adminStoreId : scope.targetFranchiseeId;
}

// Posse de uma categoria já existente. ADMIN (matriz FireHub) segue com acesso
// global no registro individual, porque as telas de suporte listam todas as
// lojas para ele; só fica o aviso no log quando é fora da loja ativa.
function canTouch(scope: Scope, franchiseeId: string | null): boolean {
  if (!scope.isAdmin) return franchiseeId === scope.targetFranchiseeId;
  if (scope.adminStoreId && franchiseeId !== scope.adminStoreId && franchiseeId !== null) {
    console.warn(
      `[categories] ADMIN ${scope.id} alterando categoria da loja ${franchiseeId} com a loja ativa ${scope.adminStoreId}.`
    );
  }
  return true;
}

// GET — lista categorias do franchisee ordenadas por sortOrder
export async function GET(req: NextRequest) {
  const { scope, error } = await getScope(req);
  if (!scope) return error;

  const categories = await prisma.menuCategory.findMany({
    where: scopeFilter(scope),
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json(categories);
}

// POST — criar categoria
export async function POST(req: NextRequest) {
  const { scope, error } = await getScope(req);
  if (!scope) return error;
  if (!podeComoNaTela(scope.quem, "/store/cardapio")) return semCardapio();

  const { name, emoji = "🍽️", color = "#64748B", sortOrder = 0, imageUrl = null } = await req.json();

  if (!name?.trim()) {
    return NextResponse.json({ error: "Nome da categoria é obrigatório" }, { status: 400 });
  }

  const category = await prisma.menuCategory.create({
    data: {
      name: name.trim(),
      emoji,
      color,
      imageUrl,
      sortOrder,
      // franchiseeId nunca vem do corpo: é sempre a loja da sessão.
      franchiseeId: writeFranchiseeId(scope),
    },
  });

  return NextResponse.json(category);
}

// PUT — editar categoria. Com `name` é renomear, e vale por id real OU, para a
// categoria virtual (só existe no texto do produto), por `nomeAntigo`. Antes o
// id virtual dava 404 e o id real deixava os produtos com o nome velho
// (Pizzou153, 14/10/2026) — ver lib/categoria-renomear.ts.
export async function PUT(req: NextRequest) {
  const { scope, error } = await getScope(req);
  if (!scope) return error;

  const { id, nomeAntigo, name, emoji, color, sortOrder, imageUrl } = await req.json();
  // A foto da categoria também se troca na tela do Totem (caixinha "Minha
  // loja"), que manda só { id, imageUrl }.
  const soAFoto = name === undefined && emoji === undefined && color === undefined && sortOrder === undefined;
  if (!podeComoNaTela(scope.quem, "/store/cardapio") && !(soAFoto && podeComoNaTela(scope.quem, "/store/totem"))) {
    return semCardapio();
  }
  const idReal = id && !String(id).startsWith("virtual-") ? String(id) : null;
  if (!idReal && !String(nomeAntigo ?? "").trim()) {
    return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });
  }

  const existing = idReal ? await prisma.menuCategory.findUnique({ where: { id: idReal } }) : null;
  if (idReal && !existing) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
  if (existing && !canTouch(scope, existing.franchiseeId)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const visual = {
    ...(emoji !== undefined && { emoji }),
    ...(color !== undefined && { color }),
    ...(imageUrl !== undefined && { imageUrl }),
    ...(sortOrder !== undefined && { sortOrder }),
  };

  // Sem nome novo: só emoji/cor/foto/ordem da linha, como sempre foi.
  if (name === undefined) {
    if (!existing) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
    const updated = await prisma.menuCategory.update({ where: { id: existing.id }, data: visual });
    return NextResponse.json(updated);
  }

  const loja = existing?.franchiseeId ?? writeFranchiseeId(scope);
  if (!loja) {
    // ADMIN sem loja ativa numa categoria global: não há produto de uma loja
    // só para levar junto — renomeia só a linha, como antes.
    if (!existing) return NextResponse.json({ error: "Escolha a loja antes de renomear" }, { status: 400 });
    const nome = String(name ?? "").trim();
    if (!nome) return NextResponse.json({ error: "Nome da categoria é obrigatório" }, { status: 400 });
    const updated = await prisma.menuCategory.update({ where: { id: existing.id }, data: { ...visual, name: nome } });
    return NextResponse.json(updated);
  }

  const categorias = await prisma.menuCategory.findMany({
    where: { franchiseeId: loja },
    select: { id: true, name: true },
  });
  // "Virtual" que já ganhou linha (a tela estava velha): usa a linha.
  const atual =
    existing ?? categorias.find((c) => chaveDaCategoria(c.name) === chaveDaCategoria(nomeAntigo)) ?? null;

  const plano = planoDeRenomear({ atual, nomeAntigo, nomeNovo: name, categorias });
  if (plano.erro !== undefined) return NextResponse.json({ error: plano.erro }, { status: plano.status });

  const ids = await produtosDaCategoria(loja, plano.nomeAntigo);

  const categoria = await prisma.$transaction(async (tx) => {
    if (ids.length > 0) {
      await tx.menuProduct.updateMany({ where: { id: { in: ids }, franchiseeId: loja }, data: { category: plano.nomeFinal } });
    }
    await renomearNasConfigsDaLoja(tx, loja, plano.nomeAntigo, plano.nomeFinal);

    if (plano.juntarEm) {
      if (plano.apagarId) await tx.menuCategory.delete({ where: { id: plano.apagarId } });
      return tx.menuCategory.findUnique({ where: { id: plano.juntarEm } });
    }
    if (plano.renomearId) {
      return tx.menuCategory.update({ where: { id: plano.renomearId }, data: { ...visual, name: plano.nomeFinal } });
    }
    // Virtual: nasce a linha, no lugar em que a tela já mostrava a categoria.
    return tx.menuCategory.create({
      data: {
        name: plano.nomeFinal,
        emoji: emoji || "🍽️",
        color: color || "#64748B",
        imageUrl: imageUrl ?? null,
        sortOrder: typeof sortOrder === "number" ? sortOrder : categorias.length,
        franchiseeId: loja,
      },
    });
  });

  return NextResponse.json({
    ...categoria,
    juntou: !!plano.juntarEm,
    removidaId: plano.apagarId,
    produtos: ids.length,
  });
}

// Ids dos produtos da loja nesta categoria. A comparação é sem maiúscula e sem
// espaço nas pontas, como a tela agrupa — o `equals insensitive` do Prisma não
// apara espaço, e o produto importado com "Pizzas " ficaria para trás.
async function produtosDaCategoria(loja: string, nome: string): Promise<string[]> {
  const produtos = await prisma.menuProduct.findMany({
    where: { franchiseeId: loja },
    select: { id: true, category: true },
  });
  const chave = chaveDaCategoria(nome);
  return produtos.filter((p) => chaveDaCategoria(p.category) === chave).map((p) => p.id);
}

// Impressora por categoria, telas do KDS e "só na finalização" guardam a
// categoria pelo NOME: sem isto, renomear tirava a categoria da impressora e
// da tela da cozinha sem ninguém perceber.
async function renomearNasConfigsDaLoja(tx: any, loja: string, antigo: string, novo: string) {
  if (antigo.trim() === novo.trim()) return;
  const dono = await tx.user.findUnique({
    where: { id: loja },
    select: { printerConfig: true, kdsScreens: true, kdsConfig: true },
  });
  if (!dono) return;
  const mudou = renomearNasConfigs(dono, antigo, novo);
  if (Object.keys(mudou).length === 0) return;
  await tx.user.update({ where: { id: loja }, data: mudou });
}

// PATCH — reordenar categorias em lote
export async function PATCH(req: NextRequest) {
  const { scope, error } = await getScope(req);
  if (!scope) return error;
  if (!podeComoNaTela(scope.quem, "/store/cardapio")) return semCardapio();

  const body = await req.json();
  const { orderedIds, orderedCategories } = body;
  // Filtro de posse aplicado em TODO update/busca do lote. Antes, para ADMIN
  // isso era `null` (nenhum filtro) e o lote saía escrevendo em qualquer loja.
  const ownFilter = scopeFilter(scope);
  const targetFranchiseeId = writeFranchiseeId(scope);

  if (Array.isArray(orderedCategories) && orderedCategories.length > 0) {
    for (let index = 0; index < orderedCategories.length; index++) {
      const cat = orderedCategories[index];
      const catName = (cat.name || "").trim();
      if (!catName) continue;

      if (cat.id && !cat.id.startsWith("virtual-")) {
        // Tentar atualizar por ID (só acerta se a categoria for da loja)
        const updated = await prisma.menuCategory.updateMany({
          where: {
            id: cat.id,
            ...ownFilter
          },
          data: {
            sortOrder: index,
            ...(cat.emoji ? { emoji: cat.emoji } : {}),
            ...(cat.color ? { color: cat.color } : {})
          }
        });
        if (updated.count > 0) continue;

        // ID real que não é desta loja: ignora em silêncio. Antes o fluxo caía
        // na busca por nome sem filtro e acabava renomeando/reordenando a
        // categoria homônima da outra franquia; criar uma cópia aqui também
        // encheria o cardápio de duplicatas. Melhor não fazer nada.
        console.warn(`[categories] PATCH ignorou a categoria ${cat.id} — fora do escopo da loja.`);
        continue;
      }

      // ID virtual (categoria que só existe como texto no produto): buscar por
      // nome DENTRO da loja e criar se não existir
      const existing = await prisma.menuCategory.findFirst({
        where: {
          name: { equals: catName, mode: "insensitive" },
          ...ownFilter
        }
      });

      if (existing) {
        await prisma.menuCategory.update({
          where: { id: existing.id },
          data: {
            sortOrder: index,
            ...(cat.emoji ? { emoji: cat.emoji } : {}),
            ...(cat.color ? { color: cat.color } : {})
          }
        });
      } else {
        await prisma.menuCategory.create({
          data: {
            name: catName,
            emoji: cat.emoji || "🍽️",
            color: cat.color || "#64748B",
            sortOrder: index,
            franchiseeId: targetFranchiseeId
          }
        });
      }
    }

    const categories = await prisma.menuCategory.findMany({
      where: scopeFilter(scope),
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({ success: true, categories });
  }

  if (Array.isArray(orderedIds)) {
    for (let index = 0; index < orderedIds.length; index++) {
      const id = orderedIds[index];
      if (!id || id.startsWith("virtual-")) continue;
      await prisma.menuCategory.updateMany({
        where: {
          id,
          ...ownFilter
        },
        data: { sortOrder: index }
      });
    }

    const categories = await prisma.menuCategory.findMany({
      where: scopeFilter(scope),
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({ success: true, categories });
  }

  return NextResponse.json({ error: "orderedCategories ou orderedIds é obrigatório" }, { status: 400 });
}

// DELETE — excluir categoria, por id real ou pelo nome (virtual). Produto
// nunca é apagado junto: antes a linha sumia e os produtos voltavam como
// categoria virtual. Com produto dentro, ou vem `destino` (nome da categoria
// que recebe os produtos) ou a resposta é 409 com a contagem.
export async function DELETE(req: NextRequest) {
  const { scope, error } = await getScope(req);
  if (!scope) return error;
  if (!podeComoNaTela(scope.quem, "/store/cardapio")) return semCardapio();

  const { id, name, destino } = await req.json();
  const idReal = id && !String(id).startsWith("virtual-") ? String(id) : null;
  if (!idReal && !String(name ?? "").trim()) {
    return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });
  }

  const existing = idReal ? await prisma.menuCategory.findUnique({ where: { id: idReal } }) : null;
  if (idReal && !existing) return NextResponse.json({ error: "Categoria não encontrada" }, { status: 404 });
  if (existing && !canTouch(scope, existing.franchiseeId)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  const loja = existing?.franchiseeId ?? writeFranchiseeId(scope);
  if (!loja) {
    // ADMIN sem loja ativa numa categoria global: só a linha, como antes.
    if (!existing) return NextResponse.json({ error: "Escolha a loja antes de excluir" }, { status: 400 });
    await prisma.menuCategory.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true });
  }

  const nome = String(existing?.name ?? name).trim();
  const categorias = await prisma.menuCategory.findMany({ where: { franchiseeId: loja }, select: { id: true, name: true } });
  const linha = existing ?? categorias.find((c) => chaveDaCategoria(c.name) === chaveDaCategoria(nome)) ?? null;
  const ids = await produtosDaCategoria(loja, nome);

  // O destino pode ser virtual também; se tiver linha, vale o nome dela.
  const nomeDestino = String(destino ?? "").trim();
  const destinoNaLoja = nomeDestino
    ? categorias.find((c) => chaveDaCategoria(c.name) === chaveDaCategoria(nomeDestino)) ?? { id: "", name: nomeDestino }
    : null;

  const plano = planoDeApagar({ nome, produtos: ids.length, destino: destinoNaLoja });
  if (plano.erro !== undefined) {
    return NextResponse.json({ error: plano.erro, produtos: plano.produtos }, { status: plano.status });
  }
  const moverPara = plano.moverPara;

  await prisma.$transaction(async (tx) => {
    if (moverPara) {
      await tx.menuProduct.updateMany({ where: { id: { in: ids }, franchiseeId: loja }, data: { category: moverPara } });
      await renomearNasConfigsDaLoja(tx, loja, nome, moverPara);
    }
    if (linha) await tx.menuCategory.delete({ where: { id: linha.id } });
  });

  return NextResponse.json({ success: true, movidos: moverPara ? ids.length : 0, moverPara });
}
