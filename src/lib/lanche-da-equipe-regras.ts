/**
 * As regras do lanche dos motoboys sem banco — a tela e o servidor fazem a
 * MESMA conta (lib/lanche-da-equipe.ts explica o resto).
 */
import { normalizarEscolhas, type EscolhasDoCombo } from "@/lib/preco-combo";

/** As lojas que têm a tela. É da Hakim Centro, não do FireHub (Douglas, 11/10/2026). */
export const LOJAS_COM_LANCHE_DA_EQUIPE = new Set(["cmpx96phr0000ujf0sb0qk5vr"]);

export const SOURCE_DO_LANCHE = "EQUIPE";
export const FORMA_DO_LANCHE = "Conta Funcionário (acerto do motoboy)";

export type ConfigDoLanche = {
  ativo: boolean;
  /** R$ por dia, por motoboy, a preço do site. */
  limite: number;
  /** O crédito do dia cobre só 1 bebida; as outras o motoboy paga (Douglas, 16/10/2026: "deixa ligada no Hakim" — vem ligada). */
  umaBebidaPorDia: boolean;
};

export const LANCHE_PADRAO: ConfigDoLanche = { ativo: false, limite: 22.9, umaBebidaPorDia: true };

const centavos = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

export function lerConfigDoLanche(bruto: unknown): ConfigDoLanche {
  const cfg = { ...LANCHE_PADRAO };
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
    const o = bruto as Record<string, unknown>;
    if (typeof o.ativo === "boolean") cfg.ativo = o.ativo;
    if (typeof o.umaBebidaPorDia === "boolean") cfg.umaBebidaPorDia = o.umaBebidaPorDia;
    const limite = Number(o.limite);
    if (o.limite != null && Number.isFinite(limite) && limite >= 0) cfg.limite = Math.min(500, centavos(limite));
  }
  return cfg;
}

const semAcento = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** A "Promoção do Dia" (a isca de R$ 1,90): pela categoria ou pela etiqueta. */
export function ehPromocaoDoDia(produto: { category?: string | null; tags?: unknown }): boolean {
  if (semAcento(produto.category) === "promocao do dia") return true;
  let tags: unknown = produto.tags;
  if (typeof tags === "string") {
    try { tags = JSON.parse(tags); } catch { tags = [tags]; }
  }
  return Array.isArray(tags) && tags.some((t) => semAcento(t) === "promocao do dia");
}

/**
 * Quanto deste pedido cabe no limite do dia e quanto passa.
 * `jaUsado` = o que o motoboy já pediu hoje (pedidos não cancelados).
 */
export function dividirNoLimite(jaUsado: number, valor: number, limite: number): { coberto: number; excedente: number; restanteDepois: number } {
  const livre = Math.max(0, centavos(limite) - centavos(jaUsado));
  const coberto = centavos(Math.min(livre, Math.max(0, valor)));
  const excedente = centavos(Math.max(0, valor) - coberto);
  return { coberto, excedente, restanteDepois: centavos(livre - coberto) };
}

/** O aviso antes de enviar, com o texto que o Douglas pediu (16/10/2026): a bebida a mais vai para o fiado dele. */
export const CODIGO_BEBIDA_FORA = "BEBIDA_FORA_DO_CREDITO";
export function avisoDaBebidaFora(valorFora: number): string {
  const v = `R$ ${centavos(valorFora).toFixed(2).replace(".", ",")}`;
  return `Você tem direito a 1 bebida por dia no seu crédito diário. Se passar de uma, vai ter que pagar por fora: ${v} vão para o seu fiado. Você aceita?`;
}

/**
 * As bebidas da loja, para achar a bebida solta (pelo id) e a de dentro do
 * combo (pelo nome da escolha: o "Guaravita 280ml" do "3 Clássicas +
 * Guaravita"), com o preço da bebida vendida solta. Montado no servidor
 * (lib/lanche-da-equipe.ts, bebidasDoCardapio) e mandado igual para a tela.
 */
export type BebidasDoCardapio = { porId: Record<string, number>; porNome: Record<string, number> };

export const chaveDaBebida = (nome: unknown) => semAcento(nome).replace(/\s+/g, " ");

/**
 * As bebidas que UMA unidade do item leva, cada uma pelo preço que conta:
 * bebida solta = o preço do item; bebida escolhida no combo = o preço dela
 * solta ("Guaravita dentro do combo conta como a bebida" — Douglas, 16/10/2026).
 */
export function bebidasDoItem(item: { menuProductId: string; preco: number; comboSelections?: unknown }, mapa: BebidasDoCardapio | null | undefined): number[] {
  if (!mapa) return [];
  if (mapa.porId[item.menuProductId] != null) return [centavos(item.preco)];
  const saida: number[] = [];
  for (const e of normalizarEscolhas(item.comboSelections as EscolhasDoCombo)) {
    const preco = mapa.porNome[chaveDaBebida(e.nome)];
    if (preco == null) continue;
    for (let k = 0; k < Math.min(20, Math.floor(e.qtd)); k++) saida.push(centavos(preco));
  }
  return saida;
}

/** `bebidas` = o preço de cada bebida de UMA unidade do item (bebidasDoItem). */
export type ItemNaConta = { preco: number; qtd: number; bebidas: number[] };

/**
 * A conta do lanche com a regra da bebida: com `umaBebidaPorDia`, o crédito
 * cobre 1 bebida no dia (`bebidasHoje` = as que já entraram no crédito em
 * pedidos de hoje), solta ou dentro do combo. Se o pedido tem mais de uma,
 * fica no crédito a MAIS BARATA e as outras saem do crédito inteiras, mesmo
 * sobrando limite: vão para o FIADO do motoboy (`valorDasBebidasFora`).
 * `excedente` é só o que passou do limite em R$ — o desconto do acerto.
 */
export function contaDoLanche(opts: { itens: ItemNaConta[]; jaUsado: number; limite: number; umaBebidaPorDia: boolean; bebidasHoje: number }) {
  const valor = centavos(opts.itens.reduce((t, i) => t + i.preco * i.qtd, 0));
  const unidades = opts.umaBebidaPorDia
    ? opts.itens
        .flatMap((i) => Array.from({ length: Math.max(0, Math.floor(i.qtd)) }, () => i.bebidas || []).flat())
        .map(centavos)
        .sort((a, b) => a - b)
    : [];
  const livres = Math.max(0, 1 - Math.max(0, Math.floor(opts.bebidasHoje || 0)));
  const bebidasNoCredito = Math.min(livres, unidades.length);
  const fora = unidades.slice(bebidasNoCredito);
  const valorDasBebidasFora = centavos(Math.min(valor, fora.reduce((t, v) => t + v, 0)));
  const divisao = dividirNoLimite(opts.jaUsado, valor - valorDasBebidasFora, opts.limite);
  return {
    valor,
    coberto: divisao.coberto,
    excedente: divisao.excedente,
    restanteDepois: divisao.restanteDepois,
    bebidasNoCredito,
    bebidasFora: fora.length,
    valorDasBebidasFora,
  };
}
