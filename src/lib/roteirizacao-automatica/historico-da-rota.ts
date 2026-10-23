/**
 * O HISTÓRICO OCULTO de cada rota: quem pôs ou tirou cada pedido, quando e
 * por quê. Coluna `RouteSchedule."historico"` (JSONB, lista, o mais recente
 * por último), criada no boot por lib/garantir-colunas.ts.
 *
 * Douglas, 22/10/2026 22h20: na Hakim Centro o #47 (Jardim Campomar, longe)
 * apareceu na Rota #15 com o #46 e o #48, e não havia como saber se foi a
 * regra da rota automática ou alguém pelo ✏️ Editar — o replay da regra com
 * os dados reais recusa o #47. "Acho legal anotar, porque estamos
 * monitorando." E às 22h25: "não quero histórico lá; é um histórico OCULTO só
 * pra eu e você consultar" — nenhuma tela do lojista mostra isto, e o GET de
 * /api/store/routes não o devolve. Consulta é direto no banco:
 *
 *   SELECT "routeNumber", jsonb_pretty("historico") FROM "RouteSchedule" WHERE "id" = '…';
 *
 * Quem escreve: a rota automática (executar.ts, só o que aplicou DE FATO,
 * depois da gravação conferida), a chamada (`chamarARota`), e as pessoas —
 * criar, ✏️ Editar, trocar entregador, lixeira, despachar (api/store/routes*)
 * — e o motoboy que puxa pelo QR (api/motoboys/orders).
 *
 * FORA DO schema.prisma DE PROPÓSITO: campo declarado sem a coluna derruba
 * TODA consulta de RouteSchedule (o 500 do MenuProduct.sortOrder), e
 * declarado ele viria em todo findMany de rota — até 60 entradas por rota no
 * GET que a tela lê a cada poucos segundos. Por isso só SQL cru, e nunca
 * lança: anotar não pode derrubar a gravação que está sendo anotada.
 */
import { prisma } from "@/lib/prisma";

/** O teto: passou disto, as mais antigas saem. Uma rota normal tem 5–15 entradas. */
export const TETO_DO_HISTORICO = 60;

export type AcaoDoHistorico =
  | "criou"
  | "entrou"
  | "saiu"
  | "incluiu"
  | "tirou"
  | "chamou"
  | "chamou de novo"
  | "atualizou a chamada"
  | "trocou o entregador"
  | "puxou"
  | "despachou"
  | "fechou";

export type EntradaDoHistorico = {
  /** ISO. */
  em: string;
  /** "automática" | nome (e-mail) de quem estava logado | "motoboy <nome>". */
  quem: string;
  acao: AcaoDoHistorico;
  /** Número do dia do pedido (`dailyOrderNumber`). */
  pedido?: number | null;
  /** Texto curto: a regra que fez entrar, com a distância; o motivo de sair. */
  motivo?: string;
};

/** Quem é a rota automática no histórico. */
export const QUEM_AUTOMATICA = "automática";

/**
 * Quem está logado no painel, como vai no histórico: "Maria (maria@x.com)".
 * Atendente do FireHub entrando como a loja (`impersonatedBy`) não vira o
 * dono: "Suporte FireHub (como Hakim Centro)" — a regra do caixa
 * (lib/resumo-do-caixa-aberto.ts, `quemEstaAbrindo`).
 */
export function quemNaSessao(usuario?: { name?: string | null; email?: string | null; impersonatedBy?: string | null } | null): string {
  const nome = String(usuario?.name || "").trim();
  const email = String(usuario?.email || "").trim();
  const quem = nome && email && nome !== email ? `${nome} (${email})` : nome || email || "pessoa sem nome";
  return usuario?.impersonatedBy ? `Suporte FireHub (como ${quem})` : quem;
}

/** Só o que cabe numa linha: textos cortados, campos vazios fora. */
function limpar(e: Omit<EntradaDoHistorico, "em"> & { em?: string }): EntradaDoHistorico {
  const saida: EntradaDoHistorico = {
    em: e.em || new Date().toISOString(),
    quem: String(e.quem || "?").slice(0, 120),
    acao: e.acao,
  };
  if (e.pedido != null && Number.isFinite(Number(e.pedido))) saida.pedido = Number(e.pedido);
  if (e.motivo) saida.motivo = String(e.motivo).slice(0, 240);
  return saida;
}

type BancoDoHistorico = Pick<typeof prisma, "$executeRaw">;

/**
 * Acrescenta as entradas ao fim do histórico da rota, num UPDATE só (a linha
 * fica travada durante ele: dois ciclos anotando juntos não perdem entrada),
 * e corta as mais antigas além do teto. Rota que não existe mais: nada.
 * NUNCA lança — erro (coluna ainda não criada, banco fora) vai para o log.
 * `banco` é para o teste (scripts/teste-roteirizacao-automatica.ts).
 */
export async function registrarNaRota(
  rotaId: string | null | undefined,
  entradas: (Omit<EntradaDoHistorico, "em"> & { em?: string })[],
  banco: BancoDoHistorico = prisma,
): Promise<boolean> {
  if (!rotaId || entradas.length === 0) return false;
  try {
    const novas = JSON.stringify(entradas.slice(-TETO_DO_HISTORICO).map(limpar));
    await banco.$executeRaw`
      UPDATE "RouteSchedule" SET "historico" = (
        SELECT COALESCE(jsonb_agg(t.e ORDER BY t.i), '[]'::jsonb)
        FROM jsonb_array_elements(COALESCE("historico", '[]'::jsonb) || ${novas}::jsonb) WITH ORDINALITY AS t(e, i)
        WHERE t.i > jsonb_array_length(COALESCE("historico", '[]'::jsonb) || ${novas}::jsonb) - ${TETO_DO_HISTORICO}
      )
      WHERE "id" = ${rotaId}
    `;
    return true;
  } catch (e: any) {
    console.warn(`[historico-da-rota] não anotei na rota ${rotaId}:`, String(e?.message || e).slice(0, 160));
    return false;
  }
}

/**
 * O histórico gravado da rota, para o log da lixeira: a linha vai sumir, e o
 * que ela guardava fica no log do servidor. Nunca lança; sem coluna = [].
 */
export async function lerHistoricoDaRota(rotaId: string): Promise<EntradaDoHistorico[]> {
  try {
    const linhas = await prisma.$queryRaw<{ historico: unknown }[]>`
      SELECT "historico" FROM "RouteSchedule" WHERE "id" = ${rotaId}
    `;
    const h = linhas[0]?.historico;
    return Array.isArray(h) ? (h as EntradaDoHistorico[]) : [];
  } catch (e: any) {
    console.warn(`[historico-da-rota] não li a rota ${rotaId}:`, String(e?.message || e).slice(0, 160));
    return [];
  }
}
