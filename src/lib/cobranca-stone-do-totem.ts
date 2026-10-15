/**
 * /src/lib/cobranca-stone-do-totem.ts
 *
 * O que acontece com o pedido do totem (CustomerOrder) quando a cobrança vai
 * pela nuvem da Stone (Connect 2.0). Mesmo desenho do Mercado Pago Point:
 *
 *   - O webhook é GATILHO, nunca prova. Pagamento só vale depois de reconsultar
 *     o pedido na Stone com a chave da PRÓPRIA loja e ver cobrança aprovada
 *     cobrindo o valor (lib/stone-connect.ts › normalizarPedidoStone).
 *   - `gatewayProvider` só é carimbado com pagamento provado: fora daqui esse
 *     campo sozinho já conta como recebido (fechamento de caixa, selo "Pago").
 *   - Todo pedido aberto na Stone tem que ser fechado: "paid" depois da baixa,
 *     "canceled" quando o cliente desiste ou abandona (não expira sozinho e a
 *     POS trava com 30 abertos).
 *
 * A cobrança da MESA segue o mesmo caminho em lib/cobranca-da-mesa-na-maquininha.ts.
 */
import { prisma } from "@/lib/prisma";
import { ESTADOS_DA_COBRANCA } from "@/lib/terminal-app";
import {
  consultarPedidoStone,
  fecharPedidoStone,
  cobrancaAprovada,
  pedidoVivo,
  podeConsultarAgora,
  idadeEmMinutos,
  ehIdDePedidoStone,
  MINUTOS_ATE_ABANDONAR_TOTEM,
  type PedidoStone,
} from "@/lib/stone-connect";
import { credencialStone } from "@/lib/stone-connect-loja";
import { formaDaBaixa, idDaCobrancaDaMesa, processarPedidoStoneDaMesa } from "@/lib/cobranca-da-mesa-na-maquininha";

export const PROVEDOR_STONE = "STONE_CONNECT";

/** Estado no vocabulário que a tela do totem já entende (ESTADOS_DA_COBRANCA). */
export function estadoDoPedidoStone(p: PedidoStone): string {
  if (p.pago) return ESTADOS_DA_COBRANCA.pago;
  if (p.fechado || p.status === "canceled" || p.status === "failed") return ESTADOS_DA_COBRANCA.cancelado;
  if (p.recusado) return ESTADOS_DA_COBRANCA.recusado;
  return ESTADOS_DA_COBRANCA.noTerminal;
}

/** "Cartão Crédito (maquininha)" — mesmo rótulo do caminho do app na maquininha. */
export function formaDoPedido(tipo: unknown): string {
  const forma = formaDaBaixa(tipo);
  return forma === "Pix" ? "Pix (maquininha)" : `Cartão ${forma} (maquininha)`;
}

/**
 * A cobrança deste pedido é da Stone? Vale o cadastro da maquininha em que ela
 * subiu; sem ele, o formato do id ("or_..." é Pagar.me/Stone, "ORD01..." é MP).
 */
export async function cobrancaEhDaStone(
  franchiseeId: string,
  posTerminalId: string | null | undefined,
  posOrderId: string | null | undefined,
): Promise<boolean> {
  if (!posOrderId) return false;
  if (posTerminalId) {
    const t = await prisma.posTerminal.findFirst({
      where: { id: posTerminalId, franchiseeId },
      select: { provider: true },
    });
    if (t) return t.provider === PROVEDOR_STONE;
  }
  return ehIdDePedidoStone(posOrderId);
}

export type EfeitoNoPedido = {
  estado: string;
  pago: boolean;
  /** O pedido da Stone não é deste pedido do FireHub: nada foi gravado. */
  naoConfere?: boolean;
};

/**
 * Aplica no pedido o que a CONSULTA à Stone devolveu. Nunca recebe corpo de
 * webhook — só `PedidoStone` vindo de consultar/fechar com a chave da loja.
 */
