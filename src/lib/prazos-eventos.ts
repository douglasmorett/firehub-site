/**
 * Histórico do prazo (tabela PrazoEvento) — a matéria-prima do relatório do
 * dono: quanto tempo o prazo ficou em cada faixa, quantas vezes estourou,
 * quando a leitura do painel parou.
 *
 * Grava só TRANSIÇÕES, não cada leitura: a extensão chama /calcular a cada
 * mudança do kanban e a cada minuto; guardar tudo viraria depósito. Um evento
 * `prazo` abre um trecho (vale até o próximo evento); `parou` fecha o trecho
 * quando o painel ficou sem leitura (Chrome fechado, aba morta).
 */
import { prisma } from "@/lib/prisma";

export type EstadoParaEvento = { lendo: boolean; minutos: number; pausar: boolean; preparo99: number; pedidos: number };

export async function registrarEventoDePrazo(contaId: string, anterior: any, atual: EstadoParaEvento): Promise<void> {
  try {
    const a = anterior && typeof anterior === "object" ? anterior : {};
    const antesLendo = !!a.visto && a.lendo !== false;
    if (!atual.lendo) {
      if (antesLendo) await prisma.prazoEvento.create({ data: { contaId, tipo: "parou", pausar: false } });
      return;
    }
    const mudou = !antesLendo || a.minutos !== atual.minutos || !!a.pausar !== atual.pausar || a.preparo99 !== atual.preparo99;
    if (!mudou) return;
    await prisma.prazoEvento.create({
      data: { contaId, tipo: "prazo", pedidos: atual.pedidos, minutos: atual.minutos, pausar: atual.pausar, preparo99: atual.preparo99 },
    });
  } catch (err: any) {
    // Histórico nunca derruba o cálculo: a extensão precisa da resposta.
    console.error("[Prazos evento]", err?.message);
  }
}

/** Apaga o que passou de 90 dias — chamado de vez em quando pelo relatório. */
export async function podarEventosDePrazo(contaId: string): Promise<void> {
  try {
    const limite = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await prisma.prazoEvento.deleteMany({ where: { contaId, em: { lt: limite } } });
  } catch (err: any) {
    console.error("[Prazos poda]", err?.message);
  }
}
