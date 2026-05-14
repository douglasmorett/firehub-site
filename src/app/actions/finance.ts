"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function createPayable(data: {
  supplierName: string;
  barcode?: string;
  receivedDate: string;
  dueDate: string;
  value: number;
  category?: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return { error: "Sessão expirada. Faça login novamente." };
  }
  
  const role = (session.user as any)?.role;
  const permissions = (session.user as any)?.permissions || "";
  
  // Admin ou usuário com permissão "finance" ou "payables"
  const hasAccess = role === "ADMIN" || 
    permissions.split(",").includes("finance") || 
    permissions.split(",").includes("payables");
    
  if (!hasAccess) {
    return { error: "Sem permissão para registrar contas. Contate o administrador." };
  }

  // Validações
  if (!data.supplierName || data.supplierName.trim() === "") {
    return { error: "Nome do fornecedor é obrigatório." };
  }

  if (!data.value || isNaN(data.value) || data.value <= 0) {
    return { error: "Valor inválido. Informe um valor maior que zero." };
  }

  if (!data.dueDate) {
    return { error: "Data de vencimento é obrigatória." };
  }

  // Se receivedDate não foi informada, usa a data atual
  const receivedDate = data.receivedDate 
    ? new Date(data.receivedDate) 
    : new Date();

  const dueDate = new Date(data.dueDate);

  if (isNaN(receivedDate.getTime())) {
    return { error: "Data de recebimento inválida." };
  }

  if (isNaN(dueDate.getTime())) {
    return { error: "Data de vencimento inválida." };
  }

  try {
    await prisma.payable.create({
      data: {
        supplierName: data.supplierName.trim(),
        barcode: data.barcode?.trim() || null,
        receivedDate,
        dueDate,
        value: data.value,
        status: "PENDING",
        category: data.category || "BUSINESS"
      }
    });

    revalidatePath("/admin/finance");
    return { success: true };
  } catch (err: any) {
    console.error("Erro ao criar payable:", err);
    return { error: "Erro no banco de dados: " + (err?.message || "desconhecido") };
  }
}

export async function markPayableAsPaid(id: string) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") throw new Error("Não autorizado");

  await prisma.payable.update({
    where: { id },
    data: {
      status: "PAID",
      paidDate: new Date()
    }
  });

  revalidatePath("/admin/finance");
}

export async function deletePayable(id: string) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") throw new Error("Não autorizado");

  await prisma.payable.delete({ where: { id } });
  revalidatePath("/admin/finance");
}
