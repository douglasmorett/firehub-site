/**
 * O papel da ABERTURA e do FECHAMENTO do caixa.
 *
 * ── Por que ele nasce com cara de pedido ───────────────────────────────────
 *
 * O Assistente instalado nas lojas sabe imprimir UMA coisa: um pedido (e a
 * conta da mesa, que também chega nesse formato). Inventar um tipo novo de
 * cupom obrigaria a atualizar o Assistente de todo mundo — e em 18/09/2026
 * quatro das nove lojas ainda estavam em versões de duas semanas atrás, sem
 * atualização automática que resolva (ver firehub-assistente-nao-atualiza-sozinho).
 *
 * Então o cupom do caixa é montado como um pedido: o TÍTULO vai no lugar do
 * número, cada linha da conferência é um ITEM, e o total é o total. Sai
 * legível em qualquer versão, hoje, sem ninguém instalar nada — o mesmo
 * contorno que o número do pager usou.
 *
 * Vai para as impressoras marcadas como "conta da mesa"
 * (lib/impressao-da-conta.ts): é o papel do caixa, e é ali que a loja já
 * escolheu que papel de caixa sai.
 *
 * ── O que cada papel precisa provar ────────────────────────────────────────
 *
 * ABERTURA: quanto tinha na gaveta ao começar. É o número que, se ninguém
 * anotar, vira "sobra" no fechamento seguinte — o operador conta a gaveta
 * inteira e o sistema só conhece as vendas do turno.
 *
 * FECHAMENTO: o esperado ao lado do contado, forma por forma, e a diferença.
 * Sem o lado a lado, "faltou R$ 274,32" não diz em qual forma faltou, e o
 * lojista não tem por onde começar a procurar.
 */

const reais = (v: number | null | undefined) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

export type LinhaDoCaixa = { name: string; qty: number; price: number; notes?: string };

export type ValoresDoFechamento = {
  esperado: { cash: number; debit: number; credit: number; pix: number; voucher: number; total: number };
  contado: { cash: number; debit: number; credit: number; pix: number; voucher: number };
  diferenca: number;
  /** Vendas já pagas fora da gaveta — entram no total, não na conferência. */
  online?: { ifood?: number; food99?: number };
  movimentacoes?: { entradas: number; saidas: number };
  /** Pedidos que estavam na rua e foram dados como entregues no fechamento. */
  finalizadosNoFechamento?: number;
  justificativa?: string | null;
};

