/**
 * "Enviar para outra loja" no banco — a regra mora em
 * lib/transferencia-do-pedido.ts.
 *
 * A transferência é uma linha PENDENTE na tabela `TransferenciaDoPedido` (SQL
 * cru criado aqui, como o `AcrescimoDoPedido`). O pedido só muda de loja
 * quando a OUTRA loja aceita: até lá ele continua onde está, com a cozinha e
 * o papel de sempre. Aceitar troca o `franchiseeId`, dá o número do dia da
 * loja nova (fim da fila de lá) e apaga o carimbo de impressão — a fila da
 * nuvem da loja nova imprime a comanda sozinha (api/store/print-queue).
 */
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { generateDailyOrderNumberTx } from "./order-number";
import { empilharEdicao } from "./edicao-de-pedido";
import { lojasDoGrupo } from "./loja-ativa";
import { motivoQueImpede, confirmacaoValida, motivoDaRecusa, notaDaTransferencia, PALAVRA_DE_CONFIRMACAO } from "./transferencia-do-pedido";

// ── A tabela ────────────────────────────────────────────────────────────────

let tabelaOk = false;

export async function garantirTabelaDeTransferencias(): Promise<boolean> {
  if (tabelaOk) return true;
  if (!/^postgres/i.test(String(process.env.DATABASE_URL || ""))) return false;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "TransferenciaDoPedido" (
        "id" TEXT PRIMARY KEY,
        "orderId" TEXT NOT NULL,
        "deLojaId" TEXT NOT NULL,
        "paraLojaId" TEXT NOT NULL,
        "deNome" TEXT,
        "paraNome" TEXT,
        "numeroAntes" TEXT,
        "numeroDepois" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDENTE',
        "pedidoPor" TEXT,
        "respondidoPor" TEXT,
        "motivo" TEXT,
        "vistoPelaOrigem" BOOLEAN NOT NULL DEFAULT FALSE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
        "respondidoEm" TIMESTAMP(3)
      )`);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "TransferenciaDoPedido_para_status" ON "TransferenciaDoPedido" ("paraLojaId", "status")`
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "TransferenciaDoPedido_de" ON "TransferenciaDoPedido" ("deLojaId", "vistoPelaOrigem")`
    );
    tabelaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Transferência] não consegui criar a tabela: ${err?.message}`);
    return false;
  }
}

type Linha = {
  id: string;
  orderId: string;
  deLojaId: string;
  paraLojaId: string;
  deNome: string | null;
  paraNome: string | null;
  numeroAntes: string | null;
  numeroDepois: string | null;
  status: string;
  pedidoPor: string | null;
  respondidoPor: string | null;
  motivo: string | null;
  vistoPelaOrigem: boolean;
  createdAt: Date;
  respondidoEm: Date | null;
};

/** Os campos do pedido que a regra e a tela precisam. */
const CAMPOS_DO_PEDIDO = {
  id: true, franchiseeId: true, status: true, source: true, tableSessionId: true,
  ifoodOrderId: true, openDeliveryOrderId: true, gatewayProvider: true, gatewayPaymentId: true,
  fiscalStatus: true, dailyOrderNumber: true, customerName: true, totalAmount: true,
  deliveryType: true, customerAddress: true, paymentMethod: true, notes: true, editHistory: true,
  items: { select: { productName: true, quantity: true } },
} as const;

const nomeDaLoja = (grupo: { id: string; storeName: string | null }[], id: string) =>
  String(grupo.find((l) => l.id === id)?.storeName || "").trim() || "outra loja";

type Resultado<T = {}> = ({ ok: true } & T) | { ok: false; erro: string; status: number };

// ── Esta loja envia ─────────────────────────────────────────────────────────

