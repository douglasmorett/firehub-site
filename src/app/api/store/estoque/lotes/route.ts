import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { temEstruturaDeLotes } from "@/lib/garantir-colunas";
import { estadoDePrazo, textoDePrazo } from "@/lib/lote";

/**
 * A listagem de lotes — a resposta para "imprimi 40 etiquetas, quais ainda não
 * voltaram?".
 *
 * Até aqui o lote existia no banco, o QR funcionava, o scan dava entrada e
 * saída, e MESMO ASSIM nenhuma tela do produto mostrava um lote sequer. Quem
 * imprimia etiqueta não tinha como saber se alguém tinha escaneado, o que
 * estava vencendo na geladeira, ou o que a fábrica mandou e a loja ainda não
 * recebeu.
 */

// Mesmo helper das outras rotas do estoque: o STAFF é um User com ownerId
// apontando para o dono. Com o user.id cru, o funcionário cai num estoque
// paralelo vazio em vez do estoque da loja onde trabalha.
async function getFranchiseeId(session: any) {
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!user) return null;
  return user.ownerId || user.id;
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    // PRIMEIRA coisa do handler, antes de qualquer query: num banco que ainda
    // não subiu com a estrutura de lotes, a resposta é 200 com lista vazia e
    // `disponivel: false` — nunca 500. A aba nova é um recurso opcional e não
    // pode derrubar o módulo de estoque inteiro de quem não a usa.
    if (!(await temEstruturaDeLotes())) {
      return NextResponse.json({
        success: true,
        disponivel: false,
        lotes: [],
        contadores: { aguardando: 0, geladeira: 0, vencendo: 0, vencidos: 0 },
      });
    }

    const franchiseeId = await getFranchiseeId(session);
    if (!franchiseeId) return NextResponse.json({ error: "Lojista não encontrado" }, { status: 404 });

    const url = new URL(req.url);
    const filtro = url.searchParams.get("filtro") || "todos";

    const agora = new Date();
    const em3dias = new Date(agora.getTime() + 3 * 24 * 60 * 60 * 1000);

    // "Aguardando" é quem IMPRIMIU e ninguém recebeu ainda — o lote em trânsito.
    // Os outros filtros são sobre o que já está NA MINHA loja: `recebidoPorId`
    // é quem recebeu, `franchiseeId` é quem imprimiu, e numa franquia esses
    // dois são lojas diferentes.
    const daMinhaLoja = { recebidoPorId: franchiseeId, active: true, status: "ATIVO" as const };

    const onde: any =
      filtro === "aguardando"
        ? { franchiseeId, recebidoPorId: null, active: true }
        : filtro === "vencendo"
          ? { ...daMinhaLoja, validoAte: { gte: agora, lte: em3dias } }
          : filtro === "vencidos"
            ? { ...daMinhaLoja, validoAte: { lt: agora } }
            : filtro === "geladeira"
              ? daMinhaLoja
              : { OR: [{ franchiseeId, recebidoPorId: null, active: true }, daMinhaLoja] };

    const lotes = await prisma.stockLot.findMany({
      where: onde,
      include: { stockItem: { select: { id: true, name: true, unit: true } } },
      // Pelo que vence primeiro: é a ordem em que a cozinha precisa usar, e a
      // única que faz a lista responder sozinha "o que eu faço agora".
      orderBy: [{ validoAte: "asc" }, { createdAt: "desc" }],
      take: 100,
    });

    // A MESMA escala de prazo do scan no celular e do resto do sistema. Duas
    // definições de "vencendo" em telas diferentes é como o mesmo lote aparece
    // amarelo aqui e verde lá.
    const enriquecidos = lotes.map((l) => ({
      ...l,
      estadoDePrazo: estadoDePrazo(l.validoAte, agora),
      textoDePrazo: textoDePrazo(l.validoAte, agora),
      aguardandoRecebimento: !l.recebidoPorId,
    }));

    const [aguardando, geladeira, vencendo, vencidos] = await Promise.all([
      prisma.stockLot.count({ where: { franchiseeId, recebidoPorId: null, active: true } }),
      prisma.stockLot.count({ where: daMinhaLoja }),
      prisma.stockLot.count({ where: { ...daMinhaLoja, validoAte: { gte: agora, lte: em3dias } } }),
      prisma.stockLot.count({ where: { ...daMinhaLoja, validoAte: { lt: agora } } }),
    ]);

    return NextResponse.json({
      success: true,
      disponivel: true,
      lotes: enriquecidos,
      contadores: { aguardando, geladeira, vencendo, vencidos },
    });
  } catch (error: any) {
    console.error("[Estoque Lotes GET] Erro:", error?.message);
    // Mesmo em erro inesperado a resposta é 200 com lista vazia: a aba de
    // lotes vive dentro da tela de estoque, e derrubá-la levaria junto o
    // controle de insumos, que não tem nada a ver com isso.
    return NextResponse.json({
      success: true,
      disponivel: false,
      lotes: [],
      contadores: { aguardando: 0, geladeira: 0, vencendo: 0, vencidos: 0 },
    });
  }
}
