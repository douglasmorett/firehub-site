/**
 * A ASSINATURA DO CAIXA DE MERCADO — R$ 97 por computador de caixa em uso no
 * mês, numa linha própria do boleto da mensalidade.
 *
 * O liga/desliga é o dos módulos pagos (lib/modulo-pago.ts, mesmo desenho do
 * Tablet na mesa): a 1ª ativação ganha 7 dias grátis; desligar no teste é na
 * hora; depois do teste fica liberado até a virada do mês. O valor conta os
 * computadores que FUNCIONARAM (CaixaMercadoUso) no tempo cobrável do mês —
 * a mesma conta do tablet (`valorDoTabletNoMes`, reaproveitada: "tablet" lá é
 * o aparelho, aqui o computador).
 *
 * A mesma linha guarda a `config` da loja (etiqueta da balança, margem
 * padrão da importação, emitir NFC-e por padrão).
 */
import { prisma } from "@/lib/prisma";
import { desligamentoMarcado, ligadoAgora, quandoDesliga } from "@/lib/modulo-pago";
import { valorDoTabletNoMes } from "@/lib/tablet-da-mesa/assinatura";
import { garantirEstruturaDoCaixa, MENSAGEM_SEM_ESTRUTURA } from "./estrutura";
import { DIAS_DE_TESTE_DO_CAIXA, PRECO_POR_COMPUTADOR } from "./preco";
import { VERSAO_DO_TERMO_DO_CAIXA } from "./termo";
import { ETIQUETA_PADRAO, lerFormatoDaEtiqueta, type FormatoDaEtiqueta } from "./etiqueta";
import { lerPixDaLoja, type PixDaLoja } from "@/lib/pix-da-loja";

export { PRECO_POR_COMPUTADOR, DIAS_DE_TESTE_DO_CAIXA };
const DIA_MS = 24 * 60 * 60 * 1000;

export type AceiteDoTermo = { versao: string; em: string; email: string | null; ip: string | null; userAgent: string | null };
export type TrechoDoCaixa = { de: string; ate: string | null; valor: number; aceite?: AceiteDoTermo };

export type ConfigDoCaixa = {
  etiqueta: FormatoDaEtiqueta;
  /** Margem sobre o custo para o produto novo vindo do XML (0 = preço em branco). */
  margemPadrao: number;
  /** O caixa já abre com "emitir NFC-e" marcado. */
  emitirNfce: boolean;
};

export const CONFIG_PADRAO: ConfigDoCaixa = { etiqueta: ETIQUETA_PADRAO, margemPadrao: 0, emitirNfce: false };

export function lerConfigDoCaixa(bruto: unknown): ConfigDoCaixa {
  const c: any = typeof bruto === "string" ? (() => { try { return JSON.parse(bruto); } catch { return {}; } })() : bruto || {};
  const margem = Number(c.margemPadrao);
  return {
    etiqueta: lerFormatoDaEtiqueta(c.etiqueta),
    margemPadrao: Number.isFinite(margem) && margem >= 0 && margem <= 500 ? margem : 0,
    emitirNfce: c.emitirNfce === true,
  };
}

export type EstadoDoCaixa = {
  ativo: boolean;
  testeAte: string | null;
  emTeste: boolean;
  jaTestou: boolean;
  isento: boolean;
  preco: number;
  desligaEm: string | null;
  fimDoMes: string | null;
  computadoresCobradosEsteMes: number;
  valorEsteMes: number;
  config: ConfigDoCaixa;
};

type Linha = { ativo: boolean; testeAte: Date | null; trechos: unknown; config: unknown };

async function lerLinha(lojaId: string): Promise<Linha | null> {
  const linhas = await prisma.$queryRawUnsafe<Linha[]>(
    `SELECT "ativo", "testeAte", "trechos", "config" FROM "CaixaMercadoAssinatura" WHERE "franchiseeId" = $1`,
    lojaId,
  );
  return linhas[0] ?? null;
}

function lerTrechos(bruto: unknown): TrechoDoCaixa[] {
  const lista = typeof bruto === "string" ? (() => { try { return JSON.parse(bruto); } catch { return []; } })() : bruto;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((t: any) => t && typeof t.de === "string")
    .map((t: any) => ({ ...t, ate: typeof t.ate === "string" ? t.ate : null, valor: Number(t.valor) || PRECO_POR_COMPUTADOR }));
}

/** A loja não paga: mesma regra (e mesmos campos) da mensalidade. */
export async function caixaIsento(lojaId: string): Promise<boolean> {
  try {
    const { lojaIsenta } = await import("@/lib/billing");
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { email: true, planPercent: true, isFranqueadoHakim: true } });
    return lojaIsenta(loja as any);
  } catch {
    return false;
  }
}

