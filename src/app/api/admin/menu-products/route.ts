import { NextRequest, NextResponse } from "next/server";
import { podeOrdenarProdutos } from "@/lib/menu-order";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isDataUrl, saveDataUrl } from "@/lib/storage";
import { SEM_PRODUTO_DE_INTEGRACAO } from "@/lib/cardapio-interno";

// ─── ESCOPO POR LOJA (isolamento multi-tenant) ──────────────────────────────
// O que era explorável antes desta blindagem: POST/PUT/DELETE só exigiam
// "estar logado". Qualquer lojista autenticado podia mandar o id de um produto
// de OUTRA franquia e (a) reescrever preço/nome/foto, (b) roubar o item para o
// próprio cardápio mandando franchiseeId no corpo, ou (c) apagar o cardápio
// inteiro do vizinho. Nenhum verbo conferia o dono do registro. Agora todos
// resolvem a loja da sessão (ownerId || id — funcionário grava na loja do dono;
// ADMIN respeita o cookie firehub_active_store, mesmo padrão de
// /api/store/dynamic-eta) e confirmam que o alvo pertence a ela ANTES de gravar.

type Scope = {
  userId: string;
  role: string;
  storeId: string;             // franquia dona dos dados do usuário logado
  isAdmin: boolean;
  adminStoreId: string | null; // loja escolhida pelo ADMIN (cookie/querystring)
};

async function resolveScope(
  req: NextRequest
): Promise<{ scope: Scope; error: null } | { scope: null; error: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { scope: null, error: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, role: true, ownerId: true },
  });
  if (!user) {
    return { scope: null, error: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };
  }

  const isAdmin = user.role === "ADMIN";
  const activeStoreId =
    req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value || null;

  return {
    scope: {
      userId: user.id,
      role: user.role,
      storeId: user.ownerId || user.id,
      isAdmin,
      adminStoreId: isAdmin && activeStoreId && activeStoreId !== "all" ? activeStoreId : null,
    },
    error: null,
  };
}

// Regra de posse. Franqueado/funcionário: só produto da própria loja (produto
// sem dono é invisível para eles no GET, logo também não pode ser editado).
// ADMIN (papel da matriz FireHub, não é auto-atribuível no cadastro) mantém a
// visão global que o suporte já usava — a tela /store/cardapio lista todas as
// lojas para ele, então bloquear pelo cookie derrubaria o atendimento. Fica só
// o registro no log quando ele mexe fora da loja ativa.
function canTouch(scope: Scope, franchiseeId: string | null): boolean {
  if (scope.isAdmin) {
    if (scope.adminStoreId && franchiseeId !== scope.adminStoreId) {
      console.warn(
        `[menu-products] ADMIN ${scope.userId} alterando produto da loja ${franchiseeId} com a loja ativa ${scope.adminStoreId}.`
      );
    }
    return true;
  }
  return !!franchiseeId && franchiseeId === scope.storeId;
}

const comboItemId = (it: any): string | null =>
  typeof it === "string" ? it : (it?.id || it?.menuProductId || null);

/**
 * Monta o payload de um grupo de combo. POST e PUT gravam pelo mesmo caminho —
 * antes cada um montava o seu, e um campo novo entrava só na metade dos casos.
 *
 * `minQty` chega como número ou não chega. Ausente vira NULO de propósito: é o
 * que preserva a regra antiga ("exige exatamente maxQty") para todo combo
 * gravado antes da coluna existir, e para todo cliente da API que ainda não
 * sabe mandar o campo.
 */
function dadosDoGrupo(g: any, gIdx: number) {
  const maxQty = Number(g?.maxQty) > 0 ? Number(g.maxQty) : 1;
  const minBruto = Number(g?.minQty);
  const minQty =
    g?.minQty === null || g?.minQty === undefined || !Number.isFinite(minBruto) || minBruto < 0
      ? null
      : Math.min(Math.trunc(minBruto), maxQty);

  return {
    title: g?.title,
    maxQty,
    minQty,
    sortOrder: gIdx,
    items: {
      create: (Array.isArray(g?.items) ? g.items : []).map((it: any) => {
        const maxItem = Number(it?.maxPerItem);
        return {
          menuProductId: comboItemId(it) as string,
          additionalPrice: typeof it === "object" ? (Number(it?.additionalPrice) || 0) : 0,
          maxPerItem: Number.isFinite(maxItem) && maxItem > 0 ? Math.trunc(maxItem) : null,
          optionNote:
            typeof it === "object" && typeof it?.optionNote === "string" && it.optionNote.trim()
              ? it.optionNote.trim()
              : null,
        };
      }),
    },
  };
}

