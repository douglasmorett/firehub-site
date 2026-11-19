/**
 * Incluir ou trocar a OBSERVAÇÃO de um item já lançado ("sem mostarda").
 *
 * Garagem Burger, 19/11/2026: o cliente pediu 2 dogs e, depois de fechar o
 * pedido, avisou que era sem mostarda. A loja não tinha onde escrever — o
 * "Editar escolhas" só existe em item com pergunta, e o pedido com NFC-e
 * emitida nem abria a edição — e a cozinha, que não via nada no KDS, passava
 * reto. (A observação que CHEGA do marketplace é outro arquivo:
 * lib/observacao-do-item.ts.)
 *
 * O que esta edição faz e o que não faz:
 *   • muda `CustomerOrderItem.notes` e nada mais: nem preço, nem quantidade,
 *     nem total (pedido próprio ou de marketplace — o parceiro não é avisado);
 *   • item que a cozinha JÁ deu por pronto volta para ela (`prontoEm` zerado),
 *     enquanto a mercadoria não saiu: é a mesma regra do item remontado. O
 *     status do pedido, o `kdsStage`, o `readyAt` e o aviso ao parceiro ficam
 *     como estão — o pronto do iFood não tem volta, e o "pronto" do pedido
 *     (lido pela roteirização) não pode sumir por causa de uma observação;
 *   • grava no `editHistory` (ação OBSERVACAO, com os ids dos itens), e é
 *     desse registro que o KDS tira o selo "⚠ OBS. ALTERADA".
 */
import { mercadoriaJaSaiu } from "@/lib/fiscal-momento";
import type { RegistroDeEdicao } from "@/lib/edicao-de-pedido";

/** O mesmo teto da observação do item acrescentado na edição. */
export const LIMITE_DA_OBSERVACAO = 200;

export function limparObservacao(v: unknown): string {
  return String(v ?? "").trim().slice(0, LIMITE_DA_OBSERVACAO);
}

type ItemParaObservacao = { id: string; productName?: string | null; notes?: string | null; prontoEm?: Date | string | null };

export type MudancaDeObservacao = {
  itemId: string;
  nome: string;
  antes: string;
  agora: string;
  /** A cozinha já tinha dado baixa e a comida não saiu: o item volta para o KDS. */
  voltaParaACozinha: boolean;
};

/** O que muda de verdade. Item de outro pedido e observação igual à de hoje ficam de fora. */
export function planoDasObservacoes(
  pedido: { status?: string | null; deliveryType?: string | null; items: ItemParaObservacao[] },
  pedidas: unknown
): MudancaDeObservacao[] {
  const lista = Array.isArray(pedidas) ? pedidas : [];
  const mudancas: MudancaDeObservacao[] = [];
  const naRua = mercadoriaJaSaiu(pedido) === true;
  for (const p of lista) {
    const item = pedido.items.find((i) => i.id === String(p?.itemId || ""));
    if (!item || mudancas.some((m) => m.itemId === item.id)) continue;
    const antes = limparObservacao(item.notes);
    const agora = limparObservacao(p?.notes);
    if (antes === agora) continue;
    mudancas.push({
      itemId: item.id,
      nome: String(item.productName || "item").trim() || "item",
      antes,
      agora,
      voltaParaACozinha: !!item.prontoEm && !naRua,
    });
  }
  return mudancas;
}

/** `📝 2 Hot Dog: "sem mostarda"` — com o "antes" quando já havia observação. */
export function descricaoDasObservacoes(mudancas: MudancaDeObservacao[]): string {
  const aspas = (s: string) => (s ? `"${s}"` : "(sem observação)");
  return mudancas
    .map((m) => `📝 ${m.nome}: ${m.antes ? `${aspas(m.antes)} → ` : ""}${aspas(m.agora)}`)
    .join(", ");
}

function registrosDeObservacao(editHistory: unknown): RegistroDeEdicao[] {
  return (Array.isArray(editHistory) ? editHistory : []).filter(
    (r: any) => r && r.acao === "OBSERVACAO" && Array.isArray(r.itensComObservacao)
  );
}

/** Os itens cuja observação a loja mudou depois do pedido feito — o selo do KDS. */
export function itensComObservacaoAlterada(editHistory: unknown): Set<string> {
  return new Set(registrosDeObservacao(editHistory).flatMap((r) => (r.itensComObservacao || []).map(String)));
}

/**
 * O pedido que a cozinha já tinha encerrado e tem item com observação nova
 * por refazer: a mudança veio DEPOIS da baixa final (`kdsFinishedAt`) e o
 * item está sem `prontoEm`. É o que faz o KDS de produção buscá-lo de novo —
 * sem a data, um pedido finalizado "na marra" com a observação trocada antes
 * voltaria para a tela sem ninguém ter mexido nele.
 */
export function obsAlteradaEsperandoACozinha(pedido: {
  editHistory?: unknown;
  kdsFinishedAt?: Date | string | null;
  items?: { id: string; prontoEm?: Date | string | null }[] | null;
}): boolean {
  const fim = pedido.kdsFinishedAt ? new Date(pedido.kdsFinishedAt).getTime() : null;
  const semPronto = new Set((pedido.items || []).filter((i) => !i.prontoEm).map((i) => i.id));
  return registrosDeObservacao(pedido.editHistory).some(
    (r) =>
      (fim == null || new Date(r.quando).getTime() > fim) &&
      (r.itensComObservacao || []).some((id) => semPronto.has(String(id)))
  );
}

/**
 * As escritas da edição, prontas para a rota aplicar numa transação — aqui
 * para o teste (scripts/teste-observacao-na-edicao.ts) provar o que muda e o
 * que NÃO muda: o item só ganha `notes` (e o `prontoEm` zerado quando volta
 * para a cozinha), o pedido só ganha a linha do rastro. `totalAmount` não
 * aparece em lugar nenhum — nem no pedido próprio, nem no de marketplace.
 */
export function gravacaoDasObservacoes(
  pedido: { status?: string | null; deliveryType?: string | null; totalAmount?: number | null; editHistory?: unknown; items: ItemParaObservacao[] },
  quem: { nome: string; id?: string },
  pedidas: unknown,
  agora: Date = new Date()
): null | {
  mudancas: MudancaDeObservacao[];
  itens: { id: string; data: { notes: string | null; prontoEm?: null } }[];
  registro: RegistroDeEdicao;
} {
  const mudancas = planoDasObservacoes(pedido, pedidas);
  if (mudancas.length === 0) return null;
  const total = Number(pedido.totalAmount) || 0;
  return {
    mudancas,
    itens: mudancas.map((m) => ({
      id: m.itemId,
      data: { notes: m.agora || null, ...(m.voltaParaACozinha ? { prontoEm: null } : {}) },
    })),
    registro: {
      quando: agora.toISOString(),
      quem: quem.nome,
      ...(quem.id ? { quemId: quem.id } : {}),
      acao: "OBSERVACAO",
      descricao: descricaoDasObservacoes(mudancas),
      totalAntes: total,
      totalDepois: total,
      itensComObservacao: mudancas.map((m) => m.itemId),
    },
  };
}
