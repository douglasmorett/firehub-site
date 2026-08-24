import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autenticarTotem, ipDaRequisicao } from "@/lib/totem-auth";

export const dynamic = "force-dynamic";

/**
 * Ping periódico do totem. Serve para o painel mostrar quem está de pé e para o
 * totem descobrir que a loja fechou ou que a licença foi desligada.
 */
export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json().catch(() => ({}));

    // `exigirModuloAtivo: false` de propósito: se o dono desligar o módulo, o
    // totem precisa RECEBER essa resposta para se recolher sozinho. Barrar aqui
    // deixaria a tela de venda no ar até alguém desligar o aparelho na tomada.
    const auth = await autenticarTotem(token, { exigirModuloAtivo: false });
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.erro, code: auth.codigo, active: false },
        { status: auth.status }
      );
    }

    const atualizada = await prisma.totemLicense.update({
      where: { id: auth.licenca.id },
      data: { lastHeartbeat: new Date(), lastIp: ipDaRequisicao(req) },
      select: {
        active: true,
        franchisee: { select: { storeOpen: true, totemEnabled: true } },
      },
    });

    return NextResponse.json({
      active: atualizada.active,
      storeOpen: atualizada.franchisee.storeOpen,
      totemEnabled: atualizada.franchisee.totemEnabled,
    });
  } catch (err) {
    console.error("[Totem Heartbeat] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
