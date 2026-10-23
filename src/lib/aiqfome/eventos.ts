/**
 * lib/aiqfome/eventos.ts — aviso do aiqfome (webhook ou polling) vira pedido ou status no FireHub.
 *
 * ── Os dois caminhos ────────────────────────────────────────────────────────
 *
 * O webhook do aiqfome (new-order, read-order, ready-order, cancel-order)
 * traz só ids. A rota responde 200 na hora — a doc não diz se o aiqfome tenta
 * de novo, nem quantas vezes — e o trabalho roda depois da resposta, aqui:
 * busca o pedido, filtra, traduz, grava (impressão, KDS) e, se a loja aceita
 * sozinha, marca como LIDO lá (é o aceite: sem ele em 10 min o aiqfome cancela).
 *
 * O polling de 30 s é a rede PRINCIPAL: `GET /orders/open` acha o pedido que
 * o webhook perdeu e o que avançou lá; `GET /orders/cancelled` (a cada 60 s)
 * traz os cancelamentos; e os avisos que pararam no meio e as ações pendentes
 * são repetidos. O mesmo pedido pelos dois caminhos é um pedido só
 * (idempotência pelo `openDeliveryOrderId` em lib/open-delivery/gravar.ts).
 *
 * ── Regras que vieram dos outros canais ─────────────────────────────────────
 *
 *   - A loja do pedido sai SÓ da instalação ativa do `store_id` (nunca "a
 *     primeira loja ativa"); pedido cujo `store.id` diz outra loja não grava.
 *   - Status de lá só AVANÇA o pedido aqui; cancelado cancela (com o aviso de
 *     NFC-e já emitida).
 *   - Aceitar só pedido recente e só se a loja aceita sozinha: nada de aceitar
 *     fila velha em massa (iFood).
 *   - Falha depois de gravar não é falha de pedido: o aceite recusado vai para
 *     a fila de pendentes, e o pedido continua na cozinha.
 */
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { gravarPedidoOpenDelivery } from "@/lib/open-delivery/gravar";
import { guardarPayloadCru } from "@/lib/open-delivery/payload-cru";
import { aceitaSozinhoAgora } from "@/lib/loja-sem-conexao-no-banco";
import { lojaBloqueadaPorMensalidade } from "@/lib/loja-bloqueada";
import { acaoNoPedidoAQ, aiqfomeConfigurada, buscarPedidoAQ, pedidosAbertosAQ, pedidosCanceladosAQ, type AcaoAQ } from "./api";
import { instalacaoAtiva, instalacoesAtivas, registrarPedido, registrarWebhook, type InstalacaoAQ } from "./instalacoes";
import { idDoPedidoAQ, lerIdDoPedidoAQ } from "./id-do-pedido";
import { RANK_DO_FIREHUB, criadoAntesDe, criadoEm, filtroDoPedidoAQ, statusDoFireHubPara, traduzirPedidoAiqfome, type PedidoAQ } from "./traducao";
import { acoesPendentes, marcarTentativa, registrarAcaoPendente } from "./acoes-pendentes";

export type ResultadoEventoAQ = {
  /** O aviso está resolvido (gravou, ou não precisa de nada). false = tentar de novo depois. */
  concluido: boolean;
  acao: string;
  mensagem?: string;
  pedidoId?: string;
};

export type Via = "webhook" | "polling" | "reprocesso";

/** Aceite automático só para pedido recente (o aiqfome cancela o não lido em 10 min). */
const JANELA_DO_ACEITE_MS = 15 * 60_000;
/** Os cancelados são consultados a cada 60 s (metade das voltas do polling). */
const INTERVALO_DOS_CANCELADOS_MS = 55_000;

const texto = (v: unknown) => (v == null ? "" : String(v).trim());

function alertar(loja: string, detalhe: string) {
  import("@/lib/server-monitor")
    .then((m) => m.alertarFalhaDeIntegracao("aiqfome", loja, detalhe))
    .catch(() => {});
}

const nomeDa = (inst: InstalacaoAQ) => inst.nome || `loja ${inst.storeId}`;

type PedidoNoBanco = { id: string; status: string; notes: string | null; cancelledBy: string | null; franchiseeId: string };

async function pedidoNoBanco(idNoBanco: string): Promise<PedidoNoBanco | null> {
  return (await prisma.customerOrder.findFirst({
    where: { openDeliveryOrderId: idNoBanco } as any,
    select: { id: true, status: true, notes: true, cancelledBy: true, franchiseeId: true } as any,
  })) as any;
}

