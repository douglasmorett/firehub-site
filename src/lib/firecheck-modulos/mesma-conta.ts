/**
 * A MESMA CONTA DO FIREHUB NO FIRECHECK
 *
 * Douglas, 30/10/2026: "deveria usar a mesma conta do FireHub, deveria ser só
 * ativar mesmo". Ligou o Checklist ou o Ponto, a conta do FireCheck nasce com
 * o e-mail da loja e entra com a senha do FireHub, sem senha nova:
 *   - no site ou no app do FireCheck, o login de lá pergunta a senha ao FireHub
 *     (api/integracoes/firecheck/senha), que só responde sobre o e-mail da loja
 *     da chave. A senha do FireHub nunca sai daqui, nem como hash: trocou aqui,
 *     vale a nova lá na hora;
 *   - no painel, "Abrir o FireCheck" entra direto: o FireHub pede ao FireCheck
 *     um bilhete de 2 minutos e uso único (com a chave da ligação) e abre o
 *     link abaixo.
 */

/** Mesmo e-mail, sem diferença de maiúscula ou espaço. Vazio nunca confere. */
export function mesmoEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a || "").trim().toLowerCase();
  const y = String(b || "").trim().toLowerCase();
  return !!x && x === y;
}

/**
 * O endereço que entra no FireCheck com o bilhete. Vai depois do "#": o
 * navegador não manda essa parte ao servidor (não cai em log nem em Referer),
 * e a tela de login do FireCheck tira do endereço antes de usar.
 */
export function linkDeEntradaNoFirecheck(urlDoFirecheck: string, bilhete: string): string {
  return `${String(urlDoFirecheck).replace(/\/+$/, "")}/login#firehub=${encodeURIComponent(bilhete)}`;
}
