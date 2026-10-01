import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { MAIOR_PERIODO_EM_DIAS, pedidosDoInicio } from "@/lib/pedidos-do-inicio";

export const dynamic = "force-dynamic";

/**
 * GET /api/store/inicio?de=<ISO>&ate=<ISO>[&loja=<id>] — os pedidos de um
 * "Período" da tela Início que começa antes do que veio com a tela.
 *
 * As datas chegam já em ISO, calculadas no navegador: o "dia" é o do fuso da
 * loja, e quem sabe o fuso é a tela. `loja` só vale para o ADMIN; sem ela, o
 * ADMIN vê todas. Ver src/lib/pedidos-do-inicio.ts.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, permissions: true },
  });
  if (!usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (usuario.role !== "FRANCHISEE" && usuario.role !== "ADMIN" && usuario.role !== "STAFF") {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }
  // A mesma porta da tela: funcionário só vê o faturamento com a caixinha dela.
  if (usuario.role === "STAFF" && !funcionarioAbre("/store", String(usuario.permissions ?? ""))) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  const p = req.nextUrl.searchParams;
  const de = new Date(p.get("de") || "");
  const ate = new Date(p.get("ate") || "");
  if (isNaN(de.getTime()) || isNaN(ate.getTime()) || de > ate) {
    return NextResponse.json({ error: "Período inválido" }, { status: 400 });
  }
  if (ate.getTime() - de.getTime() > (MAIOR_PERIODO_EM_DIAS + 1) * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: `Período maior que ${MAIOR_PERIODO_EM_DIAS} dias` }, { status: 400 });
  }

  let franchiseeId: string | null;
  if (usuario.role === "ADMIN") {
    const loja = p.get("loja");
    franchiseeId = loja && loja !== "todas" ? loja : null;
  } else {
    franchiseeId = usuario.ownerId || usuario.id;
  }

  const pedidos = await pedidosDoInicio({ franchiseeId, desde: de, ate });
  return NextResponse.json({ pedidos });
}