function linhaNasNotas(notes: string | null | undefined, linha: string): string {
  const atual = String(notes || "");
  return atual.includes(linha) ? atual : [atual, linha].filter(Boolean).join("\n");
}

const rank = (status: string | null | undefined) => RANK_DO_FIREHUB[String(status || "").toUpperCase()] ?? 0;

/** O fuso das datas sem fuso do aiqfome, por loja (lido uma vez por processo e loja). */
const fusos = new Map<string, Promise<string>>();
const fusoDe = (lojaId: string) => {
  let f = fusos.get(lojaId);
  if (!f) {
    f = fusoDaLoja(lojaId).catch(() => "America/Sao_Paulo");
    fusos.set(lojaId, f);
  }
  return f;
};

// ── Status de lá → aqui ──────────────────────────────────────────────────────

/** Cancela aqui o que foi cancelado lá. Quem cancelou primeiro foi a loja → continua LOJA. */
async function cancelarAqui(existente: PedidoNoBanco, motivo: string | null, quem: string | null): Promise<ResultadoEventoAQ> {
  if (existente.status === "CANCELADO") return { concluido: true, acao: "ja-cancelado", pedidoId: existente.id };
  const razao = texto(motivo) || "Cancelado no aiqfome";
  await (prisma.customerOrder as any).update({
    where: { id: existente.id },
    data: {
      status: "CANCELADO",
      cancelledAt: new Date(),
      cancelReason: razao,
      ...(existente.cancelledBy === "LOJA" ? {} : { cancelledBy: "AIQFOME" }),
      cancelDispute: { pending: false },
      notes: linhaNasNotas(existente.notes, `❌ Cancelado no aiqfome${texto(quem) ? ` (por ${texto(quem)})` : ""}: ${razao}`),
    },
  });
  import("@/lib/fiscal-automatico").then((m) => m.alertarCancelamentoComNota({ id: existente.id }, "aiqfome")).catch(() => {});
  return { concluido: true, acao: "cancelado", pedidoId: existente.id };
}

/** Avança o pedido daqui até o que os sinais de lá dizem (nunca volta). */
async function aplicarStatus(existente: PedidoNoBanco, sinais: PedidoAQ, motivoDoCancelamento?: string | null): Promise<ResultadoEventoAQ> {
  const alvo = statusDoFireHubPara(sinais);
  if (alvo === "CANCELADO") return cancelarAqui(existente, motivoDoCancelamento ?? null, null);
  if (!alvo) return { concluido: true, acao: "informativo", pedidoId: existente.id };
  if (existente.status === "CANCELADO" || rank(existente.status) >= rank(alvo)) return { concluido: true, acao: "sem-mudanca", pedidoId: existente.id };
  await (prisma.customerOrder as any).update({ where: { id: existente.id }, data: { status: alvo } });
  return { concluido: true, acao: `status-${alvo}`, pedidoId: existente.id };
}

// ── Pedido novo ──────────────────────────────────────────────────────────────

