/**
 * /api/ifood/auth/route.ts
 * Fluxo de autorização de merchant iFood (Authorization Code)
 * GET  ?step=url     → gera URL de autorização para o merchant aprovar
 * POST {code, merchantId} → troca code por token + salva merchantId
 * GET  ?step=test    → testa se o merchantId atual está funcionando
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getIfoodToken, merchantsDoToken } from "@/lib/ifood-api";
import { appEscolhido, credenciaisDoApp, ErroCredencialApp } from "@/lib/ifood-app";
import { lojaDaSessao } from "@/lib/ifood-token";
import { prisma } from "@/lib/prisma";

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

/**
 * Congela o token ATUAL da loja nas integrações que ainda dependem dele, ANTES
 * de uma autorização nova substituí-lo.
 *
 * Quem conecta as lojas uma por uma — Ragnar Burguer, depois Ragnar Pizza,
 * depois Tadala — gera uma autorização por loja, e cada uma sobrescrevia
 * `User.ifoodAccessToken`. A loja já vinculada não guarda token próprio (ela
 * era a principal), então passava a depender de uma credencial emitida para
 * OUTRA loja. Enquanto as duas estão no mesmo login do iFood isso funciona por
 * sorte; no dia em que não estiverem, a loja anterior para de receber pedido
 * sem nada mudar na tela.
 */
