import {
  confirmarPedidoBrendi,
  preparandoBrendi,
  prontoBrendi,
  despacharBrendi,
  entregueBrendi,
  retiradoBrendi,
  solicitarCancelamentoBrendi,
  type ResultadoBrendi,
} from "@/lib/brendi-api";
import { prisma } from "@/lib/prisma";

/**
 * /src/lib/brendi-status.ts
 *
 * Leva a mudança de status feita na loja de volta para a Brendi.
 * Molde de food99-status.ts — mesmo papel, parceiro diferente.
 *
 * ── Por que este arquivo existe antes do primeiro pedido ────────────────────
 *
 * O 99Food ensinou da pior forma: o pedido externo é gravado com o id do
 * parceiro em `openDeliveryOrderId` — o MESMO campo do JotaJá e do 99Food — e
 * todo lugar que decidia "para quem avisar" pela PRESENÇA desse campo mandava
 * o aviso para o parceiro errado. O pedido entrava na cozinha e morria ali:
 * confirm nunca chegava (e originador Open Delivery cancela pedido não
 * confirmado), readyForPickup não chamava o entregador, delivered não fechava
 * nada. Nada disso aparecia em teste porque nenhum pedido do canal novo tinha
 * chegado ainda. Com a Brendi o campo volta a ser compartilhado — então a
 * separação por CANAL nasce junto com a integração, não depois do incidente.
 *
 * ── Regras herdadas do sync do 99Food (pagas caro lá, gratuitas aqui) ───────
 *
 *   1. Falha ao avisar a Brendi vira log/lista, NUNCA exceção — encerrar o
 *      pedido no FireHub jamais depende do parceiro responder.
 *   2. Teto de 12s conferido ENTRE as chamadas: a loja segue a operação dela
 *      mesmo com a Brendi lenta, e o que ficou para trás sai no log.
 *   3. Etapas atrasadas são reenviadas quando a loja pula status: um confirm
 *      repetido custa uma chamada; um confirm que faltou custa a venda.
 *   4. O FECHAMENTO é decidido pelo PEDIDO, não por palpite — ver abaixo.
 *
 * ── Quem fecha o pedido: a resposta vem no payload ──────────────────────────
 *
 * O pedido da Brendi carrega no topo `sendPreparing`, `sendDelivered`,
 * `sendPickedUp` e `sendTracking`: booleanos que dizem, pedido a pedido, quais
 * chamadas a loja deve mandar. Medido no primeiro pedido real da sandbox em
 * 05/09/2026 — numa retirada vieram `sendPreparing: true`, `sendPickedUp:
 * true`, `sendDelivered: false`.
 *
 * Antes disso, o `delivered` era decidido por `deliveryBy === "MERCHANT"`, um
 * palpite tomado sem nenhum dado do parceiro, e o `pickedUp` não existia — o
 * que deixava TODO pedido de retirada aberto para sempre do lado deles, por
 * mais que a loja o finalizasse aqui.
 *
 * As flags são gravadas em `CustomerOrder.brendiSendFlags` quando o pedido
 * entra (processBrendiEvent). Pedido antigo, sem flags, cai no comportamento
 * anterior — que continua valendo como último recurso, nunca como primeira
 * escolha.
 */

/**
 * Pedido da Brendi? Só o CANAL responde — o id sozinho não distingue.
 *
 * `openDeliveryOrderId` é compartilhado por JotaJá, 99Food e Brendi; foi a
 * inferência "tem o id, então é do parceiro X" que quase matou os pedidos do
 * 99Food, e repeti-la aqui (mandar tudo com id para a Brendi) quebraria os
 * outros dois do mesmo jeito. A checagem do id abaixo NÃO decide o canal: ela
 * só corta cedo o pedido que nem TEM id externo — sem id, não existe o que
 * sincronizar em nenhum parceiro.
 */
export function ehPedidoBrendi(pedido: {
  source?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryOrderId?: string | null;
}): boolean {
  if (!pedido.openDeliveryOrderId) return false;
  const canal = String(pedido.openDeliveryChannel || "").toUpperCase().trim();
  return canal === "BRENDI" || String(pedido.source || "").toUpperCase().trim() === "BRENDI";
}

/**
 * Ordem da esteira, do FireHub e da Brendi lado a lado.
 *
 * A dúvida resolve sempre a favor de MANDAR: o status anterior real pode ter
 * se perdido (ex.: dispatch-whatsapp grava SAIU_ENTREGA ANTES de chamar o
 * sync, exatamente como aconteceu no 99Food), e status desconhecido cai no
 * rank 0 — que reenvia a escada inteira. Reenvio repetido é uma chamada e uma
 * linha de log; etapa que faltou é pedido cancelado pelo originador.
 */
