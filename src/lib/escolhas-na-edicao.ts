/**
 * /src/lib/escolhas-na-edicao.ts
 *
 * As ESCOLHAS (sabor, borda, adicional, refrigerante do combo) de um item que
 * já está no pedido, para a aba "Editar itens" do Ver pedido.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 * Pizzaria Lapastine, 17/10/2026: o cliente ligou pedindo um extra que no
 * cardápio é ADICIONAL de uma pergunta da pizza. A busca de "Acrescentar item"
 * não acha opção de pergunta (ela não se vende sozinha), e o jeito que sobrava
 * — acrescentar a pizza de novo com o extra e baixar a quantidade da antiga —
 * travava o Salvar pedindo "motivo de tirar o item", com o campo lá embaixo.
 * O lojista refez o pedido do zero e ficou duplicado.
 *
 * O Douglas: "ele tem que remontar o pedido, como se ele fosse pedir um
 * cachorro quente, um açaí". Então o item que tem perguntas ganha "Editar
 * escolhas": reabre a MESMA janela do cardápio (ComboModal) com o que já
 * estava marcado, e o item é TROCADO pelo remontado — não é cancelamento, não
 * pede motivo.
 *
 * Função pura (sem Prisma): a tela e a rota api/store/orders/[id]/itens usam
 * as mesmas. Teste: npx tsx scripts/teste-escolhas-na-edicao.ts
 */
import { normalizarEscolhas, escolhasNosGruposAtuais, type EscolhasDoCombo, type ProdutoComCombo } from "@/lib/preco-combo";

export type EscolhasPorGrupo = Record<string, Record<string, number>>;

type GrupoSimples = { id?: string | null; items?: ({ menuProduct?: { name?: string | null } | null } | null)[] | null };

/**
 * As escolhas gravadas no item, no formato que o ComboModal abre
 * (`{ grupoId: { opção: qtd } }`) e só com o que EXISTE hoje no produto.
 *
 *   • formato do cardápio com id de grupo velho (o produto foi salvo depois do
 *     pedido e as perguntas nasceram de novo): reancorado pelo nome;
 *   • lista do PDV/mesa (`[{ name, quantity }]`, sem grupo): vai para a única
 *     pergunta que tem aquela opção — com duas candidatas fica de fora, porque
 *     chutar o grupo errado cobra diferente do que a pessoa vê marcado;
 *   • opção que saiu do cardápio: fica de fora (a janela mostra o que falta).
 */
export function escolhasParaReabrir(
  produto: (ProdutoComCombo & { comboGroups?: GrupoSimples[] | null }) | null | undefined,
  gravadas: EscolhasDoCombo | string
): EscolhasPorGrupo {
  const grupos = (produto?.comboGroups || []) as GrupoSimples[];
  if (!gravadas || grupos.length === 0) return {};
  const reancoradas = escolhasNosGruposAtuais(produto as any, gravadas as any);
  const lista = normalizarEscolhas(reancoradas as any);

  const nomesDo = (g: GrupoSimples) => new Set((g.items || []).map((i) => i?.menuProduct?.name).filter(Boolean) as string[]);
  const saida: EscolhasPorGrupo = {};
  for (const e of lista) {
    let grupo = e.grupoId ? grupos.find((g) => g.id === e.grupoId && nomesDo(g).has(e.nome)) : undefined;
    if (!grupo) {
      const candidatos = grupos.filter((g) => g.id && nomesDo(g).has(e.nome));
      if (candidatos.length === 1) grupo = candidatos[0];
    }
    if (!grupo?.id) continue;
    const g = (saida[grupo.id] ||= {});
    g[e.nome] = (g[e.nome] || 0) + Math.max(1, Math.floor(e.qtd));
  }
  return saida;
}

/** O nome sem ", " — o histórico separa as partes da edição por vírgula. */
const semVirgula = (s: string) => String(s || "").replace(/,\s*/g, " ").replace(/\s+/g, " ").trim();

/** "Calabresa / Borda catupiry / Bacon extra x2" — as escolhas numa linha, para o histórico. */
export function escolhasEmTexto(escolhas: EscolhasDoCombo | string): string {
  return normalizarEscolhas(escolhas as any)
    .map((e) => (e.qtd > 1 ? `${semVirgula(e.nome)} x${e.qtd}` : semVirgula(e.nome)))
    .join(" / ");
}

/**
 * A parte do `editHistory.descricao` de uma troca de escolhas:
 *
 *   ✎1x Pizza Guajará (antes: Grande; agora: Grande / Bacon extra)
 *
 * lib/historico-do-pedido.ts desfaz esse texto para a moldura amarela da
 * comanda ("escolhas trocadas"). Mudar o formato aqui pede mudar lá — o teste
 * scripts/teste-historico-do-pedido.ts avisa.
 */
export function descricaoDaTroca(quantidade: number, nome: string, antes: EscolhasDoCombo | string, depois: EscolhasDoCombo | string): string {
  return `✎${quantidade}x ${semVirgula(nome)} (antes: ${escolhasEmTexto(antes) || "sem escolhas"}; agora: ${escolhasEmTexto(depois) || "sem escolhas"})`;
}

export const REGEX_DA_TROCA = /^✎(\d+)x (.+?) \(antes: (.*); agora: (.*)\)$/;

/**
 * A troca pedida pela tela, já conferida contra o item do pedido. `parte` é
 * quantas unidades do item ganham as escolhas novas: todas (o item é trocado
 * no lugar) ou só algumas (o item fica com o resto e as remontadas viram uma
 * linha nova — "uma das duas pizzas com bacon").
 */
export type PlanoDaTroca =
  | { tipo: "NO_LUGAR"; itemId: string; quantidade: number }
  | { tipo: "SEPARA"; itemId: string; ficam: number; remontadas: number };

/**
 * Como a troca entra no pedido. Quantidade igual ou maior que a do item troca o
 * item inteiro; menor separa. Fora de 1..99 não vale.
 */
export function planoDaTroca(item: { id: string; quantity: number }, quantidadePedida: unknown): PlanoDaTroca | null {
  const q = Math.floor(Number(quantidadePedida));
  if (!Number.isFinite(q) || q < 1 || q > 99) return null;
  const atual = Math.max(1, Math.floor(Number(item.quantity) || 1));
  if (q >= atual) return { tipo: "NO_LUGAR", itemId: item.id, quantidade: q };
  return { tipo: "SEPARA", itemId: item.id, ficam: atual - q, remontadas: q };
}

/**
 * O termo da busca casa com uma OPÇÃO de pergunta do produto ("bacon" →
 * "Bacon extra" da pizza)? Devolve o nome da opção, para a busca mostrar o
 * produto com "tem Bacon extra nas escolhas" — sem isso o atendente lia
 * "Nenhum item com esse nome" e achava que o adicional não existia.
 */
export function opcaoQueCasa(produto: { comboGroups?: GrupoSimples[] | null } | null | undefined, termo: string): string | null {
  const t = normalizarBusca(termo);
  if (t.length < 2) return null;
  for (const g of produto?.comboGroups || []) {
    for (const i of g?.items || []) {
      const nome = i?.menuProduct?.name;
      if (nome && normalizarBusca(nome).includes(t)) return nome;
    }
  }
  return null;
}

/** Sem acento e sem caixa: "refri" acha "Refrigerante", "guarana" acha "Guaraná". */
export function normalizarBusca(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
