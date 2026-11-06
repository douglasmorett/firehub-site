/**
 * A ASSINATURA DA ROTA 100% AUTOMATIZADA — R$ 97 por mês, numa linha própria
 * do boleto da mensalidade (Fase 4 do plano, vault "FireHub - Plano despacho
 * automático", §8).
 *
 * Douglas, 05/11/2026: a rota automática deixa de ser de uma lista fixa de
 * lojas e vira módulo pago para TODAS: R$ 97/mês, 7 dias grátis na primeira
 * ativação, pela MESMA mecânica dos outros módulos pagos. O desenho é o do
 * Multimarcas (lib/multimarcas/assinatura.ts), com a regra comum de
 * lib/modulo-pago.ts, escrita no termo (./termo.ts):
 * - a PRIMEIRA ativação ganha 7 dias grátis; desligar e religar não dá outro;
 * - desligar no teste: para na hora, R$ 0 (o teste não volta);
 * - desligar depois do teste: continua até a virada do mês e o mês entra
 *   inteiro no boleto, sem proporcional;
 * - ligar sem teste disponível: o mês entra inteiro.
 * O valor fica gravado em cada trecho: um reajuste não muda o combinado.
 *
 * "LIGADA" DE VERDADE = a regra da loja ligada (`deliveryConfig.
 * roteirizacaoAutomatica.ativo`) E (loja isenta OU trecho ligado agora). Os
 * trechos decidem sozinhos: o desligamento marcado para a virada do mês vale
 * sem outro cron. O cron de 20 s lê tudo numa consulta só, para todas as lojas
 * (`lojasComARotaAutomaticaLigada`); o empurrão, o carimbo de chegada e o
 * "rodar agora" leem a loja numa consulta só (`rotaAutomaticaDaLoja`).
 *
 * Isenta (não paga, sempre liberada): o mesmo critério do Multimarcas e da
 * mensalidade (`lojaIsenta` de lib/billing.ts: conta da casa, planPercent 0,
 * franqueado Hakim) mais a Hakim Centro e a loja de demonstração, pelo id.
 *
 * Tabela própria criada no primeiro uso (como o Multimarcas): se faltar, só a
 * cobrança para — e a rota automática roda só nas isentas.
 */
import { prisma } from "@/lib/prisma";
import { desligamentoMarcado, ligadoAgora, quandoDesliga } from "@/lib/modulo-pago";
import { lerRoteirizacaoAutomatica } from "./config";
import { VERSAO_DO_TERMO_DA_ROTA_AUTOMATICA } from "./termo";

export const PRECO_DA_ROTA_AUTOMATICA = 97;
export const DIAS_DE_TESTE_DA_ROTA_AUTOMATICA = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

export type AceiteDoTermo = { versao: string; em: string; email: string | null; ip: string | null; userAgent: string | null };
/** Um trecho ligado. `ate` nulo = ligado agora. Sem `aceite`: o teste que começou sozinho (ver abaixo). */
export type TrechoDaRotaAutomatica = { de: string; ate: string | null; valor: number; aceite?: AceiteDoTermo };

export type EstadoDaRotaAutomatica = {
  /** Pela assinatura: trecho ligado agora, ou loja isenta. (A regra da loja é outra chave.) */
  ativo: boolean;
  /** O mês corrente já entra no boleto. */
  cobradoEsteMes: boolean;
  testeAte: string | null;
  emTeste: boolean;
  jaTestou: boolean;
  isento: boolean;
  /** Ligada por um trecho SEM o aceite do termo: desliga no fim do teste, a não ser que aceite. */
  semAceite: boolean;
  /** Quanto esta loja paga por mês: o do trecho ligado; desligada, o de quem ativar hoje. */
  preco: number;
  /** Desligamento marcado para a virada do mês (o mês já está pago): quando desliga sozinha. */
  desligaEm: string | null;
  /** O início do mês seguinte (fuso da loja): quando desligaria se desligar agora, fora do teste. */
  fimDoMes: string | null;
  trechos: TrechoDaRotaAutomatica[];
};

