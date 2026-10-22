/**
 * Rota 100% automatizada — a PRÉVIA: o que o sistema faria agora, sem gravar.
 *
 * D15 do plano (vault "FireHub - Plano despacho automático"): funciona com o
 * interruptor DESLIGADO, para o Douglas ver a decisão com os pedidos reais
 * antes de ligar — rotas propostas (paradas em ordem), quem seria chamado,
 * motoboys na loja e o motivo de cada pedido que ficou de fora. É o botão
 * "🔍 Ver o que o sistema faria agora" da janela da rota automática.
 *
 * 404 fora da liberação (lib/roteirizacao-automatica/liberacao.ts).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { liberadaPara, lojaDoUsuario } from "@/lib/roteirizacao-automatica/liberacao";
import { rodarRoteirizacaoDaLoja } from "@/lib/roteirizacao-automatica/executar";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
  const lojaId = lojaDoUsuario(u);
  if (!lojaId || !liberadaPara(lojaId)) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  try {
    const resumo = await rodarRoteirizacaoDaLoja(lojaId, { gravar: false });
    return NextResponse.json({ ativo: resumo.config.ativo, loja: { temPino: resumo.temPino }, ...resumo });
  } catch (e: any) {
    console.error("[Rota automática] prévia falhou:", e?.message);
    return NextResponse.json({ error: "Não consegui montar a prévia agora." }, { status: 500 });
  }
}