export async function aplicarPedidoStoneNoTotem(
  pedidoId: string,
  chave: string,
  ordem: PedidoStone,
): Promise<EfeitoNoPedido> {
  const estado = estadoDoPedidoStone(ordem);

  // A referência que NÓS mandamos tem que ser este pedido. Divergência é
  // posOrderId apontando para a cobrança de outro pedido — dar baixa seria
  // pagar um pedido com o cartão de outro.
  if (ordem.referencia && ordem.referencia !== pedidoId) {
    console.error(
      `[Stone Connect] Pedido Stone ${ordem.id} referencia "${ordem.referencia}", não o pedido ${pedidoId}. Nada foi gravado.`,
    );
    return { estado, pago: false, naoConfere: true };
  }

  const pedido = await prisma.customerOrder.findUnique({
    where: { id: pedidoId },
    select: { id: true, paymentPaidAt: true, posOrderId: true, totalAmount: true },
  });
  if (!pedido) return { estado, pago: false, naoConfere: true };

  if (ordem.pago) {
    const c = cobrancaAprovada(ordem);
    if (pedido.paymentPaidAt && pedido.posOrderId && pedido.posOrderId !== ordem.id) {
      // Dois pedidos Stone pagos para o mesmo pedido: o cliente passou o cartão
      // duas vezes. Não dá para "despagar" pela API (estorno só na POS/portal),
      // então o mínimo é gritar no log para o caixa devolver.
      console.error(
        `[Stone Connect] PAGAMENTO EM DOBRO? Pedido ${pedidoId} já pago (${pedido.posOrderId}) e o pedido Stone ${ordem.id} também foi pago. Estorne na maquininha ou no portal Stone.`,
      );
    } else if (!pedido.paymentPaidAt) {
      const esperado = Math.round((pedido.totalAmount || 0) * 100);
      if (ordem.pagoCentavos !== esperado) {
        console.warn(`[Stone Connect] Pedido ${pedidoId}: esperado ${esperado} centavos, Stone ${ordem.id} pagou ${ordem.pagoCentavos}.`);
      }
      await prisma.customerOrder.update({
        where: { id: pedidoId },
        data: {
          posOrderId: ordem.id,
          posStatus: ESTADOS_DA_COBRANCA.pago,
          gatewayProvider: PROVEDOR_STONE,
          gatewayPaymentId: c?.nsu || c?.id || ordem.id,
          paymentMethod: formaDoPedido(c?.tipo),
          posDadosTransacao: {
            provedor: PROVEDOR_STONE,
            pedidoStone: ordem.id,
            cobranca: c?.id ?? null,
            nsu: c?.nsu ?? null,
            autorizacao: c?.autorizacao ?? null,
            bandeira: c?.bandeira ?? null,
            tipo: c?.tipo ?? null,
            parcelas: c?.parcelas ?? null,
            serial: c?.serial ?? null,
            pagoCentavos: ordem.pagoCentavos,
          } as any,
        },
      });
      const { confirmOrderPayment } = await import("@/lib/order-payment-confirm");
      await confirmOrderPayment(pedidoId);
      console.log(`[Stone Connect] Pedido ${pedidoId} pago na Stone (${ordem.id}) e confirmado.`);

      // Uma cobrança anterior foi a que pagou, mas já tinha outra acesa na POS
      // para o mesmo pedido: derruba a outra, senão o próximo cliente vê na
      // lista um pedido que já está pago.
      if (pedido.posOrderId && pedido.posOrderId !== ordem.id && ehIdDePedidoStone(pedido.posOrderId)) {
        const outra = await cancelarPedidoStone(chave, pedido.posOrderId);
        if (outra.ok && outra.ordem.pago) {
          console.error(
            `[Stone Connect] PAGAMENTO EM DOBRO: pedido ${pedidoId} pago em ${ordem.id} e em ${pedido.posOrderId}. Estorne um na maquininha ou no portal Stone.`,
          );
        }
      }
    }
    // Obrigatório pelos docs: pedido pago e aberto conta nos 30 da POS.
    if (!ordem.fechado) {
      const f = await fecharPedidoStone(chave, ordem.id, "paid");
      if (!f.ok) console.error(`[Stone Connect] Não fechei o pedido pago ${ordem.id}: ${f.erro}`);
    }
    return { estado, pago: true };
  }

  if (pedido.paymentPaidAt && pedido.posOrderId === ordem.id && ordem.cobrancas.some((c) => ["canceled", "refunded"].includes(c.status))) {
    // Estorno feito na POS ou no portal Stone (a API não estorna). A baixa do
    // pedido NÃO é desfeita sozinha: quem estornou cancela o pedido no painel.
    console.warn(`[Stone Connect] Pedido ${pedidoId} estava pago e a cobrança ${ordem.id} foi estornada na Stone. Confira no painel.`);
  }

  // Não pago: só mexe no posStatus se ESTA ainda é a cobrança do pedido — uma
  // cobrança velha não pode apagar o estado da nova. Pedido já pago também não.
  if (!pedido.paymentPaidAt) {
    if (pedido.posOrderId === ordem.id) {
      await prisma.customerOrder.updateMany({
        where: { id: pedidoId, posOrderId: ordem.id, paymentPaidAt: null },
        data: { posStatus: estado },
      });
    } else if (!pedido.posOrderId && pedidoVivo(ordem)) {
      // O POST /orders estourou o tempo mas o pedido nasceu na Stone: adota,
      // senão o próximo start acenderia uma segunda cobrança na POS.
      await prisma.customerOrder.updateMany({
        where: { id: pedidoId, posOrderId: null, paymentPaidAt: null },
        data: { posOrderId: ordem.id, posStatus: estado },
      });
    }
  }
  return { estado, pago: false };
}

