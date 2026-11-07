/**
 * SAÍDAS DE ESTOQUE POR MOTIVO — o "Saídas" do SWFast: tudo o que saiu da
 * prateleira SEM ser venda, agrupado por motivo, com o custo.
 *
 * Entram (lib/cmv/desperdicio.ts e a saída manual):
 *   - a perda de produto e de insumo da aba Perdas e descarte, o
 *     Movimentar › Perda, o descarte pelo QR da etiqueta e o do FireCheck;
 *   - o pedido cancelado que a cozinha já tinha feito;
 *   - a Saída manual (Movimentar › Saída, o "uso" pelo QR, o Bill).
 *
 * O motivo é texto livre em todo lugar (o funcionário escreve "caiu no
 * chão", "venceu", "lanche do motoboy"). Aqui ele vira categoria pelas
 * palavras — e a tela do Movimentar ganhou os botões de motivo, que escrevem
 * o rótulo da categoria no começo da observação, para a classificação não
 * depender de adivinhar.
 *
 * Puro. Testado em scripts/teste-estoque-relatorios.ts.
 */
import { c2 } from "@/lib/relatorios/base";

export type MotivoDaSaida = "vencido" | "quebra" | "consumoInterno" | "cancelado" | "devolucao" | "outro";

/** Os motivos, na ordem dos botões. `palavras` sem acento, minúsculas. */
export const MOTIVOS_DE_SAIDA: { chave: MotivoDaSaida; rotulo: string; palavras: string[] }[] = [
  { chave: "vencido", rotulo: "Vencido / estragou", palavras: ["venc", "validade", "estrag", "mofo", "mofad", "azed", "podre", "deterior"] },
  { chave: "quebra", rotulo: "Quebra / caiu / queimou", palavras: ["quebr", "caiu", "cair", "derrub", "queim", "errad", "rasg", "fur", "derram", "acidente"] },
  { chave: "consumoInterno", rotulo: "Consumo interno", palavras: ["consumo interno", "uso interno", "funcionari", "equipe", "refeicao", "staff", "motoboy", "degust", "cortesia", "brinde", "lanche do"] },
  { chave: "devolucao", rotulo: "Devolução ao fornecedor", palavras: ["devolu", "fornecedor", "troca"] },
  { chave: "cancelado", rotulo: "Pedido cancelado já feito", palavras: [] },
  { chave: "outro", rotulo: "Outro motivo", palavras: [] },
];

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A categoria pelo texto do motivo. Sem palavra conhecida: "outro". */
export function motivoDaSaida(texto: string | null | undefined): MotivoDaSaida {
  const t = semAcento(String(texto || ""));
  if (!t.trim()) return "outro";
  for (const m of MOTIVOS_DE_SAIDA) if (m.palavras.some((p) => t.includes(p))) return m.chave;
  return "outro";
}

export type SaidaLancada = {
  quando: string;
  item: string;
  tipo: "PRODUTO" | "INSUMO";
  quantidade: number | null;
  unidade: string | null;
  motivoTexto: string | null;
  quem: string | null;
  /** "Perda" (aba Perdas, Movimentar, QR), "FireCheck", "Saída manual", "Cancelado". */
  origem: string;
  valor: number | null;
  /** Força a categoria (o cancelado já produzido). */
  motivo?: MotivoDaSaida;
};

export type LinhaDaSaida = SaidaLancada & { motivo: MotivoDaSaida };

export function saidasPorMotivo(saidas: SaidaLancada[]) {
  const linhas: LinhaDaSaida[] = saidas
    .map((s) => ({ ...s, motivo: s.motivo ?? motivoDaSaida(s.motivoTexto) }))
    .sort((a, b) => b.quando.localeCompare(a.quando));
  const porMotivo = MOTIVOS_DE_SAIDA.map((m) => {
    const doMotivo = linhas.filter((l) => l.motivo === m.chave);
    return {
      motivo: m.chave, rotulo: m.rotulo, lancamentos: doMotivo.length,
      valor: c2(doMotivo.reduce((s, l) => s + (l.valor || 0), 0)),
      semValor: doMotivo.filter((l) => l.valor == null).length,
    };
  }).filter((m) => m.lancamentos > 0).sort((a, b) => b.valor - a.valor);

  // O que mais se perde, pelo nome do item.
  const porItem = new Map<string, { item: string; unidade: string | null; lancamentos: number; quantidade: number; valor: number }>();
  for (const l of linhas) {
    const k = `${semAcento(l.item)}|${l.unidade || ""}`;
    let x = porItem.get(k);
    if (!x) { x = { item: l.item, unidade: l.unidade, lancamentos: 0, quantidade: 0, valor: 0 }; porItem.set(k, x); }
    x.lancamentos++;
    x.quantidade = Math.round((x.quantidade + (l.quantidade || 0)) * 1000) / 1000;
    x.valor = c2(x.valor + (l.valor || 0));
  }
  const total = c2(linhas.reduce((s, l) => s + (l.valor || 0), 0));
  return {
    linhas,
    porMotivo,
    itens: [...porItem.values()].sort((a, b) => b.valor - a.valor || b.lancamentos - a.lancamentos).slice(0, 15),
    totais: { valor: total, lancamentos: linhas.length, semValor: linhas.filter((l) => l.valor == null).length },
  };
}

export type ResultadoDasSaidas = ReturnType<typeof saidasPorMotivo>;