const RANK_STATUS: Record<string, number> = {
  NOVO: 0,
  PENDENTE: 0,
  ACEITO: 1,
  CONFIRMADO: 1,
  PREPARANDO: 2,
  EM_PREPARO: 2,
  EM_ANDAMENTO: 2,
  PRONTO: 3,
  SAIU_ENTREGA: 4,
  SAIU_PARA_ENTREGA: 4,
  ENTREGUE: 5,
};

/**
 * Escada de avisos progressivos da Brendi (Open Delivery). `delivered` fica de
 * fora de propósito: ele é condicionado a quem entrega, tratado à parte.
 */
const ESCADA: Array<{
  rank: number;
  rotulo: string;
  enviar: (orderId: string, storeId: string) => Promise<ResultadoBrendi>;
}> = [
  { rank: 1, rotulo: "confirm", enviar: confirmarPedidoBrendi },
  { rank: 2, rotulo: "preparing", enviar: preparandoBrendi },
  { rank: 3, rotulo: "readyForPickup", enviar: prontoBrendi },
  { rank: 4, rotulo: "dispatch", enviar: despacharBrendi },
];

export interface ResultadoSyncBrendi {
  ok: boolean;
  /** Nada a fazer para este status — não é falha. */
  ignorado?: boolean;
  acoes: string[];
  erros: string[];
}

/**
 * Traduz o status do FireHub em chamadas à Brendi.
 *
 * Mapeamento, e o que cada um custa se não for mandado:
 *
 *   ACEITO/CONFIRMADO → confirm         sem isto o originador cancela sozinho
 *   PREPARANDO        → preparing       cliente vê "em preparo" no WhatsApp
 *   PRONTO            → readyForPickup  chama o entregador / avisa retirada
 *   SAIU_ENTREGA      → dispatch        cliente acompanha a saída
 *   ENTREGUE          → pickedUp e/ou delivered, conforme o pedido pedir
 *   CANCELADO         → requestCancellation   senão o cliente fica esperando
 *
 * A Brendi não expõe `/deny`: recusar pedido novo TAMBÉM é requestCancellation
 * com motivo — o wrapper aplica reason default + código 501 quando `motivo`
 * vem vazio, porque motivo cru de tela pode não estar na lista que eles
 * aceitam (pergunta aberta, blueprint §7.9).
 */