/**
 * Derruba da POS o pedido aberto e confere se o cartão não passou no meio
 * (fechar NÃO estorna cobrança aprovada). Devolve o pedido como ficou.
 */
export async function cancelarPedidoStone(
  chave: string,
  id: string,
): Promise<{ ok: true; ordem: PedidoStone } | { ok: false; status: number; erro: string }> {
  const f = await fecharPedidoStone(chave, id, "canceled");
  const depois = await consultarPedidoStone(chave, id);
  if (depois.ok) return { ok: true, ordem: depois.dados };
  if (f.ok) return { ok: true, ordem: f.dados };
  return f;
}

/**
 * Rede de segurança do webhook para a tela do totem (payment-status): reconsulta
 * no máximo a cada 10s e derruba o pedido abandonado na POS.
 */
export async function conferirCobrancaStoneDoTotem(pedido: {
  id: string;
  franchiseeId: string;
  posOrderId: string | null;
}): Promise<void> {
  if (!pedido.posOrderId || !podeConsultarAgora(pedido.posOrderId)) return;
  const cred = await credencialStone(pedido.franchiseeId);
  if (!cred) return;
  const r = await consultarPedidoStone(cred.chave, pedido.posOrderId);
  if (!r.ok) return;
  let ordem = r.dados;
  if (pedidoVivo(ordem) && idadeEmMinutos(ordem) > MINUTOS_ATE_ABANDONAR_TOTEM) {
    const c = await cancelarPedidoStone(cred.chave, ordem.id);
    if (c.ok) ordem = c.ordem;
    if (!ordem.pago) {
      await aplicarPedidoStoneNoTotem(pedido.id, cred.chave, ordem);
      await prisma.customerOrder.updateMany({
        where: { id: pedido.id, posOrderId: ordem.id, paymentPaidAt: null },
        data: { posStatus: ESTADOS_DA_COBRANCA.expirado },
      });
      return;
    }
  }
  await aplicarPedidoStoneNoTotem(pedido.id, cred.chave, ordem);
}

export type RespostaDoProcessamento = { status: number; corpo: Record<string, unknown> };

/**
 * Webhook (ou faxina) de um pedido da Stone. Acha de quem é — pelo id gravado
 * ou, na falta, pela referência que nós mesmos mandamos (`code`) —, reconsulta
 * com a chave DESSA loja e aplica.
 *
 * `referenciaDoCorpo` vem do corpo do webhook e só serve para ACHAR o candidato:
 * a prova é a consulta, feita com a chave da loja do candidato, devolver a
 * mesma referência. Pedido de outra conta Stone nem é encontrado com essa chave.
 */
