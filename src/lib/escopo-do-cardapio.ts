/**
 * Quem pode mexer no cardápio, e em qual loja.
 *
 * Saiu de api/admin/menu-products/route.ts quando a cópia de pergunta
 * (api/admin/menu-products/copiar-pergunta) passou a gravar no cardápio
 * também: duas cópias da regra de posse é como uma rota fica blindada e a
 * outra não. O texto abaixo é o mesmo de lá.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { podeComoNaTela } from "@/lib/permissoes-da-equipe";

// ─── ESCOPO POR LOJA (isolamento multi-tenant) ──────────────────────────────
// O que era explorável antes desta blindagem: POST/PUT/DELETE só exigiam
// "estar logado". Qualquer lojista autenticado podia mandar o id de um produto
// de OUTRA franquia e (a) reescrever preço/nome/foto, (b) roubar o item para o
// próprio cardápio mandando franchiseeId no corpo, ou (c) apagar o cardápio
// inteiro do vizinho. Nenhum verbo conferia o dono do registro. Agora todos
// resolvem a loja da sessão (ownerId || id — funcionário grava na loja do dono;
// ADMIN respeita o cookie firehub_active_store, mesmo padrão de
// /api/store/dynamic-eta) e confirmam que o alvo pertence a ela ANTES de gravar.

export type Scope = {
  userId: string;
  role: string;
  storeId: string;             // franquia dona dos dados do usuário logado
  isAdmin: boolean;
  adminStoreId: string | null; // loja escolhida pelo ADMIN (cookie/querystring)
};

export async function resolveScope(
  req: NextRequest,
  // Gravar (POST/PUT/DELETE/PATCH) é da tela Cardápio: o funcionário só com a
  // caixinha "Cardápio". Ler continua livre — PDV, mesas e editar pedido leem daqui.
  escrita = false
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
  if (escrita && !podeComoNaTela(user, "/store/cardapio")) {
    return { scope: null, error: NextResponse.json({ error: "Sua conta não tem acesso ao Cardápio." }, { status: 403 }) };
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
export function canTouch(scope: Scope, franchiseeId: string | null): boolean {
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
