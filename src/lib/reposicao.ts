/**
 * REPOSIÇÃO — o item que faltou (ou veio errado) num pedido que já saiu.
 *
 * Pedido do Flávio (Showrrascão, 02/10/2026): o cliente pediu 10 esfihas de
 * carne e 1 de Nevada, e a de Nevada não foi. Até aqui a loja resolvia "de
 * mão": refazia no grito, sem papel, sem endereço na comanda e sem nada que
 * dissesse ao motoboy que não era para cobrar. Agora: no pedido que já saiu, a
 * loja marca o que faltou e nasce um pedido de reposição que
 *
 *   • imprime a SUA comanda, com endereço e contato do cliente, avisando que
 *     já está pago — só entregar;
 *   • entra no TOPO da produção do KDS (`prioridadeNaCozinha`), acima até da
 *     rota prioritária: é cliente esperando por erro da loja;
 *   • vale R$ 0,00 e não tem taxa: o dinheiro já entrou no pedido original.
 *     Faturamento, caixa e mensalidade não mudam.
 *
 * ── Por que não é um pedido colado (parentOrderId) ─────────────────────────
 *
 * O acréscimo de marketplace usa `parentOrderId` e, por isso, NÃO imprime
 * sozinho — os itens dele saem na comanda do pedido principal (print-queue,
 * GlobalPrintListener, handlePrint). A reposição precisa exatamente do
 * contrário: um papel novo, sozinho, para a cozinha e para o motoboy. Então o
 * vínculo com o original fica em `reposicao.pedidoId`.
 *
 * ── Estoque ─────────────────────────────────────────────────────────────────
 *
 * FALTOU: o pedido original já baixou o insumo do item que não foi feito;
 * fazer agora não baixa de novo. TROCA (veio errado): o que foi errado já
 * saiu da cozinha, e o certo sai agora — baixa.
 */

import { escolhasDoItemComGrupo } from "@/lib/relatorios/itens-vendidos";

export type MotivoDaReposicao = "FALTOU" | "TROCA";

export type Reposicao = {
  /** O pedido original. */
  pedidoId: string;
  /** Como o número do original aparece para a loja ("123", "4F2A"). */
  numero: string;
  motivo: MotivoDaReposicao;
};

export const ROTULO_DO_MOTIVO: Record<MotivoDaReposicao, string> = {
  FALTOU: "Item faltante",
  TROCA: "Troca (veio errado)",
};

/**
 * Só depois que o pedido saiu: antes disso, faltar item se resolve editando o
 * pedido (o lápis), que a cozinha ainda nem terminou.
 */
export const STATUS_QUE_JA_SAIU = [
  "SAIU_ENTREGA", "SAIU_PARA_ENTREGA", "EM_ROTA",
  "ENTREGUE", "ENCERRADO", "FINALIZADO", "CONCLUIDO",
] as const;

export function pedidoJaSaiu(status: string | null | undefined): boolean {
  return (STATUS_QUE_JA_SAIU as readonly string[]).includes(String(status || "").toUpperCase());
}

/** O número do pedido como a loja o reconhece. */
export function numeroDoPedido(p: {
  id: string;
  dailyOrderNumber?: number | null;
  ifoodReference?: string | null;
  openDeliveryReference?: string | null;
}): string {
  if (p.dailyOrderNumber) return String(p.dailyOrderNumber);
  return p.ifoodReference || p.openDeliveryReference || p.id.slice(-6).toUpperCase();
}

export function lerReposicao(valor: unknown): Reposicao | null {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
  const r = valor as Record<string, unknown>;
  if (typeof r.pedidoId !== "string") return null;
  return {
    pedidoId: r.pedidoId,
    numero: String(r.numero || ""),
    motivo: r.motivo === "TROCA" ? "TROCA" : "FALTOU",
  };
}

/**
 * A forma de pagamento que vai no pedido de reposição. "Pago Online" é o que
 * TODA versão do Assistente lê como pago (sai "(Pago via Online - NAO
 * COBRAR)"), e o mesmo que `ehPagoOnline` (lib/pagamento-na-entrega.ts) usa
 * para o app do motoboy não mandar cobrar. Nada de "entrega" no texto: essa
 * palavra é lida como "cobrar na entrega".
 */
export function formaDePagamentoDaReposicao(numeroDoOriginal: string): string {
  return `Pago Online (reposição do #${numeroDoOriginal})`;
}

/**
 * A observação que abre a comanda. `notes` é o único campo que todas as
 * versões do Assistente imprimem com destaque (é o mesmo truque da 2ª via do
 * pedido alterado). O papel sai sem acento — escrever com acento aqui é para
 * a tela.
 */
export function observacaoDaReposicao(entrada: {
  numero: string;
  motivo: MotivoDaReposicao;
  observacao?: string | null;
}): string {
  const titulo = entrada.motivo === "TROCA"
    ? `*** TROCA DO PEDIDO #${entrada.numero} ***`
    : `*** ITEM FALTANTE DO PEDIDO #${entrada.numero} ***`;
  const linhas = [titulo, "JÁ PAGO - SÓ ENTREGAR, NÃO COBRAR"];
  const obs = String(entrada.observacao || "").trim();
  if (obs) linhas.push(obs);
  return linhas.join("\n");
}

/**
 * As escolhas de dentro do item que dá para repor sozinhas ("1x Esfiha de
 * Nevada" do combo), com a quantidade JÁ multiplicada pelo item — 2 combos com
 * 1 Nevada são 2 Nevadas. Lê os três formatos de comboSelections (site,
 * marketplace, balcão) pela mesma função do relatório de itens. Meia pizza
 * (fração abaixo de 1) fica de fora: não se repõe meia pizza.
 */
export function opcoesDoItem(item: { quantity: number; comboSelections?: unknown }): { nome: string; quantidade: number }[] {
  const soma = new Map<string, number>();
  for (const e of escolhasDoItemComGrupo(item, new Map())) {
    if (e.quantidade < 1) continue;
    soma.set(e.nome, (soma.get(e.nome) || 0) + Math.floor(e.quantidade));
  }
  return [...soma].map(([nome, quantidade]) => ({ nome, quantidade }));
}
