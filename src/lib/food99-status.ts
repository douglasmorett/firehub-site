import { prisma } from "@/lib/prisma";
import {
  getAuthToken,
  refreshAuthToken,
  confirmarPedido,
  cancelarPedido,
  pedidoPronto,
  pedidoEntregue,
  detalheDoPedido,
} from "@/lib/food99-api";
import { traduzirPedido99Food, itens99ParaPrisma } from "@/lib/food99-pedido";

/**
 * /src/lib/food99-status.ts
 *
 * Leva a mudança de status feita na loja de volta para o 99Food.
 *
 * ── O defeito que isto conserta ─────────────────────────────────────────────
 *
 * O pedido do 99Food é gravado com o id deles em `openDeliveryOrderId` — o
 * MESMO campo que o JotaJá usa. E cinco lugares do sistema liam esse campo
 * como se ele só pudesse significar JotaJá:
 *
 *   customer-order/status      confirm / startPreparation / dispatch / delivered / cancel
 *   kds                        readyToPickup
 *   motoboys/dispatch-whatsapp dispatch
 *   store/routes/dispatch      startPreparation + dispatch
 *   cash-register              a venda entrava como faturamento do JotaJá
 *
 * Resultado prático, no minuto em que o 99Food começar a entregar pedido: a
 * loja aperta "Aceitar" e quem recebe a chamada é o JotaJá, com um id que não é
 * dele. O 99Food não fica sabendo de nada — e pedido não confirmado a tempo é
 * cancelado do lado deles. "Pronto" não chama o entregador do 99, e "Entregue"
 * não fecha o pedido. Ou seja: o pedido entraria na cozinha e morreria ali.
 *
 * Nada disso aparecia em teste porque nenhum pedido do 99Food jamais chegou.
 *
 * ── Por que canal e não presença de campo ───────────────────────────────────
 *
 * `canal99Food()` decide por `openDeliveryChannel`/`source`, nunca por "tem
 * openDeliveryOrderId". Foi essa inferência que criou o problema, e repeti-la
 * ao contrário (mandar tudo para o 99Food) quebraria o JotaJá do mesmo jeito.
 */

/** Pedido do 99Food? Só o canal responde — o id sozinho não distingue. */
export function ehPedido99Food(pedido: {
  source?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryOrderId?: string | null;
}): boolean {
  if (!pedido.openDeliveryOrderId) return false;
  const canal = String(pedido.openDeliveryChannel || "").toUpperCase().trim();
  return canal === "99FOOD" || String(pedido.source || "").toUpperCase().trim() === "99FOOD";
}

/**
 * O token vale semanas (o da Brasa Burguer vence em 24/09). Sem cache, TODA
 * mudança de status pagaria uma ida ao 99Food só para redescobrir o mesmo
 * valor — e a loja movimentada, que muda status o dia inteiro, seria a mais
 * penalizada. O cache expira 24h antes do vencimento (RENOVAR_FALTANDO_MS),
 * e nao 5 minutos antes como ja foi: com a margem curta ele engolia a janela
 * de renovacao inteira, e a renovacao virava uma unica tentativa na ultima
 * hora de vida do token.
 */
const cacheToken = new Map<string, { token: string; expiraEm: number }>();

/** Renova quando falta menos que isto para vencer. Um dia dá folga de sobra. */
const RENOVAR_FALTANDO_MS = 24 * 60 * 60_000;

/**
 * Token de UM identificador, renovando antes de vencer.
 *
 * ── O `refreshAuthToken` era código morto ───────────────────────────────────
 *
 * A função de renovar existe em food99-api.ts desde o começo e não era chamada
 * de lugar nenhum — `grep` no projeto inteiro achava só a definição dela. O
 * token da Brasa Burguer vence em 24/09/2026: naquele dia, com tudo o mais
 * funcionando, a integração pararia sozinha e o sintoma seria idêntico ao de
 * hoje (pedido não entra, ninguém sabe por quê).
 *
 * O iFood não tem esse buraco — `lib/ifood-token.ts` renova sozinho pelo
 * refreshToken. Aqui a renovação passa a acontecer no uso, com um dia de
 * antecedência, que é folga suficiente para uma loja que opera todo dia.
 *
 * O 99Food aceita uma renovação a cada dois minutos e, depois de renovar, o
 * valor novo só aparece consultando de novo — daí a segunda chamada.
 */
