/**
 * GET /api/store/pos/terminals
 *
 * Lista as maquininhas da loja e sincroniza o cadastro local com o que existe
 * na conta Mercado Pago do lojista.
 *
 * A tabela local existe porque o caixa não pode depender de uma chamada externa
 * para saber para onde mandar a cobrança. Esta rota é o único lugar que alimenta
 * essa tabela: o lojista abre a tela de maquininhas e o que estiver na conta dele
 * aparece aqui.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listarTerminais, type TerminalPoint } from "@/lib/mp-point";

export const dynamic = "force-dynamic";

// listarTerminais para em 10 páginas de 50. Uma resposta encostada nesse teto
// pode estar truncada, e desativar "o que não veio" nesse caso apagaria
// maquininhas boas do cadastro da loja.
const TETO_DA_LISTAGEM = 500;

/**
 * Nome inicial da maquininha recém-descoberta.
 *
 * O terminal_id vem como "NEWLAND_N950__N950NCB801293324" — ilegível no meio de
 * uma tela de configuração. O número de série já basta para o operador casar com
 * o adesivo do aparelho, e ele pode renomear depois.
 */
function rotuloPadrao(t: TerminalPoint): string {
  const serie = t.id.includes("__") ? t.id.split("__").pop() || t.id : t.id;
  return `Point ${serie}`;
}

export async function GET(_req: NextRequest) {
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

    // O token do Mercado Pago é sempre o do DONO da loja: funcionário (STAFF)
    // não conecta conta nenhuma, e a venda tem que cair na conta do dono.
    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { mpAccessToken: true },
    });

    if (!loja?.mpAccessToken) {
      return NextResponse.json(
        {
          error:
            "Esta loja ainda não conectou a conta Mercado Pago. Conecte em Integrações > Mercado Pago para usar a maquininha.",
          code: "MP_NAO_CONECTADO",
        },
        { status: 409 },
      );
    }

    const remotos = await listarTerminais(loja.mpAccessToken);

    let sincronizado = false;
    let erroSincronizacao: string | null = null;

    if (!remotos.ok) {
      // A lista local continua sendo devolvida — são maquininhas reais, já
      // cadastradas. O que a tela não pode fazer é dar a entender que acabou de
      // conferir com o Mercado Pago, então o motivo da falha vai junto.
      erroSincronizacao =
        remotos.status === 401 || remotos.status === 403
          ? "A conexão da loja com o Mercado Pago expirou. Reconecte a conta em Integrações."
          : remotos.erro;
    } else {
      for (const t of remotos.dados) {
        if (!t.id) continue;
        await prisma.posTerminal.upsert({
          where: { franchiseeId_externalId: { franchiseeId: lojaId, externalId: t.id } },
          create: {
            franchiseeId: lojaId,
            externalId: t.id,
            label: rotuloPadrao(t),
            storeId: t.storeId ?? null,
            posId: t.posId ?? null,
            operatingMode: t.operatingMode ?? null,
          },
          // `label` fica de fora de propósito: o lojista renomeia para "Point do
          // balcão" e o sync não pode desfazer isso a cada abertura da tela.
          // `active` também: desligar a maquininha aqui é decisão do operador.
          update: {
            storeId: t.storeId ?? null,
            posId: t.posId ?? null,
            operatingMode: t.operatingMode ?? null,
          },
        });
      }

      // Maquininha que sumiu da conta do MP foi devolvida ou trocada — não dá
      // mais para cobrar nela. Desativa em vez de apagar porque pedidos antigos
      // apontam para este registro.
      const vistos = remotos.dados.map((t) => t.id).filter(Boolean);
      // `vistos` vazio não desativa nada. `notIn: []` no Prisma casa com TODAS
      // as linhas, então uma resposta 200 que viesse fora do formato esperado
      // (data.terminals renomeado, página vazia por instabilidade) desligaria
      // todas as maquininhas da loja de uma vez e o totem passaria a responder
      // TERMINAL_NAO_VINCULADO no meio do movimento. Maquininha realmente
      // removida da conta continua sendo recusada pelo próprio MP na cobrança,
      // com mensagem melhor do que um cadastro apagado por engano.
      if (vistos.length > 0 && remotos.dados.length < TETO_DA_LISTAGEM) {
        await prisma.posTerminal.updateMany({
          where: { franchiseeId: lojaId, active: true, externalId: { notIn: vistos } },
          data: { active: false },
        });
      }

      sincronizado = true;
    }

    const terminais = await prisma.posTerminal.findMany({
      where: { franchiseeId: lojaId },
      orderBy: [{ active: "desc" }, { label: "asc" }],
      select: {
        id: true,
        externalId: true,
        label: true,
        provider: true,
        storeId: true,
        posId: true,
        operatingMode: true,
        active: true,
        totemLicenses: { select: { id: true, label: true } },
      },
    });

    return NextResponse.json({
      sincronizado,
      erroSincronizacao,
      terminais: terminais.map((t) => ({
        ...t,
        // Fora do modo PDV a maquininha ignora a cobrança enviada por API. A tela
        // precisa deste aviso ANTES da venda, senão o pedido fica "aguardando
        // pagamento" para sempre e ninguém entende o motivo.
        prontaParaCobrar: t.active && t.operatingMode === "PDV",
        totens: t.totemLicenses,
      })),
    });
  } catch (err) {
    console.error("[POS Terminais] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
