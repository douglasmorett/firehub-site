/**
 * Marcos de tempo do pedido — a base dos relatórios de operação.
 *
 * O pedido só guardava `createdAt` e `updatedAt`, e `updatedAt` é reescrito por
 * qualquer edição (motoboy atribuído, impressão, pagamento). Sem carimbo por
 * etapa não dá para responder as perguntas que o lojista faz todo dia: quanto
 * tempo o pedido esperou para ser aceito, quanto ficou na cozinha, e se saiu
 * para entrega dentro do prazo.
 *
 * Quem carimba é a extensão do Prisma em `src/lib/prisma.ts` — de propósito, e
 * não cada rota: status é escrito em uma dúzia de lugares (painel, KDS, app do
 * motoboy, webhooks do iFood, 99Food, Brendi, Jotajá, fechamento de caixa) e
 * qualquer integração nova entra carimbada sem ninguém lembrar de fazer nada.
 */

export type MarcoDoPedido = "acceptedAt" | "readyAt" | "dispatchedAt" | "deliveredAt";

/**
 * Em qual campo cada status cai. Os sinônimos existem porque as plataformas e
 * as telas antigas escrevem vocabulários diferentes para a mesma etapa — ver
 * ALL_TARGET_STATUSES em src/app/api/customer-order/status/route.ts.
 */
export const MARCO_POR_STATUS: Record<string, MarcoDoPedido> = {
  CONFIRMADO:        "acceptedAt",
  ACEITO:            "acceptedAt",
  PREPARANDO:        "acceptedAt",
  EM_PREPARO:        "acceptedAt",
  EM_ANDAMENTO:      "acceptedAt",
  PRONTO:            "readyAt",
  SAIU_ENTREGA:      "dispatchedAt",
  SAIU_PARA_ENTREGA: "dispatchedAt",
  ENTREGUE:          "deliveredAt",
};

/**
 * Devolve o carimbo que este status merece, ou null.
 *
 * O carimbo é sempre a ÚLTIMA vez que o pedido entrou na etapa: reescrever é
 * mais barato (não exige ler a linha antes de gravar) e é o que interessa na
 * prática — se o pedido voltou para a produção e saiu de novo, foi na segunda
 * saída que ele foi para a rua.
 */
export function carimboDeStatus(status: unknown, agora = new Date()): Partial<Record<MarcoDoPedido, Date>> | null {
  if (typeof status !== "string") return null;
  const campo = MARCO_POR_STATUS[status.toUpperCase()];
  if (!campo) return null;
  return { [campo]: agora };
}

/**
 * Duração em minutos entre dois marcos, ou null quando algum falta.
 *
 * Descarta o que não é tempo de operação e só sujaria a média: negativo
 * (relógios/carimbos fora de ordem) e mais de 4 horas — normalmente pedido que
 * ficou esquecido aberto na tela e foi encerrado em lote no fechamento do
 * caixa, não pedido que demorou 4 horas para sair.
 */
export const TETO_DE_MINUTOS_MEDIDOS = 240;

export function minutosEntre(de: string | Date | null | undefined, ate: string | Date | null | undefined): number | null {
  if (!de || !ate) return null;
  const inicio = new Date(de).getTime();
  const fim = new Date(ate).getTime();
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return null;
  const minutos = (fim - inicio) / 60000;
  if (minutos < 0 || minutos > TETO_DE_MINUTOS_MEDIDOS) return null;
  return minutos;
}
