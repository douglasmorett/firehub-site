/**
 * Quem pode o quê no CMV real.
 *
 *   - DADOS SENSÍVEIS (CMV, CMO, valor do estoque em R$, folha): o dono, o
 *     ADMIN e o funcionário com a caixinha "Dados sensíveis" marcada em Equipe.
 *     A caixinha nasce DESMARCADA, inclusive para quem já tinha tudo marcado:
 *     o caixa que abre o Financeiro não passa a ver o CMV e o salário dos
 *     colegas no dia do deploy.
 *   - CONTAR E LANÇAR COMPRA: quem tem "Estoque". A cozinha conta, mas sem
 *     ver R$ se não tiver os dados sensíveis.
 *
 * A loja é a do estoque: `ownerId || id`, igual às rotas de api/store/estoque.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

export const PERMISSAO_DADOS_SENSIVEIS = "dados_sensiveis";

export type AcessoDoCmv = {
  usuarioId: string;
  papel: string;
  lojaId: string;
  tz: string;
  nomeDaLoja: string;
  /** Vê CMV, CMO, R$ do estoque e a folha. */
  veDadosSensiveis: boolean;
  /** Conta estoque e lança compra. */
  mexeNoEstoque: boolean;
  goals: unknown;
};

type Resultado = { ok: true; acesso: AcessoDoCmv } | { ok: false; resposta: NextResponse };

const negar = (status: number, error: string): Resultado => ({ ok: false, resposta: NextResponse.json({ error }, { status }) });

export function temPermissao(csv: string | null | undefined, permissao: string): boolean {
  return String(csv ?? "").split(",").map((p) => p.trim()).includes(permissao);
}

export async function acessoDoCmv(): Promise<Resultado> {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email;
  if (!email) return negar(401, "Não autorizado");

  const usuario = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, ownerId: true, permissions: true },
  });
  if (!usuario) return negar(404, "Usuário não encontrado");

  const papel = String(usuario.role);
  if (!["FRANCHISEE", "ADMIN", "STAFF"].includes(papel)) return negar(403, "Sem acesso");

  const lojaId = usuario.ownerId || usuario.id;
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { storeName: true, name: true, storeTimezone: true, financialGoals: true },
  });
  if (!loja) return negar(404, "Loja não encontrada");

  const ehFuncionario = papel === "STAFF";
  return {
    ok: true,
    acesso: {
      usuarioId: usuario.id,
      papel,
      lojaId,
      tz: loja.storeTimezone || "America/Sao_Paulo",
      nomeDaLoja: loja.storeName || loja.name || "Minha loja",
      veDadosSensiveis: !ehFuncionario || temPermissao(usuario.permissions, PERMISSAO_DADOS_SENSIVEIS),
      mexeNoEstoque: !ehFuncionario || funcionarioAbre("/store/estoque", usuario.permissions),
      goals: loja.financialGoals,
    },
  };
}

/** Para as rotas do painel: só passa quem vê dados sensíveis. */
export async function exigirDadosSensiveis(): Promise<Resultado> {
  const r = await acessoDoCmv();
  if (!r.ok) return r;
  if (!r.acesso.veDadosSensiveis) {
    return negar(403, "Sem acesso aos dados sensíveis: peça ao dono da loja para marcar \"Dados sensíveis\" no seu cadastro em Equipe.");
  }
  return r;
}

/** Para as rotas de contagem e compra: só passa quem mexe no estoque. */
export async function exigirEstoque(): Promise<Resultado> {
  const r = await acessoDoCmv();
  if (!r.ok) return r;
  if (!r.acesso.mexeNoEstoque) {
    return negar(403, "Sem acesso ao estoque: peça ao dono da loja para marcar \"Estoque\" no seu cadastro em Equipe.");
  }
  return r;
}