async function tokenDeUmId(id: string): Promise<{ auth_token: string; token_expiration_time: number } | null> {
  const r = await getAuthToken(id);
  if (!r.autorizada) return null;

  const venceEm = r.token.token_expiration_time * 1000;
  if (venceEm - RENOVAR_FALTANDO_MS > Date.now()) return r.token;

  console.log(`[99Food] Token de ${id} vence em ${new Date(venceEm).toISOString()} — renovando`);
  const renovou = await refreshAuthToken(id);
  if (!renovou) {
    // Falhou a renovação: devolve o que existe. Um token que ainda não venceu
    // continua servindo, e recusar aqui derrubaria a integração antes da hora.
    console.warn(`[99Food] Renovação recusada para ${id} — seguindo com o token atual`);
    return r.token;
  }

  const novo = await getAuthToken(id);
  return novo.autorizada ? novo.token : r.token;
}

export async function tokenDaLoja(lojaId: string): Promise<string | null> {
  const emCache = cacheToken.get(lojaId);
  // O cache nao pode viver mais que a janela de renovacao, senao ele a engole:
  // com a margem de 5 min, um processo de pe ha semanas devolvia o token do
  // cache ate 5 minutos antes de vencer, e a regra de renovar faltando 24h
  // (RENOVAR_FALTANDO_MS, usada em tokenDeUmId) nunca chegava a rodar. A
  // renovacao passava a depender de um unico tique dar certo na ultima hora --
  // e, falhando, o token vence e o webhook passa a descartar pedido novo.
  // Expirando o cache 24h antes, a renovacao tem um dia inteiro de tentativas.
  if (emCache && emCache.expiraEm - RENOVAR_FALTANDO_MS > Date.now()) return emCache.token;

  const guardar = (t: { auth_token: string; token_expiration_time: number }) => {
    cacheToken.set(lojaId, { token: t.auth_token, expiraEm: t.token_expiration_time * 1000 });
    return t.auth_token;
  };

  const direto = await tokenDeUmId(lojaId);
  if (direto) return guardar(direto);

  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { food99AppId: true },
  });
  if (loja?.food99AppId && loja.food99AppId !== lojaId) {
    const porVinculo = await tokenDeUmId(loja.food99AppId);
    if (porVinculo) return guardar(porVinculo);
  }

  cacheToken.delete(lojaId);
  return null;
}

/**
 * TODOS os tokens da conta — um por loja do 99Food ligada nela.
 *
 * ── Por que uma lista, e não um token ───────────────────────────────────────
 *
 * Cada loja do 99Food tem `auth_token` próprio, e o pedido gravado aqui NÃO
 * guarda de qual delas veio: `CustomerOrder` tem `openDeliveryOrderId`,
 * `openDeliveryReference` e `openDeliveryChannel`, e nenhum sobra para o
 * app_shop_id. Com uma loja por conta isso nunca importou — o token era um só.
 *
 * Com várias, usar o token da loja errada faz o 99Food recusar a confirmação, e
 * o pedido é cancelado por falta dela. Então quem chama tenta os candidatos até
 * a API aceitar, e passa a usar o que funcionou.
 *
 * A ordem importa: o caminho antigo (id da conta / food99AppId) vem PRIMEIRO,
 * porque é ele que atende quem está em produção hoje. Quem tem uma loja só
 * acerta na primeira tentativa, exatamente como antes.
 */
