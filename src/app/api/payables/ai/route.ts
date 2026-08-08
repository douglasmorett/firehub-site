import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role;
  const perms = (session.user as any).permissions || "";
  
  if (role !== "ADMIN" && role !== "FRANCHISEE" && !(role === "STAFF" && (perms.includes("finance") || perms.includes("payables")))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const { imageUrl } = await req.json();

  if (!imageUrl) {
    return NextResponse.json({ error: "Imagem é obrigatória" }, { status: 400 });
  }

  try {
    const imgRes = await fetch(imageUrl);
    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString("base64");

    const prompt = `Você é um assistente financeiro especialista em ler boletos, faturas e contas a pagar.
O usuário enviou uma foto de uma conta a pagar. Sua tarefa é extrair as seguintes informações:
1. supplierName: O nome do fornecedor, loja ou recebedor.
2. barcode: A linha digitável ou código de barras do boleto (somente números), se houver. Se não houver, retorne "".
3. dueDate: A data de vencimento no formato YYYY-MM-DD. Se não achar, retorne "".
4. value: O valor total a pagar (número float). Se não achar, retorne null.

Responda APENAS com um JSON estrito, sem nenhum texto adicional.
Estrutura:
{
  "sucesso": true/false (false se a imagem não for uma conta),
  "supplierName": "...",
  "barcode": "...",
  "dueDate": "2023-12-31",
  "value": 150.50
}`;

    const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [
            prompt,
            {
                inlineData: {
                    data: base64Data,
                    mimeType: imgRes.headers.get("content-type") || "image/jpeg"
                }
            }
        ],
        config: {
            responseMimeType: "application/json",
        }
    });

    const aiText = response.text || "{}";
    let aiData;
    try {
      aiData = JSON.parse(aiText);
    } catch (e) {
      return NextResponse.json({ error: "Falha ao ler a conta." }, { status: 400 });
    }

    if (!aiData.sucesso) {
      return NextResponse.json({ error: "A imagem não parece ser uma conta legível." }, { status: 400 });
    }

    return NextResponse.json({ data: aiData });
  } catch (error) {
    console.error("Erro na leitura IA:", error);
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
