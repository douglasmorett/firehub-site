import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role;
  if (role !== "ADMIN" && role !== "FRANCHISEE") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });

  const type = formData.get("type") as string || "logo";
  const folder = type === "banner" ? "store-banners" : "store-logos";

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "");
  const blob = await put(`${folder}/${Date.now()}-${safeName}`, file, {
    access: "public",
  });

  return NextResponse.json({ url: blob.url });
}
