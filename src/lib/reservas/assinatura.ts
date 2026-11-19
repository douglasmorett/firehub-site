/**
 * A ASSINATURA DO MÓDULO RESERVAS DE MESA — R$ 49,90 por mês, numa linha própria
 * do boleto da mensalidade — e a configuração das reservas da loja.
 *
 * A regra é a dos módulos pagos (a da Balança, lib/balanca/assinatura.ts),
 * escrita no termo (./termo.ts):
 * - a PRIMEIRA ativação ganha 7 dias grátis; desligar e religar não dá outro;
 * - depois do teste, ativo em algum momento do mês = o mês inteiro, uma vez só;
 * - desligou depois do teste: liberado até a virada, o mês seguinte não é cobrado.
 * O valor fica gravado em cada trecho: um reajuste não muda o combinado.
 *
 * A mesma linha guarda a configuração (`config`, lib/reservas/regras.ts):
 * horários, duração, quantas reservas ao mesmo tempo. Tabelas próprias,
 * criadas no primeiro uso (./estrutura.ts): se faltarem, só as reservas param.
 */
import { prisma } from "@/lib/prisma";
import { desligamentoMarcado, ligadoAgora, quandoDesliga } from "@/lib/modulo-pago";
import { VERSAO_DO_TERMO_DAS_RESERVAS } from "./termo";
import { DIAS_DE_TESTE_DAS_RESERVAS, PRECO_DAS_RESERVAS } from "./preco";
import { garantirEstruturaDasReservas } from "./estrutura";
import { lerConfig, type ConfigDasReservas } from "./regras";

export { DIAS_DE_TESTE_DAS_RESERVAS, PRECO_DAS_RESERVAS };
const DIA_MS = 24 * 60 * 60 * 1000;

export type AceiteDoTermo = { versao: string; em: string; email: string | null; ip: string | null; userAgent: string | null };
/** Um trecho ligado. `ate` nulo = ligado agora. */
export type TrechoDasReservas = { de: string; ate: string | null; valor: number; aceite?: AceiteDoTermo };

export type EstadoDasReservas = {
  ativo: boolean;
  cobradoEsteMes: boolean;
  testeAte: string | null;
  emTeste: boolean;
  jaTestou: boolean;
  isento: boolean;
  preco: number;
  desligaEm: string | null;
  fimDoMes: string | null;
  trechos: TrechoDasReservas[];
  /** A loja já salvou a configuração alguma vez (senão a tela mostra o padrão para ela conferir). */
  configurado: boolean;
  config: ConfigDasReservas;
};

type Linha = { ativo: boolean; testeAte: Date | null; trechos: unknown; config: unknown };

async function lerLinha(franchiseeId: string): Promise<Linha | null> {
  const linhas = await prisma.$queryRawUnsafe<Linha[]>(
    `SELECT "ativo", "testeAte", "trechos", "config" FROM "ReservasAssinatura" WHERE "franchiseeId" = $1`,
    franchiseeId,
  );
  return linhas[0] ?? null;
}

const lerJson = (bruto: unknown): unknown =>
  typeof bruto === "string" ? (() => { try { return JSON.parse(bruto); } catch { return null; } })() : bruto;

function lerTrechos(bruto: unknown): TrechoDasReservas[] {
  const lista = lerJson(bruto);
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((t: any) => t && typeof t.de === "string")
    .map((t: any) => ({ ...t, ate: typeof t.ate === "string" ? t.ate : null, valor: Number(t.valor) || PRECO_DAS_RESERVAS }));
}

const configGravada = (bruto: unknown) => {
  const c = lerJson(bruto);
  return c && typeof c === "object" && Object.keys(c as object).length > 0 ? c : null;
};

/**
 * Quanto o módulo custa no mês [inicio, fim). Puro, para o teste.
 * Ativo em qualquer instante do mês depois dos dias grátis = o mês inteiro;
 * dois trechos com valores diferentes no mesmo mês: vale o maior, uma vez só.
 */
