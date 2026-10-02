/**
 * Simular pedidos na loja de demonstração do vendedor (lib/pedidos-simulados.ts).
 *
 *   GET    → quantos pedidos simulados estão na tela
 *   POST   → joga a simulação (recusa se já houver uma: o botão vira "retirar")
 *   DELETE → apaga só os pedidos simulados
 *
 * Qualquer loja fora da lista de demonstração recebe 404 — a rota não existe
 * para ela.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apagarSimulacao, contarSimulados, criarSimulacao, ehLojaDeDemonstracao } from "@/lib/pedidos-simulados";

async function lojaDaSessao(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
  if (!u) return null;
  const lojaId = u.ownerId || u.id;
  return ehLojaDeDemonstracao(lojaId) ? lojaId : null;
}

const naoExiste = () => NextResponse.json({ error: "Não encontrado" }, { status: 404 });

export async function GET() {
  const lojaId = await lojaDaSessao();
  if (!lojaId) return naoExiste();
  return NextResponse.json({ quantidade: await contarSimulados(lojaId) });
}

export async function POST() {
  const lojaId = await lojaDaSessao();
  if (!lojaId) return naoExiste();
  const jaTem = await contarSimulados(lojaId);
  if (jaTem > 0) {
    return NextResponse.json({ error: `Já há ${jaTem} pedidos simulados na tela. Retire antes de simular de novo.` }, { status: 409 });
  }
  try {
    const r = await criarSimulacao(lojaId);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    console.error("[Simulação] Não consegui criar os pedidos:", e?.message);
    // O que entrou até o erro sai junto: simulação pela metade só confunde.
    await apagarSimulacao(lojaId).catch(() => 0);
    return NextResponse.json({ error: e?.message || "Não consegui criar os pedidos simulados." }, { status: 500 });
  }
}

export async function DELETE() {
  const lojaId = await lojaDaSessao();
  if (!lojaId) return naoExiste();
  const apagados = await apagarSimulacao(lojaId);
  return NextResponse.json({ ok: true, apagados });
}
