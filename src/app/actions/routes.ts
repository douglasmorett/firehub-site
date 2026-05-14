"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function createCityRoute(data: { cityName: string; deliveryDays: number[] }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") {
    throw new Error("Não autorizado");
  }

  if (data.deliveryDays.length === 0) {
    throw new Error("Selecione pelo menos um dia de entrega");
  }

  // Primeiro removemos as rotas antigas dessa cidade para sobrescrever com as novas
  await prisma.routeSchedule.deleteMany({
    where: { cityName: data.cityName }
  });

  // Inserimos os novos dias
  for (const day of data.deliveryDays) {
    await prisma.routeSchedule.create({
      data: {
        cityName: data.cityName,
        deliveryDay: day
      }
    });
  }

  revalidatePath("/admin/routes");
}

export async function deleteCityRoute(cityName: string) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any)?.role !== "ADMIN") {
    throw new Error("Não autorizado");
  }

  await prisma.routeSchedule.deleteMany({
    where: { cityName }
  });

  revalidatePath("/admin/routes");
}