export async function pedirTransferencia(o: {
  /** A loja da sessão de quem pede (o grupo sai dela). */
  lojaId: string;
  orderId: string;
  paraLojaId: string;
  confirmacao: unknown;
  quem: string;
}): Promise<Resultado<{ id: string; paraNome: string; repetido: boolean }>> {
  if (!confirmacaoValida(o.confirmacao)) {
    return { ok: false, status: 400, erro: `Para confirmar, escreva "${PALAVRA_DE_CONFIRMACAO}".` };
  }
  if (!(await garantirTabelaDeTransferencias())) return { ok: false, status: 503, erro: "Transferência indisponível agora. Tente de novo." };

  const grupo = await lojasDoGrupo(o.lojaId);
  const ids = grupo.map((l) => l.id);
  const pedido = await prisma.customerOrder.findFirst({ where: { id: o.orderId, franchiseeId: { in: ids } }, select: CAMPOS_DO_PEDIDO });
  const impede = motivoQueImpede(pedido as any, { grupo: ids, para: o.paraLojaId });
  if (impede || !pedido) return { ok: false, status: 409, erro: impede || "Pedido não encontrado." };

  const pendente = await prisma.$queryRaw<Linha[]>`
    SELECT * FROM "TransferenciaDoPedido" WHERE "orderId" = ${pedido.id} AND "status" = 'PENDENTE' LIMIT 1`;
  if (pendente[0]) {
    if (pendente[0].paraLojaId === o.paraLojaId) {
      return { ok: true, id: pendente[0].id, paraNome: pendente[0].paraNome || nomeDaLoja(grupo, o.paraLojaId), repetido: true };
    }
    return { ok: false, status: 409, erro: `Este pedido já foi enviado para ${pendente[0].paraNome || "outra loja"} e espera a resposta de lá. Desfaça antes de mandar para outra.` };
  }

  const id = randomUUID();
  const deNome = nomeDaLoja(grupo, pedido.franchiseeId);
  const paraNome = nomeDaLoja(grupo, o.paraLojaId);
  await prisma.$executeRaw`
    INSERT INTO "TransferenciaDoPedido" ("id","orderId","deLojaId","paraLojaId","deNome","paraNome","numeroAntes","status","pedidoPor")
    VALUES (${id}, ${pedido.id}, ${pedido.franchiseeId}, ${o.paraLojaId}, ${deNome}, ${paraNome},
            ${pedido.dailyOrderNumber != null ? String(pedido.dailyOrderNumber) : null}, 'PENDENTE', ${o.quem})`;
  console.log(`[Transferência] 🏪 Pedido #${pedido.dailyOrderNumber ?? "—"} (${pedido.id}): ${deNome} → ${paraNome}, por ${o.quem}`);
  return { ok: true, id, paraNome, repetido: false };
}

/** Esta loja desiste do envio enquanto a outra não respondeu. */
export async function desfazerTransferencia(o: { id: string; lojaIds: string[]; quem: string }): Promise<Resultado> {
  if (!(await garantirTabelaDeTransferencias())) return { ok: false, status: 503, erro: "Transferência indisponível agora." };
  const linhas = await prisma.$queryRaw<Linha[]>`
    UPDATE "TransferenciaDoPedido"
       SET "status" = 'DESFEITA', "respondidoPor" = ${o.quem}, "respondidoEm" = (NOW() AT TIME ZONE 'UTC'), "vistoPelaOrigem" = TRUE
     WHERE "id" = ${o.id} AND "status" = 'PENDENTE' AND "deLojaId" = ANY(${o.lojaIds}::text[])
     RETURNING *`;
  if (!linhas[0]) return { ok: false, status: 409, erro: "A outra loja já respondeu, ou o envio já foi desfeito." };
  return { ok: true };
}

/** "Entendi" na recusa (ou no aceite) que esta loja recebeu. */
export async function marcarVisto(o: { id: string; lojaIds: string[] }): Promise<void> {
  if (!(await garantirTabelaDeTransferencias())) return;
  await prisma.$executeRaw`
    UPDATE "TransferenciaDoPedido" SET "vistoPelaOrigem" = TRUE
     WHERE "id" = ${o.id} AND "deLojaId" = ANY(${o.lojaIds}::text[])`;
}

// ── A tela ──────────────────────────────────────────────────────────────────

export type TransferenciaParaATela = {
  id: string;
  orderId: string;
  numero: string | null;
  deNome: string;
  paraNome: string;
  pedidoPor: string | null;
  cliente: string | null;
  tipo: string | null;
  endereco: string | null;
  pagamento: string | null;
  total: number;
  itens: string;
  criadoEm: string;
};

export type RespostaParaAOrigem = {
  id: string;
  orderId: string;
  numero: string | null;
  numeroDepois: string | null;
  paraNome: string;
  status: "PENDENTE" | "ACEITA" | "RECUSADA" | "EXPIRADA";
  motivo: string | null;
  respondidoPor: string | null;
};

/**
 * O que as lojas da visão precisam ver: os pedidos que OUTRA loja mandou para
 * cá (o pop-up de aceitar) e a resposta dos que ESTA mandou (esperando,
 * recusado com o motivo, aceito). Pedido que mudou enquanto esperava (saiu,
 * foi cancelado) não pode mais ir: a linha vira EXPIRADA e a origem é avisada.
 */
