/**
 * /src/lib/desconto-manual.ts
 *
 * O desconto que a LOJA dá na hora, no balcão ou na mesa, com o motivo escrito.
 * Sem banco e sem rede de propósito: a mesma regra roda na tela (para mostrar o
 * total) e no servidor (para gravar), e é provada por
 * scripts/teste-desconto-manual.mjs.
 *
 * ── Por que o motivo é obrigatório ─────────────────────────────────────────
 *
 * Desconto sem motivo é dinheiro que some do caixa sem explicação. O Douglas
 * pediu o campo junto com o desconto (12/09/2026): no fim do dia, "R$ 15 de
 * desconto" não diz nada; "cliente esperou 40 minutos" diz.
 *
 * ── Onde ele mora depois ───────────────────────────────────────────────────
 *
 * No pedido: `discountTotal` e `discountMerchant` com o valor (é a loja que
 * banca — o caixa não soma de volta) e `discountDetails` com o motivo. O painel
 * já mostra `discountDetails[0].description` no detalhe do pedido, e relatórios
 * e DRE somam `totalAmount`, que já sai descontado.
 */

export type TipoDeDesconto = "VALOR" | "PERCENTUAL";

const emCentavos = (v: number) => Math.round((Number(v) || 0) * 100);
const emReais = (c: number) => Math.round(c) / 100;

/** "10,00" */
export function reaisBR(v: number): string {
  return emReais(emCentavos(v)).toFixed(2).replace(".", ",");
}

