/**
 * /src/lib/acrescimo-servidor.ts
 *
 * O caminho do acréscimo em pedido que está na cozinha, de ponta a ponta:
 *
 *   robô do WhatsApp  →  registrarAcrescimo   (pedido PENDENTE)
 *   tela da loja      →  listarAcrescimosPendentes  (aviso "dá tempo?")
 *   loja responde     →  responderAcrescimo   (inclui os itens ou recusa)
 *   cliente           ←  WhatsApp com o resultado
 *
 * A regra (quem pode, textos, contas) mora em lib/acrescimo-do-pedido.ts e é
 * provada por scripts/teste-acrescimo-do-pedido.mjs. Aqui fica o que toca banco,
 * impressora e WhatsApp.
 *
 * Nada aqui lança para quem chama: o robô está no meio de uma conversa e a
 * loja no meio do serviço. Falha vira resultado com motivo.
 */
import { prisma } from "@/lib/prisma";
import { chaveDoCanal, nomeDoCanal } from "@/lib/canal-do-pedido";
import { mesmoTelefone } from "@/lib/telefone";
import { inicioDoExpedienteDaLoja } from "@/lib/fuso";
import { casarItensComCardapio } from "@/lib/itens-do-robo";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import {
  podeAcrescentar,
  subtotalDoAcrescimo,
  centavos,
  reais,
  listaDosItens,
  mensagemAcrescimoAceito,
  mensagemAcrescimoRecusado,
  mensagemAcrescimoExpirado,
  pedidoJaPago,
  type ItemDoAcrescimo,
} from "@/lib/acrescimo-do-pedido";

/** Mesmo `kind` da reimpressão pedida na tela: sai nas impressoras de comanda. */
const KIND_REIMPRESSAO = "REIMPRESSAO";

const SELECT_PEDIDO = {
  id: true,
  franchiseeId: true,
  dailyOrderNumber: true,
  status: true,
  source: true,
  openDeliveryChannel: true,
  openDeliveryOrderId: true,
  openDeliveryReference: true,
  ifoodOrderId: true,
  ifoodReference: true,
  customerName: true,
  customerPhone: true,
  customerAddress: true,
  deliveryType: true,
  deliveryBy: true,
  paymentMethod: true,
  paymentPaidAt: true,
  pagarmeStatus: true,
  totalAmount: true,
  notes: true,
  createdAt: true,
} as const;

export type ResultadoDoRegistro =
  | {
      registrado: true;
      acrescimoId: string;
      numero: number | null;
      itens: ItemDoAcrescimo[];
      subtotal: number;
      /** Já havia um pedido de acréscimo esperando a loja: a lista foi trocada. */
      substituiuPendente: boolean;
    }
  | {
      registrado: false;
      motivo: string;
      /** Frase honesta para trocar o texto da IA, quando ela prometeu algo. */
      mensagemParaOCliente: string;
      chamarAtendente?: boolean;
    };

