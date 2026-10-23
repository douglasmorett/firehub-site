import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { linkDeAvaliacaoNoGoogle } from "@/lib/avaliacao-no-google";
import { lerOutrosNumerosDoDono } from "@/lib/numeros-do-dono";
import { limparPixDaLoja } from "@/lib/pix-da-loja";
import { configSemCredenciais } from "@/lib/gateway-da-loja";
import { podeComoNaTela } from "@/lib/permissoes-da-equipe";

/**
 * A configuração do robô é da LOJA: qualquer login dela (dono ou equipe) vê e
 * grava a mesma (Douglas, 12/10/2026: "se é a mesma loja, qualquer login tem
 * que dar a mesma configuração"). As duas rotas liam e gravavam o registro de
 * quem estava logado: no login da caixa da Pizzaria 17 a tela mostrava um robô
 * em branco ("só delivery", sem reserva) e o que ela salvasse ficava na conta
 * dela, onde o robô da loja nunca lê.
 */
async function quemPediu(email: string) {
  return prisma.user.findUnique({
    where: { email },
    select: { id: true, ownerId: true, role: true, permissions: true },
  });
}
async function idDaLoja(email: string): Promise<string | null> {
  const quem = await quemPediu(email);
  return quem ? quem.ownerId || quem.id : null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const lojaId = await idDaLoja(session.user.email);
  const user = lojaId ? await prisma.user.findUnique({
    where: { id: lojaId },
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
  }) : null;

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
    // Ler continua para qualquer login (Integrações mostra se o WhatsApp está
    // ligado), mas sem as chaves: lib/gateway-da-loja.ts, configSemCredenciais.
    config: configSemCredenciais({ ...defaultConfig, ...storedConfig }),
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

  // Gravar é da tela do robô (/store/chatbot, caixinha "Minha loja"): o caixa
  // com só "Pedidos" trocava a chave Pix que o robô manda ao cliente.
  const quem = await quemPediu(session.user.email);
  if (quem && !podeComoNaTela(quem, "/store/chatbot")) {
    return NextResponse.json({ error: "Sua conta não tem acesso ao Robô: peça ao dono da loja para marcar \"Minha loja\" em Equipe." }, { status: 403 });
  }
  const lojaId = quem ? quem.ownerId || quem.id : null;
  const user = lojaId
    ? await prisma.user.findUnique({
        where: { id: lojaId },
        select: { id: true, chatbotConfig: true },
      })
    : null;

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
      // A loja confere cada pedido do robô antes da cozinha (lib/finalizar-rascunho.ts)
      // e diz se faz reserva de mesa (o robô fala que faz e chama a equipe).
      "conferirPedidoDoRobo", "fazReservaDeMesa",
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
      // Link de avaliação no Google, pedido no agradecimento do pedido
      // entregue (lib/order-notifications.ts).
      "googleReviewUrl",
      // Outros números que recebem os avisos junto com o principal.
      "outrosNumerosDoDono",
      // A chave Pix da loja, que o robô manda ao cliente (lib/pix-da-loja.ts).
      "pixDaLoja",
      // Quando o robô manda o cardápio em arquivo: "RECUSA" (só se o cliente
      // recusar o site, o padrão) ou "INICIO" (junto com o link, logo de cara).
      "menuFileQuando",
      // Pausar iFood, site e robô quando a loja fica sem conexão
      // (lib/loja-sem-conexao.ts). Ausente = ligada.
      "protecaoSemConexao",
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
    // O link vai para todo cliente que recebe pedido: só entra link do Google,
    // já com "https://". Vazio apaga; qualquer outra coisa é recusada e o
    // link que estava continua.
    if ("googleReviewUrl" in permitido) {
      const bruto = String(permitido.googleReviewUrl ?? "").trim();
      const link = linkDeAvaliacaoNoGoogle(bruto);
      if (!bruto) permitido.googleReviewUrl = "";
      else if (link) permitido.googleReviewUrl = link;
      else {
        delete permitido.googleReviewUrl;
        recusados.push("googleReviewUrl");
      }
    }

    // Só dígitos, com DDI, sem repetir e no máximo o teto — é a mesma limpeza
    // que quem envia faz (lib/alertas-do-dono.ts).
    if ("outrosNumerosDoDono" in permitido) {
      permitido.outrosNumerosDoDono = lerOutrosNumerosDoDono({ outrosNumerosDoDono: permitido.outrosNumerosDoDono });
    }
    if ("menuFileQuando" in permitido && permitido.menuFileQuando !== "INICIO" && permitido.menuFileQuando !== "RECUSA") {
      delete permitido.menuFileQuando;
      recusados.push("menuFileQuando");
    }
    if ("protecaoSemConexao" in permitido && typeof permitido.protecaoSemConexao !== "boolean") {
      delete permitido.protecaoSemConexao;
      recusados.push("protecaoSemConexao");
    }
    // A chave vai para o dinheiro do cliente: só entra reconhecida (CPF/CNPJ
    // com dígito certo, celular, e-mail, aleatória) e com o titular. Recusada,
    // a que estava continua — e a tela mostra o porquê.
    let erroDoPix: string | null = null;
    if ("pixDaLoja" in permitido) {
      const limpo = limparPixDaLoja(permitido.pixDaLoja);
      if (limpo && "erro" in limpo) {
        erroDoPix = limpo.erro;
        delete permitido.pixDaLoja;
        recusados.push("pixDaLoja");
      } else {
        permitido.pixDaLoja = limpo;
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
    return NextResponse.json({ success: true, config: configSemCredenciais(updatedConfig), recusados, ...(erroDoPix ? { erroDoPix } : {}) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Erro ao salvar configurações" }, { status: 500 });
  }
}
