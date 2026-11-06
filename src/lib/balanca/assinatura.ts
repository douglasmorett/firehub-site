/**
 * A ASSINATURA DO MÓDULO BALANÇA (self-service por quilo) — R$ 197 por mês,
 * numa linha própria do boleto da mensalidade.
 *
 * Douglas, 05/11/2026: módulo à parte, só mensalidade, sem entregar
 * equipamento; a mensalidade do sistema continua sobre todas as vendas, as
 * pesadas também. A regra é a dos módulos pagos (a do Multimarcas,
 * lib/multimarcas/assinatura.ts), escrita no termo (./termo.ts):
 * - a PRIMEIRA ativação ganha 7 dias grátis; desligar e religar não dá outro;
 * - depois do teste, ativo em algum momento do mês = o mês inteiro, uma vez só;
 * - desligou depois do teste: liberado até a virada, o mês seguinte não é cobrado.
 * O valor fica gravado em cada trecho: um reajuste não muda o combinado.
 *
 * A mesma linha guarda QUAIS produtos do cardápio são vendidos por quilo
 * (`produtos`): o preço do produto (o do salão) é o preço do quilo.
 *
 * Tabela própria criada no primeiro uso: se faltar, só a balança para.
 */
import { prisma } from "@/lib/prisma";
import { desligamentoMarcado, ligadoAgora, quandoDesliga } from "@/lib/modulo-pago";
import { VERSAO_DO_TERMO_DA_BALANCA } from "./termo";
import { DIAS_DE_TESTE_DA_BALANCA, PRECO_DA_BALANCA } from "./preco";

export { DIAS_DE_TESTE_DA_BALANCA, PRECO_DA_BALANCA };
const DIA_MS = 24 * 60 * 60 * 1000;

export type AceiteDoTermo = { versao: string; em: string; email: string | null; ip: string | null; userAgent: string | null };
/** Um trecho ligado. `ate` nulo = ligado agora. */
export type TrechoDaBalanca = { de: string; ate: string | null; valor: number; aceite?: AceiteDoTermo };

