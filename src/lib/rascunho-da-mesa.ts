/**
 * O pedido que o garçom está montando e ainda não mandou para a cozinha.
 *
 * O carrinho vivia só no estado do React: o "← Voltar" apagava tudo sem
 * perguntar, o gesto de voltar do celular saía do módulo e recarregar a página
 * (ou o tablet dormir e o navegador descartar a aba) perdia os itens. O garçom
 * voltava para a mesa para conferir o que já tinha saído e, na volta, lançava
 * de novo do zero — com a mesa esperando.
 *
 * Agora o carrinho é guardado no aparelho, por mesa ABERTA (id da sessão), e
 * volta quando o garçom abre o cardápio daquela mesa de novo. Some quando o
 * pedido é enviado, quando ele descarta, quando a mesa fecha ou depois de
 * `VALIDADE_MS` (pedido montado ontem não é pedido de hoje).
 *
 * Só a conta vive aqui, sem `localStorage`: quem grava e lê é a tela.
 */

export const VALIDADE_MS = 12 * 60 * 60 * 1000;

export const chaveDoRascunho = (sessionId: string) => `firehub:mesa:rascunho:${sessionId}`;

export type ProdutoDoRascunho = { id: string; name: string; price: number; [k: string]: unknown };

export type LinhaDoCarrinho<P extends ProdutoDoRascunho = ProdutoDoRascunho> = {
  uid: string;
  item: P;
  qty: number;
  unitPrice?: number;
  comboSelections?: any[];
  guestId?: string | null;
  notes?: string;
};

type LinhaGuardada = {
  uid: string;
  itemId: string;
  nome: string;
  qty: number;
  unitPrice?: number;
  comboSelections?: any[];
  guestId?: string | null;
  notes?: string;
};

export function guardarRascunho(linhas: LinhaDoCarrinho[], agora: number): string {
  const guardadas: LinhaGuardada[] = linhas.map((l) => ({
    uid: l.uid,
    itemId: l.item.id,
    nome: l.item.name,
    qty: l.qty,
    ...(l.unitPrice !== undefined ? { unitPrice: l.unitPrice } : {}),
    ...(l.comboSelections ? { comboSelections: l.comboSelections } : {}),
    ...(l.guestId ? { guestId: l.guestId } : {}),
    ...(l.notes ? { notes: l.notes } : {}),
  }));
  return JSON.stringify({ v: 1, em: agora, linhas: guardadas });
}

export type RascunhoRestaurado<P extends ProdutoDoRascunho> = {
  linhas: LinhaDoCarrinho<P>[];
  /** Nomes dos itens que saíram do cardápio (pausados, apagados) desde que foram escolhidos. */
  foraDoCardapio: string[];
  /** Linhas cuja pessoa saiu da mesa: voltaram a ser "da mesa". */
  semDono: number;
};

/**
 * Lê o que foi guardado contra o cardápio e as pessoas de AGORA. Texto
 * estragado, de outra versão ou vencido vira rascunho vazio, nunca erro.
 */
export function restaurarRascunho<P extends ProdutoDoRascunho>(
  texto: string | null | undefined,
  contexto: { produtos: P[]; pessoas: string[]; agora: number },
): RascunhoRestaurado<P> {
  const vazio: RascunhoRestaurado<P> = { linhas: [], foraDoCardapio: [], semDono: 0 };
  if (!texto) return vazio;
  let dado: any;
  try {
    dado = JSON.parse(texto);
  } catch {
    return vazio;
  }
  if (!dado || dado.v !== 1 || !Array.isArray(dado.linhas)) return vazio;
  const em = Number(dado.em);
  if (!Number.isFinite(em) || contexto.agora - em > VALIDADE_MS || em - contexto.agora > 60_000) return vazio;

  const porId = new Map(contexto.produtos.map((p) => [p.id, p]));
  const pessoas = new Set(contexto.pessoas);
  const resultado: RascunhoRestaurado<P> = { linhas: [], foraDoCardapio: [], semDono: 0 };
  const uids = new Set<string>();

  for (const g of dado.linhas as LinhaGuardada[]) {
    const qty = Math.floor(Number(g?.qty));
    if (!g || typeof g.itemId !== "string" || !Number.isFinite(qty) || qty < 1) continue;
    const produto = porId.get(g.itemId);
    if (!produto) {
      resultado.foraDoCardapio.push(String(g.nome || "item"));
      continue;
    }
    let guestId: string | null = typeof g.guestId === "string" && g.guestId ? g.guestId : null;
    if (guestId && !pessoas.has(guestId)) {
      guestId = null;
      resultado.semDono++;
    }
    const combo = Array.isArray(g.comboSelections) && g.comboSelections.length > 0 ? g.comboSelections : undefined;
    // Item simples pega o preço de AGORA (a loja pode ter mudado); combo guarda
    // o que foi somado nas escolhas. O servidor recalcula os dois ao lançar.
    const unitPrice = combo && Number.isFinite(Number(g.unitPrice)) ? Number(g.unitPrice) : produto.price;
    let uid = typeof g.uid === "string" && g.uid ? g.uid : `${produto.id}-r${resultado.linhas.length}`;
    while (uids.has(uid)) uid = `${uid}~`;
    uids.add(uid);
    resultado.linhas.push({
      uid,
      item: produto,
      qty: Math.min(qty, 99),
      unitPrice,
      ...(combo ? { comboSelections: combo } : {}),
      guestId,
      ...(typeof g.notes === "string" && g.notes.trim() ? { notes: g.notes.trim() } : {}),
    });
  }
  return resultado;
}
