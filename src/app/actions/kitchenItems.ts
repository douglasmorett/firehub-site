"use server";

import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { revalidatePath } from "next/cache";

/**
 * Resolve QUAL LOJA e a da sessao — `ownerId || id`.
 *
 * E a convencao do projeto, usada em 151 pontos... e em nenhum deste modulo,
 * que sempre usou `user.id` cru. Isso tinha duas consequencias, ambas reais:
 *
 *   1. Funcionario (usuario com `ownerId` apontando para o dono) abria a tela
 *      de etiquetas VAZIA — os itens de cozinha eram procurados no id dele, e
 *      pertencem ao dono. E o que ele cadastrasse ficava invisivel para a loja.
 *   2. `franchiseeId: user.id` no create espalhava item de cozinha orfao por
 *      conta de funcionario.
 */
async function lojaDaSessao(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Não autorizado");

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!user) throw new Error("Usuário não encontrado");

  return user.ownerId || user.id;
}

/**
 * Campos que o cliente pode gravar num KitchenItem.
 *
 * O `data` chegava do navegador e ia inteiro para o Prisma. Dois problemas de
 * uma vez: (a) `franchiseeId` vindo no corpo REATRIBUIRIA o item para outra
 * loja, e (b) qualquer chave que o front mandasse sem coluna correspondente
 * derruba a action com erro do Prisma — foi o que a tela de config sempre
 * arriscou ao crescer.
 */
const CAMPOS_DO_ITEM = [
  "name", "shelfLifeDays", "ingredients", "allergens", "preparation",
  "weightStr", "energy", "carbs", "sugars", "addedSugars", "proteins",
  "fatTotal", "fatSat", "sodium", "highSugar", "highSodium", "highFat",
  "transgenic", "customCnpj", "customAddress", "active",
] as const;

function apenasCamposConhecidos(data: any) {
  const limpo: Record<string, any> = {};
  for (const campo of CAMPOS_DO_ITEM) {
    if (data && Object.prototype.hasOwnProperty.call(data, campo)) limpo[campo] = data[campo];
  }
  return limpo;
}

export async function createKitchenItem(data: any) {
  const franchiseeId = await lojaDaSessao();

  const campos = apenasCamposConhecidos(data);
  // O nome e obrigatorio no schema, e ate agora nada validava: item criado sem
  // nome vira linha invisivel na lista, impossivel de selecionar e de apagar.
  const name = String(campos.name ?? "").trim();
  if (!name) throw new Error("O nome do item é obrigatório");

  const item = await prisma.kitchenItem.create({
    data: { ...campos, name, franchiseeId },
  });

  revalidatePath("/store/etiquetas");
  return item;
}

export async function updateKitchenItem(id: string, data: any) {
  const franchiseeId = await lojaDaSessao();

  // `updateMany` de proposito: e o unico jeito de levar o franchiseeId DENTRO
  // do WHERE da escrita. O `update({ where: { id } })` de antes so checava se
  // havia sessao — qualquer usuario logado editava item de cozinha de QUALQUER
  // loja passando o id. Mesmo padrao de estoque/transactions/route.ts:116.
  const { count } = await prisma.kitchenItem.updateMany({
    where: { id, franchiseeId },
    data: apenasCamposConhecidos(data),
  });
  if (count === 0) throw new Error("Item não encontrado nesta loja");

  revalidatePath("/store/etiquetas");
  return prisma.kitchenItem.findUnique({ where: { id } });
}

export async function deleteKitchenItem(id: string) {
  const franchiseeId = await lojaDaSessao();

  const { count } = await prisma.kitchenItem.deleteMany({
    where: { id, franchiseeId },
  });
  if (count === 0) throw new Error("Item não encontrado nesta loja");

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
