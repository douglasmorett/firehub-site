/**
 * /src/lib/ifood-acao-pendente.ts
 *
 * Pronto, saiu e concluído que o iFood BARROU — guardados para mandar de novo.
 *
 * ── O defeito ───────────────────────────────────────────────────────────────
 *
 * Frangoso - Trindade, 03/10/2026, 21:27, Lucas: "não tá despachando o pedido,
 * tá tudo ficando como pronto; cheguei no cliente e ele falou que não deu
 * saída". O FireHub tinha o pedido em SAIU_ENTREGA, na rota, com o motoboy. No
 * iFood, não: o `dispatch` volta 403 com uma página HTML "Access Denied" — o
 * bloqueio da borda da plataforma, que cai nas três credenciais
 * (integração → usuário → central) e passa sozinho. Naquela noite, 4 dos 15
 * pedidos do iFood despachados por rota na Frangoso nunca receberam o evento
 * DISPATCHED de volta (#10 às 20:10; #17, #18 e #20 às 21:01), contra 1 em 80
 * nas noites anteriores; no mesmo log, dispatch e conclude de outras lojas com
 * o mesmo 403. Quem chamava (`acaoNoPedidoIfood`) só registrava no log — por
 * desenho, para não travar a tela —, e ninguém tentava de novo. O cliente via
 * "pronto" até o motoboy tocar a campainha.
 *
 * É o mesmo bloqueio que já prendia o código de entrega
 * (lib/codigo-de-entrega-reconferir.ts). A saída é a mesma: guardar e repetir.
 *
 * ── Como ────────────────────────────────────────────────────────────────────
 *
 * `acaoNoPedidoIfood` grava em `CustomerOrder.ifoodAcoesPendentes` cada
 * readyToPickup/dispatch/conclude barrado, e apaga a marca quando a mesma ação
 * passa. O cron do iFood (api/cron/ifood-poll, a cada minuto) chama
 * `repetirAcoesBarradas`, que manda de novo na ordem do iFood.
 *
 * Só conta como barrado o que não diz nada sobre o pedido: 403 em HTML, 429,
 * 5xx, sem rede. Um 400/409/422 é o iFood respondendo de verdade (transição
 * inválida, já concluído) — repetir não muda nada, e a marca sai.
 *
 * Tudo por SQL cru: a escrita não pode mexer em `updatedAt` (o pedido não mudou
 * para quem olha o painel) e uma falha aqui nunca pode derrubar a ação que a
 * chamou.
 */
import { prisma } from "@/lib/prisma";

export const ACOES_REPETIVEIS = ["readyToPickup", "dispatch", "conclude"] as const;
export type AcaoRepetivel = (typeof ACOES_REPETIVEIS)[number];

export type Pendencia = {
  desde: string;
  tentativas: number;
  ultimaTentativa: string;
  status: number;
  texto: string;
  rotulo?: string | null;
};

/** Depois disto o pedido já foi entregue ou esquecido; insistir é ruído. */
const JANELA_MS = 3 * 60 * 60_000;
/** O bloqueio é por rajada: espaçar as tentativas ajuda mais que repetir. */
const INTERVALO_MS = 2 * 60_000;
/** Poucos por ciclo, pelo mesmo motivo. */
const POR_CICLO = 8;

const STATUS_CANCELADOS = ["CANCELADO", "CANCELLED", "CANCELED"];
const STATUS_NA_RUA = ["SAIU_ENTREGA", "SAIU_PARA_ENTREGA"];

export function ehAcaoRepetivel(acao: string): acao is AcaoRepetivel {
  return (ACOES_REPETIVEIS as readonly string[]).includes(acao);
}

/**
 * O iFood não chegou a olhar o pedido. 401/403 em JSON é credencial e já tem a
 * cascata de tokens; o 403 que interessa aqui é a página HTML da borda.
 */
export function foiBarrado(r: { status: number; texto?: string | null }): boolean {
  if (r.status === 0 || r.status === 429) return true;
  if (r.status >= 500 && r.status <= 599) return true;
  return r.status === 403 && /access denied/i.test(String(r.texto ?? ""));
}

/**
 * A ação ainda faz sentido para o pedido como ele está agora?
 *
 * - readyToPickup: só antes de sair. Na rua, quem resolve é o dispatch.
 * - dispatch: na rua, ou entregue sem o iFood ter concluído (o conclude
 *   pendente precisa dele antes).
 * - conclude: entregue.
 */
export function aindaVale(acao: AcaoRepetivel, status: string | null | undefined): boolean {
  const s = String(status ?? "").toUpperCase();
  if (STATUS_CANCELADOS.includes(s)) return false;
  if (acao === "readyToPickup") return !STATUS_NA_RUA.includes(s) && s !== "ENTREGUE";
  if (acao === "dispatch") return STATUS_NA_RUA.includes(s) || s === "ENTREGUE";
  return s === "ENTREGUE";
}

/** É hora de tentar de novo esta pendência? Fora da janela, nunca mais. */
export function horaDeRepetir(p: Pendencia | null | undefined, agora = Date.now()): boolean {
  if (!p) return false;
  const desde = Date.parse(p.desde);
  if (!Number.isFinite(desde) || agora - desde > JANELA_MS) return false;
  const ultima = Date.parse(p.ultimaTentativa);
  return !Number.isFinite(ultima) || agora - ultima >= INTERVALO_MS;
}

/**
 * Anota o resultado de uma ação no pedido: barrada vira pendência (contando as
 * tentativas a partir da primeira), qualquer outra resposta apaga a marca.
 * Nunca lança.
 */
