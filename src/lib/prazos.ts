/**
 * FireHub Prazos — o que a extensão vendida e as rotas /api/prazos/* dividem.
 *
 * ── A regra da casa: o cálculo mora AQUI, e só aqui ────────────────────────
 * A extensão interna (firehub-ifood-extension) repete a tabela dentro do
 * background.js — copiar a pasta dá o produto de graça. A vendida não sabe
 * calcular: manda "tenho N pedidos" e recebe "ponha M minutos". Sem conta
 * ativa no servidor, ela é um popup sem função.
 *
 * ── A tabela ───────────────────────────────────────────────────────────────
 * Para M motoboys (regra de 1 pedido por motoboy a cada 10 minutos, medida na
 * Hakim): até 1·M pedidos → 28 min; até 2·M → 38; até 3·M → 58; até 4·M → 78;
 * acima → 78 e PAUSAR a loja (estouro). O modo manual troca a tabela por
 * faixas do próprio lojista ("até 6 pedidos → 45 min").
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
export type ConfigPrazos = {
  modo?: ModoPrazo;
  regrasManuais?: RegraManual[];
  receitas?: Record<string, ReceitaDoPainel>;
};

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

export function lerConfig(raw: unknown): ConfigPrazos {
  const c = (raw && typeof raw === "object" ? raw : {}) as any;
  return {
    modo: c.modo === "manual" ? "manual" : "auto",
    regrasManuais: sanearRegras(c.regrasManuais),
    receitas: sanearReceitas(c.receitas),
  };
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
  nomeLoja: string; status: string; motoboys: number; config: unknown; email: string;
}) {
  return {
    nomeLoja: conta.nomeLoja,
    email: conta.email,
    status: conta.status,
    podeUsar: contaPodeUsar(conta.status),
    motivoBloqueio: contaPodeUsar(conta.status) ? null : motivoDoBloqueio(conta.status),
    motoboys: conta.motoboys,
    config: lerConfig(conta.config),
  };
}
