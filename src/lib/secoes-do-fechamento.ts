/**
 * O QUE SAI NO PAPEL DO FECHAMENTO DE CAIXA — 09/10/2026.
 *
 * O papel do fechamento (lib/cupom-do-caixa.ts) cresceu seção por seção, cada
 * uma pedida por uma loja diferente, e na Divinos Burger passou de um metro de
 * bobina ("muito extenso, gasta muito papel" — Luiz Carlos). O Douglas pediu
 * que a loja escolha o que sai.
 *
 * Gravado em `printerConfig.fechamentoNoPapel` ({ chave: false } desliga).
 * Ausente = tudo ligado, que é o papel de sempre: ninguém perde seção sem ter
 * escolhido. A conferência da gaveta, a diferença e o TOTAL FATURADO saem
 * SEMPRE — são o motivo de o papel existir.
 *
 * Puro de propósito: a tela do caixa (StoreTopNav) e as rotas que imprimem
 * leem a mesma lista.
 */

export const SECOES_DO_FECHAMENTO = [
  { chave: "gaveta", nome: "Dinheiro na gaveta", ajuda: "troco, vendas em dinheiro, reforços e sangrias" },
  { chave: "faturamento", nome: "Faturamento por forma de pagamento", ajuda: "dinheiro, Pix, cartão… (o TOTAL FATURADO sai sempre)" },
  { chave: "porTipo", nome: "Vendas por tipo", ajuda: "um bloco para delivery, retirada, balcão e mesa — o mais comprido" },
  { chave: "porCanal", nome: "Vendas por canal", ajuda: "iFood, 99, site, robô… com as formas de cada um" },
  { chave: "cupons", nome: "Cupons e descontos", ajuda: "quanto foi da loja e quanto das plataformas" },
  { chave: "fiado", nome: "Fiado / conta funcionário", ajuda: "um por um" },
  { chave: "entregadores", nome: "Entregadores", ajuda: "entregas, dinheiro recebido e quanto pagar a cada um" },
  { chave: "cancelados", nome: "Cancelados", ajuda: "um por um, com o número do pedido" },
  { chave: "itensCancelados", nome: "Itens cancelados", ajuda: "item tirado de um pedido: quem tirou, o valor e o motivo" },
  { chave: "deFora", nome: "Ficou de fora do faturamento", ajuda: "aguardando pagamento e mesas abertas" },
  { chave: "maisVendidos", nome: "Mais vendidos", ajuda: "os produtos que mais saíram no turno" },
] as const;

export type ChaveDaSecao = (typeof SECOES_DO_FECHAMENTO)[number]["chave"];
export type SecoesDoFechamento = Record<ChaveDaSecao, boolean>;

/** O papel curto: a conferência, o total e o que o caixa acerta na hora (dinheiro e entregadores). */
export const FECHAMENTO_RESUMIDO: SecoesDoFechamento = {
  gaveta: true,
  faturamento: true,
  porTipo: false,
  porCanal: false,
  cupons: false,
  fiado: true,
  entregadores: true,
  cancelados: false,
  itensCancelados: false,
  deFora: false,
  maisVendidos: false,
};

/** O que a loja escolheu. Chave ausente (ou config que não é objeto) = ligada. */
export function secoesDoFechamento(printerConfig: unknown): SecoesDoFechamento {
  const salvo = (printerConfig as { fechamentoNoPapel?: unknown } | null)?.fechamentoNoPapel;
  const escolha = salvo && typeof salvo === "object" && !Array.isArray(salvo) ? (salvo as Record<string, unknown>) : {};
  const r = {} as SecoesDoFechamento;
  for (const s of SECOES_DO_FECHAMENTO) r[s.chave] = escolha[s.chave] !== false;
  return r;
}
