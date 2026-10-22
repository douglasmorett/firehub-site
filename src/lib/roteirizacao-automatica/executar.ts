/**
 * Rota 100% automatizada — a EXECUÇÃO: lê a loja no banco, monta a entrada do
 * planejador (planejador.ts, puro) e devolve o que ele decidiu.
 *
 * Dois modos:
 *   - `gravar: false` — a PRÉVIA que o Douglas olha antes de ligar (D15 do
 *     plano, vault "FireHub - Plano despacho automático"): nada é gravado;
 *   - `gravar: true` (Fase 1, 22/10/2026) — o cron de 20 s
 *     (api/cron/roteirizacao-automatica) e o "rodar agora": cria a rota
 *     (lib/rotas-da-loja.ts, a mesma gravação do POST manual), acrescenta,
 *     tira e apaga rota AUTO vazia. A tradução das ações em gravações é pura
 *     (gravacoes.ts); aqui ficam as travas de SQL. "chamar" (avisar o
 *     motoboy) é a Fase 2: volta como pendente no resumo.
 *
 * Gravando, o ciclo inteiro (ler → planejar → gravar) roda sob a vez
 * "roteirizacao:<loja>" (lib/vez.ts) com um dono novo por chamada: nem dois
 * servidores nem o cron e o "rodar agora" do mesmo servidor criam a mesma
 * rota duas vezes. E nunca se mexe em rota MANUAL nem em pedido que já tem
 * motoboy (D4/D8): toda gravação confere de novo no banco.
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
import { areaDaLoja } from "@/lib/ponto-do-pedido";
import { pontoParaRotaAutomatica } from "./ponto";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { infoDaEntrega } from "@/lib/entrega-parceira";
import { prontoNaCozinha } from "@/lib/pedidos-na-cozinha";
import { STATUS_ANTES_DE_SAIR, STATUS_CANCELADOS, STATUS_FINALIZADOS } from "@/lib/status-pedido";
import { POSICAO_VALE_MS } from "@/lib/entrega-ao-vivo";
import { lerConfigDeAgendamento } from "@/lib/agendamento";
import { pegarVez, soltarVez } from "@/lib/vez";
import { idDaInstancia } from "@/lib/instancia";
import { criarRotaDaLoja, pedePrioridadeNaRota } from "@/lib/rotas-da-loja";
import { liberadaPara } from "./liberacao";
import { gravacoesDasAcoes, type Passo } from "./gravacoes";
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
  /** true = este ciclo gravou (modo `gravar: true`, ligada e liberada). */
  gravou: boolean;
  /** Gravando: o que foi feito, escrito ("criou Rota #7 (#12, #15)"). */
  aplicadas?: string[];
  /** Gravando: decidido mas ainda não gravado nesta fase ("chamar" — Fase 2). */
  pendentes?: AcaoNaPrevia[];
  /** Gravando: o que falhou ou o banco recusou (pedido puxado no meio, rota que saiu). */
  falhas?: string[];
  /** Gravando: outro ciclo desta loja estava no ar — este não gravou. */
  pulada?: string;
};

const numeroDo = (p: { dailyOrderNumber?: number | null }) => (p.dailyOrderNumber ?? null) as number | null;

/** O que o ciclo leu e decidiu — a prévia é o `resumo`; quem grava usa o resto. */
type Planejado = {
  resumo: ResumoDaRoteirizacao;
  acoes: Acao[];
  rotasAbertas: RotaAberta[];
  virada: Date;
  /** Número do pedido pelo id (para escrever o que foi feito). */
  num: (id: string) => number | null;
  /** Status do pedido pelo id (a prioridade no KDS ao entrar na rota). */
  statusDe: (id: string) => string | null;
};

async function lerEPlanejar(lojaId: string, agora: Date): Promise<Planejado> {
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
    const ponto = pontoParaRotaAutomatica(o.customerLatLng, ehMarketplace, area);
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
  const status = new Map([...candidatos, ...dasRotas].map((o) => [o.id, o.status as string]));
  const planejado = (resumo: ResumoDaRoteirizacao, acoes: Acao[]): Planejado => ({
    resumo, acoes, rotasAbertas, virada,
    num: (id) => numeros.get(id) ?? null,
    statusDe: (id) => status.get(id) ?? null,
  });
  // Sem pino não há "perto da loja" nem ordem de paradas: nada a planejar.
  if (!pino) return planejado(resumoVazio(), []);

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

  return planejado(
    {
      ...resumoVazio(),
      acoes: legiveis,
      descartados: descartados.map((d) => ({ ...d, numero: num(d.pedidoId), texto: MOTIVO_EM_PORTUGUES[d.motivo] })),
    },
    acoes,
  );
}

