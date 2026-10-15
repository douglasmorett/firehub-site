/**
 * /src/lib/ajustes-do-acerto-regras.ts
 *
 * Os AJUSTES que a loja faz à mão no acerto do motoboy — a conta, sem banco,
 * para rodar no servidor, na tela e no teste (scripts/teste-ajustes-do-acerto.ts).
 * Quem grava e lê é lib/ajustes-do-acerto.ts; quem soma é
 * lib/relatorio-do-entregador.ts, a MESMA conta da tela Motoboys, do app do
 * entregador e do relatório Acerto de entregadores.
 *
 * ── Diária do dia ───────────────────────────────────────────────────────────
 * Todo dia trabalhado entra com a diária do cadastro, como sempre. A loja pode
 * mudar a diária de UM dia de UM motoboy (meio turno, folga paga pela metade,
 * dia de chuva com diária maior...) sem mexer no cadastro — pedido do Douglas
 * para a Delícia de Casa (15/10/2026). O "dia" é o EXPEDIENTE, que vira às 5h no
 * fuso da loja: o mesmo dia que conta a diária (lib/resumo-do-entregador.ts,
 * `diaDoExpediente`). Dia ajustado sem entrega no período não entra: a diária
 * só existe no dia trabalhado, e o ajuste fica guardado para quando houver.
 *
 * ── Pendência ───────────────────────────────────────────────────────────────
 * "Faltou R$ 50,00 no dinheiro dele" — a loja lança valor, motivo e a data, e o
 * valor sai do que ela paga ao motoboy no relatório que incluir essa data. É o
 * mesmo caminho do lanche acima do combinado (lib/lanche-da-equipe.ts): tirado
 * de `totalWithDaily` e de `totalFeeOnly`, com o motivo à vista em toda tela —
 * diferente do fiado, que aparece mas não desconta (a baixa é na tela Fiado).
 *
 * ── Cartão e voucher num quadrado só ────────────────────────────────────────
 * A Delícia de Casa confere a maquininha como UM valor: débito, crédito e
 * voucher saem do mesmo aparelho. Opção da LOJA, desligada por padrão, em
 * `User.deliveryConfig.acertoDoMotoboy.juntarCartaoEVale` — só muda os
 * quadrados da conferência e a lista de entregas do quadrado; a conta é a mesma.
 */
import type { ChaveDaForma } from "@/lib/relatorios/formas-de-pagamento";

const centavos = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/** "2026-10-15" — o formato do dia do expediente. */
export const ehDia = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

/**
 * "50", "50,00", "R$ 1.250,90", 50 → número em reais (2 casas). Negativo, vazio
 * ou texto que não é número → null. O lojista digita com vírgula.
 */
export function lerValorEmReais(bruto: unknown): number | null {
  if (typeof bruto === "number") return Number.isFinite(bruto) && bruto >= 0 ? centavos(bruto) : null;
  if (typeof bruto !== "string") return null;
  let t = bruto.replace(/R\$|\s/gi, "");
  if (!t) return null;
  // Com vírgula, o ponto é milhar ("1.250,90"); sem vírgula, o ponto é decimal ("50.5").
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? centavos(n) : null;
}

// ── Diária do dia ─────────────────────────────────────────────────────────

/** O que está gravado para um dia ajustado. */
export type AjusteDaDiaria = { valor: number; criadoPor?: string | null; em?: string | null };

/** A diária de um dia trabalhado, como as telas mostram. */
export type DiariaDoDia = {
  dia: string;
  /** O que vale no acerto. */
  valor: number;
  /** A diária do cadastro (a que valeria sem ajuste). */
  padrao: number;
  ajustada: boolean;
  ajustadaPor?: string | null;
};

/**
 * A diária de cada dia trabalhado: o ajuste do dia, quando existe; senão a do
 * cadastro. `dias` são os expedientes com corrida (resumoDasEntregas).
 */
export function diariasDoPeriodo(dias: string[], padrao: number, ajustes?: Map<string, AjusteDaDiaria> | null): DiariaDoDia[] {
  const base = centavos(padrao);
  return [...new Set(dias)].sort().map((dia) => {
    const a = ajustes?.get(dia);
    if (!a) return { dia, valor: base, padrao: base, ajustada: false };
    return { dia, valor: centavos(a.valor), padrao: base, ajustada: true, ajustadaPor: a.criadoPor ?? null };
  });
}

export const somaDasDiarias = (diarias: Pick<DiariaDoDia, "valor">[]) => centavos(diarias.reduce((t, d) => t + d.valor, 0));

// ── Pendência ─────────────────────────────────────────────────────────────

