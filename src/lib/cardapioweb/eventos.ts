/**
 * lib/cardapioweb/eventos.ts — aviso do CardápioWeb (webhook ou polling) vira pedido ou status no FireHub.
 *
 * ── Os dois caminhos ────────────────────────────────────────────────────────
 *
 * O webhook do CardápioWeb traz SÓ ids (`event_id`, `merchant_id`, `order_id`,
 * `order_status`). A rota responde 200 na hora — o CardápioWeb dá 5 s, e
 * depois de 15 falhas PAUSA o webhook para sempre (só volta por e-mail) — e o
 * trabalho de verdade roda depois da resposta, aqui: busca o pedido, filtra,
 * traduz, grava (impressão, KDS) e, se a loja aceita sozinha, confirma lá.
 *
 * O polling de 30 s (`GET /orders?updated_since`) é a rede principal, não um
 * enfeite: ele acha o que o webhook perdeu, aplica cancelamentos, reprocessa
 * os avisos que pararam no meio e repete as ações pendentes. O mesmo pedido
 * chegando pelos dois é um pedido só (idempotência pelo `openDeliveryOrderId`
 * em lib/open-delivery/gravar.ts).
 *
 * ── Regras que vieram dos outros canais ─────────────────────────────────────
 *
 *   - A loja do pedido sai SÓ da instalação ativa do `merchant_id` (nunca
 *     "a primeira loja ativa"). Pedido cujo `merchant_id` diz outra loja que a
 *     do token não grava.
 *   - Status do CardápioWeb só AVANÇA o pedido aqui; cancelado cancela (com o
 *     aviso de NFC-e já emitida, como na Keeta).
 *   - "Confirmar" só pedido recente e só se a loja aceita sozinha: a fila de
 *     histórico da primeira conexão não é confirmada em massa (iFood).
 *   - Falha depois de gravar não é falha de pedido: o confirm recusado vai
 *     para a fila de pendentes, e o pedido continua na cozinha.
 */
import { prisma } from "@/lib/prisma";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { gravarPedidoOpenDelivery } from "@/lib/open-delivery/gravar";
import { guardarPayloadCru } from "@/lib/open-delivery/payload-cru";
import { aceitaSozinhoAgora } from "@/lib/loja-sem-conexao-no-banco";
import { lojaBloqueadaPorMensalidade } from "@/lib/loja-bloqueada";
import { acaoNoPedidoCW, ambienteConfigurado, buscarPedidoCW, pedidosAlteradosCW, type AcaoCW, type AmbienteCW } from "./api";
import {
  gravarCursor,
  instalacaoAtiva,
  instalacoesAtivas,
  recebeMarketplaces,
  registrarPedido,
  registrarWebhook,
  type InstalacaoCW,
} from "./instalacoes";
import { idDoPedidoCW, lerIdDoPedidoCW } from "./id-do-pedido";
import { RANK_DO_FIREHUB, ehCanalDeMarketplaceCW, filtroDoPedidoCW, statusDoFireHubPara, traduzirPedidoCardapioWeb, type PedidoCW } from "./traducao";
import { acoesPendentes, marcarTentativa, registrarAcaoPendente } from "./acoes-pendentes";

export type ResultadoEventoCW = {
  /** O aviso está resolvido (gravou, ou não precisa de nada). false = tentar de novo depois. */
  concluido: boolean;
  acao: string;
  mensagem?: string;
  pedidoId?: string;
};

/** Confirm só para pedido recente: fila velha confirmada de uma vez é o erro do iFood. */
const JANELA_DO_CONFIRM_MS = 30 * 60_000;

const texto = (v: unknown) => (v == null ? "" : String(v).trim());
const minusc = (v: unknown) => texto(v).toLowerCase();

