import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";

export const dynamic = "force-dynamic";

/** GET: a equipe de vendas ativa, para os seletores de vendedor das telas do CRM. */
export async function GET() {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  const vendedores = await prisma.ambassador.findMany({
    where: { isVendedor: true, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return NextResponse.json({ vendedores: vendedores.map((v) => ({ id: v.id, nome: v.name })), quem: { tipo: quem.tipo, id: quem.id, nome: quem.nome } });
}