async function importarPedido(inst: InstalacaoAQ, p: PedidoAQ, via: Via): Promise<ResultadoEventoAQ> {
  const orderId = texto(p.id);
  const idNoBanco = idDoPedidoAQ(inst.storeId, orderId);
  const fuso = await fusoDe(inst.franchiseeId);
  const decisao = filtroDoPedidoAQ(p, { importarDesde: inst.importarDesde, fuso });
  if (!decisao.importar) {
    if (decisao.alertar) {
      // Doc de parceiro é promessa: o que ninguém previu fica guardado como chegou.
      await guardarPayloadCru({ canal: "AIQFOME", tipo: "pedido", idNoParceiro: idNoBanco, franchiseeId: inst.franchiseeId, payload: p, avisos: [decisao.texto] });
      alertar(nomeDa(inst), `pedido #${orderId} não entrou: ${decisao.texto}`);
    }
    return { concluido: true, acao: `ignorado-${decisao.motivo}`, mensagem: decisao.texto };
  }

  const dono = await prisma.user.findUnique({ where: { id: inst.franchiseeId }, select: { id: true, storeName: true, autoAcceptOrders: true } });
  if (!dono) {
    alertar(nomeDa(inst), `a conta ${inst.franchiseeId} do FireHub ligada a esta loja não existe mais — pedido #${orderId} não entrou`);
    return { concluido: true, acao: "sem-conta", mensagem: `loja ${inst.franchiseeId} não existe` };
  }

  const traducao = traduzirPedidoAiqfome(p, {
    lojaId: dono.id,
    fuso,
    // Loja SEM CONEXÃO: o pedido não nasce aceito (lib/loja-sem-conexao-no-banco.ts).
    autoAcceptOrders: await aceitaSozinhoAgora(dono),
    storeId: inst.storeId,
    statusInicial: decisao.statusInicial,
  });
  await guardarPayloadCru({ canal: "AIQFOME", tipo: "pedido", idNoParceiro: idNoBanco, franchiseeId: dono.id, payload: p, avisos: traducao.avisos });
  if (traducao.avisos.length > 0) console.warn(`[aiqfome] ⚠️ #${orderId}: ${traducao.avisos.join(" | ")}`);

  const gravado = await gravarPedidoOpenDelivery(traducao, "aiqfome");
  if (gravado.action === "error") {
    alertar(dono.storeName || dono.id, `#${orderId}: ${gravado.message}`);
    return { concluido: false, acao: "erro", mensagem: gravado.message };
  }
  if (gravado.action === "created") await registrarPedido(inst.id, via === "polling");

  // ── O aceite para o aiqfome ─────────────────────────────────────────────
  // Só quando a loja aceita sozinha (o pedido nasceu ACEITO) e lá ainda não
  // foi lido. Quem aceita na mão manda o "lido" pelo botão (rota de status).
  const criado = criadoEm(p, fuso)?.getTime();
  const recente = criado === undefined || Date.now() - criado < JANELA_DO_ACEITE_MS;
  if (gravado.action === "created" && gravado.status === "ACEITO" && p.is_read !== true && recente) {
    const c = await acaoNoPedidoAQ(inst, "mark-as-read", orderId);
    if (!c.ok) {
      console.error(`[aiqfome] ❌ aceite (mark-as-read) de #${orderId} falhou: ${c.erro}`);
      if (c.repetir) await registrarAcaoPendente(idNoBanco, "mark-as-read", c.erro || "");
      alertar(
        dono.storeName || dono.id,
        `#${orderId}: gravado no FireHub, mas o aiqfome recusou o aceite (${c.erro}).${c.repetir ? " O FireHub tenta de novo sozinho." : " Aceite no Geraldo em até 10 min."}`,
      );
    }
  }
  return { concluido: true, acao: gravado.action, pedidoId: gravado.pedidoId };
}

// ── Um pedido (pelo id) ──────────────────────────────────────────────────────

/** Busca o pedido no aiqfome e decide: importa, muda status, ou nada. */
export async function processarPedidoAiqfome(inst: InstalacaoAQ, orderId: string, via: Via): Promise<ResultadoEventoAQ> {
  const idNoBanco = idDoPedidoAQ(inst.storeId, orderId);
  const r = await buscarPedidoAQ(inst, orderId);
  if (!r.ok) {
    if (r.status === 404) {
      console.error(`[aiqfome] ❌ pedido ${orderId} não existe em ${nomeDa(inst)} (404) — descartado`);
      return { concluido: true, acao: "descartado", mensagem: "404 no aiqfome" };
    }
    return { concluido: false, acao: "erro", mensagem: `não consegui buscar o pedido: ${r.erro}` };
  }
  const p = (r.dados || {}) as PedidoAQ;
  const daLoja = texto(p.store?.id);
  if (daLoja && daLoja !== inst.storeId) {
    await guardarPayloadCru({ canal: "AIQFOME", tipo: "pedido", idNoParceiro: idNoBanco, payload: p, avisos: [`store.id ${daLoja} ≠ loja do token ${inst.storeId}`] });
    alertar(nomeDa(inst), `o pedido ${orderId} diz ser da loja ${daLoja}, mas veio com o token da loja ${inst.storeId} — não gravado`);
    return { concluido: true, acao: "recusado", mensagem: "loja do pedido diferente da loja do token" };
  }
  if (!texto(p.id)) p.id = orderId;
  const existente = await pedidoNoBanco(idNoBanco);
  if (existente) return aplicarStatus(existente, p);
  return importarPedido(inst, p, via);
}

export type EventoAQ = { storeId: string; orderId: string; evento: string; motivo?: string | null; eventId?: string | null };

