/**
 * As regras do lanche dos motoboys sem banco — a tela e o servidor fazem a
 * MESMA conta (lib/lanche-da-equipe.ts explica o resto).
 */
/** As lojas que têm a tela. É da Hakim Centro, não do FireHub (Douglas, 11/10/2026). */
export const LOJAS_COM_LANCHE_DA_EQUIPE = new Set(["cmpx96phr0000ujf0sb0qk5vr"]);

export const SOURCE_DO_LANCHE = "EQUIPE";
export const FORMA_DO_LANCHE = "Conta Funcionário (acerto do motoboy)";

export type ConfigDoLanche = {
  ativo: boolean;
  /** R$ por dia, por motoboy, a preço do site. */
  limite: number;
  /** O crédito do dia cobre só 1 bebida; as outras o motoboy paga (Douglas, 16/10/2026). */
  umaBebidaPorDia: boolean;
};

export const LANCHE_PADRAO: ConfigDoLanche = { ativo: false, limite: 22.9, umaBebidaPorDia: false };

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


/** O aviso antes de enviar, com o texto que o Douglas pediu (16/10/2026). */
export const CODIGO_BEBIDA_FORA = "BEBIDA_FORA_DO_CREDITO";
export function avisoDaBebidaFora(valorFora: number): string {
  const v = `R$ ${centavos(valorFora).toFixed(2).replace(".", ",")}`;
  return `Você tem direito a 1 bebida por dia no seu crédito diário. Se passar de uma, vai ter que pagar por fora: ${v} descontados no seu acerto. Você aceita?`;
}

export type ItemNaConta = { preco: number; qtd: number; bebida: boolean };

/**
 * A conta do lanche com a regra da bebida: com `umaBebidaPorDia`, o crédito
 * cobre 1 bebida no dia (`bebidasHoje` = as que já entraram no crédito em
 * pedidos de hoje). Se o pedido tem mais de uma, fica no crédito a MAIS
 * BARATA e as outras vão inteiras para o excedente, mesmo sobrando limite.
 * Bebida dentro de combo não conta: só a bebida pedida solta.
 */
export function contaDoLanche(opts: { itens: ItemNaConta[]; jaUsado: number; limite: number; umaBebidaPorDia: boolean; bebidasHoje: number }) {
  const valor = centavos(opts.itens.reduce((t, i) => t + i.preco * i.qtd, 0));
  const unidades = opts.umaBebidaPorDia
    ? opts.itens.flatMap((i) => (i.bebida ? Array.from({ length: Math.max(0, Math.floor(i.qtd)) }, () => centavos(i.preco)) : [])).sort((a, b) => a - b)
    : [];
  const livres = Math.max(0, 1 - Math.max(0, Math.floor(opts.bebidasHoje || 0)));
  const bebidasNoCredito = Math.min(livres, unidades.length);
  const fora = unidades.slice(bebidasNoCredito);
  const valorDasBebidasFora = centavos(fora.reduce((t, v) => t + v, 0));
  const divisao = dividirNoLimite(opts.jaUsado, valor - valorDasBebidasFora, opts.limite);
  return {
    valor,
    coberto: divisao.coberto,
    excedente: centavos(divisao.excedente + valorDasBebidasFora),
    restanteDepois: divisao.restanteDepois,
    bebidasNoCredito,
    bebidasFora: fora.length,
    valorDasBebidasFora,
  };
}
