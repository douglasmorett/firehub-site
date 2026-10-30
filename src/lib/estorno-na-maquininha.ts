import { prisma } from "@/lib/prisma";
import {
  appFazEstorno,
  dadosDoEstorno,
  ehFinal,
  ENTREGAS_ATE_DESISTIR,
  estornoAutomatico,
  MINUTOS_ATE_DESTRAVAR_O_ESTORNO,
  PREFIXO_DO_ESTORNO,
  proximaSituacao,
  SITUACOES_DO_ESTORNO as S,
  type EstornoNoPainel,
  type RespostaDoApp,
} from "@/lib/estorno-na-maquininha-regras";

/**
 * Estorno automático do pedido do totem pago na maquininha Cielo, quando o
 * lojista cancela no painel (regra pura em lib/estorno-na-maquininha-regras.ts).
 *
 * O caminho é o da cobrança, ao contrário: o cancelamento cria o estorno
 * endereçado à MESMA maquininha que cobrou; o app do totem leva na consulta
 * da fila (GET /api/pos/terminal/pendente, campo `estorno`), abre o
 * lio://payment-reversal e devolve o resultado em POST /api/pos/terminal/estorno.
 *
 * Uma linha por pedido (índice único em orderId): cancelar duas vezes, ou o
 * painel repetir o PUT, não abre dois estornos. Tabela criada no 1º uso
 * (schema.prisma não muda), como a da entrega.
 */

export type EstornoNaMaquininha = {
  id: string;
  franchiseeId: string;
  orderId: string;
  terminalId: string;
  terminalLabel: string | null;
  valorCentavos: number;
  status: string;
  entregas: number;
  dados: any;
  criadoEm: Date;
  atualizadoEm: Date;
};

let pronta: Promise<void> | null = null;

function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "EstornoNaMaquininha" (
          "id"            TEXT PRIMARY KEY,
          "franchiseeId"  TEXT NOT NULL,
          "orderId"       TEXT NOT NULL,
          "terminalId"    TEXT NOT NULL,
          "terminalLabel" TEXT,
          "valorCentavos" INT NOT NULL,
          "status"        TEXT NOT NULL,
          "entregas"      INT NOT NULL DEFAULT 0,
          "dados"         JSONB,
          "criadoEm"      TIMESTAMPTZ NOT NULL DEFAULT now(),
          "atualizadoEm"  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "EstornoNaMaquininha_um_por_pedido" ON "EstornoNaMaquininha" ("orderId")`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "EstornoNaMaquininha_fila" ON "EstornoNaMaquininha" ("terminalId","status","criadoEm")`,
      );
    })().catch((e) => {
      pronta = null;
      throw e;
    });
  }
  return pronta;
}

function linha(l: any): EstornoNaMaquininha {
  return { ...l, valorCentavos: Number(l.valorCentavos), entregas: Number(l.entregas) };
}

export function idDoEstorno(pedidoId: unknown): string | null {
  if (typeof pedidoId !== "string" || !pedidoId.startsWith(PREFIXO_DO_ESTORNO)) return null;
  return pedidoId.slice(PREFIXO_DO_ESTORNO.length).trim() || null;
}

/** O pedido mudou para o painel: o feed em modo `desde` só manda o que tem updatedAt novo. */
async function avisarOPainel(orderId: string) {
  await prisma.customerOrder.update({ where: { id: orderId }, data: { updatedAt: new Date() } }).catch(() => {});
}

/**
 * O lojista cancelou um pedido. Se foi pago na maquininha Cielo, o estorno vai
 * para a fila daquela maquininha. Devolve o que o painel mostra, ou null quando
 * o pedido não tem estorno automático (outras adquirentes: aviso manual).
 *
 * Faltando o código da venda ou a maquininha, o estorno nasce RECUSADO com o
 * motivo: o card diz "faça na maquininha" em vez de prometer o que não vai sair.
 */
