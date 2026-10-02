/**
 * /src/lib/bebida-da-mesa.ts
 *
 * "Não imprimir as bebidas lançadas na mesa" — opção POR LOJA, desligada por
 * padrão (printerConfig.mesaSemBebidaNaComanda).
 *
 * ── O PEDIDO ───────────────────────────────────────────────────────────────
 *
 * Delícia de Casa (02/10/2026): no salão, quem serve a bebida é o próprio
 * garçom, direto da geladeira. A comanda de produção com "2x Coca Lata" só
 * gasta papel e ainda confunde a cozinha. O dono pediu que a bebida lançada
 * na mesa não saia na comanda; o delivery e o balcão continuam como estão.
 *
 * ── POR QUE NÃO DAVA SÓ COM A TELA DE IMPRESSORAS ──────────────────────────
 *
 * O módulo de uma impressora é "Balcão e mesa" OU "Delivery e retirada"
 * (lib/modulo-do-pedido.ts): balcão e mesa são o MESMO mundo — as duas rotas
 * gravam `source: "PRESENCIAL"`. Tirar a categoria Bebidas da impressora do
 * salão tiraria a bebida também do balcão. E desmarcar a categoria não basta:
 * se nenhuma impressora PEDE "Bebidas", a bebida cai no resgate "de ninguém"
 * (roteamento-de-impressao.ts) e sai em TODAS — a armadilha da NIK de
 * 30/09/2026. Só por configuração, a loja teria de cadastrar uma impressora
 * de mentira pedindo Bebidas. Daí a opção explícita.
 *
 * ── A REGRA ────────────────────────────────────────────────────────────────
 *
 *   - Vale só para a comanda AUTOMÁTICA de pedido lançado numa conta de mesa
 *     (`tableSessionId`): garçom pelo painel, pelo link, pelo celular e o
 *     cliente pelo QR da mesa — todos passam por lib/lancar-na-mesa.ts.
 *     O "Mesa 20" digitado no balcão (sem conta aberta) é balcão: não muda.
 *   - Bebida = a mesma definição do "pedido só de bebida"
 *     (roteamento-de-impressao.ts → itemEhBebida): isBeverage do produto, ou
 *     categoria de bebida, ou o nome quando não há categoria. Na dúvida é
 *     comida — o erro manda papel para a cozinha, nunca some com prato.
 *   - O combo com refrigerante continua inteiro (é comida); só a linha a mais
 *     "Coca (do Combo X)" que iria para a impressora de bebidas sai fora.
 *   - Lançamento só de bebida não gera papel nenhum (nem em branco).
 *   - A CONTA da mesa ("Imprimir comanda", fechamento) não passa por aqui e
 *     continua com as bebidas — é dinheiro, não produção.
 *   - ESCOLHA EXPLÍCITA VENCE: "Selecionar itens para impressão" na mesa
 *     (`selecaoManual`) e o botão Imprimir da tela de pedidos imprimem o que a
 *     pessoa mandou, bebida inclusive. A opção decide o que sai SOZINHO.
 */
import { itemEhBebida, type ItemDoPedido } from "./roteamento-de-impressao";

/** A chave no printerConfig da loja. Ausente = desligada. */
export const CHAVE_MESA_SEM_BEBIDA = "mesaSemBebidaNaComanda";

type ConfigDaLoja = {
  mesaSemBebidaNaComanda?: unknown;
  customBeverageKeywords?: string | string[] | null;
} | null | undefined;

type PedidoDaComanda = {
  source?: unknown;
  tableSessionId?: string | null;
  /** Impressão pedida item a item pelo atendente ("Selecionar itens para impressão"). */
  selecaoManual?: boolean | null;
  totalAmount?: number | null;
  items?: ItemDoPedido[] | null;
};

/** A loja ligou a opção? Só `true` liga: nenhuma loja muda sem marcar. */
export function mesaSemBebidaNaComanda(config: ConfigDaLoja): boolean {
  return config?.mesaSemBebidaNaComanda === true;
}

/** Pedido lançado numa conta de mesa aberta (não o "Mesa 20" do balcão). */
export function ehLancamentoNaMesa(pedido: { tableSessionId?: string | null } | null | undefined): boolean {
  return !!pedido && typeof pedido.tableSessionId === "string" && pedido.tableSessionId.trim() !== "";
}

/**
 * A comanda de produção deste pedido com a regra da opção aplicada.
 *
 *   - Opção desligada, pedido que não é de mesa ou seleção manual → o MESMO
 *     objeto, intocado.
 *   - Senão → cópia sem os itens de bebida (e sem a linha da bebida do combo),
 *     com o total descontado do que saiu: sem isso o papel imprimia um total
 *     maior que a soma dos itens, e o Assistente punha a diferença em "Outros
 *     valores do pedido", que ninguém entende.
 *   - Não sobrou nada (lançamento só de bebida) → `null`: não há papel.
 *
 * `ehBebidaAlem` é para o navegador, cujo item de papel não leva o
 * `isBeverage` do produto (ver GlobalPrintListener): quem chama diz, pela
 * posição, o que o cadastro marcou como bebida.
 */
export function comandaDaMesaSemBebida<P extends PedidoDaComanda>(
  pedido: P,
  config: ConfigDaLoja,
  ehBebidaAlem?: (item: ItemDoPedido, posicao: number) => boolean
): P | null {
  if (!pedido || !mesaSemBebidaNaComanda(config)) return pedido;
  if (!ehLancamentoNaMesa(pedido) || pedido.selecaoManual === true) return pedido;

  const palavras = config?.customBeverageKeywords;
  const itens = pedido.items || [];
  const ehBebida = (item: ItemDoPedido, posicao: number) =>
    itemEhBebida(item, pedido.source, palavras) || (ehBebidaAlem ? ehBebidaAlem(item, posicao) : false);

  let centavosFora = 0;
  let mexeu = false;
  const ficam: ItemDoPedido[] = [];
  itens.forEach((item, posicao) => {
    if (ehBebida(item, posicao)) {
      mexeu = true;
      const qtd = Math.max(1, Number(item?.quantity ?? item?.qty) || 1);
      centavosFora += Math.round((Number((item as { price?: unknown })?.price) || 0) * qtd * 100);
      return;
    }
    // A bebida escolhida dentro do combo continua no combo (é parte do que a
    // cozinha monta); só não vira a linha própria na impressora de bebidas.
    const opcoes = item?.opcoesParaImpressao;
    if (Array.isArray(opcoes) && opcoes.length > 0) {
      const semBebida = opcoes.filter((op) => !itemEhBebida({ name: op.name, category: op.category }, pedido.source, palavras));
      if (semBebida.length !== opcoes.length) {
        mexeu = true;
        ficam.push({ ...item, opcoesParaImpressao: semBebida.length > 0 ? semBebida : null });
        return;
      }
    }
    ficam.push(item);
  });

  if (!mexeu) return pedido;
  if (ficam.length === 0) return null;

  const total = Number(pedido.totalAmount);
  return {
    ...pedido,
    items: ficam,
    ...(Number.isFinite(total) ? { totalAmount: Math.max(0, Math.round(total * 100 - centavosFora) / 100) } : {}),
  } as P;
}