function cabecalho(titulo: string, loja: string, quando: Date, fuso: string, operador: string) {
  const dataHora = quando.toLocaleString("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return { titulo, loja, dataHora, operador: operador || "—" };
}

/** O cupom da ABERTURA. `trocoInicial` é o que ficou na gaveta para troco. */
export function cupomDeAberturaDeCaixa(entrada: {
  sessionId: string;
  loja: string;
  fuso: string;
  operador: string;
  abertoEm: Date;
  trocoInicial: number;
  /** Quanto foi CONTADO no fechamento anterior — o confronto que evita sobra falsa. */
  fechamentoAnterior?: { cash: number; em: string | null } | null;
}) {
  const c = cabecalho("ABERTURA DE CAIXA", entrada.loja, entrada.abertoEm, entrada.fuso, entrada.operador);

  const items: LinhaDoCaixa[] = [
    { name: "Troco inicial na gaveta", qty: 1, price: Number(entrada.trocoInicial || 0) },
  ];
  if (entrada.fechamentoAnterior && Number(entrada.fechamentoAnterior.cash) > 0) {
    const diff = Number(entrada.trocoInicial || 0) - Number(entrada.fechamentoAnterior.cash);
    items.push({
      name: "Contado no fechamento anterior",
      qty: 1,
      price: Number(entrada.fechamentoAnterior.cash),
      // Divergir do fechamento anterior não é erro — é informação. Dinheiro
      // pode ter sido retirado no intervalo. Mas tem que estar no papel.
      notes: Math.abs(diff) > 0.01 ? `Diferenca de ${reais(diff)} em relacao ao que foi contado` : undefined,
    });
  }

  return montar({
    id: `caixa_abertura_${entrada.sessionId}`,
    kind: "CAIXA_ABERTURA",
    titulo: c.titulo,
    cabecalho: c,
    items,
    total: Number(entrada.trocoInicial || 0),
    rodape: "Guarde este comprovante. Ele e o ponto de partida da conferencia.",
  });
}

/** O cupom do FECHAMENTO, com esperado x contado lado a lado. */
export function cupomDeFechamentoDeCaixa(entrada: {
  sessionId: string;
  loja: string;
  fuso: string;
  operador: string;
  abertoEm: Date;
  fechadoEm: Date;
  trocoInicial: number;
  valores: ValoresDoFechamento;
}) {
  const c = cabecalho("FECHAMENTO DE CAIXA", entrada.loja, entrada.fechadoEm, entrada.fuso, entrada.operador);
  const v = entrada.valores;

  // Cada forma vira uma LINHA com o esperado na observação: o Assistente
  // imprime `notes` embaixo do item, então o lado a lado cabe no papel estreito
  // sem depender de coluna nova.
  const formas: [string, number, number][] = [
    ["Dinheiro", v.esperado.cash, v.contado.cash],
    ["Debito", v.esperado.debit, v.contado.debit],
    ["Credito", v.esperado.credit, v.contado.credit],
    ["Pix", v.esperado.pix, v.contado.pix],
    ["Vale-refeicao", v.esperado.voucher, v.contado.voucher],
  ];

  const items: LinhaDoCaixa[] = [];
  for (const [nome, esperado, contado] of formas) {
    if (Math.abs(esperado) < 0.01 && Math.abs(contado) < 0.01) continue;
    const d = Number((contado - esperado).toFixed(2));
    items.push({
      name: nome,
      qty: 1,
      price: contado,
      notes:
        `esperado ${reais(esperado)}` +
        (Math.abs(d) > 0.01 ? ` | ${d > 0 ? "sobra" : "falta"} ${reais(Math.abs(d))}` : " | confere"),
    });
  }

  const online = (v.online?.ifood || 0) + (v.online?.food99 || 0);
  if (online > 0) {
    items.push({
      name: "Vendas pagas online",
      qty: 1,
      price: online,
      notes: "Nao passa pela gaveta — entra no total, nao na conferencia",
    });
  }
  if (v.movimentacoes && (v.movimentacoes.entradas > 0 || v.movimentacoes.saidas > 0)) {
    if (v.movimentacoes.entradas > 0) items.push({ name: "Reforcos de caixa", qty: 1, price: v.movimentacoes.entradas });
    if (v.movimentacoes.saidas > 0) items.push({ name: "Sangrias", qty: 1, price: -v.movimentacoes.saidas });
  }

  const rodapeLinhas = [
    `Aberto em ${entrada.abertoEm.toLocaleString("pt-BR", { timeZone: entrada.fuso, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} com ${reais(entrada.trocoInicial)} de troco`,
    `ESPERADO ${reais(v.esperado.total)}  |  DIFERENCA ${reais(v.diferenca)} ${v.diferenca < -0.01 ? "(FALTA)" : v.diferenca > 0.01 ? "(SOBRA)" : "(confere)"}`,
  ];
  if (v.finalizadosNoFechamento && v.finalizadosNoFechamento > 0) {
    rodapeLinhas.push(
      `${v.finalizadosNoFechamento} pedido(s) que estavam na rua foram dados como entregues no fechamento.`
    );
  }
  if (v.justificativa) rodapeLinhas.push(`Justificativa: ${v.justificativa}`);

  const contadoTotal = v.contado.cash + v.contado.debit + v.contado.credit + v.contado.pix + v.contado.voucher + online;

  return montar({
    id: `caixa_fechamento_${entrada.sessionId}`,
    kind: "CAIXA_FECHAMENTO",
    titulo: c.titulo,
    cabecalho: c,
    items,
    total: Number(contadoTotal.toFixed(2)),
    rodape: rodapeLinhas.join("\n"),
  });
}

/**
 * O envelope com cara de pedido.
 *
 * `dailyOrderNumber` carrega o TÍTULO porque é o que sai grande no topo do
 * papel em toda versão do Assistente. `isPrepaid: true` evita o aviso de
 * "COBRAR NA ENTREGA", que não faz sentido nenhum num cupom de caixa.
 */
function montar(e: {
  id: string;
  kind: string;
  titulo: string;
  cabecalho: { loja: string; dataHora: string; operador: string };
  items: LinhaDoCaixa[];
  total: number;
  rodape: string;
}) {
  return {
    id: e.id,
    kind: e.kind,
    dailyOrderNumber: e.titulo,
    customerName: `${e.cabecalho.dataHora} — ${e.cabecalho.operador}`,
    customerPhone: "",
    customerAddress: "",
    deliveryType: "BALCAO",
    source: "CAIXA",
    paymentMethod: "—",
    isPrepaid: true,
    items: e.items,
    totalAmount: e.total,
    deliveryFee: 0,
    notes: e.rodape,
    createdAt: new Date().toISOString(),
  };
}

export type CupomDoCaixa = ReturnType<typeof montar>;