/** O sinal que cada evento do webhook traz (sem buscar nada). */
const SINAL_DO_EVENTO: Record<string, PedidoAQ> = {
  "read-order": { is_read: true },
  "ready-order": { is_read: true, is_ready: true },
  "cancel-order": { is_cancelled: true },
};

/**
 * Um aviso do webhook (ou um aviso guardado que parou no meio). Sem
 * instalação ativa NÃO grava em loja nenhuma — e conta como resolvido.
 */
export async function processarEventoAiqfome(ev: EventoAQ, via: Via): Promise<ResultadoEventoAQ> {
  const storeId = texto(ev.storeId);
  const orderId = texto(ev.orderId);
  if (!storeId || !orderId) return { concluido: true, acao: "ignorado", mensagem: "aviso sem store_id/order_id" };
  if (!aiqfomeConfigurada()) return { concluido: true, acao: "desligado", mensagem: "aiqfome sem credencial no servidor" };
  const inst = await instalacaoAtiva(storeId);
  if (!inst) {
    console.warn(`[aiqfome] aviso de pedido ${orderId} da loja ${storeId} sem instalação ativa — ignorado`);
    return { concluido: true, acao: "sem-instalacao", mensagem: `loja ${storeId} sem instalação ativa` };
  }
  if (via === "webhook") await registrarWebhook(storeId);
  if (await lojaBloqueadaPorMensalidade(inst.franchiseeId)) return { concluido: true, acao: "bloqueada", mensagem: "loja bloqueada por mensalidade" };

  // Evento de status de pedido que já está aqui: aplica sem gastar chamada
  // (o eco do nosso próprio "lido" não busca nada).
  const sinal = SINAL_DO_EVENTO[texto(ev.evento)];
  const existente = await pedidoNoBanco(idDoPedidoAQ(storeId, orderId));
  if (existente && sinal) return aplicarStatus(existente, sinal, ev.motivo);
  if (existente) return { concluido: true, acao: "ja-existe", pedidoId: existente.id };
  // Cancelado lá de um pedido que nunca entrou: nada a fazer.
  if (texto(ev.evento) === "cancel-order") return { concluido: true, acao: "cancelado-fora", mensagem: "pedido cancelado que não está no FireHub" };
  if (inst.estado === "reconectar") return { concluido: false, acao: "reconectar", mensagem: "a loja precisa reconectar o aiqfome" };
  return processarPedidoAiqfome(inst, orderId, via);
}

// ── O registro dos avisos do webhook ────────────────────────────────────────

let tabelaDeEventos: Promise<void> | null = null;
function garantirTabelaDeEventos(): Promise<void> {
  if (!tabelaDeEventos) {
    tabelaDeEventos = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "AiqfomeEvento" (
          "eventId"       TEXT PRIMARY KEY,
          "storeId"       TEXT NOT NULL,
          "orderId"       TEXT NOT NULL,
          "evento"        TEXT NOT NULL,
          "motivo"        TEXT,
          "recebidoEm"    TIMESTAMPTZ NOT NULL DEFAULT now(),
          "processadoEm"  TIMESTAMPTZ,
          "tentativas"    INT NOT NULL DEFAULT 0,
          "resultado"     TEXT
        )`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "AiqfomeEvento_parados" ON "AiqfomeEvento" ("processadoEm", "recebidoEm")`);
    })().catch((e) => {
      tabelaDeEventos = null;
      throw e;
    });
  }
  return tabelaDeEventos;
}

/**
 * A chave do aviso. O aiqfome não manda id de evento: o mesmo evento do mesmo
 * pedido com o mesmo carimbo de hora é o MESMO aviso (uma retentativa deles).
 */
export function idDoEvento(corpo: any): string {
  const d = corpo?.data && typeof corpo.data === "object" ? corpo.data : {};
  const quando = texto(d.created_at ?? d.read_at ?? d.ready_at ?? d.canceled_at ?? d.cancelled_at);
  return createHash("sha256").update(`${texto(corpo?.event)}|${texto(corpo?.store_id ?? d.store_id)}|${texto(d.order_id)}|${quando}`).digest("hex").slice(0, 40);
}

let ultimaLimpezaDeEventos = 0;

