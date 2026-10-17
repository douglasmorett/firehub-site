/**
 * QUANDO a comanda sai — a regra num lugar só.
 *
 * ── O que a loja pediu ──────────────────────────────────────────────────────
 *
 * Por padrão a comanda é impressa assim que o pedido entra. Algumas cozinhas
 * querem o contrário: montar o pedido primeiro na tela do KDS e só imprimir
 * quando ele for FINALIZADO lá — o papel vira a etiqueta do que já está pronto
 * para sair, em vez da ordem de produção. É o interruptor
 * `imprimirSoNoFimDoKds` na configuração de impressoras.
 *
 * ── Por que a regra mora aqui e não em cada lugar ───────────────────────────
 *
 * Existem TRÊS caminhos que imprimem sozinhos, e eles não se conhecem:
 *
 *   1. a fila da nuvem (`GET /api/store/print-queue`), que o Assistente
 *      consulta a cada 3 s — funciona com o painel fechado;
 *   2. o `GlobalPrintListener`, em qualquer aba aberta do painel;
 *   3. o poll do próprio painel de pedidos (`StoreOrdersDashboard`).
 *
 * Se um só deles não souber da regra, a comanda sai adiantada por ali e a
 * opção não significa nada — pior, significa "às vezes". O arquivo existe para
 * que os três façam a MESMA pergunta. É o mesmo motivo de lib/canal-do-pedido.ts.
 *
 * ── O risco que esta opção carrega ──────────────────────────────────────────
 *
 * Medido em 16/09/2026: de 16 lojas com movimento, 8 NUNCA finalizaram um
 * pedido no KDS (a TAURUS tem 1.066 pedidos e 0 finalizações). Numa loja
 * assim, ligar isto faz a impressão parar por completo — e o sintoma é
 * "a impressora parou", que manda o lojista procurar defeito no lugar errado.
 *
 * Daí duas decisões deste arquivo:
 *   - o padrão é DESLIGADO, e ausente conta como desligado;
 *   - `motivoDaEspera()` devolve a frase pronta para a tela e para o log, para
 *     que "não imprimiu" sempre venha acompanhado do porquê.
 */

/** O pedaço da configuração de impressoras que interessa aqui. */
export type ConfigDeMomento = {
  imprimirSoNoFimDoKds?: boolean;
} | null | undefined;

/** O pedido, com o que basta para decidir. */
export type PedidoParaMomento = {
  kdsStage?: string | null;
  status?: string | null;
};

/** O KDS considera o pedido pronto. É o único estado que libera a impressão. */
const FINALIZADO_NO_KDS = "FINISHED";

/**
 * A loja pediu para segurar a comanda até o KDS finalizar?
 * Ausente = não, que é como toda loja funcionava antes desta opção existir.
 */
export function esperaOFimDoKds(config: ConfigDeMomento): boolean {
  return config?.imprimirSoNoFimDoKds === true;
}

/**
 * true = a comanda NÃO deve sair agora; o pedido ainda está na cozinha.
 *
 * Só olha o KDS. Cancelado, rascunho e afins continuam sendo barrados onde já
 * eram — cada caminho tem a sua lista, e duplicá-la aqui só criaria uma
 * segunda régua para ficar fora de sincronia.
 */
export function aguardandoFimDoKds(
  pedido: PedidoParaMomento | null | undefined,
  config: ConfigDeMomento
): boolean {
  if (!esperaOFimDoKds(config)) return false;
  if (!pedido) return false;
  return String(pedido.kdsStage || "").toUpperCase() !== FINALIZADO_NO_KDS;
}

/**
 * A frase que explica a espera, para a tela e para o log. Nula quando não há
 * espera nenhuma.
 *
 * "Não saiu comanda" é o tipo de sintoma que faz o lojista trocar cabo, trocar
 * impressora e ligar reclamando. Se a causa é uma opção que ele mesmo ligou,
 * isso tem que estar escrito em algum lugar que ele alcança.
 */
export function motivoDaEspera(
  pedido: PedidoParaMomento | null | undefined,
  config: ConfigDeMomento
): string | null {
  if (!aguardandoFimDoKds(pedido, config)) return null;
  return "A comanda sai quando a cozinha finalizar o pedido no KDS (opção ligada em Impressoras).";
}

/**
 * Chave do localStorage que a tela de Impressoras toca ao salvar. As abas do
 * painel abertas no MESMO navegador ouvem o evento `storage` e releem a
 * configuração na hora; em outro computador, a releitura periódica (60 s)
 * pega a mudança. Antes, o GlobalPrintListener lia a configuração uma vez só,
 * ao abrir: a Pizzaria 17 ligou "imprimir só quando o KDS finalizar" em
 * 05/10/2026 e a aba aberta antes disso seguia imprimindo na chegada.
 */
export const AVISO_DE_CONFIG_SALVA = "firehub:config-de-impressao-salva";

/** De quanto em quanto tempo as abas abertas releem a configuração de impressão. */
export const RELEITURA_DA_CONFIG_MS = 60 * 1000;

