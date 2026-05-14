"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function saveLabelData(productId: string, labelData: any) {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Não autorizado");
  
  await prisma.product.update({
    where: { id: productId },
    data: { labelData }
  });

  revalidatePath("/admin/labels");
}
