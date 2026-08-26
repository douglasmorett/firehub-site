import { prisma } from "@/lib/prisma";
import {
  getAuthToken,
  confirmarPedido,
  cancelarPedido,
  pedidoPronto,
  pedidoEntregue,
} from "@/lib/food99-api";

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
 * O `auth_token` da loja, tentando os dois identificadores possíveis.
 *
 * O vínculo pode ter nascido sob o nosso próprio id (é o caso da Brasa
 * Burguer) ou sob um app_shop_id escolhido pelo 99Food, que a tela de conexão
 * grava em `food99AppId`. Perguntar só pelo primeiro deixa metade das lojas de
 * fora — é o mesmo cuidado que /api/99food/conectar já tomava.
 */
/**
 * O token vale semanas (o da Brasa Burguer expira em 24/09). Sem cache, TODA
 * mudança de status pagaria uma ida ao 99Food só para redescobrir o mesmo
 * valor — e a loja movimentada, que muda status o dia inteiro, seria a mais
 * penalizada. A margem de 5 min evita usar um token que vence no meio da
 * chamada seguinte.
 */
const cacheToken = new Map<string, { token: string; expiraEm: number }>();
const MARGEM_EXPIRACAO_MS = 5 * 60_000;

export async function tokenDaLoja(lojaId: string): Promise<string | null> {
  const emCache = cacheToken.get(lojaId);
  if (emCache && emCache.expiraEm - MARGEM_EXPIRACAO_MS > Date.now()) return emCache.token;

  const guardar = (t: { auth_token: string; token_expiration_time: number }) => {
    cacheToken.set(lojaId, { token: t.auth_token, expiraEm: t.token_expiration_time * 1000 });
    return t.auth_token;
  };

  const direto = await getAuthToken(lojaId);
  if (direto.autorizada) return guardar(direto.token);

  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { food99AppId: true },
  });
  if (loja?.food99AppId && loja.food99AppId !== lojaId) {
    const porVinculo = await getAuthToken(loja.food99AppId);
    if (porVinculo.autorizada) return guardar(porVinculo.token);
  }

  cacheToken.delete(lojaId);
  return null;
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

  const token = await tokenDaLoja(pedido.franchiseeId);
  if (!token) {
    const erro = `loja ${pedido.franchiseeId} sem autorização válida no 99Food — ${novoStatus} de ${orderId} não foi avisado`;
    console.error(`[99Food Sync] ❌ ${erro}`);
    return { ok: false, acoes, erros: [erro] };
  }

  const executar = async (rotulo: string, fn: () => Promise<{ errno: number; errmsg: string }>) => {
    if (Date.now() > prazo) return semTempo(rotulo);
    try {
      const r = await fn();
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
    await executar("confirm", () => confirmarPedido(token, orderId));
  }

  if (novoStatus === "PRONTO" || novoStatus === "SAIU_ENTREGA") {
    if (!JA_CONFIRMOU.includes(pedido.status)) {
      await executar("confirm (antes do ready)", () => confirmarPedido(token, orderId));
    }
    await executar("ready", () => pedidoPronto(token, orderId));
  }

  if (novoStatus === "ENTREGUE") {
    // A máquina de estados do FireHub permite pular de NOVO direto para
    // ENTREGUE, e em loja cheia isso acontece. Nesse caminho o 99Food nunca
    // recebeu confirm nem ready, e um pedido não confirmado é cancelado do
    // lado deles — a loja entregaria a comida e levaria o cancelamento junto.
    if (!JA_PASSOU_PELO_READY.includes(pedido.status)) {
      if (!JA_CONFIRMOU.includes(pedido.status)) {
        await executar("confirm (atrasado, antes do delivered)", () => confirmarPedido(token, orderId));
      }
      await executar("ready (atrasado, antes do delivered)", () => pedidoPronto(token, orderId));
    }

    // "Only used for self-delivery orders" — no pedido que o 99 entrega, a
    // baixa é deles. `deliveryBy` vem do `delivery_type` do próprio pedido.
    if (pedido.deliveryBy === "MERCHANT") {
      await executar("delivered", () => pedidoEntregue(token, orderId));
    } else {
      console.log(
        `[99Food Sync] ℹ️ ${orderId} é entrega do 99 — 'delivered' não se aplica, quem dá baixa é a DiDi`
      );
    }
  }

  if (novoStatus === "CANCELADO") {
    await executar("cancel", () => cancelarPedido(token, orderId, opts.motivo, opts.reasonId));
  }

  return { ok: erros.length === 0, acoes, erros };
}