// Um combo só pode apontar para itens da MESMA loja. Antes dava para montar um
// combo referenciando produtos de outra franquia (e vazar nome/preço deles na
// tela). Itens de fora são descartados em vez de derrubar o salvamento inteiro.
async function keepOwnComboItems(comboGroups: any, ownerStoreId: string | null): Promise<any> {
  if (!ownerStoreId || !Array.isArray(comboGroups) || comboGroups.length === 0) return comboGroups;

  const ids = Array.from(
    new Set(
      comboGroups
        .flatMap((g: any) => (Array.isArray(g?.items) ? g.items : []))
        .map(comboItemId)
        .filter(Boolean) as string[]
    )
  );
  if (ids.length === 0) return comboGroups;

  const ownedRows = await prisma.menuProduct.findMany({
    where: { id: { in: ids }, franchiseeId: ownerStoreId },
    select: { id: true },
  });
  const owned = new Set(ownedRows.map((p) => p.id));

  const dropped = ids.filter((id) => !owned.has(id));
  if (dropped.length > 0) {
    console.warn(`[menu-products] Itens de combo fora da loja ${ownerStoreId} ignorados:`, dropped);
  }

  return comboGroups.map((g: any) => ({
    ...g,
    items: (Array.isArray(g?.items) ? g.items : []).filter((it: any) => {
      const id = comboItemId(it);
      return !!id && owned.has(id);
    }),
  }));
}

export async function GET(req: NextRequest) {
  const { scope, error } = await resolveScope(req);
  if (!scope) return error;

  // Regra única em src/lib/cardapio-interno.ts. A lista escrita aqui comparava
  // com "IFOOD" em caixa alta e a sincronização grava "iFood": o `in` do Prisma
  // diferencia caixa, então este filtro não excluía UM produto sequer. Os 36
  // espelhos do iFood da Hakim Centro chegavam ao PDV misturados ao cardápio.
  const excludeIntegrationCategories = SEM_PRODUTO_DE_INTEGRACAO;

  // ADMIN com uma loja selecionada (cookie firehub_active_store, mesmo padrao de
  // /api/store/dynamic-eta) deve carregar SO o cardapio daquela loja. Sem isso o
  // PDV de balcao/mesa puxava o catalogo inteiro de todas as franquias, com todos
  // os combos aninhados — lento e mostrando produto de outra loja.
  const where = scope.isAdmin
    ? (scope.adminStoreId
        ? { franchiseeId: scope.adminStoreId, ...excludeIntegrationCategories }
        : excludeIntegrationCategories)
    : {
        franchiseeId: scope.storeId,
        ...excludeIntegrationCategories
      };

  const products = await prisma.menuProduct.findMany({
    where,
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, price: true, category: true,
      imageUrl: true, active: true, isCombo: true, isBeverage: true,
      activePDV: true, activeDelivery: true, activeTotem: true, activeGarcom: true,
      cost: true, tags: true, availableDays: true, description: true,
      comboConfig: true,
      comboGroups: {
        orderBy: { sortOrder: "asc" },
        include: {
          items: {
            include: {
              // imageUrl NAO entra aqui de proposito. A tela de combo mostra so o
              // NOME da opcao ("6 Nuggets"), nunca a foto. Como o mesmo produto
              // aparece em varios combos, a imagem vinha DUPLICADA a cada combo:
              // uma foto de 1,8 MB usada em 6 combos virava 10,6 MB no JSON.
              // Medido em producao: payload de 14,63 MB, sendo 10,59 MB so de
              // copias aninhadas. 38 segundos para abrir o balcao.
              menuProduct: { select: { id: true, name: true, active: true } }
            }
          }
        }
      }
    },
  });

  return NextResponse.json(products);
}

/**
 * Impede que imagem em base64 volte a ser gravada dentro do banco.
 *
 * Era assim que o cardapio publico chegou a 18,7 MB (18,5 MB só de 10 fotos):
 * o formulario mandava `data:image/png;base64,...` e isso ia inteiro para a
 * coluna imageUrl. Toda tela que lista produto — balcao, mesa, cardapio, KDS,
 * app do motoboy — baixava tudo isso.
 *
 * O cliente ja envia a foto comprimida para /api/upload, mas aqui a conversao
 * fica como rede de seguranca para qualquer cliente antigo ou fora do padrao.
 */
