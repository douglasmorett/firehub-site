import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { processarEventosIfood, puxarEventosIfood } from "@/lib/ifood-eventos";
import { merchantsDoToken } from "@/lib/ifood-api";
import { gruposDePollingIfood } from "@/lib/ifood-token";

/**
 * GET /api/cron/ifood-poll
 * Cron Job — runs every minute to poll iFood events.
 * Ensures orders are never missed, even when no dashboard is open.
 * 
 * Protected by CRON_SECRET (bypass para chamadas internas do cron-runner).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30; // Allow up to 30s for processing

/**
 * O nome da loja iFood, lido do detalhe de um pedido dela.
 *
 * É de onde sai "Ragnar Burger". O evento traz só o UUID, e o cadastro do
 * FireHub costuma guardar a razão social ("PIETRO CUNHA ROCHA 0179…") — nenhum
 * dos dois serve para o lojista reconhecer a própria loja numa lista de três.
 */
async function nomeDaLojaNoIfood(eventos: any[], merchantId: string, token: string): Promise<string> {
  const comPedido = eventos.find((e: any) => e?.merchantId === merchantId && e?.orderId);
  if (!comPedido) return "";
  try {
    const det = await fetch(
      `https://merchant-api.ifood.com.br/order/v1.0/orders/${comPedido.orderId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (det.ok) return (await det.json())?.merchant?.name || "";
  } catch {
    // Sem o nome ainda dá para operar — fica o que já estava até o próximo.
  }
  return "";
}

/**
 * Conserta o rótulo de integrações que ficaram com um nome que não identifica
 * a loja.
 *
 * Os caminhos de cadastro manual (colar o Merchant ID) nomeiam a integração com
 * o storeName do FireHub, porque naquele instante não há pedido de onde tirar o
 * nome de verdade. Resultado: três lojas iFood na tela, todas escritas "PIETRO
 * CUNHA ROCHA 01797511238". Aqui, na primeira vez que um pedido daquela loja
 * passa, o nome certo entra no lugar. Roda uma vez por loja: depois de trocado,
 * o rótulo não bate mais com os criterios abaixo.
 */
async function corrigirRotulosIfood(opts: {
  lojaId: string;
  nomeDaLojaFirehub: string | null;
  eventos: any[];
  token: string;
  log: string[];
}): Promise<void> {
  const { lojaId, nomeDaLojaFirehub, eventos, token, log } = opts;

  const integracoes = await prisma.ifoodIntegration.findMany({
    where: { userId: lojaId },
    select: { id: true, label: true, merchantId: true },
  });

  const precisaTrocar = (label: string | null) => {
    const l = (label || "").trim();
    if (!l) return true;
    if (/^loja principal$/i.test(l) || /^loja ifood/i.test(l)) return true;
    // O nome do cadastro do FireHub repetido em toda loja não distingue nada.
    return !!nomeDaLojaFirehub && l === nomeDaLojaFirehub.trim();
  };

  for (const integ of integracoes) {
    if (!precisaTrocar(integ.label)) continue;
    const nome = await nomeDaLojaNoIfood(eventos, integ.merchantId, token);
    if (!nome || nome === integ.label) continue;
    await prisma.ifoodIntegration.update({ where: { id: integ.id }, data: { label: nome } });
    log.push(`[vínculo] rótulo corrigido: ${integ.merchantId} agora é "${nome}"`);
    console.log(`[iFood Cron] Rótulo de ${integ.merchantId} corrigido para "${nome}".`);
  }
}

/**
 * Adota as lojas iFood que apareceram na fila DESTE lojista e não pertencem a
 * ninguém no FireHub.
 *
 * Por que existe: o lojista da Ragnar autorizou três lojas (Ragnar Burguer,
 * Ragnar Pizza e Tadala Burguer) conectando uma por uma. A primeira virou
 * vínculo; da segunda em diante a tela dizia "🎉 Loja conectada!" e nada era
 * gravado — o código só sabia criar vínculo para quem ainda não tinha nenhum.
 * As duas ficaram autorizadas no iFood e inexistentes aqui, sem erro em lugar
 * nenhum. Agora quem manda é o pedido: chegou evento de uma loja que este token
 * enxerga e ninguém reivindicou, ela entra.
 *
 * Não há o que adivinhar sobre a posse: o token saiu da autorização que o
 * próprio lojista deu, no login dele. Só se recusa o merchant que JÁ é de outra
 * conta do FireHub — esse nunca muda de dono por aqui.
 */
async function adotarLojasIfood(opts: {
  lojaId: string;
  nomeDaLoja: string | null;
  candidatos: string[];
  eventos: any[];
  token: string;
  log: string[];
  rotuloDoLog: string;
}): Promise<string[]> {
  const { lojaId, candidatos, eventos, token, log, rotuloDoLog } = opts;

  const donoUser = await prisma.user.findMany({
    where: { ifoodMerchantId: { in: candidatos }, NOT: { id: lojaId } },
    select: { ifoodMerchantId: true },
  });
  const donoInteg = await prisma.ifoodIntegration.findMany({
    where: { merchantId: { in: candidatos }, NOT: { userId: lojaId } },
    select: { merchantId: true },
  });
  const comDono = new Set<string>([
    ...(donoUser.map((u) => u.ifoodMerchantId).filter(Boolean) as string[]),
    ...donoInteg.map((i) => i.merchantId),
  ]);

  const adotados: string[] = [];
  for (const merchantId of candidatos) {
    if (comDono.has(merchantId)) {
      log.push(`[vínculo] ${rotuloDoLog}: ${merchantId} já pertence a outra conta — ignorado`);
      continue;
    }

    // O evento só traz o UUID, e ninguém reconhece a própria loja olhando para
    // "469a9863-…". O nome sai do detalhe de um pedido dela.
    let rotulo = "";
    const comPedido = eventos.find((e: any) => e?.merchantId === merchantId && e?.orderId);
    if (comPedido) {
      try {
        const det = await fetch(
          `https://merchant-api.ifood.com.br/order/v1.0/orders/${comPedido.orderId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (det.ok) rotulo = (await det.json())?.merchant?.name || "";
      } catch {
        // Sem o nome ainda dá para operar — o UUID fica na tela até o próximo.
      }
    }

    await prisma.ifoodIntegration.upsert({
      where: { userId_merchantId: { userId: lojaId, merchantId } },
      create: {
        userId: lojaId,
        label: rotulo || opts.nomeDaLoja || "Loja iFood",
        merchantId,
        connected: true,
        active: true,
      },
      // O nome vindo do pedido vale mais que o que já estava: é como a loja
      // aparece no app do iFood ("Ragnar Burguer"), e não a razão social que o
      // cadastro do FireHub costuma guardar ("PIETRO CUNHA ROCHA 0179…").
      update: { connected: true, active: true, ...(rotulo ? { label: rotulo } : {}) },
    });
    adotados.push(merchantId);
    log.push(`[vínculo] ${rotuloDoLog}: loja iFood "${rotulo || merchantId}" adotada automaticamente`);
    console.log(`[iFood Cron] Loja ${lojaId} adotou o merchant ${merchantId} (${rotulo}).`);
  }
  return adotados;
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const log: string[] = [];

  try {
    const { getIfoodToken } = await import("@/lib/ifood-api");

    // ⚠️ Um tropeço do app CENTRALIZADO não pode abortar a função inteira: a
    // passada distribuída, mais abaixo, é a única fonte de pedidos das lojas
    // que conectam pelo painel (Pastel da Paulista, Brasa Burguer...). Antes
    // havia `return` aqui e logo depois em "0 eventos" — ou seja, no dia a dia
    // normal (fila central vazia) o código NUNCA chegava na parte distribuída.
    let token = "";
    try {
      token = await getIfoodToken();
      log.push("✅ Token obtido");
    } catch (err: any) {
      log.push(`❌ Token central falhou: ${err.message} — seguindo para as lojas distribuídas`);
    }

    // Poll events do app CENTRALIZADO
    let events: any[] = [];
    if (token) {
      const res = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling?excludeHeartbeat=true", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        log.push(`❌ events:polling central falhou: ${res.status} ${res.statusText} — ${errBody.slice(0, 200)}`);
      } else {
        const eventsText = await res.text();
        const lidos = eventsText ? JSON.parse(eventsText) : [];
        events = Array.isArray(lidos) ? lidos : [];
        log.push(`📥 ${events.length} evento(s) recebido(s) no app central`);
      }
    }

    // Processamento do app CENTRALIZADO (comportamento histórico, intacto).
    const central = events.length > 0
      ? await processarEventosIfood({ events, token, log })
      : { created: 0, updated: 0, acknowledged: 0, descartados: 0 };
    const created = central.created;
    const updated = central.updated;

    // ── PASSADA DO APP DISTRIBUÍDO ────────────────────────────────────────
    // Cada loja puxa PELA PRÓPRIA CONEXÃO, como o iFood exige de um app
    // distribuído — e como o dono de cada loja precisa que seja.
    //
    // A versão anterior tentava um "token do app" via client_credentials. Isso
    // nunca poderia funcionar: a API responde
    //   400 Unsupported grant type client_credentials to client cabc4064-…
    // porque o app é do tipo Authorization Code. Agora usa-se o access_token
    // DA LOJA, renovado por refresh_token quando vencido.
    //
    // Duas trancas de isolamento:
    //   1) o token é o DA LOJA — a fila que ele enxerga é a das lojas iFood que
    //      o próprio lojista autorizou, e de mais ninguém;
    //   2) merchantEsperado no processamento — evento de merchant que não é
    //      desta conta é descartado antes de tocar o banco.
    //
    // ⚠️ O header `x-polling-merchants` saiu DE PROPÓSITO. Ele pedia ao iFood
    // apenas o merchant que o FireHub já conhecia — e era isso que tornava a 2ª
    // e a 3ª loja iFood de uma conta invisíveis para sempre: não dá para pedir
    // o que não se sabe que existe. Sem ele, a loja recém-autorizada aparece no
    // primeiro pedido e é adotada logo abaixo. De quebra sumiu o 403 "some
    // polling merchants are not authorized", que derrubava a chamada inteira —
    // e com ela as lojas que funcionavam — por causa de uma só mal cadastrada.
    const distribuido = { lojas: 0, eventos: 0, criados: 0, atualizados: 0, erros: 0 };

    try {
      // Basta TER credencial: token no User (o desenho antigo, de uma loja só,
      // e também a loja recém-autorizada que ainda não tem merchant nenhum) ou
      // token na tabela multi-loja. O recorte antigo exigia `ifoodMerchantId`
      // preenchido, e era ele que deixava de fora justamente quem acabou de
      // autorizar — a loja ficava esperando um vínculo que ninguém ia fazer.
      const lojas = await prisma.user.findMany({
        where: {
          ifoodConnected: true,
          OR: [
            { ifoodAccessToken: { not: null } },
            { ifoodIntegrations: { some: { active: true } } },
          ],
        },
        select: { id: true, storeName: true, email: true, ifoodMerchantId: true },
      });

      log.push(`[distribuído] ${lojas.length} loja(s) com conexão própria`);

      // A rodada agora pode fazer mais de uma chamada por loja (uma por token).
      // Se o tempo apertar, o que sobrou entra na próxima volta, 60s depois —
      // melhor do que a função ser cortada no meio de um pedido pela metade.
      // A fila gira a cada minuto de propósito: varrer sempre na mesma ordem
      // faria as últimas lojas serem as adiadas SEMPRE, e elas nunca receberiam
      // pedido. Girando, quem ficou de fora numa volta começa a próxima.
      const LIMITE_MS = 25_000; // maxDuration é 30s
      let adiadas = 0;
      const giro = lojas.length > 0 ? Math.floor(Date.now() / 60_000) % lojas.length : 0;
      const fila = [...lojas.slice(giro), ...lojas.slice(0, giro)];

      for (const loja of fila) {
        const nome = loja.storeName || loja.email || loja.id;
        if (Date.now() - startTime > LIMITE_MS) {
          adiadas++;
          continue;
        }
        try {
          // Cada grupo é UM token com as lojas iFood que ele enxerga. Quem tem
          // três lojas no mesmo login do iFood sai daqui com um grupo só e uma
          // chamada só; quem conectou cada loja separadamente sai com um grupo
          // por loja, cada um com o token dela.
          const grupos = await gruposDePollingIfood(loja.id);
          if (grupos.length === 0) {
            distribuido.erros++;
            log.push(`[distribuído] ${nome}: sem token utilizável — precisa reconectar`);
            continue;
          }

          distribuido.lojas++;

          // As lojas iFood que já são desta conta.
          let principal = loja.ifoodMerchantId;
          const minhas = new Set<string>(grupos.flatMap((g) => g.merchants));
          if (principal) minhas.add(principal);

          // ⚠️ O `merchant_scope` do token NÃO é usado para vincular sozinho.
          //
          // Ele lista tudo o que aquela conta do iFood já autorizou ao app —
          // e o escopo ACUMULA autorizações antigas. Um lojista com dez lojas
          // no portal que só quer duas no FireHub ganharia as dez, e oito
          // cobranças de R$50/mês que ele nunca pediu. Quem escolhe quais
          // entram é ele, na tela de Integrações.
          //
          // O que entra sozinho aqui é só a loja que MANDOU PEDIDO (logo
          // abaixo): aí não é palpite, e descartar o evento seria jogar fora
          // uma venda que já aconteceu.
          for (const grupo of grupos) {
            const { eventos, erro } = await puxarEventosIfood({
              token: grupo.token,
              merchants: [],
              log,
            });

            if (erro) {
              distribuido.erros++;
              log.push(`[distribuído] ${nome}: polling falhou ${erro}`);
            }
            if (eventos.length === 0) continue;

            // ── ADOÇÃO DA LOJA QUE O LOJISTA AUTORIZOU E NINGUÉM CADASTROU ──
            const desconhecidos = [
              ...new Set(eventos.map((e: any) => e?.merchantId).filter(Boolean) as string[]),
            ].filter((id) => !minhas.has(id));

            if (desconhecidos.length > 0) {
              const adotados = await adotarLojasIfood({
                lojaId: loja.id,
                nomeDaLoja: loja.storeName,
                candidatos: desconhecidos,
                eventos,
                token: grupo.token,
                log,
                rotuloDoLog: nome,
              });
              for (const id of adotados) minhas.add(id);

              // Sem principal ainda: a primeira adotada assume. O campo do User
              // é só o alvo padrão das telas de cardápio/status — quem roteia
              // pedido é o merchantId do evento —, então deixá-lo nulo trava
              // tela à toa.
              if (!principal && adotados[0]) {
                await prisma.user.update({
                  where: { id: loja.id },
                  data: { ifoodMerchantId: adotados[0] },
                });
                principal = adotados[0];
                log.push(`[vínculo] ${nome}: ${adotados[0]} definida como loja principal`);
              }
            }

            // Sem nenhuma loja desta conta na fila, NADA é processado. Sem esta
            // guarda, `merchantEsperado` vazio significaria "aceita tudo" — e a
            // conta importaria pedido de outro dono.
            if (minhas.size === 0) {
              log.push(`[distribuído] ${nome}: fila só com loja(s) de outra conta — nada processado`);
              continue;
            }

            distribuido.eventos += eventos.length;
            log.push(`[distribuído] ${nome}: ${eventos.length} evento(s), ${minhas.size} loja(s) iFood`);

            const r = await processarEventosIfood({
              events: eventos,
              token: grupo.token,
              log,
              merchantEsperado: [...minhas],
            });
            distribuido.criados += r.created;
            distribuido.atualizados += r.updated;

            // Com pedido em mãos dá para trocar "PIETRO CUNHA ROCHA 0179…"
            // pelo nome que a loja tem no app do iFood ("Ragnar Burger").
            await corrigirRotulosIfood({
              lojaId: loja.id,
              nomeDaLojaFirehub: loja.storeName,
              eventos,
              token: grupo.token,
              log,
            });
          }
        } catch (e: any) {
          distribuido.erros++;
          log.push(`[distribuído] ${nome}: erro ${e?.message}`);
        }
      }

      if (adiadas > 0) {
        log.push(`[distribuído] ${adiadas} loja(s) adiada(s) por tempo — entram na próxima rodada`);
      }
    } catch (e: any) {
      distribuido.erros++;
      log.push(`[distribuído] erro geral: ${e.message}`);
      console.error("[iFood Cron distribuído]", e);
    }

    return NextResponse.json({
      ok: true,
      events: events.length,
      created,
      updated,
      acknowledged: central.acknowledged,
      distribuido,
      durationMs: Date.now() - startTime,
      log,
    });
  } catch (err: any) {
    log.push(`❌ Erro geral: ${err.message}`);
    console.error("[iFood Cron] Erro:", err);
    return NextResponse.json({ ok: false, error: err.message, log }, { status: 500 });
  }
}
