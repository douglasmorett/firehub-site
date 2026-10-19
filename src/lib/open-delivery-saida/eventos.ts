/**
 * lib/open-delivery-saida/eventos.ts — a fila de eventos que a logística lê.
 *
 * ── Por que VARREDURA e não gancho em cada rota ─────────────────────────────
 *
 * Pedido nasce e muda de status por uma dúzia de caminhos (site, robô, PDV,
 * painel, KDS, app do motoboy, cancelamento automático do Pix...). Um gancho
 * em cada um é exatamente o furo que o webhook da API Aberta tem até hoje
 * (lib/webhook-dispatcher só dispara para o que a própria API v1 criou). Os
 * carimbos de etapa (acceptedAt, readyAt, dispatchedAt, deliveredAt,
 * cancelledAt) já são postos em TODA gravação pela extensão do Prisma
 * (lib/prisma.ts → lib/order-stages.ts), então a varredura lê o pedido e
 * deduz o que aconteceu — vale para qualquer caminho, inclusive o que ainda
 * não existe.
 *
 * Quem varre: o cron (/api/cron/open-delivery-saida, a cada 20 s) e o próprio
 * polling da logística, antes de responder. A chave única (integração, pedido,
 * tipo) torna a varredura idempotente: rodar duas vezes não duplica evento.
 *
 * ── Webhook ─────────────────────────────────────────────────────────────────
 *
 * Com URL cadastrada, cada evento vai num POST com X-App-MerchantId e
 * X-App-Signature (HMAC do corpo com o client_secret da loja). 2xx = entregue,
 * e o evento sai do polling (no Open Delivery, webhook não leva ack). Falhou:
 * tenta de novo em 30 s, 1, 2, 5, 10, 20 e 30 min; depois desiste — e o evento
 * continua no polling. Evento de um pedido não passa na frente de outro mais
 * antigo do MESMO pedido que falhou (CREATED antes de DISPATCHED).
 */
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDaOpenDeliverySaida } from "@/lib/garantir-colunas";
import { decifrar } from "@/lib/cofre";
import { STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";
import { vaiParaALogistica, STATUS_CONFIRMADOS, STATUS_EM_ROTA } from "./pedido";
import { assinaturaDoWebhook } from "./credenciais";
import { pegarVez, soltarVez } from "@/lib/vez";
import { idDaInstancia } from "@/lib/instancia";

// ── Integração ────────────────────────────────────────────────────────────────

export type Integracao = {
  id: string;
  franchiseeId: string;
  parceiro: string;
  merchantId: string;
  clientId: string;
  clientSecretCifrado: string;
  webhookUrl: string | null;
  ativo: boolean;
  ligadoEm: Date;
  ultimaVarredura: Date | null;
  ultimoUsoEm: Date | null;
  createdAt: Date;
};

const COLUNAS = `"id","franchiseeId","parceiro","merchantId","clientId","clientSecretCifrado","webhookUrl","ativo","ligadoEm","ultimaVarredura","ultimoUsoEm","createdAt"`;

export async function integracaoDaLoja(franchiseeId: string): Promise<Integracao | null> {
  if (!(await garantirEstruturaDaOpenDeliverySaida())) return null;
  const r = await prisma.$queryRawUnsafe<Integracao[]>(`SELECT ${COLUNAS} FROM "OpenDeliverySaida" WHERE "franchiseeId" = $1 LIMIT 1`, franchiseeId);
  return r[0] ?? null;
}

export async function integracaoPorClientId(clientId: string): Promise<Integracao | null> {
  if (!clientId || !(await garantirEstruturaDaOpenDeliverySaida())) return null;
  const r = await prisma.$queryRawUnsafe<Integracao[]>(`SELECT ${COLUNAS} FROM "OpenDeliverySaida" WHERE "clientId" = $1 LIMIT 1`, clientId);
  return r[0] ?? null;
}

export async function integracaoPorId(id: string): Promise<Integracao | null> {
  if (!id || !(await garantirEstruturaDaOpenDeliverySaida())) return null;
  const r = await prisma.$queryRawUnsafe<Integracao[]>(`SELECT ${COLUNAS} FROM "OpenDeliverySaida" WHERE "id" = $1 LIMIT 1`, id);
  return r[0] ?? null;
}

export async function integracoesAtivas(): Promise<Integracao[]> {
  if (!(await garantirEstruturaDaOpenDeliverySaida())) return [];
  return prisma.$queryRawUnsafe<Integracao[]>(`SELECT ${COLUNAS} FROM "OpenDeliverySaida" WHERE "ativo" = true`);
}

/** A URL para onde o webhook vai: a da loja; sem ela, a padrão do servidor (a URL única do parceiro). */
export function urlDoWebhook(integ: Pick<Integracao, "webhookUrl">): string | null {
  const daLoja = String(integ.webhookUrl || "").trim();
  if (daLoja) return daLoja;
  const padrao = String(process.env.OPEN_DELIVERY_SAIDA_WEBHOOK_URL || "").trim();
  return padrao || null;
}

/** A base da API que a logística chama: `<base>/v1/orders/{id}`. */
export function urlBaseOD(): string {
  return (process.env.OPEN_DELIVERY_SAIDA_URL_BASE || "https://firehubfood.com.br/api/opendelivery").replace(/\/+$/, "");
}

// ── O que aconteceu com o pedido (puro) ───────────────────────────────────────

export type TipoDeEvento = "CREATED" | "CONFIRMED" | "READY_FOR_PICKUP" | "DISPATCHED" | "DELIVERED" | "CONCLUDED" | "CANCELLED";

export type PedidoParaEventos = {
  status: string;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  acceptedAt?: Date | string | null;
  readyAt?: Date | string | null;
  dispatchedAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  cancelledAt?: Date | string | null;
};

const data = (d: Date | string | null | undefined): Date | null => {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  return Number.isFinite(x.getTime()) ? x : null;
};

/**
 * Os eventos que o pedido já viveu e ainda não foram gerados, na ordem. Pelo
 * carimbo da etapa ou, sem ele, pelo status atual (hora = updatedAt).
 *
 * Cancelado antes de a logística saber que ele existia (sem CREATED gerado):
 * nada — não se avisa um pedido só para dizer que ele morreu.
 */
export function eventosQueFaltam(p: PedidoParaEventos, jaGerados: ReadonlySet<string>): { eventType: TipoDeEvento; ocorridoEm: Date }[] {
  const s = String(p.status || "").toUpperCase();
  const cancelado = (STATUS_CANCELADOS as readonly string[]).includes(s);
  if (cancelado && !jaGerados.has("CREATED")) return [];

  const criado = data(p.createdAt) ?? new Date();
  const mexido = data(p.updatedAt) ?? criado;
  const finalizado = (STATUS_FINALIZADOS as readonly string[]).includes(s);
  const emRota = STATUS_EM_ROTA.includes(s);
  const pronto = s === "PRONTO";
  const confirmado = STATUS_CONFIRMADOS.includes(s) || pronto || emRota || finalizado;

  const candidatos: { eventType: TipoDeEvento; quando: Date | null }[] = [
    { eventType: "CREATED", quando: criado },
    { eventType: "CONFIRMED", quando: data(p.acceptedAt) ?? (confirmado ? data(p.readyAt) ?? data(p.dispatchedAt) ?? data(p.deliveredAt) ?? mexido : null) },
    { eventType: "READY_FOR_PICKUP", quando: data(p.readyAt) ?? (pronto ? mexido : null) },
    { eventType: "DISPATCHED", quando: data(p.dispatchedAt) ?? (emRota ? mexido : null) },
    { eventType: "DELIVERED", quando: data(p.deliveredAt) ?? (finalizado ? mexido : null) },
    { eventType: "CONCLUDED", quando: data(p.deliveredAt) ?? (finalizado ? mexido : null) },
    { eventType: "CANCELLED", quando: cancelado ? data(p.cancelledAt) ?? mexido : null },
  ];

  const saida: { eventType: TipoDeEvento; ocorridoEm: Date }[] = [];
  let anterior = 0;
  for (const c of candidatos) {
    if (!c.quando) continue;
    // A etapa que ACONTECEU antes conta mesmo depois do cancelamento (saiu e
    // foi cancelado: DISPATCHED e CANCELLED). Carimbo antigo de um vaivém de
    // status também — ele aconteceu.
    const t = Math.max(c.quando.getTime(), anterior);
    anterior = t;
    if (jaGerados.has(c.eventType)) continue;
    saida.push({ eventType: c.eventType, ocorridoEm: new Date(t) });
  }
  return saida;
}

// ── Formato do evento (o que vai no polling e no webhook) ─────────────────────

export type EventoGravado = {
  id: string;
  orderId: string;
  eventType: string;
  ocorridoEm: Date;
};

export function eventoOD(ev: EventoGravado, base = urlBaseOD()) {
  return {
    eventId: ev.id,
    eventType: ev.eventType,
    orderId: ev.orderId,
    orderURL: `${base}/v1/orders/${ev.orderId}`,
    createdAt: new Date(ev.ocorridoEm).toISOString(),
    sourceAppId: "firehub",
  };
}

// ── Varredura ─────────────────────────────────────────────────────────────────

/** Margem sobre a última varredura: gravação em transação lenta não escapa. */
const MARGEM_MS = 5 * 60_000;
/** Pedido mais velho que isto não ganha evento novo (o dia de operação acabou). */
const IDADE_MAXIMA_MS = 36 * 60 * 60_000;

export async function varrerLoja(integ: Integracao, agora = new Date()): Promise<number> {
  const desde = new Date(Math.max((integ.ultimaVarredura ?? integ.ligadoEm).getTime() - MARGEM_MS, new Date(integ.ligadoEm).getTime() - MARGEM_MS));
  const pedidos = await prisma.customerOrder.findMany({
    where: {
      franchiseeId: integ.franchiseeId,
      deliveryType: "DELIVERY",
      createdAt: { gte: new Date(Math.max(new Date(integ.ligadoEm).getTime(), agora.getTime() - IDADE_MAXIMA_MS)) },
      updatedAt: { gte: desde },
    },
    select: {
      id: true, status: true, source: true, deliveryType: true, deliveryBy: true,
      ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryChannel: true,
      openDeliveryReference: true, food99AppShopId: true, tableSessionId: true, parentOrderId: true,
      createdAt: true, updatedAt: true, acceptedAt: true, readyAt: true, dispatchedAt: true,
      deliveredAt: true, cancelledAt: true,
    },
    take: 500,
    orderBy: { updatedAt: "asc" },
  });

  const elegiveis = pedidos.filter(vaiParaALogistica);
  let criados = 0;
  if (elegiveis.length > 0) {
    const ids = elegiveis.map((p) => p.id);
    const existentes = await prisma.$queryRawUnsafe<{ orderId: string; eventType: string }[]>(
      `SELECT "orderId","eventType" FROM "OpenDeliverySaidaEvento" WHERE "integracaoId" = $1 AND "orderId" = ANY($2::text[])`,
      integ.id,
      ids,
    );
    const porPedido = new Map<string, Set<string>>();
    for (const e of existentes) {
      if (!porPedido.has(e.orderId)) porPedido.set(e.orderId, new Set());
      porPedido.get(e.orderId)!.add(e.eventType);
    }
    const comWebhook = Boolean(urlDoWebhook(integ));
    for (const p of elegiveis) {
      for (const ev of eventosQueFaltam(p, porPedido.get(p.id) ?? new Set())) {
        const n = await prisma.$executeRawUnsafe(
          `INSERT INTO "OpenDeliverySaidaEvento" ("id","integracaoId","franchiseeId","orderId","eventType","ocorridoEm","webhookStatus")
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT ("integracaoId","orderId","eventType") DO NOTHING`,
          crypto.randomUUID(),
          integ.id,
          integ.franchiseeId,
          p.id,
          ev.eventType,
          ev.ocorridoEm,
          comWebhook ? "PENDENTE" : null,
        );
        criados += Number(n) || 0;
      }
    }
  }

  // Só avança se o lote não veio cheio — senão a próxima volta pega o resto.
  if (pedidos.length < 500) {
    await prisma.$executeRawUnsafe(`UPDATE "OpenDeliverySaida" SET "ultimaVarredura" = $2 WHERE "id" = $1`, integ.id, agora);
  }
  return criados;
}

// ── Polling e acknowledgment ──────────────────────────────────────────────────

/** Evento sem ack some do polling depois disto (a spec do OD fala em horas). */
const JANELA_DO_POLLING_MS = 24 * 60 * 60_000;

export async function eventosDoPolling(integ: Integracao, opcoes: { tipos?: string[]; limite?: number } = {}): Promise<EventoGravado[]> {
  const limite = Math.min(Math.max(opcoes.limite ?? 100, 1), 1000);
  const tipos = (opcoes.tipos || []).map((t) => t.trim().toUpperCase()).filter(Boolean);
  const desde = new Date(Date.now() - JANELA_DO_POLLING_MS);
  return prisma.$queryRawUnsafe<EventoGravado[]>(
    `SELECT "id","orderId","eventType","ocorridoEm" FROM "OpenDeliverySaidaEvento"
      WHERE "integracaoId" = $1 AND "confirmadoEm" IS NULL AND "ocorridoEm" >= $2
        AND ("webhookStatus" IS NULL OR "webhookStatus" <> 'ENTREGUE')
        AND (cardinality($3::text[]) = 0 OR "eventType" = ANY($3::text[]))
      ORDER BY "ocorridoEm" ASC, "createdAt" ASC
      LIMIT ${limite}`,
    integ.id,
    desde,
    tipos,
  );
}

export type AckOD = { id: string; orderId?: string; eventType?: string };

/** Lê o corpo do acknowledgment: array de { id, orderId, eventType } (aceita `eventId` no lugar de `id`). */
export function lerAck(corpo: unknown): AckOD[] | null {
  if (!Array.isArray(corpo)) return null;
  const lista: AckOD[] = [];
  for (const x of corpo) {
    if (!x || typeof x !== "object") return null;
    const id = String((x as any).id ?? (x as any).eventId ?? "").trim();
    if (!id) return null;
    lista.push({ id, orderId: (x as any).orderId, eventType: (x as any).eventType });
  }
  return lista;
}

export async function confirmarEventos(integ: Integracao, acks: AckOD[]): Promise<number> {
  if (acks.length === 0) return 0;
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "OpenDeliverySaidaEvento" SET "confirmadoEm" = now()
      WHERE "integracaoId" = $1 AND "id" = ANY($2::text[]) AND "confirmadoEm" IS NULL`,
    integ.id,
    acks.map((a) => a.id),
  );
  return Number(n) || 0;
}

// ── Webhook ───────────────────────────────────────────────────────────────────

/** Espera antes da tentativa n+1 (n = tentativas já feitas). Depois da última, desiste. */
export const ESPERAS_DO_WEBHOOK_S = [30, 60, 120, 300, 600, 1200, 1800];

export function proximaTentativa(tentativasFeitas: number, agora = new Date()): Date | null {
  const espera = ESPERAS_DO_WEBHOOK_S[tentativasFeitas - 1];
  return espera == null ? null : new Date(agora.getTime() + espera * 1000);
}

type Enviar = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;

export async function enviarWebhooksPendentes(integ: Integracao, opcoes: { enviar?: Enviar; temTempo?: () => boolean } = {}): Promise<string[]> {
  const log: string[] = [];
  const url = urlDoWebhook(integ);
  if (!url) return log;
  const segredo = decifrar(integ.clientSecretCifrado);
  if (!segredo) {
    log.push(`❌ ${integ.franchiseeId}: segredo não abre (COFRE_CHAVE/NEXTAUTH_SECRET mudou?)`);
    return log;
  }
  const enviar: Enviar = opcoes.enviar ?? ((u, init) => fetch(u, { ...init, signal: AbortSignal.timeout(8000) }));
  const pendentes = await prisma.$queryRawUnsafe<(EventoGravado & { webhookTentativas: number })[]>(
    `SELECT "id","orderId","eventType","ocorridoEm","webhookTentativas" FROM "OpenDeliverySaidaEvento"
      WHERE "integracaoId" = $1 AND "webhookStatus" = 'PENDENTE'
        AND ("webhookProximaEm" IS NULL OR "webhookProximaEm" <= now())
      ORDER BY "ocorridoEm" ASC, "createdAt" ASC
      LIMIT 50`,
    integ.id,
  );

  const travados = new Set<string>(); // pedidos com evento anterior que falhou nesta volta
  let falhasSeguidas = 0;
  for (const ev of pendentes) {
    if (opcoes.temTempo && !opcoes.temTempo()) break;
    if (falhasSeguidas >= 3) break; // o parceiro está fora: não gasta o ciclo inteiro em timeout
    if (travados.has(ev.orderId)) continue;
    const corpo = JSON.stringify(eventoOD(ev));
    let erro: string | null = null;
    try {
      const r = await enviar(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Id": "firehub",
          "X-App-MerchantId": integ.merchantId,
          "X-App-Signature": assinaturaDoWebhook(corpo, segredo),
          "User-Agent": "FireHub-OpenDelivery/1.0",
        },
        body: corpo,
      });
      if (!r.ok) erro = `HTTP ${r.status}`;
    } catch (e: any) {
      erro = String(e?.message || e).slice(0, 200);
    }

    if (!erro) {
      falhasSeguidas = 0;
      await prisma.$executeRawUnsafe(
        `UPDATE "OpenDeliverySaidaEvento" SET "webhookStatus" = 'ENTREGUE', "confirmadoEm" = COALESCE("confirmadoEm", now()),
                "webhookTentativas" = "webhookTentativas" + 1, "webhookUltimoErro" = NULL WHERE "id" = $1`,
        ev.id,
      );
      log.push(`→ ${ev.eventType} ${ev.orderId}: ok`);
    } else {
      falhasSeguidas++;
      travados.add(ev.orderId);
      const feitas = Number(ev.webhookTentativas || 0) + 1;
      const proxima = proximaTentativa(feitas);
      await prisma.$executeRawUnsafe(
        `UPDATE "OpenDeliverySaidaEvento" SET "webhookTentativas" = $2, "webhookUltimoErro" = $3,
                "webhookProximaEm" = $4, "webhookStatus" = $5 WHERE "id" = $1`,
        ev.id,
        feitas,
        erro,
        proxima,
        proxima ? "PENDENTE" : "DESISTIU",
      );
      log.push(`❌ ${ev.eventType} ${ev.orderId}: ${erro}${proxima ? "" : " (desistiu — segue no polling)"}`);
    }
  }
  return log;
}

/**
 * Lojas com ciclo no ar neste processo: o cron e a ação da logística não
 * mandam o mesmo webhook duas vezes. Guarda local e barata — vale mesmo com o
 * banco soluçando e para ciclo que passe do minuto da vez abaixo.
 */
const CICLOS_NO_AR = new Set<string>();
/** A vez da loja entre servidores: ciclo mais longo que isto perde a exclusividade. */
const VEZ_DO_CICLO_MS = 60_000;

/** Varre e envia uma loja — o que o cron e as ações chamam. Nunca lança. */
export async function cicloDaLoja(integ: Integracao, temTempo?: () => boolean): Promise<string[]> {
  const log: string[] = [];
  if (CICLOS_NO_AR.has(integ.id)) return log;
  CICLOS_NO_AR.add(integ.id);
  // Entre servidores (o container velho e o novo no deploy, ou A e B): a vez
  // da loja no banco (lib/vez.ts). Dono por ciclo, e não por servidor, para
  // que nem o mesmo processo "renove" a vez de um ciclo que ainda está no ar.
  const chave = `od-saida:${integ.id}`;
  const dono = `${idDaInstancia()}#${crypto.randomUUID().slice(0, 8)}`;
  let pegou = false;
  try {
    pegou = await pegarVez(chave, VEZ_DO_CICLO_MS, { dono });
    if (!pegou) return log;
    const n = await varrerLoja(integ);
    if (n > 0) log.push(`${n} evento(s) novo(s)`);
    log.push(...(await enviarWebhooksPendentes(integ, { temTempo })));
  } catch (e: any) {
    log.push(`❌ ${e?.message || e}`);
  } finally {
    CICLOS_NO_AR.delete(integ.id);
    if (pegou) await soltarVez(chave, dono);
  }
  return log;
}
