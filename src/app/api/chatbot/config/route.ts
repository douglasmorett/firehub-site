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
      notificationPhone: true,
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
      // Para quem vão os alertas do robô. Só leitura: quem edita é Minha Loja.
      // Sem isto a aba Alertas não teria como avisar que não há número
      // cadastrado — e o dono ligaria alertas que nunca chegariam a ninguém.
      notificationPhone: user.notificationPhone || "",
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
      // Campanhas de recuperação (7/15/30 dias) e cupons.
      //
      // Faltavam aqui, e o efeito era mudo: a aba de Marketing DENTRO do
      // chatbot salva por esta rota, então o lojista clicava "ATIVADO" no
      // disparo de 7 dias, a tela ficava verde (o estado local muda na hora)
      // e o campo era recusado — nunca chegava ao banco. A mesma configuração
      // feita pela página /store/marketing gravava normalmente, porque aquela
      // usa outra rota. Dependia de por onde o lojista tinha entrado.
      "autoRecuperation7d", "autoRecuperation15d", "autoRecuperation30d",
      "msg7d", "msg15d", "msg30d",
      "img7d", "img15d", "img30d",
      "coupon7d", "coupon15d", "coupon30d",
      "instantCouponEnabled", "instantCouponDiscount",
      "pickupAddress", "sendOrderConfirmation",
      // Aba Alertas: o que o dono recebe no WhatsApp, quem o robô não atende, e
      // se ele sai da conversa quando o cliente reclama do pedido.
      "alertas", "numerosIgnorados", "escalateOnComplaint",
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

    // `recusados` volta para a tela: sem isso o lojista via "salvo!" em verde
    // enquanto o campo era descartado aqui, e ninguém descobria por meses.
    return NextResponse.json({ success: true, config: updatedConfig, recusados });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Erro ao salvar configurações" }, { status: 500 });
  }
}