/** A vez de um ciclo que grava: cobre ler + planejar + gravar com folga. */
const VEZ_DO_CICLO_MS = 15_000;

/**
 * Um ciclo da loja. `gravar: false` = a prévia (nada muda). `gravar: true` =
 * grava o que o planejador decidiu, só com a regra ligada e a loja liberada
 * (liberacao.ts) — o cron já filtra, mas o "rodar agora" e um desligar no
 * meio do caminho passam por aqui também.
 */
export async function rodarRoteirizacaoDaLoja(lojaId: string, opcoes: { gravar: boolean; agora?: Date }): Promise<ResumoDaRoteirizacao> {
  const agora = opcoes.agora ?? new Date();
  if (!opcoes.gravar) return (await lerEPlanejar(lojaId, agora)).resumo;

  const chave = `roteirizacao:${lojaId}`;
  // Dono novo por chamada (lib/vez.ts): com o dono da instância, o "rodar
  // agora" renovaria a vez do cron do mesmo servidor e os dois gravariam juntos.
  const dono = `${idDaInstancia()}:${agora.getTime()}:${Math.random().toString(36).slice(2, 8)}`;
  if (!(await pegarVez(chave, VEZ_DO_CICLO_MS, { dono }))) {
    const { resumo } = await lerEPlanejar(lojaId, agora);
    return { ...resumo, pulada: "outro ciclo desta loja está gravando agora" };
  }
  try {
    const plano = await lerEPlanejar(lojaId, agora);
    const { resumo } = plano;
    // Desligada no meio do caminho (D14), fora da liberação ou sem o pino: só a prévia.
    if (!resumo.config.ativo || !liberadaPara(lojaId) || !resumo.temPino) return resumo;
    return await gravar(lojaId, plano);
  } finally {
    await soltarVez(chave, dono);
  }
}

