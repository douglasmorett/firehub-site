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

  const dbUser = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true }
  });
  const targetFranchiseeId = dbUser?.ownerId || dbUser?.id || null;

  if (!data.supplierName || data.supplierName.trim() === "") {
    return { error: "Nome do fornecedor é obrigatório." };
  }

  if (!data.value || isNaN(data.value) || data.value <= 0) {
    return { error: "Valor inválido. Informe um valor maior que zero." };
  }

  if (!data.dueDate) {
    return { error: "Data de vencimento é obrigatória." };
  }

  const receivedDate = data.receivedDate ? new Date(data.receivedDate) : new Date();
  const dueDate = new Date(data.dueDate);

  try {
    await prisma.payable.create({
      data: {
        franchiseeId: targetFranchiseeId,
        supplierName: data.supplierName.trim(),
        barcode: data.barcode?.trim() || null,
        receivedDate,
        dueDate,
        value: data.value,
        status: "PENDING",
        category: data.category || "BUSINESS"
      }
    });

    revalidatePath("/store/financeiro");
    return { success: true };
  } catch (err: any) {
    console.error("Erro ao criar payable:", err);
    return { error: "Erro no banco de dados: " + (err?.message || "desconhecido") };
  }
}

export async function markPayableAsPaid(id: string) {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Não autorizado");

  await prisma.payable.update({
    where: { id },
    data: {
      status: "PAID",
      paidDate: new Date()
    }
  });

  revalidatePath("/store/financeiro");
}

export async function deletePayable(id: string) {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Não autorizado");

  await prisma.payable.delete({ where: { id } });
  revalidatePath("/store/financeiro");
}

export async function createRecurringPayable(data: {
  supplierName: string;
  value: number;
  category: string;
  paymentType: string;
  dueDateDay: number;
  barcode?: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session) return { error: "Não autorizado" };

  const dbUser = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true }
  });
  const targetFranchiseeId = dbUser?.ownerId || dbUser?.id || null;

  try {
    const newRecurring = await prisma.recurringPayable.create({
      data: {
        franchiseeId: targetFranchiseeId,
        supplierName: data.supplierName.trim(),
        value: data.value,
        category: data.category || "BUSINESS",
        paymentType: data.paymentType || "BOLETO",
        dueDateDay: Number(data.dueDateDay),
        barcode: data.barcode?.trim() || null,
        active: true
      }
    });

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    const cappedDay = Math.min(Number(data.dueDateDay), lastDay);
    const dueDate = new Date(currentYear, currentMonth, cappedDay, 12, 0, 0);

    await prisma.payable.create({
      data: {
        franchiseeId: targetFranchiseeId,
        supplierName: newRecurring.supplierName,
        barcode: newRecurring.barcode,
        paymentType: newRecurring.paymentType,
        receivedDate: new Date(),
        dueDate,
        value: newRecurring.value,
        status: "PENDING",
        category: newRecurring.category,
        recurringPayableId: newRecurring.id
      }
    });

    revalidatePath("/store/financeiro");
    return { success: true };
  } catch (err: any) {
    return { error: err.message };
  }
}

export async function deleteRecurringPayable(id: string) {
  const session = await getServerSession(authOptions);
  if (!session) return { error: "Não autorizado" };
  await prisma.recurringPayable.delete({ where: { id } });
  revalidatePath("/store/financeiro");
  return { success: true };
}

export async function toggleRecurringPayableActive(id: string, active: boolean) {
  const session = await getServerSession(authOptions);
  if (!session) return { error: "Não autorizado" };
  await prisma.recurringPayable.update({ where: { id }, data: { active } });
  revalidatePath("/store/financeiro");
  return { success: true };
}
