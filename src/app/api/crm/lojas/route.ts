import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";

export const dynamic = "force-dynamic";

/** GET ?busca=: lojas para ligar a um contato (admin) — nome, e-mail, cidade ou telefone. */
export async function GET(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem || quem.tipo !== "ADMIN") return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  const busca = (req.nextUrl.searchParams.get("busca") || "").trim();
  if (busca.length < 2) return NextResponse.json({ lojas: [] });
  const digitos = busca.replace(/\D/g, "");
  const lojas = await prisma.user.findMany({
    where: {
      role: "FRANCHISEE",
      OR: [
        { storeName: { contains: busca, mode: "insensitive" } },
        { name: { contains: busca, mode: "insensitive" } },
        { email: { contains: busca, mode: "insensitive" } },
        { city: { contains: busca, mode: "insensitive" } },
        ...(digitos.length >= 6 ? [{ storePhone: { contains: digitos.slice(-8) } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, storeName: true, name: true, email: true, city: true },
  });
  return NextResponse.json({ lojas: lojas.map((l) => ({ id: l.id, nome: l.storeName || l.name, email: l.email, cidade: l.city })) });
}