/** Guarda o aviso. "repetido" = já recebido. Falha do banco aqui NÃO impede o processamento. */
export async function registrarEventoDoWebhook(ev: EventoAQ & { eventId: string }): Promise<"novo" | "repetido" | "sem-registro"> {
  try {
    await garantirTabelaDeEventos();
    const n = await prisma.$executeRawUnsafe(
      `INSERT INTO "AiqfomeEvento" ("eventId","storeId","orderId","evento","motivo") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("eventId") DO NOTHING`,
      ev.eventId,
      texto(ev.storeId),
      texto(ev.orderId),
      texto(ev.evento),
      ev.motivo ? String(ev.motivo).slice(0, 300) : null,
    );
    if (Date.now() - ultimaLimpezaDeEventos > 60 * 60_000) {
      ultimaLimpezaDeEventos = Date.now();
      prisma.$executeRawUnsafe(`DELETE FROM "AiqfomeEvento" WHERE "recebidoEm" < now() - interval '7 days'`).catch(() => {});
    }
    return Number(n) === 1 ? "novo" : "repetido";
  } catch (e: any) {
    console.error("[aiqfome] não registrei o aviso do webhook:", e?.message);
    return "sem-registro";
  }
}

export async function marcarEvento(eventId: string, concluido: boolean, resultado: string): Promise<void> {
  try {
    await garantirTabelaDeEventos();
    await prisma.$executeRawUnsafe(
      `UPDATE "AiqfomeEvento" SET "tentativas" = "tentativas" + 1, "resultado" = $2, "processadoEm" = CASE WHEN $3 THEN now() ELSE NULL END WHERE "eventId" = $1`,
      eventId,
      String(resultado).slice(0, 300),
      concluido,
    );
  } catch (e: any) {
    console.error(`[aiqfome] não marquei o aviso ${eventId}:`, e?.message);
  }
}

