import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      ownerId: true,
      storeName: true,
      storePhone: true,
      storeAddress: true,
      city: true,
      storeHours: true,
      deliveryConfig: true,
      paymentFees: true,
      chatbotConfig: true,
      storeCoupons: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  const targetFranchiseeId = user.ownerId || user.id;

  // Busca catálogo da loja para estatísticas de sincronização
  const [productCount, categoryCount] = await Promise.all([
    prisma.menuProduct.count({ where: { franchiseeId: targetFranchiseeId, active: true } }),
    prisma.menuCategory.count({ where: { franchiseeId: targetFranchiseeId } }),
  ]);

  const defaultConfig = {
    active: true,
    connected: false,
    phone: "",
    pairingCode: "",
    personality: "SIMPATICO", // "SIMPATICO" | "AGIL" | "FORMAL" | "DIVERTIDO"
    customPrompt: "",
    autoOrderLink: true,
    maxWaitTimeMinutes: 45,
    instantCouponEnabled: false,
    instantCouponCode: "",
    instantCouponDiscount: "10%",
  };

  const storedConfig = (user.chatbotConfig as any) || {};

  return NextResponse.json({
    config: { ...defaultConfig, ...storedConfig },
    coupons: Array.isArray(user.storeCoupons) ? user.storeCoupons : [],
    stats: {
      productCount,
      categoryCount,
      storeName: user.storeName || "Minha Loja",
      storeAddress: user.storeAddress || "Não informado",
      city: user.city || "Não informada",
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, chatbotConfig: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const currentConfig = (user.chatbotConfig as any) || {};

    // ── ISOLAMENTO ENTRE LOJAS ────────────────────────────────────────────
    // Antes era `{ ...currentConfig, ...body }` — merge cego do corpo enviado
    // pelo lojista. Isso deixava a loja B gravar
    //   { "instanceName": "firehub_<sufixo do id da loja A>" }
    // e passar a disputar as conversas da loja A no webhook. Pelo mesmo
    // caminho dava para gravar evolutionUrl/evolutionApiKey apontando para um
    // servidor do atacante, que passaria a receber o texto das mensagens.
    //
    // Agora so entram as chaves que o lojista realmente edita na tela. Campos
    // de VINCULO e CREDENCIAL (instanceName, evolutionUrl, evolutionApiKey,
    // cloudApi*, geminiApiKey, connected, connectedAt) so podem ser escritos
    // pelo fluxo interno de conexao, nunca por este endpoint.
    // A tela envia o objeto de config INTEIRO de volta (`...config`), entao os
    // campos fora desta lista simplesmente mantem o valor que ja estava — nada
    // quebra. `phone`, `connected` e `connectedAt` ficam permitidos porque o
    // fluxo "vincular numero digitando" grava os tres, e eles sao da PROPRIA
    // loja: nao criam vinculo com outra.
    const CAMPOS_DO_LOJISTA = [
      "active", "personality", "customPrompt", "agentName", "storeType",
      "acceptsPickup", "externalMenuUrl", "autoAcceptOrders",
      "aiOrderingEnabled", "stopOnHumanRequest",
      "instantCoupon", "instantCouponCode", "instantCouponValue",
      "phone", "connected", "connectedAt",
    ] as const;

    const permitido: Record<string, any> = {};
    const recusados: string[] = [];
    for (const chave of Object.keys(body || {})) {
      if ((CAMPOS_DO_LOJISTA as readonly string[]).includes(chave)) {
        permitido[chave] = body[chave];
      } else {
        recusados.push(chave);
      }
    }
    if (recusados.length > 0) {
      console.warn(
        `[chatbot/config] Campos recusados para a loja ${user.id} (não editáveis por aqui):`,
        recusados.join(", ")
      );
    }

    const updatedConfig = { ...currentConfig, ...permitido };

    await prisma.user.update({
      where: { id: user.id },
      data: { chatbotConfig: updatedConfig },
    });

    return NextResponse.json({ success: true, config: updatedConfig });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Erro ao salvar configurações" }, { status: 500 });
  }
}