function data(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

function alertar(loja: string, detalhe: string) {
  import("@/lib/server-monitor")
    .then((m) => m.alertarFalhaDeIntegracao("CardápioWeb", loja, detalhe))
    .catch(() => {});
}

const nomeDa = (inst: InstalacaoCW) => `${inst.nome || `loja ${inst.companyId}`}${inst.ambiente === "sandbox" ? " (sandbox)" : ""}`;

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

/** O status do CardápioWeb pede mudança neste pedido do FireHub? (Sem buscar nada.) */
function mudaria(existente: PedidoNoBanco, statusCW: string): boolean {
  const s = minusc(statusCW);
  if (s === "canceled") return existente.status !== "CANCELADO";
  if (s === "canceling") return !String(existente.notes || "").includes(LINHA_CANCELANDO);
  const alvo = statusDoFireHubPara(s);
  return Boolean(alvo) && rank(existente.status) < rank(alvo);
}

const LINHA_CANCELANDO = "⏳ Cancelamento em andamento no CardápioWeb";

// ── Status de lá → aqui ──────────────────────────────────────────────────────

async function aplicarStatus(existente: PedidoNoBanco, p: PedidoCW): Promise<ResultadoEventoCW> {
  const s = minusc(p.status);
  if (s === "canceled") {
    if (existente.status === "CANCELADO") return { concluido: true, acao: "ja-cancelado", pedidoId: existente.id };
    const motivo = texto(p.cancellation_reason) || "Cancelado no CardápioWeb";
    await (prisma.customerOrder as any).update({
      where: { id: existente.id },
      data: {
        status: "CANCELADO",
        cancelledAt: new Date(),
        cancelReason: motivo,
        // Quem cancelou primeiro foi a loja (o cancel saiu daqui) → continua
        // LOJA, senão o relatório culpa o canal errado (regra da Brendi).
        ...(existente.cancelledBy === "LOJA" ? {} : { cancelledBy: "CARDAPIOWEB" }),
        cancelDispute: { pending: false },
        notes: linhaNasNotas(existente.notes, `❌ Cancelado no CardápioWeb: ${motivo}`),
      },
    });
    import("@/lib/fiscal-automatico").then((m) => m.alertarCancelamentoComNota({ id: existente.id }, "CardápioWeb")).catch(() => {});
    return { concluido: true, acao: "cancelado", pedidoId: existente.id };
  }
  if (s === "canceling") {
    // Cartão online em estorno: vai para "canceled" ou volta ao que era. Só avisa.
    await (prisma.customerOrder as any).update({
      where: { id: existente.id },
      data: { notes: linhaNasNotas(existente.notes, `${LINHA_CANCELANDO} (pagamento online) — confira antes de seguir`) },
    });
    return { concluido: true, acao: "cancelando", pedidoId: existente.id };
  }
  const alvo = statusDoFireHubPara(s);
  if (!alvo) return { concluido: true, acao: "informativo", pedidoId: existente.id };
  if (rank(existente.status) >= rank(alvo)) return { concluido: true, acao: "sem-mudanca", pedidoId: existente.id };
  await (prisma.customerOrder as any).update({ where: { id: existente.id }, data: { status: alvo } });
  return { concluido: true, acao: `status-${alvo}`, pedidoId: existente.id };
}

// ── Pedido novo ──────────────────────────────────────────────────────────────

async function importarPedido(inst: InstalacaoCW, p: PedidoCW, via: Via): Promise<ResultadoEventoCW> {
  const orderId = texto(p.id);
  const idNoBanco = idDoPedidoCW(inst.ambiente, inst.companyId, orderId);
  const receber = await recebeMarketplaces(inst.franchiseeId);
  const decisao = filtroDoPedidoCW(p, { receberMarketplaces: receber, importarDesde: inst.importarDesde });
  if (!decisao.importar) {
    if (decisao.alertar) {
      // Doc de parceiro é promessa: o que ninguém previu fica guardado como
      // chegou, para o conserto ser por leitura e não por dedução.
      await guardarPayloadCru({ canal: "CARDAPIOWEB", tipo: "pedido", idNoParceiro: idNoBanco, franchiseeId: inst.franchiseeId, payload: p, avisos: [decisao.texto] });
      alertar(nomeDa(inst), `pedido #${texto(p.display_id) || orderId} não entrou: ${decisao.texto}`);
    }
    return { concluido: true, acao: `ignorado-${decisao.motivo}`, mensagem: decisao.texto };
  }

  // Rede extra com a opção de marketplace ligada: o mesmo pedido do iFood/99
  // que já entrou direto no FireHub não entra de novo pelo CardápioWeb.
  const externo = texto(p.external_order_id);
  if (decisao.marketplace && externo) {
    const ja = await prisma.customerOrder.findFirst({
      where: { franchiseeId: inst.franchiseeId, OR: [{ ifoodOrderId: externo }, { openDeliveryOrderId: externo }] } as any,
      select: { id: true },
    });
    if (ja) return { concluido: true, acao: "ja-entrou-direto", pedidoId: ja.id, mensagem: `o pedido ${externo} do ${decisao.marketplace} já entrou direto` };
  }

  const dono = await prisma.user.findUnique({ where: { id: inst.franchiseeId }, select: { id: true, storeName: true, autoAcceptOrders: true } });
  if (!dono) {
    alertar(nomeDa(inst), `a conta ${inst.franchiseeId} do FireHub ligada a esta loja não existe mais — pedido #${texto(p.display_id) || orderId} não entrou`);
    return { concluido: true, acao: "sem-conta", mensagem: `loja ${inst.franchiseeId} não existe` };
  }

  const traducao = traduzirPedidoCardapioWeb(p, {
    lojaId: dono.id,
    fuso: await fusoDaLoja(dono.id),
    // Loja SEM CONEXÃO: o pedido não nasce aceito (lib/loja-sem-conexao-no-banco.ts).
    autoAcceptOrders: await aceitaSozinhoAgora(dono),
    ambiente: inst.ambiente,
    companyId: inst.companyId,
    statusInicial: decisao.statusInicial,
    marketplace: decisao.marketplace,
  });
  await guardarPayloadCru({ canal: "CARDAPIOWEB", tipo: "pedido", idNoParceiro: idNoBanco, franchiseeId: dono.id, payload: p, avisos: traducao.avisos });
  if (traducao.avisos.length > 0) console.warn(`[CardápioWeb] ⚠️ #${texto(p.display_id) || orderId}: ${traducao.avisos.join(" | ")}`);

  const gravado = await gravarPedidoOpenDelivery(traducao, "CardápioWeb");
  if (gravado.action === "error") {
    alertar(dono.storeName || dono.id, `#${texto(p.display_id) || orderId}: ${gravado.message}`);
    return { concluido: false, acao: "erro", mensagem: gravado.message };
  }
  if (gravado.action === "created") await registrarPedido(inst.id, via === "polling");

  // ── O "recebi" para o CardápioWeb ───────────────────────────────────────
  // Só quando a loja aceita sozinha (o pedido nasceu ACEITO) e lá ainda
  // espera. Quem aceita na mão manda o confirm pelo botão (rota de status).
  const criado = data(p.created_at)?.getTime();
  const recente = criado === undefined ? true : Date.now() - criado < JANELA_DO_CONFIRM_MS;
  if (gravado.action === "created" && gravado.status === "ACEITO" && minusc(p.status) === "waiting_confirmation" && recente) {
    const c = await acaoNoPedidoCW(inst, "confirm", orderId);
    if (!c.ok) {
      console.error(`[CardápioWeb] ❌ confirm de #${texto(p.display_id) || orderId} falhou: ${c.erro}`);
      if (c.repetir) await registrarAcaoPendente(idNoBanco, "confirm", null, c.erro || "");
      alertar(dono.storeName || dono.id, `#${texto(p.display_id) || orderId}: gravado no FireHub, mas o CardápioWeb recusou o aceite (${c.erro}).${c.repetir ? " O FireHub tenta de novo sozinho." : " Aceite no portal do CardápioWeb."}`);
    }
  }
  return { concluido: true, acao: gravado.action, pedidoId: gravado.pedidoId };
}

// ── Um pedido (pelo id) ──────────────────────────────────────────────────────

export type Via = "webhook" | "polling" | "reprocesso";

/** Busca o pedido no CardápioWeb e decide: importa, muda status, ou nada. */
export async function processarPedidoCardapioWeb(inst: InstalacaoCW, orderId: string, via: Via): Promise<ResultadoEventoCW> {
  const idNoBanco = idDoPedidoCW(inst.ambiente, inst.companyId, orderId);
  const r = await buscarPedidoCW(inst, orderId);
  if (!r.ok) {
    if (r.status === 404) {
      // Id que o CardápioWeb não reconhece nunca vai existir: segurar só repetiria a falha.
      console.error(`[CardápioWeb] ❌ pedido ${orderId} não existe em ${nomeDa(inst)} (404) — descartado`);
      return { concluido: true, acao: "descartado", mensagem: "404 no CardápioWeb" };
    }
    return { concluido: false, acao: "erro", mensagem: `não consegui buscar o pedido: ${r.erro}` };
  }
  const p = (r.dados || {}) as PedidoCW;
  const daLoja = texto(p.merchant_id);
  if (daLoja && daLoja !== inst.companyId) {
    await guardarPayloadCru({ canal: "CARDAPIOWEB", tipo: "pedido", idNoParceiro: idNoBanco, payload: p, avisos: [`merchant_id ${daLoja} ≠ loja do token ${inst.companyId}`] });
    alertar(nomeDa(inst), `o pedido ${orderId} diz ser da loja ${daLoja}, mas veio com o token da loja ${inst.companyId} — não gravado`);
    return { concluido: true, acao: "recusado", mensagem: "loja do pedido diferente da loja do token" };
  }
  if (!texto(p.id)) p.id = orderId;
  const existente = await pedidoNoBanco(idNoBanco);
  if (existente) return aplicarStatus(existente, p);
  return importarPedido(inst, p, via);
}

export type EventoCW = { ambiente: AmbienteCW; merchantId: string; orderId: string; eventType?: string | null; orderStatus?: string | null; eventId?: string | null };

/**
 * Um aviso do webhook (ou um aviso guardado que parou no meio). Sem instalação
 * ativa NÃO grava em loja nenhuma — e conta como resolvido: sem token não há
 * nem como ler o pedido, e o polling da loja (quando ela ligar) cuida.
 */
export async function processarEventoCardapioWeb(ev: EventoCW, via: Via): Promise<ResultadoEventoCW> {
  const merchantId = texto(ev.merchantId);
  const orderId = texto(ev.orderId);
  if (!merchantId || !orderId) return { concluido: true, acao: "ignorado", mensagem: "aviso sem merchant_id/order_id" };
  if (!ambienteConfigurado(ev.ambiente)) return { concluido: true, acao: "desligado", mensagem: `CardápioWeb (${ev.ambiente}) sem credencial no servidor` };
  const inst = await instalacaoAtiva(ev.ambiente, merchantId);
  if (!inst) {
    console.warn(`[CardápioWeb] aviso de pedido ${orderId} da loja ${merchantId} (${ev.ambiente}) sem instalação ativa — ignorado`);
    return { concluido: true, acao: "sem-instalacao", mensagem: `loja ${merchantId} sem instalação ativa` };
  }
  if (via === "webhook") await registrarWebhook(ev.ambiente, merchantId);
  // Loja bloqueada por mensalidade (lib/loja-bloqueada.ts): não processa; o
  // pedido fica no portal do CardápioWeb.
  if (await lojaBloqueadaPorMensalidade(inst.franchiseeId)) return { concluido: true, acao: "bloqueada", mensagem: "loja bloqueada por mensalidade" };
  // Token morto: o aviso espera a reconexão (o reprocesso guarda 23 h).
  if (inst.estado === "reconectar") return { concluido: false, acao: "reconectar", mensagem: "a loja precisa reconectar o CardápioWeb" };

  // Aviso que não muda nada (o eco do nosso próprio confirm, por exemplo) não
  // gasta chamada no limite de 300/3 min.
  const statusDoAviso = minusc(ev.orderStatus);
  if (statusDoAviso) {
    const existente = await pedidoNoBanco(idDoPedidoCW(inst.ambiente, inst.companyId, orderId));
    if (existente && !mudaria(existente, statusDoAviso)) return { concluido: true, acao: "sem-mudanca", pedidoId: existente.id };
  }
  return processarPedidoCardapioWeb(inst, orderId, via);
}

// ── O registro dos avisos do webhook ────────────────────────────────────────

let tabelaDeEventos: Promise<void> | null = null;
function garantirTabelaDeEventos(): Promise<void> {
  if (!tabelaDeEventos) {
    tabelaDeEventos = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CardapioWebEvento" (
          "eventId"       TEXT PRIMARY KEY,
          "ambiente"      TEXT NOT NULL,
          "merchantId"    TEXT NOT NULL,
          "orderId"       TEXT NOT NULL,
          "eventType"     TEXT,
          "orderStatus"   TEXT,
          "recebidoEm"    TIMESTAMPTZ NOT NULL DEFAULT now(),
          "processadoEm"  TIMESTAMPTZ,
          "tentativas"    INT NOT NULL DEFAULT 0,
          "resultado"     TEXT
        )`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "CardapioWebEvento_parados" ON "CardapioWebEvento" ("processadoEm", "recebidoEm")`);
    })().catch((e) => {
      tabelaDeEventos = null;
      throw e;
    });
  }
  return tabelaDeEventos;
}

