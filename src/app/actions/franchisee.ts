"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";

export async function createFranchisee(data: { name: string, email: string, city: string, password?: string, cpfCnpj: string }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") {
    throw new Error("Não autorizado");
  }

  const plainPassword = data.password || "123456";
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      password: hashedPassword,
      city: data.city,
      cpfCnpj: data.cpfCnpj,
      role: "FRANCHISEE"
    }
  });

  revalidatePath("/admin/franchisees");
}

export async function deleteFranchisee(userId: string) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") {
    throw new Error("Não autorizado");
  }

  await prisma.user.delete({
    where: { id: userId }
  });

  revalidatePath("/admin/franchisees");
}

export async function updateFranchiseeCity(userId: string, newCity: string) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") {
    throw new Error("Não autorizado");
  }

  await prisma.user.update({
    where: { id: userId },
    data: { city: newCity }
  });

  revalidatePath("/admin/franchisees");
}