const INSTRUCOES = [
  `CREATE TABLE IF NOT EXISTS "RotaAutomaticaAssinatura" (
     "franchiseeId" TEXT NOT NULL,
     "ativo" BOOLEAN NOT NULL DEFAULT false,
     "testeAte" TIMESTAMP(3),
     "trechos" JSONB NOT NULL DEFAULT '[]',
     "atualizadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "RotaAutomaticaAssinatura_pkey" PRIMARY KEY ("franchiseeId")
   )`,
];

let pronto = false;
export async function garantirEstruturaDaRotaAutomatica(): Promise<boolean> {
  if (pronto) return true;
  try {
    for (const sql of INSTRUCOES) await prisma.$executeRawUnsafe(sql);
    pronto = true;
  } catch (err: any) {
    console.error("[Rota automática] Estrutura da assinatura falhou:", err?.message);
  }
  return pronto;
}

type Linha = { ativo: boolean; testeAte: Date | null; trechos: unknown };

async function lerLinha(lojaId: string): Promise<Linha | null> {
  const linhas = await prisma.$queryRawUnsafe<Linha[]>(
    `SELECT "ativo", "testeAte", "trechos" FROM "RotaAutomaticaAssinatura" WHERE "franchiseeId" = $1`,
    lojaId,
  );
  return linhas[0] ?? null;
}

export function lerTrechos(bruto: unknown): TrechoDaRotaAutomatica[] {
  const lista = typeof bruto === "string" ? (() => { try { return JSON.parse(bruto); } catch { return []; } })() : bruto;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((t: any) => t && typeof t.de === "string")
    .map((t: any) => ({ ...t, ate: typeof t.ate === "string" ? t.ate : null, valor: Number(t.valor) || PRECO_DA_ROTA_AUTOMATICA }));
}

/**
 * Quanto a rota automática custa no mês [inicio, fim). Puro, para o teste.
 * Ativa em qualquer instante do mês depois dos dias grátis = o mês inteiro;
 * dois trechos com valores diferentes no mesmo mês: vale o maior, uma vez só.
 */
export function valorDaRotaAutomaticaNoMes(
  trechos: TrechoDaRotaAutomatica[],
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

// ── Isenção ─────────────────────────────────────────────────────────────────

/**
 * Hakim Centro (contatohakim@gmail.com — já isenta pelo e-mail, fica aqui por
 * garantia) e a loja de demonstração do Victor (ensaio com o simulador).
 */
const LOJAS_ISENTAS_DA_ROTA_AUTOMATICA = new Set<string>([
  "cmpx96phr0000ujf0sb0qk5vr",
  "cmupkiesh0000ujmcjwtpd706",
]);

export type DadosDaIsencao = { email?: string | null; planPercent?: number | null; isFranqueadoHakim?: boolean | null } | null;

/** Puro: a lista daqui OU a regra da mensalidade (já calculada por quem chama). */
export function rotaAutomaticaIsentaPor(lojaId: string, isentaPelaMensalidade: boolean): boolean {
  return LOJAS_ISENTAS_DA_ROTA_AUTOMATICA.has(lojaId) || isentaPelaMensalidade;
}

async function isentaPelaMensalidade(loja: DadosDaIsencao): Promise<boolean> {
  try {
    // Dinâmico: billing.ts importa este arquivo (também dinâmico) no fechamento.
    const { lojaIsenta } = await import("@/lib/billing");
    return lojaIsenta(loja as any);
  } catch {
    return false;
  }
}

/** A loja não paga: mesma regra (e mesmos campos) da mensalidade e do Multimarcas, ou a lista daqui. */
export async function rotaAutomaticaIsenta(lojaId: string): Promise<boolean> {
  if (LOJAS_ISENTAS_DA_ROTA_AUTOMATICA.has(lojaId)) return true;
  try {
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { email: true, planPercent: true, isFranqueadoHakim: true } });
    return await isentaPelaMensalidade(loja);
  } catch {
    return false;
  }
}