let ultimaLimpezaDeEventos = 0;

/**
 * Guarda o aviso (o `event_id` é a chave: o CardápioWeb reenvia o mesmo até 15
 * vezes). "repetido" = já recebido, não processa de novo. Falha do banco aqui
 * NÃO impede o processamento: o pedido é idempotente, o registro é só o
 * caminho de volta para o reprocesso.
 */
export async function registrarEventoDoWebhook(ev: EventoCW & { eventId: string }): Promise<"novo" | "repetido" | "sem-registro"> {
  try {
    await garantirTabelaDeEventos();
    const n = await prisma.$executeRawUnsafe(
      `INSERT INTO "CardapioWebEvento" ("eventId","ambiente","merchantId","orderId","eventType","orderStatus") VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ("eventId") DO NOTHING`,
      ev.eventId,
      ev.ambiente,
      texto(ev.merchantId),
      texto(ev.orderId),
      ev.eventType ?? null,
      ev.orderStatus ?? null,
    );
    if (Date.now() - ultimaLimpezaDeEventos > 60 * 60_000) {
      ultimaLimpezaDeEventos = Date.now();
      prisma.$executeRawUnsafe(`DELETE FROM "CardapioWebEvento" WHERE "recebidoEm" < now() - interval '7 days'`).catch(() => {});
    }
    return Number(n) === 1 ? "novo" : "repetido";
  } catch (e: any) {
    console.error("[CardápioWeb] não registrei o aviso do webhook:", e?.message);
    return "sem-registro";
  }
}