/** "48" | "#48" | 48 → 48 */
function numeroInformado(bruto: unknown): number | null {
  const n = parseInt(String(bruto ?? "").replace(/\D/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * O robô leva à cozinha o pedido de acréscimo do cliente.
 *
 * O pedido-alvo é sempre DESTE telefone e DESTE expediente: o número que a IA
 * escreveu só escolhe entre eles. Um "#48" alucinado nunca alcança o pedido de
 * outra pessoa.
 */
export async function registrarAcrescimo(e: {
  franchiseeId: string;
  telefone: string;
  remoteJid?: string | null;
  payload: any;
  storeProducts: any[];
  timezone?: string | null;
}): Promise<ResultadoDoRegistro> {
  try {
    const telefone = String(e.telefone || "").replace(/\D/g, "");
    if (telefone.length < 10) {
      return {
        registrado: false,
        motivo: "sem telefone utilizável para achar o pedido",
        mensagemParaOCliente: "Para eu achar o seu pedido, me confirma o número de WhatsApp que você usou nele? 😊",
      };
    }

    const inicio = inicioDoExpedienteDaLoja(e.timezone || "America/Sao_Paulo");
    const doDia = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: e.franchiseeId,
        createdAt: { gte: inicio },
        status: { notIn: ["CRIANDO_IA", "AGUARDANDO_PAGAMENTO", ...STATUS_CANCELADOS] },
      },
      select: SELECT_PEDIDO,
      orderBy: { createdAt: "desc" },
      take: 300,
    });
    const doCliente = doDia.filter((o) => mesmoTelefone(o.customerPhone, telefone));

    const numero = numeroInformado(e.payload?.pedido ?? e.payload?.orderNumber ?? e.payload?.numero);
    const escolhido =
      (numero != null ? doCliente.find((o) => o.dailyOrderNumber === numero) : undefined) ||
      doCliente.find((o) => podeAcrescentar({ status: o.status, canal: chaveDoCanal(o as any) }).pode) ||
      doCliente[0];

    if (!escolhido) {
      return {
        registrado: false,
        motivo: `nenhum pedido deste telefone no expediente (número informado: ${numero ?? "—"})`,
        mensagemParaOCliente:
          "Não encontrei um pedido seu em preparo neste número 🤔 Se quiser, eu anoto esses itens num pedido novo agora mesmo!",
      };
    }

    const rotulo = escolhido.dailyOrderNumber ? `#${escolhido.dailyOrderNumber}` : "";
    const elegibilidade = podeAcrescentar({ status: escolhido.status, canal: chaveDoCanal(escolhido as any) });
    if (!elegibilidade.pode) {
      if (elegibilidade.motivo === "CANAL") {
        const canal = nomeDoCanal(escolhido as any);
        return {
          registrado: false,
          motivo: `pedido ${escolhido.id} é do canal ${canal}: acréscimo só em pedido do site ou do WhatsApp`,
          mensagemParaOCliente:
            `Seu pedido ${rotulo} foi feito pelo ${canal}, e por lá não consigo incluir itens — isso só dá nos pedidos do nosso site ou daqui do WhatsApp. 😕 ` +
            `Se quiser, eu anoto um pedido novo com esses itens, ou chamo a cozinha para ver se consegue te ajudar. O que prefere?`,
        };
      }
      return {
        registrado: false,
        motivo: `pedido ${escolhido.id} em ${escolhido.status}: não aceita mais acréscimo`,
        mensagemParaOCliente:
          `Seu pedido ${rotulo} já saiu da cozinha, então não dá mais para incluir itens nele. 😕 Se quiser, eu anoto esses itens num pedido novo!`,
      };
    }

    const casados = casarItensComCardapio(e.payload?.items || [], e.storeProducts);
    if (casados.length === 0) {
      const pedidos = (e.payload?.items || []).map((i: any) => i?.name).filter(Boolean).join(", ");
      return {
        registrado: false,
        motivo: `nenhum item do acréscimo existe no cardápio (${pedidos || "sem itens"})`,
        mensagemParaOCliente:
          "Não consegui achar esses itens no nosso cardápio 🤔 Me confirma o nome certinho de cada um?",
      };
    }

    const itens: ItemDoAcrescimo[] = casados.map((c) => ({
      menuProductId: c.menuProductId,
      name: c.name,
      quantity: c.quantity,
      price: c.price,
    }));
    const subtotal = subtotalDoAcrescimo(itens);

    // Cliente que manda "e mais uma coca" antes de a loja responder: a IA
    // escreve a lista completa de novo, e ela SUBSTITUI a que está esperando —
    // a cozinha vê um aviso só, com tudo o que o cliente quer.
    const pendente = await prisma.pedidoAcrescimo.findFirst({
      where: { orderId: escolhido.id, status: "PENDENTE" },
      select: { id: true },
    });
    const gravado = pendente
      ? await prisma.pedidoAcrescimo.update({
          where: { id: pendente.id },
          data: { itens: itens as any, subtotal, remoteJid: e.remoteJid || undefined },
          select: { id: true },
        })
      : await prisma.pedidoAcrescimo.create({
          data: {
            franchiseeId: e.franchiseeId,
            orderId: escolhido.id,
            itens: itens as any,
            subtotal,
            remoteJid: e.remoteJid || null,
          },
          select: { id: true },
        });

    console.log(
      `[Acréscimo] ${pendente ? "🔄 atualizado" : "🆕 pedido"} ${gravado.id} no pedido ${escolhido.id} (${rotulo || "sem número"}): ` +
        `${listaDosItens(itens)} = R$ ${reais(subtotal)}`
    );
    return {
      registrado: true,
      acrescimoId: gravado.id,
      numero: escolhido.dailyOrderNumber ?? null,
      itens,
      subtotal,
      substituiuPendente: Boolean(pendente),
    };
  } catch (err: any) {
    console.error("[Acréscimo] falha ao registrar:", err?.message || err);
    return {
      registrado: false,
      motivo: `erro ao registrar: ${err?.message || err}`,
      mensagemParaOCliente:
        "Tive um probleminha para levar o seu pedido de acréscimo até a cozinha agora 😖 Já chamei nossa equipe para confirmar com você por aqui mesmo!",
      chamarAtendente: true,
    };
  }
}