/* ═══════════════════════════════════════════════════════════════════════════
   A IMPRESSORA FORA DO KDS (Ragnar Burger, 16/10/2026)

   A loja liga `imprimirSoNoFimDoKds` porque a COZINHA trabalha na tela: o papel
   dela é a etiqueta do que ficou pronto. Mas o BAR trabalha no papel — "a
   impressora do Bar, eu não quero que passe pelo KDS". Com a regra valendo
   para o pedido inteiro, o drink só saía quando a cozinha finalizava o pedido:
   o "Ruby" da mesa (pedido só de drink, que nenhuma tela produz) nunca saiu, e
   o drink que veio junto do burger saiu 7 min depois, com o burger pronto.
   Medido em 16/10: 12 rodadas de mesa só de bar sem papel; em 14 dias, 38
   pedidos de mesa só de drink e 27 de drink com comida.

   A impressora marcada `foraDoKds` imprime na CHEGADA, como se a opção da loja
   estivesse desligada para ela. O pedido passa a ter dois papéis:
     - o da chegada, só nas impressoras fora do KDS, num job à parte
       ("<pedido>-na-chegada"), carimbado em `printedNaChegadaAt` pelo /ack;
     - o principal, nas outras, quando o KDS finaliza — sem a do bar, que já
       imprimiu.
   Pedido que só tem item das impressoras fora do KDS (a rodada de drinks) sai
   inteiro na chegada, pelo papel principal: não há o que esperar.

   Só a fila da nuvem separa os dois momentos (é ela que tem o carimbo no
   banco). O navegador, nesse modo, deixa a comanda automática para a fila —
   imprimindo o pedido finalizado, ele mandaria o drink de novo ao bar.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Sufixo do job do papel da chegada (o /ack carimba `printedNaChegadaAt`). */
export const SUFIXO_DA_CHEGADA = "-na-chegada";

/** A impressora imprime na chegada mesmo com a loja esperando o KDS. */
export function impressoraForaDoKds(impressora: { foraDoKds?: boolean | null } | null | undefined): boolean {
  return impressora?.foraDoKds === true;
}

/**
 * A loja espera o KDS E tem impressora fora dele: o papel tem dois momentos.
 * Sem impressora marcada, é exatamente a regra de antes.
 */
export function papelEmDoisMomentos(
  config: (NonNullable<ConfigDeMomento> & { printers?: unknown }) | null | undefined
): boolean {
  if (!esperaOFimDoKds(config)) return false;
  const impressoras = Array.isArray(config?.printers) ? (config!.printers as any[]) : [];
  return impressoras.some((p) => impressoraForaDoKds(p));
}

/**
 * O navegador (GlobalPrintListener e tela de pedidos) segura a comanda
 * automática deste pedido? Espera o KDS como sempre, e no modo de dois
 * momentos deixa tudo para a fila da nuvem (ver o bloco acima).
 */
export function navegadorSeguraAComanda(
  pedido: PedidoParaMomento | null | undefined,
  config: (NonNullable<ConfigDeMomento> & { printers?: unknown }) | null | undefined
): boolean {
  return aguardandoFimDoKds(pedido, config) || papelEmDoisMomentos(config);
}

export type PlanoDoPapel<D> = {
  /** Destinos do papel principal, que sai AGORA. null = ainda espera o KDS. */
  agora: D[] | null;
  /** Destinos do papel da chegada (job com SUFIXO_DA_CHEGADA). Vazio = nenhum. */
  naChegada: D[];
  /** O pedido não tem item de impressora fora do KDS: a chegada está resolvida sem papel. */
  chegadaSemPapel: boolean;
};

/**
 * O que sai agora deste pedido, dado para onde ele vai (`destinos`, já
 * roteados por categoria com TODAS as impressoras — o roteamento não muda).
 */
export function planoDoPapel<D>(
  pedido: (PedidoParaMomento & { printedNaChegadaAt?: Date | string | null }) | null | undefined,
  config: ConfigDeMomento,
  destinos: D[],
  foraDoKds: (destino: D) => boolean
): PlanoDoPapel<D> {
  const espera = aguardandoFimDoKds(pedido, config);
  if (!esperaOFimDoKds(config)) return { agora: destinos, naChegada: [], chegadaSemPapel: false };
  const fora = destinos.filter(foraDoKds);
  const resto = destinos.filter((d) => !foraDoKds(d));
  // Nada é do bar: a regra de sempre (espera o KDS).
  if (fora.length === 0) return { agora: espera ? null : destinos, naChegada: [], chegadaSemPapel: true };
  // Tudo é do bar (a rodada de drinks): sai inteiro agora.
  if (resto.length === 0) return { agora: destinos, naChegada: [], chegadaSemPapel: false };
  // Misto: o bar na chegada (uma vez só), a cozinha no fim do KDS.
  return {
    agora: espera ? null : resto,
    naChegada: pedido?.printedNaChegadaAt ? [] : fora,
    chegadaSemPapel: false,
  };
}
