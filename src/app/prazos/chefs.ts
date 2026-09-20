/**
 * Quem usa e indica o FireHub Prazos — com nome, cara e arroba.
 *
 * Fica num arquivo SEM "use client" porque duas telas servidas pelo servidor
 * leem a mesma lista: o selo do hero em `page.tsx` e os cartões grandes em
 * `QuemJaUsa.tsx`.
 *
 * ── A regra ───────────────────────────────────────────────────────────────
 * Cada campo aqui é conferível: nome e seguidores saem do perfil (conferidos
 * em 19/09/2026), e o acordo de aparecer indicando foi confirmado pelo dono.
 * `frase` é a única coisa que NÃO se inventa: só entra o texto literal que a
 * pessoa mandou, com o mês em `quando`. O cartão funciona sem ela.
 */
export type Chef = {
  nome: string;
  /** Sem o @; vira o link do perfil. */
  arroba: string;
  /** Uma linha: quem é e o que toca. */
  detalhe: string;
  /** Como o Instagram mostra, na data da conferência. */
  seguidores?: string;
  /** O mesmo número, em milhares, para somar o alcance no selo do hero. */
  seguidoresMil?: number;
  /** Foto em /public/prazos/. Sem foto, mostra as iniciais. */
  foto?: string;
  iniciais: string;
  /**
   * A frase LITERAL que a pessoa disse, copiada do WhatsApp. Nunca escreva
   * aqui uma frase "no espírito do que ele falou": no nome de gente real
   * isso é propaganda enganosa (CDC art. 37), e quem tem 145 mil seguidores
   * é perguntado.
   */
  frase?: string;
  quando?: string;
};

export const CHEFS: Chef[] = [
  {
    /**
     * Autorização registrada: grupo "Influenciadores Firehub" no WhatsApp,
     * 19/09/2026, 21h15. O dono perguntou, com estas palavras, "posso colocar
     * o instagram de vocês e um depoimento falando que vocês indicam a
     * extensão?" e o Digão respondeu "Claro irmão" e "Tá meio corrido aqui
     * mais pode ir mandando msg". O print está com o dono — se um dia alguém
     * perguntar, é ele que responde.
     *
     * A frase abaixo foi escrita pela casa sob essa autorização e mandada
     * para ele no grupo. Se ele pedir para trocar qualquer palavra, troque
     * AQUI e no mesmo dia.
     */
    nome: "Digão",
    arroba: "chefdigao",
    detalhe: "Rodrigo Xavier, pizzaiolo · Pizzaria do Digão",
    seguidores: "145 mil seguidores",
    seguidoresMil: 145,
    foto: "/prazos/chef-digao.webp",
    iniciais: "DG",
    frase: "Essa extensão melhorou muito o desempenho da minha loja. Super indico.",
    quando: "setembro de 2026",
  },
  {
    /**
     * É "rafascheef", com dois "e" — "rafaschefe" não existe, e foi o que
     * derrubou o cartão na primeira tentativa. Nome e seguidores conferidos
     * no perfil em 19/09/2026.
     *
     * A pergunta sobre Instagram e depoimento foi feita aos dois no mesmo
     * grupo do WhatsApp; até agora só o Digão respondeu. Por isso este
     * cartão vai SEM aspas: assim que o Rafael mandar a frase dele, cole em
     * `frase` e ponha o mês em `quando`.
     */
    nome: "Rafael Ribeiro",
    arroba: "rafascheef",
    detalhe: "chef de pizzas artesanais · parceiro FireHub",
    seguidores: "109 mil seguidores",
    seguidoresMil: 109,
    foto: "/prazos/chef-rafa.webp",
    iniciais: "RR",
  },
].filter((c) => c.arroba);
