/**
 * PARA ONDE A TELA VAI quando a nuvem some (Modo Contingência) — a regra,
 * sem navegador, para o teste (scripts/teste-contingencia.ts). Quem usa é
 * components/contingencia/TrocaDeContingencia.tsx.
 *
 * Uma página https não consegue "testar" o endereço http do computador da
 * loja antes de ir (o navegador bloqueia o fetch misto): ela vai às cegas. E
 * se o computador estiver desligado, a tela cai na página de erro do Chrome e
 * FICA lá — mesmo depois de a nuvem voltar. Visto em 12/10: num deploy à
 * noite, com o PC do caixa desligado, a TV do KDS ficaria presa no erro até
 * alguém mexer.
 *
 * Por isso:
 *   - no computador que HOSPEDA a contingência, quem decide é o Assistente
 *     dele (alcançável daqui): só vai quando o FireHub local está pronto;
 *     ainda subindo, espera a próxima conferência;
 *   - nos outros aparelhos (TV, garçom, outro PC), só vai se o computador da
 *     loja estava vivo no último sinal da nuvem (`pc` do /api/contingencia/
 *     sinal: o supervisor falou com a nuvem há pouco). Desligado, a tela fica
 *     onde está e volta sozinha com a nuvem, como antes da contingência.
 */
export type SituacaoDaTroca = {
  /** O Assistente DESTE computador tem a contingência ativada (é o computador da loja). */
  contingenciaAqui: boolean;
  /** O endereço do FireHub local, se o Assistente diz que está pronto. */
  enderecoNoAssistente: string | null;
  /** O último sinal da nuvem disse que o computador da loja está vivo (sem sinal ainda: true). */
  pcVivo: boolean;
  /** Os endereços do computador da loja na rede, do bilhete. */
  enderecos: string[];
};

/** O endereço para onde ir agora, ou null para ficar e conferir de novo. */
export function destinoDaTroca(s: SituacaoDaTroca): string | null {
  if (s.contingenciaAqui) return s.enderecoNoAssistente;
  if (!s.pcVivo) return null;
  return s.enderecos[0] || null;
}