/** O que a tela da loja mostra no aviso. */
export type AcrescimoPendente = {
  id: string;
  orderId: string;
  numero: number | null;
  cliente: string;
  statusDoPedido: string;
  totalDoPedido: number;
  itens: ItemDoAcrescimo[];
  subtotal: number;
  cobrarNaEntrega: boolean;
  criadoEm: string;
};

async function avisarCliente(franchiseeId: string, remoteJid: string | null | undefined, telefone: string | null | undefined, texto: string) {
  const destino = remoteJid || telefone;
  if (!destino) return false;
  try {
    const { sendEvolutionMessage } = await import("@/lib/whatsapp-evolution");
    // O envio devolve `false` quando o gateway recusa, sem lançar: é esse
    // retorno que diz se o cliente ficou sabendo — a tela mostra quando não.
    const foi = await sendEvolutionMessage(franchiseeId, destino, texto);
    if (!foi) console.warn(`[Acréscimo] WhatsApp para o cliente não saiu (gateway recusou).`);
    return foi === true;
  } catch (err: any) {
    console.warn(`[Acréscimo] WhatsApp para o cliente falhou: ${err?.message || err}`);
    return false;
  }
}

/**
 * Pedidos de acréscimo esperando resposta da loja.
 *
 * O pedido que saiu da cozinha antes de alguém responder não fica pendurado na
 * tela: vira EXPIRADO aqui mesmo, e o cliente fica sabendo que não deu tempo —
 * senão ele esperaria uma resposta que não vem mais.
 */
