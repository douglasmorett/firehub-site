/**
 * GET /api/store/token-do-assistente
 *
 * O token da loja logada para o Assistente de Impressão
 * (lib/token-do-assistente.ts). Quem pede é a tela de Impressoras e a faixa
 * "Vincular agora" do painel, que repassam o token ao Assistente no POST
 * /config dele. Só com sessão: a loja vem da sessão (dono da conta), nunca de
 * parâmetro.
 *
 * No FireHub local da contingência não há token (a chave de lá é outra e o
 * token não valeria na nuvem): responde `token: null` e o Assistente fica com
 * o que já tinha.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { criarTokenDoAssistente, ehFirehubLocal } from "@/lib/token-do-assistente";

export const dynamic = "force-dynamic";

const SEM_CACHE = { "Cache-Control": "no-store" };

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401, headers: SEM_CACHE });

  const eu = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!eu) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404, headers: SEM_CACHE });

  // A mesma loja que a tela de Impressoras manda como franchiseeId (page.tsx).
  const lojaId = eu.ownerId || eu.id;
  if (ehFirehubLocal()) return NextResponse.json({ franchiseeId: lojaId, token: null }, { headers: SEM_CACHE });
  return NextResponse.json({ franchiseeId: lojaId, token: criarTokenDoAssistente(lojaId) }, { headers: SEM_CACHE });
}
