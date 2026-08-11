import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authenticateApiKey(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Não autorizado. Chave de API inválida ou revogada.", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }

  const store = await prisma.user.findUnique({
    where: { id: auth.franchiseeId },
    select: { storeName: true, slug: true },
  });

  return NextResponse.json({
    ok: true,
    message: "Conexão com a API Aberta do FireHub estabelecida com sucesso!",
    store: {
      id: auth.franchiseeId,
      name: store?.storeName || "Nossa Loja",
      slug: store?.slug || "",
    },
    keyName: auth.keyName,
    permissions: auth.permissions,
    timestamp: new Date().toISOString(),
  });
}
