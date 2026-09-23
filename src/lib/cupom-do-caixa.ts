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
//
// O sinal vem ANTES do "R$": a sangria já saía "-R$ 150,00" e a diferença
// saía "R$ -10,00" no mesmo papel — dois jeitos de escrever falta.
const reais = (v: number | null | undefined) => {
  const n = Number(v || 0);
  const abs = Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n <= -0.005 ? "-" : ""}R$ ${abs}`;
};

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

/** Uma linha somada do retrato: "Pix (12) R$ 600,00". */
export type ParteDoRetrato = { nome: string; qtd: number; valor: number };

/**
 * O retrato do turno. Nada aqui entra em conta — é tudo informação.
 *
 * Apurado em lib/esperado-do-turno.ts na MESMA varredura da conferência, com a
 * mesma base: a soma das formas, a dos canais e a dos tipos dão o mesmo total
 * faturado. É o que deixa o papel ser conferido contra ele mesmo.
 */
export type DetalheDoTurno = {
  /** Pedidos sem mesa já pagos (ou fiados) + contas de mesa fechadas no turno. */
  vendas: { qtd: number; valor: number };
  porForma: ParteDoRetrato[];
  porCanal: (ParteDoRetrato & { formas: ParteDoRetrato[] })[];
  porTipo: ParteDoRetrato[];
  /** Desconto que saiu do bolso da loja — cupom da casa, desconto no balcão. */
  cupomDaLoja: { qtd: number; valor: number; porCanal: ParteDoRetrato[] };
  /** Cupom que a plataforma pagou, por canal. Ela repassa: é venda da loja. */
  cupomDaPlataforma: ParteDoRetrato[];
  /** O pago online da conferência, por canal (já com o cupom da plataforma). */
  onlinePorCanal: ParteDoRetrato[];
  taxaDeEntrega: { qtd: number; valor: number };
  mesas: { servico: number; servicoQtd: number; gorjeta: number };
  gaveta: { vendasEmDinheiro: number; reforcosQtd: number; sangriasQtd: number };
  movimentacoes: { tipo: string; valor: number; descricao: string | null; hora: Date | string }[];
  fiado: { hora: Date | string; numero: string; nome: string; valor: number }[];
  cancelados: {
    qtd: number;
    valor: number;
    lista: { hora: Date | string; numero: string; canal: string; referencia: string | null; valor: number; motivo: string | null; quem: string | null }[];
  };
  entregadores: {
    nome: string;
    entregas: number;
    dinheiro: number;
    cartao: number;
    pix: number;
    online: number;
    outros: number;
    taxas: number;
    diaria: number;
    semDistancia: number;
    pelaTaxaDoCliente: number;
  }[];
  entregaParceira: { qtd: number; valor: number };
  semEntregador: { qtd: number; valor: number };
  maisVendidos: ParteDoRetrato[];
};

export type ValoresDoFechamento = {
  esperado: { cash: number; debit: number; credit: number; pix: number; voucher: number; total: number };
  contado: { cash: number; debit: number; credit: number; pix: number; voucher: number };
  diferenca: number;
  /** Vendas já pagas fora da gaveta — entram no total, não na conferência. */
  online?: { ifood?: number; food99?: number };
  /**
   * O pago online que o SERVIDOR esperava. `online` é o que a tela mandou (a
   * linha é travada lá); os dois só divergem com a tela desatualizada, e aí o
   * papel precisa mostrar os dois, como faz com as outras formas.
   */
  onlineEsperado?: number;
  /**
   * Caixa encerrado sozinho quando outro foi aberto: não há contado nem
   * diferença (a sessão grava `difference` nulo). Imprimir "confere" ali seria
   * mentira.
   */
  semConferencia?: boolean;
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
  /**
   * Presente só na 2ª via: quem pediu e quando. O `operador` da 2ª via é quem
   * FECHOU (a sessão grava), para o cabeçalho dizer o mesmo que o original.
   */
  segundaVia?: { por: string; em: Date } | null;
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
    // Sem conferência não há contado: o item leva o esperado, dito como tal.
    if (v.semConferencia) {
      items.push({ name: nome, qty: 1, price: esperado, notes: "esperado | ninguem conferiu" });
      continue;
    }
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
  if (v.semConferencia) {
    items.push({ name: "SEM CONFERENCIA", qty: 1, price: 0, notes: "Caixa encerrado sozinho quando outro foi aberto" });
  } else {
    items.push({ name: "TOTAL CONTADO", qty: 1, price: Number(contadoTotal.toFixed(2)) });
    items.push({
      name: `DIFERENCA ${rotuloDaDiferenca(v.diferenca)}`,
      qty: 1,
      price: Number(v.diferenca.toFixed(2)),
      notes: v.justificativa ? `Justificativa: ${v.justificativa}` : undefined,
    });
  }

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

// A ordem das formas é FIXA, a mesma da conferência: quem compara o
// faturamento com a gaveta procura o dinheiro sempre na primeira linha, e
// ordenar por valor mudava a posição de cada forma a cada turno.
const ORDEM_DAS_FORMAS = ["Dinheiro", "Debito", "Credito", "Pix", "Vale-refeicao"];
function posicaoDaForma(nome: string): number {
  const i = ORDEM_DAS_FORMAS.indexOf(nome);
  if (i >= 0) return i;
  if (nome.startsWith("Pago online")) return 10;
  if (nome === "Cupom da plataforma") return 20;
  if (nome === "Fiado") return 30;
  return 40;
}
const naOrdemDasFormas = (l: ParteDoRetrato[]) =>
  [...l].sort((a, b) => posicaoDaForma(a.nome) - posicaoDaForma(b.nome) || b.valor - a.valor);

const ORDEM_DOS_TIPOS = ["Entrega", "Retirada", "Balcao", "Mesa", "Totem"];
const naOrdemDosTipos = (l: ParteDoRetrato[]) =>
  [...l].sort((a, b) => {
    const pa = ORDEM_DOS_TIPOS.indexOf(a.nome), pb = ORDEM_DOS_TIPOS.indexOf(b.nome);
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  });

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
 * conferência, e só então o retrato do turno. A ordem importa: quem está
 * fechando quer a diferença nas primeiras linhas, não no fim de um relatório.
 *
 * ── O QUE O RETRATO RESPONDE ────────────────────────────────────────────────
 *
 * O papel era só a conferência mais uma lista de "não passa pela gaveta". O
 * dono comparou com o fechamento da Saipos (23/09/2026) e pediu tudo o que
 * estava lá e mais: quantos fiados e de quem, quanto cada integração vendeu e
 * em qual forma ("Brendi: tantos pedidos, tanto de cada pagamento"), e quanto
 * de cupom foi da loja, do iFood e do 99Food. Cada seção abaixo responde uma
 * dessas perguntas sem o lojista precisar abrir o sistema no dia seguinte.
 *
 * Tudo sai da mesma apuração (lib/esperado-do-turno.ts): faturamento por
 * forma, por canal e por tipo somam o mesmo total — se um dia não somarem, o
 * defeito aparece no próprio papel.
 */
function relatorioDoFechamento(
  entrada: {
    fuso: string;
    abertoEm: Date;
    fechadoEm: Date;
    trocoInicial: number;
    valores: ValoresDoFechamento;
    segundaVia?: { por: string; em: Date } | null;
  },
  contadoTotal: number,
  online: number
): LinhaDoRelatorio[] {
  const v = entrada.valores;
  const d = entrada.valores.detalhe;
  const fuso = entrada.fuso;
  const L: LinhaDoRelatorio[] = [];
  const linha = (texto: string, valor: string, nota?: string) => L.push({ tipo: "linha", texto, valor, nota });
  const titulo = (texto: string) => L.push({ tipo: "titulo", texto });
  const texto = (t: string) => L.push({ tipo: "texto", texto: t });
  const hora = (h: Date | string) =>
    new Date(h).toLocaleTimeString("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" });
  const vezes = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

  // ── O TURNO ─────────────────────────────────────────────────────────────
  linha("Aberto em", hhmm(entrada.abertoEm, fuso));
  linha("Fechado em", hhmm(entrada.fechadoEm, fuso));
  const minutos = Math.max(0, Math.round((entrada.fechadoEm.getTime() - entrada.abertoEm.getTime()) / 60000));
  linha("Duracao", `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`);

  // ── CONFERÊNCIA ─────────────────────────────────────────────────────────
  titulo("Conferencia da gaveta");
  const formas: [string, number, number][] = [
    ["Dinheiro", v.esperado.cash, v.contado.cash],
    ["Debito", v.esperado.debit, v.contado.debit],
    ["Credito", v.esperado.credit, v.contado.credit],
    ["Pix", v.esperado.pix, v.contado.pix],
    ["Vale-refeicao", v.esperado.voucher, v.contado.voucher],
  ];
  const onlineEsperado = v.onlineEsperado ?? online;
  if (v.semConferencia) {
    // Não houve contagem: só o que o sistema esperava. Sem "confere", sem
    // diferença — zero ali seria dizer que alguém conferiu e bateu.
    texto("Ninguem conferiu esta gaveta: o caixa foi encerrado sozinho quando outro caixa foi aberto. Abaixo, so o que o sistema esperava.");
    for (const [nome, esperado] of formas) {
      if (Math.abs(esperado) >= 0.01) linha(nome, reais(esperado), "esperado");
    }
    if (onlineEsperado > 0.01) linha("Pago online", reais(onlineEsperado), "esperado | nao se conta na gaveta");
    L.push({ tipo: "separador" });
    L.push({ tipo: "destaque", texto: "ESPERADO", valor: reais(v.esperado.total), nota: "sem contagem, sem diferenca" });
  } else {
    for (const [nome, esperado, contado] of formas) {
      if (Math.abs(esperado) < 0.01 && Math.abs(contado) < 0.01) continue;
      const dif = Number((contado - esperado).toFixed(2));
      linha(
        nome,
        reais(contado),
        `esperado ${reais(esperado)}` +
          (Math.abs(dif) > 0.01 ? ` | ${dif > 0 ? "sobra" : "falta"} ${reais(Math.abs(dif))}` : " | confere")
      );
    }
    // O pago online entra no total dos dois lados — e por isso precisa estar
    // na lista: sem ele, as linhas de cima não somam o total de baixo.
    if (online > 0.01 || onlineEsperado > 0.01) {
      const dif = Number((online - onlineEsperado).toFixed(2));
      linha(
        "Pago online (nao se conta)",
        reais(online),
        `esperado ${reais(onlineEsperado)}` +
          (Math.abs(dif) > 0.01 ? ` | ${dif > 0 ? "sobra" : "falta"} ${reais(Math.abs(dif))}` : " | confere")
      );
      // Um canal por linha: cada um se confere contra o extrato DELE. O valor
      // já leva o cupom que a plataforma pagou — é o que ela repassa.
      if (d && d.onlinePorCanal.length > 0) {
        for (const c of d.onlinePorCanal) linha(`- ${c.nome} (${c.qtd})`, reais(c.valor));
        if (d.cupomDaPlataforma.length > 0) texto("Online ja com o cupom que a plataforma paga.");
      }
    }
    // Sem o retrato, o troco não aparece na gaveta lá embaixo: fica aqui,
    // como sempre ficou. O operador conta a gaveta inteira e precisa saber
    // que aquela parte não é venda.
    if (!d) {
      linha("Troco deixado na abertura", reais(entrada.trocoInicial), "ja esta somado dentro do esperado em dinheiro");
    }

    L.push({ tipo: "separador" });
    linha("Total esperado", reais(v.esperado.total));
    linha("Total contado", reais(contadoTotal));
    L.push({
      tipo: "destaque",
      texto: `DIFERENCA ${rotuloDaDiferenca(v.diferenca)}`,
      valor: reais(v.diferenca),
      nota: v.justificativa ? `Justificativa: ${v.justificativa}` : undefined,
    });
  }

  // ── DINHEIRO NA GAVETA ──────────────────────────────────────────────────
  //
  // De onde saiu o esperado em dinheiro, parcela por parcela. "Faltam R$ 50"
  // só vira pista quando o lojista vê a sangria de R$ 50 sem descrição logo
  // abaixo.
  const entradas = v.movimentacoes?.entradas || 0;
  const saidas = v.movimentacoes?.saidas || 0;
  if (d) {
    titulo("Dinheiro na gaveta");
    linha("Troco de abertura", reais(entrada.trocoInicial));
    linha("+ Vendas em dinheiro", reais(d.gaveta.vendasEmDinheiro));
    if (entradas > 0.01) linha(`+ Reforcos (${d.gaveta.reforcosQtd})`, reais(entradas));
    if (saidas > 0.01) linha(`- Sangrias (${d.gaveta.sangriasQtd})`, reais(saidas));
    const somaDasParcelas = Number((entrada.trocoInicial + d.gaveta.vendasEmDinheiro + entradas - saidas).toFixed(2));
    // Na 2ª via as parcelas são apuradas de novo; o esperado é o gravado. Se
    // alguém mexeu num pedido do turno depois do fechamento, os dois divergem
    // — e o papel diz isso em vez de imprimir uma conta que não fecha.
    linha(
      "= Dinheiro esperado",
      reais(v.esperado.cash),
      Math.abs(somaDasParcelas - v.esperado.cash) > 0.01
        ? `as parcelas acima somam ${reais(somaDasParcelas)} hoje: algum pedido do turno mudou depois do fechamento`
        : undefined
    );
    if (!v.semConferencia) linha("Contado na gaveta", reais(v.contado.cash));
    for (const m of d.movimentacoes) {
      const ehReforco = m.tipo === "ENTRADA";
      linha(`${hora(m.hora)} ${ehReforco ? "Reforco" : "Sangria"}`, `${ehReforco ? "" : "-"}${reais(m.valor)}`, m.descricao || undefined);
    }
  }

  if (!d) {
    // Sem retrato (não deveria acontecer): o mínimo que o papel antigo dava.
    if (v.pendentes && v.pendentes.quantidade > 0) linha(`Aguardando pagamento (${v.pendentes.quantidade})`, reais(v.pendentes.valor));
    return fechar(L, v, entrada.segundaVia, fuso);
  }

  // ── FATURAMENTO ─────────────────────────────────────────────────────────
  if (d.vendas.qtd > 0) {
    titulo("Faturamento");
    for (const f of naOrdemDasFormas(d.porForma)) {
      const nota = f.nome === "Fiado" ? "acertado fora do caixa" : f.nome === "Forma nao identificada" ? "vale conferir o que e" : undefined;
      linha(`${f.nome} (${f.qtd})`, reais(f.valor), nota);
    }
    const cuponsDasPlataformas = d.cupomDaPlataforma.reduce((s, c) => ({ qtd: s.qtd + c.qtd, valor: s.valor + c.valor }), { qtd: 0, valor: 0 });
    if (cuponsDasPlataformas.valor > 0.01) {
      linha(`Cupom pago pelas plataformas (${cuponsDasPlataformas.qtd})`, reais(cuponsDasPlataformas.valor), "elas repassam para a loja");
    }
    L.push({ tipo: "separador" });
    L.push({
      tipo: "destaque",
      texto: "TOTAL FATURADO",
      valor: reais(d.vendas.valor),
      nota: `${vezes(d.vendas.qtd, "venda", "vendas")} | ticket medio ${reais(d.vendas.valor / d.vendas.qtd)}`,
    });
    if (d.taxaDeEntrega.valor > 0.01) linha(`Incluso: taxa de entrega (${d.taxaDeEntrega.qtd})`, reais(d.taxaDeEntrega.valor));
    if (d.mesas.servico > 0.01) linha(`Incluso: taxa de servico (${vezes(d.mesas.servicoQtd, "mesa", "mesas")})`, reais(d.mesas.servico));
    if (d.mesas.gorjeta > 0.01) linha("Incluso: gorjeta", reais(d.mesas.gorjeta));
  } else {
    titulo("Faturamento");
    texto("Nenhuma venda paga neste turno.");
  }

  // ── POR TIPO DE VENDA ───────────────────────────────────────────────────
  if (d.porTipo.length > 0) {
    titulo("Por tipo de venda");
    for (const t of naOrdemDosTipos(d.porTipo)) {
      const pct = d.vendas.valor > 0 ? Math.round((t.valor / d.vendas.valor) * 100) : 0;
      linha(`${t.nome} (${t.qtd})`, reais(t.valor), `${pct}% do faturado | ticket medio ${reais(t.qtd > 0 ? t.valor / t.qtd : 0)}`);
    }
  }

  // ── POR CANAL, COM O PAGAMENTO DE CADA UM ───────────────────────────────
  if (d.porCanal.length > 0) {
    titulo("Vendas por canal");
    for (const c of d.porCanal) {
      linha(`${c.nome} (${c.qtd})`, reais(c.valor));
      for (const f of naOrdemDasFormas(c.formas)) linha(`- ${f.nome} (${f.qtd})`, reais(f.valor));
    }
  }

  // ── CUPONS E DESCONTOS ──────────────────────────────────────────────────
  //
  // Sempre impresso quando houve venda, mesmo zerado: "quanto foi de cupom da
  // loja e quanto do iFood" é pergunta que o dono faz todo dia, e linha que
  // some quando é zero obriga a adivinhar se foi zero ou se não foi contado.
  if (d.vendas.qtd > 0) {
    titulo("Cupons e descontos");
    linha(`Pago pela loja (${d.cupomDaLoja.qtd})`, reais(d.cupomDaLoja.valor), d.cupomDaLoja.valor > 0.01 ? "saiu do bolso da loja" : undefined);
    if (d.cupomDaLoja.porCanal.length > 1) {
      for (const c of d.cupomDaLoja.porCanal) linha(`- ${c.nome} (${c.qtd})`, reais(c.valor));
    }
    // O iFood e o 99Food aparecem sempre que venderam no turno; outra
    // plataforma, só quando pagou algum cupom.
    const plataformas = new Map(d.cupomDaPlataforma.map((c) => [c.nome, c]));
    for (const nome of ["iFood", "99Food"]) {
      if (!plataformas.has(nome) && d.porCanal.some((c) => c.nome === nome)) plataformas.set(nome, { nome, qtd: 0, valor: 0 });
    }
    for (const p of plataformas.values()) {
      const artigo = p.nome === "iFood" || p.nome === "99Food" ? "pelo" : "por";
      linha(`Pago ${artigo} ${p.nome} (${p.qtd})`, reais(p.valor), p.valor > 0.01 ? `o ${p.nome} repassa este valor` : undefined);
    }
  }

  // ── FIADO ───────────────────────────────────────────────────────────────
  if (d.fiado.length > 0) {
    titulo("Fiado / conta funcionario");
    for (const f of d.fiado) linha(`${hora(f.hora)} ${f.numero} ${f.nome}`.replace(/\s+/g, " ").trim(), reais(f.valor));
    const total = d.fiado.reduce((s, f) => s + f.valor, 0);
    linha(`Total fiado (${d.fiado.length})`, reais(total), "acertado fora do caixa");
    // Quem comprou mais de uma vez: o total da pessoa poupa a soma de cabeça
    // na hora de anotar na ficha.
    const porPessoa = new Map<string, number>();
    for (const f of d.fiado) porPessoa.set(f.nome, (porPessoa.get(f.nome) || 0) + f.valor);
    if (porPessoa.size < d.fiado.length) {
      texto(`Por pessoa: ${[...porPessoa.entries()].sort((a, b) => b[1] - a[1]).map(([n, val]) => `${n} ${reais(val)}`).join(" | ")}`);
    }
  }

  // ── ENTREGADORES ────────────────────────────────────────────────────────
  if (d.entregadores.length > 0 || d.entregaParceira.qtd > 0 || d.semEntregador.qtd > 0) {
    titulo("Entregadores");
    for (const m of d.entregadores) {
      linha(m.nome, vezes(m.entregas, "entrega", "entregas"));
      if (m.dinheiro > 0.01) linha("- Dinheiro recebido", reais(m.dinheiro), "prestar contas no caixa");
      if (m.cartao > 0.01) linha("- Cartao na maquininha", reais(m.cartao));
      if (m.pix > 0.01) linha("- Pix", reais(m.pix));
      if (m.online > 0.01) linha("- Ja pago online", reais(m.online));
      if (m.outros > 0.01) linha("- Outras formas", reais(m.outros));
      const avisos: string[] = [];
      if (m.semDistancia > 0) avisos.push(`${vezes(m.semDistancia, "entrega", "entregas")} sem distancia medida, taxa zero`);
      if (m.pelaTaxaDoCliente > 0) avisos.push(`${vezes(m.pelaTaxaDoCliente, "entrega", "entregas")} pela taxa que o cliente pagou`);
      linha("- Taxas das entregas", reais(m.taxas), avisos.length ? avisos.join(" | ") : undefined);
      if (m.diaria > 0.01) linha("- Diaria (do cadastro)", reais(m.diaria));
      linha("= A pagar ao entregador", reais(m.taxas + m.diaria));
    }
    if (d.entregaParceira.qtd > 0) {
      linha(`Entrega parceira iFood/99 (${d.entregaParceira.qtd})`, reais(d.entregaParceira.valor), "entregador da plataforma: nada a acertar");
    }
    if (d.semEntregador.qtd > 0) {
      linha(`Sem entregador marcado (${d.semEntregador.qtd})`, reais(d.semEntregador.valor), "entrega da loja sem motoboy no sistema");
    }
  }

  // ── CANCELADOS ──────────────────────────────────────────────────────────
  //
  // Um a um, com o número do parceiro: é por ele que o lojista acha o pedido
  // no portal do iFood quando o cliente liga reclamando.
  if (d.cancelados.qtd > 0) {
    titulo("Cancelados");
    const LIMITE = 40;
    for (const c of d.cancelados.lista.slice(0, LIMITE)) {
      const ref = c.referencia ? ` #${c.referencia}` : "";
      const quem = c.quem ? (c.quem === "loja" ? "pela loja" : c.quem === "cliente" ? "pelo cliente" : `pelo ${c.quem}`) : "";
      const nota = [quem, c.motivo].filter(Boolean).join(": ");
      linha(`${hora(c.hora)} ${c.numero} ${c.canal}${ref}`.replace(/\s+/g, " ").trim(), reais(c.valor), nota ? `cancelado ${nota}` : undefined);
    }
    if (d.cancelados.lista.length > LIMITE) texto(`e mais ${d.cancelados.lista.length - LIMITE} cancelados`);
    linha(`Total cancelado (${d.cancelados.qtd})`, reais(d.cancelados.valor), "nao entra em conta nenhuma");
  }

  // ── FICOU DE FORA DO FATURAMENTO ────────────────────────────────────────
  const f = v.foraDaConferencia;
  const deFora: LinhaDoRelatorio[] = [];
  if (v.pendentes && v.pendentes.quantidade > 0) {
    deFora.push({ tipo: "linha", texto: `Aguardando pagamento (${v.pendentes.quantidade})`, valor: reais(v.pendentes.valor), nota: "ninguem pagou ainda" });
  }
  if (f && (f.mesasAbertasQtd || 0) > 0) {
    deFora.push({ tipo: "linha", texto: `Mesas ainda abertas (${vezes(f.mesasAbertasQtd || 0, "pedido", "pedidos")})`, valor: reais(f.mesasAbertas || 0), nota: "a conta ainda nao foi fechada" });
  }
  if (deFora.length > 0) {
    titulo("Ficou de fora do faturamento");
    L.push(...deFora);
  }

  // ── MAIS VENDIDOS ───────────────────────────────────────────────────────
  if (d.maisVendidos.length > 0) {
    titulo("Mais vendidos");
    for (const i of d.maisVendidos) linha(`${i.qtd}x ${i.nome}`, reais(i.valor));
  }

  return fechar(L, v, entrada.segundaVia, fuso);
}

/** O rodapé: pedidos dados como entregues e a marca da 2ª via. */
function fechar(
  L: LinhaDoRelatorio[],
  v: ValoresDoFechamento,
  segundaVia: { por: string; em: Date } | null | undefined,
  fuso: string
): LinhaDoRelatorio[] {
  if (v.finalizadosNoFechamento && v.finalizadosNoFechamento > 0) {
    L.push({ tipo: "separador" });
    L.push({ tipo: "texto", texto: `${v.finalizadosNoFechamento} pedido(s) que estavam na rua foram dados como entregues junto com este fechamento.` });
  }
  if (segundaVia) {
    L.push({ tipo: "separador" });
    L.push({
      tipo: "texto",
      texto: `2a via impressa em ${hhmm(segundaVia.em, fuso)}${segundaVia.por ? ` por ${segundaVia.por}` : ""}. Conferencia como foi gravada no fechamento; o resto foi apurado de novo agora.`,
    });
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