async function mesCorrente(lojaId: string) {
  // Dinâmico: billing.ts importa este arquivo (também dinâmico) no fechamento.
  const { intervaloDoMes, getCurrentYearMonth } = await import("@/lib/billing");
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeTimezone: true } });
  const tz = loja?.storeTimezone || "America/Sao_Paulo";
  return intervaloDoMes(getCurrentYearMonth(0, tz), tz);
}

async function usosNoIntervalo(lojaId: string, inicio: Date, fim: Date) {
  const linhas = await prisma.$queryRawUnsafe<{ terminalId: string; em: Date }[]>(
    `SELECT "terminalId", "em" FROM "CaixaMercadoUso" WHERE "lojaId" = $1 AND "em" >= ($2::timestamptz AT TIME ZONE 'UTC') AND "em" < ($3::timestamptz AT TIME ZONE 'UTC')`,
    lojaId, inicio.toISOString(), fim.toISOString(),
  );
  return linhas.map((l) => ({ tabletId: l.terminalId, em: l.em }));
}

export async function estadoDoCaixa(lojaId: string, agora: Date = new Date()): Promise<EstadoDoCaixa> {
  const isento = await caixaIsento(lojaId);
  let fimDoMes: string | null = null;
  let mes: { monthStart: Date; monthEnd: Date } | null = null;
  try { mes = await mesCorrente(lojaId); fimDoMes = mes.monthEnd.toISOString(); } catch {}
  const vazio: EstadoDoCaixa = {
    ativo: isento, testeAte: null, emTeste: false, jaTestou: false, isento, preco: PRECO_POR_COMPUTADOR, desligaEm: null, fimDoMes,
    computadoresCobradosEsteMes: 0, valorEsteMes: 0, config: CONFIG_PADRAO,
  };
  if (!(await garantirEstruturaDoCaixa())) return vazio;
  const a = await lerLinha(lojaId);
  if (!a) return vazio;
  const trechos = lerTrechos(a.trechos);
  const ligado = ligadoAgora(trechos, agora);
  let cobrado = { tablets: 0, valor: 0 };
  if (!isento && mes) {
    try { cobrado = valorDoTabletNoMes(trechos, a.testeAte, await usosNoIntervalo(lojaId, mes.monthStart, mes.monthEnd), mes.monthStart, mes.monthEnd, agora); } catch {}
  }
  const aberto = trechos.find((t) => !t.ate || new Date(t.ate).getTime() > agora.getTime());
  return {
    ativo: ligado || isento,
    testeAte: a.testeAte ? new Date(a.testeAte).toISOString() : null,
    emTeste: Boolean(!isento && ligado && a.testeAte && new Date(a.testeAte).getTime() > agora.getTime()),
    jaTestou: Boolean(a.testeAte),
    isento,
    preco: ligado && aberto ? aberto.valor : PRECO_POR_COMPUTADOR,
    desligaEm: isento ? null : desligamentoMarcado(trechos, agora),
    fimDoMes,
    computadoresCobradosEsteMes: cobrado.tablets,
    valorEsteMes: cobrado.valor,
    config: lerConfigDoCaixa(a.config),
  };
}

/** Para o caixa e o pareamento: ligado (ou loja isenta). Nunca lança. */
export async function caixaEstaLigado(lojaId: string): Promise<boolean> {
  try {
    if (await garantirEstruturaDoCaixa()) {
      const a = await lerLinha(lojaId);
      if (a && ligadoAgora(lerTrechos(a.trechos))) return true;
    }
    return await caixaIsento(lojaId);
  } catch {
    return false;
  }
}

export async function configDoCaixa(lojaId: string): Promise<ConfigDoCaixa> {
  try {
    if (!(await garantirEstruturaDoCaixa())) return CONFIG_PADRAO;
    return lerConfigDoCaixa((await lerLinha(lojaId))?.config);
  } catch {
    return CONFIG_PADRAO;
  }
}

export async function salvarConfigDoCaixa(lojaId: string, config: ConfigDoCaixa): Promise<void> {
  if (!(await garantirEstruturaDoCaixa())) throw new Error(MENSAGEM_SEM_ESTRUTURA);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CaixaMercadoAssinatura" ("franchiseeId", "config", "atualizadoEm") VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT ("franchiseeId") DO UPDATE SET "config" = $2::jsonb, "atualizadoEm" = NOW()`,
    lojaId, JSON.stringify(config),
  );
}

/**
 * A chave Pix que o caixa usa: a da loja (`chatbotConfig.pixDaLoja`, a mesma do
 * robô), com uma CÓPIA em CaixaMercadoAssinatura.config.pixDaLoja. O
 * chatbotConfig não desce para o computador da loja no Modo Contingência (tem
 * chaves do robô); a chave Pix não é segredo, e com a cópia o Pix na tela
 * funciona sem internet. A cópia só é regravada quando muda.
 */
