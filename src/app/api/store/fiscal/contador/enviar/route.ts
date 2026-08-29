import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { enviarPacoteParaContador } from "@/lib/contador-envio";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/store/fiscal/contador/enviar { de, ate }
 *
 * O botão "Enviar agora". Usa exatamente o mesmo caminho do envio automático —
 * o que o lojista testa aqui é o que vai acontecer todo mês, e não uma
 * simulação parecida.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!u) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const de = String(body.de || "").trim();
  const ate = String(body.ate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return NextResponse.json({ error: "Informe o período." }, { status: 400 });
  }
  if (de > ate) return NextResponse.json({ error: "A data inicial está depois da final." }, { status: 400 });

  const r = await enviarPacoteParaContador(u.ownerId || u.id, { de, ate });
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
