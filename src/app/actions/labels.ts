"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function saveLabelData(productId: string, labelData: any) {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Não autorizado");
  
  await prisma.menuProduct.update({
    where: { id: productId },
    data: { tags: JSON.stringify(labelData) }
  });

  revalidatePath("/store/etiquetas");
}

export async function updateStoreLabelInfo(cpfCnpj: string, storeAddress: string, storeName: string, storeLogo: string) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return { success: false, error: "Não autorizado" };

    const user = await prisma.user.findUnique({ where: { email: session.user.email } });
    if (!user) return { success: false, error: "Usuário não encontrado" };

    await prisma.user.update({
      where: { id: user.id },
      data: { cpfCnpj, storeAddress, storeName, storeLogo }
    });

    revalidatePath("/store/etiquetas");
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message || "Erro desconhecido" };
  }
}
