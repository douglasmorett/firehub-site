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
import { getIfoodToken } from "@/lib/ifood-api";
import { appEscolhido, credenciaisDoApp, ErroCredencialApp } from "@/lib/ifood-app";
import { prisma } from "@/lib/prisma";

const IFOOD_BASE = "https://merchant-api.ifood.com.br";

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
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, ifoodMerchantId: true, ifoodConnected: true, ifoodAccessToken: true }
    });

    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

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

      // Tentativa 2: Peek events para encontrar merchantIds desconhecidos
      if (!discoveredMerchantId) {
        try {
          const evRes = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (evRes.ok) {
            const evText = await evRes.text();
            const events = evText ? JSON.parse(evText) : [];
            log.push(`${events.length} eventos na fila`);
            
            const uniqueMerchantIds = [...new Set(events.map((e: any) => e.merchantId).filter(Boolean))] as string[];
            for (const mid of uniqueMerchantIds) {
              const existing = await prisma.user.findFirst({ where: { ifoodMerchantId: mid } as any });
              if (!existing) {
                discoveredMerchantId = mid;
                log.push(`✅ merchantId descoberto via eventos: ${mid}`);
                break;
              }
            }

            // Ack os eventos para não perder — eles serão reprocessados pelo cron
            // NÃO ack, deixar o cron processar
          } else {
            log.push(`events:polling falhou: ${evRes.status}`);
          }
        } catch (e: any) {
          log.push(`events peek erro: ${e.message}`);
        }
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
        where: { email },
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

              const { getIfoodItemUnitPrice } = await import("@/lib/ifood-api");
              const { generateDailyOrderNumber } = await import("@/lib/order-number");
              const { parseOrderPaymentInfo } = await import("@/lib/payment-parser");

              const items = (orderData.items || []).map((i: any) => ({
                price: getIfoodItemUnitPrice(i),
                quantity: i.quantity ?? 1,
                comboSelections: (i.options || i.subItems || []).length > 0
                  ? JSON.stringify((i.options || i.subItems || []).map((s: any) => ({ name: s.name || "", quantity: s.quantity || 1, price: s.price || s.unitPrice || 0 })))
                  : null,
                menuProduct: {
                  connectOrCreate: {
                    where: { id: `ifood-${i.id || i.externalCode || "item"}` } as any,
                    create: { id: `ifood-${i.id || i.externalCode || "item"}`, franchiseeId: user.id, name: i.name || "Item iFood", description: "", price: getIfoodItemUnitPrice(i), category: "iFood", active: false } as any,
                  } as any,
                },
              }));

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
    const usuario = await prisma.user.update({
      where: { email },
      data: {
        ifoodConnected: false,
        ifoodMerchantId: null,
        ifoodAccessToken: null,
        ifoodRefreshToken: null,
        ifoodTokenExpiresAt: null,
        ifoodAuthVerifier: null,
      },
      select: { id: true },
    });

    const removidas = await prisma.ifoodIntegration.deleteMany({
      where: { userId: usuario.id },
    });

    console.log(`[iFood Auth] Loja ${usuario.id} desconectada. Integrações removidas: ${removidas.count}`);

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

  // Se o usuário digitou diretamente um Merchant UUID (formato 8-4-4-4-12)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCode);
  if (isUuid && session.user?.email) {
    const userRec = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, name: true, storeName: true }
    });
    if (userRec) {
      await prisma.user.update({
        where: { email: session.user.email },
        data: {
          ifoodConnected: true,
          ifoodMerchantId: rawCode,
        },
      });
      try {
        await prisma.ifoodIntegration.upsert({
          where: { userId_merchantId: { userId: userRec.id, merchantId: rawCode } },
          create: {
            userId: userRec.id,
            label: userRec.storeName || userRec.name || "Loja Principal",
            merchantId: rawCode,
            connected: true,
            active: true,
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

  const user = session.user?.email ? await prisma.user.findUnique({ where: { email: session.user.email } }) : null;
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

  // Usuario logado, necessario para descartar merchants de OUTRAS lojas.
  const usuarioAtual = session.user?.email
    ? await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } })
    : null;
  const userIdAtual = usuarioAtual?.id || null;

  // Tentar extrair do JWT caso o iFood embute claims
  if (!merchantId && data.accessToken) {
    try {
      const parts = data.accessToken.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
        merchantId = payload.merchantId || payload.merchant_id || (Array.isArray(payload.merchants) ? payload.merchants[0] : null);
      }
    } catch {}
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
    if (session.user?.email && data.accessToken) {
      await prisma.user.update({
        where: { email: session.user.email },
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
          `🎉 Loja conectada! Foram encontradas ${merchantsAmbiguos.length} lojas nesta autorização: ` +
          merchantsAmbiguos.map((m) => `${m.name || "sem nome"} (${m.id})`).join(", ") +
          ". Cole na seção 'iFood Merchant API' o Merchant ID da SUA loja — não escolhemos automaticamente para não vincular a loja errada.",
      });
    }

    return NextResponse.json({
      success: true,
      merchantId: null,
      needsMerchantId: true,
      message:
        "🎉 Loja iFood conectada! A identificação da loja é concluída automaticamente " +
        "assim que chegar o primeiro pedido — não precisa fazer mais nada.",
    });
  }

  // Salvar token e merchantId no banco
  if (session.user?.email && merchantId) {
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
    await prisma.user.update({
      where: { email: session.user.email },
      data: {
        ifoodConnected: true,
        ifoodMerchantId: isPrimaryAlreadySet && isNewStore ? user.ifoodMerchantId : merchantId,
        ifoodAccessToken: data.accessToken,
        ifoodRefreshToken: data.refreshToken || null,
        ifoodTokenExpiresAt: data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null,
      },
    });

    return NextResponse.json({
      success: true,
      merchantId,
      isAdditional: isNewStore,
      message: isNewStore
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