/** A rota ainda é AUTO, desta loja, e não saiu? (a Roteirização pode ter despachado no meio) */
async function rotaAutoAberta(lojaId: string, rotaId: string): Promise<boolean> {
  const linhas = await prisma.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok FROM "RouteSchedule"
    WHERE "id" = ${rotaId} AND "franchiseeId" = ${lojaId} AND "origem" = 'AUTO'
      AND "status" = 'PENDING' AND "dispatchedAt" IS NULL
  `;
  return linhas.length > 0;
}

async function gravar(lojaId: string, plano: Planejado): Promise<ResumoDaRoteirizacao> {
  const { resumo, num, statusDe } = plano;
  const { passos, pendentes } = gravacoesDasAcoes(
    plano.acoes,
    plano.rotasAbertas.map((r) => ({ id: r.id, pedidoIds: r.pedidos.map((p) => p.id) })),
  );
  const numeroDaRota = new Map(plano.rotasAbertas.map((r) => [r.id, r.routeNumber]));
  const rotulo = (id: string) => `#${num(id) ?? id.slice(-4)}`;
  const nomeDaRota = (id: string) => numeroDaRota.get(id) ?? `rota ${id.slice(-4)}`;
  const aplicadas: string[] = [];
  const falhas: string[] = [];
  const acoes = resumo.acoes.map((a) => ({ ...a }));

  // Cada rota é conferida no banco uma vez por ciclo, antes da 1ª gravação nela.
  const aberta = new Map<string, boolean>();
  const conferirRota = async (rotaId: string) => {
    if (!aberta.has(rotaId)) aberta.set(rotaId, await rotaAutoAberta(lojaId, rotaId));
    return aberta.get(rotaId) as boolean;
  };

  const aplicar = async (passo: Passo) => {
    switch (passo.tipo) {
      case "criar-rota": {
        // De novo no banco: o pedido pode ter sido puxado pelo QR, ido para
        // uma rota manual ou cancelado depois da leitura (D4).
        const livres = new Set(
          (await prisma.customerOrder.findMany({
            where: { id: { in: passo.pedidoIds }, franchiseeId: lojaId, motoboyId: null, routeId: null, status: { in: [...STATUS_DO_DESPACHO] } },
            select: { id: true },
          })).map((o) => o.id),
        );
        const ids = passo.pedidoIds.filter((id) => livres.has(id));
        if (ids.length === 0) { falhas.push(`rota de ${passo.pedidoIds.map(rotulo).join(", ")} não criada: os pedidos mudaram`); return; }
        // D7: sem motoboy. A numeração conta desde a mesma virada que lê as rotas abertas.
        const { rota } = await criarRotaDaLoja({ lojaId, orderIds: ids, origem: "AUTO", virada: plano.virada });
        numeroDaRota.set(rota.id, rota.routeNumber);
        aberta.set(rota.id, true);
        const legivel = acoes.find((a) => a.tipo === "criar-rota" && a.pedidos.includes(ids[0]));
        if (legivel) legivel.routeNumber = rota.routeNumber;
        aplicadas.push(`criou ${rota.routeNumber} (${ids.map(rotulo).join(", ")})`);
        return;
      }
      case "entrar-na-rota": {
        if (!(await conferirRota(passo.rotaId))) { falhas.push(`${rotulo(passo.pedidoId)} não entrou: ${nomeDaRota(passo.rotaId)} já saiu ou não é automática`); return; }
        const { count } = await prisma.customerOrder.updateMany({
          where: { id: passo.pedidoId, franchiseeId: lojaId, motoboyId: null, routeId: null },
          data: { routeId: passo.rotaId, isRoutePriority: pedePrioridadeNaRota(statusDe(passo.pedidoId)) },
        });
        if (count === 0) { falhas.push(`${rotulo(passo.pedidoId)} não entrou na ${nomeDaRota(passo.rotaId)}: o pedido mudou`); return; }
        aplicadas.push(`${rotulo(passo.pedidoId)} entrou na ${nomeDaRota(passo.rotaId)}`);
        return;
      }
      case "sair-da-rota": {
        if (!(await conferirRota(passo.rotaId))) return;
        const { count } = await prisma.customerOrder.updateMany({
          where: { id: passo.pedidoId, routeId: passo.rotaId, motoboyId: null },
          data: { routeId: null, isRoutePriority: false },
        });
        if (count === 0) return;
        try {
          await prisma.$executeRaw`UPDATE "CustomerOrder" SET "routeSequence" = NULL WHERE "id" = ${passo.pedidoId} AND "routeId" IS NULL`;
        } catch (e: any) {
          console.warn("[rota-automatica] routeSequence não limpa (coluna ausente?):", e?.message?.slice(0, 120));
        }
        aplicadas.push(`${rotulo(passo.pedidoId)} saiu da ${nomeDaRota(passo.rotaId)} (${passo.motivo === "cancelado" ? "cancelado" : "espera estourada"})`);
        return;
      }
      case "sequencia": {
        if (!(await conferirRota(passo.rotaId))) return;
        // Mesma coluna crua do POST manual (lib/rotas-da-loja.ts). Só quem
        // ainda está nesta rota ganha número.
        try {
          await Promise.all(
            passo.pedidoIds.map((id, i) => prisma.$executeRaw`
              UPDATE "CustomerOrder" SET "routeSequence" = ${i + 1} WHERE "id" = ${id} AND "routeId" = ${passo.rotaId}
            `),
          );
        } catch (e: any) {
          console.warn("[rota-automatica] routeSequence não gravada (coluna ausente?):", e?.message?.slice(0, 120));
        }
        return;
      }
      case "apagar-rota": {
        // Só a AUTO desta loja, ainda PENDING e sem pedido nenhum — o banco confere.
        const apagadas = await prisma.$executeRaw`
          DELETE FROM "RouteSchedule"
          WHERE "id" = ${passo.rotaId} AND "franchiseeId" = ${lojaId} AND "origem" = 'AUTO'
            AND "status" = 'PENDING' AND "dispatchedAt" IS NULL
            AND NOT EXISTS (SELECT 1 FROM "CustomerOrder" WHERE "routeId" = ${passo.rotaId})
        `;
        if (apagadas > 0) aplicadas.push(`apagou ${nomeDaRota(passo.rotaId)} (ficou vazia)`);
        return;
      }
    }
  };

  for (const passo of passos) {
    try {
      await aplicar(passo);
    } catch (e: any) {
      // Uma gravação que falha não derruba as outras; o ciclo seguinte (20 s)
      // vê o banco como ficou e decide de novo (rota que nasceu vazia é apagada).
      falhas.push(`${passo.tipo}: ${String(e?.message || e).slice(0, 160)}`);
    }
  }

  // Fase 2: "chamar" (chamadaEm, chamadaMotoboyId e o push ROTA_PRONTA).
  const rotasPendentes = new Set(pendentes.flatMap((p) => (p.tipo === "chamar" ? [p.rotaId] : [])));
  const pendentesLegiveis = acoes.filter((a) => a.tipo === "chamar" && rotasPendentes.has(a.rotaId));

  if (aplicadas.length > 0 || falhas.length > 0) {
    console.log(
      `[rota-automatica] loja ${lojaId} ações: ${aplicadas.join("; ") || "nenhuma"}` +
        (pendentesLegiveis.length > 0 ? ` | pendente (Fase 2): chamar ${pendentesLegiveis.map((a) => a.routeNumber ?? "?").join(", ")}` : "") +
        (falhas.length > 0 ? ` | falhas: ${falhas.join("; ")}` : ""),
    );
  }

  return { ...resumo, acoes, gravou: true, aplicadas, pendentes: pendentesLegiveis, falhas };
}