export function valorDasReservasNoMes(
  trechos: TrechoDasReservas[],
  testeAte: Date | string | null | undefined,
  inicio: Date,
  fim: Date,
  agora: Date = new Date(),
): number {
  const fimDoTeste = testeAte ? new Date(testeAte).getTime() : 0;
  const ini = Math.max(inicio.getTime(), fimDoTeste);
  const fimMs = fim.getTime();
  if (ini >= fimMs) return 0;
  let valor = 0;
  for (const t of trechos) {
    const de = Math.max(new Date(t.de).getTime(), ini);
    const ate = Math.min(t.ate ? new Date(t.ate).getTime() : Math.max(agora.getTime(), de + 1), fimMs);
    if (ate > de) valor = Math.max(valor, t.valor);
  }
  return valor;
}

/** A loja não paga: mesma regra (e mesmos campos) da mensalidade. */
export async function reservasIsentas(franchiseeId: string): Promise<boolean> {
  try {
    const { lojaIsenta } = await import("@/lib/billing");
    const loja = await prisma.user.findUnique({
      where: { id: franchiseeId },
      select: { email: true, planPercent: true, isFranqueadoHakim: true },
    });
    return lojaIsenta(loja as any);
  } catch {
    return false;
  }
}

async function mesCorrente(franchiseeId: string) {
  // Dinâmico: billing.ts importa este arquivo (também dinâmico) no fechamento.
  const { intervaloDoMes, getCurrentYearMonth } = await import("@/lib/billing");
  const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeTimezone: true } });
  const tz = loja?.storeTimezone || "America/Sao_Paulo";
  return intervaloDoMes(getCurrentYearMonth(0, tz), tz);
}

export async function estadoDasReservas(franchiseeId: string, agora: Date = new Date()): Promise<EstadoDasReservas> {
  const isento = await reservasIsentas(franchiseeId);
  let fimDoMes: string | null = null;
  try { fimDoMes = (await mesCorrente(franchiseeId)).monthEnd.toISOString(); } catch {}
  const vazio: EstadoDasReservas = {
    ativo: isento, cobradoEsteMes: false, testeAte: null, emTeste: false, jaTestou: false, isento, preco: PRECO_DAS_RESERVAS,
    desligaEm: null, fimDoMes, trechos: [], configurado: false, config: lerConfig(null),
  };
  if (!(await garantirEstruturaDasReservas())) return vazio;
  const a = await lerLinha(franchiseeId);
  if (!a) return vazio;
  const trechos = lerTrechos(a.trechos);
  const ligado = ligadoAgora(trechos, agora);
  let cobradoEsteMes = false;
  try {
    const { monthStart, monthEnd } = await mesCorrente(franchiseeId);
    cobradoEsteMes = !isento && valorDasReservasNoMes(trechos, a.testeAte, monthStart, monthEnd, agora) > 0;
  } catch {}
  const aberto = trechos.find((t) => !t.ate || new Date(t.ate).getTime() > agora.getTime());
  const gravada = configGravada(a.config);
  return {
    ativo: ligado || isento,
    cobradoEsteMes,
    testeAte: a.testeAte ? new Date(a.testeAte).toISOString() : null,
    emTeste: Boolean(!isento && ligado && a.testeAte && new Date(a.testeAte).getTime() > agora.getTime()),
    jaTestou: Boolean(a.testeAte),
    isento,
    preco: ligado && aberto ? aberto.valor : PRECO_DAS_RESERVAS,
    desligaEm: isento ? null : desligamentoMarcado(trechos, agora),
    fimDoMes,
    trechos,
    configurado: Boolean(gravada),
    config: lerConfig(gravada),
  };
}

/**
 * Para o robô e para o Bill: o módulo está ligado (ou a loja é isenta)? E a
 * configuração. Nunca lança: qualquer falha = desligado, e o robô segue como
 * sempre atendeu reserva.
 */
export async function reservasDaLoja(franchiseeId: string): Promise<{ ligado: boolean; config: ConfigDasReservas }> {
  const desligado = { ligado: false, config: lerConfig(null) };
  try {
    if (!(await garantirEstruturaDasReservas())) return desligado;
    const a = await lerLinha(franchiseeId);
    const ligado = (a && ligadoAgora(lerTrechos(a.trechos))) || (await reservasIsentas(franchiseeId));
    return { ligado: Boolean(ligado), config: lerConfig(configGravada(a?.config)) };
  } catch {
    return desligado;
  }
}

