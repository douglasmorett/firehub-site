/**
 * A ASSINATURA DA COTAÇÃO AUTOMÁTICA — R$ 97 por mês, numa linha própria do
 * boleto da mensalidade.
 *
 * Douglas, 07/11/2026: módulo novo e pago, à parte da mensalidade. A regra é a
 * dos módulos pagos (a da Balança, lib/balanca/assinatura.ts, e a do
 * Multimarcas), escrita no termo (./termo.ts):
 * - a PRIMEIRA ativação ganha 7 dias grátis; desligar e religar não dá outro;
 * - depois do teste, ativo em algum momento do mês = o mês inteiro, uma vez só;
 * - desligou depois do teste: liberado até a virada, o mês seguinte não é cobrado.
 * O valor fica gravado em cada trecho: um reajuste não muda o combinado.
 *
 * A mesma linha guarda a configuração da loja: a agenda da cotação e o
 * comprador que recebe o resumo da rodada.
 *
 * Tabela própria criada no boot (./estrutura-no-banco.ts): se faltar, só a cotação para.
 */
import { prisma } from "@/lib/prisma";
import { desligamentoMarcado, ligadoAgora, quandoDesliga } from "@/lib/modulo-pago";
import { VERSAO_DO_TERMO_DA_COTACAO } from "./termo";
import { DIAS_DE_TESTE_DA_COTACAO, PRECO_DA_COTACAO } from "./preco";
import { garantirEstruturaDaCotacao } from "./estrutura-no-banco";
import { normalizarAgenda, type HorarioDaCotacao } from "./agenda";

export { DIAS_DE_TESTE_DA_COTACAO, PRECO_DA_COTACAO };
const DIA_MS = 24 * 60 * 60 * 1000;

export type AceiteDoTermo = { versao: string; em: string; email: string | null; ip: string | null; userAgent: string | null };
/** Um trecho ligado. `ate` nulo = ligado agora. */
export type TrechoDaCotacao = { de: string; ate: string | null; valor: number; aceite?: AceiteDoTermo };

export type EstadoDaCotacao = {
  ativo: boolean;
  cobradoEsteMes: boolean;
  testeAte: string | null;
  emTeste: boolean;
  jaTestou: boolean;
  isento: boolean;
  preco: number;
  desligaEm: string | null;
  fimDoMes: string | null;
  trechos: TrechoDaCotacao[];
};

export type ConfigDaCotacao = {
  agenda: HorarioDaCotacao[];
  horasParaResumo: number;
  compradorTelefone: string | null;
  compradorNome: string | null;
};

type Linha = {
  ativo: boolean; testeAte: Date | null; trechos: unknown; agenda: unknown;
  horasParaResumo: number | null; compradorTelefone: string | null; compradorNome: string | null;
};

async function lerLinha(franchiseeId: string): Promise<Linha | null> {
  const linhas = await prisma.$queryRawUnsafe<Linha[]>(
    `SELECT "ativo", "testeAte", "trechos", "agenda", "horasParaResumo", "compradorTelefone", "compradorNome"
       FROM "CotacaoAssinatura" WHERE "franchiseeId" = $1`,
    franchiseeId,
  );
  return linhas[0] ?? null;
}

const lerJson = (bruto: unknown): unknown =>
  typeof bruto === "string" ? (() => { try { return JSON.parse(bruto); } catch { return null; } })() : bruto;

export function lerTrechosDaCotacao(bruto: unknown): TrechoDaCotacao[] {
  const lista = lerJson(bruto);
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((t: any) => t && typeof t.de === "string")
    .map((t: any) => ({ ...t, ate: typeof t.ate === "string" ? t.ate : null, valor: Number(t.valor) || PRECO_DA_COTACAO }));
}

/**
 * Quanto o módulo custa no mês [inicio, fim). Puro, para o teste.
 * Ativo em qualquer instante do mês depois dos dias grátis = o mês inteiro;
 * dois trechos com valores diferentes no mesmo mês: vale o maior, uma vez só.
 */
