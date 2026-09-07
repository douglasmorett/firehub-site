/**
 * FireHub Prazos — o que a extensão vendida e as rotas /api/prazos/* dividem.
 *
 * ── A regra da casa: o cálculo mora AQUI, e só aqui ────────────────────────
 * A extensão interna (firehub-ifood-extension) repete a tabela dentro do
 * background.js — copiar a pasta dá o produto de graça. A vendida não sabe
 * calcular: manda "tenho N pedidos" e recebe "ponha M minutos no iFood e P
 * minutos de preparo no 99Food, nestas lojas". Sem conta ativa no servidor,
 * ela é um popup sem função.
 *
 * ── A tabela (iFood) ───────────────────────────────────────────────────────
 * Para M motoboys (regra de 1 pedido por motoboy a cada 10 minutos, medida na
 * Hakim): até 1·M pedidos → 28 min; até 2·M → 38; até 3·M → 58; até 4·M → 78;
 * acima → 78 e PAUSAR a loja (estouro). O modo manual troca a tabela por
 * faixas do próprio lojista ("até 6 pedidos → 45 min").
 *
 * ── 99Food é outra conta ───────────────────────────────────────────────────
 * No 99 o prazo que o cliente vê = tempo de PREPARO da loja + prazo de entrega
 * da área (tabela fixa por raio, chata de mexer). A extensão mexe só no tempo
 * de preparo, que é um campo simples; por isso o 99 tem regra própria: "prazo
 * do iFood menos a entrega" (padrão) ou faixas do lojista em minutos de
 * preparo.
 *
 * ── Lojas ──────────────────────────────────────────────────────────────────
 * Um login do Portal do Parceiro ou do 99Food Admin pode ter várias lojas. A
 * extensão só mexe nas que o lojista MARCOU (lojasIfood / lojas99 com
 * `ativa`); a marcação mora aqui para voltar igual em qualquer PC. O plano
 * limita quantas lojas ativas cabem (lojasIncluidas), por plataforma.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lerTokenDePrazos } from "@/lib/prazos-token";

export const CORS_PRAZOS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-prazos-token",
};

export function respostaPrazos(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: CORS_PRAZOS });
}

export type ModoPrazo = "auto" | "manual";
export type RegraManual = { maxPedidos: number; minutos: number };

/** Uma coluna que o lojista marcou no painel dele ("Na cozinha", "Pronto"…). */
export type ColunaMarcada = {
  id: string;
  rotulo: string;
  /** Seletor CSS do contêiner da coluna (primeiro caminho). */
  seletor: string;
  /** Seletor do contador do cabeçalho, relativo ao contêiner (quando existe). */
  badge?: string | null;
  metodo: "badge" | "cards";
};
export type ReceitaDoPainel = { colunas: ColunaMarcada[]; atualizadoEm?: string };

/** Loja do Portal do Parceiro (iFood). `ativa` = a extensão mexe nela. */
export type LojaIfood = { uuid: string; nome: string; id?: number | null; ativa: boolean };
/** Loja do 99Food Admin. Precisa dos três ids para a API interna do 99. */
export type Loja99 = { shopId: string; cityId: string; contractorId: string; nome: string; ativa: boolean; entregaPropria?: boolean | null };

export type ModoPreparo99 = "desconto" | "faixas";
/**
 * Regra do 99Food. `desconto`: preparo = prazo do iFood − desconto (a entrega
 * da área que o 99 soma por cima). `faixas`: minutos de preparo por
 * quantidade de pedidos, à escolha do lojista.
 */
export type Preparo99 = { modo: ModoPreparo99; desconto: number; regras: RegraManual[] };

export type ConfigPrazos = {
  modo: ModoPrazo;
  regrasManuais: RegraManual[];
  receitas: Record<string, ReceitaDoPainel>;
  lojasIfood: LojaIfood[];
  lojas99: Loja99[];
  preparo99: Preparo99;
};

export const DESCONTO_PADRAO_99 = 15;
export const PREPARO_MIN_99 = 5;
export const PREPARO_MAX_99 = 240;
export const MAX_LOJAS_GUARDADAS = 40;
export const COTA_MAXIMA = 50;

