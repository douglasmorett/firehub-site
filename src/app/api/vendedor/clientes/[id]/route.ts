import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { statusDoAtendimento } from "@/lib/vendedores";

/**
 * PATCH { status: "ATENDIDO" | "AGUARDANDO" }: o vendedor marca, na carteira
 * dele, que já fez contato com a loja (ou desfaz). Só vale para loja que o
 * admin pôs na carteira DELE — o id da sessão é o do Ambassador.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  if (!user || user.role !== "AMBASSADOR" || !user.id) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const status = statusDoAtendimento(body.status);
  if (!status) return NextResponse.json({ error: "Status inválido." }, { status: 400 });

  const r = await prisma.user.updateMany({
    where: { id, vendedorId: user.id },
    data: { vendedorStatus: status, vendedorAtendidoEm: status === "ATENDIDO" ? new Date() : null },
  });
  if (r.count === 0) return NextResponse.json({ error: "Esta loja não está na sua carteira." }, { status: 404 });
  return NextResponse.json({ ok: true, status });
}
