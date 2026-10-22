/**
 * Rota 100% automatizada — a EXECUÇÃO: lê a loja no banco, monta a entrada do
 * planejador (planejador.ts, puro) e devolve o que ele decidiu.
 *
 * FASE 0 (22/10/2026): só `gravar: false`. É a prévia que o Douglas olha antes
 * de ligar (D15 do plano, vault "FireHub - Plano despacho automático") —
 * nenhuma rota é criada, nenhum pedido muda, nenhum motoboy é avisado. A
 * Fase 1 acrescenta o modo que grava (criar-rota pela mesma gravação do POST
 * manual de api/store/routes) e o cron de 20 s.
 *
 * ── A entrada ────────────────────────────────────────────────────────────
 *   - pedidos (D4): entrega da loja (DELIVERY, sem tableSession), aceitos e
 *     ainda dentro da loja (STATUS_ANTES_DE_SAIR sem o NOVO: pedido não
 *     aceito não pede prioridade na cozinha), do expediente (virada das 5h,
 *     como a numeração das rotas). Os cortes de D4 viram `fora` — entrega do
 *     parceiro, já com motoboy, em rota montada à mão, agendado para depois —
 *     e o planejador os relata como descartados;
 *   - o ponto: o `customerLatLng` pela regra única de lib/ponto-do-pedido.ts
 *     (`lerPontoGravado` + `pontoGravadoVale` na área da loja). O centro do
 *     bairro não serve: rota automática com pino aproximado é pior que rota
 *     nenhuma (D3) — fica para a rota manual;
 *   - rotas AUTO ainda abertas (PENDING) desde a virada do expediente;
 *   - motoboys ativos e LIVRES (sem pedido aberto com o id deles), com o
 *     carimbo de chegada (motoboy-na-loja.ts) e o GPS fresco (≤ 3 min,
 *     POSICAO_VALE_MS, a mesma régua do mapa ao vivo).
 */