export function valorDaCotacaoNoMes(
  trechos: TrechoDaCotacao[],
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
export async function cotacaoIsenta(franchiseeId: string): Promise<boolean> {
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

export async function estadoDaCotacao(franchiseeId: string, agora: Date = new Date()): Promise<EstadoDaCotacao> {
  const isento = await cotacaoIsenta(franchiseeId);
  let fimDoMes: string | null = null;
  try { fimDoMes = (await mesCorrente(franchiseeId)).monthEnd.toISOString(); } catch {}
  const vazio: EstadoDaCotacao = { ativo: isento, cobradoEsteMes: false, testeAte: null, emTeste: false, jaTestou: false, isento, preco: PRECO_DA_COTACAO, desligaEm: null, fimDoMes, trechos: [] };
  if (!(await garantirEstruturaDaCotacao())) return vazio;
  const a = await lerLinha(franchiseeId);
  if (!a) return vazio;
  const trechos = lerTrechosDaCotacao(a.trechos);
  const ligado = ligadoAgora(trechos, agora);
  let cobradoEsteMes = false;
  try {
    const { monthStart, monthEnd } = await mesCorrente(franchiseeId);
    cobradoEsteMes = !isento && valorDaCotacaoNoMes(trechos, a.testeAte, monthStart, monthEnd, agora) > 0;
  } catch {}
  const aberto = trechos.find((t) => !t.ate || new Date(t.ate).getTime() > agora.getTime());
  return {
    ativo: ligado || isento,
    cobradoEsteMes,
    testeAte: a.testeAte ? new Date(a.testeAte).toISOString() : null,
    emTeste: Boolean(!isento && ligado && a.testeAte && new Date(a.testeAte).getTime() > agora.getTime()),
    jaTestou: Boolean(a.testeAte),
    isento,
    preco: ligado && aberto ? aberto.valor : PRECO_DA_COTACAO,
    desligaEm: isento ? null : desligamentoMarcado(trechos, agora),
    fimDoMes,
    trechos,
  };
}

/** Para o webhook, o cron e as rotas: ligado (ou loja isenta). Nunca lança. */
export async function cotacaoEstaLigada(franchiseeId: string): Promise<boolean> {
  try {
    if (await garantirEstruturaDaCotacao()) {
      const a = await lerLinha(franchiseeId);
      if (a && ligadoAgora(lerTrechosDaCotacao(a.trechos))) return true;
    }
    return await cotacaoIsenta(franchiseeId);
  } catch {
    return false;
  }
}

export async function configDaCotacao(franchiseeId: string): Promise<ConfigDaCotacao> {
  const vazia: ConfigDaCotacao = { agenda: [], horasParaResumo: 4, compradorTelefone: null, compradorNome: null };
  try {
    if (!(await garantirEstruturaDaCotacao())) return vazia;
    const a = await lerLinha(franchiseeId);
    if (!a) return vazia;
    return {
      agenda: normalizarAgenda(lerJson(a.agenda)),
      horasParaResumo: Number.isFinite(Number(a.horasParaResumo)) ? Number(a.horasParaResumo) : 4,
      compradorTelefone: a.compradorTelefone || null,
      compradorNome: a.compradorNome || null,
    };
  } catch {
    return vazia;
  }
}

/** Grava a agenda e o comprador (quem chama já validou). Não liga nem desliga o módulo. */
export async function salvarConfigDaCotacao(franchiseeId: string, c: ConfigDaCotacao): Promise<void> {
  if (!(await garantirEstruturaDaCotacao())) throw new Error("A cotação ainda não está disponível. Tente de novo em alguns minutos.");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CotacaoAssinatura" ("franchiseeId", "agenda", "horasParaResumo", "compradorTelefone", "compradorNome", "atualizadoEm")
     VALUES ($1, $2::jsonb, $3, $4, $5, NOW())
     ON CONFLICT ("franchiseeId") DO UPDATE SET "agenda" = $2::jsonb, "horasParaResumo" = $3,
       "compradorTelefone" = $4, "compradorNome" = $5, "atualizadoEm" = NOW()`,
    franchiseeId, JSON.stringify(c.agenda), c.horasParaResumo, c.compradorTelefone, c.compradorNome,
  );
}

export class TermoNaoAceitoError extends Error {}

/**
 * Liga (abre um trecho, com o aceite do termo) ou desliga.
 * Desligar: no teste grátis, na hora; depois dele, marca o fim do trecho para a
 * virada do mês (lib/modulo-pago.ts). Ligar com o desligamento marcado só
 * desmarca (continua o mesmo trecho, sem novo termo).
 */
export async function ligarOuDesligarCotacao(
  franchiseeId: string,
  ligar: boolean,
  aceite: Omit<AceiteDoTermo, "em"> | null,
  agora: Date = new Date(),
): Promise<EstadoDaCotacao> {
  if (await cotacaoIsenta(franchiseeId)) return estadoDaCotacao(franchiseeId, agora);
  if (!(await garantirEstruturaDaCotacao())) throw new Error("A cotação ainda não está disponível. Tente de novo em alguns minutos.");
  const atual = await lerLinha(franchiseeId);
  const trechos = lerTrechosDaCotacao(atual?.trechos);
  const iso = agora.toISOString();

  const ligado = ligadoAgora(trechos, agora);
  const salvar = (ativo: boolean) => prisma.$executeRawUnsafe(
    `UPDATE "CotacaoAssinatura" SET "ativo" = $2, "trechos" = $3::jsonb, "atualizadoEm" = NOW() WHERE "franchiseeId" = $1`,
    franchiseeId, ativo, JSON.stringify(trechos),
  );

  if (ligar) {
    if (ligado) {
      const marcado = trechos.find((t) => t.ate && new Date(t.ate).getTime() > agora.getTime() && new Date(t.de).getTime() <= agora.getTime());
      if (marcado) { marcado.ate = null; await salvar(true); }
      return estadoDaCotacao(franchiseeId, agora);
    }
    if (!aceite || aceite.versao !== VERSAO_DO_TERMO_DA_COTACAO) {
      throw new TermoNaoAceitoError("Para ativar a cotação automática é preciso aceitar o termo de contratação.");
    }
    trechos.push({ de: iso, ate: null, valor: PRECO_DA_COTACAO, aceite: { ...aceite, em: iso } });
    // Só a primeira ativação ganha os dias grátis; depois o `testeAte` fica como está.
    const testeAte = atual?.testeAte ?? new Date(agora.getTime() + DIAS_DE_TESTE_DA_COTACAO * DIA_MS);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CotacaoAssinatura" ("franchiseeId", "ativo", "testeAte", "trechos", "atualizadoEm")
       VALUES ($1, true, $2, $3::jsonb, NOW())
       ON CONFLICT ("franchiseeId") DO UPDATE SET "ativo" = true, "testeAte" = $2, "trechos" = $3::jsonb, "atualizadoEm" = NOW()`,
      franchiseeId, testeAte, JSON.stringify(trechos),
    );
  } else {
    if (!ligado) return estadoDaCotacao(franchiseeId, agora);
    const { monthEnd } = await mesCorrente(franchiseeId);
    const { naHora, ate } = quandoDesliga(atual?.testeAte, monthEnd, agora);
    for (const t of trechos) if (!t.ate || new Date(t.ate).getTime() > agora.getTime()) t.ate = ate.toISOString();
    await salvar(!naHora);
  }
  return estadoDaCotacao(franchiseeId, agora);
}

/** A linha do boleto do mês (0 = nada a cobrar). Nunca lança: sem tabela, sem cobrança. */
export async function cobrancaDaCotacaoNoMes(franchiseeId: string, inicio: Date, fim: Date): Promise<number> {
  try {
    if (!(await garantirEstruturaDaCotacao())) return 0;
    if (await cotacaoIsenta(franchiseeId)) return 0;
    const a = await lerLinha(franchiseeId);
    if (!a) return 0;
    return valorDaCotacaoNoMes(lerTrechosDaCotacao(a.trechos), a.testeAte, inicio, fim);
  } catch (err: any) {
    console.error("[Cotação] Erro ao calcular a cobrança do mês:", err?.message);
    return 0;
  }
}