export async function transferenciasDaVisao(lojaIds: string[]): Promise<{
  paraEstaLoja: TransferenciaParaATela[];
  enviadas: RespostaParaAOrigem[];
}> {
  if (!lojaIds.length || !(await garantirTabelaDeTransferencias())) return { paraEstaLoja: [], enviadas: [] };
  const linhas = await prisma.$queryRaw<Linha[]>`
    SELECT * FROM "TransferenciaDoPedido"
     WHERE ("paraLojaId" = ANY(${lojaIds}::text[]) AND "status" = 'PENDENTE')
        OR ("deLojaId" = ANY(${lojaIds}::text[]) AND "vistoPelaOrigem" = FALSE
            AND "createdAt" > (NOW() AT TIME ZONE 'UTC') - INTERVAL '12 hours')
     ORDER BY "createdAt" ASC
     LIMIT 50`;
  if (!linhas.length) return { paraEstaLoja: [], enviadas: [] };

  const pedidos = await prisma.customerOrder.findMany({
    where: { id: { in: [...new Set(linhas.map((l) => l.orderId))] } },
    select: CAMPOS_DO_PEDIDO,
  });
  const porId = new Map(pedidos.map((p) => [p.id, p]));

  const paraEstaLoja: TransferenciaParaATela[] = [];
  const enviadas: RespostaParaAOrigem[] = [];
  for (const l of linhas) {
    let status = l.status;
    const pedido = porId.get(l.orderId);
    if (status === "PENDENTE") {
      // O pedido saiu, foi cancelado ou já mudou de loja enquanto esperava.
      const impede = !pedido || pedido.franchiseeId !== l.deLojaId
        ? "O pedido não está mais na loja que enviou."
        : motivoQueImpede(pedido as any, { grupo: [l.deLojaId, l.paraLojaId] });
      if (impede) {
        await prisma.$executeRaw`
          UPDATE "TransferenciaDoPedido" SET "status" = 'EXPIRADA', "motivo" = ${impede}, "respondidoEm" = (NOW() AT TIME ZONE 'UTC')
           WHERE "id" = ${l.id} AND "status" = 'PENDENTE'`;
        status = "EXPIRADA";
        l.motivo = impede;
      }
    }
    if (status === "PENDENTE" && lojaIds.includes(l.paraLojaId) && pedido) {
      paraEstaLoja.push({
        id: l.id,
        orderId: l.orderId,
        numero: l.numeroAntes,
        deNome: l.deNome || "outra loja",
        paraNome: l.paraNome || "esta loja",
        pedidoPor: l.pedidoPor,
        cliente: pedido.customerName || null,
        tipo: pedido.deliveryType || null,
        endereco: pedido.customerAddress || null,
        pagamento: pedido.paymentMethod || null,
        total: Number(pedido.totalAmount) || 0,
        itens: (pedido.items || []).map((i) => `${i.quantity}x ${i.productName || "Item"}`).join(", "),
        criadoEm: new Date(l.createdAt).toISOString(),
      });
    }
    if (lojaIds.includes(l.deLojaId) && !l.vistoPelaOrigem && status !== "DESFEITA") {
      enviadas.push({
        id: l.id,
        orderId: l.orderId,
        numero: l.numeroAntes,
        numeroDepois: l.numeroDepois,
        paraNome: l.paraNome || "outra loja",
        status: status as RespostaParaAOrigem["status"],
        motivo: l.motivo,
        respondidoPor: l.respondidoPor,
      });
    }
  }
  return { paraEstaLoja, enviadas };
}

/** A transferência pendente deste pedido, para o painel do Editar. */
export async function transferenciaPendenteDoPedido(orderId: string): Promise<{ id: string; paraNome: string } | null> {
  if (!(await garantirTabelaDeTransferencias())) return null;
  const l = await prisma.$queryRaw<Linha[]>`
    SELECT * FROM "TransferenciaDoPedido" WHERE "orderId" = ${orderId} AND "status" = 'PENDENTE' LIMIT 1`;
  return l[0] ? { id: l[0].id, paraNome: l[0].paraNome || "outra loja" } : null;
}

// ── A outra loja responde ───────────────────────────────────────────────────

