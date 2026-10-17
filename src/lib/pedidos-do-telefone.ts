/**
 * Como o CARDÁPIO acha os pedidos de um telefone — a regra, num lugar só.
 *
 * A mesma busca estava copiada em quatro consultas: "Meus pedidos" do cardápio
 * (api/store-customer GET), o progresso da Trilha Premiada, o prêmio que o
 * pedido recebe (lib/premio-no-pedido.ts) e a ficha do cliente no painel (aba
 * Clientes). Desde 17/10/2026 o Cartão de Carimbos também aplica prêmio no
 * pedido, e todas leem por aqui. Mudou aqui, muda em todas de uma vez.
 *
 * Este arquivo é SEM banco (o painel e o teste importam as constantes); a
 * consulta que roda no Postgres está em lib/pedidos-do-telefone-no-banco.ts e
 * faz exatamente o que `mesmoTelefoneDoCardapio` faz aqui.
 *
 * ── A regra: os 8 últimos DÍGITOS ────────────────────────────────────────────
 *
 * O telefone fica gravado como cada canal escreve: "91991077190" (site),
 * "+55 (91) 8011-9516" (robô do WhatsApp), "(91) 9914-1284" e "9198044-9586"
 * (balcão). Até 17/10/2026 a busca era "o texto gravado CONTÉM os 8 últimos
 * dígitos" — e o hífen da máscara quebrava a sequência: na Pizzaria Lapastine
 * 25 de 79 clientes tinham pedidos fora da trilha e dos carimbos (31 de 102
 * pedidos). Agora compara só os dígitos do gravado, terminando nos 8 últimos
 * do procurado: junta o número com e sem o 9 e com ou sem o 55 (não olha o
 * DDD), como o cashback (lib/cashback-no-banco.ts) já fazia.
 */

/** Quantos pedidos o cardápio carrega em "Meus pedidos". */
export const PEDIDOS_DO_CARDAPIO = 10;

/** Fundo da Trilha Premiada: 120 pedidos cobrem anos de qualquer trilha configurável. */
export const PEDIDOS_DA_TRILHA = 120;

/**
 * Fundo do Cartão de Carimbos: o cartão é contado sobre o histórico (o prêmio
 * sai dele), não sobre os 10 de "Meus pedidos". O mesmo teto do cashback.
 */
export const PEDIDOS_DOS_CARIMBOS = 500;

/** Os 8 últimos dígitos — a chave do cliente. `null` quando não há 8 dígitos. */
export function finalDoTelefone(telefone: string | null | undefined): string | null {
  const digitos = String(telefone || "").replace(/\D/g, "");
  return digitos.length >= 8 ? digitos.slice(-8) : null;
}

/**
 * O telefone GRAVADO no pedido é o PROCURADO? O espelho em JS da consulta do
 * banco (`regexp_replace(customerPhone, '[^0-9]', '', 'g') LIKE '%' || final`):
 * existe para o teste provar as máscaras sem subir banco.
 */
export function mesmoTelefoneDoCardapio(gravado: string | null | undefined, procurado: string | null | undefined): boolean {
  const final = finalDoTelefone(procurado);
  if (!final) return false;
  return String(gravado || "").replace(/\D/g, "").endsWith(final);
}
