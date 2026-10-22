import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// "Não mostrar mais" dos tutoriais para a loja toda (lib/tutoriais.ts ›
// ocultarTutoriaisDaLoja). Só o dono decide: o clique do funcionário continua
// valendo só no aparelho dele.
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, onboardingData: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (user.ownerId) return NextResponse.json({ ok: false, motivo: "só o dono" });

  const atual = user.onboardingData && typeof user.onboardingData === "object" ? (user.onboardingData as Record<string, unknown>) : {};
  await prisma.user.update({
    where: { id: user.id },
    data: { onboardingData: { ...atual, tutoriaisOcultos: true, tutoriaisOcultosEm: new Date().toISOString() } },
  });
  return NextResponse.json({ ok: true });
}