export async function tokensDaConta(lojaId: string): Promise<string[]> {
  const tokens: string[] = [];
  const juntar = (t: string | null) => {
    if (t && !tokens.includes(t)) tokens.push(t);
  };

  juntar(await tokenDaLoja(lojaId));

  const { lojas99DaConta } = await import("@/lib/food99-lojas");
  for (const loja of await lojas99DaConta(lojaId)) {
    if (loja.appShopId === lojaId) continue; // já coberto acima
    const t = await tokenDeUmId(loja.appShopId).catch(() => null);
    juntar(t?.auth_token ?? null);
  }

  return tokens;
}

/**
 * Estados que provam que o FireHub JÁ mandou cada aviso ao 99Food.
 *
 * A conta é assimétrica de propósito: um `confirm` repetido custa uma chamada
 * e uma linha de log; um `confirm` que faltou custa o pedido, porque o 99Food
 * cancela o que não foi confirmado. Então a dúvida sempre resolve a favor de
 * mandar de novo — e dúvida existe de verdade, porque
 * /api/motoboys/dispatch-whatsapp grava SAIU_ENTREGA ANTES de chamar o sync, e
 * ali o estado anterior real se perdeu.
 */
const JA_CONFIRMOU = ["ACEITO", "CONFIRMADO", "PREPARANDO", "EM_PREPARO", "EM_ANDAMENTO", "PRONTO"];
const JA_PASSOU_PELO_READY = ["PRONTO", "SAIU_ENTREGA", "SAIU_PARA_ENTREGA"];

export interface ResultadoSync99 {
  ok: boolean;
  /** Nada a fazer para este status — não é falha. */
  ignorado?: boolean;
  acoes: string[];
  erros: string[];
}

/**
 * Traduz o status do FireHub em chamadas ao 99Food.
 *
 * Mapeamento, e o que cada um custa se não for mandado:
 *
 *   ACEITO/CONFIRMADO → confirm    sem isto o 99Food cancela o pedido sozinho
 *   PRONTO            → ready      é o que chama o entregador do 99
 *   SAIU_ENTREGA      → ready      o 99Food não tem "dispatch"; ready é o
 *                                  último aviso que a loja consegue dar
 *   ENTREGUE          → delivered  SÓ na entrega própria (ver abaixo)
 *   CANCELADO         → cancel     senão o cliente fica esperando
 *
 * `delivered` no pedido que o entregador do 99 leva é erro: quem dá baixa ali
 * é a DiDi. Por isso `deliveryBy` entra na decisão.
 */