async function normalizarImagem(rest: any) {
  if (!isDataUrl(rest?.imageUrl)) return;
  try {
    const saved = await saveDataUrl(rest.imageUrl, "produtos");
    rest.imageUrl = saved.url;
  } catch {
    // Data URI invalido ou tipo nao suportado: melhor ficar sem imagem do que
    // enfiar megabytes de texto no banco.
    rest.imageUrl = null;
  }
}

export async function POST(req: NextRequest) {
  const { scope, error } = await resolveScope(req);
  if (!scope) return error;

  const data = await req.json();

  // franchiseeId NUNCA vem do corpo para franqueado/funcionário: é sempre a loja
  // da sessão. Antes, um corpo malicioso podia cadastrar produto direto dentro
  // do cardápio de outra franquia. ADMIN mantém o poder de escolher a loja.
  const { id, comboGroups, franchiseeId: bodyFranchiseeId, ...rest } = data;
  const franchiseeId: string = scope.isAdmin
    ? (bodyFranchiseeId || scope.adminStoreId || scope.storeId)
    : scope.storeId;

  await normalizarImagem(rest);
  const safeComboGroups = await keepOwnComboItems(comboGroups, franchiseeId);

  const product = await prisma.menuProduct.create({
    data: {
      ...rest,
      tags: rest.tags ? JSON.stringify(rest.tags) : null,
      availableDays: rest.availableDays ? JSON.stringify(rest.availableDays) : null,
      franchiseeId,
      comboGroups: safeComboGroups && Array.isArray(safeComboGroups) && safeComboGroups.length > 0 ? {
        create: safeComboGroups.map((g: any, gIdx: number) => dadosDoGrupo(g, gIdx))
      } : undefined
    }
  });

  return NextResponse.json(product);
}

export async function PUT(req: NextRequest) {
  const { scope, error } = await resolveScope(req);
  if (!scope) return error;

  const data = await req.json();
  // franchiseeId sai do payload de propósito: era o caminho para "roubar" um
  // produto, transferindo-o para o cardápio de outra loja com um simples PUT.
  const { id, comboGroups, franchiseeId: _ignoraFranchiseeId, ...updateData } = data;

  if (!id) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

  const existing = await prisma.menuProduct.findUnique({
    where: { id },
    select: { id: true, franchiseeId: true },
  });
  if (!existing) return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
  if (!canTouch(scope, existing.franchiseeId)) {
    return NextResponse.json({ error: "Sem permissão para alterar este produto" }, { status: 403 });
  }

  if (updateData.tags) {
    updateData.tags = JSON.stringify(updateData.tags);
  }
  if (updateData.availableDays !== undefined) {
    updateData.availableDays = updateData.availableDays ? JSON.stringify(updateData.availableDays) : null;
  }

  // Converte imagem base64 em arquivo ANTES de gravar (rede de seguranca).
  await normalizarImagem(updateData);

  const product = await prisma.menuProduct.update({
    where: { id },
    data: updateData
  });

  if (comboGroups !== undefined) {
    const safeComboGroups = await keepOwnComboItems(comboGroups, existing.franchiseeId);
    await prisma.comboGroup.deleteMany({ where: { menuProductId: id } });
    if (Array.isArray(safeComboGroups) && safeComboGroups.length > 0) {
      for (let gIdx = 0; gIdx < safeComboGroups.length; gIdx++) {
        const g = safeComboGroups[gIdx];
        await prisma.comboGroup.create({
          data: { menuProductId: id, ...dadosDoGrupo(g, gIdx) }
        });
      }
    }
  }

  return NextResponse.json(product);
}