export type EstadoDaBalanca = {
  ativo: boolean;
  cobradoEsteMes: boolean;
  testeAte: string | null;
  emTeste: boolean;
  jaTestou: boolean;
  isento: boolean;
  preco: number;
  desligaEm: string | null;
  fimDoMes: string | null;
  trechos: TrechoDaBalanca[];
  /** Os produtos vendidos por quilo (ids do cardápio). */
  produtos: string[];
};

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "BalancaAssinatura" (
     "franchiseeId" TEXT NOT NULL,
     "ativo" BOOLEAN NOT NULL DEFAULT false,
     "testeAte" TIMESTAMP(3),
     "trechos" JSONB NOT NULL DEFAULT '[]',
     "produtos" JSONB NOT NULL DEFAULT '[]',
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "BalancaAssinatura_pkey" PRIMARY KEY ("franchiseeId")
   )`,
];

let pronto = false;
export async function garantirEstruturaDaBalanca(): Promise<boolean> {
  if (pronto) return true;
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[Balança] Estrutura da assinatura falhou:", err?.message);
  }
  return pronto;
}

type Linha = { ativo: boolean; testeAte: Date | null; trechos: unknown; produtos: unknown };

async function lerLinha(franchiseeId: string): Promise<Linha | null> {
  const linhas = await prisma.$queryRawUnsafe<Linha[]>(
    `SELECT "ativo", "testeAte", "trechos", "produtos" FROM "BalancaAssinatura" WHERE "franchiseeId" = $1`,
    franchiseeId,
  );
  return linhas[0] ?? null;
}

const lerJson = (bruto: unknown): unknown =>
  typeof bruto === "string" ? (() => { try { return JSON.parse(bruto); } catch { return null; } })() : bruto;

function lerTrechos(bruto: unknown): TrechoDaBalanca[] {
  const lista = lerJson(bruto);
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((t: any) => t && typeof t.de === "string")
    .map((t: any) => ({ ...t, ate: typeof t.ate === "string" ? t.ate : null, valor: Number(t.valor) || PRECO_DA_BALANCA }));
}

function lerProdutos(bruto: unknown): string[] {
  const lista = lerJson(bruto);
  return Array.isArray(lista) ? lista.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}

/**
 * Quanto o módulo custa no mês [inicio, fim). Puro, para o teste.
 * Ativo em qualquer instante do mês depois dos dias grátis = o mês inteiro;
 * dois trechos com valores diferentes no mesmo mês: vale o maior, uma vez só.
 */
export function valorDaBalancaNoMes(
  trechos: TrechoDaBalanca[],
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
export async function balancaIsenta(franchiseeId: string): Promise<boolean> {
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

export async function estadoDaBalanca(franchiseeId: string, agora: Date = new Date()): Promise<EstadoDaBalanca> {
  const isento = await balancaIsenta(franchiseeId);
  let fimDoMes: string | null = null;
  try { fimDoMes = (await mesCorrente(franchiseeId)).monthEnd.toISOString(); } catch {}
  const vazio: EstadoDaBalanca = { ativo: isento, cobradoEsteMes: false, testeAte: null, emTeste: false, jaTestou: false, isento, preco: PRECO_DA_BALANCA, desligaEm: null, fimDoMes, trechos: [], produtos: [] };
  if (!(await garantirEstruturaDaBalanca())) return vazio;
  const a = await lerLinha(franchiseeId);
  if (!a) return vazio;
  const trechos = lerTrechos(a.trechos);
  const ligado = ligadoAgora(trechos, agora);
  let cobradoEsteMes = false;
  try {
    const { monthStart, monthEnd } = await mesCorrente(franchiseeId);
    cobradoEsteMes = !isento && valorDaBalancaNoMes(trechos, a.testeAte, monthStart, monthEnd, agora) > 0;
  } catch {}
  const aberto = trechos.find((t) => !t.ate || new Date(t.ate).getTime() > agora.getTime());
  return {
    ativo: ligado || isento,
    cobradoEsteMes,
    testeAte: a.testeAte ? new Date(a.testeAte).toISOString() : null,
    emTeste: Boolean(!isento && ligado && a.testeAte && new Date(a.testeAte).getTime() > agora.getTime()),
    jaTestou: Boolean(a.testeAte),
    isento,
    preco: ligado && aberto ? aberto.valor : PRECO_DA_BALANCA,
    desligaEm: isento ? null : desligamentoMarcado(trechos, agora),
    fimDoMes,
    trechos,
    produtos: lerProdutos(a.produtos),
  };
}

/** Para a tela da balança e a pesagem: ligado (ou loja isenta). Nunca lança. */
export async function balancaEstaLigada(franchiseeId: string): Promise<boolean> {
  try {
    if (await garantirEstruturaDaBalanca()) {
      const a = await lerLinha(franchiseeId);
      if (a && ligadoAgora(lerTrechos(a.trechos))) return true;
    }
    return await balancaIsenta(franchiseeId);
  } catch {
    return false;
  }
}

/** Os produtos vendidos por quilo desta loja (vazio sem a tabela). */
export async function produtosDaBalanca(franchiseeId: string): Promise<string[]> {
  try {
    if (!(await garantirEstruturaDaBalanca())) return [];
    return lerProdutos((await lerLinha(franchiseeId))?.produtos);
  } catch {
    return [];
  }
}

/** Grava a lista de produtos por quilo (só ids desta loja; quem chama confere). */
export async function salvarProdutosDaBalanca(franchiseeId: string, produtos: string[]): Promise<void> {
  if (!(await garantirEstruturaDaBalanca())) throw new Error("A balança ainda não está disponível. Tente de novo em alguns minutos.");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "BalancaAssinatura" ("franchiseeId", "produtos", "atualizadoEm") VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT ("franchiseeId") DO UPDATE SET "produtos" = $2::jsonb, "atualizadoEm" = NOW()`,
    franchiseeId, JSON.stringify(produtos),
  );
}