export async function anotarResultadoDaAcao(
  ifoodOrderId: string,
  acao: string,
  r: { ok: boolean; status: number; texto?: string | null },
  rotulo?: string | null,
): Promise<void> {
  if (!ehAcaoRepetivel(acao) || !ifoodOrderId) return;
  try {
    if (foiBarrado(r)) {
      const agora = new Date().toISOString();
      const texto = String(r.texto ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
      await prisma.$executeRaw`
        UPDATE "CustomerOrder"
        SET "ifoodAcoesPendentes" = COALESCE("ifoodAcoesPendentes", '{}'::jsonb) || jsonb_build_object(
          ${acao}::text, jsonb_build_object(
            'desde', COALESCE("ifoodAcoesPendentes" -> ${acao}::text ->> 'desde', ${agora}::text),
            'tentativas', COALESCE(("ifoodAcoesPendentes" -> ${acao}::text ->> 'tentativas')::int, 0) + 1,
            'ultimaTentativa', ${agora}::text,
            'status', ${r.status}::int,
            'texto', ${texto}::text,
            'rotulo', ${rotulo ?? null}::text
          )
        )
        WHERE "ifoodOrderId" = ${ifoodOrderId}`;
      console.warn(`[iFood] ${acao} de ${ifoodOrderId} barrado (${r.status}) — fica para o cron mandar de novo`);
    } else {
      await prisma.$executeRaw`
        UPDATE "CustomerOrder"
        SET "ifoodAcoesPendentes" = "ifoodAcoesPendentes" - ${acao}::text
        WHERE "ifoodOrderId" = ${ifoodOrderId} AND "ifoodAcoesPendentes" ? ${acao}::text`;
    }
  } catch (e: any) {
    console.warn(`[iFood] não anotei o ${acao} de ${ifoodOrderId}: ${e?.message}`);
  }
}

type Candidato = {
  id: string;
  ifoodOrderId: string;
  franchiseeId: string;
  ifoodStoreMerchant: string | null;
  status: string;
  ifoodAcoesPendentes: Record<string, Pendencia> | null;
};

/**
 * O laço do cron. Na ordem do iFood: readyToPickup → dispatch → conclude, e
 * para no primeiro que continuar barrado (o seguinte seria recusado mesmo).
 */
export async function repetirAcoesBarradas(log: string[] = []): Promise<{ tentados: number; passaram: number }> {
  const { acaoNoPedidoIfood } = await import("@/lib/ifood-pedido");
  const desde = new Date(Date.now() - JANELA_MS - 60 * 60_000);

  let candidatos: Candidato[] = [];
  try {
    candidatos = await prisma.$queryRaw<Candidato[]>`
      SELECT id, "ifoodOrderId", "franchiseeId", "ifoodStoreMerchant", status, "ifoodAcoesPendentes"
      FROM "CustomerOrder"
      WHERE "ifoodAcoesPendentes" IS NOT NULL
        AND "ifoodAcoesPendentes" <> '{}'::jsonb
        AND "ifoodOrderId" IS NOT NULL
        AND "createdAt" >= ${desde}
      ORDER BY "createdAt" ASC
      LIMIT 40`;
  } catch (e: any) {
    log.push(`[ações barradas] não li as pendências: ${e?.message}`);
    return { tentados: 0, passaram: 0 };
  }

  let tentados = 0;
  let passaram = 0;
  for (const pedido of candidatos) {
    if (tentados >= POR_CICLO) break;
    const pendentes = pedido.ifoodAcoesPendentes ?? {};

    for (const acao of ACOES_REPETIVEIS) {
      const p = pendentes[acao];
      if (!p) continue;

      // Pedido cancelado, ou que já passou desta etapa: a marca sai sem chamada.
      if (!aindaVale(acao, pedido.status)) {
        await anotarResultadoDaAcao(pedido.ifoodOrderId, acao, { ok: true, status: 200 });
        log.push(`↩️ ${acao} de ${pedido.ifoodOrderId}: não vale mais (pedido ${pedido.status}) — descartado`);
        continue;
      }
      if (!horaDeRepetir(p)) {
        // Fora da janela a marca fica, só para registro — e para de ser tentada.
        break;
      }

      tentados++;
      const rotulo = `iFood ${acao} (nova tentativa ${p.tentativas + 1})`;
      // acaoNoPedidoIfood anota de novo: passou → apaga; barrou → +1 tentativa.
      let r = await acaoNoPedidoIfood(pedido, acao, { rotulo });
      // Dispatch recusado de verdade (400) quase sempre é o pedido parado em
      // "confirmado" lá: o startPreparation/readyToPickup da mesma rajada
      // também foi barrado e não ficou marcado. Sobe a escada inteira uma vez.
      if (acao === "dispatch" && !r.ok && !foiBarrado(r) && r.status >= 400 && r.status < 500) {
        await acaoNoPedidoIfood(pedido, "startPreparation", { rotulo });
        await acaoNoPedidoIfood(pedido, "readyToPickup", { rotulo });
        r = await acaoNoPedidoIfood(pedido, "dispatch", { rotulo });
      }
      if (r.ok) {
        passaram++;
        log.push(`✅ ${acao} de ${pedido.ifoodOrderId} passou na tentativa ${p.tentativas + 1}`);
        continue;
      }
      log.push(`⏳ ${acao} de ${pedido.ifoodOrderId}: ${r.status} na tentativa ${p.tentativas + 1}`);
      if (foiBarrado(r)) break;
    }
  }

  return { tentados, passaram };
}