export async function DELETE(req: NextRequest) {
  const { scope, error } = await resolveScope(req);
  if (!scope) return error;

  const data = await req.json();
  const productId = data.id;

  if (!productId) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

  const existing = await prisma.menuProduct.findUnique({
    where: { id: productId },
    select: { id: true, franchiseeId: true },
  });
  if (!existing) return NextResponse.json({ error: "Produto não encontrado" }, { status: 404 });
  if (!canTouch(scope, existing.franchiseeId)) {
    return NextResponse.json({ error: "Sem permissão para excluir este produto" }, { status: 403 });
  }

  try {
    // 1. Remover o item dos combos DA PRÓPRIA LOJA em que ele estiver vinculado.
    //    Antes o deleteMany era global e podia apagar o vínculo dentro do combo
    //    de outra franquia. Se sobrar referência de fora, o delete abaixo falha
    //    no FK e cai no soft delete — o produto some do cardápio do mesmo jeito.
    await prisma.comboGroupItem.deleteMany({
      where: {
        menuProductId: productId,
        comboGroup: { menuProduct: { franchiseeId: existing.franchiseeId } },
      }
    });

    // 2. Excluir o produto do cardápio
    await prisma.menuProduct.delete({ where: { id: productId } });
    return NextResponse.json({ success: true });
  } catch (err) {
    // Soft delete se falhar por restrição em histórico de pedidos anteriores
    await prisma.menuProduct.update({ where: { id: productId }, data: { active: false } });
    return NextResponse.json({ success: true, softDeleted: true });
  }
}

/**
 * Grava a ordem dos produtos dentro de uma categoria.
 *
 * Até aqui o cardápio saía sempre alfabético (`category asc, name asc`), então
 * a loja não tinha como pôr o carro-chefe em cima — só renomeando produto, que
 * é o tipo de gambiarra que aparece como "Brasa Burguer" virando "1 - Brasa
 * Burguer" no cardápio do cliente.
 *
 * Recebe a lista de ids na ordem desejada e grava o índice em sortOrder. Só
 * mexe no que a loja pode tocar: os ids são conferidos um a um contra canTouch
 * antes de qualquer escrita, e um id de outra loja no meio da lista derruba a
 * requisição inteira em vez de gravar metade.
 */
export async function PATCH(req: NextRequest) {
  const { scope, error } = await resolveScope(req);
  if (!scope) return error;

  // Sem a coluna no banco não há onde gravar. Melhor dizer isso com todas as
  // letras do que estourar um erro de Prisma que ninguém sabe interpretar.
  if (!(await podeOrdenarProdutos())) {
    return NextResponse.json(
      { error: "A ordenação de produtos ainda não foi aplicada no banco. Rode `prisma db push` (ver scripts/aplicar-schema.md)." },
      { status: 503 }
    );
  }

  const data = await req.json();
  const orderedIds: string[] = Array.isArray(data?.orderedIds) ? data.orderedIds : [];

  if (orderedIds.length === 0) {
    return NextResponse.json({ error: "Nenhum produto informado" }, { status: 400 });
  }

  const rows = await prisma.menuProduct.findMany({
    where: { id: { in: orderedIds } },
    select: { id: true, franchiseeId: true },
  });

  const encontrados = new Map(rows.map(r => [r.id, r.franchiseeId]));
  const desconhecidos = orderedIds.filter(id => !encontrados.has(id));
  if (desconhecidos.length > 0) {
    return NextResponse.json(
      { error: `Produto não encontrado: ${desconhecidos.slice(0, 3).join(", ")}` },
      { status: 404 }
    );
  }

  const semPermissao = rows.filter(r => !canTouch(scope, r.franchiseeId));
  if (semPermissao.length > 0) {
    return NextResponse.json(
      { error: "Sem permissão para reordenar produtos de outra loja" },
      { status: 403 }
    );
  }

  try {
    // Transação: ou a ordem inteira entra, ou nada entra. Ordem pela metade é
    // pior do que ordem nenhuma — o cardápio ficaria embaralhado sem ninguém
    // ter pedido isso.
    await prisma.$transaction(
      orderedIds.map((id, idx) =>
        // SQL cru de propósito: `sortOrder` NÃO está no schema do Prisma, e é
        // justamente por isso que este endpoint não derruba o cardápio. Ver o
        // comentário em src/lib/menu-order.ts.
        prisma.$executeRaw`UPDATE "MenuProduct" SET "sortOrder" = ${idx} WHERE "id" = ${id}`
      )
    );
    return NextResponse.json({ success: true, total: orderedIds.length });
  } catch (err: any) {
    console.error("[menu-products] Erro ao salvar ordem dos produtos:", err);
    return NextResponse.json({ error: "Erro ao salvar a ordem" }, { status: 500 });
  }
}
