"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";

// Apenas ADMIN pode gerenciar equipe
async function checkAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") {
    throw new Error("Não autorizado");
  }
}

export async function createStaffUser(data: {
  name: string;
  email: string;
  password: string;
  permissions: string[];
}) {
  await checkAdmin();
  const hashed = await bcrypt.hash(data.password, 10);
  await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      password: hashed,
      role: "STAFF",
      permissions: data.permissions.join(","),
    },
  });
  revalidatePath("/admin/equipe");
}

export async function updateStaffPermissions(id: string, permissions: string[]) {
  await checkAdmin();
  await prisma.user.update({
    where: { id },
    data: { permissions: permissions.join(",") },
  });
  revalidatePath("/admin/equipe");
}

export async function deleteStaffUser(id: string) {
  await checkAdmin();
  await prisma.user.delete({ where: { id } });
  revalidatePath("/admin/equipe");
}