export async function responderTransferencia(o: {
  id: string;
  /** As lojas da visão de quem responde: a de destino tem de estar nelas. */
  lojaIds: string[];
  aceitar: boolean;
  motivo?: unknown;
  quem: string;
}): Promise<Resultado<{ numero: number | null; orderId: string }>> {
  if (!(await garantirTabelaDeTransferencias())) return { ok: false, status: 503, erro: "Transferência indisponível agora." };

  if (!o.aceitar) {
    const motivo = motivoDaRecusa(o.motivo);
    if (!motivo) return { ok: false, status: 400, erro: "Escreva o motivo (pelo menos 3 letras). A outra loja vê o que você escreveu." };
    const linhas = await prisma.$queryRaw<Linha[]>`
      UPDATE "TransferenciaDoPedido"
         SET "status" = 'RECUSADA', "motivo" = ${motivo}, "respondidoPor" = ${o.quem}, "respondidoEm" = (NOW() AT TIME ZONE 'UTC')
       WHERE "id" = ${o.id} AND "status" = 'PENDENTE' AND "paraLojaId" = ANY(${o.lojaIds}::text[])
       RETURNING *`;
    if (!linhas[0]) return { ok: false, status: 409, erro: "Esta transferência já foi respondida ou desfeita." };
    console.log(`[Transferência] ❌ ${linhas[0].paraNome} recusou o pedido ${linhas[0].orderId} de ${linhas[0].deNome}: ${motivo}`);
    return { ok: true, numero: null, orderId: linhas[0].orderId };
  }

  // Aceitar: a linha é reservada primeiro (ninguém mais responde a mesma) e o
  // pedido é conferido de novo — ele pode ter saído para entrega no meio.
  const reservada = await prisma.$queryRaw<Linha[]>`
    UPDATE "TransferenciaDoPedido" SET "status" = 'ACEITANDO'
     WHERE "id" = ${o.id} AND "status" = 'PENDENTE' AND "paraLojaId" = ANY(${o.lojaIds}::text[])
     RETURNING *`;
  const l = reservada[0];
  if (!l) return { ok: false, status: 409, erro: "Esta transferência já foi respondida ou desfeita." };
  const devolver = async (status: string, motivo: string | null) => {
    await prisma.$executeRaw`
      UPDATE "TransferenciaDoPedido" SET "status" = ${status}, "motivo" = ${motivo}, "respondidoEm" = (NOW() AT TIME ZONE 'UTC')
       WHERE "id" = ${l.id}`;
  };

  try {
    const pedido = await prisma.customerOrder.findUnique({ where: { id: l.orderId }, select: CAMPOS_DO_PEDIDO });
    const impede = !pedido || pedido.franchiseeId !== l.deLojaId
      ? "O pedido não está mais na loja que enviou."
      : motivoQueImpede(pedido as any, { grupo: [l.deLojaId, l.paraLojaId], para: l.paraLojaId });
    if (impede || !pedido) {
      await devolver("EXPIRADA", impede);
      return { ok: false, status: 409, erro: `Não deu para trazer o pedido: ${impede}` };
    }

    const agora = new Date();
    const numero = await prisma.$transaction(async (tx) => {
      const n = await generateDailyOrderNumberTx(tx as any, l.paraLojaId, agora);
      await tx.customerOrder.update({
        where: { id: pedido.id },
        data: {
          franchiseeId: l.paraLojaId,
          dailyOrderNumber: n,
          // Aceito AQUI agora: entra em produção na cozinha desta loja, do zero.
          status: "ACEITO",
          acceptedAt: agora,
          kdsStage: "PRODUCTION",
          kdsProductionAt: agora,
          kdsStationId: null,
          kdsFinishingAt: null,
          kdsFinishedAt: null,
          kdsTelasProntas: Prisma.DbNull,
          readyAt: null,
          // O papel sai na impressora DESTA loja (a fila lê o pedido sem carimbo).
          printedAt: null,
          // O motoboy e a rota eram da outra loja.
          motoboyId: null,
          motoboyPuxadoEm: null,
          routeId: null,
          notes: [String(pedido.notes || "").trim(), notaDaTransferencia(l.deNome || "", l.pedidoPor || "")].filter(Boolean).join(" · "),
          editHistory: empilharEdicao(pedido.editHistory, {
            quando: agora.toISOString(),
            quem: o.quem,
            acao: "TRANSFERIU",
            descricao: `Pedido #${l.numeroAntes ?? "—"} da loja ${l.deNome || "—"} → #${n} da loja ${l.paraNome || "—"} (enviado por ${l.pedidoPor || "—"}, aceito por ${o.quem})`,
            totalAntes: Number(pedido.totalAmount) || 0,
            totalDepois: Number(pedido.totalAmount) || 0,
          }) as any,
        },
      });
      // A cozinha desta loja faz tudo: nenhum item chega "pronto" da outra.
      await tx.customerOrderItem.updateMany({ where: { orderId: pedido.id }, data: { prontoEm: null } });
      await tx.$executeRaw`
        UPDATE "TransferenciaDoPedido"
           SET "status" = 'ACEITA', "numeroDepois" = ${String(n)}, "respondidoPor" = ${o.quem}, "respondidoEm" = (NOW() AT TIME ZONE 'UTC')
         WHERE "id" = ${l.id}`;
      return n;
    });
    console.log(`[Transferência] ✅ ${l.paraNome} aceitou o pedido ${l.orderId} de ${l.deNome}: agora #${numero}`);
    return { ok: true, numero, orderId: l.orderId };
  } catch (e: any) {
    console.error(`[Transferência] Erro ao aceitar ${l.id}:`, e?.message || e);
    await devolver("PENDENTE", null).catch(() => {});
    return { ok: false, status: 500, erro: "Não consegui trazer o pedido. Tente de novo." };
  }
}
