/**
 * A forma de pagamento do pedido de MESA, como o quadro de Pedidos mostra:
 * no card, no "Ver pedido" e no papel que o botão Imprimir manda.
 *
 * ── O que estava errado (Allan, Delicias de Casa, 17/10/2026) ───────────────
 *
 * "Quando a gente dá baixa nas mesas, elas saem daqui e vão para Pedidos. Na
 * mesa finalizada eu não consigo ver qual foi a forma de pagamento. Em
 * detalhes aparece 'N/A / cobrar na entrega'. E quando imprime não aparece
 * nada referente a isso."
 *
 * A CAUSA: cada rodada lançada na conta da mesa é um pedido que nasce com
 * `paymentMethod: "N/A"` — e é assim de propósito. Uma conta paga em Pix +
 * dinheiro não cabe na forma de UM pedido, e o dinheiro da mesa entra no caixa
 * e nos relatórios só pelas baixas da SESSÃO (`TableSession.paymentMethods`,
 * lib/pagamentos-da-mesa.ts; lib/apuracao-do-turno.ts e
 * lib/relatorios/formas-de-pagamento.ts contam a mesa por lá). O fechamento
 * (api/store/table-sessions/[id]/close) dá as rodadas por ENTREGUE e grava as
 * baixas na sessão, mas o quadro de Pedidos lia só o pedido: "N/A" passava
 * pelo tradutor de forma sem tradução, e o "Ver pedido" — que só conhecia
 * "pago online" e "cobrar na entrega" — completava com "(Cobrar na Entrega)" e
 * "COBRAR DO CLIENTE NA ENTREGA". O papel saía "Forma de Pagamento: na conta
 * da mesa" e mais nada.
 *
 * ── Por que se LÊ da sessão, e não se grava no pedido ───────────────────────
 *
 * Copiar a forma para o `paymentMethod` de cada rodada no fechamento faria o
 * pedido de mesa passar a ter forma própria — e o caixa e o Formas de
 * pagamento, que hoje ignoram a forma do pedido de mesa justamente para não
 * contar a mesa duas vezes, teriam de ser ensinados a ignorá-la de novo. E as
 * mesas já fechadas continuariam "N/A". Lendo da sessão, a fonte é uma só (a
 * mesma do caixa), vale para toda mesa já fechada, e nenhum número muda.
 *
 * O feed do quadro traz o pedaço da sessão que isto lê (`MESA_DO_QUADRO`, em
 * lib/mesa-na-comanda.ts). Pura: roda no navegador e no teste
 * (scripts/teste-historico-de-mesas.ts).
 */
import { emCentavos, emReais, lerPagamentos } from "@/lib/pagamentos-da-mesa";

/** O pedaço da conta da mesa que chega com o pedido no quadro. */
export type ContaNoPedido = {
  status?: string | null;
  paymentMethods?: unknown;
  totalPaid?: number | null;
  closedAt?: Date | string | null;
};

export type PedidoComContaDaMesa = {
  tableSessionId?: string | null;
  tableSession?: ContaNoPedido | null;
};

export type FormaDaMesa = { forma: string; valor: number };

export type PagamentoDaMesaNoPedido =
  /** Conta ainda aberta (ou o feed não trouxe a sessão): a rodada se paga no fechamento. */
  | { situacao: "naConta"; resumo: string; texto: string }
  /** Conta fechada com as baixas gravadas. */
  | { situacao: "paga"; resumo: string; texto: string; formas: FormaDaMesa[]; recebido: number }
  /** Conta fechada antiga, com total pago e sem as baixas: entrou dinheiro, não se sabe por onde. */
  | { situacao: "semForma"; resumo: string; texto: string; recebido: number }
  /** Conta fechada sem pagamento nenhum: mesa liberada sem consumo (ou com tudo cancelado). */
  | { situacao: "liberada"; resumo: string; texto: string };

const brl = (v: number) => `R$ ${(Number(v) || 0).toFixed(2).replace(".", ",")}`;

/**
 * As baixas agrupadas pela forma, na ordem em que entraram: duas baixas de
 * "Dinheiro" (uma por pessoa) viram "Dinheiro R$ 80,00", não duas linhas. O
 * nome é o que o caixa escolheu na tela ("Pix", "Crédito", "Voucher") — é o
 * que o lojista reconhece.
 */
