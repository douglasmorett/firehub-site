/**
 * POST /api/termos/aceite — o dono da conta aceita os Termos de Uso no painel.
 * Body: { versao: string } — a versão que estava na tela.
 *
 * Só o dono (FRANCHISEE sem ownerId) aceita: funcionário não assina contrato
 * em nome da empresa, e o suporte que entrou pelo "Acessar" do admin não
 * aceita pela loja. Ver lib/termos-de-uso.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { registrarAceite } from "@/lib/termos-de-uso";
import { VERSAO_DOS_TERMOS } from "@/lib/termos-versao";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Faça login de novo." }, { status: 401 });
  }
  if ((session.user as any).impersonatedBy) {
    return NextResponse.json({ error: "O aceite é do dono da loja, não do suporte." }, { status: 403 });
  }

  const corpo = await req.json().catch(() => ({}));
  // A página ficou aberta enquanto o texto mudou: o aceite tem de ser do texto em vigor.
  if (corpo?.versao !== VERSAO_DOS_TERMOS) {
    return NextResponse.json({ error: "Os Termos foram atualizados. Recarregue a página e leia a versão nova." }, { status: 409 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, ownerId: true, email: true, name: true },
  });
  if (!user || user.role !== "FRANCHISEE" || user.ownerId) {
    return NextResponse.json({ error: "Só o dono da conta pode aceitar os Termos." }, { status: 403 });
  }

  try {
    await registrarAceite({ userId: user.id, origem: "PAINEL", headers: req.headers, email: user.email, nome: user.name });
  } catch (err) {
    console.error("[Termos] Falha ao gravar o aceite:", err);
    return NextResponse.json({ error: "Não deu para registrar agora. Tente de novo em instantes." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, versao: VERSAO_DOS_TERMOS });
}
