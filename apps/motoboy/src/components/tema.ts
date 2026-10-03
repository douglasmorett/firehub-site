/**
 * As cores da página web do entregador (/loja/[slug]/motoboy), para o app e a
 * web falarem a mesma língua: azul é a entrega, verde é confirmar e receber,
 * roxo é puxar pedido, âmbar é troco e atenção, vermelho é cancelado.
 */
export const cor = {
  fundo: "#F1F5F9",
  cartao: "#FFFFFF",
  borda: "#E2E8F0",
  bordaForte: "#CBD5E1",
  texto: "#0F172A",
  textoSuave: "#475569",
  textoApagado: "#64748B",
  topo: "#0F172A",
  topoSuave: "#1E293B",

  azul: "#2563EB",
  azulEscuro: "#1D4ED8",
  azulClaro: "#EFF6FF",
  azulBorda: "#BFDBFE",

  verde: "#16A34A",
  verdeEscuro: "#14532D",
  verdeClaro: "#F0FDF4",
  verdeBorda: "#86EFAC",

  roxo: "#7C3AED",
  roxoClaro: "#F5F3FF",
  roxoBorda: "#DDD6FE",

  ambar: "#92400E",
  ambarClaro: "#FFFBEB",
  ambarBorda: "#FDE68A",

  vermelho: "#B91C1C",
  vermelhoClaro: "#FEF2F2",
  vermelhoBorda: "#FECACA",

  whatsapp: "#25D366",
  googleMaps: "#EA4335",
  waze: "#33CCFF",
} as const;

export const raio = { pequeno: 10, medio: 14, grande: 18 } as const;

export const reais = (v: number | null | undefined) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;
