"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { checkRateLimit } from "@/lib/rateLimit";

export async function changePassword(currentPassword: string, newPassword: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    throw new Error("Não autorizado. Faça login novamente.");
  }

  if (!currentPassword || !newPassword) {
    throw new Error("Preencha todos os campos.");
  }

  if (newPassword.length < 6) {
    throw new Error("A nova senha deve ter pelo menos 6 caracteres.");
  }

  if (currentPassword === newPassword) {
    throw new Error("A nova senha deve ser diferente da atual.");
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, password: true },
  });

  if (!user) {
    throw new Error("Usuário não encontrado.");
  }

  // Sem teto, quem pega a sessão aberta no PC da loja testava senhas aqui à
  // vontade, fora do freio do login. A chave é do usuário e a mesma nas duas
  // telas de troca (changePassword/updatePassword), para não somar limites.
  if (!checkRateLimit(`senha-atual:${user.id}`, { windowMs: 15 * 60_000, maxRequests: 5 }).allowed) {
    throw new Error("Muitas tentativas. Espere 15 minutos e tente de novo.");
  }

  const passwordMatch = await bcrypt.compare(currentPassword, user.password);
  if (!passwordMatch) {
    throw new Error("Senha atual incorreta.");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword },
  });

  return { success: true };
}
