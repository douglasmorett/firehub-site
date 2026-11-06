/**
 * Quem vê a Rota 100% automatizada — desde a Fase 4 (05/11/2026), TODAS as
 * lojas.
 *
 * Até aqui era uma lista fixa no código (Hakim Centro, a loja de demonstração
 * e a Pizzaria Bom Cheff), no padrão da simulação (lib/pedidos-simulados.ts,
 * `ehLojaDeDemonstracao`): fora dela o botão não aparecia, a prévia respondia
 * 404 e o PUT da regra 403. Douglas, 05/11/2026: a rota automática vira
 * módulo pago para todo mundo — R$ 97/mês, 7 dias grátis, pela mecânica dos
 * outros módulos pagos (plano no vault, §8).
 *
 * Por isso `liberadaPara` agora vale para qualquer loja (a função fica, para
 * não mexer em quem chama). Quem decide se a rota automática AGE numa loja
 * deixou de ser esta lista: é a assinatura (./assinatura.ts — trecho ligado,
 * ou loja isenta) junto com a regra ligada. A Hakim Centro e a loja de
 * demonstração seguem sem pagar: são isentas lá. A Bom Cheff, que entrou sem
 * cobrança em 05/11, ganha lá o teste de 7 dias (`LOJAS_LIGADAS_ANTES_DO_MODULO_PAGO`).
 *
 * O id é o da LOJA (`ownerId || id`): o funcionário também vê.
 *
 * SEM IMPORTS de propósito (o teste e qualquer rota usam sem banco).
 */

export function liberadaPara(lojaId: string | null | undefined): boolean {
  return !!lojaId;
}

/**
 * A loja de quem está logado: a do dono quando é funcionário. Recebe a linha
 * do usuário da sessão ({ id, ownerId }), já lida por quem chama.
 */
export function lojaDoUsuario(u: { id: string; ownerId?: string | null } | null | undefined): string | null {
  if (!u) return null;
  return u.ownerId || u.id;
}