export class TermoNaoAceitoError extends Error {}

/**
 * Liga (abre um trecho, com o aceite do termo) ou desliga.
 * Desligar: no teste grátis, na hora; depois dele, marca o fim do trecho para a
 * virada do mês (lib/modulo-pago.ts). Ligar com o desligamento marcado só
 * desmarca (continua o mesmo trecho, sem novo termo).
 */
export async function ligarOuDesligarBalanca(
  franchiseeId: string,
  ligar: boolean,
  aceite: Omit<AceiteDoTermo, "em"> | null,
  agora: Date = new Date(),
): Promise<EstadoDaBalanca> {
  if (await balancaIsenta(franchiseeId)) return estadoDaBalanca(franchiseeId, agora);
  if (!(await garantirEstruturaDaBalanca())) throw new Error("A balança ainda não está disponível. Tente de novo em alguns minutos.");
  const atual = await lerLinha(franchiseeId);
  const trechos = lerTrechos(atual?.trechos);
  const iso = agora.toISOString();

  const ligado = ligadoAgora(trechos, agora);
  const salvar = (ativo: boolean) => prisma.$executeRawUnsafe(
    `UPDATE "BalancaAssinatura" SET "ativo" = $2, "trechos" = $3::jsonb, "atualizadoEm" = NOW() WHERE "franchiseeId" = $1`,
    franchiseeId, ativo, JSON.stringify(trechos),
  );

  if (ligar) {
    if (ligado) {
      const marcado = trechos.find((t) => t.ate && new Date(t.ate).getTime() > agora.getTime() && new Date(t.de).getTime() <= agora.getTime());
      if (marcado) { marcado.ate = null; await salvar(true); }
      return estadoDaBalanca(franchiseeId, agora);
    }
    if (!aceite || aceite.versao !== VERSAO_DO_TERMO_DA_BALANCA) {
      throw new TermoNaoAceitoError("Para ativar a balança é preciso aceitar o termo de contratação.");
    }
    trechos.push({ de: iso, ate: null, valor: PRECO_DA_BALANCA, aceite: { ...aceite, em: iso } });
    // Só a primeira ativação ganha os dias grátis; depois o `testeAte` fica como está.
    const testeAte = atual?.testeAte ?? new Date(agora.getTime() + DIAS_DE_TESTE_DA_BALANCA * DIA_MS);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "BalancaAssinatura" ("franchiseeId", "ativo", "testeAte", "trechos", "atualizadoEm")
       VALUES ($1, true, $2, $3::jsonb, NOW())
       ON CONFLICT ("franchiseeId") DO UPDATE SET "ativo" = true, "testeAte" = $2, "trechos" = $3::jsonb, "atualizadoEm" = NOW()`,
      franchiseeId, testeAte, JSON.stringify(trechos),
    );
  } else {
    if (!ligado) return estadoDaBalanca(franchiseeId, agora);
    const { monthEnd } = await mesCorrente(franchiseeId);
    const { naHora, ate } = quandoDesliga(atual?.testeAte, monthEnd, agora);
    for (const t of trechos) if (!t.ate || new Date(t.ate).getTime() > agora.getTime()) t.ate = ate.toISOString();
    await salvar(!naHora);
  }
  return estadoDaBalanca(franchiseeId, agora);
}

/** A linha do boleto do mês (0 = nada a cobrar). Nunca lança: sem tabela, sem cobrança. */
export async function cobrancaDaBalancaNoMes(franchiseeId: string, inicio: Date, fim: Date): Promise<number> {
  try {
    if (!(await garantirEstruturaDaBalanca())) return 0;
    if (await balancaIsenta(franchiseeId)) return 0;
    const a = await lerLinha(franchiseeId);
    if (!a) return 0;
    return valorDaBalancaNoMes(lerTrechos(a.trechos), a.testeAte, inicio, fim);
  } catch (err: any) {
    console.error("[Balança] Erro ao calcular a cobrança do mês:", err?.message);
    return 0;
  }
}
