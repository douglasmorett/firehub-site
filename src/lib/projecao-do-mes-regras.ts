/**
 * As contas da aba Projeção do admin (lib/projecao-do-mes.ts lê o banco e chama
 * estas). Separadas para o teste rodar sem banco: scripts/teste-projecao-do-mes.ts.
 *
 * Pergunta do dono (12/10/2026): "a gente vai fechar quanto de mensalidade no
 * fim do mês?". A resposta é o que cada loja já vendeu depois do teste mais o
 * ritmo dos últimos 7 dias até o fim do mês, pela MESMA conta do boleto
 * (calcMensalidade: 2%, mínimo, teto, vendas antes da virada a 1%).
 */
import { calcMensalidade } from "@/lib/firehub-billing";

export const DIA = 86_400_000;

/** Tamanho da loja pelo que ela vende no mês (projetado). */
export type Faixa = "GRANDE" | "MEDIA" | "PEQUENA";
export const VENDA_DA_LOJA_GRANDE = 10_000;
export const VENDA_DA_LOJA_MEDIA = 2_000;

export function faixaDaVenda(vendaDoMes: number): Faixa {
  if (vendaDoMes >= VENDA_DA_LOJA_GRANDE) return "GRANDE";
  if (vendaDoMes >= VENDA_DA_LOJA_MEDIA) return "MEDIA";
  return "PEQUENA";
}

/**
 * PAGANDO: já saiu do teste antes de hoje.
 * TESTE_ACABA: o teste termina dentro do mês (ainda vai virar cobrança).
 * SO_USO: não vendeu nada cobrável, mas o fechamento cobra o mínimo por uso
 * (robô respondeu, IA, caixa, contas, notas, totem, Meta Ads — detectarUsoDaLoja).
 */
export type Situacao = "PAGANDO" | "TESTE_ACABA" | "SO_USO";

/** Sem pedido há este tanto de dias, a loja que paga entra como "parou". */
export const DIAS_PARA_PARADA = 7;

/**
 * A chance de o boleto ser pago, para a "aposta". São pesos escritos à mão,
 * mostrados na tela — não estatística: em 12/10/2026 só havia setembro de
 * histórico (R$ 1.302 pagos de R$ 1.523 cobrados, sem a Taurus perdoada).
 */
export function chanceDePagar(s: { situacao: Situacao; faixa: Faixa; diasSemPedido: number | null }): { chance: number; porque: string } {
  if (s.situacao === "SO_USO") return { chance: 0.25, porque: "mínimo sem ter vendido" };
  if (s.situacao === "PAGANDO") {
    if (s.diasSemPedido === null || s.diasSemPedido >= DIAS_PARA_PARADA) return { chance: 0.5, porque: "já paga, mas parou de vender" };
    return { chance: 1, porque: "já paga e está vendendo" };
  }
  if (s.faixa === "GRANDE") return { chance: 0.8, porque: "teste acaba; vende mais de R$ 10 mil/mês" };
  if (s.faixa === "MEDIA") return { chance: 0.5, porque: "teste acaba; vende R$ 2–10 mil/mês" };
  return { chance: 0.25, porque: "teste acaba; vende menos de R$ 2 mil/mês" };
}

/**
 * Venda média por dia nos últimos 7 dias inteiros. Loja que começou a vender
 * dentro da janela divide pelos dias que ela teve, não por 7 — senão quem
 * entrou há 2 dias aparece vendendo um terço do que vende.
 */
export function ritmoPorDia(vendaNaJanela: number, primeiroPedido: Date | null, inicioDaJanela: Date, fimDaJanela: Date): number {
  if (!primeiroPedido || vendaNaJanela <= 0) return 0;
  const dias = primeiroPedido > inicioDaJanela
    ? Math.max(1, Math.ceil((fimDaJanela.getTime() - primeiroPedido.getTime()) / DIA))
    : Math.round((fimDaJanela.getTime() - inicioDaJanela.getTime()) / DIA);
  return vendaNaJanela / Math.max(1, dias);
}

/**
 * Base e mensalidade do mês: o que já conta + o ritmo de agora (ou do fim do
 * teste, o que vier depois) até o fim do mês. `inicioDaCobranca` null = teste
 * cobre o mês inteiro, nada a cobrar.
 */
export function projetarMes(p: {
  mes: string;
  /** Venda que já conta, feita antes de 04/10/2026 (1%). */
  contaAntesDaVirada: number;
  /** Venda que já conta, do resto do mês. */
  contaDepois: number;
  porDia: number;
  inicioDaCobranca: Date | null;
  agora: Date;
  fimDoMes: Date;
}): { baseAteAgora: number; baseProjetada: number; mensalidade: number } {
  if (!p.inicioDaCobranca) return { baseAteAgora: 0, baseProjetada: 0, mensalidade: 0 };
  const desde = Math.max(p.agora.getTime(), p.inicioDaCobranca.getTime());
  const futuro = p.porDia * Math.max(0, (p.fimDoMes.getTime() - desde) / DIA);
  const baseAteAgora = p.contaAntesDaVirada + p.contaDepois;
  const baseProjetada = baseAteAgora + futuro;
  const mensalidade = baseProjetada > 0 ? calcMensalidade(baseProjetada, false, p.mes, p.contaAntesDaVirada).mensalidade : 0;
  return { baseAteAgora, baseProjetada, mensalidade };
}

/** Mensalidade de um mês inteiro (30 dias) no ritmo de hoje, sem teste. */
export function mesCheioNoRitmo(porDia: number, mes: string): number {
  return porDia > 0 ? calcMensalidade(porDia * 30, false, mes).mensalidade : 0;
}

/** Soma das três leituras: só o certo, a aposta pelos pesos e "se todas pagarem". */
export function totaisDaProjecao(linhas: { total: number; chance: number }[]) {
  let garantido = 0, aposta = 0, seTodas = 0;
  for (const l of linhas) {
    seTodas += l.total;
    aposta += l.total * l.chance;
    if (l.chance >= 1) garantido += l.total;
  }
  const r = (v: number) => Math.round(v * 100) / 100;
  return { garantido: r(garantido), aposta: r(aposta), seTodas: r(seTodas) };
}

/** "AAAA-MM-DD" no fuso dado. */
export function diaNoFuso(data: Date, timeZone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(data);
}

/** Soma `n` dias a um "AAAA-MM-DD" (aritmética de calendário, sem fuso). */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

/** Telefone para o link do WhatsApp: só dígitos, com 55 na frente. */
export function telefoneDoWhatsapp(tel: string | null | undefined): string | null {
  const d = String(tel || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.startsWith("55") && d.length >= 12 ? d : `55${d}`;
}
