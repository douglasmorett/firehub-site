import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  // Qualquer usuário autenticado pode inserir notas (FRANCHISEE, ADMIN, STAFF)
  const role = (session.user as any).role;
  const perms = (session.user as any).permissions || "";

  const { imageUrl, description, category } = await req.json();

  if (!imageUrl || !description) {
    return NextResponse.json({ error: "Imagem e descrição são obrigatórias" }, { status: 400 });
  }

  try {
    // Buscar a imagem do Vercel Blob
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return NextResponse.json({ error: "Não foi possível baixar a imagem. Tente tirar a foto novamente." }, { status: 400 });
    }
    const arrayBuffer = await imgRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString("base64");
    const mimeType = imgRes.headers.get("content-type") || "image/jpeg";

    // Enviar para o Gemini
    const prompt = `Você é um assistente ESPECIALISTA em leitura de TODOS os tipos de documentos fiscais brasileiros.
O usuário enviou uma foto de um comprovante e a seguinte descrição: "${description}".

TIPOS DE DOCUMENTO QUE VOCÊ DEVE SABER LER:
- **DANFE** (Documento Auxiliar da Nota Fiscal Eletrônica): Documento formal com layout tabular. O valor total fica no campo "VALOR TOTAL DA NOTA" ou "TOTAL DA NF-e" (geralmente no canto inferior direito ou em um campo destacado).
- **NF-e / Nota Fiscal Eletrônica**: Similar ao DANFE.
- **NFS-e / Nota Fiscal de Serviço**: Possui campos como "Valor Total dos Serviços" ou "Valor Líquido".
- **Cupom Fiscal / CF-e-SAT**: Documento estreito de impressora térmica com "TOTAL" na parte inferior.
- **Nota Fiscal de Produtor / Cooperativa**: Emitida por cooperativas agropecuárias (ex: COAPEM). Procure campos como "VALOR TOTAL", "VLR TOTAL DOS PROD.", "TOTAL DA NOTA", "V. TOTAL TRIB.", ou "Total do NF (R$)".
- **Recibo simples**: Documento informal com valor escrito manualmente ou impresso.
- **Comprovante de abastecimento / Ticket**: Busque "TOTAL", "VALOR", "SUBTOTAL".

INSTRUÇÕES DE EXTRAÇÃO:
1. Identifique o TIPO do documento (DANFE, Cupom, Recibo, NF Cooperativa, etc).
2. Procure pelo VALOR TOTAL da compra. Em DANFEs, ele costuma estar em "VALOR TOTAL DA NOTA" ou no campo numérico grande no rodapé. Em notas de cooperativa, pode estar em "Total do NF" ou "VLR TOTAL".
3. Identifique a CATEGORIA do gasto combinando o conteúdo da nota com a descrição do usuário.
4. Extraia a DATA da nota (campo "DATA DE EMISSÃO", "EMISSÃO", ou data impressa).

Sua tarefa é ler a foto e extrair:
1. O valor total da compra/gasto (um número decimal).
2. A categoria do gasto (ex: Abastecimento, Insumos Agrícolas, Manutenção, Mercadoria, etc).
3. A data da compra impressa na nota (formato ISO-8601: YYYY-MM-DD ou YYYY-MM-DDTHH:mm).

Regras:
- Se a imagem NÃO for nenhum tipo de nota fiscal, cupom ou comprovante de compra legível, rejeite.
- Se o documento estiver parcialmente legível mas você conseguir identificar o valor, ACEITE e informe o que conseguiu ler.
- Retorne um JSON válido e estrito com a seguinte estrutura:
{
  "sucesso": true ou false,
  "motivoRejeicao": "Se sucesso for false, explique brevemente o porquê. Senão, null.",
  "valorTotal": 123.45 (número float, ou null se não achou),
  "categoria": "Nome da Categoria" (ou null),
  "dataHoraNota": "2023-10-24T14:30:00" (ou null se não encontrar),
  "tipoDocumento": "DANFE" ou "Cupom Fiscal" ou "Recibo" ou "NF Cooperativa" ou "NFS-e" ou "Outro"
}
NÃO RETORNE NENHUM TEXTO ALÉM DO JSON.`;

    let aiText = "";
    
    try {
      // Usa gemini-2.0-flash — modelo estável com suporte a visão (imagens)
      const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
              prompt,
              {
                  inlineData: {
                      data: base64Data,
                      mimeType
                  }
              }
          ],
          config: {
              responseMimeType: "application/json",
          }
      });
      aiText = response.text ?? "";
    } catch (geminiError: any) {
      console.error("Gemini com responseMimeType falhou, tentando sem:", geminiError.message);
      // Fallback: tenta sem responseMimeType
      const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
              prompt,
              {
                  inlineData: {
                      data: base64Data,
                      mimeType
                  }
              }
          ],
      });
      aiText = response.text ?? "";
    }

    if (!aiText || aiText.trim() === "") {
      console.error("Gemini retornou texto vazio");
      return NextResponse.json({ error: "A IA não retornou nenhuma resposta. Tente tirar a foto novamente com melhor iluminação." }, { status: 400 });
    }

    // Extrair JSON da resposta (pode vir com markdown ```json ... ```)
    let jsonStr = aiText;
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    let aiData;
    try {
      aiData = JSON.parse(jsonStr);
    } catch (e) {
      console.error("Erro ao parsear JSON do Gemini:", aiText);
      return NextResponse.json({ error: "Falha ao ler a nota fiscal. Tente novamente com uma foto mais nítida." }, { status: 400 });
    }

    if (!aiData.sucesso || !aiData.valorTotal) {
      return NextResponse.json({ 
        error: aiData.motivoRejeicao || "A IA não conseguiu identificar a nota fiscal ou o valor.",
        aiData 
      }, { status: 400 });
    }

    // Buscar ID do franqueado/loja do usuário logado
    const dbUser = await prisma.user.findUnique({
      where: { email: session.user?.email || "" },
      select: { id: true, ownerId: true }
    });
    const targetFranchiseeId = dbUser?.ownerId || dbUser?.id || null;

    // Se chegou aqui, aprovado! Salvar no banco.
    const invoice = await prisma.purchaseInvoice.create({
      data: {
        franchiseeId: targetFranchiseeId,
        description,
        imageUrl,
        aiValue: parseFloat(aiData.valorTotal),
        aiCategory: aiData.categoria,
        aiRawText: aiText,
        invoiceDate: aiData.dataHoraNota ? new Date(aiData.dataHoraNota) : null,
        status: "APPROVED",
        category: category || "BUSINESS",
        uploadedBy: session.user?.email || "unknown",
      }
    });

    return NextResponse.json({ success: true, invoice });
  } catch (error: any) {
    console.error("Erro no processamento da nota:", error?.message || error);
    return NextResponse.json({ error: `Erro ao processar: ${error?.message || "Falha interna"}. Tente novamente.` }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const userEmail = session.user?.email;
  const dbUser = await prisma.user.findUnique({
    where: { email: userEmail || "" },
    select: { id: true, ownerId: true, role: true }
  });
  const targetFranchiseeId = dbUser?.ownerId || dbUser?.id || null;

  const category = req.nextUrl.searchParams.get("category") || undefined;

  const invoices = await prisma.purchaseInvoice.findMany({
    where: {
      ...(dbUser?.role === "ADMIN" ? {} : { OR: [{ franchiseeId: targetFranchiseeId || "" }, { uploadedBy: userEmail || "" }] }),
      ...(category ? { category } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(invoices);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role;
  const userEmail = session.user?.email;

  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "ID não fornecido." }, { status: 400 });

    // Admin exclui qualquer nota; franqueado só exclui as suas
    const where: any = { id };
    if (role !== "ADMIN") where.uploadedBy = userEmail;

    const deleted = await prisma.purchaseInvoice.deleteMany({ where });
    if (deleted.count === 0) {
      return NextResponse.json({ error: "Nota não encontrada ou sem permissão." }, { status: 403 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Erro ao excluir nota." }, { status: 500 });
  }
}