export async function pixDoCaixa(lojaId: string, chatbotConfig: unknown): Promise<PixDaLoja | null> {
  const pix = lerPixDaLoja(chatbotConfig);
  try {
    if (!(await garantirEstruturaDoCaixa())) return pix;
    if (pix) {
      const bruto = JSON.stringify((chatbotConfig as any)?.pixDaLoja ?? null);
      await prisma.$executeRawUnsafe(
        `UPDATE "CaixaMercadoAssinatura" SET "config" = jsonb_set(COALESCE("config", '{}'::jsonb), '{pixDaLoja}', $2::jsonb)
          WHERE "franchiseeId" = $1 AND ("config"->'pixDaLoja') IS DISTINCT FROM $2::jsonb`,
        lojaId, bruto,
      );
      return pix;
    }
    return lerPixDaLoja({ pixDaLoja: ((await lerLinha(lojaId))?.config as any)?.pixDaLoja });
  } catch {
    return pix;
  }
}

export class TermoNaoAceitoError extends Error {}

/** Liga (abre um trecho, com o aceite do termo) ou desliga — a regra do Tablet na mesa. */
export async function ligarOuDesligarCaixa(
  lojaId: string,
  ligar: boolean,
  aceite: Omit<AceiteDoTermo, "em"> | null,
  agora: Date = new Date(),
): Promise<EstadoDoCaixa> {
  if (await caixaIsento(lojaId)) return estadoDoCaixa(lojaId, agora);
  if (!(await garantirEstruturaDoCaixa())) throw new Error(MENSAGEM_SEM_ESTRUTURA);
  const atual = await lerLinha(lojaId);
  const trechos = lerTrechos(atual?.trechos);
  const iso = agora.toISOString();
  const ligado = ligadoAgora(trechos, agora);
  const salvar = (ativo: boolean) => prisma.$executeRawUnsafe(
    `UPDATE "CaixaMercadoAssinatura" SET "ativo" = $2, "trechos" = $3::jsonb, "atualizadoEm" = NOW() WHERE "franchiseeId" = $1`,
    lojaId, ativo, JSON.stringify(trechos),
  );

  if (ligar) {
    if (ligado) {
      const marcado = trechos.find((t) => t.ate && new Date(t.ate).getTime() > agora.getTime() && new Date(t.de).getTime() <= agora.getTime());
      if (marcado) { marcado.ate = null; await salvar(true); }
      return estadoDoCaixa(lojaId, agora);
    }
    if (!aceite || aceite.versao !== VERSAO_DO_TERMO_DO_CAIXA) {
      throw new TermoNaoAceitoError("Para ativar o Caixa de mercado é preciso aceitar o termo de contratação.");
    }
    trechos.push({ de: iso, ate: null, valor: PRECO_POR_COMPUTADOR, aceite: { ...aceite, em: iso } });
    const testeAte = atual?.testeAte ?? new Date(agora.getTime() + DIAS_DE_TESTE_DO_CAIXA * DIA_MS);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CaixaMercadoAssinatura" ("franchiseeId", "ativo", "testeAte", "trechos", "atualizadoEm")
       VALUES ($1, true, ($2::timestamptz AT TIME ZONE 'UTC'), $3::jsonb, NOW())
       ON CONFLICT ("franchiseeId") DO UPDATE SET "ativo" = true, "testeAte" = ($2::timestamptz AT TIME ZONE 'UTC'), "trechos" = $3::jsonb, "atualizadoEm" = NOW()`,
      lojaId, new Date(testeAte).toISOString(), JSON.stringify(trechos),
    );
  } else {
    if (!ligado) return estadoDoCaixa(lojaId, agora);
    const { monthEnd } = await mesCorrente(lojaId);
    const { naHora, ate } = quandoDesliga(atual?.testeAte, monthEnd, agora);
    for (const t of trechos) if (!t.ate || new Date(t.ate).getTime() > agora.getTime()) t.ate = ate.toISOString();
    await salvar(!naHora);
  }
  return estadoDoCaixa(lojaId, agora);
}

/** A linha do boleto do mês (0 = nada a cobrar). Nunca lança: sem tabela, sem cobrança. */
export async function cobrancaDoCaixaNoMes(lojaId: string, inicio: Date, fim: Date): Promise<number> {
  try {
    if (!(await garantirEstruturaDoCaixa())) return 0;
    if (await caixaIsento(lojaId)) return 0;
    const a = await lerLinha(lojaId);
    if (!a) return 0;
    return valorDoTabletNoMes(lerTrechos(a.trechos), a.testeAte, await usosNoIntervalo(lojaId, inicio, fim), inicio, fim).valor;
  } catch (err: any) {
    console.error("[Caixa de mercado] Erro ao calcular a cobrança do mês:", err?.message);
    return 0;
  }
}
