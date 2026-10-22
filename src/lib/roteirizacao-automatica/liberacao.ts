/**
 * Quem vê a Rota 100% automatizada — por enquanto, só a loja do Douglas.
 *
 * Douglas, 21/10/2026 (noite): a Roteirização manual continua no pacote de
 * todo mundo; a AUTOMÁTICA aparece só na Hakim Centro até ele dizer que deu
 * certo. Depois vira módulo pago (R$ 97/mês, 7 dias grátis — plano no vault,
 * §8). Mesma trava da simulação (lib/pedidos-simulados.ts,
 * `ehLojaDeDemonstracao`): lista fixa no código. Fora dela o botão não
 * aparece, a prévia responde 404 e o PUT da regra responde 403.
 *
 * O id é o da LOJA (`ownerId || id`): o funcionário da Hakim também vê.
 *
 * SEM IMPORTS de propósito (o teste e qualquer rota usam sem banco).
 */

/** Hakim Centro (contatohakim@gmail.com, slug hakim-contato). */
const LOJAS_COM_ROTEIRIZACAO_AUTOMATICA = new Set<string>(["cmpx96phr0000ujf0sb0qk5vr"]);

export function liberadaPara(lojaId: string | null | undefined): boolean {
  return !!lojaId && LOJAS_COM_ROTEIRIZACAO_AUTOMATICA.has(lojaId);
}

/**
 * A loja de quem está logado: a do dono quando é funcionário. Recebe a linha
 * do usuário da sessão ({ id, ownerId }), já lida por quem chama.
 */
export function lojaDoUsuario(u: { id: string; ownerId?: string | null } | null | undefined): string | null {
  if (!u) return null;
  return u.ownerId || u.id;
}
