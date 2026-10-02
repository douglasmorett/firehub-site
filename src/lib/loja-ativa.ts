/**
 * /src/lib/loja-ativa.ts
 *
 * Multiloja: QUAL loja (ou quais) a tela mostra.
 *
 * ── Como a troca funciona (02/10/2026) ──────────────────────────────────────
 *
 * Cada loja do grupo é uma conta (`User`) própria; as filiais apontam para a
 * principal em `accountGroupId`. O seletor "Suas Lojas" só gravava o cookie
 * `firehub_active_store`, e só 14 arquivos o liam — os outros 148 usavam a
 * loja do LOGIN (`ownerId || id`). A China Pow escolhia "Yakisoba do San" e o
 * Início, os pedidos, o cardápio e o link "Ver cardápio" continuavam da China
 * Pow.
 *
 * Agora escolher uma loja TROCA A CONTA DA SESSÃO para ela (lib/auth.ts,
 * `trocarLoja`, a mesma ideia do modo suporte do admin): toda tela que lê a
 * loja do login passa a ler a loja escolhida, sem exceção. O cookie continua
 * existindo só para uma coisa: "all" = Todas as Lojas, que a sessão não tem
 * como representar sozinha. Nesse modo a sessão fica na loja PRINCIPAL (o que
 * não soma lojas mostra a principal) e as telas que somam — pedidos e o feed
 * deles, Início, relatórios, roteirização — leem o grupo por aqui.
 */
import { prisma } from "@/lib/prisma";

export const COOKIE_DA_LOJA_ATIVA = "firehub_active_store";

type ContaDeLoja = { id: string; ownerId?: string | null; role?: string | null; accountGroupId?: string | null };

/**
 * A conta da sessão pode virar a loja `destino`? (lib/auth.ts, `trocarLoja`.)
 * Só conta de LOJA (dono, não funcionário — funcionário viraria dono da
 * outra), e só para a principal do grupo dela ou uma filial que aponta para
 * essa principal. Sem banco: provada por scripts/teste-loja-ativa.ts.
 */
export function podeTrocarParaLoja(conta: ContaDeLoja | null | undefined, destino: ContaDeLoja | null | undefined): boolean {
  const ehLoja = (u: ContaDeLoja) => !u.ownerId && String(u.role || "").toUpperCase() === "FRANCHISEE";
  if (!conta || !destino || !ehLoja(conta) || !ehLoja(destino)) return false;
  const principal = conta.accountGroupId || conta.id;
  return destino.id === principal || destino.accountGroupId === principal;
}

/** O grupo de uma loja: a principal e as filiais (filial aponta para a principal). */
export async function lojasDoGrupo(lojaId: string): Promise<{ id: string; storeName: string | null; slug: string | null; isPrimaryStore: boolean | null }[]> {
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { id: true, accountGroupId: true } });
  if (!loja) return [];
  const principal = loja.accountGroupId || loja.id;
  return prisma.user.findMany({
    where: { OR: [{ id: principal }, { accountGroupId: principal }] },
    select: { id: true, storeName: true, slug: true, isPrimaryStore: true },
    orderBy: [{ isPrimaryStore: "desc" }, { createdAt: "asc" }],
  });
}

/**
 * As lojas que a tela mostra: a da sessão, ou o grupo inteiro em "Todas as
 * Lojas". Funcionário (STAFF) fica sempre na loja dele — o "todas" é visão de
 * dono.
 */
export async function lojasDaVisao(
  usuario: { id: string; ownerId?: string | null; role?: string | null },
  cookieDaLoja: string | null | undefined,
): Promise<{ lojaIds: string[]; todas: boolean }> {
  const base = usuario.ownerId || usuario.id;
  if (cookieDaLoja !== "all" || String(usuario.role || "").toUpperCase() === "STAFF") {
    return { lojaIds: [base], todas: false };
  }
  const grupo = await lojasDoGrupo(base);
  if (grupo.length <= 1) return { lojaIds: [base], todas: false };
  return { lojaIds: grupo.map((l) => l.id), todas: true };
}
