/**
 * lib/anotaai/eventos.ts — o polling do Anota AI: pedido novo entra, status de lá chega aqui.
 *
 * ── Só polling ──────────────────────────────────────────────────────────────
 *
 * A API v2 do Anota AI tem `GET /ping/list` (pedidos do dia) e `GET
 * /ping/get/{id}` (o pedido inteiro), e a própria doc recomenda ler a lista a
 * cada ~30 s. Existe cadastro de webhook, mas o formato do aviso e a
 * assinatura NÃO estão documentados — aviso sem como provar a origem não entra
 * aqui. O ciclo de 30 s (cron `anotaai-poll`) é o caminho inteiro.
 *
 * Um ciclo de cada loja (página):
 *
 *   1. Lista os pedidos do dia (check 0–3, sem iFood) e os cancelados (check 4).
 *   2. Pedido que o FireHub não tem: busca, filtra, traduz, grava (impressão,
 *      KDS) e, se a loja aceita sozinha, aceita lá — o Anota AI NEGA o pedido
 *      que fica 15 min sem aceite.
 *   3. Pedido que o FireHub tem: o `check` de lá só AVANÇA o daqui; cancelado
 *      cancela (com o aviso de NFC-e já emitida).
 *   4. Pedido daqui que sumiu das duas listas (negado em 15 min, agendado
 *      aceito, cancelamento interno): busca um por um, com freio.
 *   5. Repete as ações pendentes (lib/anotaai/acoes-pendentes.ts).
 *
 * A loja do pedido sai SÓ da página vinculada (x-page-id): nunca "a primeira
 * loja ativa".
 */
import { prisma } from "@/lib/prisma";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { gravarPedidoOpenDelivery } from "@/lib/open-delivery/gravar";
import { guardarPayloadCru } from "@/lib/open-delivery/payload-cru";
import { aceitaSozinhoAgora } from "@/lib/loja-sem-conexao-no-banco";
import { lojaBloqueadaPorMensalidade } from "@/lib/loja-bloqueada";
import { acaoNoPedidoAnotaAi, anotaAiConfigurado, buscarPedidoAnotaAi, listarPedidosAnotaAi, type AcaoAnotaAi, type ResumoAnotaAi } from "./api";
import { lojaAnotaAiAtiva, lojasAnotaAiAtivas, registrarPollingAnotaAi, type LojaAnotaAi } from "./lojas";
import { idDoPedidoAnotaAi, lerIdDoPedidoAnotaAi } from "./id-do-pedido";
import { RANK_DO_FIREHUB, checkDo, ehMesaAnotaAi, filtroDoPedidoAnotaAi, statusDoFireHubParaCheck, traduzirPedidoAnotaAi, type PedidoAnotaAi } from "./traducao";
import { acoesPendentes, marcarTentativa, registrarAcaoPendente } from "./acoes-pendentes";

export type ResultadoAnotaAi = { concluido: boolean; acao: string; mensagem?: string; pedidoId?: string };

/** Aceite automático só para pedido recente: fila velha aceita de uma vez é o erro do iFood. */
const JANELA_DO_ACEITE_MS = 14 * 60_000;
/** Pedido daqui que sumiu das listas: no máximo este tanto de buscas por loja por ciclo, e cada um no máximo a cada 2 min. */
const BUSCAS_DE_SUMIDOS = 10;
const INTERVALO_DO_SUMIDO_MS = 2 * 60_000;

const texto = (v: unknown) => (v == null ? "" : String(v).trim());
const minusc = (v: unknown) => texto(v).toLowerCase();