export async function pedirEstornoAoCancelar(orderId: string): Promise<EstornoNoPainel | null> {
  const pedido = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, franchiseeId: true, gatewayProvider: true, paymentPaidAt: true, paymentMethod: true,
      posTerminalId: true, posDadosTransacao: true, totalAmount: true,
    },
  });
  if (!pedido || !estornoAutomatico(pedido)) return null;
  await garantirTabela();

  const terminal = pedido.posTerminalId
    ? await prisma.posTerminal.findUnique({ where: { id: pedido.posTerminalId }, select: { id: true, label: true, franchiseeId: true, appVersion: true } })
    : null;
  const lido = dadosDoEstorno(pedido.posDadosTransacao, pedido.totalAmount);
  const motivo = !terminal || terminal.franchiseeId !== pedido.franchiseeId
    ? "não achei a maquininha que cobrou"
    : !appFazEstorno(terminal.appVersion)
      ? `o app da maquininha está na versão ${terminal.appVersion || "antiga"} e só a 1.0.6 em diante estorna sozinho`
      : lido.ok ? null : lido.motivo;
  const status = motivo ? S.recusado : S.aguardando;
  const dados = JSON.stringify(lido.ok ? { ...lido.dados, motivo } : { motivo });
  const id = `est_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  // Já existe um estorno deste pedido: fica o que está (idempotente). Só o
  // desistido (pedido reaberto antes de a maquininha pegar) volta a valer.
  const r = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "EstornoNaMaquininha" ("id","franchiseeId","orderId","terminalId","terminalLabel","valorCentavos","status","dados")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT ("orderId") DO UPDATE SET "status" = EXCLUDED."status", "dados" = EXCLUDED."dados",
       "entregas" = 0, "atualizadoEm" = now()
     WHERE "EstornoNaMaquininha"."status" = $9
     RETURNING *`,
    id, pedido.franchiseeId, orderId, terminal?.id ?? "", terminal?.label ?? null,
    lido.ok ? lido.dados.valorCentavos : Math.round((pedido.totalAmount || 0) * 100), status, dados, S.cancelado,
  );
  const e = r[0]
    ? linha(r[0])
    : (await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "EstornoNaMaquininha" WHERE "orderId" = $1`, orderId)).map(linha)[0];
  if (!e) return null;
  await avisarOPainel(orderId);
  return { situacao: e.status, motivo: e.dados?.motivo ?? null, terminal: e.terminalLabel };
}

/** Pedido cancelado reaberto: o estorno que a maquininha ainda não pegou é desistido. */
export async function desistirDoEstornoAoReabrir(orderId: string): Promise<void> {
  await garantirTabela();
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "EstornoNaMaquininha" SET "status" = $2, "atualizadoEm" = now() WHERE "orderId" = $1 AND "status" = $3`,
    orderId, S.cancelado, S.aguardando,
  );
  if (n === 0) {
    const r = await prisma.$queryRawUnsafe<any[]>(`SELECT "status" FROM "EstornoNaMaquininha" WHERE "orderId" = $1`, orderId);
    if (r[0] && r[0].status !== S.cancelado) {
      console.warn(`[Estorno na maquininha] Pedido ${orderId} reaberto com o estorno em ${r[0].status}: confira na maquininha.`);
    }
  }
}

/**
 * A fila de estornos do app do TOTEM desta maquininha. Mesma reserva da
 * cobrança (FOR UPDATE SKIP LOCKED): duas perguntas ao mesmo tempo não levam o
 * mesmo estorno.
 *
 * Antes, o estorno preso "na maquininha" há mais de 5 min volta para a fila
 * (o app travou, o aparelho desligou). Depois de ENTREGAS_ATE_DESISTIR
 * entregas sem resposta ele vira INCERTO, e não volta mais: o app pode ter
 * aberto a Cielo e morrido no meio — insistir para sempre seria abrir a tela de
 * estorno no balcão a cada 5 minutos.
 *
 * NAO_ABRIU devolvido pelo app volta para a fila e espera 30 s antes de sair de
 * novo: a tela do FireHub estava atrás de outra, e na hora seguinte é igual.
 */