/** Lê "10,5", "10.5", "R$ 10,50" e número. Inválido vira 0. */
export function lerNumero(bruto: unknown): number {
  if (typeof bruto === "number") return Number.isFinite(bruto) ? bruto : 0;
  const limpo = String(bruto ?? "").replace(/[^\d.,-]/g, "").trim();
  if (!limpo) return 0;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Quanto sai da conta, em reais, nunca mais que a própria conta e nunca
 * negativo. Percentual é sobre `base` (o consumo, sem taxa nem gorjeta).
 */
export function valorDoDesconto(e: { base: number; tipo: TipoDeDesconto; valor: number }): number {
  const base = Math.max(0, emCentavos(e.base));
  if (base === 0) return 0;
  const bruto =
    e.tipo === "PERCENTUAL"
      ? Math.round((base * Math.min(100, Math.max(0, Number(e.valor) || 0))) / 100)
      : emCentavos(Math.max(0, Number(e.valor) || 0));
  return emReais(Math.min(base, bruto));
}

export type DescontoValidado =
  | { ok: true; semDesconto: true }
  | { ok: true; semDesconto: false; tipo: TipoDeDesconto; informado: number; valor: number; motivo: string }
  | { ok: false; erro: string };

export const MOTIVO_MINIMO = 3;
export const MOTIVO_MAXIMO = 200;

/**
 * Confere o que a tela mandou. Percentual acima de 100 e valor acima da conta
 * são RECUSADOS, não cortados em silêncio: quem digitou 150 queria outra coisa,
 * e gravar "100%" no lugar é decidir por ele.
 */
export function validarDesconto(e: {
  base: number;
  tipo?: unknown;
  valor?: unknown;
  motivo?: unknown;
}): DescontoValidado {
  const tipo: TipoDeDesconto = String(e.tipo || "").toUpperCase() === "PERCENTUAL" ? "PERCENTUAL" : "VALOR";
  const informado = lerNumero(e.valor);
  if (informado === 0) return { ok: true, semDesconto: true };
  if (informado < 0) return { ok: false, erro: "O desconto não pode ser negativo." };

  if (tipo === "PERCENTUAL" && informado > 100) {
    return { ok: false, erro: "O desconto não pode passar de 100%." };
  }
  const base = Math.max(0, Number(e.base) || 0);
  if (tipo === "VALOR" && emCentavos(informado) > emCentavos(base)) {
    return { ok: false, erro: `O desconto (R$ ${reaisBR(informado)}) é maior que a conta (R$ ${reaisBR(base)}).` };
  }

  const motivo = String(e.motivo ?? "").replace(/\s+/g, " ").trim();
  if (motivo.length < MOTIVO_MINIMO) return { ok: false, erro: "Escreva o motivo do desconto." };
  if (motivo.length > MOTIVO_MAXIMO) return { ok: false, erro: `O motivo pode ter até ${MOTIVO_MAXIMO} caracteres.` };

  const valor = valorDoDesconto({ base, tipo, valor: informado });
  if (valor <= 0) return { ok: false, erro: "Não há valor na conta para descontar." };
  return { ok: true, semDesconto: false, tipo, informado, valor, motivo };
}

/** "Desconto: cliente esperou 40 min" ou "Desconto 10%: aniversário" — o rótulo que o painel mostra. */
export function rotuloDoDesconto(e: { tipo: TipoDeDesconto; informado: number; motivo: string }): string {
  const pct = e.tipo === "PERCENTUAL" ? ` ${String(Math.round(e.informado * 100) / 100).replace(".", ",")}%` : "";
  return `Desconto${pct}: ${e.motivo}`;
}

/** A linha de `discountDetails` (mesmo formato das integrações: target, value, sponsor, description). */
export function detalheDoDesconto(e: {
  alvo: "PEDIDO" | "MESA";
  tipo: TipoDeDesconto;
  informado: number;
  valor: number;
  motivo: string;
  por?: string | null;
  em?: Date;
}) {
  return {
    target: e.alvo,
    value: emReais(emCentavos(e.valor)),
    sponsor: "MERCHANT",
    description: rotuloDoDesconto(e),
    motivo: e.motivo,
    tipo: e.tipo,
    ...(e.tipo === "PERCENTUAL" ? { percentual: e.informado } : {}),
    por: e.por || null,
    em: (e.em || new Date()).toISOString(),
  };
}

/**
 * Espalha o desconto da MESA pelos pedidos dela, na proporção do valor de cada
 * um, no centavo. O resto do arredondamento vai para o maior pedido.
 *
 * Por que espalhar: relatórios, DRE e faturamento somam `totalAmount` dos
 * pedidos. Se o desconto ficasse só na sessão da mesa, a loja teria recebido
 * R$ 180 e o relatório diria R$ 200.
 */
export function ratearDesconto(
  pedidos: { id: string; totalAmount: number }[],
  desconto: number
): { id: string; desconto: number; novoTotal: number }[] {
  const totalCentavos = pedidos.reduce((s, p) => s + Math.max(0, emCentavos(p.totalAmount)), 0);
  const descontoCentavos = Math.min(Math.max(0, emCentavos(desconto)), totalCentavos);
  if (pedidos.length === 0 || totalCentavos === 0 || descontoCentavos === 0) {
    return pedidos.map((p) => ({ id: p.id, desconto: 0, novoTotal: emReais(emCentavos(p.totalAmount)) }));
  }

  const partes = pedidos.map((p) => {
    const c = Math.max(0, emCentavos(p.totalAmount));
    return { id: p.id, centavos: c, desconto: Math.floor((descontoCentavos * c) / totalCentavos) };
  });
  let sobra = descontoCentavos - partes.reduce((s, p) => s + p.desconto, 0);
  // O resto vai para o maior pedido — e, se ele não comportar, para o próximo.
  const porTamanho = [...partes].sort((a, b) => b.centavos - a.centavos);
  for (const p of porTamanho) {
    if (sobra <= 0) break;
    const cabe = p.centavos - p.desconto;
    const vai = Math.min(cabe, sobra);
    p.desconto += vai;
    sobra -= vai;
  }
  return partes.map((p) => ({ id: p.id, desconto: emReais(p.desconto), novoTotal: emReais(p.centavos - p.desconto) }));
}
