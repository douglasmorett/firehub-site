/**
 * /src/lib/historico-do-pedido.ts
 *
 * Lê o rastro `CustomerOrder.editHistory` (lib/edicao-de-pedido.ts,
 * `RegistroDeEdicao`) para a TELA: o que mudou em cada item e o que saiu.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 * O rastro é gravado desde 15/09 (quem, quando, o quê, total antes e depois),
 * mas nenhuma tela mostrava. O dono pediu (09/10/2026): "sempre que um item
 * for editado, tem que ficar destacado que ele foi editado e dá para ver como
 * estava antes". O registro não guarda o id do item, só o texto que a rota de
 * edição monta (api/store/orders/[id]/itens):
 *
 *   −Batata frita                 → saiu
 *   Coca 2L 2x → 1x               → mudou a quantidade
 *   +1x Pastel de carne (...)     → entrou depois
 *
 * várias partes na mesma linha, separadas por ", ". Este arquivo desfaz esse
 * texto. Se a rota mudar o formato, o teste
 * (scripts/teste-historico-do-pedido.ts) é o que avisa.
 */
import type { RegistroDeEdicao } from "@/lib/edicao-de-pedido";

export type MarcaDoItem =
  | { tipo: "QUANTIDADE"; antes: number; depois: number; quando: string; quem: string }
  | { tipo: "ACRESCENTADO"; quantidade: number; quando: string; quem: string };

export type ItemRemovido = { nome: string; quando: string; quem: string };

const SUFIXO_DO_MARKETPLACE = / \(pago na plataforma: total mantido\)$/;

/** O rastro como lista, mais recente por último — vazio se não houver. */
export function lerHistorico(editHistory: unknown): RegistroDeEdicao[] {
  if (!Array.isArray(editHistory)) return [];
  return editHistory.filter((r): r is RegistroDeEdicao => !!r && typeof r === "object" && typeof (r as any).descricao === "string");
}

const normalizar = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * O que mudou nos itens. `marcasDe(nome)` devolve as mudanças do item com
 * esse nome (o `productName` gravado), e `removidos` o que saiu do pedido.
 */
export function edicoesDosItens(editHistory: unknown) {
  const porNome = new Map<string, MarcaDoItem[]>();
  const acrescimos: { texto: string; marca: MarcaDoItem }[] = [];
  const removidos: ItemRemovido[] = [];

  for (const r of lerHistorico(editHistory)) {
    if (r.acao !== "REMOVEU" && r.acao !== "MUDOU_QTD" && r.acao !== "ACRESCENTOU") continue;
    const texto = r.descricao.replace(SUFIXO_DO_MARKETPLACE, "");
    for (const parte of texto.split(", ")) {
      const removeu = parte.match(/^[−-](.+)$/);
      if (removeu) {
        removidos.push({ nome: removeu[1].trim(), quando: r.quando, quem: r.quem });
        continue;
      }
      const mudou = parte.match(/^(.+) (\d+)x → (\d+)x$/);
      if (mudou) {
        const chave = normalizar(mudou[1]);
        porNome.set(chave, [...(porNome.get(chave) || []), { tipo: "QUANTIDADE", antes: Number(mudou[2]), depois: Number(mudou[3]), quando: r.quando, quem: r.quem }]);
        continue;
      }
      const entrou = parte.match(/^\+(\d+)x (.+)$/);
      if (entrou) {
        acrescimos.push({ texto: normalizar(entrou[2]), marca: { tipo: "ACRESCENTADO", quantidade: Number(entrou[1]), quando: r.quando, quem: r.quem } });
      }
    }
  }

  /**
   * As mudanças do item. O acréscimo é gravado com as escolhas junto
   * ("Pastel de carne (catupiry)"), então casa pelo começo do texto.
   */
  const marcasDe = (nome: string | null | undefined): MarcaDoItem[] => {
    if (!nome) return [];
    const chave = normalizar(nome);
    const doAcrescimo = acrescimos.filter((a) => a.texto === chave || a.texto.startsWith(chave + " ")).map((a) => a.marca);
    return [...doAcrescimo, ...(porNome.get(chave) || [])];
  };

  return { marcasDe, removidos };
}

/** "09/10 às 20:13" no fuso da loja. */
export function quandoFoi(iso: string, tz = "America/Sao_Paulo"): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: tz });
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  return `${dia} às ${hora}`;
}

/** O nome da ação, para a lista do histórico. */
export const ROTULO_DA_EDICAO: Record<string, string> = {
  REMOVEU: "Itens",
  MUDOU_QTD: "Itens",
  ACRESCENTOU: "Acréscimo",
  CANCELOU: "Cancelamento",
  PAGAMENTO: "Pagamento",
  TAXA_DE_ENTREGA: "Taxa de entrega",
  DEVOLUCAO_FISCAL: "Nota fiscal",
  TIPO: "Tipo do pedido",
  DESCONTO: "Desconto",
  REPOSICAO: "Reposição",
  CANCELAMENTO_PARCIAL: "Cancelamento parcial",
};