export async function reservarEstorno(terminal: { id: string; franchiseeId: string }): Promise<EstornoNaMaquininha | null> {
  try {
    await garantirTabela();
  } catch {
    return null;
  }
  const presas = await prisma.$queryRawUnsafe<any[]>(
    `UPDATE "EstornoNaMaquininha"
     SET "status" = CASE WHEN "entregas" >= $3 THEN $4 ELSE $5 END,
         "dados" = CASE WHEN "entregas" >= $3
           THEN COALESCE("dados",'{}'::jsonb) || jsonb_build_object('motivo', 'a maquininha não respondeu')
           ELSE "dados" END,
         "atualizadoEm" = now()
     WHERE "terminalId" = $1 AND "status" = $2 AND "atualizadoEm" < now() - make_interval(mins => $6::int)
     RETURNING "orderId"`,
    terminal.id, S.noTerminal, ENTREGAS_ATE_DESISTIR, S.incerto, S.aguardando, MINUTOS_ATE_DESTRAVAR_O_ESTORNO,
  );
  for (const p of presas) await avisarOPainel(p.orderId);

  const r = await prisma.$queryRawUnsafe<any[]>(
    `UPDATE "EstornoNaMaquininha" SET "status" = $3, "entregas" = "entregas" + 1, "atualizadoEm" = now()
     WHERE "id" = (
       SELECT "id" FROM "EstornoNaMaquininha"
       WHERE "franchiseeId" = $1 AND "terminalId" = $2 AND "status" = $4
         AND ("entregas" = 0 OR "atualizadoEm" < now() - interval '30 seconds')
       ORDER BY "criadoEm" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    terminal.franchiseeId, terminal.id, S.noTerminal, S.aguardando,
  );
  return r[0] ? linha(r[0]) : null;
}

/** O que vai no campo `estorno` da resposta do pendente (o app lê em rede/Modelos.kt). */
export async function estornoParaOApp(e: EstornoNaMaquininha) {
  const pedido = await prisma.customerOrder.findUnique({ where: { id: e.orderId }, select: { dailyOrderNumber: true } });
  return {
    estornoId: e.id,
    // Volta igual no resultado, como o pedidoId opaco da cobrança.
    referencia: `${PREFIXO_DO_ESTORNO}${e.id}`,
    valorEmCentavos: e.valorCentavos,
    descricao: pedido?.dailyOrderNumber != null ? `Estorno do pedido ${pedido.dailyOrderNumber}` : "Estorno",
    ordemDaAdquirente: e.dados?.ordem ?? null,
    cieloCode: e.dados?.cieloCode ?? null,
    autorizacao: e.dados?.autorizacao ?? null,
  };
}

/**
 * O app devolveu o resultado do estorno. Mesmo contrato de resposta de
 * POST /api/pos/terminal/resultado, que o app já sabe ler: `aprovado` = estornado,
 * `jaConfirmado` = repetição (o app tira da fila dele e pronto).
 */
export async function registrarResultadoDoEstorno(params: {
  terminal: { id: string; franchiseeId: string };
  estornoId: string;
  resposta: RespostaDoApp;
  motivo: string | null;
  idsDaAdquirente: Record<string, unknown> | null;
}): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const { terminal, estornoId, resposta, motivo, idsDaAdquirente } = params;
  await garantirTabela();
  const r = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "EstornoNaMaquininha" WHERE "id" = $1`, estornoId);
  const e = r[0] ? linha(r[0]) : null;
  const pedidoId = `${PREFIXO_DO_ESTORNO}${estornoId}`;
  if (!e) return { status: 404, corpo: { error: "Estorno não encontrado" } };
  if (e.franchiseeId !== terminal.franchiseeId) return { status: 403, corpo: { error: "Este estorno não é desta loja" } };
  if (e.terminalId !== terminal.id) {
    return { status: 409, corpo: { error: "Este estorno está com outra maquininha.", code: "COBRANCA_DE_OUTRO_TERMINAL" } };
  }

  const nova = proximaSituacao(e.status, resposta, e.entregas);
  if (!nova) return { status: 200, corpo: { success: true, jaConfirmado: true, pedidoId, situacao: e.status } };

  const carimbo = JSON.stringify({
    motivo: nova === S.estornado ? null : motivo ?? (nova === S.recusado && resposta === "NAO_ABRIU" ? "o app da Cielo não abriu" : null),
    resposta, idsDoEstorno: idsDaAdquirente ?? null, respondidoEm: new Date().toISOString(),
  });
  // A condição no status atual é a trava contra dois resultados ao mesmo tempo.
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "EstornoNaMaquininha" SET "status" = $2, "dados" = COALESCE("dados",'{}'::jsonb) || $3::jsonb, "atualizadoEm" = now()
     WHERE "id" = $1 AND "status" = $4`,
    e.id, nova, carimbo, e.status,
  );
  if (n === 1) {
    await avisarOPainel(e.orderId);
    if (nova !== S.estornado && ehFinal(nova)) {
      console.warn(`[Estorno na maquininha] Pedido ${e.orderId}: ${nova} — ${motivo ?? "sem motivo"}`);
    }
  }
  return {
    status: 200,
    corpo: {
      success: true, aprovado: nova === S.estornado, podeTentarDeNovo: false, situacao: nova,
      motivo: motivo ?? null, pedidoId,
    },
  };
}

/** `situacao` nula = pedido não cancelado (ou cancelado antes do estorno automático): só o nome da maquininha. */
export type MaquininhaNoPainel = { situacao: string | null; motivo?: string | null; terminal?: string | null };

/**
 * Para o painel (api/customer-order/poll): de qual maquininha é cada pedido
 * pago na Cielo e, se cancelado, como está o estorno. Duas consultas, e só
 * quando a lista tem pedido assim — nas outras lojas, nenhuma.
 */
export async function estornosParaOPainel(
  pedidos: { id: string; status?: string | null }[],
): Promise<Map<string, MaquininhaNoPainel>> {
  const mapa = new Map<string, MaquininhaNoPainel>();
  if (pedidos.length === 0) return mapa;
  const ids = pedidos.map((p) => p.id);
  const maquininhas = await prisma.$queryRawUnsafe<{ id: string; label: string | null }[]>(
    `SELECT o."id", t."label" FROM "CustomerOrder" o LEFT JOIN "PosTerminal" t ON t."id" = o."posTerminalId" WHERE o."id" = ANY($1::text[])`,
    ids,
  );
  for (const m of maquininhas) mapa.set(m.id, { situacao: null, terminal: m.label });
  const cancelados = pedidos.filter((p) => p.status === "CANCELADO").map((p) => p.id);
  if (cancelados.length > 0) {
    await garantirTabela();
    const estornos = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "orderId", "status", "terminalLabel", "dados" FROM "EstornoNaMaquininha" WHERE "orderId" = ANY($1::text[])`,
      cancelados,
    );
    for (const e of estornos) {
      mapa.set(e.orderId, { situacao: e.status, motivo: e.dados?.motivo ?? null, terminal: e.terminalLabel ?? mapa.get(e.orderId)?.terminal ?? null });
    }
  }
  return mapa;
}
