/**
 * QUEM está abrindo o Financeiro e DE QUAL LOJA — resolvido no servidor, uma
 * vez, para a página e para as rotas da tela.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Cada pedaço do Financeiro decidia a loja do seu jeito, e o funcionário com
 * acesso à tela via uma mistura (auditoria de 11/10/2026):
 *   • a página buscava os pedidos da loja do dono (`ownerId || id`), mas lia
 *     taxas de pagamento, custos fixos e metas da linha DO FUNCIONÁRIO;
 *   • /api/billing/cycle calculava a mensalidade com o id da SESSÃO — a do
 *     funcionário, que não tem venda nenhuma;
 *   • a isenção era decidida no navegador pelo e-mail de quem estava logado.
 *
 * Aqui a regra é a dos relatórios (lib/relatorios/servidor.ts): o dono é a
 * loja do usuário ou, para o funcionário, a do dono; o ADMIN vê a loja ativa
 * do seletor (cookie `firehub_active_store`) ou a dele. O funcionário só entra
 * com "Financeiro" marcado — a mesma caixinha que o proxy confere na página.
 */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { hojeNaLoja } from "@/lib/relatorios/base";
import { lojaIsenta } from "@/lib/billing";

/** Os campos da loja dona que o Financeiro usa. */
const CAMPOS_DO_DONO = {
  id: true,
  storeName: true,
  storeTimezone: true,
  createdAt: true,
  paymentFees: true,
  fixedCosts: true,
  financialGoals: true,
  repasseConfig: true,
  // A isenção (lib/billing.ts, lojaIsenta) — decidida AQUI, nunca pelo e-mail
  // de quem está logado.
  email: true,
  planPercent: true,
  isFranqueadoHakim: true,
  ambassadorAccount: { select: { active: true } },
} as const;

export type ContextoDoFinanceiro = {
  usuarioId: string;
  papel: string;
  /** A loja cujo dinheiro a tela mostra. */
  donoId: string;
  dono: {
    id: string;
    storeName: string | null;
    storeTimezone: string | null;
    createdAt: Date;
    paymentFees: unknown;
    fixedCosts: unknown;
    financialGoals: unknown;
    repasseConfig: unknown;
  };
  /** A loja não paga mensalidade (lojaIsenta). */
  isenta: boolean;
  tz: string;
  /** "Hoje" no dia operacional da loja (vira às 5h, lib/relatorios/base.ts). */
  hoje: string;
};

export type ResultadoDoContexto =
  | { ok: true; valor: ContextoDoFinanceiro }
  | { ok: false; status: number; erro: string };

export async function contextoDoFinanceiro(lojaAtivaDoAdmin?: string | null): Promise<ResultadoDoContexto> {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return { ok: false, status: 401, erro: "Não autorizado" };

  const usuario = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, ownerId: true, permissions: true },
  }).catch(() => null);
  if (!usuario) return { ok: false, status: 401, erro: "Usuário não encontrado" };

  const papel = String(usuario.role || "");
  if (!["FRANCHISEE", "ADMIN", "STAFF"].includes(papel)) return { ok: false, status: 403, erro: "Sem acesso ao Financeiro" };
  if (papel === "STAFF" && !funcionarioAbre("/store/financeiro", usuario.permissions)) {
    return { ok: false, status: 403, erro: "Sem acesso ao Financeiro: peça ao dono da loja para marcar \"Financeiro\" no seu cadastro em Equipe." };
  }

  let donoId = usuario.ownerId || usuario.id;
  if (papel === "ADMIN" && lojaAtivaDoAdmin && lojaAtivaDoAdmin !== "all") donoId = lojaAtivaDoAdmin;

  const dono = await prisma.user.findUnique({ where: { id: donoId }, select: CAMPOS_DO_DONO }).catch(() => null);
  if (!dono) return { ok: false, status: 404, erro: "Loja não encontrada" };

  const tz = dono.storeTimezone || "America/Sao_Paulo";
  return {
    ok: true,
    valor: {
      usuarioId: usuario.id,
      papel,
      donoId: dono.id,
      dono: {
        id: dono.id,
        storeName: dono.storeName,
        storeTimezone: dono.storeTimezone,
        createdAt: dono.createdAt,
        paymentFees: dono.paymentFees,
        fixedCosts: dono.fixedCosts,
        financialGoals: dono.financialGoals,
        repasseConfig: dono.repasseConfig,
      },
      isenta: lojaIsenta(dono),
      tz,
      hoje: hojeNaLoja(tz),
    },
  };
}