// ── Quem já estava ligada antes do módulo pago (SUPOSIÇÃO — troque aqui) ────
//
// A Pizzaria Bom Cheff foi liberada em 05/11/2026 sem cobrança, pela lista
// fixa antiga. Suposição de quem pediu a Fase 4 (não é decisão do Douglas):
// se ela estiver com a regra ligada e sem nenhum trecho, o teste de 7 dias
// começa na primeira leitura depois do deploy (cron, tela ou empurrão), num
// trecho SEM aceite que termina no fim do teste. A tela mostra "grátis até X"
// e pede o termo; aceitando, o trecho segue ligado e cobra depois do teste;
// sem aceite, desliga no fim do teste e, para religar, aceita o termo (e o mês
// entra inteiro, porque o teste já foi usado).
//
// Para trocar: esvaziar a lista (a loja fica desligada até ligar aceitando o
// termo, com os 7 dias) ou mudar `comecarTesteSemAceite`.
const LOJAS_LIGADAS_ANTES_DO_MODULO_PAGO = new Set<string>([
  "cmvvl39a004wns807o0ck8uk3",
]);

/** Puro: esta leitura começa o teste sem aceite? (regra ligada, sem linha, não isenta, na lista acima) */
export function comecaOTesteSemAceite(lojaId: string, configAtivo: boolean, temLinha: boolean, isento: boolean): boolean {
  return configAtivo && !temLinha && !isento && LOJAS_LIGADAS_ANTES_DO_MODULO_PAGO.has(lojaId);
}

/** O trecho do teste, sem aceite, de agora até o fim dos 7 dias. Puro, para o teste. */
export function trechoDoTesteSemAceite(agora: Date): { testeAte: Date; trecho: TrechoDaRotaAutomatica } {
  const testeAte = new Date(agora.getTime() + DIAS_DE_TESTE_DA_ROTA_AUTOMATICA * DIA_MS);
  return { testeAte, trecho: { de: agora.toISOString(), ate: testeAte.toISOString(), valor: PRECO_DA_ROTA_AUTOMATICA } };
}

