/**
 * POST /api/store/roteirizacao-automatica/rodar-agora — um ciclo da Rota 100%
 * automatizada AGORA, gravando, sem esperar o cron de 20 s. Para teste (§4.7
 * do plano, vault "FireHub - Plano despacho automático"): devolve o resumo do
 * ciclo — o que foi feito (`aplicadas`, chamadas do motoboy inclusive) e o
 * que o banco recusou (`falhas`).
 *
 * Só com a regra LIGADA e a loja na liberação: desligada, quem quer ver a
 * decisão sem gravar usa a prévia (GET …/previa). 404 fora da liberação, como
 * a prévia; 409 desligada.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { liberadaPara, lojaDoUsuario } from "@/lib/roteirizacao-automatica/liberacao";
import { lerRoteirizacaoAutomatica } from "@/lib/roteirizacao-automatica/config";
import { rodarRoteirizacaoDaLoja } from "@/lib/roteirizacao-automatica/executar";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
  const lojaId = lojaDoUsuario(u);
  if (!lojaId || !liberadaPara(lojaId)) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  try {
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { deliveryConfig: true } });
    if (!lerRoteirizacaoAutomatica(loja?.deliveryConfig).ativo) {
      return NextResponse.json({ error: "A rota automática está desligada. Ligue antes de rodar (ou use a prévia, que não grava)." }, { status: 409 });
    }
    const resumo = await rodarRoteirizacaoDaLoja(lojaId, { gravar: true });
    return NextResponse.json({ ativo: resumo.config.ativo, loja: { temPino: resumo.temPino }, ...resumo });
  } catch (e: any) {
    console.error("[Rota automática] rodar agora falhou:", e?.message);
    return NextResponse.json({ error: "Não consegui rodar a rota automática agora." }, { status: 500 });
  }
}
