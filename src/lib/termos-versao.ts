/**
 * Versão dos Termos de Uso em vigor. Sem import de servidor: a tela de aceite
 * (client) e a página /termos leem daqui.
 *
 * Mudou o texto de forma relevante (preço, responsabilidade, dados)? Troque a
 * versão: toda conta de dono volta a ver a tela de aceite no próximo acesso ao
 * painel (lib/termos-de-uso.ts). Correção de vírgula não precisa.
 */
export const VERSAO_DOS_TERMOS = "2026-11-21";

/** "04/10/2026" — o que aparece no topo do texto. */
export const DATA_DOS_TERMOS = "21/11/2026";

/**
 * Versões antigas que continuam valendo para quem já aceitou: a de 21/11/2026
 * só ACRESCENTOU o plano pré-pago das contas novas (item 4.0 e 4.10 a 4.16) e
 * não mudou nada para quem já tinha conta. Sem isto, todas as lojas veriam a
 * tela de aceite de novo — e a de 13/11 já travou painel em abertura de sexta.
 * Conta nova aceita no cadastro e grava a versão atual.
 */
export const VERSOES_QUE_CONTINUAM_VALENDO = ["2026-11-13"];