export const STATUS_DE_CONTA = ["PILOTO", "ATIVO", "BLOQUEADO", "CANCELADO"] as const;
export type StatusDeConta = (typeof STATUS_DE_CONTA)[number];

/** Só PILOTO e ATIVO usam. É a única porta que a cobrança precisa fechar. */
export function contaPodeUsar(status: string | null | undefined): boolean {
  return status === "PILOTO" || status === "ATIVO";
}

/** O texto que a extensão mostra quando a conta não pode usar. */
export function motivoDoBloqueio(status: string | null | undefined): string {
  if (status === "BLOQUEADO") return "Sua assinatura do FireHub Prazos está sem pagamento. Regularize na Cakto para voltar a usar.";
  if (status === "CANCELADO") return "Assinatura do FireHub Prazos cancelada. Para voltar, assine de novo.";
  return "Conta sem permissão de uso.";
}

export type ResultadoDoPrazo = {
  minutos: number;
  pausar: boolean;
  rotulo: string;
  modo: ModoPrazo;
  limites?: { max28: number; max38: number; max58: number; max78: number };
};

export function calcularPrazo(entrada: {
  pedidos: number;
  motoboys: number;
  modo?: ModoPrazo;
  regrasManuais?: RegraManual[];
}): ResultadoDoPrazo {
  const pedidos = Math.max(0, Math.floor(Number(entrada.pedidos) || 0));
  const motoboys = Math.max(1, Math.floor(Number(entrada.motoboys) || 1));
  const modo: ModoPrazo = entrada.modo === "manual" ? "manual" : "auto";

  if (modo === "manual") {
    const regras = sanearRegras(entrada.regrasManuais);
    if (regras.length > 0) {
      const casou = regras.find((r) => pedidos <= r.maxPedidos);
      if (casou) {
        return { minutos: casou.minutos, pausar: false, rotulo: `Até ${casou.maxPedidos} ped. → ${casou.minutos} min`, modo };
      }
      // Passou de todas as faixas: é estouro pelo desenho do próprio lojista.
      const ultima = regras[regras.length - 1];
      return { minutos: ultima.minutos, pausar: true, rotulo: `Acima de ${ultima.maxPedidos} ped. → pausar a loja`, modo };
    }
    // Sem faixas cadastradas, o manual cai na tabela — nunca fica sem resposta.
  }

  const limites = { max28: motoboys, max38: 2 * motoboys, max58: 3 * motoboys, max78: 4 * motoboys };
  if (pedidos <= limites.max28) return { minutos: 28, pausar: false, rotulo: `Até ${limites.max28} ped. → 28 min`, modo: "auto", limites };
  if (pedidos <= limites.max38) return { minutos: 38, pausar: false, rotulo: `Até ${limites.max38} ped. → 38 min`, modo: "auto", limites };
  if (pedidos <= limites.max58) return { minutos: 58, pausar: false, rotulo: `Até ${limites.max58} ped. → 58 min`, modo: "auto", limites };
  if (pedidos <= limites.max78) return { minutos: 78, pausar: false, rotulo: `Até ${limites.max78} ped. → 78 min`, modo: "auto", limites };
  return { minutos: 78, pausar: true, rotulo: `Estourou (${pedidos} > ${limites.max78} ped.) → 78 min e pausar a loja`, modo: "auto", limites };
}

export type ResultadoDoPreparo99 = { minutos: number; rotulo: string; modo: ModoPreparo99 };

/**
 * Tempo de preparo para o 99Food. Nunca "pausa": o 99 não tem a mesma
 * alavanca — no estouro fica o maior preparo da regra, e a extensão avisa.
 */
