"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

export async function createKitchenItem(data: any) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Não autorizado");

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) throw new Error("Usuário não encontrado");

  const item = await prisma.kitchenItem.create({
    data: {
      ...data,
      franchiseeId: user.id
    }
  });

  revalidatePath("/store/etiquetas");
  return item;
}

export async function updateKitchenItem(id: string, data: any) {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Não autorizado");

  const item = await prisma.kitchenItem.update({
    where: { id },
    data
  });

  revalidatePath("/store/etiquetas");
  return item;
}

export async function deleteKitchenItem(id: string) {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Não autorizado");

  await prisma.kitchenItem.delete({
    where: { id }
  });

  revalidatePath("/store/etiquetas");
}

import { GoogleGenAI } from '@google/genai';

export async function fillNutritionWithAI(itemName: string) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return { error: "GEMINI_API_KEY não configurada no servidor." };
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const prompt = `Gere uma tabela nutricional realista e detalhada para 100g de "${itemName}" para vigilância sanitária. 
    Retorne APENAS um JSON válido e puro com a seguinte estrutura (sem markdown, sem \`\`\`json):
    {
      "ingredients": "Ingrediente 1, Ingrediente 2, etc.",
      "allergens": "ALÉRGICOS: CONTÉM TRIGO. PODE CONTER SOJA, etc.",
      "preparation": "Instruções curtas de preparo (ex: Assar a 180C por 15 min)",
      "shelfLifeDays": 90,
      "energy": "0",
      "carbs": "0",
      "sugars": "0",
      "addedSugars": "0",
      "proteins": "0",
      "fatTotal": "0",
      "fatSat": "0",
      "sodium": "0",
      "highSugar": false,
      "highSodium": false,
      "highFat": false
    }`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const text = response.text || "";
    const jsonStr = text.match(/\{[\s\S]*\}/)?.[0] || "{}";
    return JSON.parse(jsonStr);
  } catch (error: any) {
    console.error("Erro AI:", error);
    return { error: "Falha ao gerar dados com IA." };
  }
}
