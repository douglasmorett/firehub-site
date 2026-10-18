/**
 * A ASSINATURA DO MULTIMARCAS — R$ 97 por mês, numa linha própria do boleto
 * da mensalidade.
 *
 * Douglas, 17/10/2026: a página das marcas de quem tem várias lojas na mesma
 * cozinha (dark kitchen) é um módulo à parte: "vai ficar ativo se ele ativar,
 * se ele der ok, igual o assessor Bill. Ele vai pagar mais R$ 97". E: "o cara
 * vai pagar o valor normal por cada loja (2% do faturamento) e mais 97 para
 * ter essa página. Uma coisa nada a ver com a outra."
 *
 * A regra é a do Bill (lib/assessor/assinatura.ts), escrita no termo que o
 * dono aceita (lib/multimarcas/termo.ts):
 * - a PRIMEIRA ativação ganha 7 dias grátis; desligar e religar não dá outro;
 * - depois do teste, ativo em algum momento do mês = o mês inteiro, uma vez só;
 * - desligou: o mês seguinte não é cobrado.
 * O valor fica gravado em cada trecho, para um reajuste não mudar o que já foi
 * combinado com quem ativou antes (como o App da loja).
 *
 * Loja isenta (parceiro, conta da casa) tem o Multimarcas liberado sem pagar —
 * igual ao Bill, para embaixador e vendedor conseguirem mostrar.
 *
 * CORTESIA (Douglas, 17/10/2026): "se ele estiver pagando os dois aplicativos,
 * R$ 197 o pacote, ele não paga essa estrutura. Só se tiver os dois, Apple e
 * Android." O mês em que o Aplicativo da loja completo esteve ligado não cobra
 * o Multimarcas (lib/app-da-loja/plano.ts → appCompletoNoMes). Ele continua
 * tendo que ativar: a cortesia é do valor, não liga sozinha.
 *
 * Tabela própria criada no primeiro uso (como lib/app-da-loja/plano.ts): se
 * faltar, só o Multimarcas para de cobrar.
 */
import { prisma } from "@/lib/prisma";
import { VERSAO_DO_TERMO_DO_MULTIMARCAS } from "./termo";
import { desligamentoMarcado, ligadoAgora, quandoDesliga } from "@/lib/modulo-pago";

import { PRECO_DO_MULTIMARCAS } from "./preco";

export { PRECO_DO_MULTIMARCAS };
export const DIAS_DE_TESTE_DO_MULTIMARCAS = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

export type AceiteDoTermo = { versao: string; em: string; email: string | null; ip: string | null; userAgent: string | null };
/** Um trecho ligado. `ate` nulo = ligado agora. */
export type TrechoDoMultimarcas = { de: string; ate: string | null; valor: number; aceite?: AceiteDoTermo };