export function calcularPreparo99(entrada: { pedidos: number; prazoIfood: ResultadoDoPrazo; preparo99?: Partial<Preparo99> | null }): ResultadoDoPreparo99 {
  const pedidos = Math.max(0, Math.floor(Number(entrada.pedidos) || 0));
  const cfg = sanearPreparo99(entrada.preparo99);
  const limitar = (m: number) => Math.min(PREPARO_MAX_99, Math.max(PREPARO_MIN_99, Math.round(m)));

  if (cfg.modo === "faixas" && cfg.regras.length > 0) {
    const casou = cfg.regras.find((r) => pedidos <= r.maxPedidos);
    if (casou) return { minutos: limitar(casou.minutos), rotulo: `Até ${casou.maxPedidos} ped. → ${casou.minutos} min de preparo`, modo: "faixas" };
    const ultima = cfg.regras[cfg.regras.length - 1];
    return { minutos: limitar(ultima.minutos), rotulo: `Acima de ${ultima.maxPedidos} ped. → ${ultima.minutos} min de preparo (máximo)`, modo: "faixas" };
  }

  const minutos = limitar(entrada.prazoIfood.minutos - cfg.desconto);
  return { minutos, rotulo: `${entrada.prazoIfood.minutos} min do iFood − ${cfg.desconto} min de entrega`, modo: "desconto" };
}

/** Faixas do modo manual: inteiras, positivas, ordenadas, no máximo 12. */
export function sanearRegras(raw: unknown): RegraManual[] {
  if (!Array.isArray(raw)) return [];
  const limpas: RegraManual[] = [];
  for (const r of raw.slice(0, 12)) {
    const maxPedidos = Math.floor(Number((r as any)?.maxPedidos ?? (r as any)?.maxOrders));
    const minutos = Math.floor(Number((r as any)?.minutos ?? (r as any)?.minutes));
    if (!Number.isFinite(maxPedidos) || !Number.isFinite(minutos)) continue;
    if (maxPedidos < 0 || maxPedidos > 999 || minutos < 5 || minutos > 300) continue;
    limpas.push({ maxPedidos, minutos });
  }
  return limpas.sort((a, b) => a.maxPedidos - b.maxPedidos);
}

export function sanearPreparo99(raw: unknown): Preparo99 {
  const c = (raw && typeof raw === "object" ? raw : {}) as any;
  const desconto = Math.floor(Number(c.desconto));
  return {
    modo: c.modo === "faixas" ? "faixas" : "desconto",
    desconto: Number.isFinite(desconto) && desconto >= 0 && desconto <= 120 ? desconto : DESCONTO_PADRAO_99,
    regras: sanearRegras(c.regras),
  };
}

/**
 * Receitas: o que o lojista marcou, por host do painel. Só formato — o
 * conteúdo dos seletores é opaco para o servidor. Limites para a coluna JSON
 * não virar depósito: 10 hosts, 12 colunas por host, textos curtos.
 */
export function sanearReceitas(raw: unknown): Record<string, ReceitaDoPainel> {
  const saida: Record<string, ReceitaDoPainel> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return saida;
  const texto = (v: unknown, max: number) => String(v ?? "").slice(0, max);
  let hosts = 0;
  for (const [host, receita] of Object.entries(raw as Record<string, any>)) {
    if (hosts++ >= 10) break;
    // Host com porta é normal em painel local/self-hosted (e no teste da extensão).
    if (!/^[a-z0-9.-]{3,120}(:\d{2,5})?$/i.test(host)) continue;
    const colunasRaw = Array.isArray(receita?.colunas) ? receita.colunas : [];
    const colunas: ColunaMarcada[] = [];
    for (const c of colunasRaw.slice(0, 12)) {
      const seletor = texto(c?.seletor, 600);
      if (!seletor) continue;
      colunas.push({
        id: texto(c?.id, 40) || `${Date.now()}`,
        rotulo: texto(c?.rotulo, 60) || "Coluna",
        seletor,
        badge: c?.badge ? texto(c.badge, 300) : null,
        metodo: c?.metodo === "badge" ? "badge" : "cards",
      });
    }
    saida[host] = { colunas, atualizadoEm: texto(receita?.atualizadoEm, 40) || new Date().toISOString() };
  }
  return saida;
}

