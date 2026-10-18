/**
 * PRAZO AUTOMÁTICO iFOOD E 99 — a extensão do FireHub que ajusta o prazo pela
 * fila da cozinha. Aqui mora o que o servidor faz com ela: o prazo que vale no
 * site da loja e a cobrança do mês.
 *
 * Douglas, 18/10/2026:
 * - "não faz sentido mudar do iFood e 99 e não mudar do nosso site": o prazo que
 *   a extensão aplicou também vale no site/robô da loja. Todas as áreas de
 *   entrega sobem a mesma diferença (a escada por distância continua) e nunca
 *   ficam abaixo do tempo que a loja cadastrou na área.
 * - "vai custar R$ 29,90. Ativou, tá usando, usou uma vez no mês, vem R$ 29,90 a
 *   mais na mensalidade": o mês em que o robô da extensão mandou algum prazo
 *   entra inteiro; mês sem uso não paga.
 *
 * Tudo em `User.etaConfig` (o mesmo JSON dos motoboys), sem tabela nova:
 *   prazoNoSite: { minutos, em }        — último prazo que a extensão mandou;
 *   usoPorMes:   { "2026-11": "<iso>" } — primeiro uso de cada mês.
 */

export const PRECO_DO_PRAZO_AUTOMATICO = 29.9;

/**
 * Primeiro mês cobrado. As lojas que já usavam a extensão de graça ficam sem
 * cobrança no mês em que o preço foi anunciado.
 */
export const COBRA_A_PARTIR_DE = "2026-11";

/** Sem sinal da extensão por mais que isto, o site volta ao tempo das áreas (PC desligado, robô parado). */
export const VALIDADE_DO_PRAZO_NO_SITE_MS = 15 * 60 * 1000;

/** O robô manda o prazo a cada minuto; regravar o mesmo número só depois disto. */
const REGRAVAR_O_MESMO_PRAZO_MS = 5 * 60 * 1000;

export type PrazoNoSite = { minutos: number; em: string };
export type ConfigDoPrazo = { prazoNoSite?: PrazoNoSite | null; usoPorMes?: Record<string, string> | null; [k: string]: unknown };

const comoConfig = (raw: unknown): ConfigDoPrazo => (raw && typeof raw === "object" ? (raw as ConfigDoPrazo) : {});

/** Prazo da extensão ainda valendo agora, ou null. */
export function prazoDaExtensaoAgora(etaConfig: unknown, agora: Date = new Date()): number | null {
  const p = comoConfig(etaConfig).prazoNoSite;
  if (!p || typeof p.minutos !== "number" || !(p.minutos > 0)) return null;
  const em = new Date(p.em).getTime();
  if (!Number.isFinite(em) || agora.getTime() - em > VALIDADE_DO_PRAZO_NO_SITE_MS) return null;
  return p.minutos;
}

/**
 * Quantos minutos somar em TODAS as áreas de entrega do site: a diferença entre o
 * prazo da extensão e a área mais rápida. Nunca negativo — o site não promete
 * menos do que a loja cadastrou.
 */
export function acrescimoNoSite(etaConfig: unknown, temposDasAreas: number[], agora: Date = new Date()): number {
  const prazo = prazoDaExtensaoAgora(etaConfig, agora);
  if (prazo === null) return 0;
  const tempos = temposDasAreas.filter((t) => Number.isFinite(t) && t > 0);
  if (tempos.length === 0) return 0;
  return Math.max(0, Math.round(prazo - Math.min(...tempos)));
}

/**
 * A loja com o `time` de cada área de entrega já somado ao acréscimo da
 * extensão — é por aqui que o site, o checkout, o pedido gravado e o robô
 * passam a dizer o mesmo prazo do iFood. Devolve `etaConfig: null` para que
 * passar duas vezes não some duas vezes.
 */
export function comPrazoDaExtensao<T extends { deliveryZones?: unknown; etaConfig?: unknown }>(loja: T, agora: Date = new Date()): T {
  if (!loja || !loja.etaConfig) return loja;
  const zonas = Array.isArray(loja.deliveryZones) ? loja.deliveryZones : [];
  const tempos = zonas.map((z: any) => Number(z?.time)).filter((t) => t > 0 && t <= 360);
  const acrescimo = acrescimoNoSite(loja.etaConfig, tempos, agora);
  if (acrescimo === 0) return { ...loja, etaConfig: null };
  return {
    ...loja,
    etaConfig: null,
    deliveryZones: zonas.map((z: any) => {
      const t = Number(z?.time);
      return t > 0 && t <= 360 ? { ...z, time: t + acrescimo } : z;
    }),
  };
}

/**
 * O etaConfig depois de a extensão mandar `minutos`, ou null se nada mudou
 * (evita um UPDATE por minuto por loja).
 */
export function comPrazoAplicado(etaConfig: unknown, minutos: number, yearMonth: string, agora: Date = new Date()): ConfigDoPrazo | null {
  const cfg = comoConfig(etaConfig);
  const anterior = cfg.prazoNoSite;
  const usoPorMes = { ...(cfg.usoPorMes || {}) };
  const novoUso = !usoPorMes[yearMonth];
  if (novoUso) usoPorMes[yearMonth] = agora.toISOString();

  const mesmoPrazo = anterior?.minutos === minutos
    && agora.getTime() - new Date(anterior.em).getTime() < REGRAVAR_O_MESMO_PRAZO_MS;
  if (mesmoPrazo && !novoUso) return null;

  return { ...cfg, prazoNoSite: { minutos, em: agora.toISOString() }, usoPorMes };
}

/** O valor do mês [inicio, fim) no boleto: usou em algum momento = o mês inteiro. */
export function valorDoPrazoNoMes(etaConfig: unknown, yearMonth: string, inicio: Date, fim: Date): number {
  if (yearMonth < COBRA_A_PARTIR_DE) return 0;
  const usos = Object.values(comoConfig(etaConfig).usoPorMes || {});
  const usou = usos.some((iso) => {
    const t = new Date(iso).getTime();
    return t >= inicio.getTime() && t < fim.getTime();
  });
  return usou ? PRECO_DO_PRAZO_AUTOMATICO : 0;
}

// ── No banco ─────────────────────────────────────────────────────────────

/** A extensão aplicou `minutos`: vale no site e marca o uso do mês. */
export async function registrarPrazoAplicado(lojaId: string, minutos: number): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const { getCurrentYearMonth } = await import("@/lib/billing");
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { etaConfig: true, storeTimezone: true } });
  if (!loja) return;
  const novo = comPrazoAplicado(loja.etaConfig, minutos, getCurrentYearMonth(0, loja.storeTimezone || "America/Sao_Paulo"));
  if (novo) await prisma.user.update({ where: { id: lojaId }, data: { etaConfig: novo as any } });
}

/** A linha do boleto do mês (0 = nada a cobrar). Nunca lança. */
export async function cobrancaDoPrazoAutomaticoNoMes(franchiseeId: string, inicio: Date, fim: Date): Promise<number> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { etaConfig: true, storeTimezone: true } });
    if (!loja) return 0;
    // O mês do intervalo: o instante do meio dele, no fuso da loja.
    const meio = new Date((inicio.getTime() + fim.getTime()) / 2);
    const yearMonth = new Intl.DateTimeFormat("en-CA", { timeZone: loja.storeTimezone || "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(meio);
    return valorDoPrazoNoMes(loja.etaConfig, yearMonth, inicio, fim);
  } catch (err: any) {
    console.error("[Prazo automático] Erro ao calcular a cobrança do mês:", err?.message);
    return 0;
  }
}
