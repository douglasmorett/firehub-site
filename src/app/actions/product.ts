"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { hasPermission } from "@/lib/permissions";

export async function createProduct(formData: FormData) {
  const session = await getServerSession(authOptions);
  
  if (!session) throw new Error("Não autorizado");
  const role = (session.user as any).role;
  const perms = (session.user as any).permissions || "";
  
  if (role !== "ADMIN" && !(role === "STAFF" && hasPermission(perms, "products", role))) {
    throw new Error("Não autorizado");
  }

  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  let priceStr = formData.get("price") as string;
  priceStr = priceStr?.replace(",", ".") || "0";
  const price = parseFloat(priceStr);
  const imageUrl = formData.get("imageUrl") as string | null;
  const category = formData.get("category") as string | null;

  await prisma.product.create({
    data: {
      name,
      description,
      price: isNaN(price) ? 0 : price,
      imageUrl: imageUrl === "" ? null : imageUrl,
      category: category === "" ? null : category,
    },
  });

  revalidatePath("/admin/products");
  revalidatePath("/store");
}

export async function deleteProduct(id: string) {
  const session = await getServerSession(authOptions);
  
  if (!session) throw new Error("Não autorizado");
  const role = (session.user as any).role;
  const perms = (session.user as any).permissions || "";
  
  if (role !== "ADMIN" && !(role === "STAFF" && hasPermission(perms, "products", role))) {
    throw new Error("Não autorizado");
  }

  await prisma.product.delete({
    where: { id },
  });

  revalidatePath("/admin/products");
  revalidatePath("/store");
}

export async function updateProduct(id: string, formData: FormData) {
  const session = await getServerSession(authOptions);
  
  if (!session) throw new Error("Não autorizado");
  const role = (session.user as any).role;
  const perms = (session.user as any).permissions || "";
  
  if (role !== "ADMIN" && !(role === "STAFF" && hasPermission(perms, "products", role))) {
    throw new Error("Não autorizado");
  }

  const name = formData.get("name") as string;
  const description = formData.get("description") as string;
  let priceStr = formData.get("price") as string;
  priceStr = priceStr?.replace(",", ".") || "0";
  const price = parseFloat(priceStr);
  const imageUrl = formData.get("imageUrl") as string | null;
  const category = formData.get("category") as string | null;

  await prisma.product.update({
    where: { id },
    data: {
      name,
      description,
      price: isNaN(price) ? 0 : price,
      ...(imageUrl !== null ? { imageUrl: imageUrl === "" ? null : imageUrl } : {}),
      ...(category !== null ? { category: category === "" ? null : category } : {}),
    },
  });

  revalidatePath("/admin/products");
  revalidatePath("/store");
}
