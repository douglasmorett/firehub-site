import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAuthToken, desvincularLoja } from "@/lib/food99-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/99food/auth?step=test | disconnect
 * POST /api/99food/auth { merchantId, userCode }
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const step = req.nextUrl.searchParams.get("step");

  if (step === "test") {
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { food99Connected: true, food99MerchantId: true },
    });

    if (!user || !user.food99MerchantId || !user.food99Connected) {
      return NextResponse.json({ connected: false, message: "Loja 99Food não conectada." });
    }

    return NextResponse.json({
      connected: true,
      merchantId: user.food99MerchantId,
      message: "Loja 99Food conectada e sincronizada com sucesso!",
    });
  }

  if (step === "disconnect") {
    // Um GET que desfaz vínculo em produção não pode disparar por acidente —
    // prefetch do navegador, favorito antigo, clique errado. Sem a palavra
    // explícita, não acontece nada. A tela manda `confirmar=DESCONECTAR`
    // depois de o lojista digitá-la.
    if (req.nextUrl.searchParams.get("confirmar") !== "DESCONECTAR") {
      return NextResponse.json(
        { error: "Desconectar exige confirmação explícita (confirmar=DESCONECTAR). Nada foi alterado." },
        { status: 400 }
      );
    }

    const u = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, food99AppId: true, storeName: true },
    });
    if (!u) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const lojaId = u.ownerId || u.id;

    // Rastro de QUEM desligou e QUANDO. A Brasa Burguer perdeu o vínculo em
    // 04/09/2026 e ninguém conseguiu dizer se foi este botão, o painel do
    // 99Food ou outro sistema — porque nada ficava registrado.
    console.warn(
      `[99Food] DESCONECTAR acionado: loja ${lojaId} (${u.storeName ?? "sem nome"}) por ${session.user.email} em ${new Date().toISOString()} — vai chamar shop/unbind`
    );

    // Desfaz o vínculo NO 99FOOD antes de limpar aqui. Antes esta rota só
    // apagava os campos do nosso banco — e como "conectado" passou a ser o que
    // o 99Food responde, o vínculo continuava de pé lá e a loja reaparecia
    // conectada na consulta seguinte. Um botão de desconectar que não
    // desconecta é pior do que não ter botão.
    let desvinculou = false;
    let aviso: string | undefined;

    const token = await getAuthToken(u.food99AppId || lojaId);
    if (token.autorizada) {
      const r = await desvincularLoja(token.token.auth_token);
      desvinculou = r.ok;
      if (!r.ok) aviso = `O 99Food recusou o desvínculo: ${r.erro}`;
    }

    await prisma.user.update({
      where: { id: lojaId },
      data: { food99Connected: false, food99MerchantId: null, food99AppId: null },
    });

    return NextResponse.json({
      success: true,
      connected: false,
      desvinculou,
      aviso,
      message: desvinculou
        ? "Loja 99Food desconectada."
        : // Sem o desvínculo do lado deles, os pedidos podem continuar
          // chegando no webhook. Dizer "desconectada" seco esconderia isso.
          "Integração desligada no FireHub. Se o vínculo continuar no 99Food, desfaça também no painel deles.",
    });
  }

  return NextResponse.json({ error: "step inválido" }, { status: 400 });
}

/**
 * O POST que existia aqui gravava o merchantId digitado e marcava
 * `food99Connected = true` sem falar com o 99Food uma única vez. Era essa
 * rota que fazia a tela exibir '🟢 Conectado & Ativo' numa loja que nunca
 * havia sido vinculada — e foi isso que escondeu, por dias, o motivo de
 * nenhum pedido chegar.
 *
 * Foi removido em vez de só desligado da tela: qualquer pessoa com sessão
 * conseguia marcar a própria loja como conectada, e a partir de agora esse
 * booleano decide coisas de verdade (o fallback do webhook, que escolhe a
 * dona de um pedido sem merchantId conhecido, e a cobrança em lib/billing.ts).
 *
 * Quem conecta é POST /api/99food/conectar, que devolve a página de
 * autorização do 99Food e só marca conectado contra o token que eles emitem.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: 'Esta rota saiu do ar. Use POST /api/99food/conectar para gerar a autorização do lojista.',
    },
    { status: 410 }
  );
}