/** Avisos que pararam no meio (aiqfome fora, banco fora, servidor reiniciado durante o after()). */
export async function eventosParados(): Promise<Array<EventoAQ & { eventId: string }>> {
  try {
    await garantirTabelaDeEventos();
    const linhas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "AiqfomeEvento" WHERE "processadoEm" IS NULL AND "tentativas" < 10 AND "recebidoEm" < now() - interval '1 minute' AND "recebidoEm" > now() - interval '23 hours' ORDER BY "recebidoEm" LIMIT 30`,
    );
    return linhas.map((l) => ({ eventId: String(l.eventId), storeId: String(l.storeId), orderId: String(l.orderId), evento: String(l.evento), motivo: l.motivo ?? null }));
  } catch {
    return [];
  }
}

// ── O polling ────────────────────────────────────────────────────────────────

const canceladosVistosEm = new Map<string, number>();

/**
 * Um ciclo de uma loja: os pedidos em aberto (o que falta entrar e o que
 * avançou lá) e, a cada 60 s, os cancelados. Pedido que não muda nada aqui
 * não é buscado.
 */
export async function pollingDaInstalacao(inst: InstalacaoAQ, temTempo: () => boolean): Promise<string[]> {
  const log: string[] = [];
  const nome = nomeDa(inst);
  const fuso = await fusoDe(inst.franchiseeId);
  const r = await pedidosAbertosAQ(inst);
  if (!r.ok) {
    log.push(`❌ ${nome}: pedidos em aberto — ${r.erro}`);
    return log;
  }
  for (const lite of r.dados || []) {
    if (!temTempo()) {
      log.push(`⏱️ ${nome}: o tempo do ciclo acabou — o resto fica para o próximo`);
      break;
    }
    const orderId = texto(lite?.order_id ?? lite?.id);
    if (!orderId) continue;
    if (texto(lite.store_id) && texto(lite.store_id) !== inst.storeId) continue;
    try {
      const existente = await pedidoNoBanco(idDoPedidoAQ(inst.storeId, orderId));
      if (existente) {
        const alvo = statusDoFireHubPara(lite);
        if (!alvo || existente.status === "CANCELADO" || rank(existente.status) >= rank(alvo)) continue;
        const res = await aplicarStatus(existente, lite);
        log.push(`${nome} ${orderId}: ${res.acao}`);
        continue;
      }
      // Os filtros que a versão resumida já responde, sem gastar a busca.
      if (lite.is_cancelled === true) continue;
      if (criadoAntesDe(criadoEm(lite, fuso), inst.importarDesde)) continue;
      const res = await processarPedidoAiqfome(inst, orderId, "polling");
      log.push(`${nome} ${orderId}: ${res.acao}${res.mensagem ? ` — ${res.mensagem}` : ""}`);
      if (!res.concluido && /\b429\b/.test(String(res.mensagem || ""))) break;
    } catch (e: any) {
      // Um pedido que quebra não derruba o ciclo das outras lojas nem dos outros pedidos.
      log.push(`❌ ${nome} ${orderId}: ${e?.message || e}`);
    }
  }

  const visto = canceladosVistosEm.get(inst.id) ?? 0;
  if (temTempo() && Date.now() - visto >= INTERVALO_DOS_CANCELADOS_MS) {
    const c = await pedidosCanceladosAQ(inst);
    if (c.ok) {
      canceladosVistosEm.set(inst.id, Date.now());
      for (const x of c.dados || []) {
        const orderId = texto(x.order_id);
        if (!orderId || (texto(x.store_id) && texto(x.store_id) !== inst.storeId)) continue;
        const existente = await pedidoNoBanco(idDoPedidoAQ(inst.storeId, orderId)).catch(() => null);
        if (!existente || existente.status === "CANCELADO") continue;
        const res = await cancelarAqui(existente, x.reason ?? null, x.cancelled_by ?? null);
        log.push(`${nome} ${orderId}: ${res.acao}`);
      }
    } else {
      log.push(`❌ ${nome}: cancelados — ${c.erro}`);
    }
  }
  return log;
}

/** Repete os avisos que falharam, na ordem, parando o pedido no primeiro que falhar. */
export async function repetirAcoesPendentesAiqfome(temTempo: () => boolean): Promise<string[]> {
  const log: string[] = [];
  const travados = new Set<string>();
  for (const p of await acoesPendentes()) {
    if (!temTempo()) break;
    if (travados.has(p.pedidoId)) continue;
    const id = lerIdDoPedidoAQ(p.pedidoId);
    if (!id) {
      await marcarTentativa(p.id, true, "id do pedido ilegível");
      continue;
    }
    const inst = await instalacaoAtiva(id.storeId);
    if (!inst || !aiqfomeConfigurada()) {
      await marcarTentativa(p.id, true, "instalação desligada");
      log.push(`↻ ${p.acao} ${p.pedidoId}: instalação desligada — descartado`);
      continue;
    }
    const r = await acaoNoPedidoAQ(inst, p.acao as AcaoAQ, id.orderId);
    await marcarTentativa(p.id, r.ok || !r.repetir, r.ok ? undefined : r.erro);
    if (!r.ok) travados.add(p.pedidoId);
    log.push(`↻ ${p.acao} ${p.pedidoId}: ${r.ok ? (r.jaEstava ? "já estava" : "ok") : r.erro}`);
  }
  return log;
}

/** O ciclo inteiro do cron: lojas, avisos parados, ações pendentes. */
export async function cicloDoAiqfome(opts: { prazoMs?: number } = {}): Promise<{ lojas: number; log: string[] }> {
  const inicio = Date.now();
  const temTempo = () => Date.now() - inicio < (opts.prazoMs ?? 45_000);
  const log: string[] = [];
  let lojas = 0;
  for (const inst of await instalacoesAtivas()) {
    if (!temTempo()) {
      log.push("⏱️ o tempo do ciclo acabou antes de todas as lojas");
      break;
    }
    if (inst.estado === "reconectar") {
      log.push(`🔌 ${nomeDa(inst)}: precisa reconectar — fora do polling`);
      continue;
    }
    if (await lojaBloqueadaPorMensalidade(inst.franchiseeId)) {
      log.push(`[bloqueio] ${nomeDa(inst)}: loja bloqueada por mensalidade — fora do polling`);
      continue;
    }
    lojas++;
    try {
      log.push(...(await pollingDaInstalacao(inst, temTempo)));
    } catch (e: any) {
      log.push(`❌ ${nomeDa(inst)}: ${e?.message || e}`);
    }
  }
  for (const ev of await eventosParados()) {
    if (!temTempo()) break;
    const res = await processarEventoAiqfome(ev, "reprocesso").catch((e: any) => ({ concluido: false, acao: "erro", mensagem: String(e?.message || e) }) as ResultadoEventoAQ);
    await marcarEvento(ev.eventId, res.concluido, res.acao + (res.mensagem ? ` — ${res.mensagem}` : ""));
    log.push(`↺ aviso ${ev.evento} ${ev.orderId}: ${res.acao}`);
  }
  log.push(...(await repetirAcoesPendentesAiqfome(temTempo).catch((e: any) => [`❌ ações pendentes: ${e?.message || e}`])));
  return { lojas, log };
}