const textoCurto = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Lojas do iFood: uuid válido, nome curto, sem repetição, no máximo 40. */
export function sanearLojasIfood(raw: unknown): LojaIfood[] {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set<string>();
  const saida: LojaIfood[] = [];
  for (const l of raw.slice(0, MAX_LOJAS_GUARDADAS * 2)) {
    const uuid = textoCurto((l as any)?.uuid, 40).toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid) || vistos.has(uuid)) continue;
    vistos.add(uuid);
    const id = Number((l as any)?.id);
    saida.push({ uuid, nome: textoCurto((l as any)?.nome, 80) || "Loja", id: Number.isFinite(id) ? id : null, ativa: (l as any)?.ativa === true });
    if (saida.length >= MAX_LOJAS_GUARDADAS) break;
  }
  return saida;
}

/** Lojas do 99Food: ids numéricos (como o 99 manda, em texto), no máximo 40. */
export function sanearLojas99(raw: unknown): Loja99[] {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set<string>();
  const saida: Loja99[] = [];
  for (const l of raw.slice(0, MAX_LOJAS_GUARDADAS * 2)) {
    const shopId = textoCurto((l as any)?.shopId, 30);
    const cityId = textoCurto((l as any)?.cityId, 20);
    const contractorId = textoCurto((l as any)?.contractorId, 30);
    if (!/^\d{3,30}$/.test(shopId) || !/^\d{1,20}$/.test(cityId) || !/^\d{3,30}$/.test(contractorId) || vistos.has(shopId)) continue;
    vistos.add(shopId);
    const ep = (l as any)?.entregaPropria;
    saida.push({ shopId, cityId, contractorId, nome: textoCurto((l as any)?.nome, 80) || "Loja", ativa: (l as any)?.ativa === true, entregaPropria: typeof ep === "boolean" ? ep : null });
    if (saida.length >= MAX_LOJAS_GUARDADAS) break;
  }
  return saida;
}

export function lerConfig(raw: unknown): ConfigPrazos {
  const c = (raw && typeof raw === "object" ? raw : {}) as any;
  return {
    modo: c.modo === "manual" ? "manual" : "auto",
    regrasManuais: sanearRegras(c.regrasManuais),
    receitas: sanearReceitas(c.receitas),
    lojasIfood: sanearLojasIfood(c.lojasIfood),
    lojas99: sanearLojas99(c.lojas99),
    preparo99: sanearPreparo99(c.preparo99),
  };
}

/** Quantas lojas ativas cabem no plano — por plataforma (1 loja = 1 iFood + 1 99Food). */
export function cotaDeLojas(conta: { lojasIncluidas?: number | null }): number {
  const n = Math.floor(Number(conta.lojasIncluidas));
  return Number.isFinite(n) && n >= 1 ? Math.min(COTA_MAXIMA, n) : 1;
}

/** Mensagem quando a marcação passa do plano; null quando cabe. */
export function excessoDeCota(config: ConfigPrazos, cota: number): string | null {
  const ifood = config.lojasIfood.filter((l) => l.ativa).length;
  const n99 = config.lojas99.filter((l) => l.ativa).length;
  if (ifood <= cota && n99 <= cota) return null;
  const onde = ifood > cota ? `${ifood} lojas do iFood` : `${n99} lojas do 99Food`;
  return `Seu plano inclui ${cota} loja${cota > 1 ? "s" : ""} por plataforma e você marcou ${onde}. Desmarque alguma ou contrate lojas adicionais.`;
}

/** A conta por trás do token (query `token` ou header `x-prazos-token`). */
export async function resolverConta(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") || req.headers.get("x-prazos-token");
  const leitura = lerTokenDePrazos(token);
  if (!leitura.valido) return null;
  return prisma.prazoConta.findUnique({ where: { id: leitura.contaId } });
}

/** O que o popup precisa saber da conta — sem hash, sem nada além do necessário. */
export function contaParaExtensao(conta: {
  nomeLoja: string; status: string; motoboys: number; config: unknown; email: string; lojasIncluidas?: number | null;
}) {
  const config = lerConfig(conta.config);
  return {
    nomeLoja: conta.nomeLoja,
    email: conta.email,
    status: conta.status,
    podeUsar: contaPodeUsar(conta.status),
    motivoBloqueio: contaPodeUsar(conta.status) ? null : motivoDoBloqueio(conta.status),
    motoboys: conta.motoboys,
    lojasIncluidas: cotaDeLojas(conta),
    config,
  };
}