export async function listarAcrescimosPendentes(franchiseeId: string): Promise<AcrescimoPendente[]> {
  const pendentes = await prisma.pedidoAcrescimo.findMany({
    where: { franchiseeId, status: "PENDENTE" },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  if (pendentes.length === 0) return [];

  const pedidos = await prisma.customerOrder.findMany({
    where: { id: { in: pendentes.map((p) => p.orderId) }, franchiseeId },
    select: SELECT_PEDIDO,
  });
  const porId = new Map(pedidos.map((p) => [p.id, p]));

  const vivos: AcrescimoPendente[] = [];
  for (const p of pendentes) {
    const pedido = porId.get(p.orderId);
    const ainda = pedido ? podeAcrescentar({ status: pedido.status, canal: chaveDoCanal(pedido as any) }).pode : false;
    if (!pedido || !ainda) {
      const r = await prisma.pedidoAcrescimo.updateMany({
        where: { id: p.id, status: "PENDENTE" },
        data: { status: "EXPIRADO", respondidoEm: new Date(), motivo: pedido ? `pedido em ${pedido.status}` : "pedido não existe mais" },
      });
      if (r.count === 1 && pedido) {
        await avisarCliente(franchiseeId, p.remoteJid, pedido.customerPhone, mensagemAcrescimoExpirado({ numero: pedido.dailyOrderNumber }));
        console.log(`[Acréscimo] ⌛ ${p.id} expirou: pedido ${pedido.id} já em ${pedido.status}`);
      }
      continue;
    }
    vivos.push({
      id: p.id,
      orderId: p.orderId,
      numero: pedido.dailyOrderNumber ?? null,
      cliente: pedido.customerName || "Cliente",
      statusDoPedido: pedido.status,
      totalDoPedido: Number(pedido.totalAmount) || 0,
      itens: (p.itens as any[]) || [],
      subtotal: p.subtotal,
      cobrarNaEntrega: pedidoJaPago(pedido as any),
      criadoEm: p.createdAt.toISOString(),
    });
  }
  return vivos;
}

export type RespostaDoAcrescimo =
  | { ok: true; status: "ACEITO" | "RECUSADO"; novoTotal?: number; clienteAvisado: boolean; comandaEnfileirada?: boolean }
  | { ok: false; erro: string; codigo: "NAO_ENCONTRADO" | "JA_RESPONDIDO" | "PEDIDO_SAIU" | "FALHOU" };

class JaRespondido extends Error {}

export async function responderAcrescimo(e: {
  franchiseeId: string;
  acrescimoId: string;
  decisao: "ACEITAR" | "RECUSAR";
  motivo?: string | null;
  respondidoPor?: string | null;
}): Promise<RespostaDoAcrescimo> {
  try {
    const acrescimo = await prisma.pedidoAcrescimo.findFirst({
      where: { id: e.acrescimoId, franchiseeId: e.franchiseeId },
    });
    if (!acrescimo) return { ok: false, erro: "Pedido de acréscimo não encontrado.", codigo: "NAO_ENCONTRADO" };
    if (acrescimo.status !== "PENDENTE") {
      return { ok: false, erro: "Este acréscimo já foi respondido.", codigo: "JA_RESPONDIDO" };
    }

    const pedido = await prisma.customerOrder.findFirst({
      where: { id: acrescimo.orderId, franchiseeId: e.franchiseeId },
      select: SELECT_PEDIDO,
    });
    const motivo = String(e.motivo || "").trim().slice(0, 300) || null;
    const itens = ((acrescimo.itens as any[]) || []) as ItemDoAcrescimo[];

    if (e.decisao === "RECUSAR") {
      const r = await prisma.pedidoAcrescimo.updateMany({
        where: { id: acrescimo.id, status: "PENDENTE" },
        data: { status: "RECUSADO", motivo, respondidoPor: e.respondidoPor || null, respondidoEm: new Date() },
      });
      if (r.count === 0) return { ok: false, erro: "Este acréscimo já foi respondido.", codigo: "JA_RESPONDIDO" };
      const avisado = await avisarCliente(
        e.franchiseeId, acrescimo.remoteJid, pedido?.customerPhone,
        mensagemAcrescimoRecusado({ numero: pedido?.dailyOrderNumber, motivo })
      );
      console.log(`[Acréscimo] ❌ ${acrescimo.id} recusado por ${e.respondidoPor || "loja"}${motivo ? `: ${motivo}` : ""}`);
      return { ok: true, status: "RECUSADO", clienteAvisado: avisado };
    }

    // ── ACEITAR ─────────────────────────────────────────────────────────────
    if (!pedido || !podeAcrescentar({ status: pedido.status, canal: chaveDoCanal(pedido as any) }).pode) {
      const r = await prisma.pedidoAcrescimo.updateMany({
        where: { id: acrescimo.id, status: "PENDENTE" },
        data: { status: "EXPIRADO", respondidoPor: e.respondidoPor || null, respondidoEm: new Date(), motivo: pedido ? `pedido em ${pedido.status}` : "pedido não existe mais" },
      });
      if (r.count === 1 && pedido) {
        await avisarCliente(e.franchiseeId, acrescimo.remoteJid, pedido.customerPhone, mensagemAcrescimoExpirado({ numero: pedido.dailyOrderNumber }));
      }
      return { ok: false, erro: "O pedido já saiu da cozinha — o cliente foi avisado de que não deu tempo.", codigo: "PEDIDO_SAIU" };
    }

    const jaPago = pedidoJaPago(pedido as any);
    const subtotal = subtotalDoAcrescimo(itens);
    const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date());
    const linhaDaNota =
      `➕ Acréscimo pelo WhatsApp (${hora}): ${listaDosItens(itens)}` +
      (jaPago ? ` — cobrar R$ ${reais(subtotal)} na entrega` : "");

    // Tudo ou nada, e a resposta da loja é a trava: o segundo clique (ou a
    // segunda tela aberta) casa zero linhas e não inclui os itens em dobro.
    let novoTotal = 0;
    let idsDosItens: string[] = [];
    await prisma.$transaction(async (tx) => {
      const r = await tx.pedidoAcrescimo.updateMany({
        where: { id: acrescimo.id, status: "PENDENTE" },
        data: { status: "ACEITO", respondidoPor: e.respondidoPor || null, respondidoEm: new Date() },
      });
      if (r.count === 0) throw new JaRespondido();

      const criados = [];
      for (const i of itens) {
        criados.push(
          await tx.customerOrderItem.create({
            data: {
              orderId: pedido.id,
              menuProductId: i.menuProductId || null,
              productName: i.name,
              quantity: i.quantity,
              price: i.price,
              notes: "➕ ACRÉSCIMO (WhatsApp)",
            },
            select: { id: true },
          })
        );
      }
      idsDosItens = criados.map((c) => c.id);

      const atual = await tx.customerOrder.findUnique({ where: { id: pedido.id }, select: { totalAmount: true, notes: true } });
      novoTotal = centavos((Number(atual?.totalAmount) || 0) + subtotal);
      await tx.customerOrder.update({
        where: { id: pedido.id },
        data: {
          totalAmount: novoTotal,
          notes: [atual?.notes, linhaDaNota].filter(Boolean).join("\n"),
        },
      });
    });

    // A cozinha precisa ver o que entrou: a comanda do acréscimo sai nas
    // mesmas impressoras de comanda do pedido (a reimpressão já faz isso), só
    // com os itens novos e o aviso no topo. Falhar aqui não desfaz o aceite —
    // os itens já estão no pedido, no KDS e na tela.
    let comandaEnfileirada = false;
    try {
      const novos = await prisma.customerOrderItem.findMany({
        where: { id: { in: idsDosItens } },
        include: { menuProduct: true },
      });
      const { franchiseeId: _loja, notes: _notas, ...cabecalho } = pedido as any;
      await prisma.printRequest.create({
        data: {
          franchiseeId: e.franchiseeId,
          kind: KIND_REIMPRESSAO,
          requestedBy: e.respondidoPor || "acrescimo-whatsapp",
          payload: {
            ...cabecalho,
            createdAt: pedido.createdAt.toISOString(),
            paymentPaidAt: undefined,
            items: novos,
            // O Assistente distribui o preço dos itens pelo total: aqui o total
            // é o do acréscimo, para a comanda não somar o pedido antigo de novo.
            totalAmount: subtotal,
            deliveryFee: 0,
            discountTotal: 0,
            notes:
              `*** ACRESCIMO DO PEDIDO ${pedido.dailyOrderNumber ? "#" + pedido.dailyOrderNumber : ""} *** ` +
              `Juntar com o pedido que ja esta na cozinha. Novo total do pedido: R$ ${reais(novoTotal)}` +
              (jaPago ? ` (cobrar R$ ${reais(subtotal)} na entrega)` : ""),
          } as any,
        },
      });
      comandaEnfileirada = true;
    } catch (err: any) {
      console.warn(`[Acréscimo] comanda do acréscimo não enfileirada: ${err?.message || err}`);
    }

    const avisado = await avisarCliente(
      e.franchiseeId, acrescimo.remoteJid, pedido.customerPhone,
      mensagemAcrescimoAceito({ numero: pedido.dailyOrderNumber, itens, novoTotal, cobrarDiferencaNaEntrega: jaPago })
    );
    console.log(`[Acréscimo] ✅ ${acrescimo.id} aceito por ${e.respondidoPor || "loja"}: pedido ${pedido.id} agora R$ ${reais(novoTotal)}`);
    return { ok: true, status: "ACEITO", novoTotal, clienteAvisado: avisado, comandaEnfileirada };
  } catch (err: any) {
    if (err instanceof JaRespondido) return { ok: false, erro: "Este acréscimo já foi respondido.", codigo: "JA_RESPONDIDO" };
    console.error("[Acréscimo] falha ao responder:", err?.message || err);
    return { ok: false, erro: "Não consegui registrar a resposta. Tente de novo.", codigo: "FALHOU" };
  }
}

/**
 * O que o robô precisa saber, no prompt, sobre os acréscimos deste cliente
 * hoje — para responder "e aí, deu?" sem inventar.
 */
export async function acrescimosDoPedidoParaOPrompt(orderId: string): Promise<string> {
  try {
    const lista = await prisma.pedidoAcrescimo.findMany({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { status: true, itens: true, subtotal: true, motivo: true, createdAt: true },
    });
    if (lista.length === 0) return "";
    const hora = (d: Date) =>
      new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(d);
    const nomeDoStatus: Record<string, string> = {
      PENDENTE: "AGUARDANDO A COZINHA RESPONDER",
      ACEITO: "ACEITO pela cozinha (itens já incluídos no pedido)",
      RECUSADO: "RECUSADO pela cozinha",
      EXPIRADO: "NÃO DEU TEMPO (o pedido saiu antes da resposta)",
    };
    return lista
      .map((a) => {
        const itens = listaDosItens(((a.itens as any[]) || []) as ItemDoAcrescimo[]);
        const motivo = a.status === "RECUSADO" && a.motivo ? ` — motivo: ${a.motivo}` : "";
        return `  - Acréscimo pedido às ${hora(a.createdAt)}: ${itens} → ${nomeDoStatus[a.status] || a.status}${motivo}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}