export async function sincronizarBrendi(
  pedido: {
    openDeliveryOrderId: string;
    franchiseeId: string;
    status: string;
    deliveryBy?: string | null;
  },
  novoStatus: string,
  opts: { motivo?: string; limiteMs?: number } = {}
): Promise<ResultadoSyncBrendi> {
  const acoes: string[] = [];
  const erros: string[] = [];
  const orderId = pedido.openDeliveryOrderId;
  // brendi-api resolve o dono (ownerId || id) e as credenciais sozinho — daqui
  // só vai o franchiseeId do pedido, que é o que o CustomerOrder guarda.
  const storeId = pedido.franchiseeId;

  // ── Teto de tempo ──────────────────────────────────────────────────────
  //
  // Esta função entra no caminho do botão "Aceitar" da cozinha. Cada chamada à
  // Brendi espera até 15s, e a pior sequência (confirm + preparing + ready +
  // dispatch) passaria de um minuto com o parceiro fora do ar — com o
  // atendente olhando para uma tela travada. O prazo é conferido ENTRE as
  // chamadas: uma chamada já iniciada termina, mas nenhuma nova começa depois
  // do teto, e o que ficou para trás sai no log em vez de sumir.
  const prazo = Date.now() + (opts.limiteMs ?? 12_000);
  const semTempo = (rotulo: string) => {
    const erro = `${rotulo}: não enviado — Brendi demorou mais que o limite desta operação`;
    erros.push(erro);
    console.warn(`[Brendi Sync] ⏱️ ${orderId} ${erro}`);
  };

  // Os wrappers do brendi-api já prometem nunca lançar ({ ok, erro? }), mas o
  // contrato DESTA função é mais forte — falha de sync jamais vira exceção
  // para quem está fechando pedido — então o try/catch fica como cinto de
  // segurança contra qualquer regressão lá dentro.
  const executar = async (rotulo: string, fn: () => Promise<ResultadoBrendi>) => {
    if (Date.now() > prazo) return semTempo(rotulo);
    try {
      const r = await fn();
      if (r.ok) {
        acoes.push(rotulo);
        console.log(`[Brendi Sync] ✅ ${rotulo} ${orderId}`);
      } else {
        erros.push(`${rotulo}: ${r.erro || "falha desconhecida"}`);
        console.warn(`[Brendi Sync] ⚠️ ${rotulo} ${orderId}: ${r.erro}`);
      }
    } catch (err: any) {
      erros.push(`${rotulo}: ${err?.message}`);
      console.warn(`[Brendi Sync] ⚠️ ${rotulo} ${orderId}: ${err?.message}`);
    }
  };

  const alvoNormalizado = String(novoStatus || "").toUpperCase().trim();

  if (alvoNormalizado === "CANCELADO") {
    await executar("requestCancellation", () =>
      solicitarCancelamentoBrendi(orderId, storeId, opts.motivo)
    );
    return { ok: erros.length === 0, acoes, erros };
  }

  const alvo = RANK_STATUS[alvoNormalizado];
  // Status que não fala com a Brendi (ENCERRADO, kds interno, etc.) — não é
  // falha, é "nada a fazer", e quem chama não deve tratar como erro.
  if (alvo === undefined || alvo === 0) return { ok: true, ignorado: true, acoes, erros };

  // Status anterior desconhecido = rank 0 = reenvia tudo (dúvida manda).
  const anterior = RANK_STATUS[String(pedido.status || "").toUpperCase().trim()] ?? 0;

  // As flags do pedido, uma consulta só, usadas na escada e no fechamento.
  const flags = await sendFlagsDoPedido(orderId);

  // No pulo direto para ENTREGUE a escada para no readyForPickup: `dispatch`
  // não entra como etapa atrasada porque pedido de RETIRADA nunca despacha —
  // e o deliveryType não chega até aqui. `dispatch` só sai quando a loja
  // declarou SAIU_ENTREGA explicitamente (aí é entrega, por definição).
  const tetoEscada = alvo === 5 ? 3 : alvo;

  for (const etapa of ESCADA) {
    if (etapa.rank > tetoEscada) break;
    // Etapa já coberta pelo status anterior é pulada — EXCETO a etapa do
    // próprio clique, que é reenviada sempre: é o gesto que o lojista acabou
    // de fazer, e a conta é assimétrica (repetir custa uma chamada; faltar
    // custa o pedido).
    if (etapa.rank <= anterior && etapa.rank !== alvo) continue;
    // O pedido pode dispensar o `preparing` (`sendPreparing: false`). As outras
    // etapas não têm flag correspondente e seguem sempre.
    if (etapa.rotulo === "preparing" && flags && flags.sendPreparing === false) {
      console.log(`[Brendi Sync] ℹ️ ${orderId} não pede 'preparing' (sendPreparing falso) — pulado`);
      continue;
    }
    const atrasada = etapa.rank !== alvo ? " (atrasado)" : "";
    await executar(`${etapa.rotulo}${atrasada}`, () => etapa.enviar(orderId, storeId));
  }

  if (alvo === 5) {
    // ── O FECHAMENTO, decidido pelo PEDIDO ────────────────────────────────
    //
    // `sendPickedUp` fecha a retirada; `sendDelivered` fecha a entrega. Os dois
    // vêm do próprio pedido (ver o cabeçalho deste arquivo). Um pedido pode
    // pedir os dois, um, ou nenhum — quando é a Brendi que entrega, ela mesma
    // dá a baixa e mandar de novo seria baixa dupla.
    if (flags) {
      if (flags.sendPickedUp) await executar("pickedUp", () => retiradoBrendi(orderId, storeId));
      if (flags.sendDelivered) await executar("delivered", () => entregueBrendi(orderId, storeId));
      if (!flags.sendPickedUp && !flags.sendDelivered) {
        console.log(`[Brendi Sync] ℹ️ ${orderId} não pede fechamento nosso (sendPickedUp e sendDelivered falsos) — quem dá baixa é a Brendi`);
      }
    } else if (pedido.deliveryBy === "MERCHANT") {
      // Sem flags (pedido anterior a esta mudança): vale a regra antiga.
      await executar("delivered", () => entregueBrendi(orderId, storeId));
    } else {
      console.log(
        `[Brendi Sync] ℹ️ ${orderId} sem flags e não é entrega própria (deliveryBy=${pedido.deliveryBy ?? "?"}) — 'delivered' não se aplica`
      );
    }
  }

  return { ok: erros.length === 0, acoes, erros };
}

/**
 * As flags `send*` gravadas quando o pedido entrou. `null` quando o pedido é
 * anterior à coluna, ou quando ela ainda não existe neste banco — nos dois
 * casos quem chama volta para a regra antiga em vez de deixar de fechar.
 */
async function sendFlagsDoPedido(
  orderId: string
): Promise<{ sendPickedUp?: boolean; sendDelivered?: boolean; sendPreparing?: boolean } | null> {
  try {
    const linhas = await prisma.$queryRaw<{ brendiSendFlags: any }[]>`
      SELECT "brendiSendFlags" FROM "CustomerOrder"
      WHERE "openDeliveryOrderId" = ${orderId}
      LIMIT 1
    `;
    const f = Array.isArray(linhas) && linhas[0] ? linhas[0].brendiSendFlags : null;
    if (!f || typeof f !== "object") return null;
    // Objeto vazio conta como ausente: nada a obedecer.
    return Object.keys(f).length > 0 ? f : null;
  } catch {
    return null;
  }
}