export async function processarPedidoStone(
  stoneOrderId: string,
  referenciaDoCorpo?: string | null,
): Promise<RespostaDoProcessamento> {
  if (!ehIdDePedidoStone(stoneOrderId)) {
    return { status: 200, corpo: { received: true, ignorado: "id fora do formato or_" } };
  }

  // 1) Mesa (cobrança gravada com este id, ou referência "mesa:<id>").
  const daMesa = await processarPedidoStoneDaMesa(stoneOrderId, idDaCobrancaDaMesa(referenciaDoCorpo));
  if (daMesa) return daMesa;

  // 2) Pedido do totem.
  let pedido = await prisma.customerOrder.findFirst({
    where: { posOrderId: stoneOrderId },
    select: { id: true, franchiseeId: true },
  });
  if (!pedido && referenciaDoCorpo && !idDaCobrancaDaMesa(referenciaDoCorpo)) {
    pedido = await prisma.customerOrder.findUnique({
      where: { id: String(referenciaDoCorpo) },
      select: { id: true, franchiseeId: true },
    });
  }
  if (!pedido) {
    // Venda avulsa na POS (sem pedido criado por nós) também gera webhook. Erro
    // aqui faria a Pagar.me reenviar para sempre; a tela do totem e a faxina
    // cobrem a corrida com o start.
    console.warn(`[Stone Connect] Webhook de ${stoneOrderId} sem pedido/mesa no FireHub — ignorado.`);
    return { status: 200, corpo: { received: true, ignorado: "pedido desconhecido" } };
  }

  const cred = await credencialStone(pedido.franchiseeId);
  if (!cred) {
    return { status: 409, corpo: { error: "Loja sem chave da Stone", code: "STONE_NAO_CONECTADO" } };
  }
  const r = await consultarPedidoStone(cred.chave, stoneOrderId);
  if (!r.ok) {
    // 404 com a chave desta loja = o pedido não é da conta dela. Não reenviar.
    if (r.status === 404) return { status: 200, corpo: { received: true, ignorado: "pedido não é desta conta" } };
    return { status: 502, corpo: { error: r.erro } };
  }
  // Achado só pela referência do corpo: a consulta tem que confirmar a mesma.
  if (r.dados.referencia !== pedido.id && !(await temPosOrderId(pedido.id, stoneOrderId))) {
    console.error(`[Stone Connect] ${stoneOrderId}: referência na Stone "${r.dados.referencia}" ≠ pedido ${pedido.id}.`);
    return { status: 200, corpo: { received: true, ignorado: "referência não confere" } };
  }
  const efeito = await aplicarPedidoStoneNoTotem(pedido.id, cred.chave, r.dados);
  if (efeito.naoConfere) return { status: 409, corpo: { error: "Pedido Stone não confere com o pedido" } };
  return { status: 200, corpo: { received: true, estado: efeito.estado, pago: efeito.pago } };
}

async function temPosOrderId(pedidoId: string, stoneOrderId: string): Promise<boolean> {
  const p = await prisma.customerOrder.findFirst({ where: { id: pedidoId, posOrderId: stoneOrderId }, select: { id: true } });
  return !!p;
}

/**
 * Faxina (cron): pedidos do totem com cobrança Stone ainda "no visor".
 * Confere cada um (o webhook pode ter se perdido) e derruba os abandonados —
 * pedido aberto na Stone não expira e trava a POS em 30.
 */
export async function faxinaDaStoneNoTotem(): Promise<{ conferidos: number }> {
  const candidatos = await prisma.customerOrder.findMany({
    where: {
      posOrderId: { startsWith: "or_" },
      posStatus: { in: [ESTADOS_DA_COBRANCA.noTerminal, ESTADOS_DA_COBRANCA.recusado] },
      paymentPaidAt: null,
      updatedAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60_000) },
    },
    select: { id: true, franchiseeId: true, posOrderId: true, posStatus: true },
    take: 100,
  });
  let conferidos = 0;
  for (const p of candidatos) {
    try {
      if (p.posStatus === ESTADOS_DA_COBRANCA.recusado) {
        // Recusado e ninguém tentou de novo: o pedido segue aberto na POS.
        const cred = await credencialStone(p.franchiseeId);
        if (cred && p.posOrderId) {
          const r = await consultarPedidoStone(cred.chave, p.posOrderId);
          if (r.ok && pedidoVivo(r.dados) && idadeEmMinutos(r.dados) > MINUTOS_ATE_ABANDONAR_TOTEM) {
            const c = await cancelarPedidoStone(cred.chave, p.posOrderId);
            if (c.ok) await aplicarPedidoStoneNoTotem(p.id, cred.chave, c.ordem);
          } else if (r.ok) {
            await aplicarPedidoStoneNoTotem(p.id, cred.chave, r.dados);
          }
        }
      } else {
        await conferirCobrancaStoneDoTotem(p);
      }
      conferidos++;
    } catch (e: any) {
      console.error(`[Stone Connect] faxina do pedido ${p.id}:`, e?.message);
    }
  }
  return { conferidos };
}