export type PendenciaDoAcerto = {
  id: string;
  motoboyId: string;
  /** O dia do expediente a que a pendência pertence (o que o lojista escolheu). */
  dia: string;
  valor: number;
  motivo: string;
  criadoPor: string | null;
  /** Quando foi lançada (ISO). */
  em: string;
};

/** Os dias do período, de `de` a `ate` (inclusive), no formato do expediente. */
export const diaNoPeriodo = (dia: string, de: string, ate: string) => dia >= de && dia <= ate;

/** O que sai do acerto: a soma das pendências. */
export const totalDasPendencias = (lista: Pick<PendenciaDoAcerto, "valor">[]) => centavos(lista.reduce((t, p) => t + (Number(p.valor) || 0), 0));

export const MOTIVO_MAXIMO = 300;
export const PENDENCIA_MAXIMA = 100_000;

/** Confere o que veio da tela antes de gravar. Motivo é obrigatório: é ele que o motoboy lê. */
export function validarPendencia(b: { valor?: unknown; motivo?: unknown; dia?: unknown }):
  | { ok: true; valor: number; motivo: string; dia: string }
  | { ok: false; erro: string } {
  const valor = lerValorEmReais(b.valor);
  if (valor === null || valor <= 0) return { ok: false, erro: "Digite o valor da pendência (ex.: 50,00)." };
  if (valor > PENDENCIA_MAXIMA) return { ok: false, erro: "Valor alto demais para uma pendência. Confira o número." };
  const motivo = String(b.motivo ?? "").replace(/\s+/g, " ").trim();
  if (motivo.length < 3) return { ok: false, erro: "Escreva o motivo da pendência — o motoboy vê o que foi descontado e por quê." };
  if (!ehDia(b.dia)) return { ok: false, erro: "Escolha a data da pendência." };
  return { ok: true, valor, motivo: motivo.slice(0, MOTIVO_MAXIMO), dia: b.dia };
}

/** Confere a diária digitada para um dia. Zero vale (dia sem diária). */
export function validarDiariaDoDia(b: { valor?: unknown; dia?: unknown }):
  | { ok: true; valor: number; dia: string }
  | { ok: false; erro: string } {
  const valor = lerValorEmReais(b.valor);
  if (valor === null) return { ok: false, erro: "Digite o valor da diária (ex.: 40,00)." };
  if (valor > 10_000) return { ok: false, erro: "Valor alto demais para uma diária. Confira o número." };
  if (!ehDia(b.dia)) return { ok: false, erro: "Dia inválido." };
  return { ok: true, valor, dia: b.dia };
}

/**
 * Os dois totais do acerto: "Diária + Taxa" (`totalWithDaily`, o A PAGAR) e
 * "Só Taxa" (`totalFeeOnly`). O lanche acima do combinado e as pendências saem
 * dos DOIS — são dívida do motoboy, não parte da diária.
 */
export function totaisDoAcertoDoMotoboy(o: { diarias: number; entregas: number; lanche: number; pendencias: number }) {
  return {
    totalWithDaily: centavos(o.diarias + o.entregas - o.lanche - o.pendencias),
    totalFeeOnly: centavos(o.entregas - o.lanche - o.pendencias),
  };
}

// ── Cartão e voucher num quadrado só (opção da loja) ──────────────────────

export type OpcoesDoAcerto = {
  /** Débito, crédito e voucher num quadrado só ("Cartão / voucher") na conferência. */
  juntarCartaoEVale: boolean;
};

export const OPCOES_DO_ACERTO_PADRAO: OpcoesDoAcerto = { juntarCartaoEVale: false };

/** Lê `deliveryConfig.acertoDoMotoboy`. Ausente ou estranho = padrão (desligado). */
export function lerOpcoesDoAcerto(deliveryConfig: unknown): OpcoesDoAcerto {
  const cfg = deliveryConfig && typeof deliveryConfig === "object" && !Array.isArray(deliveryConfig)
    ? (deliveryConfig as Record<string, unknown>).acertoDoMotoboy
    : null;
  const o = cfg && typeof cfg === "object" && !Array.isArray(cfg) ? (cfg as Record<string, unknown>) : {};
  return { juntarCartaoEVale: o.juntarCartaoEVale === true };
}

/** As caixas que a opção junta: as três da maquininha. */
export const CAIXAS_DO_CARTAO: readonly ChaveDaForma[] = ["DEBITO", "CREDITO", "VALE"];

/** O quadrado da conferência: uma caixa do acerto, ou o "Cartão / voucher" que junta as três. */
export type QuadradoDoAcerto = ChaveDaForma | "CARTAO";

/** Em que quadrado cai esta caixa, com a opção da loja. */
export const quadradoDaCaixa = (caixa: ChaveDaForma, juntar: boolean): QuadradoDoAcerto =>
  juntar && CAIXAS_DO_CARTAO.includes(caixa) ? "CARTAO" : caixa;
