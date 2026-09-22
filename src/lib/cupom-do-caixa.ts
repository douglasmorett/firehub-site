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

// Com separador de milhar: num fechamento os numeros sao grandes, e
// "R$ 12345,67" num papel de 48 colunas e lido errado por quem esta com
// pressa. O resto da comanda nao usa milhar porque la os valores sao de um
// item so.
const reais = (v: number | null | undefined) =>
  `R$ ${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type LinhaDoCaixa = { name: string; qty: number; price: number; notes?: string };

/**
 * Uma linha do RELATÓRIO — o formato que o Assistente 1.2.19+ imprime como
 * relatório de caixa, em vez de fingir que é um pedido.
 *
 * `titulo` vira cabeçalho de bloco, `destaque` sai dobrado (é a linha que a
 * pessoa procura no papel), `linha` é rótulo à esquerda e valor à direita, e
 * `texto` é frase corrida. Versão antiga do Assistente ignora o campo inteiro
 * e imprime `items` como sempre — ninguém fica sem papel por estar atrasado.
 */
export type LinhaDoRelatorio =
  | { tipo: "separador" }
  | { tipo: "titulo"; texto: string }
  | { tipo: "texto"; texto: string }
  | { tipo: "linha"; texto: string; valor: string; nota?: string }
  | { tipo: "destaque"; texto: string; valor: string; nota?: string };

/** O retrato do turno. Nada aqui entra em conta — é tudo informação. */
export type DetalheDoTurno = {
  qtdPedidos: number;
  vendaBruta: number;
  ticketMedio: number;
  taxaEntregaTotal: number;
  descontoDaLoja: number;
  porCanal: { nome: string; qtd: number; valor: number }[];
  movimentacoes: { tipo: string; valor: number; descricao: string | null; hora: Date | string }[];
  cancelados: { qtd: number; valor: number };
};

export type ValoresDoFechamento = {
  esperado: { cash: number; debit: number; credit: number; pix: number; voucher: number; total: number };
  contado: { cash: number; debit: number; credit: number; pix: number; voucher: number };
  diferenca: number;
  /** Vendas já pagas fora da gaveta — entram no total, não na conferência. */
  online?: { ifood?: number; food99?: number };
  /** Cupom bancado pela plataforma: nunca entrou na gaveta, mas explica venda. */
  cuponsDaPlataforma?: { ifood?: number; food99?: number };
  movimentacoes?: { entradas: number; saidas: number };
  /** Venda do turno que sai da conferência de propósito (fiado, mesa aberta…). */
  foraDaConferencia?: { fiado: number; fiadoQtd: number; naoIdentificado: number; naoIdentificadoQtd: number; mesasAbertas?: number; mesasAbertasQtd?: number };
  pendentes?: { valor: number; quantidade: number };
  /** Pedidos que estavam na rua e foram dados como entregues no fechamento. */
  finalizadosNoFechamento?: number;
  justificativa?: string | null;
  detalhe?: DetalheDoTurno;
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

  const relatorio: LinhaDoRelatorio[] = [
    { tipo: "titulo", texto: "Abertura" },
    { tipo: "destaque", texto: "Troco na gaveta", valor: reais(entrada.trocoInicial) },
  ];
  if (entrada.fechamentoAnterior && Number(entrada.fechamentoAnterior.cash) > 0) {
    const diff = Number(entrada.trocoInicial || 0) - Number(entrada.fechamentoAnterior.cash);
    relatorio.push({
      tipo: "linha",
      texto: "Contado no fechamento anterior",
      valor: reais(entrada.fechamentoAnterior.cash),
      nota: Math.abs(diff) > 0.01 ? `Diferenca de ${reais(diff)} em relacao ao que foi contado` : undefined,
    });
  }
  relatorio.push({ tipo: "separador" });
  relatorio.push({ tipo: "texto", texto: "Guarde este comprovante. Ele e o ponto de partida da conferencia." });

  return montar({
    id: `caixa_abertura_${entrada.sessionId}`,
    kind: "CAIXA_ABERTURA",
    titulo: c.titulo,
    cabecalho: c,
    items,
    total: Number(entrada.trocoInicial || 0),
    rodape: "Guarde este comprovante. Ele e o ponto de partida da conferencia.",
    relatorio,
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
    `ESPERADO ${reais(v.esperado.total)}  |  DIFERENCA ${reais(v.diferenca)} ${rotuloDaDiferenca(v.diferenca)}`,
  ];
  if (v.finalizadosNoFechamento && v.finalizadosNoFechamento > 0) {
    rodapeLinhas.push(
      `${v.finalizadosNoFechamento} pedido(s) que estavam na rua foram dados como entregues no fechamento.`
    );
  }
  if (v.justificativa) rodapeLinhas.push(`Justificativa: ${v.justificativa}`);

  const contadoTotal = v.contado.cash + v.contado.debit + v.contado.credit + v.contado.pix + v.contado.voucher + online;

  // ── AS LINHAS QUE FALTAVAM CHEGAR AO PAPEL ──────────────────────────────
  //
  // Total esperado, total contado e a DIFERENÇA viajavam só no rodapé, e o
  // rodapé nunca era impresso (ver o comentário do bloco CAIXA no Assistente).
  // Entram na lista de itens também, para o Assistente antigo — que não sabe
  // ler `relatorio` — passar a imprimi-las a partir de hoje.
  items.push({ name: "TOTAL ESPERADO", qty: 1, price: Number(v.esperado.total.toFixed(2)) });
  items.push({ name: "TOTAL CONTADO", qty: 1, price: Number(contadoTotal.toFixed(2)) });
  items.push({
    name: `DIFERENCA ${rotuloDaDiferenca(v.diferenca)}`,
    qty: 1,
    price: Number(v.diferenca.toFixed(2)),
    notes: v.justificativa ? `Justificativa: ${v.justificativa}` : undefined,
  });

  return montar({
    id: `caixa_fechamento_${entrada.sessionId}`,
    kind: "CAIXA_FECHAMENTO",
    titulo: c.titulo,
    cabecalho: c,
    items,
    total: Number(contadoTotal.toFixed(2)),
    rodape: rodapeLinhas.join("\n"),
    relatorio: relatorioDoFechamento(entrada, contadoTotal, online),
  });
}

function rotuloDaDiferenca(d: number) {
  return d < -0.01 ? "(FALTA)" : d > 0.01 ? "(SOBRA)" : "(confere)";
}

function hhmm(d: Date, fuso: string) {
  return d.toLocaleString("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * O relatório do fechamento, na ordem em que o lojista confere.
 *
 * Primeiro a gaveta (é o que trava o operador na hora), depois o resultado da
 * conferência, e só então o retrato do turno — venda por canal, movimentações
 * uma a uma e tudo que NÃO passa pela gaveta. A ordem importa: quem está
 * fechando quer a diferença nas primeiras linhas, não no fim de um relatório.
 */
function relatorioDoFechamento(
  entrada: {
    fuso: string;
    abertoEm: Date;
    fechadoEm: Date;
    trocoInicial: number;
    valores: ValoresDoFechamento;
  },
  contadoTotal: number,
  online: number
): LinhaDoRelatorio[] {
  const v = entrada.valores;
  const d = entrada.valores.detalhe;
  const L: LinhaDoRelatorio[] = [];

  L.push({ tipo: "titulo", texto: "Conferencia da gaveta" });
  const formas: [string, number, number][] = [
    ["Dinheiro", v.esperado.cash, v.contado.cash],
    ["Debito", v.esperado.debit, v.contado.debit],
    ["Credito", v.esperado.credit, v.contado.credit],
    ["Pix", v.esperado.pix, v.contado.pix],
    ["Vale-refeicao", v.esperado.voucher, v.contado.voucher],
  ];
  for (const [nome, esperado, contado] of formas) {
    if (Math.abs(esperado) < 0.01 && Math.abs(contado) < 0.01) continue;
    const dif = Number((contado - esperado).toFixed(2));
    L.push({
      tipo: "linha",
      texto: nome,
      valor: reais(contado),
      nota:
        `esperado ${reais(esperado)}` +
        (Math.abs(dif) > 0.01 ? ` | ${dif > 0 ? "sobra" : "falta"} ${reais(Math.abs(dif))}` : " | confere"),
    });
  }
  // O troco de abertura JÁ está dentro do esperado em dinheiro. Ele aparece
  // aqui porque o operador conta a gaveta inteira e precisa saber que aquela
  // parte não é venda — foi ele que deixou ali na abertura.
  L.push({
    tipo: "linha",
    texto: "Troco deixado na abertura",
    valor: reais(entrada.trocoInicial),
    nota: "ja esta somado dentro do esperado em dinheiro",
  });

  L.push({ tipo: "separador" });
  L.push({ tipo: "linha", texto: "Total esperado", valor: reais(v.esperado.total) });
  L.push({ tipo: "linha", texto: "Total contado", valor: reais(contadoTotal) });
  L.push({
    tipo: "destaque",
    texto: `DIFERENCA ${rotuloDaDiferenca(v.diferenca)}`,
    valor: reais(v.diferenca),
    nota: v.justificativa ? `Justificativa: ${v.justificativa}` : undefined,
  });

  // ── O TURNO ─────────────────────────────────────────────────────────────
  L.push({ tipo: "titulo", texto: "O turno" });
  L.push({ tipo: "linha", texto: "Aberto em", valor: hhmm(entrada.abertoEm, entrada.fuso) });
  L.push({ tipo: "linha", texto: "Fechado em", valor: hhmm(entrada.fechadoEm, entrada.fuso) });
  const minutos = Math.max(0, Math.round((entrada.fechadoEm.getTime() - entrada.abertoEm.getTime()) / 60000));
  L.push({ tipo: "linha", texto: "Duracao", valor: `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}` });
  if (d) {
    L.push({ tipo: "linha", texto: `Pedidos no turno`, valor: String(d.qtdPedidos) });
    L.push({ tipo: "linha", texto: "Venda bruta", valor: reais(d.vendaBruta) });
    L.push({ tipo: "linha", texto: "Ticket medio", valor: reais(d.ticketMedio) });
    if (d.taxaEntregaTotal > 0.01) L.push({ tipo: "linha", texto: "Taxa de entrega cobrada", valor: reais(d.taxaEntregaTotal) });
    if (d.descontoDaLoja > 0.01) {
      L.push({ tipo: "linha", texto: "Desconto bancado pela loja", valor: reais(d.descontoDaLoja), nota: "cupom da casa: saiu do seu bolso" });
    }
  }

  if (d && d.porCanal.length > 0) {
    L.push({ tipo: "titulo", texto: "Venda por canal" });
    for (const c of d.porCanal) {
      L.push({ tipo: "linha", texto: `${c.nome} (${c.qtd})`, valor: reais(c.valor) });
    }
  }

  if (d && d.movimentacoes.length > 0) {
    L.push({ tipo: "titulo", texto: "Sangrias e reforcos" });
    for (const m of d.movimentacoes) {
      const hora = new Date(m.hora).toLocaleTimeString("pt-BR", { timeZone: entrada.fuso, hour: "2-digit", minute: "2-digit" });
      const entrada_ = m.tipo === "ENTRADA";
      L.push({
        tipo: "linha",
        texto: `${hora} ${entrada_ ? "Reforco" : "Sangria"}`,
        valor: `${entrada_ ? "" : "-"}${reais(m.valor)}`,
        nota: m.descricao || undefined,
      });
    }
    const saldo = (v.movimentacoes?.entradas || 0) - (v.movimentacoes?.saidas || 0);
    L.push({ tipo: "linha", texto: "Saldo das movimentacoes", valor: reais(saldo) });
  }

  // ── O QUE NÃO PASSA PELA GAVETA ─────────────────────────────────────────
  //
  // Tudo aqui é venda do turno que o operador NÃO conta em cédula. Sem esta
  // lista, "vendi R$ 3.500 e só tem R$ 1.200 na gaveta" parece rombo.
  const foraDaGaveta: LinhaDoRelatorio[] = [];
  const empurrar = (texto: string, valor: number, nota?: string) => {
    if (Math.abs(valor) > 0.01) foraDaGaveta.push({ tipo: "linha", texto, valor: reais(valor), nota });
  };
  empurrar("iFood pago online", v.online?.ifood || 0, "confira no extrato do iFood");
  empurrar("99Food pago online", v.online?.food99 || 0, "confira no extrato do 99Food");
  empurrar("Cupom bancado pelo iFood", v.cuponsDaPlataforma?.ifood || 0, "desconto que o iFood pagou");
  empurrar("Cupom bancado pelo 99Food", v.cuponsDaPlataforma?.food99 || 0, "desconto que o 99Food pagou");
  const f = v.foraDaConferencia;
  if (f) {
    empurrar(`Conta funcionario / fiado (${f.fiadoQtd})`, f.fiado, "acertado fora do caixa");
    empurrar(`Mesas ainda abertas (${f.mesasAbertasQtd || 0})`, f.mesasAbertas || 0, "ninguem pagou ainda");
    empurrar(`Forma nao identificada (${f.naoIdentificadoQtd})`, f.naoIdentificado, "vale conferir o que e");
  }
  if (v.pendentes) empurrar(`Aguardando pagamento (${v.pendentes.quantidade})`, v.pendentes.valor);
  if (d?.cancelados) empurrar(`Cancelados (${d.cancelados.qtd})`, d.cancelados.valor, "nao entra em conta nenhuma");
  if (foraDaGaveta.length > 0) {
    L.push({ tipo: "titulo", texto: "Nao passa pela gaveta" });
    L.push(...foraDaGaveta);
  }

  if (v.finalizadosNoFechamento && v.finalizadosNoFechamento > 0) {
    L.push({ tipo: "separador" });
    L.push({ tipo: "texto", texto: `${v.finalizadosNoFechamento} pedido(s) que estavam na rua foram dados como entregues junto com este fechamento.` });
  }

  return L;
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
  /** O relatório de verdade. Assistente < 1.2.19 ignora e usa `items`. */
  relatorio?: LinhaDoRelatorio[];
}) {
  return {
    id: e.id,
    kind: e.kind,
    dailyOrderNumber: e.titulo,
    customerName: `${e.cabecalho.dataHora} — ${e.cabecalho.operador}`,
    // Campos próprios do papel de caixa: o Assistente novo monta o cabeçalho
    // com eles em vez de imprimir "CLIENTE / Nome: 19/09/2026 14:32 — Fulano".
    relatorio: e.relatorio,
    caixaQuando: e.cabecalho.dataHora,
    caixaOperador: e.cabecalho.operador,
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