export async function sincronizar99Food(
  pedido: {
    openDeliveryOrderId: string;
    franchiseeId: string;
    status: string;
    deliveryBy?: string | null;
  },
  novoStatus: string,
  opts: { motivo?: string; reasonId?: number; limiteMs?: number } = {}
): Promise<ResultadoSync99> {
  const acoes: string[] = [];
  const erros: string[] = [];
  const orderId = pedido.openDeliveryOrderId;

  const precisaAgir = ["ACEITO", "CONFIRMADO", "PRONTO", "SAIU_ENTREGA", "ENTREGUE", "CANCELADO"].includes(
    novoStatus
  );
  if (!precisaAgir) return { ok: true, ignorado: true, acoes, erros };

  // ── Teto de tempo ──────────────────────────────────────────────────────
  //
  // Esta função entrou no caminho do botão "Aceitar" da cozinha, que antes não
  // falava com o 99Food nenhuma vez. Cada chamada lá dentro espera até 15s, e
  // a pior sequência (token + confirm + ready) passaria de um minuto com o
  // 99Food fora do ar — com o atendente olhando para uma tela travada.
  //
  // O prazo é conferido ENTRE as chamadas: a loja segue a operação dela mesmo
  // quando o parceiro está lento, e o que ficou para trás sai no log em vez de
  // sumir. Encerrar o pedido aqui dentro nunca depende do 99Food responder.
  const prazo = Date.now() + (opts.limiteMs ?? 12_000);
  const semTempo = (rotulo: string) => {
    const erro = `${rotulo}: não enviado — 99Food demorou mais que o limite desta operação`;
    erros.push(erro);
    console.warn(`[99Food Sync] ⏱️ ${orderId} ${erro}`);
  };

  // Uma conta pode ter mais de uma loja no 99Food, cada uma com token próprio,
  // e o pedido não guarda de qual delas veio (não há campo). Então tentamos os
  // candidatos até a API aceitar — e o primeiro da lista é o caminho antigo,
  // que é o de quem está em produção hoje. Com uma loja só, acerta de primeira.
  const candidatos = await tokensDaConta(pedido.franchiseeId);
  if (candidatos.length === 0) {
    const erro = `loja ${pedido.franchiseeId} sem autorização válida no 99Food — ${novoStatus} de ${orderId} não foi avisado`;
    console.error(`[99Food Sync] ❌ ${erro}`);
    return { ok: false, acoes, erros: [erro] };
  }
  // Assim que um token funciona, ele vira o único usado no resto desta
  // operação: nada de repetir a busca a cada chamada.
  let token = candidatos[0];

  const executar = async (rotulo: string, fn: (t: string) => Promise<{ errno: number; errmsg: string }>) => {
    if (Date.now() > prazo) return semTempo(rotulo);
    try {
      let r = await fn(token);

      // Token da loja errada: o 99Food recusa porque o pedido não é dessa loja.
      // Só vale tentar outro quando a conta TEM outro — conta de uma loja só
      // nunca entra aqui, e o custo continua sendo uma chamada.
      if (r.errno !== 0 && candidatos.length > 1) {
        for (const outro of candidatos) {
          if (outro === token || Date.now() > prazo) continue;
          const tentativa = await fn(outro);
          if (tentativa.errno === 0) {
            token = outro;
            r = tentativa;
            console.log(`[99Food Sync] token de outra loja da conta aceitou ${rotulo} de ${orderId}`);
            break;
          }
        }
      }

      // errno 0 é sucesso. O resto vira erro registrado em vez de exceção: uma
      // falha de sync não pode impedir a loja de tocar a operação dela.
      if (r.errno === 0) {
        acoes.push(rotulo);
        console.log(`[99Food Sync] ✅ ${rotulo} ${orderId}`);
      } else {
        erros.push(`${rotulo}: ${r.errno} ${r.errmsg}`);
        console.warn(`[99Food Sync] ⚠️ ${rotulo} ${orderId}: ${r.errno} ${r.errmsg}`);
      }
    } catch (err: any) {
      erros.push(`${rotulo}: ${err?.message}`);
      console.warn(`[99Food Sync] ⚠️ ${rotulo} ${orderId}: ${err?.message}`);
    }
  };

  if (novoStatus === "ACEITO" || novoStatus === "CONFIRMADO") {
    await executar("confirm", (t: string) => confirmarPedido(t, orderId));
  }

  if (novoStatus === "PRONTO" || novoStatus === "SAIU_ENTREGA") {
    if (!JA_CONFIRMOU.includes(pedido.status)) {
      await executar("confirm (antes do ready)", (t: string) => confirmarPedido(t, orderId));
    }
    await executar("ready", (t: string) => pedidoPronto(t, orderId));
  }

  if (novoStatus === "ENTREGUE") {
    // A máquina de estados do FireHub permite pular de NOVO direto para
    // ENTREGUE, e em loja cheia isso acontece. Nesse caminho o 99Food nunca
    // recebeu confirm nem ready, e um pedido não confirmado é cancelado do
    // lado deles — a loja entregaria a comida e levaria o cancelamento junto.
    if (!JA_PASSOU_PELO_READY.includes(pedido.status)) {
      if (!JA_CONFIRMOU.includes(pedido.status)) {
        await executar("confirm (atrasado, antes do delivered)", (t: string) => confirmarPedido(t, orderId));
      }
      await executar("ready (atrasado, antes do delivered)", (t: string) => pedidoPronto(t, orderId));
    }

    // "Only used for self-delivery orders" — no pedido que o 99 entrega, a
    // baixa é deles. `deliveryBy` vem do `delivery_type` do próprio pedido.
    if (pedido.deliveryBy === "MERCHANT") {
      await executar("delivered", (t: string) => pedidoEntregue(t, orderId));
    } else {
      console.log(
        `[99Food Sync] ℹ️ ${orderId} é entrega do 99 — 'delivered' não se aplica, quem dá baixa é a DiDi`
      );
    }
  }

  if (novoStatus === "CANCELADO") {
    await executar("cancel", (t: string) => cancelarPedido(t, orderId, opts.motivo, opts.reasonId));
  }

  return { ok: erros.length === 0, acoes, erros };
}

