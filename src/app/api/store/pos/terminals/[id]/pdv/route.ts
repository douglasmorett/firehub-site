/**
 * POST /api/store/pos/terminals/{id}/pdv
 *
 * Coloca a maquininha em modo PDV.
 *
 * De fábrica a Point vem em STANDALONE: o operador digita o valor na mão e a
 * cobrança enviada pela API nem chega ao visor. Sem esta troca, o pedido do
 * totem fica eternamente "aguardando pagamento" sem nenhum erro visível.
 *
 * `{id}` é o id do PosTerminal no nosso banco, não o terminal_id do MP — quem
 * chama é a tela de maquininhas, que lista os registros locais.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { definirModoPdv } from "@/lib/mp-point";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const usuario = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true },
    });
    if (!usuario) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }
    const lojaId = usuario.ownerId || usuario.id;

    const { id } = await params;

    // findFirst com o franchiseeId no filtro, e não findUnique pelo id: com
    // findUnique, o dono de uma loja trocaria o modo da maquininha de outra só
    // sabendo o id dela.
    const terminal = await prisma.posTerminal.findFirst({
      where: { id, franchiseeId: lojaId },
      select: { id: true, externalId: true, label: true, active: true },
    });
    if (!terminal) {
      return NextResponse.json({ error: "Maquininha não encontrada nesta loja" }, { status: 404 });
    }
    if (!terminal.active) {
      return NextResponse.json(
        { error: `A maquininha "${terminal.label}" está desativada. Sincronize a lista antes de configurá-la.` },
        { status: 409 },
      );
    }

    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { mpAccessToken: true },
    });
    if (!loja?.mpAccessToken) {
      return NextResponse.json(
        {
          error:
            "Esta loja ainda não conectou a conta Mercado Pago. Conecte em Integrações > Mercado Pago para configurar a maquininha.",
          code: "MP_NAO_CONECTADO",
        },
        { status: 409 },
      );
    }

    const r = await definirModoPdv(loja.mpAccessToken, terminal.externalId);
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        return NextResponse.json(
          {
            error: "A conexão da loja com o Mercado Pago expirou. Reconecte a conta em Integrações.",
            code: "MP_RECONECTAR",
            detalhe: r.erro,
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: r.erro, code: "MP_FALHOU" }, { status: 502 });
    }

    // Guarda o modo que o MP confirmou, não o que pedimos: se ele devolver algo
    // diferente de PDV, a tela precisa continuar avisando que a maquininha não
    // está pronta em vez de mostrar um "configurado" que não aconteceu.
    const atualizado = await prisma.posTerminal.update({
      where: { id: terminal.id },
      data: { operatingMode: r.dados.operatingMode ?? null },
      select: { id: true, label: true, externalId: true, operatingMode: true, active: true },
    });

    return NextResponse.json({
      ok: true,
      terminal: { ...atualizado, prontaParaCobrar: atualizado.operatingMode === "PDV" },
    });
  } catch (err) {
    console.error("[POS Modo PDV] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
