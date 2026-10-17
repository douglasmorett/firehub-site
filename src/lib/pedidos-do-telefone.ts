/**
 * Como o CARDÁPIO acha os pedidos de um telefone — num lugar só.
 *
 * A mesma busca estava copiada em três consultas: "Meus pedidos" do cardápio
 * (api/store-customer GET — é sobre essa lista que o cartão de carimbos é
 * contado), o progresso da Trilha Premiada que o cardápio mostra (mesma rota) e
 * o prêmio que o pedido recebe (lib/premio-no-pedido.ts). Desde 16/10/2026 a
 * ficha do cliente no painel (aba Clientes) mostra a trilha e os carimbos, e o
 * número dela só é o que o cliente vê se a busca for a MESMA. Mudou aqui, muda
 * nas quatro de uma vez.
 *
 * ── O que esta busca acha (e o que não acha) ─────────────────────────────────
 *
 * "O telefone gravado CONTÉM os 8 últimos dígitos": junta o número com e sem o
 * 9 e com ou sem o 55, e não olha o DDD. NÃO acha o telefone gravado com
 * máscara — "+55 (91) 8011-9516" (robô do WhatsApp), "(91) 9914-1284" (balcão):
 * o hífen quebra a sequência dos dígitos. É o comportamento de hoje do cardápio
 * e do prêmio da trilha; corrigir aqui muda o número que o cliente vê e o
 * prêmio que ele recebe, então é decisão de produto, não detalhe de consulta.
 * A aba Clientes junta pela chave DDD + 8 dígitos (lib/clientes-da-loja-regras.ts)
 * e acha os dois — por isso o "Pedidos" da ficha pode ser maior que a trilha.
 */
import type { Prisma } from "@prisma/client";

/** Quantos pedidos o cardápio carrega em "Meus pedidos" — e sobre eles conta os carimbos. */
export const PEDIDOS_DO_CARDAPIO = 10;

/** Fundo da Trilha Premiada: 120 pedidos cobrem anos de qualquer trilha configurável. */
export const PEDIDOS_DA_TRILHA = 120;

/** Os pedidos deste telefone nesta loja, do jeito que o cardápio procura. */
export function ondeEstaoOsPedidosDoTelefone(franchiseeId: string, telefone: string): Prisma.CustomerOrderWhereInput {
  const digitos = String(telefone || "").replace(/\D/g, "");
  return {
    franchiseeId,
    OR: [{ customerPhone: { contains: digitos.slice(-8) } }, { customerPhone: digitos }],
  };
}