/**
 * Cancelamento PARCIAL: o cliente tirou item, o pedido continua de pé.
 *
 * ── O que estava errado ─────────────────────────────────────────────────────
 *
 * `orderPartialCancel` caía no mesmo `case` do `orderCancel` e virava
 * "CANCELADO". Ou seja: o cliente tirava a batata e o FireHub jogava fora o
 * pedido inteiro — a comanda saía da cozinha, a venda sumia do caixa, e o
 * cliente receberia um cancelamento que ninguém pediu. É o oposto do que o
 * evento significa.
 *
 * ── Por que buscar o pedido de novo ─────────────────────────────────────────
 *
 * O evento diz que mudou, não diz para quanto ficou. O `order/detail` devolve o
 * OrderModel inteiro já sem o que foi cancelado, então ele é a fonte da verdade
 * — melhor do que tentar subtrair no escuro e errar o total que vai para o
 * caixa. Os itens são refeitos a partir dele pelo mesmo tradutor que criou o
 * pedido, para não existirem duas ideias do que é um item do 99Food.
 */
export async function aplicarPedidoAlterado99(
  orderId99: string
): Promise<{ ok: boolean; motivo: string }> {
  const pedido = await prisma.customerOrder.findFirst({
    where: { openDeliveryOrderId: orderId99 },
    select: { id: true, franchiseeId: true, notes: true, status: true },
  });
  if (!pedido) return { ok: false, motivo: `pedido ${orderId99} não existe no FireHub` };

  const token = await tokenDaLoja(pedido.franchiseeId);
  if (!token) return { ok: false, motivo: "loja sem autorização válida no 99Food" };

  const r = await detalheDoPedido(token, orderId99);
  if (r.errno !== 0 || !r.data) {
    return { ok: false, motivo: `order/detail recusou: ${r.errno} ${r.errmsg}` };
  }

  const p = traduzirPedido99Food(r.data);

  // Aviso no topo das observações porque é o que a comanda imprime primeiro. A
  // cozinha pode já ter começado a montar o que foi cancelado.
  const aviso = "⚠️ PEDIDO ALTERADO PELO 99FOOD — confira os itens";
  const notes = pedido.notes?.includes(aviso)
    ? pedido.notes
    : [aviso, p.observacoes || pedido.notes || ""].filter(Boolean).join(" | ");

  await prisma.$transaction([
    prisma.customerOrderItem.deleteMany({ where: { orderId: pedido.id } }),
    (prisma.customerOrder as any).update({
      where: { id: pedido.id },
      data: {
        totalAmount: p.total,
        deliveryFee: p.taxaEntrega,
        notes,
        items: { create: itens99ParaPrisma(p.itens, pedido.franchiseeId) },
      },
    }),
  ]);

  console.log(
    `[99Food] Pedido ${orderId99} alterado: agora ${p.itens.length} item(ns), R$ ${p.total.toFixed(2)}`
  );
  return { ok: true, motivo: `itens refeitos: ${p.itens.length} item(ns), total R$ ${p.total.toFixed(2)}` };
}
