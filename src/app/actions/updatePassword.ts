"use server";

import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function updatePassword(currentPassword: string, newPassword: string) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.email) {
    throw new Error("Não autorizado.");
  }

  if (!currentPassword) {
    throw new Error("A senha atual é obrigatória.");
  }

  if (newPassword.length < 6) {
    throw new Error("A senha deve ter pelo menos 6 caracteres.");
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, password: true },
  });

  if (!user) {
    throw new Error("Usuário não encontrado.");
  }

  const passwordMatch = await bcrypt.compare(currentPassword, user.password);
  if (!passwordMatch) {
    throw new Error("Senha atual incorreta.");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword }
  });

  return { success: true };
}