/** Grava a configuração (quem chama confere a sessão). Devolve a configuração já conferida. */
export async function salvarConfigDasReservas(franchiseeId: string, bruto: unknown): Promise<ConfigDasReservas> {
  if (!(await garantirEstruturaDasReservas())) throw new Error("As reservas ainda não estão disponíveis. Tente de novo em alguns minutos.");
  const config = lerConfig(bruto);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ReservasAssinatura" ("franchiseeId", "config", "atualizadoEm") VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT ("franchiseeId") DO UPDATE SET "config" = $2::jsonb, "atualizadoEm" = NOW()`,
    franchiseeId, JSON.stringify(config),
  );
  return config;
}

export class TermoNaoAceitoError extends Error {}

/**
 * Liga (abre um trecho, com o aceite do termo) ou desliga.
 * Desligar: no teste grátis, na hora; depois dele, marca o fim do trecho para a
 * virada do mês (lib/modulo-pago.ts). Ligar com o desligamento marcado só
 * desmarca (continua o mesmo trecho, sem novo termo).
 */
export async function ligarOuDesligarReservas(
  franchiseeId: string,
  ligar: boolean,
  aceite: Omit<AceiteDoTermo, "em"> | null,
  agora: Date = new Date(),
): Promise<EstadoDasReservas> {
  if (await reservasIsentas(franchiseeId)) return estadoDasReservas(franchiseeId, agora);
  if (!(await garantirEstruturaDasReservas())) throw new Error("As reservas ainda não estão disponíveis. Tente de novo em alguns minutos.");
  const atual = await lerLinha(franchiseeId);
  const trechos = lerTrechos(atual?.trechos);
  const iso = agora.toISOString();

  const ligado = ligadoAgora(trechos, agora);
  const salvar = (ativo: boolean) => prisma.$executeRawUnsafe(
    `UPDATE "ReservasAssinatura" SET "ativo" = $2, "trechos" = $3::jsonb, "atualizadoEm" = NOW() WHERE "franchiseeId" = $1`,
    franchiseeId, ativo, JSON.stringify(trechos),
  );

  if (ligar) {
    if (ligado) {
      const marcado = trechos.find((t) => t.ate && new Date(t.ate).getTime() > agora.getTime() && new Date(t.de).getTime() <= agora.getTime());
      if (marcado) { marcado.ate = null; await salvar(true); }
      return estadoDasReservas(franchiseeId, agora);
    }
    if (!aceite || aceite.versao !== VERSAO_DO_TERMO_DAS_RESERVAS) {
      throw new TermoNaoAceitoError("Para ativar as reservas é preciso aceitar o termo de contratação.");
    }
    trechos.push({ de: iso, ate: null, valor: PRECO_DAS_RESERVAS, aceite: { ...aceite, em: iso } });
    // Só a primeira ativação ganha os dias grátis; depois o `testeAte` fica como está.
    const testeAte = atual?.testeAte ?? new Date(agora.getTime() + DIAS_DE_TESTE_DAS_RESERVAS * DIA_MS);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ReservasAssinatura" ("franchiseeId", "ativo", "testeAte", "trechos", "atualizadoEm")
       VALUES ($1, true, $2, $3::jsonb, NOW())
       ON CONFLICT ("franchiseeId") DO UPDATE SET "ativo" = true, "testeAte" = $2, "trechos" = $3::jsonb, "atualizadoEm" = NOW()`,
      franchiseeId, testeAte, JSON.stringify(trechos),
    );
  } else {
    if (!ligado) return estadoDasReservas(franchiseeId, agora);
    const { monthEnd } = await mesCorrente(franchiseeId);
    const { naHora, ate } = quandoDesliga(atual?.testeAte, monthEnd, agora);
    for (const t of trechos) if (!t.ate || new Date(t.ate).getTime() > agora.getTime()) t.ate = ate.toISOString();
    await salvar(!naHora);
  }
  return estadoDasReservas(franchiseeId, agora);
}

/** A linha do boleto do mês (0 = nada a cobrar). Nunca lança: sem tabela, sem cobrança. */
export async function cobrancaDasReservasNoMes(franchiseeId: string, inicio: Date, fim: Date): Promise<number> {
  try {
    if (!(await garantirEstruturaDasReservas())) return 0;
    if (await reservasIsentas(franchiseeId)) return 0;
    const a = await lerLinha(franchiseeId);
    if (!a) return 0;
    return valorDasReservasNoMes(lerTrechos(a.trechos), a.testeAte, inicio, fim);
  } catch (err: any) {
    console.error("[Reservas] Erro ao calcular a cobrança do mês:", err?.message);
    return 0;
  }
}
