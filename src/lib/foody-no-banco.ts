/**
 * Foody Delivery / Voe Delivery — o banco e o gatilho (a regra pura mora em
 * lib/foody-delivery.ts; o HTTP em lib/foody-api.ts).
 *
 * ── ONDE FICA CADA COISA ────────────────────────────────────────────────────
 *
 * Duas tabelas por SQL cru, criadas na primeira vez que alguém precisa delas
 * (`CREATE TABLE IF NOT EXISTS`, o mesmo padrão de PedidoChegando e
 * CashbackAjuste) — nada no schema.prisma, nada de `db push`:
 *
 *   "FoodyLoja"     uma linha por loja: o token CIFRADO (lib/cofre.ts, o mesmo
 *                   cofre da chave do Asaas), o gatilho (ACEITO | PRONTO |
 *                   MANUAL) e se o "entregue" da Foody fecha o pedido aqui.
 *   "FoodyEntrega"  uma linha por pedido: o uid da Foody, o id curto que
 *                   aparece no mapa dela, o status, o motoboy e o link de
 *                   rastreio. A CHAVE é o pedido — é ela que impede duas
 *                   entregas para o mesmo pedido.
 *
 * Por que tabela própria e não um Json do pedido: o acompanhamento precisa
 * achar "as entregas em curso" a cada minuto, e isso num Json de
 * CustomerOrder seria varrer pedidos; e o INSERT ... ON CONFLICT é a trava
 * de idempotência de graça.
 *
 * ── IDEMPOTÊNCIA ────────────────────────────────────────────────────────────
 *
 * Antes de chamar a Foody, a linha do pedido é RESERVADA (INSERT que só um
 * entra, ou UPDATE condicional que só um casa). Dois cliques, o gatilho
 * automático junto do botão, dois servidores: só um chega no POST. Se o POST
 * anterior caiu sem resposta (a Foody pode ter criado e a resposta se perdido),
 * a nova tentativa procura antes o pedido do dia pelo id curto na Foody e
 * adota o uid que já existe em vez de criar outro.
 *
 * ── NUNCA TRAVA O STATUS ────────────────────────────────────────────────────
 *
 * O gatilho roda DEPOIS da gravação do status e fora dela (extensão em
 * lib/prisma.ts, como o estoque do cancelamento). Falhou a Foody: a linha fica
 * com estado ERRO e a mensagem, o painel mostra o aviso (AvisosDaFoody) e o
 * botão "Chamar motoboy" tenta de novo. O pedido nunca deixa de mudar de
 * status por causa da Foody.
 */
