/**
 * O "Resumo das vendas" do quadro de pedidos (/store/pedidos-clientes) — pela
 * RÉGUA ÚNICA DE VENDA, puro, para a rota /api/store/inicio/resumo-das-vendas
 * e o teste (scripts/teste-resumo-das-vendas.ts).
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Auditoria de 11/10/2026. O resumo era montado no navegador com os pedidos
 * que o quadro tinha na mão e:
 *
 *   - o TOTAL somava, a cada pedido, o cupom pago pela plataforma
 *     (`getChannelDiscount`) — e, no pedido do site, o cupom da PRÓPRIA loja
 *     (desconto sem `discountMerchant` virava "desconto do canal"). Ragnar,
 *     10/10: R$ 15.773,66 no resumo × R$ 14.096,90 de valor vendido; Hakim
 *     Centro: R$ 2.347,27 × R$ 1.883,53;
 *   - o rascunho do robô (CRIANDO_IA) entrava no total;
 *   - as linhas não somavam o total: PRONTO e CRIANDO_IA não tinham linha;
 *   - o período era o dia do CALENDÁRIO em que a tela abriu (meia-noite do
 *     computador), e não virava nunca;
 *   - e só via os pedidos que o quadro carrega — o feed traz no máximo 200, e
 *     a Ragnar lança mais de 300 num sábado.
 *
 * Agora o servidor busca o período inteiro e conta aqui: o TOTAL é o valor
 * vendido dos Relatórios (`entraNaVenda`), cada venda cai em UMA linha (as
 * linhas somam o total), a mesa tem linha própria (o lançamento dela fica
 * "Aceito" até a conta fechar — não é "em preparo"), o cupom que o iFood/99
 * pagou vai numa linha À PARTE e informativa (ele não é pagamento do cliente;
 * a plataforma repassa à loja — `cupomDaPlataforma`, a régua do caixa e do
 * relatório Formas de pagamento), e o número entre parênteses diz o que é:
 * lançamentos.
 */
import { atendimentosDaVenda, cent, ehReposicao, reais, situacaoDoPedido, temValorImpossivel, ticketMedio, type PedidoDaRegua } from "@/lib/relatorios/regua-da-venda";
import { cupomDaPlataforma, type PedidoComCupom } from "@/lib/relatorios/formas-de-pagamento";
import { lerPagamentos } from "@/lib/pagamentos-da-mesa";

/** O que a rota busca: a régua (status, total, itens, mesa, acréscimo), o cupom e o canal. */
export type PedidoDoResumo = PedidoDaRegua & PedidoComCupom & {
  paymentMethods?: unknown;
  deliveryType?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | null;
  openDeliveryOrderId?: string | null;
};

export type ChaveDaLinha = "NOVOS" | "PREPARO" | "PRONTOS" | "TRANSPORTE" | "ENTREGUES" | "MESAS" | "OUTROS";

export type LinhaDoResumo = {
  chave: ChaveDaLinha;
  rotulo: string;
  lancamentos: number;
  valor: number;
  /** Só na linha das mesas: quantas contas. */
  contas?: number;
};

export type ResumoDasVendas = {
  /** Pedido esperando o pagamento cair (totem, Pix): fora do total, com a linha dele. */
  pendentes: { lancamentos: number; valor: number };
  /** As vendas, cada uma numa linha só: a soma das linhas é o total. */
  linhas: LinhaDoResumo[];
  /** O valor vendido dos Relatórios; vendas = atendimentos (a mesa conta uma vez). */
  total: { valor: number; lancamentos: number; vendas: number; ticket: number };
  /** O cupom que o iFood/99 bancou nas vendas: à parte, não entra no total. */
  cupomDaPlataforma: { pedidos: number; valor: number };
  cancelados: { lancamentos: number; valor: number };
  /** Rascunho do robô (CRIANDO_IA): não é venda nem cancelamento. */
  rascunhos: number;
  /** Pedidos de R$ 1 milhão ou mais, fora de toda soma. */
  valoresImpossiveis: number;
};

const ROTULO: Record<ChaveDaLinha, string> = {
  NOVOS: "NOVOS PEDIDOS",
  PREPARO: "EM PREPARO",
  PRONTOS: "PRONTOS",
  TRANSPORTE: "EM TRANSPORTE",
  ENTREGUES: "ENTREGUES",
  MESAS: "NAS MESAS",
  OUTROS: "OUTROS STATUS",
};