export async function marcarEvento(eventId: string, concluido: boolean, resultado: string): Promise<void> {
  try {
    await garantirTabelaDeEventos();
    await prisma.$executeRawUnsafe(
      `UPDATE "CardapioWebEvento" SET "tentativas" = "tentativas" + 1, "resultado" = $2, "processadoEm" = CASE WHEN $3 THEN now() ELSE NULL END WHERE "eventId" = $1`,
      eventId,
      String(resultado).slice(0, 300),
      concluido,
    );
  } catch (e: any) {
    console.error(`[CardápioWeb] não marquei o aviso ${eventId}:`, e?.message);
  }
}

/** Avisos que pararam no meio (CardápioWeb fora, banco fora, servidor reiniciado durante o after()). */
export async function eventosParados(): Promise<Array<EventoCW & { eventId: string }>> {
  try {
    await garantirTabelaDeEventos();
    const linhas = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "CardapioWebEvento" WHERE "processadoEm" IS NULL AND "tentativas" < 10 AND "recebidoEm" < now() - interval '1 minute' AND "recebidoEm" > now() - interval '23 hours' ORDER BY "recebidoEm" LIMIT 30`,
    );
    return linhas.map((l) => ({
      eventId: String(l.eventId),
      ambiente: l.ambiente === "sandbox" ? "sandbox" : "producao",
      merchantId: String(l.merchantId),
      orderId: String(l.orderId),
      eventType: l.eventType ?? null,
      orderStatus: l.orderStatus ?? null,
    }));
  } catch {
    return [];
  }
}

// ── O polling ────────────────────────────────────────────────────────────────

/** O CardápioWeb recusa `updated_since` de mais de 24 h; a folga cobre relógio e fila. */
const JANELA_MAXIMA_MS = 23 * 60 * 60_000 + 50 * 60_000;
const MARGEM_DO_CURSOR_MS = 60_000;

/**
 * Um ciclo de uma loja: os pedidos alterados desde o cursor. Pedido que não
 * muda nada aqui não é buscado (o limite é de 300 chamadas a cada 3 min por
 * loja). O cursor só anda quando o ciclo inteiro deu certo — o que falhou
 * volta na lista do próximo.
 */
export async function pollingDaInstalacao(inst: InstalacaoCW, temTempo: () => boolean): Promise<string[]> {
  const log: string[] = [];
  const nome = nomeDa(inst);
  const inicio = new Date();
  const base = inst.cursorDoPolling ?? inst.importarDesde ?? new Date(inicio.getTime() - 10 * 60_000);
  const desde = new Date(Math.max(base.getTime() - MARGEM_DO_CURSOR_MS, inicio.getTime() - JANELA_MAXIMA_MS));
  const r = await pedidosAlteradosCW(inst, desde);
  if (!r.ok) {
    log.push(`❌ ${nome}: lista de pedidos — ${r.erro}`);
    return log;
  }
  const receber = await recebeMarketplaces(inst.franchiseeId);
  let tudoCerto = true;
  for (const lite of r.dados || []) {
    if (!temTempo()) {
      tudoCerto = false;
      log.push(`⏱️ ${nome}: o tempo do ciclo acabou — o resto fica para o próximo`);
      break;
    }
    const orderId = texto(lite?.id);
    if (!orderId) continue;
    const s = minusc(lite.status);
    try {
      const existente = await pedidoNoBanco(idDoPedidoCW(inst.ambiente, inst.companyId, orderId));
      if (existente) {
        if (!mudaria(existente, s)) continue;
      } else {
        // Os filtros que a versão resumida já responde, sem gastar a busca.
        if (minusc(lite.order_type) === "closed_table") continue;
        const criado = data(lite.created_at);
        if (criado && criado.getTime() < inst.importarDesde.getTime()) continue;
        if (["canceled", "canceling", "pending_payment", "pending_online_payment"].includes(s)) continue;
        // Marketplace repassado, com a opção desligada: nem busca. Canal que
        // ninguém conhece é buscado — o filtro completo guarda e avisa.
        if (!receber && ehCanalDeMarketplaceCW(lite.sales_channel)) continue;
      }
      const res = await processarPedidoCardapioWeb(inst, orderId, "polling");
      if (res.acao !== "sem-mudanca") log.push(`${nome} ${orderId} (${s}): ${res.acao}${res.mensagem ? ` — ${res.mensagem}` : ""}`);
      if (!res.concluido) {
        tudoCerto = false;
        // Limite estourado: o resto desta loja espera o próximo ciclo.
        if (/\b429\b/.test(String(res.mensagem || ""))) break;
      }
    } catch (e: any) {
      // Um pedido que quebra não derruba o ciclo das outras lojas nem dos
      // outros pedidos; o cursor fica, e ele volta no próximo.
      tudoCerto = false;
      log.push(`❌ ${nome} ${orderId}: ${e?.message || e}`);
    }
  }
  if (tudoCerto) await gravarCursor(inst.id, inicio).catch(() => {});
  return log;
}

/** Repete os avisos que falharam (lib/cardapioweb/acoes-pendentes.ts), na ordem, parando o pedido no primeiro que falhar. */
export async function repetirAcoesPendentesCardapioWeb(temTempo: () => boolean): Promise<string[]> {
  const log: string[] = [];
  const travados = new Set<string>();
  for (const p of await acoesPendentes()) {
    if (!temTempo()) break;
    if (travados.has(p.pedidoId)) continue;
    const id = lerIdDoPedidoCW(p.pedidoId);
    if (!id) {
      await marcarTentativa(p.id, true, "id do pedido ilegível");
      continue;
    }
    const inst = await instalacaoAtiva(id.ambiente, id.companyId);
    if (!inst || !ambienteConfigurado(id.ambiente)) {
      await marcarTentativa(p.id, true, "instalação desligada");
      log.push(`↻ ${p.acao} ${p.pedidoId}: instalação desligada — descartado`);
      continue;
    }
    const corpo = p.corpo && typeof p.corpo === "object" ? p.corpo : undefined;
    const r = await acaoNoPedidoCW(inst, p.acao as AcaoCW, id.orderId, corpo);
    await marcarTentativa(p.id, r.ok || !r.repetir, r.ok ? undefined : r.erro);
    if (!r.ok) travados.add(p.pedidoId);
    log.push(`↻ ${p.acao} ${p.pedidoId}: ${r.ok ? (r.jaEstava ? "já estava" : "ok") : r.erro}`);
  }
  return log;
}

/** O ciclo inteiro do cron: lojas, avisos parados, ações pendentes. */
export async function cicloDoCardapioWeb(opts: { prazoMs?: number } = {}): Promise<{ lojas: number; log: string[] }> {
  const inicio = Date.now();
  const temTempo = () => Date.now() - inicio < (opts.prazoMs ?? 45_000);
  const log: string[] = [];
  let lojas = 0;
  for (const inst of await instalacoesAtivas()) {
    if (!temTempo()) {
      log.push("⏱️ o tempo do ciclo acabou antes de todas as lojas");
      break;
    }
    if (!ambienteConfigurado(inst.ambiente)) continue;
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
    const res = await processarEventoCardapioWeb(ev, "reprocesso").catch((e: any) => ({ concluido: false, acao: "erro", mensagem: String(e?.message || e) }) as ResultadoEventoCW);
    await marcarEvento(ev.eventId, res.concluido, res.acao + (res.mensagem ? ` — ${res.mensagem}` : ""));
    log.push(`↺ aviso ${ev.eventId} (${ev.orderId}): ${res.acao}`);
  }
  log.push(...(await repetirAcoesPendentesCardapioWeb(temTempo).catch((e: any) => [`❌ ações pendentes: ${e?.message || e}`])));
  return { lojas, log };
}