import { prisma } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/cofre";
import { MODO_LOCAL } from "@/lib/modo-local";
import { STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";
import {
  acaoDoStatus,
  dataFoody,
  ehCanalDaLoja,
  emAndamento,
  lerAtualizacoes,
  lerEntregaDaResposta,
  lerGatilho,
  montarPedidoFoody,
  podeChamarDeNovo,
  podeIrParaFoody,
  statusDaChamadaManual,
  type GatilhoFoody,
  type StatusFoody,
} from "@/lib/foody-delivery";
import { conferirAtualizacoes, criarEntrega, lerEntrega, listarEntregas, mudarStatusDaEntrega } from "@/lib/foody-api";

// ── Tabelas ─────────────────────────────────────────────────────────────────

const ESTRUTURA = [
  `CREATE TABLE IF NOT EXISTS "FoodyLoja" (
    "lojaId" TEXT NOT NULL PRIMARY KEY,
    "tokenCifrado" TEXT,
    "gatilho" TEXT NOT NULL DEFAULT 'MANUAL',
    "marcarEntregue" BOOLEAN NOT NULL DEFAULT false,
    "conectadoEm" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "FoodyEntrega" (
    "pedidoId" TEXT NOT NULL PRIMARY KEY,
    "lojaId" TEXT NOT NULL,
    "idFoody" TEXT,
    "uid" TEXT,
    "status" TEXT,
    "estado" TEXT NOT NULL,
    "tentativa" INTEGER NOT NULL DEFAULT 1,
    "origem" TEXT,
    "trackerUrl" TEXT,
    "courierName" TEXT,
    "courierPhone" TEXT,
    "erro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "FoodyEntrega_loja_estado_idx" ON "FoodyEntrega" ("lojaId", "estado")`,
  `CREATE INDEX IF NOT EXISTS "FoodyEntrega_uid_idx" ON "FoodyEntrega" ("uid")`,
];

let estruturaOk = false;
export async function garantirTabelasDaFoody(): Promise<boolean> {
  if (estruturaOk) return true;
  if (!/^postgres/i.test(process.env.DATABASE_URL || "")) return false;
  try {
    for (const sql of ESTRUTURA) await prisma.$executeRawUnsafe(sql);
    estruturaOk = true;
    return true;
  } catch (err: any) {
    console.error(`[Foody] 🛑 Tabelas FoodyLoja/FoodyEntrega falharam: ${err?.message}`);
    return false;
  }
}

// ── Configuração da loja ────────────────────────────────────────────────────

export type ConfigFoody = {
  conectada: boolean;
  gatilho: GatilhoFoody;
  marcarEntregue: boolean;
  conectadoEm: Date | null;
};

type LinhaLoja = { tokenCifrado: string | null; gatilho: string | null; marcarEntregue: boolean | null; conectadoEm: Date | null };

async function linhaDaLoja(lojaId: string): Promise<LinhaLoja | null> {
  if (!(await garantirTabelasDaFoody())) return null;
  const rows = await prisma.$queryRaw<LinhaLoja[]>`
    SELECT "tokenCifrado", "gatilho", "marcarEntregue", "conectadoEm" FROM "FoodyLoja" WHERE "lojaId" = ${lojaId} LIMIT 1
  `;
  return rows[0] || null;
}

export async function configDaFoody(lojaId: string): Promise<ConfigFoody> {
  const r = await linhaDaLoja(lojaId).catch(() => null);
  return {
    conectada: Boolean(r?.tokenCifrado),
    gatilho: lerGatilho(r?.gatilho),
    marcarEntregue: Boolean(r?.marcarEntregue),
    conectadoEm: r?.conectadoEm || null,
  };
}

/** O token aberto — só no servidor, na hora de falar com a Foody. */
export async function tokenDaFoody(lojaId: string): Promise<string | null> {
  const r = await linhaDaLoja(lojaId).catch(() => null);
  return decifrar(r?.tokenCifrado);
}

export async function salvarConfigDaFoody(
  lojaId: string,
  mudanca: { token?: string | null; gatilho?: GatilhoFoody; marcarEntregue?: boolean },
): Promise<void> {
  if (!(await garantirTabelasDaFoody())) throw new Error("Banco indisponível para a integração com a Foody.");
  const atual = await linhaDaLoja(lojaId);
  const tokenCifrado =
    mudanca.token === undefined ? atual?.tokenCifrado ?? null : mudanca.token ? cifrar(mudanca.token) : null;
  const gatilho = mudanca.gatilho ?? lerGatilho(atual?.gatilho);
  const marcarEntregue = mudanca.marcarEntregue ?? Boolean(atual?.marcarEntregue);
  const conectou = mudanca.token ? true : false;
  await prisma.$executeRaw`
    INSERT INTO "FoodyLoja" ("lojaId", "tokenCifrado", "gatilho", "marcarEntregue", "conectadoEm", "updatedAt")
    VALUES (${lojaId}, ${tokenCifrado}, ${gatilho}, ${marcarEntregue},
            ${conectou ? new Date() : atual?.conectadoEm ?? null}, (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("lojaId") DO UPDATE SET
      "tokenCifrado" = EXCLUDED."tokenCifrado",
      "gatilho" = EXCLUDED."gatilho",
      "marcarEntregue" = EXCLUDED."marcarEntregue",
      "conectadoEm" = EXCLUDED."conectadoEm",
      "updatedAt" = EXCLUDED."updatedAt"
  `;
  lojasLigadasEm = 0;
}

// Quem tem a integração ligada, em memória por um minuto. A extensão do Prisma
// acorda a cada mudança de status de TODAS as lojas; sem loja ligada, ela não
// pode custar nem uma consulta.
let lojasLigadas = new Set<string>();
let lojasLigadasEm = 0;
async function lojasComFoody(): Promise<Set<string>> {
  if (Date.now() - lojasLigadasEm < 60_000) return lojasLigadas;
  lojasLigadasEm = Date.now();
  try {
    if (!(await garantirTabelasDaFoody())) return (lojasLigadas = new Set());
    const rows = await prisma.$queryRaw<{ lojaId: string }[]>`
      SELECT "lojaId" FROM "FoodyLoja" WHERE "tokenCifrado" IS NOT NULL
    `;
    lojasLigadas = new Set(rows.map((r) => r.lojaId));
  } catch {
    lojasLigadas = new Set();
  }
  return lojasLigadas;
}

// ── Entrega do pedido ───────────────────────────────────────────────────────

export type EntregaFoody = {
  pedidoId: string;
  lojaId: string;
  idFoody: string | null;
  uid: string | null;
  status: StatusFoody | null;
  estado: "ENVIANDO" | "ENVIADO" | "ERRO";
  tentativa: number;
  origem: string | null;
  trackerUrl: string | null;
  courierName: string | null;
  courierPhone: string | null;
  erro: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function entregaDoPedido(pedidoId: string): Promise<EntregaFoody | null> {
  if (!(await garantirTabelasDaFoody())) return null;
  const rows = await prisma.$queryRaw<EntregaFoody[]>`SELECT * FROM "FoodyEntrega" WHERE "pedidoId" = ${pedidoId} LIMIT 1`;
  return rows[0] || null;
}

const CAMPOS_DO_PEDIDO = {
  id: true, franchiseeId: true, status: true, dailyOrderNumber: true, createdAt: true,
  customerName: true, customerPhone: true, customerAddress: true, customerLatLng: true,
  deliveryType: true, paymentMethod: true, totalAmount: true, deliveryFee: true, changeAmount: true,
  notes: true, source: true, ifoodOrderId: true, ifoodReference: true, openDeliveryChannel: true,
  openDeliveryOrderId: true, openDeliveryReference: true, deliveryBy: true, ifoodDriverName: true,
  ifoodDriverStatus: true, ifoodPickupCode: true, openDeliveryPickupCode: true,
  scheduledDatetime: true, agendado: true, tempoEntregaMin: true, gatewayPaymentId: true,
  items: { select: { productName: true, quantity: true, notes: true, comboSelections: true, menuProduct: { select: { name: true } } } },
  franchisee: { select: { storeTimezone: true, city: true, storeAddress: true } },
} as const;

export type ResultadoDaChamada = { ok: boolean; entrega: EntregaFoody | null; erro?: string; jaExistia?: boolean };

/** Uma reserva parada mais que isto é de uma chamada que morreu no meio. */
const RESERVA_VALE_MS = 60_000;

/**
 * Cria a entrega do pedido na Foody. Idempotente: entrega viva devolve a que
 * já existe. `status` nulo = decide pelo status do pedido (pronto → ready).
 */
export async function chamarFoody(
  pedidoId: string,
  opcoes: { origem: "AUTOMATICO" | "MANUAL"; status?: "open" | "ready"; lojaId?: string },
): Promise<ResultadoDaChamada> {
  if (MODO_LOCAL) return { ok: false, entrega: null, erro: "No Modo Contingência o FireHub não fala com a Foody." };
  if (!(await garantirTabelasDaFoody())) return { ok: false, entrega: null, erro: "Banco indisponível." };

  const pedido = await prisma.customerOrder.findFirst({
    where: { id: pedidoId, ...(opcoes.lojaId ? { franchiseeId: opcoes.lojaId } : {}) },
    select: CAMPOS_DO_PEDIDO,
  });
  if (!pedido) return { ok: false, entrega: null, erro: "Pedido não encontrado." };
  const pode = podeIrParaFoody(pedido);
  if (!pode.pode) return { ok: false, entrega: await entregaDoPedido(pedidoId), erro: pode.motivo };

  const token = await tokenDaFoody(pedido.franchiseeId);
  if (!token) return { ok: false, entrega: null, erro: "A integração com a Foody/Voe não está ligada nesta loja (Integrações)." };

  // ── A reserva ──
  const entrou = await prisma.$executeRaw`
    INSERT INTO "FoodyEntrega" ("pedidoId", "lojaId", "estado", "tentativa", "origem", "createdAt", "updatedAt")
    VALUES (${pedidoId}, ${pedido.franchiseeId}, 'ENVIANDO', 1, ${opcoes.origem}, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))
    ON CONFLICT ("pedidoId") DO NOTHING
  `;
  let tentativa = 1;
  let procurarAntes = false;
  if (entrou !== 1) {
    const atual = await entregaDoPedido(pedidoId);
    if (atual?.uid && !podeChamarDeNovo(atual.status)) return { ok: true, entrega: atual, jaExistia: true };
    const limite = new Date(Date.now() - RESERVA_VALE_MS);
    const novaTentativa = Boolean(atual?.uid && podeChamarDeNovo(atual.status));
    const tomada = await prisma.$queryRaw<{ tentativa: number }[]>`
      UPDATE "FoodyEntrega" SET
        "estado" = 'ENVIANDO',
        "origem" = ${opcoes.origem},
        "erro" = NULL,
        "tentativa" = "tentativa" + ${novaTentativa ? 1 : 0},
        "uid" = CASE WHEN ${novaTentativa} THEN NULL ELSE "uid" END,
        "status" = CASE WHEN ${novaTentativa} THEN NULL ELSE "status" END,
        "trackerUrl" = CASE WHEN ${novaTentativa} THEN NULL ELSE "trackerUrl" END,
        "courierName" = CASE WHEN ${novaTentativa} THEN NULL ELSE "courierName" END,
        "courierPhone" = CASE WHEN ${novaTentativa} THEN NULL ELSE "courierPhone" END,
        "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "pedidoId" = ${pedidoId}
        AND (
          "estado" = 'ERRO'
          OR ("estado" = 'ENVIANDO' AND "updatedAt" < ${limite})
          OR ("uid" IS NOT NULL AND "status" IN ('cancelled', 'rejected'))
        )
      RETURNING "tentativa"
    `;
    if (!tomada.length) {
      return { ok: false, entrega: await entregaDoPedido(pedidoId), erro: "A chamada deste pedido já está em andamento." };
    }
    tentativa = tomada[0].tentativa;
    // Tentativa repetida com o MESMO id curto: a anterior pode ter criado lá.
    procurarAntes = !novaTentativa;
  }

  const fuso = pedido.franchisee?.storeTimezone || "America/Sao_Paulo";
  const status = opcoes.status ?? statusDaChamadaManual(pedido.status);
  const corpo = montarPedidoFoody(pedido, pedido.franchisee || {}, { status, tentativa });

  try {
    let uid: string | null = null;
    if (procurarAntes) uid = await procurarPeloIdCurto(token, corpo.id, pedido.createdAt, fuso);

    if (!uid) {
      const r = await criarEntrega(token, corpo);
      if (!r.ok) return await falhou(pedidoId, corpo.id, r.erro || "A Foody recusou o pedido.");
      uid = lerEntregaDaResposta(r.dados).uid;
      if (!uid) return await falhou(pedidoId, corpo.id, "A Foody respondeu sem o código da entrega (uid).");
    }

    // O POST devolve o que foi mandado + uid; o link de rastreio e o motoboy
    // vêm da leitura do pedido.
    const lido = await lerEntrega(token, uid).catch(() => null);
    const e = lido?.ok ? lerEntregaDaResposta(lido.dados) : null;
    await prisma.$executeRaw`
      UPDATE "FoodyEntrega" SET
        "estado" = 'ENVIADO', "uid" = ${uid}, "idFoody" = ${corpo.id},
        "status" = ${e?.status || status}, "trackerUrl" = ${e?.orderTrackerUrl ?? null},
        "courierName" = ${e?.courierName ?? null}, "courierPhone" = ${e?.courierPhone ?? null},
        "erro" = NULL, "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "pedidoId" = ${pedidoId}
    `;
    console.log(`[Foody] ✅ pedido ${pedidoId} → entrega ${uid} (${corpo.id}, ${status}, ${opcoes.origem})`);
    return { ok: true, entrega: await entregaDoPedido(pedidoId) };
  } catch (err: any) {
    return await falhou(pedidoId, corpo.id, `Erro ao chamar a Foody: ${err?.message || err}`);
  }
}

async function falhou(pedidoId: string, idFoody: string, erro: string): Promise<ResultadoDaChamada> {
  console.warn(`[Foody] ⚠️ pedido ${pedidoId} (${idFoody}): ${erro}`);
  await prisma.$executeRaw`
    UPDATE "FoodyEntrega" SET "estado" = 'ERRO', "idFoody" = ${idFoody}, "erro" = ${erro.slice(0, 500)},
      "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "pedidoId" = ${pedidoId}
  `.catch(() => {});
  return { ok: false, entrega: await entregaDoPedido(pedidoId).catch(() => null), erro };
}

/** O pedido de hoje na Foody com este id curto, se a chamada anterior chegou a criar. */
async function procurarPeloIdCurto(token: string, idCurto: string, criado: Date, fuso: string): Promise<string | null> {
  const inicio = new Date(criado.getTime() - 60 * 60 * 1000);
  const fim = new Date(Date.now() + 60 * 60 * 1000);
  const r = await listarEntregas(token, dataFoody(inicio, fuso), dataFoody(fim, fuso)).catch(() => null);
  if (!r?.ok || !Array.isArray(r.dados)) return null;
  const achado = r.dados.find((p: any) => String(p?.id || "") === idCurto && !podeChamarDeNovo(p?.status));
  return achado?.uid ? String(achado.uid) : null;
}

/** ready / cancelled na entrega que já existe. */
export async function mudarStatusNaFoody(
  pedidoId: string,
  novo: "ready" | "cancelled",
): Promise<{ ok: boolean; erro?: string }> {
  if (MODO_LOCAL) return { ok: false, erro: "Modo Contingência." };
  const entrega = await entregaDoPedido(pedidoId);
  if (!entrega?.uid) return { ok: false, erro: "Este pedido não tem entrega na Foody." };
  if (!emAndamento(entrega.status)) return { ok: true };
  const token = await tokenDaFoody(entrega.lojaId);
  if (!token) return { ok: false, erro: "Integração desligada." };
  const r = await mudarStatusDaEntrega(token, entrega.uid, novo);
  if (!r.ok) {
    console.warn(`[Foody] ⚠️ ${novo} na entrega ${entrega.uid} (pedido ${pedidoId}): ${r.erro}`);
    await prisma.$executeRaw`
      UPDATE "FoodyEntrega" SET "erro" = ${`${novo === "cancelled" ? "Não cancelou na Foody" : "Não avisou a Foody que ficou pronto"}: ${r.erro}`.slice(0, 500)}, "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "pedidoId" = ${pedidoId}
    `.catch(() => {});
    return { ok: false, erro: r.erro || undefined };
  }
  await prisma.$executeRaw`
    UPDATE "FoodyEntrega" SET "status" = ${novo}, "erro" = NULL, "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "pedidoId" = ${pedidoId}
  `;
  return { ok: true };
}

// ── O gatilho da mudança de status (chamado por lib/prisma.ts) ──────────────

/** Pedido mais velho que isto não chama motoboy sozinho (fechamento em lote, correção antiga). */
const IDADE_MAXIMA_DO_AUTOMATICO_MS = 12 * 60 * 60 * 1000;

/**
 * Depois que o status de um pedido mudou. NUNCA lança: quem chama é a
 * extensão do Prisma, fora da gravação, e o status já está salvo.
 */
export async function foodyDepoisDoStatus(pedidoIds: string[]): Promise<void> {
  try {
    if (MODO_LOCAL || pedidoIds.length === 0) return;
    const ligadas = await lojasComFoody();
    if (ligadas.size === 0) return;

    const pedidos = await prisma.customerOrder.findMany({
      where: { id: { in: pedidoIds.slice(0, 50) }, franchiseeId: { in: [...ligadas] } },
      select: { id: true, franchiseeId: true, status: true, createdAt: true },
    });
    for (const p of pedidos) {
      try {
        const config = await configDaFoody(p.franchiseeId);
        if (!config.conectada) continue;
        const entrega = await entregaDoPedido(p.id);
        const acao = acaoDoStatus(p.status, config.gatilho, entrega);
        if (!acao) continue;
        if (acao === "CANCELAR") await mudarStatusNaFoody(p.id, "cancelled");
        else if (acao === "MARCAR_READY") await mudarStatusNaFoody(p.id, "ready");
        else {
          if (Date.now() - p.createdAt.getTime() > IDADE_MAXIMA_DO_AUTOMATICO_MS) continue;
          await chamarFoody(p.id, { origem: "AUTOMATICO", status: acao === "CRIAR_READY" ? "ready" : "open", lojaId: p.franchiseeId });
        }
      } catch (err: any) {
        console.warn(`[Foody] gatilho do pedido ${p.id} falhou: ${err?.message}`);
      }
    }
  } catch (err: any) {
    console.warn(`[Foody] gatilho de status falhou: ${err?.message}`);
  }
}

// ── O acompanhamento (cron a cada minuto) ───────────────────────────────────

/** Entrega em curso há mais que isto sai do acompanhamento (esquecida lá). */
const ACOMPANHAR_POR_MS = 12 * 60 * 60 * 1000;
const LEITURAS_POR_RODADA = 60;

export async function acompanharEntregasDaFoody(): Promise<{ lojas: number; consultadas: number; mudaram: number; entregues: number; erros: string[] }> {
  const saida = { lojas: 0, consultadas: 0, mudaram: 0, entregues: 0, erros: [] as string[] };
  if (MODO_LOCAL || !(await garantirTabelasDaFoody())) return saida;

  // Reserva que morreu no meio (servidor reiniciou durante o POST): vira ERRO
  // para o painel mostrar e o botão poder tentar de novo.
  await prisma.$executeRaw`
    UPDATE "FoodyEntrega" SET "estado" = 'ERRO', "erro" = 'A chamada à Foody não terminou. Confira no painel da Foody antes de chamar de novo.',
      "updatedAt" = (now() AT TIME ZONE 'UTC')
    WHERE "estado" = 'ENVIANDO' AND "updatedAt" < ${new Date(Date.now() - 5 * 60 * 1000)}
  `.catch(() => {});

  const desde = new Date(Date.now() - ACOMPANHAR_POR_MS);
  const vivas = await prisma.$queryRaw<{ pedidoId: string; lojaId: string; uid: string; status: string | null }[]>`
    SELECT "pedidoId", "lojaId", "uid", "status" FROM "FoodyEntrega"
    WHERE "estado" = 'ENVIADO' AND "uid" IS NOT NULL
      AND "status" IN ('open', 'ready', 'dispatched', 'accepted', 'onGoing')
      AND "createdAt" >= ${desde}
    LIMIT 2000
  `;
  if (vivas.length === 0) return saida;

  const porLoja = new Map<string, typeof vivas>();
  for (const v of vivas) {
    const l = porLoja.get(v.lojaId) || [];
    l.push(v);
    porLoja.set(v.lojaId, l);
  }

  let leituras = 0;
  for (const [lojaId, entregas] of porLoja) {
    saida.lojas++;
    const token = await tokenDaFoody(lojaId);
    if (!token) continue;
    const config = await configDaFoody(lojaId);
    for (let i = 0; i < entregas.length; i += 100) {
      const lote = entregas.slice(i, i + 100);
      const r = await conferirAtualizacoes(token, lote.map((e) => e.uid));
      saida.consultadas += lote.length;
      if (!r.ok) {
        saida.erros.push(`${lojaId}: ${r.erro}`);
        continue;
      }
      for (const a of lerAtualizacoes(r.dados)) {
        const e = lote.find((x) => x.uid === a.uid);
        if (!e || e.status === a.status) continue;
        saida.mudaram++;
        // Mudou: lê o pedido inteiro para trazer o motoboy e o link.
        let lido = null as ReturnType<typeof lerEntregaDaResposta> | null;
        if (leituras < LEITURAS_POR_RODADA) {
          leituras++;
          const g = await lerEntrega(token, a.uid).catch(() => null);
          if (g?.ok) lido = lerEntregaDaResposta(g.dados);
        }
        await prisma.$executeRaw`
          UPDATE "FoodyEntrega" SET
            "status" = ${a.status},
            "trackerUrl" = COALESCE(${lido?.orderTrackerUrl ?? null}, "trackerUrl"),
            "courierName" = COALESCE(${lido?.courierName ?? null}, "courierName"),
            "courierPhone" = COALESCE(${lido?.courierPhone ?? null}, "courierPhone"),
            "updatedAt" = (now() AT TIME ZONE 'UTC')
          WHERE "pedidoId" = ${e.pedidoId}
        `;
        if (a.status === "delivered" && config.marcarEntregue) {
          if (await marcarEntreguePelaFoody(e.pedidoId)) saida.entregues++;
        }
      }
    }
  }
  return saida;
}

/**
 * A Foody disse "entregue": o pedido fecha aqui como o app do motoboy fecha —
 * escrita condicional (só quem ainda não está final/cancelado) e os efeitos
 * só para quem a escrita pegou: o "seu pedido chegou" do cliente, a NFC-e
 * automática (que decide sozinha se é hora) e o faturamento do ciclo.
 *
 * Só pedido de canal DA LOJA (site, robô, balcão). Pedido de marketplace com
 * entrega própria fecha pelo painel, que sabe avisar o parceiro.
 */
async function marcarEntreguePelaFoody(pedidoId: string): Promise<boolean> {
  const pedido = await prisma.customerOrder.findUnique({
    where: { id: pedidoId },
    select: { id: true, franchiseeId: true, source: true, openDeliveryChannel: true, openDeliveryOrderId: true, ifoodOrderId: true, ifoodReference: true, status: true, deliveryType: true },
  });
  if (!pedido || !ehCanalDaLoja(pedido)) return false;
  const escrita = await prisma.customerOrder.updateMany({
    where: { id: pedidoId, status: { notIn: [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS] } },
    data: { status: "ENTREGUE", kdsStage: "FINISHED", kdsStationId: null },
  });
  if (escrita.count !== 1) return false;
  console.log(`[Foody] 📦 pedido ${pedidoId} ENTREGUE pela Foody`);
  import("@/lib/order-notifications")
    .then(({ sendOrderNotification }) => sendOrderNotification(pedidoId, "ENTREGUE"))
    .catch(() => {});
  import("@/lib/fiscal-automatico")
    .then(({ emitirNfceAutomatica }) => emitirNfceAutomatica(pedidoId))
    .catch((err) => console.error("[Foody → Fiscal Auto] Erro ao disparar:", err?.message));
  import("@/lib/billing")
    .then(({ trackSaleForBilling }) => trackSaleForBilling(pedido.franchiseeId))
    .catch((err) => console.error("[Foody → Billing] Erro:", err?.message));
  return true;
}

// ── Avisos para o painel ────────────────────────────────────────────────────

/** As chamadas que falharam nas últimas horas, para o aviso no topo do painel. */
export async function falhasRecentesDaFoody(lojaId: string): Promise<{ pedidoId: string; numero: number | null; erro: string; quando: Date }[]> {
  if (!(await garantirTabelasDaFoody())) return [];
  const desde = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<{ pedidoId: string; erro: string | null; updatedAt: Date }[]>`
    SELECT "pedidoId", "erro", "updatedAt" FROM "FoodyEntrega"
    WHERE "lojaId" = ${lojaId} AND "erro" IS NOT NULL AND "updatedAt" >= ${desde}
    ORDER BY "updatedAt" DESC LIMIT 10
  `;
  if (!rows.length) return [];
  const pedidos = await prisma.customerOrder.findMany({
    where: { id: { in: rows.map((r) => r.pedidoId) }, franchiseeId: lojaId },
    select: { id: true, dailyOrderNumber: true, status: true },
  });
  const porId = new Map(pedidos.map((p) => [p.id, p]));
  return rows
    // Pedido cancelado só interessa se o que falhou foi cancelar lá: o motoboy
    // pode estar indo buscar um pedido que não existe mais.
    .filter((r) => porId.has(r.pedidoId) && (!String(porId.get(r.pedidoId)!.status).toUpperCase().startsWith("CANCEL") || /^Não cancelou/.test(r.erro || "")))
    .map((r) => ({ pedidoId: r.pedidoId, numero: porId.get(r.pedidoId)!.dailyOrderNumber ?? null, erro: r.erro || "", quando: r.updatedAt }));
}

/** O que a tela do pedido mostra (sem segredo). */
export function entregaParaTela(e: EntregaFoody | null) {
  if (!e) return null;
  return {
    estado: e.estado,
    status: e.status,
    idFoody: e.idFoody,
    uid: e.uid,
    trackerUrl: e.trackerUrl,
    courierName: e.courierName,
    courierPhone: e.courierPhone,
    erro: e.erro,
    origem: e.origem,
    tentativa: e.tentativa,
    atualizadoEm: e.updatedAt,
    podeChamarDeNovo: e.estado === "ERRO" || podeChamarDeNovo(e.status),
    podeCancelar: Boolean(e.uid) && (e.status === "open" || e.status === "ready"),
  };
}

/** Teste de conexão: lista os pedidos de hoje na Foody com o token informado. */
export async function testarTokenDaFoody(token: string, fuso: string): Promise<{ ok: boolean; erro?: string; pedidosHoje?: number }> {
  const agora = new Date();
  const inicio = new Date(agora.getTime() - 12 * 60 * 60 * 1000);
  const r = await listarEntregas(token, dataFoody(inicio, fuso), dataFoody(agora, fuso));
  if (!r.ok) return { ok: false, erro: r.erro || "A Foody não aceitou o token." };
  return { ok: true, pedidosHoje: Array.isArray(r.dados) ? r.dados.length : 0 };
}

