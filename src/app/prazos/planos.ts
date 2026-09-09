/**
 * As faixas de assinatura e os links de checkout da Cakto.
 *
 * Fica num arquivo SEM "use client" de propósito: a página (servidor) e o
 * seletor (cliente) precisam do mesmo dado. Exportar isto de um módulo
 * marcado como cliente faz o servidor receber `undefined` no lugar do valor
 * — foi o que quebrou o build em 07/09/2026 ("Cannot read properties of
 * undefined (reading 'url')" ao montar /prazos).
 */
export type Plano = { lojas: number; preco: string; centavos: number; url: string };

export const PLANOS: Plano[] = [
  { lojas: 1, preco: "R$ 29,90", centavos: 2990, url: "https://pay.cakto.com.br/5otxn7d_1091761" },
  { lojas: 2, preco: "R$ 39,80", centavos: 3980, url: "https://pay.cakto.com.br/kqn3qtd" },
  { lojas: 3, preco: "R$ 49,70", centavos: 4970, url: "https://pay.cakto.com.br/odfz3a2" },
  { lojas: 5, preco: "R$ 69,50", centavos: 6950, url: "https://pay.cakto.com.br/37ekn8o" },
];

export const CHECKOUT_PADRAO = PLANOS[0].url;
