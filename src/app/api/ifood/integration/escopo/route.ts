/**
 * /api/ifood/integration/escopo
 *
 * As lojas que a conta do iFood já autorizou a este app e que ainda NÃO estão
 * no FireHub — lidas da claim `merchant_scope` dos tokens que a loja já tem.
 *
 * Por que existe: o portal do iFood só mostra o ID numérico da loja (1426724),
 * que a API não usa, e este aplicativo tem apenas `order` e `events` por loja
 * — `GET /merchant/v1.0/merchants` responde `200 []` e o detalhe de um merchant
 * responde 403. Ou seja, não há de onde o lojista tirar o UUID, e não há como
 * mostrar o NOME de uma loja que ainda não mandou pedido.
 *
 * Antes isso virava uma lista de UUIDs sem nome para ele escolher — impossível
 * de acertar, e escolher errado põe o pedido de uma loja no painel da outra.
 * Aqui não há escolha: ou ele confirma trazer as que faltam, ou não traz. O
 * nome de cada uma se corrige sozinho no primeiro pedido dela.
 *
 * GET  → quantas e quais estão pendentes (para a tela oferecer)
 * POST → traz todas, com a cobrança que a tela já avisou
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { merchantsDoToken } from "@/lib/ifood-api";
import { lojaDaSessao } from "@/lib/ifood-token";

async function contexto(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };

  const storeId = await lojaDaSessao(
    session.user.email,
    req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value || null,
  );
  if (!storeId) return { erro: NextResponse.json({ error: "Loja não encontrada" }, { status: 404 }) };

  const loja = await prisma.user.findUnique({
    where: { id: storeId },
    select: {
      ifoodMerchantId: true, storeName: true, name: true,
      ifoodAccessToken: true, ifoodRefreshToken: true, ifoodTokenExpiresAt: true,
    },
  });
  if (!loja) return { erro: NextResponse.json({ error: "Loja não encontrada" }, { status: 404 }) };

  const integracoes = await prisma.ifoodIntegration.findMany({
    where: { userId: storeId },
    select: { merchantId: true, accessToken: true },
  });

  // O escopo é a união de todos os tokens que esta loja guarda: quem conecta
  // uma loja por vez tem pedaços do histórico espalhados entre as integrações.
  const noEscopo = new Set<string>([
    ...merchantsDoToken(loja.ifoodAccessToken),
    ...integracoes.flatMap((i) => merchantsDoToken(i.accessToken)),
  ]);

  const minhas = new Set<string>(integracoes.map((i) => i.merchantId));
  if (loja.ifoodMerchantId) minhas.add(loja.ifoodMerchantId);

  const candidatos = [...noEscopo].filter((id) => !minhas.has(id));

  // Merchant que já é de OUTRA conta do FireHub nunca muda de dono por aqui.
  const deOutros = candidatos.length
    ? new Set<string>([
        ...(await prisma.ifoodIntegration.findMany({
          where: { merchantId: { in: candidatos }, NOT: { userId: storeId } },
          select: { merchantId: true },
        })).map((i) => i.merchantId),
        ...((await prisma.user.findMany({
          where: { ifoodMerchantId: { in: candidatos }, NOT: { id: storeId } },
          select: { ifoodMerchantId: true },
        })).map((u) => u.ifoodMerchantId).filter(Boolean) as string[]),
      ])
    : new Set<string>();

  return {
    storeId,
    loja,
    pendentes: candidatos.filter((id) => !deOutros.has(id)),
    jaTem: minhas.size,
  };
}

export async function GET(req: NextRequest) {
  const ctx = await contexto(req);
  if ("erro" in ctx) return ctx.erro;
  return NextResponse.json({ pendentes: ctx.pendentes, jaTem: ctx.jaTem });
}

export async function POST(req: NextRequest) {
  const ctx = await contexto(req);
  if ("erro" in ctx) return ctx.erro;

  const { storeId, loja, pendentes, jaTem } = ctx;
  if (pendentes.length === 0) {
    return NextResponse.json({ vinculadas: 0, message: "Nenhuma loja nova autorizada no iFood." });
  }

  // O token da loja vai junto: é a credencial que autoriza justamente estes
  // merchants, e uma autorização futura vai sobrescrever a do User.
  const credenciais = {
    accessToken: loja.ifoodAccessToken,
    refreshToken: loja.ifoodRefreshToken,
    tokenExpiresAt: loja.ifoodTokenExpiresAt,
  };

  let vinculadas = 0;
  for (const merchantId of pendentes) {
    try {
      await prisma.ifoodIntegration.upsert({
        where: { userId_merchantId: { userId: storeId, merchantId } },
        create: {
          userId: storeId,
          // Sem pedido dela ainda não há nome; o cron troca pelo nome real
          // ("Ragnar Pizza") assim que o primeiro pedido passar.
          label: loja.storeName || loja.name || "Loja iFood",
          merchantId,
          connected: true,
          active: true,
          ...credenciais,
        },
        update: { connected: true, active: true },
      });
      vinculadas++;
    } catch (e: any) {
      console.warn(`[iFood escopo] Falha ao vincular ${merchantId}:`, e?.message);
    }
  }

  if (!loja.ifoodMerchantId && pendentes[0]) {
    await prisma.user.update({
      where: { id: storeId },
      data: { ifoodMerchantId: pendentes[0], ifoodConnected: true },
    });
  }

  const extras = Math.max(0, jaTem + vinculadas - 1);
  console.log(`[iFood escopo] Loja ${storeId}: ${vinculadas} loja(s) vinculada(s) pelo escopo do token.`);

  return NextResponse.json({
    vinculadas,
    message:
      `${vinculadas} loja(s) do iFood conectada(s)! O nome de cada uma aparece no primeiro pedido dela.` +
      (extras > 0 ? ` Sua conta passa a ter ${extras} loja(s) adicional(is): +R$${(extras * 50).toFixed(2)}/mês.` : ""),
  });
}
