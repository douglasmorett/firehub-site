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

    // ── O TOTEM NÃO SEGUE O HORÁRIO DO DELIVERY ─────────────────────────────
    //
    // `storeOpen` é o interruptor do SITE/delivery. O totem fica dentro da
    // loja: enquanto tem gente atendendo no balcão, ele tem que vender — e o
    // lojista fecha o site à noite (ou nem abre, quando só trabalha no salão)
    // sem nenhuma intenção de desligar o autoatendimento. Amarrado ao site, o
    // totem exibia "Estamos fechados" com a loja cheia.
    //
    // Quem manda no totem é o totem: a licença dele (`active`) e o módulo
    // (`totemEnabled`). `storeOpen` continua sendo enviado só como informação —
    // nenhuma tela deve fechar por causa dele.
    //
    // O CAIXA é outra história e é a única trava real de venda: sem caixa
    // aberto não há como registrar dinheiro, então o pedido não pode ser
    // concluído. Mas a tela SEGUE de pé: o cliente monta o pedido e, na hora
    // de fechar, é avisado para chamar um atendente. Aqui vai só o estado,
    // para a tela poder avisar antes de o cliente perder tempo.
    const caixa = await prisma.cashSession.findFirst({
      where: { franchiseeId: auth.licenca.franchiseeId, status: "OPEN" },
      select: { id: true },
    });

    return NextResponse.json({
      active: atualizada.active,
      totemEnabled: atualizada.franchisee.totemEnabled,
      caixaAberto: Boolean(caixa),
      // Informativo apenas — o totem NÃO fecha por causa disto.
      storeOpen: atualizada.franchisee.storeOpen,
    });
  } catch (err) {
    console.error("[Totem Heartbeat] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
