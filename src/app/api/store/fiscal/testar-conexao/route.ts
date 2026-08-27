import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { testarConexaoComProvedor, type ConfiguracaoFiscal } from "@/lib/fiscal-emissao";

export const dynamic = "force-dynamic";

/**
 * POST /api/store/fiscal/testar-conexao — o botão "Testar conexão" da tela
 * fiscal. Autentica no provedor com o token salvo e devolve, em português, se
 * o token vale para o ambiente configurado. O token nunca sai do servidor.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    const lojaId = user.ownerId || user.id;

    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { fiscalConfig: true },
    });
    const config = (loja?.fiscalConfig as ConfiguracaoFiscal | null) ?? {};

    const resultado = await testarConexaoComProvedor(config);
    return NextResponse.json(
      { success: resultado.ok, mensagem: resultado.mensagem },
      { status: resultado.ok ? 200 : 409 }
    );
  } catch (err: any) {
    console.error("[Fiscal Testar Conexão] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
