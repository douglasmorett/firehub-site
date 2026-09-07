"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { dataDaLoja } from "@/lib/fuso";

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

/**
 * De qual loja é a sessão atual. Funcionário (`ownerId`) responde pela loja do dono.
 */
async function lojaDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Não autorizado");
  const dbUser = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true, role: true },
  });
  if (!dbUser) throw new Error("Não autorizado");
  return { franchiseeId: dbUser.ownerId || dbUser.id, role: dbUser.role };
}

/**
 * Confere que a conta é DESTA loja antes de deixar mexer nela.
 *
 * As duas ações abaixo só checavam "existe sessão?" e chamavam update/delete
 * direto pelo id. Como o id vem do navegador, qualquer lojista logado podia dar
 * baixa ou apagar a conta a pagar de OUTRA loja só trocando o id na chamada.
 */
async function exigirPayableDaLoja(id: string) {
  const { franchiseeId, role } = await lojaDaSessao();
  const alvo = await prisma.payable.findUnique({ where: { id }, select: { franchiseeId: true } });
  if (!alvo) throw new Error("Conta não encontrada");
  if (role !== "ADMIN" && alvo.franchiseeId !== franchiseeId) {
    throw new Error("Esta conta não é da sua loja");
  }
}

export async function markPayableAsPaid(id: string) {
  await exigirPayableDaLoja(id);

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
  await exigirPayableDaLoja(id);

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

    // Ano e mês DE BRASÍLIA: das 21:00 às 24:00 do último dia o container (UTC)
    // já está no mês seguinte, e a primeira parcela nascia um mês à frente.
    const [currentYear, mesHumano] = dataDaLoja().split("-").map(Number);
    const currentMonth = mesHumano - 1;
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