/** As linhas que aparecem mesmo zeradas (as de sempre); mesa e "outros", só quando têm. */
const SEMPRE: ChaveDaLinha[] = ["NOVOS", "PREPARO", "PRONTOS", "TRANSPORTE", "ENTREGUES"];
const ORDEM: ChaveDaLinha[] = [...SEMPRE, "MESAS", "OUTROS"];

/** A linha de uma VENDA. A mesa vai inteira para "NAS MESAS", com o status que tiver. */
export function linhaDaVenda(p: { status?: string | null; tableSessionId?: string | null }): ChaveDaLinha {
  if (p.tableSessionId) return "MESAS";
  switch (String(p.status || "").toUpperCase()) {
    case "NOVO": return "NOVOS";
    case "ACEITO": case "PREPARANDO": return "PREPARO";
    case "PRONTO": return "PRONTOS";
    case "SAIU_ENTREGA": return "TRANSPORTE";
    case "ENTREGUE": case "ENCERRADO": return "ENTREGUES";
    default: return "OUTROS";
  }
}

/**
 * O resumo de pedidos JÁ recortados pelo período (pela hora em que o pedido
 * ENTROU, como nos Relatórios). Vêm todos: vendas, cancelados, pendentes e
 * rascunhos — cada um cai no seu lugar.
 */
export function resumoDasVendas(pedidos: PedidoDoResumo[]): ResumoDasVendas {
  const soma = new Map<ChaveDaLinha, { lancamentos: number; c: number; contas: Set<string> }>();
  let cTotal = 0, nTotal = 0;
  let nPend = 0, cPend = 0, nCanc = 0, cCanc = 0, rascunhos = 0, impossiveis = 0;
  let nCupom = 0, cCupom = 0;

  for (const p of pedidos) {
    // Reposição (faltou item / troca) não é venda (regua-da-venda.ts).
    if (ehReposicao(p)) continue;
    if (temValorImpossivel(p)) { impossiveis++; continue; }
    const situacao = situacaoDoPedido(p.status);
    const status = String(p.status || "").toUpperCase();
    if (situacao === "cancelado") { nCanc++; cCanc += cent(p.totalAmount); continue; }
    if (situacao === "naoConcluido") {
      if (status === "AGUARDANDO_PAGAMENTO") { nPend++; cPend += cent(p.totalAmount); }
      else rascunhos++;
      continue;
    }
    const c = cent(p.totalAmount);
    cTotal += c;
    nTotal++;
    const chave = linhaDaVenda(p);
    const s = soma.get(chave) || { lancamentos: 0, c: 0, contas: new Set<string>() };
    s.lancamentos++;
    s.c += c;
    if (p.tableSessionId) s.contas.add(p.tableSessionId);
    soma.set(chave, s);
    // O cupom da plataforma, como no caixa e no Formas de pagamento: o pedido
    // de mesa e o pago em partes no balcão não têm cupom de app.
    if (!p.tableSessionId && lerPagamentos(p.paymentMethods).length === 0) {
      const cupom = cent(cupomDaPlataforma(p));
      if (cupom > 0) { nCupom++; cCupom += cupom; }
    }
  }

  const at = atendimentosDaVenda(pedidos);
  const valor = reais(cTotal);
  return {
    pendentes: { lancamentos: nPend, valor: reais(cPend) },
    linhas: ORDEM.filter((k) => SEMPRE.includes(k) || soma.has(k)).map((chave) => {
      const s = soma.get(chave);
      return {
        chave,
        rotulo: ROTULO[chave],
        lancamentos: s?.lancamentos || 0,
        valor: reais(s?.c || 0),
        ...(chave === "MESAS" ? { contas: s?.contas.size || 0 } : {}),
      };
    }),
    total: { valor, lancamentos: nTotal, vendas: at.vendas, ticket: ticketMedio(valor, at.vendas) },
    cupomDaPlataforma: { pedidos: nCupom, valor: reais(cCupom) },
    cancelados: { lancamentos: nCanc, valor: reais(cCanc) },
    rascunhos,
    valoresImpossiveis: impossiveis,
  };
}

/** "(1 lançamento)" / "(12 lançamentos)". */
export const lancamentosEmTexto = (n: number) => `${n.toLocaleString("pt-BR")} ${n === 1 ? "lançamento" : "lançamentos"}`;