async function comecarTesteSemAceite(lojaId: string, agora: Date): Promise<boolean> {
  try {
    const { testeAte, trecho } = trechoDoTesteSemAceite(agora);
    // DO NOTHING: duas leituras juntas (cron e tela) não abrem dois testes.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "RotaAutomaticaAssinatura" ("franchiseeId", "ativo", "testeAte", "trechos", "atualizadoEm")
       VALUES ($1, true, ($2::timestamptz AT TIME ZONE 'UTC'), $3::jsonb, NOW())
       ON CONFLICT ("franchiseeId") DO NOTHING`,
      lojaId, testeAte.toISOString(), JSON.stringify([trecho]),
    );
    console.log(`[Rota automática] loja ${lojaId}: teste de ${DIAS_DE_TESTE_DA_ROTA_AUTOMATICA} dias começou sem aceite (ligada antes do módulo pago).`);
    return true;
  } catch (err: any) {
    console.error("[Rota automática] Não consegui começar o teste:", err?.message);
    return false;
  }
}

// ── Ligada de verdade ───────────────────────────────────────────────────────

/** Puro: a regra ligada E (isenta OU trecho ligado agora). */
export function rotaLigadaDeVerdade(configAtivo: boolean, isento: boolean, trechos: TrechoDaRotaAutomatica[], agora: Date = new Date()): boolean {
  return configAtivo && (isento || ligadoAgora(trechos, agora));
}

type LinhaDaLoja = {
  id: string;
  email: string | null;
  planPercent: number | null;
  isFranqueadoHakim: boolean | null;
  testeAte: Date | null;
  trechos: unknown;
  temLinha: boolean;
};

async function decidir(l: LinhaDaLoja, configAtivo: boolean, agora: Date): Promise<{ isento: boolean; ligada: boolean }> {
  const isento = rotaAutomaticaIsentaPor(l.id, configAtivo && !LOJAS_ISENTAS_DA_ROTA_AUTOMATICA.has(l.id) ? await isentaPelaMensalidade(l) : false);
  if (comecaOTesteSemAceite(l.id, configAtivo, l.temLinha, isento) && pronto) {
    return { isento, ligada: await comecarTesteSemAceite(l.id, agora) };
  }
  return { isento, ligada: rotaLigadaDeVerdade(configAtivo, isento, lerTrechos(l.trechos), agora) };
}

/**
 * O cron de 20 s: as lojas com a rota automática ligada DE VERDADE, numa
 * consulta só para todas (a regra no JSON + a assinatura no mesmo SELECT).
 * Custo por ciclo: a mesma consulta de antes, com o LEFT JOIN — nenhuma a mais
 * por loja (só a escrita única do teste sem aceite, uma vez na vida).
 */
export async function lojasComARotaAutomaticaLigada(agora: Date = new Date()): Promise<string[]> {
  const comTabela = await garantirEstruturaDaRotaAutomatica();
  // Pelo JSON, no banco: lojas sem a chave nem chegam ao Node.
  const linhas = comTabela
    ? await prisma.$queryRawUnsafe<LinhaDaLoja[]>(
      `SELECT u."id", u."email", u."planPercent", u."isFranqueadoHakim", a."testeAte", a."trechos", (a."franchiseeId" IS NOT NULL) AS "temLinha"
       FROM "User" u LEFT JOIN "RotaAutomaticaAssinatura" a ON a."franchiseeId" = u."id"
       WHERE u."deliveryConfig"->'roteirizacaoAutomatica'->>'ativo' = 'true'`,
    )
    // Sem a tabela: só as isentas rodam (nenhum trecho para ler).
    : await prisma.$queryRawUnsafe<LinhaDaLoja[]>(
      `SELECT u."id", u."email", u."planPercent", u."isFranqueadoHakim", NULL::timestamp AS "testeAte", NULL::jsonb AS "trechos", false AS "temLinha"
       FROM "User" u
       WHERE u."deliveryConfig"->'roteirizacaoAutomatica'->>'ativo' = 'true'`,
    );
  const ligadas: string[] = [];
  for (const l of linhas) if ((await decidir(l, true, agora)).ligada) ligadas.push(l.id);
  return ligadas;
}

export type RotaAutomaticaDaLoja = {
  deliveryConfig: unknown;
  storeLatLng: unknown;
  /** A regra da loja (`deliveryConfig.roteirizacaoAutomatica.ativo`). */
  configAtivo: boolean;
  isento: boolean;
  /** A regra ligada E (isenta OU trecho ligado agora). */
  ligada: boolean;
};

/**
 * Uma loja, numa consulta só: a regra, o pino e a assinatura. Para o empurrão,
 * o carimbo de chegada e o "rodar agora" — no lugar da leitura do
 * deliveryConfig que eles já faziam. Nunca lança: sem leitura, desligada.
 */
export async function rotaAutomaticaDaLoja(lojaId: string, agora: Date = new Date()): Promise<RotaAutomaticaDaLoja> {
  const desligada: RotaAutomaticaDaLoja = { deliveryConfig: null, storeLatLng: null, configAtivo: false, isento: false, ligada: false };
  try {
    const comTabela = await garantirEstruturaDaRotaAutomatica();
    const linhas = await prisma.$queryRawUnsafe<(LinhaDaLoja & { deliveryConfig: unknown; storeLatLng: unknown })[]>(
      comTabela
        ? `SELECT u."id", u."email", u."planPercent", u."isFranqueadoHakim", u."deliveryConfig", u."storeLatLng",
                  a."testeAte", a."trechos", (a."franchiseeId" IS NOT NULL) AS "temLinha"
           FROM "User" u LEFT JOIN "RotaAutomaticaAssinatura" a ON a."franchiseeId" = u."id"
           WHERE u."id" = $1`
        : `SELECT u."id", u."email", u."planPercent", u."isFranqueadoHakim", u."deliveryConfig", u."storeLatLng",
                  NULL::timestamp AS "testeAte", NULL::jsonb AS "trechos", false AS "temLinha"
           FROM "User" u WHERE u."id" = $1`,
      lojaId,
    );
    const l = linhas[0];
    if (!l) return desligada;
    const configAtivo = lerRoteirizacaoAutomatica(l.deliveryConfig).ativo;
    const { isento, ligada } = await decidir(l, configAtivo, agora);
    return { deliveryConfig: l.deliveryConfig, storeLatLng: l.storeLatLng, configAtivo, isento, ligada };
  } catch (err: any) {
    console.warn("[Rota automática] leitura da loja falhou:", err?.message?.slice(0, 160));
    return desligada;
  }
}

// ── Estado, liga/desliga e cobrança (o desenho do Multimarcas) ─────────────

async function mesCorrente(lojaId: string) {
  // Dinâmico: billing.ts importa este arquivo (também dinâmico) no fechamento.
  const { intervaloDoMes, getCurrentYearMonth } = await import("@/lib/billing");
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeTimezone: true } });
  const tz = loja?.storeTimezone || "America/Sao_Paulo";
  return intervaloDoMes(getCurrentYearMonth(0, tz), tz);
}

const trechoAberto = (trechos: TrechoDaRotaAutomatica[], agora: Date) =>
  trechos.find((t) => new Date(t.de).getTime() <= agora.getTime() && (!t.ate || new Date(t.ate).getTime() > agora.getTime()));

/**
 * O estado da assinatura. `configAtivo` (a regra gravada na loja) só serve
 * para começar o teste de quem já estava ligada antes do módulo pago.
 */
export async function estadoDaRotaAutomatica(lojaId: string, opcoes: { agora?: Date; configAtivo?: boolean } = {}): Promise<EstadoDaRotaAutomatica> {
  const agora = opcoes.agora ?? new Date();
  const isento = await rotaAutomaticaIsenta(lojaId);
  let fimDoMes: string | null = null;
  let mes: { monthStart: Date; monthEnd: Date } | null = null;
  try { mes = await mesCorrente(lojaId); fimDoMes = mes.monthEnd.toISOString(); } catch {}
  const vazio: EstadoDaRotaAutomatica = { ativo: isento, cobradoEsteMes: false, testeAte: null, emTeste: false, jaTestou: false, isento, semAceite: false, preco: PRECO_DA_ROTA_AUTOMATICA, desligaEm: null, fimDoMes, trechos: [] };
  if (!(await garantirEstruturaDaRotaAutomatica())) return vazio;
  let a = await lerLinha(lojaId);
  if (!a && comecaOTesteSemAceite(lojaId, opcoes.configAtivo === true, false, isento)) {
    await comecarTesteSemAceite(lojaId, agora);
    a = await lerLinha(lojaId);
  }
  if (!a) return vazio;
  const trechos = lerTrechos(a.trechos);
  // Ligada pelos trechos: o desligamento marcado para a virada do mês vale sozinho (lib/modulo-pago.ts).
  const ligado = ligadoAgora(trechos, agora);
  const aberto = trechoAberto(trechos, agora);
  const semAceite = !isento && ligado && !!aberto && !aberto.aceite;
  let cobradoEsteMes = false;
  if (mes) cobradoEsteMes = !isento && valorDaRotaAutomaticaNoMes(trechos, a.testeAte, mes.monthStart, mes.monthEnd, agora) > 0;
  return {
    ativo: ligado || isento,
    cobradoEsteMes,
    testeAte: a.testeAte ? new Date(a.testeAte).toISOString() : null,
    emTeste: Boolean(!isento && ligado && a.testeAte && new Date(a.testeAte).getTime() > agora.getTime()),
    jaTestou: Boolean(a.testeAte),
    isento,
    semAceite,
    preco: ligado && aberto ? aberto.valor : PRECO_DA_ROTA_AUTOMATICA,
    // O fim do trecho sem aceite é o fim do teste: a tela mostra "grátis até", não "desliga em".
    desligaEm: isento || semAceite ? null : desligamentoMarcado(trechos, agora),
    fimDoMes,
    trechos,
  };
}

export class TermoNaoAceitoError extends Error {}

/**
 * Liga (abre um trecho, com o aceite do termo) ou desliga — a regra do
 * Multimarcas. Desligar: no teste grátis, na hora; depois dele, marca o fim do
 * trecho para a virada do mês. Ligar com o desligamento marcado só desmarca
 * ("Continuar ligada", sem novo termo) — a não ser que o trecho não tenha
 * aceite (o teste que começou sozinho): aí o aceite entra nele.
 */
export async function ligarOuDesligarRotaAutomatica(
  lojaId: string,
  ligar: boolean,
  aceite: Omit<AceiteDoTermo, "em"> | null,
  agora: Date = new Date(),
): Promise<EstadoDaRotaAutomatica> {
  // Loja isenta: liberada sem cobrança — nada a gravar na assinatura.
  if (await rotaAutomaticaIsenta(lojaId)) return estadoDaRotaAutomatica(lojaId, { agora });
  if (!(await garantirEstruturaDaRotaAutomatica())) throw new Error("A rota automática ainda não está disponível. Tente de novo em alguns minutos.");
  const atual = await lerLinha(lojaId);
  const trechos = lerTrechos(atual?.trechos);
  const iso = agora.toISOString();
  const termoOk = !!aceite && aceite.versao === VERSAO_DO_TERMO_DA_ROTA_AUTOMATICA;
  const semTermo = () => new TermoNaoAceitoError("Para ativar a rota automática é preciso aceitar o termo de contratação.");

  const ligado = ligadoAgora(trechos, agora);
  const salvar = (ativo: boolean) => prisma.$executeRawUnsafe(
    `UPDATE "RotaAutomaticaAssinatura" SET "ativo" = $2, "trechos" = $3::jsonb, "atualizadoEm" = NOW() WHERE "franchiseeId" = $1`,
    lojaId, ativo, JSON.stringify(trechos),
  );

  if (ligar) {
    if (ligado) {
      // Desligamento marcado (virada do mês, ou o fim do teste sem aceite): desmarca.
      const marcado = trechos.find((t) => t.ate && new Date(t.ate).getTime() > agora.getTime() && new Date(t.de).getTime() <= agora.getTime());
      if (marcado) {
        if (!marcado.aceite) {
          if (!termoOk) throw semTermo();
          marcado.aceite = { ...aceite!, em: iso };
        }
        marcado.ate = null;
        await salvar(true);
      }
      return estadoDaRotaAutomatica(lojaId, { agora });
    }
    if (!termoOk) throw semTermo();
    trechos.push({ de: iso, ate: null, valor: PRECO_DA_ROTA_AUTOMATICA, aceite: { ...aceite!, em: iso } });
    // Só a primeira ativação ganha os dias grátis; depois o `testeAte` fica como está.
    const testeAte = atual?.testeAte ?? new Date(agora.getTime() + DIAS_DE_TESTE_DA_ROTA_AUTOMATICA * DIA_MS);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "RotaAutomaticaAssinatura" ("franchiseeId", "ativo", "testeAte", "trechos", "atualizadoEm")
       VALUES ($1, true, ($2::timestamptz AT TIME ZONE 'UTC'), $3::jsonb, NOW())
       ON CONFLICT ("franchiseeId") DO UPDATE SET "ativo" = true, "testeAte" = ($2::timestamptz AT TIME ZONE 'UTC'), "trechos" = $3::jsonb, "atualizadoEm" = NOW()`,
      lojaId, new Date(testeAte).toISOString(), JSON.stringify(trechos),
    );
  } else {
    if (!ligado) return estadoDaRotaAutomatica(lojaId, { agora });
    const { monthEnd } = await mesCorrente(lojaId);
    const { naHora, ate } = quandoDesliga(atual?.testeAte, monthEnd, agora);
    for (const t of trechos) if (!t.ate || new Date(t.ate).getTime() > agora.getTime()) t.ate = ate.toISOString();
    await salvar(!naHora);
  }
  return estadoDaRotaAutomatica(lojaId, { agora });
}

/** A linha do boleto do mês (0 = nada a cobrar). Nunca lança: sem tabela, sem cobrança. */
export async function cobrancaDaRotaAutomaticaNoMes(lojaId: string, inicio: Date, fim: Date): Promise<number> {
  try {
    if (!(await garantirEstruturaDaRotaAutomatica())) return 0;
    if (await rotaAutomaticaIsenta(lojaId)) return 0;
    const a = await lerLinha(lojaId);
    if (!a) return 0;
    return valorDaRotaAutomaticaNoMes(lerTrechos(a.trechos), a.testeAte, inicio, fim);
  } catch (err: any) {
    console.error("[Rota automática] Erro ao calcular a cobrança do mês:", err?.message);
    return 0;
  }
}
