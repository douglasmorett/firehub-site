/**
 * Quem USA a cotação e quem CONTRATA.
 *
 * Cadastrar fornecedor e produto, ver o comparativo e mandar pedido é de quem
 * cuida das compras: o dono e o funcionário com a caixinha "Estoque"
 * (/store/cotacao em lib/permissao-da-tela.ts — o mesmo trabalho de lançar a
 * compra no estoque). Ligar e desligar põe R$ 97 no boleto — só o dono (ou o
 * ADMIN na loja), pela mesma porta do Bill, do Multimarcas e da Balança.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { cotacaoEstaLigada } from "./assinatura";
import { garantirEstruturaDaCotacao } from "./estrutura-no-banco";

export type SessaoDaCotacao = { franchiseeId: string; usuarioId: string; podeContratar: boolean };

/**
 * A porta das rotas de trabalho (fornecedores, produtos, comparativo, pedidos):
 * acesso à tela E o módulo ligado. Desligado, a tela mostra a oferta.
 */
export async function exigirCotacao(): Promise<{ ok: true; s: SessaoDaCotacao } | { ok: false; resposta: NextResponse }> {
  const s = await lojaDaCotacaoDaSessao();
  if (!s) return { ok: false, resposta: NextResponse.json({ error: "Seu acesso não abre a cotação. Peça ao dono da loja." }, { status: 403 }) };
  if (!(await garantirEstruturaDaCotacao()) || !(await cotacaoEstaLigada(s.franchiseeId))) {
    return { ok: false, resposta: NextResponse.json({ error: "A Cotação automática está desligada nesta loja." }, { status: 403 }) };
  }
  return { ok: true, s };
}

export async function lojaDaCotacaoDaSessao(): Promise<SessaoDaCotacao | null> {
  const dono = await lojaDoAssessorDaSessao();
  if (dono) return { franchiseeId: dono.franchiseeId, usuarioId: dono.usuarioId, podeContratar: true };

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, permissions: true },
  });
  if (!u || u.role !== "STAFF" || !u.ownerId) return null;
  if (!funcionarioAbre("/store/cotacao", u.permissions)) return null;
  return { franchiseeId: u.ownerId, usuarioId: u.id, podeContratar: false };
}
