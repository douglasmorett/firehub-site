/**
 * LIGA E DESLIGA DOS MÓDULOS PAGOS (Bill, Multimarcas e os próximos) — a regra
 * de quando o módulo está ligado e de quando ele desliga. Sem banco: a tela e
 * as libs de assinatura importam.
 *
 * Douglas, 18/10/2026: "tem que ter a opção de ativar e desativar, tipo um
 * botão de liga e desliga. E quando desativar: tem certeza? Como você já usou,
 * este mês vai ser cobrado. Então ele fica liberado o mês todo e, quando virar
 * o mês, bloqueia sozinho. Cobrar proporcional? Negativo." E, ao ativar:
 * "quando acabar o teste, se tiver período de teste; se não tiver, já cobra o mês".
 *
 * Por isso desligar tem dois caminhos:
 * - dentro do teste grátis: desliga NA HORA e nada é cobrado (o teste não volta);
 * - depois do teste: o mês já está no boleto (inteiro, sem proporcional), então
 *   o módulo continua liberado até o fim do mês e desliga sozinho na virada. O
 *   trecho ligado ganha `ate` = início do mês seguinte (no fuso da loja).
 *
 * "Ligado" sai dos trechos, não de uma coluna: o desligamento marcado para a
 * virada do mês vale sozinho, sem cron.
 */

export type TrechoLigado = { de: string; ate: string | null };

const ms = (v: string | Date) => new Date(v).getTime();

/** Ligado agora: algum trecho já começou e não terminou (sem fim, ou fim no futuro). */
export function ligadoAgora(trechos: TrechoLigado[], agora: Date = new Date()): boolean {
  const t = agora.getTime();
  return trechos.some((p) => ms(p.de) <= t && (!p.ate || ms(p.ate) > t));
}

/** O desligamento já marcado (a virada do mês), se houver: o fim, no futuro, do trecho ligado agora. */
export function desligamentoMarcado(trechos: TrechoLigado[], agora: Date = new Date()): string | null {
  const t = agora.getTime();
  const p = trechos.find((x) => ms(x.de) <= t && x.ate && ms(x.ate) > t);
  return p?.ate ?? null;
}

/**
 * Quando o módulo desliga se o dono desligar agora: dentro do teste grátis, na
 * hora (nada a cobrar); depois do teste, na virada do mês (o mês já está pago).
 */
export function quandoDesliga(testeAte: Date | string | null | undefined, inicioDoProximoMes: Date, agora: Date = new Date()): { naHora: boolean; ate: Date } {
  if (testeAte && ms(testeAte) > agora.getTime()) return { naHora: true, ate: agora };
  return { naHora: false, ate: inicioDoProximoMes };
}
