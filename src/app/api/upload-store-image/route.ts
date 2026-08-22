import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { saveUploadedFile } from "@/lib/storage";

/**
 * POST /api/upload-store-image — logo e banner da loja.
 * Passou do Vercel Blob para disco local (ver src/lib/storage.ts).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "FRANCHISEE") {
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

  try {
    const saved = await saveUploadedFile(file as File, "lojas");
    return NextResponse.json({ url: saved.url, size: saved.size });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Falha ao salvar arquivo" }, { status: 400 });
  }
}
