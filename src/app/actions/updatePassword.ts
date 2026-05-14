"use server";

import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function updatePassword(newPassword: string) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user || !session.user.email) {
    throw new Error("Não autorizado.");
  }

  if (newPassword.length < 6) {
    throw new Error("A senha deve ter pelo menos 6 caracteres.");
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: { email: session.user.email },
    data: { password: hashedPassword }
  });

  return { success: true };
}