export type EstadoDoMultimarcas = {
  ativo: boolean;
  /** O mês corrente já entra no boleto. */
  cobradoEsteMes: boolean;
  testeAte: string | null;
  emTeste: boolean;
  jaTestou: boolean;
  isento: boolean;
  /** Tem o Aplicativo da loja Android + Apple ligado agora: o Multimarcas não é cobrado. */
  cortesia: boolean;
  /** Quanto esta loja paga por mês: o do trecho ligado; desligada, o de quem ativar hoje. */
  preco: number;
  /** Desligamento marcado para a virada do mês (o mês já está pago): quando desliga sozinho. */
  desligaEm: string | null;
  /** O início do mês seguinte (fuso da loja): quando desligaria se desligar agora, fora do teste. */
  fimDoMes: string | null;
  trechos: TrechoDoMultimarcas[];
};

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "MultimarcasAssinatura" (
     "franchiseeId" TEXT NOT NULL,
     "ativo" BOOLEAN NOT NULL DEFAULT false,
     "testeAte" TIMESTAMP(3),
     "trechos" JSONB NOT NULL DEFAULT '[]',
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "MultimarcasAssinatura_pkey" PRIMARY KEY ("franchiseeId")
   )`,
];

let pronto = false;
export async function garantirEstruturaDoMultimarcas(): Promise<boolean> {
  if (pronto) return true;
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[Multimarcas] Estrutura da assinatura falhou:", err?.message);
  }
  return pronto;
}

type Linha = { ativo: boolean; testeAte: Date | null; trechos: unknown };

async function lerLinha(franchiseeId: string): Promise<Linha | null> {
  const linhas = await prisma.$queryRawUnsafe<Linha[]>(
    `SELECT "ativo", "testeAte", "trechos" FROM "MultimarcasAssinatura" WHERE "franchiseeId" = $1`,
    franchiseeId,
  );
  return linhas[0] ?? null;
}

function lerTrechos(bruto: unknown): TrechoDoMultimarcas[] {
  const lista = typeof bruto === "string" ? (() => { try { return JSON.parse(bruto); } catch { return []; } })() : bruto;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((t: any) => t && typeof t.de === "string")
    .map((t: any) => ({ ...t, ate: typeof t.ate === "string" ? t.ate : null, valor: Number(t.valor) || PRECO_DO_MULTIMARCAS }));
}

/**
 * Quanto o Multimarcas custa no mês [inicio, fim). Puro, para o teste.
 * Ativo em qualquer instante do mês depois dos dias grátis = o mês inteiro;
 * dois trechos com valores diferentes no mesmo mês: vale o maior, uma vez só.
 */
export function valorDoMultimarcasNoMes(
  trechos: TrechoDoMultimarcas[],
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

/**
 * Lojas com o Multimarcas liberado sem os R$ 97 por combinado particular do
 * Douglas com o dono (18/10/2026: Lucas, Frangoso - Trindade — a mensalidade
 * dela segue à parte, combinada fora do sistema). Pelo slug do cardápio.
 */
const LOJAS_COM_MULTIMARCAS_LIBERADO = new Set(["frangoso-trindade"]);

/** A loja não paga: mesma regra (e mesmos campos) da mensalidade, ou combinado particular. */
export async function multimarcasIsento(franchiseeId: string): Promise<boolean> {
  try {
    const { lojaIsenta } = await import("@/lib/billing");
    const loja = await prisma.user.findUnique({
      where: { id: franchiseeId },
      select: { email: true, planPercent: true, isFranqueadoHakim: true, slug: true },
    });
    if (loja?.slug && LOJAS_COM_MULTIMARCAS_LIBERADO.has(loja.slug)) return true;
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

/** O Aplicativo da loja completo (Android + Apple) está ligado agora. */
async function temAppCompleto(franchiseeId: string): Promise<boolean> {
  try {
    const { estadoDoApp } = await import("@/lib/app-da-loja/plano");
    return (await estadoDoApp(franchiseeId)).plataformas === "ambos";
  } catch {
    return false;
  }
}

export async function estadoDoMultimarcas(franchiseeId: string, agora: Date = new Date()): Promise<EstadoDoMultimarcas> {
  const isento = await multimarcasIsento(franchiseeId);
  const cortesia = !isento && (await temAppCompleto(franchiseeId));
  let fimDoMes: string | null = null;
  try { fimDoMes = (await mesCorrente(franchiseeId)).monthEnd.toISOString(); } catch {}
  const vazio: EstadoDoMultimarcas = { ativo: isento, cobradoEsteMes: false, testeAte: null, emTeste: false, jaTestou: false, isento, cortesia, preco: PRECO_DO_MULTIMARCAS, desligaEm: null, fimDoMes, trechos: [] };
  if (!(await garantirEstruturaDoMultimarcas())) return vazio;
  const a = await lerLinha(franchiseeId);
  if (!a) return vazio;
  const trechos = lerTrechos(a.trechos);
  // Ligado pelos trechos: o desligamento marcado para a virada do mês vale sozinho (lib/modulo-pago.ts).
  const ligado = ligadoAgora(trechos, agora);
  let cobradoEsteMes = false;
  try {
    const { monthStart, monthEnd } = await mesCorrente(franchiseeId);
    cobradoEsteMes = !isento && valorDoMultimarcasNoMes(trechos, a.testeAte, monthStart, monthEnd, agora) > 0;
    if (cobradoEsteMes) {
      const { appCompletoNoMes } = await import("@/lib/app-da-loja/plano");
      if (await appCompletoNoMes(franchiseeId, monthStart, monthEnd)) cobradoEsteMes = false;
    }
  } catch {}
  const aberto = trechos.find((t) => !t.ate || new Date(t.ate).getTime() > agora.getTime());
  return {
    ativo: ligado || isento,
    cobradoEsteMes,
    testeAte: a.testeAte ? new Date(a.testeAte).toISOString() : null,
    emTeste: Boolean(!isento && ligado && a.testeAte && new Date(a.testeAte).getTime() > agora.getTime()),
    jaTestou: Boolean(a.testeAte),
    isento,
    cortesia,
    preco: ligado && aberto ? aberto.valor : PRECO_DO_MULTIMARCAS,
    desligaEm: isento ? null : desligamentoMarcado(trechos, agora),
    fimDoMes,
    trechos,
  };
}

/** Para o menu e a página pública: ligado (ou loja isenta). Nunca lança. */
export async function multimarcasEstaLigado(franchiseeId: string): Promise<boolean> {
  try {
    if (await garantirEstruturaDoMultimarcas()) {
      const a = await lerLinha(franchiseeId);
      if (a && ligadoAgora(lerTrechos(a.trechos))) return true;
    }
    return await multimarcasIsento(franchiseeId);
  } catch {
    return false;
  }
}

export class TermoNaoAceitoError extends Error {}

/**
 * Liga (abre um trecho, com o aceite do termo) ou desliga.
 * Desligar: no teste grátis, na hora; depois dele, marca o fim do trecho para a
 * virada do mês — o mês já está no boleto, então fica liberado até lá
 * (lib/modulo-pago.ts). Ligar com o desligamento marcado só desmarca (continua
 * o mesmo trecho, sem novo termo).
 */
export async function ligarOuDesligarMultimarcas(
  franchiseeId: string,
  ligar: boolean,
  aceite: Omit<AceiteDoTermo, "em"> | null,
  agora: Date = new Date(),
): Promise<EstadoDoMultimarcas> {
  // Loja isenta: já está liberado e não desliga — nada a gravar.
  if (await multimarcasIsento(franchiseeId)) return estadoDoMultimarcas(franchiseeId, agora);
  if (!(await garantirEstruturaDoMultimarcas())) throw new Error("O Multimarcas ainda não está disponível. Tente de novo em alguns minutos.");
  const atual = await lerLinha(franchiseeId);
  const trechos = lerTrechos(atual?.trechos);
  const iso = agora.toISOString();

  const ligado = ligadoAgora(trechos, agora);
  const salvar = (ativo: boolean) => prisma.$executeRawUnsafe(
    `UPDATE "MultimarcasAssinatura" SET "ativo" = $2, "trechos" = $3::jsonb, "atualizadoEm" = NOW() WHERE "franchiseeId" = $1`,
    franchiseeId, ativo, JSON.stringify(trechos),
  );

  if (ligar) {
    if (ligado) {
      // Desligamento marcado para a virada do mês: "continuar ligado" desmarca.
      const marcado = trechos.find((t) => t.ate && new Date(t.ate).getTime() > agora.getTime() && new Date(t.de).getTime() <= agora.getTime());
      if (marcado) { marcado.ate = null; await salvar(true); }
      return estadoDoMultimarcas(franchiseeId, agora);
    }
    if (!aceite || aceite.versao !== VERSAO_DO_TERMO_DO_MULTIMARCAS) {
      throw new TermoNaoAceitoError("Para ativar o Multimarcas é preciso aceitar o termo de contratação.");
    }
    trechos.push({ de: iso, ate: null, valor: PRECO_DO_MULTIMARCAS, aceite: { ...aceite, em: iso } });
    // Só a primeira ativação ganha os dias grátis; depois o `testeAte` fica como está.
    const testeAte = atual?.testeAte ?? new Date(agora.getTime() + DIAS_DE_TESTE_DO_MULTIMARCAS * DIA_MS);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MultimarcasAssinatura" ("franchiseeId", "ativo", "testeAte", "trechos", "atualizadoEm")
       VALUES ($1, true, $2, $3::jsonb, NOW())
       ON CONFLICT ("franchiseeId") DO UPDATE SET "ativo" = true, "testeAte" = $2, "trechos" = $3::jsonb, "atualizadoEm" = NOW()`,
      franchiseeId, testeAte, JSON.stringify(trechos),
    );
  } else {
    if (!ligado) return estadoDoMultimarcas(franchiseeId, agora);
    const { monthEnd } = await mesCorrente(franchiseeId);
    const { naHora, ate } = quandoDesliga(atual?.testeAte, monthEnd, agora);
    for (const t of trechos) if (!t.ate || new Date(t.ate).getTime() > agora.getTime()) t.ate = ate.toISOString();
    await salvar(!naHora);
  }
  return estadoDoMultimarcas(franchiseeId, agora);
}

/** A linha do boleto do mês (0 = nada a cobrar). Nunca lança: sem tabela, sem cobrança. */
export async function cobrancaDoMultimarcasNoMes(franchiseeId: string, inicio: Date, fim: Date): Promise<number> {
  try {
    if (!(await garantirEstruturaDoMultimarcas())) return 0;
    if (await multimarcasIsento(franchiseeId)) return 0;
    const a = await lerLinha(franchiseeId);
    if (!a) return 0;
    const valor = valorDoMultimarcasNoMes(lerTrechos(a.trechos), a.testeAte, inicio, fim);
    if (valor <= 0) return 0;
    // Cortesia: o mês em que pagou o Aplicativo da loja completo (Android + Apple).
    const { appCompletoNoMes } = await import("@/lib/app-da-loja/plano");
    return (await appCompletoNoMes(franchiseeId, inicio, fim)) ? 0 : valor;
  } catch (err: any) {
    console.error("[Multimarcas] Erro ao calcular a cobrança do mês:", err?.message);
    return 0;
  }
}