import { prisma } from "@/lib/prisma";
import { viradaDoExpedienteDaLoja } from "@/lib/fuso";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { areaDaLoja, lerPontoGravado, pontoGravadoVale } from "@/lib/ponto-do-pedido";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { infoDaEntrega } from "@/lib/entrega-parceira";
import { prontoNaCozinha } from "@/lib/pedidos-na-cozinha";
import { STATUS_ANTES_DE_SAIR, STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";
import { POSICAO_VALE_MS } from "@/lib/entrega-ao-vivo";
import { lerConfigDeAgendamento } from "@/lib/agendamento";
import { lerRoteirizacaoAutomatica, type RoteirizacaoAutomaticaConfig } from "./config";
import { prazoDoPedido, agendadoParaDepois } from "./prazo";
import {
  planejar,
  MOTIVO_EM_PORTUGUES,
  type Acao,
  type CorteDaEntrada,
  type MotivoDoDescarte,
  type MotoboyLivre,
  type PedidoParaDespacho,
  type RotaAberta,
} from "./planejador";

/** Pedido que ainda não foi aceito não entra (nem pede prioridade na cozinha). */
const STATUS_DO_DESPACHO = STATUS_ANTES_DE_SAIR.filter((s) => s !== "NOVO");

const CAMPOS_DO_PEDIDO = {
  id: true, dailyOrderNumber: true, status: true, deliveryType: true, deliveryBy: true,
  source: true, openDeliveryChannel: true, openDeliveryOrderId: true, openDeliveryReference: true,
  ifoodOrderId: true, ifoodReference: true, ifoodDriverName: true, ifoodDriverStatus: true, ifoodPickupCode: true,
  motoboyId: true, routeId: true, customerLatLng: true, createdAt: true, scheduledDatetime: true,
  tempoEntregaMin: true, agendado: true, kdsStage: true, readyAt: true, kdsFinishedAt: true, prioridadeNaCozinha: true,
} as const;

export type MotoboyNaPrevia = {
  id: string;
  nome: string;
  /** ISO, ou null = não está na loja. */
  naLojaDesde: string | null;
  /** Segundos desde a última posição; null = sem GPS. */
  gpsHaSeg: number | null;
  /** Sem pedido aberto com ele. */
  livre: boolean;
  /** Conta como "na loja" para a chamada: carimbo + GPS fresco. */
  naLoja: boolean;
};

/** A ação com o que a tela precisa para escrever (números dos pedidos, nome do motoboy). */
export type AcaoNaPrevia = Acao & {
  /** criar-rota: os números na ordem das paradas; acrescentar/tirar: o número do pedido. */
  numeros?: (number | null)[];
  routeNumber?: string;
  /**
   * chamar: nome do chamado, ou null = "todos os livres". criar-rota: quem
   * seria chamado se a rota ficasse pronta agora (null = todos os livres).
   */
  motoboyNome?: string | null;
};

export type ResumoDaRoteirizacao = {
  lojaId: string;
  agora: string;
  config: RoteirizacaoAutomaticaConfig;
  temPino: boolean;
  motoboys: MotoboyNaPrevia[];
  acoes: AcaoNaPrevia[];
  descartados: { pedidoId: string; numero: number | null; motivo: MotivoDoDescarte; texto: string }[];
  rotasAbertas: { id: string; routeNumber: string; chamadaEm: string | null; numeros: (number | null)[] }[];
  gravou: false;
};

const numeroDo = (p: { dailyOrderNumber?: number | null }) => (p.dailyOrderNumber ?? null) as number | null;

export async function rodarRoteirizacaoDaLoja(lojaId: string, opcoes: { gravar: false; agora?: Date }): Promise<ResumoDaRoteirizacao> {
  // Fase 0: o tipo só aceita `gravar: false`. Quem quiser gravar espera a Fase 1.
  if (opcoes.gravar !== false) throw new Error("Rota automática: gravar ainda não existe (Fase 0).");
  const agora = opcoes.agora ?? new Date();

  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { storeLatLng: true, deliveryConfig: true, deliveryZones: true, deliveryZoneType: true, storeTimezone: true, agendamentoConfig: true },
  });
  const config = lerRoteirizacaoAutomatica(loja?.deliveryConfig);
  const pino = lerPontoDaLoja(loja?.storeLatLng);
  const virada = viradaDoExpedienteDaLoja(loja?.storeTimezone, agora);
  const liberarAntesMin = lerConfigDeAgendamento(loja?.agendamentoConfig).liberarAntesMin;
  const area = areaDaLoja(loja, pino);

  // ── Motoboys ─────────────────────────────────────────────────────────────
  const motoboysDoBanco: { id: string; name: string; lastLocationUpdate: Date | null; naLojaDesde: Date | null }[] =
    await (prisma.motoboy as any).findMany({
      where: { franchiseeId: lojaId, active: true },
      select: { id: true, name: true, lastLocationUpdate: true, naLojaDesde: true },
      orderBy: { name: "asc" },
    });
  const comPedido = new Set(
    (await prisma.customerOrder.findMany({
      where: {
        franchiseeId: lojaId,
        motoboyId: { in: motoboysDoBanco.map((m) => m.id) },
        status: { notIn: [...STATUS_FINALIZADOS, ...STATUS_CANCELADOS] },
        // Pedido esquecido de ontem não prende o motoboy hoje.
        createdAt: { gte: new Date(agora.getTime() - 12 * 3600_000) },
      },
      select: { motoboyId: true },
      distinct: ["motoboyId"],
    })).map((o) => o.motoboyId as string),
  );
  const motoboys: MotoboyNaPrevia[] = motoboysDoBanco.map((m) => {
    const gpsHaSeg = m.lastLocationUpdate ? Math.max(0, Math.round((agora.getTime() - new Date(m.lastLocationUpdate).getTime()) / 1000)) : null;
    const gpsFresco = gpsHaSeg != null && gpsHaSeg * 1000 <= POSICAO_VALE_MS;
    return {
      id: m.id,
      nome: m.name,
      naLojaDesde: m.naLojaDesde ? new Date(m.naLojaDesde).toISOString() : null,
      gpsHaSeg,
      livre: !comPedido.has(m.id),
      naLoja: !!m.naLojaDesde && gpsFresco,
    };
  });
  const livres: MotoboyLivre[] = motoboys
    .filter((m) => m.livre)
    .map((m) => ({ id: m.id, nome: m.nome, naLojaDesde: m.naLojaDesde ? new Date(m.naLojaDesde) : null, gpsFresco: m.gpsHaSeg != null && m.gpsHaSeg * 1000 <= POSICAO_VALE_MS }));

  // ── Rotas AUTO abertas ───────────────────────────────────────────────────
  const rotasDoBanco: { id: string; routeNumber: string; chamadaEm: Date | null; chamadaMotoboyId: string | null }[] =
    await (prisma.routeSchedule as any).findMany({
      where: { franchiseeId: lojaId, origem: "AUTO", status: "PENDING", createdAt: { gte: virada } },
      select: { id: true, routeNumber: true, chamadaEm: true, chamadaMotoboyId: true },
    });
  const idsDasRotasAuto = new Set(rotasDoBanco.map((r) => r.id));

  // ── Pedidos ──────────────────────────────────────────────────────────────
  const [candidatos, dasRotas] = await Promise.all([
    prisma.customerOrder.findMany({
      where: {
        franchiseeId: lojaId,
        deliveryType: "DELIVERY",
        tableSessionId: null,
        status: { in: [...STATUS_DO_DESPACHO] },
        OR: [{ createdAt: { gte: virada } }, { scheduledDatetime: { gte: virada } }],
      },
      select: CAMPOS_DO_PEDIDO,
    }),
    idsDasRotasAuto.size > 0
      ? prisma.customerOrder.findMany({ where: { routeId: { in: [...idsDasRotasAuto] } }, select: CAMPOS_DO_PEDIDO })
      : Promise.resolve([]),
  ]);

  type Linha = (typeof candidatos)[number];
  const numeros = new Map<string, number | null>();
  const paraDespacho = (o: Linha): PedidoParaDespacho => {
    numeros.set(o.id, numeroDo(o));
    const ehMarketplace = canalDoPedido(o).ehMarketplace;
    const gravado = lerPontoGravado(o.customerLatLng, ehMarketplace);
    const ponto = gravado && gravado.fonte !== "bairro" && pontoGravadoVale(gravado, area, ehMarketplace) ? gravado.ponto : null;
    let fora: CorteDaEntrada | null = null;
    if (infoDaEntrega(o).parceira) fora = "parceiro";
    else if (o.routeId && !idsDasRotasAuto.has(o.routeId)) fora = "rota-manual";
    else if (o.motoboyId) fora = "ja-com-motoboy";
    else if (agendadoParaDepois(o, liberarAntesMin, agora)) fora = "agendado";
    const pronto = prontoNaCozinha(o);
    return {
      id: o.id,
      numero: numeroDo(o),
      ponto,
      prazo: prazoDoPedido(o, loja?.deliveryZones),
      criadoEm: o.createdAt,
      pronto,
      prontoEm: pronto ? (o.readyAt ?? o.kdsFinishedAt ?? null) : null,
      rotaId: o.routeId,
      prioridadeManual: o.prioridadeNaCozinha === true,
      fora,
      cancelado: (STATUS_CANCELADOS as readonly string[]).includes(o.status),
    };
  };

  const rotasAbertas: RotaAberta[] = rotasDoBanco.map((r) => ({
    id: r.id,
    routeNumber: r.routeNumber,
    chamadaEm: r.chamadaEm ? new Date(r.chamadaEm) : null,
    chamadaMotoboyId: r.chamadaMotoboyId,
    pedidos: dasRotas
      .filter((o) => o.routeId === r.id)
      .map(paraDespacho)
      // Na rota, "fora" só importa se já foi puxado (rota saindo); o resto é da própria rota.
      .map((p) => ({ ...p, fora: p.fora === "ja-com-motoboy" ? p.fora : null })),
  }));
  const pedidos = candidatos.filter((o) => !(o.routeId && idsDasRotasAuto.has(o.routeId))).map(paraDespacho);

  const resumoVazio = (): ResumoDaRoteirizacao => ({
    lojaId, agora: agora.toISOString(), config, temPino: !!pino, motoboys, acoes: [], descartados: [],
    rotasAbertas: rotasAbertas.map((r) => ({ id: r.id, routeNumber: r.routeNumber, chamadaEm: r.chamadaEm?.toISOString() ?? null, numeros: r.pedidos.map((p) => p.numero) })),
    gravou: false,
  });
  // Sem pino não há "perto da loja" nem ordem de paradas: nada a planejar.
  if (!pino) return resumoVazio();

  const { acoes, descartados } = planejar({ loja: pino, config, pedidos, rotasAbertas, motoboys: livres, agora });

  const nomeDoMotoboy = new Map(motoboys.map((m) => [m.id, m.nome]));
  const numeroDaRota = new Map(rotasAbertas.map((r) => [r.id, r.routeNumber]));
  const num = (id: string) => numeros.get(id) ?? null;
  // Rota nova só é chamada quando fica pronta (ciclo seguinte). Para a prévia
  // dizer quem iria, a fila de quem está na loja continua depois das chamadas
  // de agora: é quem seria chamado se a rota ficasse pronta neste instante.
  const jaChamados = new Set([
    ...acoes.flatMap((a) => (a.tipo === "chamar" && a.motoboyId ? [a.motoboyId] : [])),
    ...rotasAbertas.flatMap((r) => (r.chamadaEm && r.chamadaMotoboyId ? [r.chamadaMotoboyId] : [])),
  ]);
  const filaDaPrevia = livres
    .filter((m) => m.naLojaDesde && m.gpsFresco && !jaChamados.has(m.id))
    .sort((a, b) => (a.naLojaDesde as Date).getTime() - (b.naLojaDesde as Date).getTime() || (a.id < b.id ? -1 : 1));
  const legiveis: AcaoNaPrevia[] = acoes.map((a) => {
    switch (a.tipo) {
      case "criar-rota": return { ...a, numeros: a.pedidos.map(num), motoboyNome: filaDaPrevia.shift()?.nome ?? null };
      case "acrescentar": return { ...a, numeros: [num(a.pedidoId)], routeNumber: numeroDaRota.get(a.rotaId) };
      case "tirar-da-rota": return { ...a, numeros: [num(a.pedidoId)], routeNumber: numeroDaRota.get(a.rotaId) };
      case "chamar": return { ...a, routeNumber: numeroDaRota.get(a.rotaId), motoboyNome: a.motoboyId ? nomeDoMotoboy.get(a.motoboyId) ?? null : null };
      case "apagar-rota": return { ...a, routeNumber: numeroDaRota.get(a.rotaId) };
    }
  });

  return {
    ...resumoVazio(),
    acoes: legiveis,
    descartados: descartados.map((d) => ({ ...d, numero: num(d.pedidoId), texto: MOTIVO_EM_PORTUGUES[d.motivo] })),
  };
}