async function preservarTokenDasIntegracoes(
  storeId: string,
  atual: { accessToken: string | null; refreshToken: string | null; tokenExpiresAt: Date | null },
) {
  if (!atual.accessToken) return;
  try {
    const r = await prisma.ifoodIntegration.updateMany({
      where: { userId: storeId, accessToken: null },
      data: {
        accessToken: atual.accessToken,
        refreshToken: atual.refreshToken,
        tokenExpiresAt: atual.tokenExpiresAt,
      },
    });
    if (r.count > 0) {
      console.log(`[iFood Auth] Token anterior preservado em ${r.count} integração(ões) da loja ${storeId}.`);
    }
  } catch (e: any) {
    console.warn("[iFood Auth] Aviso ao preservar token das integrações:", e?.message);
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const step = req.nextUrl.searchParams.get("step");

  // ── Passo 1: Gera URL de autorização ──────────────────────────────────────
  if (step === "url") {
    const clientId   = process.env.IFOOD_CLIENT_ID;
    const merchantId = process.env.IFOOD_MERCHANT_UUID || "";
    if (!clientId) return NextResponse.json({ error: "IFOOD_CLIENT_ID não configurado" }, { status: 500 });

    // URL de autorização do iFood para o merchant aprovar a conexão
    const authUrl = `https://developer.ifood.com.br/oauth/userAuthorize?client_id=${clientId}&response_type=code&redirect_uri=https://firehubfood.com.br/api/ifood/auth/callback`;

    return NextResponse.json({
      authUrl,
      merchantId,
      clientId,
      instruction: "Abra esta URL no navegador e faça login com a conta iFood da loja de teste para autorizar o acesso.",
    });
  }

  // ── Passo 2: Testa conexão com merchantId atual (com suporte ao banco de dados) ──
  if (step === "test") {
    const email = session.user?.email || "";
    const user = await prisma.user.findUnique({
      where: { email },
      select: { ifoodConnected: true, ifoodMerchantId: true }
    });

    // Se o usuário desconectou explicitamente E não está forçando reconexão, reporta desconectado
    const force = req.nextUrl.searchParams.get("force") === "true";
    const isExplicitlyDisconnected = user && user.ifoodConnected === false;
    if (isExplicitlyDisconnected && !force) {
      return NextResponse.json({ connected: false, message: "Loja desconectada pelo usuário" });
    }

    const merchantId = user?.ifoodMerchantId;
    if (!merchantId) {
      return NextResponse.json({ connected: false, error: "Nenhuma loja iFood conectada." });
    }

    try {
      const token = await getIfoodToken();
      const res   = await fetch(`${IFOOD_BASE}/merchant/v1.0/merchants/${merchantId}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      
      const resOk = res.ok;
      const data = resOk ? await res.json() : await res.text();

      // Se conectou com sucesso e o status no banco ainda era falso/não sincronizado, atualiza para true
      if (resOk && user && !user.ifoodConnected) {
        await prisma.user.update({
          where: { email },
          data: { ifoodConnected: true, ifoodMerchantId: merchantId }
        });
      }

      return NextResponse.json({
        connected: resOk,
        status:    res.status,
        merchantId,
        storeName: resOk ? (data?.name || data?.shortName || "Loja iFood") : null,
        raw:       data,
      });
    } catch (err: any) {
      return NextResponse.json({ connected: false, error: err.message });
    }
  }

  // ── Passo 4: Auto-descobre merchantId e puxa pedidos retroativos ──────────
  if (step === "discover-merchant") {
    const email = session.user?.email || "";

    // A LOJA, não o registro de quem está logado. Resolver por e-mail da sessão
    // punha o vínculo na conta errada em dois casos reais: funcionário abrindo a
    // tela (o merchant ia para o registro dele, não da franquia) e ADMIN em modo
    // suporte (ia para a conta do admin, com a loja do cliente na tela). Mesma
    // regra de /api/ifood/auth/link-merchant.
    const sessionUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, ownerId: true },
    });
    if (!sessionUser) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const activeStoreId =
      req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value || null;
    const storeId =
      sessionUser.role === "ADMIN" && activeStoreId && activeStoreId !== "all"
        ? activeStoreId
        : (sessionUser.ownerId || sessionUser.id);

    const user = await prisma.user.findUnique({
      where: { id: storeId },
      select: { id: true, ifoodMerchantId: true, ifoodConnected: true, ifoodAccessToken: true }
    });

    if (!user) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

    // Se já tem merchantId, retorna
    if (user.ifoodMerchantId) {
      return NextResponse.json({ success: true, merchantId: user.ifoodMerchantId, message: "merchantId já configurado" });
    }

    const log: string[] = [];

    try {
      const { getIfoodToken } = await import("@/lib/ifood-api");
      const token = await getIfoodToken();

      // Tentar via API de merchants (usando token do usuario se disponível, senão o centralizado)
      const merchantsToken = user.ifoodAccessToken || token;
      let discoveredMerchantId: string | null = null;
      let discoveredStoreName = "";

      // Tentativa 1: GET /merchant/v1.0/merchants com o token do usuário
      try {
        const mRes = await fetch("https://merchant-api.ifood.com.br/merchant/v1.0/merchants", {
          headers: { Authorization: `Bearer ${merchantsToken}`, Accept: "application/json" },
        });
        if (mRes.ok) {
          const mData = await mRes.json();
          log.push(`merchants API retornou: ${JSON.stringify(mData).slice(0, 300)}`);
          const merchants = Array.isArray(mData) ? mData : (mData.merchants || mData.data || []);
          
          // Encontrar merchants que não estão atribuídos a nenhum usuário
          for (const m of merchants) {
            const mid = m.id || m.merchantId;
            if (!mid) continue;
            const existing = await prisma.user.findFirst({ where: { ifoodMerchantId: mid } as any });
            if (!existing) {
              discoveredMerchantId = mid;
              discoveredStoreName = m.name || m.corporateName || "";
              log.push(`✅ merchantId descoberto: ${mid} (${discoveredStoreName})`);
              break;
            }
          }
        } else {
          log.push(`merchants API falhou: ${mRes.status}`);
        }
      } catch (e: any) {
        log.push(`merchants API erro: ${e.message}`);
      }

      // ── Tentativa 2: a fila de eventos DESTA loja ─────────────────────
      //
      // Duas correções nesta passagem, e as duas doeram numa loja real:
      //
      // 1. O token era o CENTRALIZADO (`token`). Este app é distribuído, do tipo
      //    Authorization Code — não existe token do app que enxergue as lojas
      //    dos outros. Espiar com ele é olhar a fila errada, e o lojista via
      //    "não consegui descobrir" com a fila dele cheia de pedido.
      //
      // 2. Pegava o PRIMEIRO merchant não atribuído e seguia em frente. Quando
      //    a conta do lojista tem duas lojas autorizadas ao app — que é comum, e
      //    aconteceu com a Ragnar Burger e a Tadala Burger no mesmo login — isso
      //    é escolher no cara ou coroa. Merchant errado faz o pedido de uma loja
      //    cair no painel da outra; melhor perguntar do que adivinhar.
      let candidatos: { merchantId: string; nome: string }[] = [];
      if (!discoveredMerchantId) {
        try {
          const { getTokenDaLojaIfood, descobrirMerchantsComNome } = await import("@/lib/ifood-api");
          const tokenDaLoja = await getTokenDaLojaIfood(user.id);
          if (!tokenDaLoja) {
            log.push("sem token desta loja — reconecte o iFood");
          } else {
            const vistos = await descobrirMerchantsComNome(tokenDaLoja);
            log.push(`${vistos.length} merchant(s) na fila desta loja`);

            // Merchant que já é de outro dono nunca entra na escolha.
            const ocupadosDb = await prisma.user.findMany({
              where: { ifoodMerchantId: { in: vistos.map((v) => v.merchantId) }, NOT: { id: user.id } },
              select: { ifoodMerchantId: true },
            });
            const ocupados = new Set(ocupadosDb.map((u) => u.ifoodMerchantId).filter(Boolean) as string[]);
            candidatos = vistos.filter((v) => !ocupados.has(v.merchantId));

            if (candidatos.length === 1) {
              discoveredMerchantId = candidatos[0].merchantId;
              discoveredStoreName = candidatos[0].nome || "";
              log.push(`✅ merchantId descoberto via eventos: ${discoveredMerchantId}`);
            }
          }
        } catch (e: any) {
          log.push(`events peek erro: ${e.message}`);
        }
      }

      // Mais de uma loja na fila: quem escolhe é o lojista, que sabe qual é a
      // dele. A tela mostra os nomes; sem isto, a escolha seria entre UUIDs.
      if (!discoveredMerchantId && candidatos.length > 1) {
        return NextResponse.json({
          success: false,
          precisaEscolher: true,
          candidatos,
          message: `Encontramos ${candidatos.length} lojas do iFood nesta conta. Escolha qual delas é esta loja do FireHub.`,
          log,
        });
      }

      if (!discoveredMerchantId) {
        return NextResponse.json({
          success: false,
          message: "Não foi possível descobrir o merchantId automaticamente. Cole o Merchant UUID na seção iFood Merchant API.",
          log,
        });
      }

      // Salvar merchantId descoberto
      await prisma.user.update({
        where: { id: user.id },
        data: { ifoodMerchantId: discoveredMerchantId, ifoodConnected: true }
      });

      // Criar IfoodIntegration record
      try {
        await prisma.ifoodIntegration.upsert({
          where: { userId_merchantId: { userId: user.id, merchantId: discoveredMerchantId } },
          create: {
            userId: user.id,
            label: discoveredStoreName || "Loja iFood",
            merchantId: discoveredMerchantId,
            connected: true,
            active: true,
          },
          update: { connected: true, active: true },
        });
      } catch {}

      log.push(`✅ merchantId ${discoveredMerchantId} salvo para ${email}`);

      // Backfill: tentar puxar pedidos recentes do iFood
      let importedCount = 0;
      try {
        // Peek events novamente e processar os que pertencem a esta loja
        const evRes = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (evRes.ok) {
          const evText = await evRes.text();
          const events = evText ? JSON.parse(evText) : [];
          const myEvents = events.filter((e: any) => e.merchantId === discoveredMerchantId && e.orderId);
          
          for (const event of myEvents) {
            const exists = await prisma.customerOrder.findFirst({
              where: { ifoodOrderId: event.orderId } as any,
            });
            if (exists) continue;

            try {
              const orderRes = await fetch(
                `https://merchant-api.ifood.com.br/order/v1.0/orders/${event.orderId}`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (!orderRes.ok) continue;
              const orderData = await orderRes.json();

              const { generateDailyOrderNumber } = await import("@/lib/order-number");
              const { parseOrderPaymentInfo } = await import("@/lib/payment-parser");
              const { montarItensDoPedidoIfood } = await import("@/lib/ifood-itens");

              const items = await montarItensDoPedidoIfood(orderData.items || [], {
                franchiseeId: user.id,
                active: false,
                // Aqui o item pode chegar sem `id` (payload resumido do onboarding);
                // o externalCode é o que resta para não jogar todos no mesmo produto.
                idDoItem: (i: any, idx: number) => i?.id || i?.externalCode || `sem-id-${idx}`,
              });

              const total = typeof orderData.total === "object" ? (orderData.total?.orderAmount ?? 0) : (orderData.totalPrice ?? 0);
              const deliveryFee = orderData.total?.deliveryFee ?? orderData.deliveryFee ?? 0;
              const parsedPay = parseOrderPaymentInfo(orderData, "IFOOD");
              const customer = orderData.customer || {};
              const addr = orderData.delivery?.deliveryAddress;
              const addressStr = addr ? [addr.formattedAddress || `${addr.streetName || ""}, ${addr.streetNumber || ""}`, addr.complement, addr.neighborhood, addr.city].filter(Boolean).join(" - ") : "";

              await (prisma.customerOrder as any).create({
                data: {
                  franchiseeId: user.id,
                  dailyOrderNumber: await generateDailyOrderNumber(user.id),
                  ifoodOrderId: event.orderId,
                  ifoodReference: orderData.displayId ?? undefined,
                  source: "IFOOD",
                  customerName: customer.name ?? "Cliente iFood",
                  customerPhone: customer.phone?.number ?? "",
                  customerAddress: addressStr,
                  deliveryType: orderData.orderType === "TAKEOUT" ? "RETIRADA" : "DELIVERY",
                  paymentMethod: parsedPay.paymentMethod,
                  totalAmount: total,
                  deliveryFee,
                  status: "NOVO",
                  createdAt: orderData.createdAt ? new Date(orderData.createdAt) : new Date(),
                  items: { create: items },
                },
              });
              importedCount++;
              log.push(`📦 Pedido ${event.orderId} importado!`);
            } catch (orderErr: any) {
              log.push(`⚠️ Erro importando ${event.orderId}: ${orderErr.message}`);
            }
          }

          // Ack todos os eventos processados
          if (events.length > 0) {
            const ackPayload = events.filter((e: any) => e.id).map((e: any) => ({ id: e.id }));
            await fetch("https://merchant-api.ifood.com.br/events/v1.0/events/acknowledgment", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify(ackPayload),
            });
            log.push(`✅ ${ackPayload.length} eventos acknowledged`);
          }
        }
      } catch (backfillErr: any) {
        log.push(`⚠️ Erro no backfill: ${backfillErr.message}`);
      }

      return NextResponse.json({
        success: true,
        merchantId: discoveredMerchantId,
        storeName: discoveredStoreName,
        importedOrders: importedCount,
        message: `merchantId descoberto e ${importedCount} pedido(s) importado(s)!`,
        log,
      });
    } catch (err: any) {
      return NextResponse.json({ error: err.message, log }, { status: 500 });
    }
  }

  // ── Passo 3: Desconecta a loja do iFood ────────────────────────────────────
  if (step === "disconnect") {
    const email = session.user?.email || "";

    // O card "Integração Principal / Ativa" da tela le da tabela
    // IfoodIntegration, nao do User. Antes o disconnect so limpava o User,
    // entao o lojista clicava em Desconectar e a tela continuava mostrando
    // "Ativa" — foi o que travou a Pastel da Paulista, que precisava
    // desconectar para reconectar no merchant certo.
    // Agora limpa OS DOIS, e apaga os tokens junto para nao deixar credencial
    // orfa de uma conexao que o lojista pediu para encerrar.
    //
    // ⚠️ E desconecta UMA loja quando vem `?merchantId=`. Sem isso, a conta com
    // tres lojas iFood perdia as tres num clique: o botao chamava esta rota sem
    // parametro e o deleteMany levava a integracao inteira da conta junto.
    const alvo = req.nextUrl.searchParams.get("merchantId");

    // A LOJA, nao o registro de quem esta logado — mesma regra de link-merchant.
    const sessionUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, ownerId: true },
    });
    if (!sessionUser) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const lojaAtiva =
      req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value || null;
    const storeId =
      sessionUser.role === "ADMIN" && lojaAtiva && lojaAtiva !== "all"
        ? lojaAtiva
        : (sessionUser.ownerId || sessionUser.id);

    const limparConta = {
      ifoodConnected: false,
      ifoodMerchantId: null,
      ifoodAccessToken: null,
      ifoodRefreshToken: null,
      ifoodTokenExpiresAt: null,
      ifoodAuthVerifier: null,
    };

    if (alvo) {
      const removidas = await prisma.ifoodIntegration.deleteMany({
        where: { userId: storeId, merchantId: alvo },
      });
      const restantes = await prisma.ifoodIntegration.findMany({
        where: { userId: storeId, active: true },
        orderBy: { createdAt: "asc" },
        select: { merchantId: true },
      });

      const loja = await prisma.user.findUnique({
        where: { id: storeId },
        select: { ifoodMerchantId: true },
      });

      // Se saiu justamente a principal, outra assume o posto. Zerar o campo
      // deixaria as restantes sem o vinculo que varias telas ainda leem.
      if (loja?.ifoodMerchantId === alvo) {
        const proxima = restantes[0]?.merchantId ?? null;
        await prisma.user.update({
          where: { id: storeId },
          data: proxima ? { ifoodMerchantId: proxima } : limparConta,
        });
      }

      console.log(
        `[iFood Auth] Loja ${storeId}: merchant ${alvo} desconectado (${removidas.count} integração). Restam ${restantes.length}.`
      );

      return NextResponse.json({
        success: true,
        connected: restantes.length > 0,
        integracoesRemovidas: removidas.count,
        restantes: restantes.length,
      });
    }

    await prisma.user.update({ where: { id: storeId }, data: limparConta });

    const removidas = await prisma.ifoodIntegration.deleteMany({
      where: { userId: storeId },
    });

    console.log(`[iFood Auth] Loja ${storeId} desconectada. Integrações removidas: ${removidas.count}`);

    return NextResponse.json({
      success: true,
      connected: false,
      integracoesRemovidas: removidas.count,
    });
  }

  return NextResponse.json({ error: "step inválido. Use ?step=url, ?step=test, ?step=disconnect ou ?step=discover-merchant" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const rawCode = (body.authorizationCode || body.merchantId || "").trim();
  if (!rawCode) return NextResponse.json({ error: "Código de autorização obrigatório" }, { status: 400 });

  // TUDO nesta rota é gravado NA LOJA, nunca no registro de quem está logado.
  // Token no registro do funcionário é credencial que o polling não lê: a tela
  // diz "conectada" e a cozinha não recebe pedido.
  const storeId = session.user?.email
    ? await lojaDaSessao(
        session.user.email,
        req.nextUrl.searchParams.get("storeId") || req.cookies.get("firehub_active_store")?.value || null,
      )
    : null;

  // Se o usuário digitou diretamente um Merchant UUID (formato 8-4-4-4-12)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCode);
  if (isUuid && storeId) {
    const userRec = await prisma.user.findUnique({
      where: { id: storeId },
      select: {
        id: true, name: true, storeName: true, ifoodMerchantId: true,
        ifoodAccessToken: true, ifoodRefreshToken: true, ifoodTokenExpiresAt: true,
      }
    });
    if (userRec) {
      await prisma.user.update({
        where: { id: storeId },
        data: {
          ifoodConnected: true,
          // Loja adicional não rouba o posto da principal.
          ...(userRec.ifoodMerchantId ? {} : { ifoodMerchantId: rawCode }),
        },
      });
      try {
        // ── LOJA ADICIONAL GUARDA O TOKEN DELA ───────────────────────────────
        // É isto que faz "conectar uma por uma" funcionar: cada autorização
        // sobrescreve `User.ifoodAccessToken`, então sem congelar a credencial
        // na linha da loja 2 ela acabava apoiada no token da loja 3 e parava de
        // receber pedido, calada. Só na adicional — a principal segue no token
        // do User, para não haver dois lugares renovando o mesmo refresh_token.
        const credenciaisDaAdicional = userRec.ifoodMerchantId && userRec.ifoodMerchantId !== rawCode
          ? {
              accessToken: userRec.ifoodAccessToken,
              refreshToken: userRec.ifoodRefreshToken,
              tokenExpiresAt: userRec.ifoodTokenExpiresAt,
            }
          : {};

        await prisma.ifoodIntegration.upsert({
          where: { userId_merchantId: { userId: storeId, merchantId: rawCode } },
          create: {
            userId: storeId,
            label: userRec.storeName || userRec.name || "Loja Principal",
            merchantId: rawCode,
            connected: true,
            active: true,
            ...credenciaisDaAdicional,
          },
          update: { connected: true, active: true },
        });
      } catch (e: any) {
        console.warn("[iFood Auth] Aviso ao salvar ifoodIntegration por UUID:", e?.message);
      }
    }
    return NextResponse.json({
      success: true,
      merchantId: rawCode,
      message: "Loja iFood conectada com sucesso!",
    });
  }

  // O aplicativo usado na troca precisa ser o MESMO que gerou o código de
  // ativação — o iFood amarra o authorizationCode ao clientId que o emitiu.
  // Por isso a escolha vem do corpo da requisição, e não de uma env fixa.
  const appConexao = appEscolhido(body?.app ?? null);
  let clientId: string;
  let clientSecret: string;
  try {
    const cred = credenciaisDoApp(appConexao);
    clientId = cred.clientId;
    clientSecret = cred.clientSecret;
    console.log("[iFood Auth] Conectando pelo " + cred.rotulo + ".");
  } catch (e: any) {
    if (e instanceof ErroCredencialApp) {
      console.error("[iFood Auth]", e.message);
      return NextResponse.json({ error: e.message, hint: e.hint }, { status: 503 });
    }
    throw e;
  }

  const user = storeId ? await prisma.user.findUnique({ where: { id: storeId } }) : null;
  const verifier = user?.ifoodAuthVerifier;

  // Tentativa 1: Com verifier (Fluxo Distribuído UserCode)
  let res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grantType: "authorization_code",
      clientId,
      clientSecret,
      authorizationCode: rawCode,
      ...(verifier ? { authorizationCodeVerifier: verifier } : {}),
    }),
  });

  let data = await res.json();
  let usouVerifier = !!verifier;

  console.log(
    `[iFood Auth] Troca de código: status=${res.status} verifier=${verifier ? "presente" : "AUSENTE"} ` +
    `clientId=${clientId.slice(0, 8)}…`
  );

  // Tentativa 1.5: o mesmo código, mas pelo APLICATIVO DE TESTE.
  //
  // O código de ativação é amarrado ao clientId que o emitiu. Quem gera pela
  // tela de homologação recebe um código do app de teste — e cola em
  // /store/integracoes, uma tela que não sabe disso e não manda `app` nenhum.
  // Sem esta tentativa, esse código é trocado com as credenciais de produção,
  // falha, e cai direto na Tentativa 2 (sem verifier), que é justamente o
  // caminho que produz token sem loja.
  //
  // Uma loja real conecta na Tentativa 1 e nunca chega aqui, então isto não
  // muda nada para produção. E o verifier é MANTIDO: é ele que amarra o código
  // à sessão de userCode daquela loja.
  if (!res.ok && appConexao === "producao" && process.env.IFOOD_HOMOLOG_CLIENT_ID) {
    try {
      const teste = credenciaisDoApp("homologacao");
      console.warn("[iFood Auth] Troca falhou no app de produção. Tentando pelo aplicativo de teste.");
      const resTeste = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grantType: "authorization_code",
          clientId: teste.clientId,
          clientSecret: teste.clientSecret,
          authorizationCode: rawCode,
          ...(verifier ? { authorizationCodeVerifier: verifier } : {}),
        }),
      });
      if (resTeste.ok) {
        res = resTeste;
        data = await resTeste.json();
        // As credenciais gravadas na integração precisam ser as do app que de
        // fato autorizou, senão a renovação futura falha.
        clientId = teste.clientId;
        clientSecret = teste.clientSecret;
        console.log("[iFood Auth] Loja conectada pelo aplicativo de teste.");
      }
    } catch (e: any) {
      console.warn("[iFood Auth] App de teste indisponível:", e?.message);
    }
  }

  // Tentativa 2: sem verifier.
  //
  // ⚠️ No fluxo DISTRIBUÍDO o authorizationCodeVerifier e obrigatorio — ele
  // amarra o codigo a sessao de userCode daquela loja. Repetir a troca SEM ele
  // pode devolver um token que parece valido mas NAO carrega a concessao da
  // loja: foi assim que a Pastel da Paulista acabou com um token cujo
  // GET /merchants respondeu [] (visto no log de producao), e o codigo caiu no
  // fallback do merchantId antigo, vinculando ao merchant da Hakim.
  //
  // Mantido apenas como compatibilidade com o fluxo centralizado antigo, mas
  // agora fica REGISTRADO que o token veio sem verifier — e mais abaixo, se
  // /merchants vier vazio nesse caminho, o lojista recebe instrucao clara em
  // vez de um vinculo fantasma.
  if (!res.ok && verifier) {
    console.warn("[iFood Auth] Tentativa com verifier falhou. Repetindo SEM verifier (fluxo centralizado legado).");
    res = await fetch(`${IFOOD_BASE}/authentication/v1.0/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grantType: "authorization_code",
        clientId,
        clientSecret,
        authorizationCode: rawCode,
      }),
    });
    if (res.ok) {
      data = await res.json();
      usouVerifier = false;
    }
  }

  // O verifier vale para UMA autorizacao. Deixar guardado faz a proxima
  // tentativa reutilizar um verifier velho e falhar de novo, empurrando o fluxo
  // para a Tentativa 2 — o caminho que gera o token sem loja.
  if (res.ok && verifier && user?.id) {
    prisma.user
      .update({ where: { id: user.id }, data: { ifoodAuthVerifier: null } })
      .catch(() => {});
  }

  if (!res.ok) {
    const errorMsg = data?.error?.message || data?.error || `iFood ${res.status}`;
    console.error("[iFood Auth] Token Exchange Error:", data);
    return NextResponse.json({
      error: `Erro de autorização iFood: ${errorMsg}`,
      details: data,
      hint: "Certifique-se de ter clicado em '1. Conectar e Autorizar no Portal iFood' e colado o código gerado na janela 'Aplicativo Autorizado' dentro de 60 segundos.",
    }, { status: res.status });
  }

  // Obter merchantId do iFood usando o accessToken obtido
  let merchantId = data.merchantId || data.merchant?.id;
  let merchantName = data.merchantName || data.merchant?.name || "";

  // Merchants livres quando a escolha automatica seria ambigua — devolvidos ao
  // lojista para ele escolher, em vez de vincular errado.
  let merchantsAmbiguos: { id: string; name: string }[] = [];

  // A loja da sessao, necessaria para descartar merchants de OUTRAS lojas.
  const userIdAtual = storeId;

  // ── AS LOJAS QUE ESTA AUTORIZAÇÃO COBRE, LIDAS DO PRÓPRIO TOKEN ──────────
  //
  // O JWT do iFood traz `merchant_scope` — um "<uuid>:order"/"<uuid>:events"
  // por loja autorizada. Não custa chamada nenhuma e, ao contrário da fila de
  // eventos, funciona com a fila VAZIA. Era esse o buraco: quem conectava fora
  // do horário de pedido recebia "🎉 Loja conectada!" e não gravava vínculo
  // nenhum, porque não havia evento de onde tirar o merchantId. A Ragnar
  // autorizou três lojas assim e ficou com uma.
  //
  // ⚠️ NÃO se vincula tudo o que está no escopo. O `merchant_scope` ACUMULA as
  // autorizações que aquela conta do iFood já deu ao app — quem tem dez lojas
  // no portal e quer duas no FireHub ganharia as dez, e oito cobranças de
  // R$50/mês que nunca pediu. Vincular sozinho só quando NÃO HÁ escolha a
  // fazer: uma única loja no escopo e a conta ainda sem nenhuma. Nos outros
  // casos a lista volta para a tela e o lojista marca as que quer, uma a uma.
  const lojasDoToken = merchantsDoToken(data.accessToken);
  if (lojasDoToken.length > 0 && storeId) {
    const jaDeOutros = await prisma.ifoodIntegration.findMany({
      where: { merchantId: { in: lojasDoToken }, NOT: { userId: storeId } },
      select: { merchantId: true },
    });
    const deOutroUser = await prisma.user.findMany({
      where: { ifoodMerchantId: { in: lojasDoToken }, NOT: { id: storeId } },
      select: { ifoodMerchantId: true },
    });
    const ocupados = new Set<string>([
      ...jaDeOutros.map((i) => i.merchantId),
      ...(deOutroUser.map((u) => u.ifoodMerchantId).filter(Boolean) as string[]),
    ]);

    const credenciais = {
      accessToken: data.accessToken ?? null,
      refreshToken: data.refreshToken ?? null,
      tokenExpiresAt: data.expiresIn ? new Date(Date.now() + (data.expiresIn - 60) * 1000) : null,
      clientId,
      clientSecret,
    };

    const livres = lojasDoToken.filter((id) => !ocupados.has(id));

    // ── QUAL LOJA ESTE CÓDIGO ACABOU DE AUTORIZAR ────────────────────────
    //
    // O escopo do token é CUMULATIVO: ele lista tudo o que aquela conta do
    // iFood já autorizou ao app, então sozinho ele não diz qual loja o lojista
    // acabou de conectar. Mas a DIFERENÇA diz. Ele autorizou uma loja no
    // portal e colou o código dela; se o escopo novo tem um merchant que o
    // anterior não tinha, é esse — e vincular direto poupa o lojista de
    // escolher entre UUIDs sem nome, que é impossível de acertar.
    //
    // O escopo anterior é a união do token do User com o de cada integração:
    // quem conecta uma loja por vez tem pedaços do histórico espalhados.
    const tokensAnteriores = [
      user?.ifoodAccessToken,
      ...(await prisma.ifoodIntegration.findMany({
        where: { userId: storeId },
        select: { accessToken: true },
      })).map((i) => i.accessToken),
    ];
    const escopoAnterior = new Set(tokensAnteriores.flatMap((t) => merchantsDoToken(t)));
    const recemAutorizadas = livres.filter((id) => !escopoAnterior.has(id));

    // O que esta conta JÁ tem continua com o token renovado — isso não é
    // escolha nova, é manter viva a loja que ele já usa.
    const jaMinhas = new Set(
      (await prisma.ifoodIntegration.findMany({
        where: { userId: storeId, merchantId: { in: livres } },
        select: { merchantId: true },
      })).map((i) => i.merchantId)
    );
    for (const id of jaMinhas) {
      try {
        await prisma.ifoodIntegration.update({
          where: { userId_merchantId: { userId: storeId, merchantId: id } },
          data: { connected: true, active: true, ...credenciais },
        });
      } catch (e: any) {
        console.warn(`[iFood Auth] Aviso ao renovar credencial de ${id}:`, e?.message);
      }
    }

    const novas = livres.filter((id) => !jaMinhas.has(id));

    // Vincula sozinho em dois casos, e só neles:
    //   1. a loja que ESTE código acabou de autorizar (a diferença de escopo);
    //   2. escopo com uma loja só e a conta ainda vazia — não há o que escolher.
    // Fora disso a lista volta para a tela: o escopo carrega autorizações
    // antigas, e vincular tudo cobraria R$50/mês por loja que ele não pediu.
    const paraVincular =
      recemAutorizadas.length === 1
        ? recemAutorizadas[0]
        : (novas.length === 1 && jaMinhas.size === 0 && !user?.ifoodMerchantId ? novas[0] : null);

    if (paraVincular) {
      try {
        await prisma.ifoodIntegration.upsert({
          where: { userId_merchantId: { userId: storeId, merchantId: paraVincular } },
          create: {
            userId: storeId,
            label: user?.storeName || user?.name || "Loja iFood",
            merchantId: paraVincular,
            connected: true,
            active: true,
            ...credenciais,
          },
          update: { connected: true, active: true, ...credenciais },
        });
        merchantId = user?.ifoodMerchantId || paraVincular;
        if (recemAutorizadas.length === 1) {
          console.log(`[iFood Auth] Loja ${storeId}: ${paraVincular} vinculada — é a que este código autorizou.`);
        }
      } catch (e: any) {
        console.warn("[iFood Auth] Aviso ao vincular a loja do código:", e?.message);
      }
    }

    // ⚠️ O que sobrou NÃO vira lista de UUID para ele escolher.
    //
    // Lista sem nome não adianta: este app não consegue o nome de uma loja que
    // ainda não mandou pedido (o detalhe do merchant volta 403), então seria
    // pedir para o lojista apontar qual é a dele olhando para
    // "ea2c4d55-efd2-4fa7-8aa7-fc1ecd6b8d52" — e errar põe o pedido de uma loja
    // no painel da outra. Quem oferece as que faltam é
    // /api/ifood/integration/escopo, com uma confirmação só e o preço na frente.
    const restantes = novas.filter((id) => id !== paraVincular);
    if (restantes.length > 0) {
      console.log(`[iFood Auth] Loja ${storeId}: ${restantes.length} loja(s) autorizada(s) ainda fora do FireHub.`);
    }

    console.log(
      `[iFood Auth] merchant_scope da loja ${storeId}: ${lojasDoToken.length} no escopo, ` +
      `${jaMinhas.size} já vinculada(s), ${novas.length} disponível(is), ${ocupados.size} de outro dono.`
    );
    if (!merchantId && jaMinhas.size > 0) merchantId = user?.ifoodMerchantId || [...jaMinhas][0];
  }

  // ── DESCOBERTA DO MERCHANT ID ─────────────────────────────────────────
  // NÃO se usa mais GET /merchant/v1.0/merchants. Verificado no portal do
  // desenvolvedor: em Permissões, cada loja deste app tem apenas os módulos
  // **Order** e **Events** autorizados — o módulo *Merchant* não existe aqui.
  // Sem ele aquele endpoint responde `200 []` mesmo com um token impecável, e
  // foi exatamente esse [] que deixou a Pastel da Paulista sem merchant por
  // dias, apesar de a autorização estar Ativa dos dois lados.
  //
  // O merchantId vem, então, de onde ele realmente está: dentro dos eventos.
  // O módulo Events é autorizado, e todo evento carrega o merchantId da loja
  // que o gerou. Espiar a fila NÃO consome nada — sem acknowledgment o iFood
  // mantém tudo lá para o cron processar em seguida.
  if (!merchantId && data.accessToken) {
    try {
      const { descobrirMerchantsPorEventos } = await import("@/lib/ifood-api");
      const encontrados = await descobrirMerchantsPorEventos(data.accessToken);
      console.log(`[iFood Auth] merchants vistos nos eventos: ${encontrados.join(", ") || "nenhum"}`);

      if (encontrados.length > 0) {
        // Descarta o que já pertence a OUTRO dono. Adivinhar aqui foi o que
        // amarrou a Pastel ao merchant da Hakim.
        const jaVinculados = await prisma.user.findMany({
          where: {
            ifoodMerchantId: { in: encontrados },
            ...(userIdAtual ? { NOT: { id: userIdAtual } } : {}),
          },
          select: { ifoodMerchantId: true },
        });
        const ocupados = new Set(jaVinculados.map((u) => u.ifoodMerchantId).filter(Boolean) as string[]);
        const livres = encontrados.filter((id) => !ocupados.has(id));

        if (livres.length === 1) {
          merchantId = livres[0];
          console.log(`[iFood Auth] merchantId descoberto pelos eventos: ${merchantId}`);
        } else if (livres.length > 1) {
          merchantsAmbiguos = livres.map((id) => ({ id, name: "" }));
          console.error(`[iFood Auth] ${livres.length} merchants nos eventos — ambíguo, não vinculando.`);
        } else {
          console.error("[iFood Auth] Todos os merchants dos eventos já pertencem a outra loja.");
        }
      }
    } catch (e: any) {
      console.warn("[iFood Auth] Erro ao descobrir merchant pelos eventos:", e?.message);
    }
  }

  // ⚠️ NÃO reaproveitar o merchantId antigo quando o iFood não devolveu nenhuma
  // loja. Era exatamente isso que mantinha a Pastel da Paulista amarrada ao
  // merchant da Hakim: /merchants respondia [], o código caía aqui e reafirmava
  // o vínculo errado, então a tela mostrava "Ativa" apontando para a loja errada
  // e nenhum pedido chegava. Melhor não vincular e dizer o que houve.
  if (!merchantId && !usouVerifier) {
    console.warn(
      "[iFood Auth] Token obtido SEM verifier e nenhum merchant nos eventos. " +
      "Guardando a conexão; o vínculo se completa no primeiro pedido."
    );
  }

  // Só o merchantId enviado explicitamente no corpo é aceito como alternativa.
  // Herdar `user.ifoodMerchantId` era o que reafirmava o vínculo ERRADO a cada
  // tentativa: a Pastel reconectava e voltava a apontar para o merchant da
  // Hakim, com a tela dizendo "Ativa" e nenhum pedido chegando.
  if (!merchantId && body.merchantId) {
    merchantId = body.merchantId;
  }

  // Se não encontrou merchantId mas tem token, conectar mesmo assim — o merchantId pode ser adicionado depois
  if (!merchantId) {
    if (storeId && data.accessToken) {
      await preservarTokenDasIntegracoes(storeId, {
        accessToken: user?.ifoodAccessToken ?? null,
        refreshToken: user?.ifoodRefreshToken ?? null,
        tokenExpiresAt: user?.ifoodTokenExpiresAt ?? null,
      });
      await prisma.user.update({
        where: { id: storeId },
        data: {
          ifoodConnected: true,
          ifoodAccessToken: data.accessToken,
          ifoodRefreshToken: data.refreshToken || null,
          ifoodTokenExpiresAt: data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null,
        },
      });
    }
    // Quando havia mais de um merchant livre, o sistema NAO escolhe sozinho —
    // adivinhar foi o que vinculou a Pastel da Paulista ao merchant da Hakim.
    // Devolve a lista para o lojista escolher o dele.
    if (merchantsAmbiguos.length > 0) {
      return NextResponse.json({
        success: true,
        merchantId: null,
        needsMerchantId: true,
        merchantsDisponiveis: merchantsAmbiguos,
        message:
          `🎉 Autorizado! Esta conta do iFood tem ${merchantsAmbiguos.length} lojas: ` +
          merchantsAmbiguos.map((m) => `${m.name || "sem nome"} (${m.id})`).join(", ") +
          ". Todas vão entrar no FireHub sozinhas — cada uma aparece aqui assim que chegar o primeiro pedido dela. " +
          "Escolha abaixo qual delas é a loja principal, ou espere: os pedidos não se perdem.",
      });
    }

    return NextResponse.json({
      success: true,
      merchantId: null,
      needsMerchantId: true,
      // Não dá para dizer QUAL loja é: a fila de eventos estava vazia, e o
      // módulo Merchant não é autorizado neste app (responde 200 []). O texto
      // precisa deixar isso claro — antes dizia "não precisa fazer mais nada" e
      // a contagem de integrações não mudava, o que parece falha. Ela entra
      // sozinha no primeiro pedido, mas quem quer ver agora tem o atalho.
      message:
        "🎉 Loja autorizada! Como ela ainda não tem pedido na fila, não dá para " +
        "saber qual das suas lojas é esta — ela aparece aqui sozinha assim que " +
        "chegar o primeiro pedido dela. Para vê-la agora, cole o Merchant ID " +
        "dela (o UUID) neste mesmo campo.",
    });
  }

  // Salvar token e merchantId no banco
  if (storeId && merchantId) {
    const userId = user?.id;
    const isPrimaryAlreadySet = !!user?.ifoodMerchantId;
    const isNewStore = isPrimaryAlreadySet && user.ifoodMerchantId !== merchantId;

    if (userId) {
      // Garantir registro na tabela de integrações
      try {
        // O token e as credenciais ficam gravados NA INTEGRAÇÃO, não só no
        // usuário. Duas razões: numa conta com várias lojas cada uma passa a
        // ter o seu token em vez de todas dividirem um só; e a renovação
        // futura usa o clientId/clientSecret do aplicativo que autorizou esta
        // loja — sem isso, uma loja conectada pelo aplicativo de teste tentaria
        // renovar com as credenciais de produção e receberia recusa.
        const credenciaisDaLoja = {
          accessToken: data.accessToken ?? null,
          refreshToken: data.refreshToken ?? null,
          tokenExpiresAt: data.expiresIn
            ? new Date(Date.now() + (data.expiresIn - 60) * 1000)
            : null,
          clientId,
          clientSecret,
        };

        await prisma.ifoodIntegration.upsert({
          where: { userId_merchantId: { userId, merchantId } },
          create: {
            userId,
            label: merchantName || (isNewStore ? `Loja iFood (${merchantId.slice(0, 6)})` : "Loja Principal"),
            merchantId,
            connected: true,
            active: true,
            ...credenciaisDaLoja,
          },
          update: { connected: true, active: true, ...credenciaisDaLoja },
        });
      } catch (e: any) {
        console.warn("[iFood Auth] Aviso ao salvar integracao:", e?.message);
      }
    }

    // Atualizar usuário principal
    await preservarTokenDasIntegracoes(storeId, {
      accessToken: user?.ifoodAccessToken ?? null,
      refreshToken: user?.ifoodRefreshToken ?? null,
      tokenExpiresAt: user?.ifoodTokenExpiresAt ?? null,
    });
    await prisma.user.update({
      where: { id: storeId },
      data: {
        ifoodConnected: true,
        ifoodMerchantId: isPrimaryAlreadySet && isNewStore ? user.ifoodMerchantId : merchantId,
        ifoodAccessToken: data.accessToken,
        ifoodRefreshToken: data.refreshToken || null,
        ifoodTokenExpiresAt: data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null,
      },
    });

    // As lojas autorizadas que ele ainda NÃO trouxe para o FireHub voltam na
    // resposta para a tela oferecer — sem vincular nada por conta própria, que
    // é o que evita cobrar por loja que ele não quer aqui.
    return NextResponse.json({
      success: true,
      merchantId,
      isAdditional: isNewStore,
      merchantsDisponiveis: merchantsAmbiguos.length > 0 ? merchantsAmbiguos : undefined,
      message: merchantsAmbiguos.length > 0
        ? `🎉 Loja vinculada! Esta conta do iFood tem mais ${merchantsAmbiguos.length} loja(s) autorizada(s). ` +
          `Escolha quais você quer no FireHub — cada uma adicional custa +R$50,00/mês.`
        : isNewStore
          ? "🎉 Nova loja iFood adicional vinculada com sucesso (+R$50,00/mês)!"
          : "🎉 Loja iFood vinculada com sucesso!",
    });
  }

  return NextResponse.json({
    success: true,
    merchantId,
    message: "Autorização concluída! Loja conectada com sucesso.",
  });
}
