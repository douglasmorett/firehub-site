import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const role = (session.user as any).role;
  const perms = (session.user as any).permissions || "";
  // Qualquer usuário autenticado pode fazer upload de imagens

  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
  }

  const type = formData.get("type") as string || "produtos";
  const folder = type === "invoice" ? "invoices" : type === "marketing" ? "marketing" : "produtos";

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "");
  const blob = await put(`${folder}/${Date.now()}-${safeName}`, file, {
    access: "public",
  });

  return NextResponse.json({ url: blob.url });
}