function data(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

function alertar(loja: string, detalhe: string) {
  import("@/lib/server-monitor")
    .then((m) => m.alertarFalhaDeIntegracao("Anota AI", loja, detalhe))
    .catch(() => {});
}

const nomeDa = (l: LojaAnotaAi) => l.nome || `página ${l.pageId}`;

/**
 * Pedido do dia que já foi decidido como "não entra" (mesa, de antes da
 * conexão…): a lista do dia traz ele a cada ciclo, e buscar de novo gastaria
 * chamada à toa. Memória do processo — no restart, cada um é buscado uma vez.
 */
const decididos = new Map<string, number>();
const ultimaBuscaDoSumido = new Map<string, number>();

function lembrar(mapa: Map<string, number>, chave: string) {
  mapa.set(chave, Date.now());
  if (mapa.size > 5000) {
    const corte = Date.now() - 24 * 60 * 60_000;
    for (const [k, t] of mapa) if (t < corte) mapa.delete(k);
  }
}

type PedidoNoBanco = { id: string; status: string; notes: string | null; cancelledBy: string | null };

async function pedidoNoBanco(idNoBanco: string): Promise<PedidoNoBanco | null> {
  return (await prisma.customerOrder.findFirst({
    where: { openDeliveryOrderId: idNoBanco } as any,
    select: { id: true, status: true, notes: true, cancelledBy: true } as any,
  })) as any;
}

function linhaNasNotas(notes: string | null | undefined, linha: string): string {
  const atual = String(notes || "");
  return atual.includes(linha) ? atual : [atual, linha].filter(Boolean).join("\n");
}

const rank = (status: string | null | undefined) => RANK_DO_FIREHUB[String(status || "").toUpperCase()] ?? 0;

const LINHA_PEDIDO_DE_CANCELAMENTO = "⏳ Pedido de cancelamento no Anota AI — confira antes de seguir";

/** O `check` de lá pede mudança neste pedido daqui? (Sem buscar nada.) */
function mudaria(existente: PedidoNoBanco, check: number | null): boolean {
  if (check === 6) return !String(existente.notes || "").includes(LINHA_PEDIDO_DE_CANCELAMENTO);
  const alvo = statusDoFireHubParaCheck(check);
  if (alvo === "CANCELADO") return existente.status !== "CANCELADO";
  return Boolean(alvo) && existente.status !== "CANCELADO" && rank(existente.status) < rank(alvo);
}

// ── Status de lá → aqui ──────────────────────────────────────────────────────

async function aplicarStatus(existente: PedidoNoBanco, check: number | null): Promise<ResultadoAnotaAi> {
  if (check === 6) {
    await (prisma.customerOrder as any).update({ where: { id: existente.id }, data: { notes: linhaNasNotas(existente.notes, LINHA_PEDIDO_DE_CANCELAMENTO) } });
    return { concluido: true, acao: "pedido-de-cancelamento", pedidoId: existente.id };
  }
  const alvo = statusDoFireHubParaCheck(check);
  if (alvo === "CANCELADO") {
    if (existente.status === "CANCELADO") return { concluido: true, acao: "ja-cancelado", pedidoId: existente.id };
    const motivo = check === 5 ? "Negado no Anota AI (15 min sem aceite)" : "Cancelado no Anota AI";
    await (prisma.customerOrder as any).update({
      where: { id: existente.id },
      data: {
        status: "CANCELADO",
        cancelledAt: new Date(),
        cancelReason: motivo,
        // Quem cancelou primeiro foi a loja (o cancel saiu daqui) → continua
        // LOJA, senão o relatório culpa o canal errado (regra da Brendi).
        ...(existente.cancelledBy === "LOJA" ? {} : { cancelledBy: "ANOTAAI" }),
        notes: linhaNasNotas(existente.notes, `❌ ${motivo}`),
      },
    });
    import("@/lib/fiscal-automatico").then((m) => m.alertarCancelamentoComNota({ id: existente.id }, "Anota AI")).catch(() => {});
    return { concluido: true, acao: "cancelado", pedidoId: existente.id };
  }
  if (!alvo || existente.status === "CANCELADO") return { concluido: true, acao: "informativo", pedidoId: existente.id };
  if (rank(existente.status) >= rank(alvo)) return { concluido: true, acao: "sem-mudanca", pedidoId: existente.id };
  await (prisma.customerOrder as any).update({ where: { id: existente.id }, data: { status: alvo } });
  return { concluido: true, acao: `status-${alvo}`, pedidoId: existente.id };
}

// ── Pedido novo ──────────────────────────────────────────────────────────────

async function importarPedido(loja: LojaAnotaAi, p: PedidoAnotaAi): Promise<ResultadoAnotaAi> {
  const orderId = texto(p._id ?? p.id);
  const idNoBanco = idDoPedidoAnotaAi(loja.pageId, orderId);
  const numero = texto(p.shortReference) || orderId;
  const decisao = filtroDoPedidoAnotaAi(p, { importarDesde: loja.importarDesde });
  if (!decisao.importar) {
    if (decisao.alertar) {
      // Doc de parceiro é promessa: o que ninguém previu fica guardado como chegou.
      await guardarPayloadCru({ canal: "ANOTAAI", tipo: "pedido", idNoParceiro: idNoBanco, franchiseeId: loja.franchiseeId, payload: p, avisos: [decisao.texto] });
      alertar(nomeDa(loja), `pedido #${numero} não entrou: ${decisao.texto}`);
    }
    lembrar(decididos, idNoBanco);
    return { concluido: true, acao: `ignorado-${decisao.motivo}`, mensagem: decisao.texto };
  }

  const dono = await prisma.user.findUnique({ where: { id: loja.franchiseeId }, select: { id: true, storeName: true, autoAcceptOrders: true } });
  if (!dono) {
    alertar(nomeDa(loja), `a conta ${loja.franchiseeId} do FireHub ligada a esta loja não existe mais — pedido #${numero} não entrou`);
    return { concluido: true, acao: "sem-conta", mensagem: `loja ${loja.franchiseeId} não existe` };
  }

  const traducao = traduzirPedidoAnotaAi(p, {
    lojaId: dono.id,
    fuso: await fusoDaLoja(dono.id),
    // Loja SEM CONEXÃO: o pedido não nasce aceito (lib/loja-sem-conexao-no-banco.ts).
    autoAcceptOrders: await aceitaSozinhoAgora(dono),
    pageId: loja.pageId,
    statusInicial: decisao.statusInicial,
  });
  await guardarPayloadCru({ canal: "ANOTAAI", tipo: "pedido", idNoParceiro: idNoBanco, franchiseeId: dono.id, payload: p, avisos: traducao.avisos });
  if (traducao.avisos.length > 0) console.warn(`[Anota AI] ⚠️ #${numero}: ${traducao.avisos.join(" | ")}`);

  const gravado = await gravarPedidoOpenDelivery(traducao, "Anota AI");
  if (gravado.action === "error") {
    alertar(dono.storeName || dono.id, `#${numero}: ${gravado.message}`);
    return { concluido: false, acao: "erro", mensagem: gravado.message };
  }
  if (gravado.action === "created") await registrarPollingAnotaAi(loja.pageId, null, true);

  // ── O aceite no Anota AI ─────────────────────────────────────────────────
  // Só quando a loja aceita sozinha (nasceu ACEITO) e lá ainda está em
  // análise. Quem aceita na mão manda o accept pelo botão (rota de status).
  const criado = data(p.createdAt)?.getTime();
  const recente = criado === undefined ? true : Date.now() - criado < JANELA_DO_ACEITE_MS;
  if (gravado.action === "created" && gravado.status === "ACEITO" && checkDo(p) === 0 && recente) {
    const c = await acaoNoPedidoAnotaAi(loja.pageId, "accept", orderId);
    if (!c.ok) {
      console.error(`[Anota AI] ❌ aceite de #${numero} falhou: ${c.erro}`);
      if (c.repetir) await registrarAcaoPendente(idNoBanco, "accept", null, c.erro || "");
      alertar(dono.storeName || dono.id, `#${numero}: gravado no FireHub, mas o Anota AI recusou o aceite (${c.erro}).${c.repetir ? " O FireHub tenta de novo sozinho." : " Aceite no admin do Anota AI — sem aceite em 15 min ele nega o pedido."}`);
    }
  }
  return { concluido: true, acao: gravado.action, pedidoId: gravado.pedidoId };
}

/** Busca o pedido no Anota AI e decide: importa, muda status, ou nada. */
export async function processarPedidoAnotaAi(loja: LojaAnotaAi, orderId: string): Promise<ResultadoAnotaAi> {
  const idNoBanco = idDoPedidoAnotaAi(loja.pageId, orderId);
  const r = await buscarPedidoAnotaAi(loja.pageId, orderId);
  if (!r.ok || !r.dados || typeof r.dados !== "object") {
    return { concluido: false, acao: "erro", mensagem: `não consegui buscar o pedido: ${r.erro || "resposta vazia"}` };
  }
  const p = r.dados as PedidoAnotaAi;
  if (!texto(p._id ?? p.id)) p._id = orderId;
  const existente = await pedidoNoBanco(idNoBanco);
  if (existente) return aplicarStatus(existente, checkDo(p));
  return importarPedido(loja, p);
}

// ── O ciclo de uma loja ──────────────────────────────────────────────────────

const STATUS_FINAIS = ["ENTREGUE", "FINALIZADO", "CANCELADO"];

export async function pollingDaLojaAnotaAi(loja: LojaAnotaAi, temTempo: () => boolean): Promise<string[]> {
  const log: string[] = [];
  const nome = nomeDa(loja);
  const [abertos, cancelados] = await Promise.all([listarPedidosAnotaAi(loja.pageId), listarPedidosAnotaAi(loja.pageId, { cancelados: true })]);
  if (!abertos.ok) {
    await registrarPollingAnotaAi(loja.pageId, abertos.erro || "falha na lista");
    log.push(`❌ ${nome}: lista de pedidos — ${abertos.erro}`);
    return log;
  }
  await registrarPollingAnotaAi(loja.pageId, null);

  const vistos = new Set<string>();
  const resumos: Array<ResumoAnotaAi & { cancelado?: boolean }> = [
    ...(abertos.dados || []),
    ...(cancelados.ok ? (cancelados.dados || []).map((d) => ({ ...d, cancelado: true })) : []),
  ];
  for (const lite of resumos) {
    if (!temTempo()) {
      log.push(`⏱️ ${nome}: o tempo do ciclo acabou — o resto fica para o próximo`);
      return log;
    }
    const orderId = texto(lite?._id);
    if (!/^[0-9A-Za-z-]{1,40}$/.test(orderId)) continue;
    const idNoBanco = idDoPedidoAnotaAi(loja.pageId, orderId);
    vistos.add(idNoBanco);
    const check = lite.cancelado && checkDo(lite) === null ? 4 : checkDo(lite);
    try {
      const existente = await pedidoNoBanco(idNoBanco);
      if (existente) {
        if (!mudaria(existente, check)) continue;
        const res = await aplicarStatus(existente, check);
        log.push(`${nome} ${orderId} (check ${check}): ${res.acao}`);
        continue;
      }
      // Os filtros que o resumo já responde, sem gastar a busca.
      if (lite.cancelado || decididos.has(idNoBanco)) continue;
      if (minusc(lite.salesChannel) === "ifood") continue;
      if (ehMesaAnotaAi({ from: lite.from })) continue;
      const mexido = data(lite.updatedAt);
      if (mexido && mexido.getTime() < loja.importarDesde.getTime()) continue;
      if (check !== null && [4, 5, 6, 41, 42, -1, -4].includes(check)) continue;
      const res = await processarPedidoAnotaAi(loja, orderId);
      log.push(`${nome} ${orderId} (check ${check}): ${res.acao}${res.mensagem ? ` — ${res.mensagem}` : ""}`);
      if (!res.concluido && /\b429\b/.test(String(res.mensagem || ""))) break;
    } catch (e: any) {
      log.push(`❌ ${nome} ${orderId}: ${e?.message || e}`);
    }
  }

  // Pedidos daqui que sumiram das duas listas: negado (5), agendado aceito
  // (-2), cancelamento interno (41/42) ou de ontem. Um por um, com freio.
  const abertosAqui = (await prisma.customerOrder.findMany({
    where: {
      franchiseeId: loja.franchiseeId,
      openDeliveryOrderId: { startsWith: `anotaai_${loja.pageId}_` },
      status: { notIn: STATUS_FINAIS },
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
    } as any,
    select: { id: true, status: true, notes: true, cancelledBy: true, openDeliveryOrderId: true } as any,
    take: 200,
  })) as any[];
  let buscas = 0;
  for (const o of abertosAqui) {
    if (buscas >= BUSCAS_DE_SUMIDOS || !temTempo()) break;
    const chave = String(o.openDeliveryOrderId);
    if (vistos.has(chave)) continue;
    if (Date.now() - (ultimaBuscaDoSumido.get(chave) || 0) < INTERVALO_DO_SUMIDO_MS) continue;
    const id = lerIdDoPedidoAnotaAi(chave);
    if (!id) continue;
    buscas++;
    lembrar(ultimaBuscaDoSumido, chave);
    const r = await buscarPedidoAnotaAi(loja.pageId, id.orderId);
    if (!r.ok || !r.dados) continue;
    const check = checkDo(r.dados);
    if (!mudaria(o, check)) continue;
    const res = await aplicarStatus(o, check);
    log.push(`${nome} ${id.orderId} (sumiu da lista, check ${check}): ${res.acao}`);
  }
  return log;
}

/** Repete os avisos que falharam, na ordem, parando o pedido no primeiro que falhar. */
export async function repetirAcoesPendentesAnotaAi(temTempo: () => boolean): Promise<string[]> {
  const log: string[] = [];
  const travados = new Set<string>();
  for (const p of await acoesPendentes()) {
    if (!temTempo()) break;
    if (travados.has(p.pedidoId)) continue;
    const id = lerIdDoPedidoAnotaAi(p.pedidoId);
    if (!id) {
      await marcarTentativa(p.id, true, "id do pedido ilegível");
      continue;
    }
    if (!(await lojaAnotaAiAtiva(id.pageId))) {
      await marcarTentativa(p.id, true, "loja desligada");
      log.push(`↻ ${p.acao} ${p.pedidoId}: loja desligada — descartado`);
      continue;
    }
    const corpo = p.corpo && typeof p.corpo === "object" ? p.corpo : undefined;
    const r = await acaoNoPedidoAnotaAi(id.pageId, p.acao as AcaoAnotaAi, id.orderId, corpo);
    await marcarTentativa(p.id, r.ok || !r.repetir, r.ok ? undefined : r.erro);
    if (!r.ok) travados.add(p.pedidoId);
    log.push(`↻ ${p.acao} ${p.pedidoId}: ${r.ok ? "ok" : r.erro}`);
  }
  return log;
}

/** O ciclo inteiro do cron: lojas e ações pendentes. Sem credencial no servidor, não faz nada. */
export async function cicloDoAnotaAi(opts: { prazoMs?: number } = {}): Promise<{ lojas: number; log: string[] }> {
  if (!anotaAiConfigurado()) return { lojas: 0, log: [] };
  const inicio = Date.now();
  const temTempo = () => Date.now() - inicio < (opts.prazoMs ?? 45_000);
  const log: string[] = [];
  let lojas = 0;
  for (const loja of await lojasAnotaAiAtivas()) {
    if (!temTempo()) {
      log.push("⏱️ o tempo do ciclo acabou antes de todas as lojas");
      break;
    }
    if (await lojaBloqueadaPorMensalidade(loja.franchiseeId)) {
      log.push(`[bloqueio] ${nomeDa(loja)}: loja bloqueada por mensalidade — fora do polling`);
      continue;
    }
    lojas++;
    try {
      log.push(...(await pollingDaLojaAnotaAi(loja, temTempo)));
    } catch (e: any) {
      log.push(`❌ ${nomeDa(loja)}: ${e?.message || e}`);
    }
  }
  log.push(...(await repetirAcoesPendentesAnotaAi(temTempo).catch((e: any) => [`❌ ações pendentes: ${e?.message || e}`])));
  return { lojas, log };
}
