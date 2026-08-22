import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { saveUploadedFile } from "@/lib/storage";

/**
 * POST /api/upload — foto de produto, nota fiscal, material de marketing.
 *
 * Passou do Vercel Blob para disco local (ver src/lib/storage.ts). O arquivo
 * fica no volume persistente e a resposta devolve a URL publica, que e o que
 * deve ser gravado no banco — NUNCA o base64 da imagem.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Formulário inválido" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
  }

  const type = (formData.get("type") as string) || "produtos";
  const folder = type === "invoice" ? "invoices" : type === "marketing" ? "marketing" : "produtos";

  try {
    const saved = await saveUploadedFile(file as File, folder);
    return NextResponse.json({ url: saved.url, size: saved.size });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Falha ao salvar arquivo" }, { status: 400 });
  }
}