export function formasDasBaixas(bruto: unknown): FormaDaMesa[] {
  const ordem: string[] = [];
  const somas = new Map<string, { forma: string; centavos: number }>();
  for (const b of lerPagamentos(bruto)) {
    const forma = String(b.method || "").replace(/\s+/g, " ").trim() || "Forma não informada";
    const chave = forma.toLocaleLowerCase("pt-BR");
    const atual = somas.get(chave);
    if (atual) atual.centavos += emCentavos(b.amount);
    else { somas.set(chave, { forma, centavos: emCentavos(b.amount) }); ordem.push(chave); }
  }
  return ordem.map((k) => {
    const s = somas.get(k)!;
    return { forma: s.forma, valor: emReais(s.centavos) };
  });
}

/**
 * A forma de pagamento do pedido de mesa. `null` quando o pedido NÃO é de
 * conta de mesa — inclusive a "Mesa 20" lançada no PDV sem conta, que tem a
 * forma gravada nela e segue o caminho de qualquer pedido.
 */
export function pagamentoDaMesaNoPedido(p: PedidoComContaDaMesa | null | undefined): PagamentoDaMesaNoPedido | null {
  if (!p?.tableSessionId) return null;
  const conta = p.tableSession;
  // Sem a sessão no feed não dá para saber se fechou; "na conta da mesa"
  // nunca é mentira — e nunca "cobrar na entrega".
  if (String(conta?.status || "").toUpperCase() !== "CLOSED") {
    return { situacao: "naConta", resumo: "Na conta da mesa", texto: "Na conta da mesa (paga no fechamento)" };
  }
  const formas = formasDasBaixas(conta?.paymentMethods);
  if (formas.length > 0) {
    const recebido = emReais(formas.reduce((s, f) => s + emCentavos(f.valor), 0));
    return {
      situacao: "paga",
      resumo: `Mesa paga: ${formas.map((f) => f.forma).join(" + ")}`,
      texto: formas.map((f) => `${f.forma} ${brl(f.valor)}`).join(" + "),
      formas,
      recebido,
    };
  }
  const pago = Number(conta?.totalPaid) || 0;
  if (pago > 0) {
    return { situacao: "semForma", resumo: "Mesa paga (forma não registrada)", texto: `Mesa paga ${brl(pago)} (forma não registrada)`, recebido: pago };
  }
  return { situacao: "liberada", resumo: "Mesa liberada sem pagamento", texto: "Mesa liberada sem pagamento" };
}

/**
 * Os campos do papel do botão Imprimir para a rodada de mesa JÁ PAGA.
 *
 * O Assistente instalado (1.2.24+) imprime "Forma de Pagamento: na conta da
 * mesa" em todo pedido com `tableSessionId`, sem olhar o `paymentMethod`; o
 * de antes imprimia o `paymentMethod` cru ("N/A") com "(PAGAR NO CAIXA OU NA
 * MESA)". Para o papel dizer como a mesa pagou EM TODA VERSÃO, sem esperar
 * ninguém atualizar o Assistente (a mesma estratégia do pager e do CPF, que
 * entram no nome — lib/mesa-na-comanda.ts):
 *
 * - `paymentMethod` vira o texto das formas, que é o que o Assistente antigo
 *   imprime na linha da forma;
 * - a linha "Mesa paga: Dinheiro R$ 50,00 + Pix R$ 20,00" entra na
 *   observação, que toda versão imprime em tarja antes dos itens. Vai com o
 *   📝 porque, havendo recado marcado com 📝 no pedido, o Assistente imprime
 *   só as linhas marcadas (recadoDoCliente no server.js) — sem a marca, a
 *   linha da mesa sumiria justo no pedido que tem recado.
 *
 * Fora da mesa paga devolve `{}`: a rodada de conta aberta continua saindo
 * "na conta da mesa", que é a verdade dela.
 */
export function camposDoPagamentoDaMesaParaImpressao(
  p: PedidoComContaDaMesa & { notes?: string | null },
): { paymentMethod?: string; notes?: string } {
  const pg = pagamentoDaMesaNoPedido(p);
  if (!pg || pg.situacao === "naConta") return {};
  const linha = `📝 ${pg.situacao === "paga" ? `Mesa paga: ${pg.texto}` : pg.texto}`;
  const recado = String(p.notes || "").trim();
  return { paymentMethod: pg.texto, notes: recado ? `${linha}\n${recado}` : linha };
}
