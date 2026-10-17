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
import type { ChaveDaSecao, SecoesDoFechamento } from "./secoes-do-fechamento";

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
 * Um TIPO de venda no fechamento — "VENDAS MESAS", "VENDAS RETIRADA"… com as
 * formas que entraram, o valor dos produtos, as taxas, o desconto e o total.
 *
 * Pedido do Douglas a partir da Delícia de Casa (02/10/2026), com a foto do
 * papel de outro sistema: o lojista quer ver o salão separado da entrega no
 * mesmo fechamento. `valor` é o total RECEBIDO do bloco e fecha por construção:
 *
 *   produtos + taxa de entrega + serviço + gorjeta − desconto − cupom da plataforma + ajustes = valor
 *   Σ formas = valor (o cupom da plataforma NÃO é forma desde 11/10/2026)
 *   Σ valor dos blocos = recebido.valor (o TOTAL RECEBIDO do papel)
 */
export type BlocoDoTipo = ParteDoRetrato & {
  /** DELIVERY | RETIRADA | BALCAO | MESA | TOTEM — a régua dos relatórios (lib/relatorios/base.ts). */
  chave: string;
  formas: ParteDoRetrato[];
  canais: ParteDoRetrato[];
  /** Σ preço × quantidade dos itens; na mesa, o consumo lançado (Σ pedidos da conta). */
  produtos: number;
  taxaDeEntrega: { qtd: number; valor: number };
  servico: { qtd: number; valor: number };
  gorjeta: number;
  /** Na entrega/balcão, o `discountMerchant`; na mesa, o desconto do fechamento pela régua (`descontoNoFechamento`). */
  desconto: { qtd: number; valor: number };
  /**
   * O cupom que a plataforma pagou nas vendas deste tipo. Abate dos produtos e
   * fica fora do total: o app repassa depois. Ausente no papel antigo.
   */
  cupomDaPlataforma?: { qtd: number; valor: number };
  /**
   * O que sobra para a conta fechar: a taxa de serviço do app (iFood/99, varia
   * por pedido — ver a-conta-do-pedido-nao-fecha-sozinha), cupom sem dono, o
   * pago a mais no cartão/Pix da mesa. Nunca um valor fixo inventado.
   */
  ajustes: number;
  /** Dos ajustes, a parte dos pedidos de marketplace (a taxa de serviço do app); o resto é da loja (acréscimo do vale, centavos). */
  ajustesDoApp?: number;
  /** Só mesa: o troco devolvido, já tirado do Dinheiro deste bloco. */
  troco: { qtd: number; valor: number };
};

/**
 * O retrato do turno. Nada aqui entra em conta — é tudo informação.
 *
 * Apurado em lib/esperado-do-turno.ts na MESMA varredura da conferência, com a
 * mesma base: a soma das formas, a dos canais e a dos tipos dão o mesmo total
 * faturado. É o que deixa o papel ser conferido contra ele mesmo.
 */
export type DetalheDoTurno = {
  /**
   * O FATURADO, pela régua única dos relatórios (lib/relatorios/regua-da-venda.ts):
   * Σ `totalAmount` dos pedidos do turno que são venda — a mesa pelo lançado,
   * aberta ou fechada —, sem o cupom da plataforma; `qtd` = vendas
   * (atendimentos: a mesa uma vez). Até 11/10/2026 era o recebido + o cupom.
   */
  vendas: { qtd: number; valor: number; ticketMedio?: number; lancamentos?: number; mesas?: number };
  /**
   * O RECEBIDO no turno: pedidos sem mesa já pagos (ou fiados) + contas de mesa
   * fechadas no turno, pelas baixas sem o troco. Σ formas = Σ canais = Σ tipos.
   * Ausente no papel montado à mão (testes antigos): aí os tipos somam `vendas`.
   */
  recebido?: { qtd: number; valor: number };
  /** Por que o recebido não é o faturado, linha a linha (só as que não são zero). */
  ponte?: { chave: string; rotulo: string; qtd: number; valor: number }[];
  /** O desconto dado no fechamento das mesas (régua: `descontoNoFechamento`) — a loja pagou. */
  descontoNasMesas?: { qtd: number; valor: number };
  porForma: ParteDoRetrato[];
  porCanal: (ParteDoRetrato & { formas: ParteDoRetrato[] })[];
  /** Um bloco por tipo de venda, na ordem Delivery, Retirada, Balcão, Mesas, Totem. Tipo sem venda não vem. */
  porTipo: BlocoDoTipo[];
  /** Desconto que saiu do bolso da loja — cupom da casa, desconto no balcão. */
  cupomDaLoja: { qtd: number; valor: number; porCanal: ParteDoRetrato[] };
  /**
   * Cupom que a plataforma pagou, por canal — fora do faturado e do recebido: o
   * app repassa à loja. `noOnline`: quanto dele já está dentro do "pago online"
   * da conferência (pedido pago no app); o resto é de pedido pago na porta.
   */
  cupomDaPlataforma: (ParteDoRetrato & { noOnline?: number; qtdNoOnline?: number })[];
  /**
   * O pago online da conferência, por canal: o que o app repassa — com o cupom
   * que ele pagou e SEM a taxa de serviço dele (desde 11/10/2026).
   */
  onlinePorCanal: ParteDoRetrato[];
  /**
   * Pagamento na porta de entrega feita pelo entregador do APP: ele cobrou, o
   * app repassa. Fora da gaveta, dentro da linha travada do online. Ausente no
   * papel antigo.
   */
  cobradoPeloApp?: ParteDoRetrato[];
  /** Do cobrado pelo entregador do app, o que foi em DINHEIRO (a gaveta antiga o cobrava). */
  dinheiroCobradoPeloApp?: number;
  taxaDeEntrega: { qtd: number; valor: number };
  /**
   * `troco`: o que as contas de mesa receberam além de consumo + serviço +
   * gorjeta e devolveram em dinheiro. Sai do Dinheiro no retrato E na
   * conferência da gaveta (desde 11/10/2026; antes, a conferência cobrava a
   * nota inteira e o troco virava falta).
   */
  mesas: { servico: number; servicoQtd: number; gorjeta: number; troco?: number; trocoQtd?: number };
  gaveta: { vendasEmDinheiro: number; reforcosQtd: number; sangriasQtd: number };
  /**
   * Troco feito pelo Pix (lib/troco-no-pix.ts). `qtd`/`valor`: o Pix DA LOJA —
   * a nota inteira ficou na gaveta (já dentro das vendas em dinheiro) e o
   * troco saiu da conta (já fora do Pix esperado). `motoboyQtd`/`motoboyValor`:
   * o Pix DO MOTOBOY, que ficou com a diferença da nota — não muda a gaveta.
   * Ausente quando não houve, e no papel antigo.
   */
  trocoNoPix?: { qtd: number; valor: number; motoboyQtd: number; motoboyValor: number };
  /** `quem`: quem lançou (o e-mail gravado). Ausente no papel montado à mão (testes antigos). */
  /** `depoisDoFechamento`: a esquecida, lançada no Histórico com o caixa já fechado (a hora é a do lançamento). */
  movimentacoes: { tipo: string; valor: number; descricao: string | null; hora: Date | string; quem?: string | null; depoisDoFechamento?: boolean }[];
  fiado: { hora: Date | string; numero: string; nome: string; valor: number }[];
  cancelados: {
    qtd: number;
    valor: number;
    lista: {
      hora: Date | string; numero: string; canal: string; referencia: string | null; valor: number; motivo: string | null; quem: string | null;
      /** O nome de quem cancelou na loja, pelo rastro do pedido. Ausente = cancelamento sem rastro. */
      operador?: string | null;
    }[];
  };
  /**
   * Itens tirados de pedidos que continuaram valendo — a bebida tirada da
   * mesa, o item tirado na edição (lib/cancelamentos-do-turno.ts). Ausente
   * no papel de caixa fechado antes de 09/10/2026.
   */
  itensCancelados?: { hora: Date | string; numero: string; onde: string; quem: string; item: string; valor: number; motivo: string | null }[];
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
    /** O troco que ele levou da loja para a nota do cliente — volta junto com o dinheiro. Ausente no papel antigo. */
    trocoLevado?: number;
    /** Troco feito pelo Pix da loja: a parte da nota além do pedido, que ele entrega junto (lib/troco-no-pix.ts). */
    trocoNoPixDaLoja?: number;
    /** Troco feito pelo Pix dele: a parte da nota com que ficou, fora do dinheiro a entregar. */
    trocoNoPixDoMotoboy?: number;
    /** Das entregas, as canceladas depois de ele sair (a corrida conta, o dinheiro não). */
    canceladasComCorrida?: number;
  }[];
  entregaParceira: { qtd: number; valor: number };
  semEntregador: { qtd: number; valor: number };
  maisVendidos: ParteDoRetrato[];
};

export type ValoresDoFechamento = {
  esperado: { cash: number; debit: number; credit: number; pix: number; voucher: number; total: number };
  /**
   * O que foi contado. `null` = a forma NÃO foi conferida (ficou em branco na
   * tela, desde 11/10/2026): fica fora da diferença e o papel diz isso, em vez
   * de imprimir "R$ 0,00 | falta" do tamanho do esperado.
   */
  contado: { cash: number | null; debit: number | null; credit: number | null; pix: number | null; voucher: number | null };
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
  /**
   * Por que não houve conferência (lib/conferencia-do-caixa.ts): o caixa que
   * se encerrou sozinho ao abrir outro (ABRIU_OUTRO, o padrão), o fechado sem
   * ninguém digitar a contagem (SEM_CONTAGEM) e o caixa antigo gravado com as
   * cinco formas em zero (TUDO_ZERO).
   */
  motivoSemConferencia?: "ABRIU_OUTRO" | "SEM_CONTAGEM" | "TUDO_ZERO" | null;
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

/**
 * O comprovante de uma SANGRIA (saída) ou de um SUPRIMENTO (entrada) de caixa.
 *
 * Pedido da Delícia de Casa (02/10/2026): "conseguir imprimir a entrada ou a
 * retirada quando lançamos no caixa". O dinheiro que sai da gaveta no meio do
 * turno (pagar o motoboy, mandar para o cofre) só tinha a linha na tela; quem
 * leva o dinheiro e quem entrega não assinavam nada, e no fim do dia a
 * sangria sem papel vira palavra contra palavra.
 *
 * Curto de propósito: tipo, valor, forma, motivo, quem lançou, quando, e duas
 * linhas de assinatura. Mesmo envelope e mesma fila do papel do caixa — sai
 * na impressora que a loja escolheu para o caixa (kind CAIXA_*).
 */
export function cupomDeMovimentacaoDeCaixa(entrada: {
  movimentacao: { id: string; tipo: string; valor: number; descricao: string | null; criadoPor: string | null; createdAt: Date };
  loja: string;
  fuso: string;
  /** Quem está imprimindo agora (o cabeçalho do papel). */
  operador: string;
  /** Abertura do turno do lançamento, quando se sabe. */
  caixaAbertoEm?: Date | null;
  /** Reimpressão pela lista: o papel diz que é 2ª via. */
  segundaVia?: boolean;
}) {
  const m = entrada.movimentacao;
  const ehEntrada = m.tipo === "ENTRADA";
  const nome = ehEntrada ? "SUPRIMENTO DE CAIXA" : "SANGRIA DE CAIXA";
  const c = cabecalho(entrada.segundaVia ? `2a VIA - ${nome}` : nome, entrada.loja, new Date(), entrada.fuso, entrada.operador);
  const quando = hhmm(new Date(m.createdAt), entrada.fuso);
  const valorComSinal = ehEntrada ? m.valor : -m.valor;

  const relatorio: LinhaDoRelatorio[] = [
    { tipo: "titulo", texto: ehEntrada ? "Entrada (suprimento)" : "Retirada (sangria)" },
    { tipo: "destaque", texto: "VALOR", valor: reais(m.valor) },
    { tipo: "linha", texto: "Forma", valor: "Dinheiro" },
    { tipo: "linha", texto: ehEntrada ? "Entrou na gaveta em" : "Saiu da gaveta em", valor: quando },
  ];
  if (m.criadoPor) relatorio.push({ tipo: "linha", texto: "Lancado por", valor: m.criadoPor });
  if (entrada.caixaAbertoEm) relatorio.push({ tipo: "linha", texto: "Caixa aberto em", valor: hhmm(entrada.caixaAbertoEm, entrada.fuso) });
  relatorio.push({ tipo: "texto", texto: `Motivo: ${m.descricao ? m.descricao : "(nao informado)"}` });
  relatorio.push({ tipo: "separador" });
  // Duas assinaturas: quem tirou (ou trouxe) o dinheiro e quem estava no
  // caixa. Uma só não prova nada quando são duas pessoas. A linha vazia é uma
  // "linha" sem texto nem valor: o Assistente descarta o texto só de espaço,
  // e sem o vão ninguém consegue assinar em cima do traço.
  const vao = (): LinhaDoRelatorio => ({ tipo: "linha", texto: "", valor: "" });
  relatorio.push(vao(), vao());
  relatorio.push({ tipo: "texto", texto: "______________________________" });
  relatorio.push({ tipo: "texto", texto: ehEntrada ? "Quem entregou o dinheiro" : "Quem retirou o dinheiro" });
  relatorio.push(vao(), vao());
  relatorio.push({ tipo: "texto", texto: "______________________________" });
  relatorio.push({ tipo: "texto", texto: "Responsavel pelo caixa" });

  return montar({
    id: `caixa_mov_${m.id}`,
    kind: "CAIXA_MOVIMENTACAO",
    titulo: c.titulo,
    cabecalho: c,
    // Assistente antigo (sem `relatorio`) imprime isto como um pedido de uma
    // linha só: o tipo, o valor com sinal e o motivo embaixo.
    items: [{ name: ehEntrada ? "Suprimento (entrada)" : "Sangria (retirada)", qty: 1, price: valorComSinal, notes: m.descricao || undefined }],
    total: valorComSinal,
    rodape: `${ehEntrada ? "Entrada" : "Saida"} de dinheiro em ${quando}${m.criadoPor ? ` por ${m.criadoPor}` : ""}`,
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
  /** O que a loja escolheu imprimir (lib/secoes-do-fechamento.ts). Ausente = tudo. */
  secoes?: SecoesDoFechamento | null;
}) {
  const c = cabecalho("FECHAMENTO DE CAIXA", entrada.loja, entrada.fechadoEm, entrada.fuso, entrada.operador);
  const v = entrada.valores;

  // Cada forma vira uma LINHA com o esperado na observação: o Assistente
  // imprime `notes` embaixo do item, então o lado a lado cabe no papel estreito
  // sem depender de coluna nova.
  const formas = formasDaConferencia(v);
  const conferido = conferidoDasFormas(formas);

  const items: LinhaDoCaixa[] = [];
  for (const { nome, esperado, contado } of formas) {
    if (Math.abs(esperado) < 0.01 && (contado == null || Math.abs(contado) < 0.01)) continue;
    // Sem conferência (ou a forma em branco) não há contado: o item leva o
    // esperado, dito como tal.
    if (v.semConferencia || contado == null) {
      items.push({ name: nome, qty: 1, price: esperado, notes: v.semConferencia ? "esperado | ninguem conferiu" : "esperado | nao conferido (em branco)" });
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
    v.semConferencia
      ? `ESPERADO ${reais(v.esperado.total)}  |  SEM CONFERENCIA`
      : `ESPERADO NAS FORMAS CONTADAS ${reais(conferido.esperado)}  |  DIFERENCA ${reais(v.diferenca)} ${rotuloDaDiferenca(v.diferenca)}`,
  ];
  if (v.finalizadosNoFechamento && v.finalizadosNoFechamento > 0) {
    rodapeLinhas.push(
      `${v.finalizadosNoFechamento} pedido(s) que estavam na rua foram dados como entregues no fechamento.`
    );
  }
  if (v.justificativa) rodapeLinhas.push(`Justificativa: ${v.justificativa}`);

  const contadoTotal = conferido.contado + online;

  // ── AS LINHAS QUE FALTAVAM CHEGAR AO PAPEL ──────────────────────────────
  //
  // Total esperado, total contado e a DIFERENÇA viajavam só no rodapé, e o
  // rodapé nunca era impresso (ver o comentário do bloco CAIXA no Assistente).
  // Entram na lista de itens também, para o Assistente antigo — que não sabe
  // ler `relatorio` — passar a imprimi-las a partir de hoje.
  if (v.semConferencia) {
    items.push({ name: "TOTAL ESPERADO", qty: 1, price: Number(v.esperado.total.toFixed(2)) });
    items.push({ name: "SEM CONFERENCIA", qty: 1, price: 0, notes: textoDoSemConferencia(v.motivoSemConferencia) });
  } else {
    // Igual com igual: o esperado e o contado das formas contadas.
    items.push({ name: "ESPERADO (FORMAS CONTADAS)", qty: 1, price: conferido.esperado });
    items.push({ name: "TOTAL CONTADO", qty: 1, price: conferido.contado });
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
  if (nome.startsWith("Cobrado pelo entregador")) return 11;
  if (nome === "Cupom da plataforma") return 20;
  if (nome === "Fiado") return 30;
  return 40;
}
const naOrdemDasFormas = (l: ParteDoRetrato[]) =>
  [...l].sort((a, b) => posicaoDaForma(a.nome) - posicaoDaForma(b.nome) || b.valor - a.valor);

// A mesma ordem de lib/apuracao-do-turno.ts (ORDEM_DOS_TIPOS), repetida aqui
// para este arquivo continuar sem import: o harness do papel o carrega solto.
const ORDEM_DOS_TIPOS = ["DELIVERY", "RETIRADA", "BALCAO", "MESA", "TOTEM"];
const naOrdemDosTipos = (l: BlocoDoTipo[]) =>
  [...l].sort((a, b) => {
    const pa = ORDEM_DOS_TIPOS.indexOf(a.chave), pb = ORDEM_DOS_TIPOS.indexOf(b.chave);
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  });

/**
 * As linhas de UM tipo de venda no papel, no formato que a loja já conhece de
 * outro sistema: as formas, o valor dos produtos, o que soma e o que desconta,
 * e o TOTAL do tipo em destaque. Linha zerada não sai — tipo sem taxa de
 * entrega não precisa dizer "Taxa de entrega R$ 0,00".
 */
function linhasDoBloco(L: LinhaDoRelatorio[], b: BlocoDoTipo, totalRecebido: number) {
  const linha = (texto: string, valor: string, nota?: string) => L.push({ tipo: "linha", texto, valor, nota });
  L.push({ tipo: "titulo", texto: `Vendas ${b.nome}` });
  for (const f of naOrdemDasFormas(b.formas)) {
    const nota =
      f.nome === "Fiado" ? "acertado fora do caixa"
      : f.nome === "Forma nao identificada" ? "vale conferir o que e"
      : f.nome === "Cupom da plataforma" ? "a plataforma repassa"
      : undefined;
    linha(`${f.nome} (${f.qtd})`, reais(f.valor), nota);
  }
  L.push({ tipo: "separador" });
  linha("Valor dos produtos", reais(b.produtos));
  if (b.taxaDeEntrega.valor > 0.005) linha(`+ Taxa de entrega (${b.taxaDeEntrega.qtd})`, reais(b.taxaDeEntrega.valor));
  if (b.servico.valor > 0.005) linha(`+ Taxa de servico (${b.servico.qtd})`, reais(b.servico.valor));
  if (b.gorjeta > 0.005) linha("+ Gorjeta", reais(b.gorjeta));
  if (b.desconto.valor > 0.005) {
    linha(`- ${b.chave === "MESA" ? "Desconto no fechamento" : "Desconto da loja"} (${b.desconto.qtd})`, reais(-b.desconto.valor));
  }
  // O cupom que o app pagou abate do preço que o cliente viu e fica fora do
  // total: o app repassa à loja depois (linha à parte no faturamento).
  const cupom = b.cupomDaPlataforma?.valor || 0;
  if (cupom > 0.005) linha(`- Cupom pago pela plataforma (${b.cupomDaPlataforma!.qtd})`, reais(-cupom), "o app repassa a loja");
  if (Math.abs(b.ajustes) > 0.005) {
    // Nunca um valor fixo: a taxa de serviço do app varia por pedido
    // (a-conta-do-pedido-nao-fecha-sozinha). E cada sobra com o seu nome: no
    // balcão ela é o acréscimo do vale (VR 5%), não "taxa do app".
    const sinal = (v: number) => (v > 0 ? "+" : "-");
    if (b.chave === "MESA") {
      linha(`${sinal(b.ajustes)} Outros ajustes das mesas`, reais(b.ajustes), b.ajustes > 0 ? "pago a mais no cartao ou no Pix" : "conta fechada recebendo menos (nao e desconto)");
    } else {
      const doApp = b.ajustesDoApp ?? (b.chave === "DELIVERY" || b.chave === "RETIRADA" ? b.ajustes : 0);
      const daLoja = Math.round((b.ajustes - doApp) * 100) / 100;
      if (Math.abs(doApp) > 0.005) linha(`${sinal(doApp)} Taxa de servico do app`, reais(doApp), "iFood/99: varia por pedido");
      if (Math.abs(daLoja) > 0.005) linha(`${sinal(daLoja)} Acrescimos e ajustes da loja`, reais(daLoja), "acrescimo do vale ou da maquininha, centavos");
    }
  }
  const pct = totalRecebido > 0 ? Math.round((b.valor / totalRecebido) * 100) : 0;
  // "Ticket médio" é palavra da régua única (faturado ÷ vendas); aqui é a
  // média do que cada pedido (ou conta de mesa) pagou, com esse nome.
  const porCada = b.chave === "MESA" ? "por conta" : "por pedido";
  L.push({
    tipo: "destaque",
    texto: `TOTAL ${b.nome.toUpperCase()} (${b.qtd})`,
    valor: reais(b.valor),
    nota: `${pct}% do recebido | media ${reais(b.qtd > 0 ? b.valor / b.qtd : 0)} ${porCada}`,
  });
  if (b.troco.valor > 0.005) linha(`Troco devolvido (${b.troco.qtd})`, reais(b.troco.valor), "ja tirado do Dinheiro acima");
  // Por canal só quando há mais de um: "Delivery: iFood (5), Site (7)". Um
  // canal só repetiria o total do bloco.
  if (b.canais.length > 1) {
    for (const c of b.canais) linha(`- ${c.nome} (${c.qtd})`, reais(c.valor));
  }
}

/** As cinco formas da conferência, com o contado (null = não conferida). */
function formasDaConferencia(v: ValoresDoFechamento): { nome: string; esperado: number; contado: number | null }[] {
  return [
    { nome: "Dinheiro", esperado: v.esperado.cash, contado: v.contado.cash },
    { nome: "Debito", esperado: v.esperado.debit, contado: v.contado.debit },
    { nome: "Credito", esperado: v.esperado.credit, contado: v.contado.credit },
    { nome: "Pix", esperado: v.esperado.pix, contado: v.contado.pix },
    { nome: "Vale-refeicao", esperado: v.esperado.voucher, contado: v.contado.voucher },
  ].map((f) => ({ ...f, esperado: Number(f.esperado || 0), contado: f.contado == null ? null : Number(f.contado) }));
}

/** O esperado e o contado só das formas contadas, e a diferença delas. */
function conferidoDasFormas(formas: { esperado: number; contado: number | null }[]) {
  const contadas = formas.filter((f) => f.contado != null);
  const esperado = Math.round(contadas.reduce((s, f) => s + f.esperado, 0) * 100) / 100;
  const contado = Math.round(contadas.reduce((s, f) => s + (f.contado as number), 0) * 100) / 100;
  return { esperado, contado, diferenca: Math.round((contado - esperado) * 100) / 100 };
}

/** Por que ninguém conferiu (ASCII: o papel sai sem acento). */
function textoDoSemConferencia(motivo: ValoresDoFechamento["motivoSemConferencia"]): string {
  if (motivo === "SEM_CONTAGEM") return "Fechado sem conferir: ninguem digitou a contagem da gaveta.";
  if (motivo === "TUDO_ZERO") return "As cinco formas foram gravadas em zero: ninguem digitou a contagem, e a falta gravada nao aconteceu.";
  return "Ninguem conferiu esta gaveta: o caixa foi encerrado sozinho quando outro caixa foi aberto.";
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
    secoes?: SecoesDoFechamento | null;
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
  // Seção desligada pela loja não sai (lib/secoes-do-fechamento.ts). A
  // conferência, a diferença e o TOTAL FATURADO não têm chave: saem sempre.
  const mostra = (k: ChaveDaSecao) => entrada.secoes?.[k] !== false;

  // ── O TURNO ─────────────────────────────────────────────────────────────
  linha("Aberto em", hhmm(entrada.abertoEm, fuso));
  linha("Fechado em", hhmm(entrada.fechadoEm, fuso));
  const minutos = Math.max(0, Math.round((entrada.fechadoEm.getTime() - entrada.abertoEm.getTime()) / 60000));
  linha("Duracao", `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`);

  // ── CONFERÊNCIA ─────────────────────────────────────────────────────────
  //
  // Forma por forma, o contado ao lado do esperado. A forma que ninguém contou
  // (em branco na tela, desde 11/10/2026) diz "nao conferido" e fica FORA da
  // diferença: antes ela saía "R$ 0,00 | falta" do tamanho do esperado. O pago
  // online é travado (o mesmo valor dos dois lados) e fica fora da conta da
  // diferença; o total do turno com ele vem por último, como informação.
  titulo("Conferencia da gaveta");
  const formas = formasDaConferencia(v);
  const onlineEsperado = v.onlineEsperado ?? online;
  const linhasDoOnline = () => {
    if (onlineEsperado <= 0.01) return;
    linha("Pago online (nao se conta)", reais(onlineEsperado), "o app repassa; travado nos dois lados");
    // Um canal por linha: cada um se confere contra o extrato DELE. O valor é
    // o que o app repassa: com o cupom que ele pagou e sem a taxa de serviço
    // dele (itens + entrega − desconto da loja, antes da comissão).
    if (d && d.onlinePorCanal.length > 0) {
      for (const c of d.onlinePorCanal) linha(`- ${c.nome} (${c.qtd})`, reais(c.valor));
    }
    // O que o entregador do app cobrou na porta (dinheiro ou a maquininha
    // DELE): o app acerta no repasse, e a gaveta não tem esse dinheiro.
    const cobrado = d?.cobradoPeloApp || [];
    for (const c of cobrado) linha(`- ${c.nome}: entregador do app cobrou (${c.qtd})`, reais(c.valor), "nao veio para a gaveta");
    if (d && (d.onlinePorCanal.length > 0 || cobrado.length > 0)) {
      texto("O que o app repassa: com o cupom que ele pagou, sem a taxa de servico dele.");
    }
  };
  if (v.semConferencia) {
    // Não houve contagem: só o que o sistema esperava. Sem "confere", sem
    // diferença — zero ali seria dizer que alguém conferiu e bateu.
    texto(`${textoDoSemConferencia(v.motivoSemConferencia)} Abaixo, so o que o sistema esperava.`);
    for (const f of formas) {
      if (Math.abs(f.esperado) >= 0.01) linha(f.nome, reais(f.esperado), "esperado");
    }
    linhasDoOnline();
    L.push({ tipo: "separador" });
    L.push({ tipo: "destaque", texto: "ESPERADO", valor: reais(v.esperado.total), nota: "sem contagem, sem diferenca" });
  } else {
    for (const f of formas) {
      if (Math.abs(f.esperado) < 0.01 && (f.contado == null || Math.abs(f.contado) < 0.01)) continue;
      if (f.contado == null) {
        linha(f.nome, "nao conferido", `esperado ${reais(f.esperado)} | ficou em branco, fora da diferenca`);
        continue;
      }
      const dif = Number((f.contado - f.esperado).toFixed(2));
      linha(
        f.nome,
        reais(f.contado),
        `esperado ${reais(f.esperado)}` +
          (Math.abs(dif) > 0.01 ? ` | ${dif > 0 ? "sobra" : "falta"} ${reais(Math.abs(dif))}` : " | confere")
      );
    }
    linhasDoOnline();
    // Sem o retrato, o troco não aparece na gaveta lá embaixo: fica aqui,
    // como sempre ficou. O operador conta a gaveta inteira e precisa saber
    // que aquela parte não é venda.
    if (!d) {
      linha("Troco deixado na abertura", reais(entrada.trocoInicial), "ja esta somado dentro do esperado em dinheiro");
    }

    // Igual com igual: o esperado e o contado das formas CONTADAS.
    const conferido = conferidoDasFormas(formas);
    L.push({ tipo: "separador" });
    linha("Esperado nas formas contadas", reais(conferido.esperado));
    linha("Contado", reais(conferido.contado));
    L.push({
      tipo: "destaque",
      texto: `DIFERENCA ${rotuloDaDiferenca(v.diferenca)}`,
      valor: reais(v.diferenca),
      nota: v.justificativa ? `Justificativa: ${v.justificativa}` : undefined,
    });
    const emBranco = formas.filter((f) => f.contado == null && Math.abs(f.esperado) >= 0.01);
    if (emBranco.length > 0) {
      texto(`Nao conferido (em branco, fora da diferenca): ${emBranco.map((f) => `${f.nome} ${reais(f.esperado)}`).join(", ")}.`);
    }
    // Caixa antigo fechado com a tela desatualizada: a diferença gravada levou
    // o online que entrou depois de a tela abrir. O papel diz quanto.
    if (Math.abs(v.diferenca - conferido.diferenca) > 0.01) {
      texto(`A diferenca gravada tem ${reais(v.diferenca - conferido.diferenca)} do pago online: a tela de quem fechou estava desatualizada.`);
    }
    if (onlineEsperado > 0.01 || Math.abs(v.esperado.total - conferido.esperado) > 0.01) {
      linha("Total do turno com o online", reais(v.esperado.total), "troco inicial, sangrias e o que o app repassa");
    }
  }

  // ── DINHEIRO NA GAVETA ──────────────────────────────────────────────────
  //
  // De onde saiu o esperado em dinheiro, parcela por parcela. "Faltam R$ 50"
  // só vira pista quando o lojista vê a sangria de R$ 50 sem descrição logo
  // abaixo.
  const entradas = v.movimentacoes?.entradas || 0;
  const saidas = v.movimentacoes?.saidas || 0;
  if (d && mostra("gaveta")) {
    titulo("Dinheiro na gaveta");
    linha("Troco de abertura", reais(entrada.trocoInicial));
    // ── O TROCO DA MESA ────────────────────────────────────────────────────
    //
    // A baixa da mesa grava a NOTA que o cliente entregou
    // (pago-da-mesa-inclui-troco), e o troco sai desta gaveta. Desde
    // 11/10/2026 a conferência já conta a mesa sem o troco, como o faturamento:
    // "vendas em dinheiro" é o que ficou. Antes ela cobrava a nota inteira e o
    // papel mostrava "+ Troco das mesas … vira falta".
    const trocoDasMesas = d.mesas.troco || 0;
    // Troco feito pelo Pix da loja (lib/troco-no-pix.ts): a nota inteira
    // ficou aqui, e a parte dela que passa do pedido já está nas vendas em
    // dinheiro — sem dizer, o operador procuraria uma venda desse tamanho.
    const pixDoTroco = d.trocoNoPix?.valor || 0;
    const notasDaVenda = [
      trocoDasMesas > 0.01 ? `sem os ${reais(trocoDasMesas)} de troco das mesas (${d.mesas.trocoQtd || 0})` : "",
      pixDoTroco > 0.01 ? `com ${reais(pixDoTroco)} de nota inteira: troco feito pelo Pix da loja (${d.trocoNoPix?.qtd || 0}), Pix fora do caixa` : "",
    ].filter(Boolean);
    linha(
      "+ Vendas em dinheiro",
      reais(d.gaveta.vendasEmDinheiro),
      notasDaVenda.length ? notasDaVenda.join(" | ") : undefined
    );
    if (entradas > 0.01) linha(`+ Reforcos (${d.gaveta.reforcosQtd})`, reais(entradas));
    if (saidas > 0.01) linha(`- Sangrias (${d.gaveta.sangriasQtd})`, reais(saidas));
    const somaDasParcelas = Number((entrada.trocoInicial + d.gaveta.vendasEmDinheiro + entradas - saidas).toFixed(2));
    // Na 2ª via as parcelas são apuradas de novo; o esperado é o gravado. Se
    // alguém mexeu num pedido do turno depois do fechamento, os dois divergem
    // — e o papel diz isso em vez de imprimir uma conta que não fecha. O
    // caixa fechado antes de 11/10/2026 gravou o esperado pela regra antiga:
    // com a nota inteira da mesa (o troco) e com o dinheiro que o entregador
    // do app recebeu na porta. Quando a diferença é exatamente isso, o papel
    // diz que foi a regra que mudou, não o pedido.
    const cobradoEmDinheiro = d.dinheiroCobradoPeloApp || 0;
    const diferencaDoGravado = Math.round((v.esperado.cash - somaDasParcelas) * 100) / 100;
    const pelaRegraAntiga = [
      { valor: trocoDasMesas, texto: `${reais(trocoDasMesas)} de troco das mesas` },
      { valor: cobradoEmDinheiro, texto: `${reais(cobradoEmDinheiro)} que o entregador do app recebeu` },
    ].filter((p) => p.valor > 0.005);
    const combinacoes = [pelaRegraAntiga, ...pelaRegraAntiga.map((p) => [p])];
    const explicacao = combinacoes.find((c) => c.length > 0 && Math.abs(c.reduce((s, p) => s + p.valor, 0) - diferencaDoGravado) <= 0.01);
    linha(
      "= Dinheiro esperado",
      reais(v.esperado.cash),
      Math.abs(diferencaDoGravado) <= 0.01
        ? undefined
        : explicacao
          ? `gravado pela regra antiga, que cobrava da gaveta ${explicacao.map((p) => p.texto).join(" e ")}`
          : `as parcelas acima somam ${reais(somaDasParcelas)} hoje: algum pedido do turno mudou depois do fechamento`
    );
    if (!v.semConferencia && v.contado.cash != null) linha("Contado na gaveta", reais(v.contado.cash));
    for (const m of d.movimentacoes) {
      const ehReforco = m.tipo === "ENTRADA";
      // O motivo e quem lançou na linha de baixo: "Sangria R$ 200" sem dono
      // vira palavra contra palavra na conferência.
      const nota = [m.descricao || "", m.quem ? `por ${m.quem}` : "", m.depoisDoFechamento ? "lancada depois do fechamento" : ""].filter(Boolean).join(" | ");
      linha(`${hora(m.hora)} ${ehReforco ? "Reforco" : "Sangria"}`, `${ehReforco ? "" : "-"}${reais(m.valor)}`, nota || undefined);
    }
  }

  if (!d) {
    // Sem retrato (não deveria acontecer): o mínimo que o papel antigo dava.
    if (v.pendentes && v.pendentes.quantidade > 0) linha(`Aguardando pagamento (${v.pendentes.quantidade})`, reais(v.pendentes.valor));
    return fechar(L, v, entrada.segundaVia, fuso);
  }

  // ── FATURAMENTO ─────────────────────────────────────────────────────────
  //
  // Dois números, cada um com o seu nome (lib/apuracao-do-turno.ts):
  //   • TOTAL FATURADO — a régua única dos relatórios: Σ dos pedidos do turno,
  //     a mesa pelo lançado, sem o cupom da plataforma; vendas = atendimentos.
  //     É o número que o lojista confere contra o Vendas por período. Até
  //     11/10/2026 ele somava o cupom do app (Hakim, 10/10: R$ 2.347,27 no papel
  //     × R$ 1.883,53 nos relatórios).
  //   • Total recebido — o que entrou, forma por forma (a base da conferência).
  // Entre os dois, só as linhas que existem: taxa de serviço e gorjeta das
  // mesas, desconto no fechamento, mesa ainda aberta… — do faturado se chega
  // ao recebido somando-as, e o papel prova a conta.
  const recebido = d.recebido ?? { qtd: d.vendas.qtd, valor: d.vendas.valor };
  if (d.vendas.qtd > 0 || recebido.qtd > 0) {
    titulo("Faturamento");
    L.push({
      tipo: "destaque",
      texto: "TOTAL FATURADO",
      valor: reais(d.vendas.valor),
      nota: `${vezes(d.vendas.qtd, "venda", "vendas")} | ticket medio ${reais(d.vendas.ticketMedio ?? (d.vendas.qtd > 0 ? d.vendas.valor / d.vendas.qtd : 0))} | o mesmo dos relatorios`,
    });
    if (mostra("faturamento") && d.taxaDeEntrega.valor > 0.01) linha(`Incluso: taxa de entrega (${d.taxaDeEntrega.qtd})`, reais(d.taxaDeEntrega.valor));
    const cuponsDasPlataformas = d.cupomDaPlataforma.reduce((s, c) => ({ qtd: s.qtd + c.qtd, valor: s.valor + c.valor }), { qtd: 0, valor: 0 });
    if (cuponsDasPlataformas.valor > 0.01) {
      linha(`Cupom pago pelas plataformas (${cuponsDasPlataformas.qtd})`, reais(cuponsDasPlataformas.valor), "fora do faturado: o app repassa a loja");
    }
    const ponte = d.ponte || [];
    if (mostra("faturamento")) {
      if (ponte.length > 0) {
        for (const p of ponte) {
          linha(`${p.valor >= 0 ? "+" : "-"} ${p.rotulo}${p.qtd > 0 ? ` (${p.qtd})` : ""}`, reais(p.valor));
        }
        linha(`= Total recebido (${recebido.qtd})`, reais(recebido.valor), "o que entrou, forma por forma abaixo");
      }
      L.push({ tipo: "titulo", texto: "Recebido por forma" });
      for (const f of naOrdemDasFormas(d.porForma)) {
        const nota = f.nome === "Fiado" ? "acertado fora do caixa" : f.nome === "Forma nao identificada" ? "vale conferir o que e" : undefined;
        linha(`${f.nome} (${f.qtd})`, reais(f.valor), nota);
      }
      L.push({ tipo: "separador" });
      linha(`Total recebido (${recebido.qtd})`, reais(recebido.valor), ponte.length === 0 ? "igual ao TOTAL FATURADO" : undefined);
    } else if (ponte.length > 0) {
      linha(`Total recebido (${recebido.qtd})`, reais(recebido.valor), "difere do faturado: taxa/desconto das mesas");
    }
    if ((d.mesas.troco || 0) > 0.01) {
      linha(`Troco devolvido nas mesas (${d.mesas.trocoQtd || 0})`, reais(d.mesas.troco || 0), "ja tirado do Dinheiro");
    }
  } else {
    titulo("Faturamento");
    texto("Nenhuma venda paga neste turno.");
  }

  // ── UM BLOCO POR TIPO DE VENDA ──────────────────────────────────────────
  //
  // Era uma linha por tipo ("Entrega (26) R$ 2.200,00"). A Delícia de Casa
  // (02/10/2026) mostrou o papel de outro sistema, com um bloco por tipo —
  // "VENDAS RETIRADA / DINHEIRO / VALOR DOS PRODUTOS / TOTAL" — e o Douglas
  // pediu igual: o salão separado da entrega, cada um com o que entrou em
  // cada forma. Tudo sai da mesma apuração (lib/apuracao-do-turno.ts), e a
  // última linha prova que a soma dos blocos é o total RECEBIDO.
  if (d.porTipo.length > 0 && mostra("porTipo")) {
    for (const b of naOrdemDosTipos(d.porTipo)) linhasDoBloco(L, b, recebido.valor);
    const soma = Number(d.porTipo.reduce((s, b) => s + b.valor, 0).toFixed(2));
    const bate = Math.abs(soma - recebido.valor) < 0.005;
    L.push({ tipo: "separador" });
    linha(
      `Soma dos tipos (${d.porTipo.length})`,
      reais(soma),
      bate ? "igual ao total recebido" : `difere do total recebido (${reais(recebido.valor)})`
    );
  }

  // ── POR CANAL, COM O PAGAMENTO DE CADA UM ───────────────────────────────
  // O que entrou por canal (a mesa pelas contas fechadas). O cupom que o app
  // pagou não está aqui: é a linha "Pago pelo …" dos cupons.
  if (d.porCanal.length > 0 && mostra("porCanal")) {
    titulo("Recebido por canal");
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
  //
  // O desconto dado no FECHAMENTO DA MESA também saiu do bolso da loja. Ele
  // não estava aqui: Ragnar, 10/10/2026, "Pago pela loja R$ 1.984,55" no papel
  // × R$ 2.863,55 no relatório Cupons e descontos — R$ 879 em 20 mesas. A
  // conta é a mesma do relatório (descontoNoFechamento).
  if ((d.vendas.qtd > 0 || recebido.qtd > 0) && mostra("cupons")) {
    titulo("Cupons e descontos");
    const daMesa = d.descontoNasMesas || { qtd: 0, valor: 0 };
    const pelaLoja = { qtd: d.cupomDaLoja.qtd + daMesa.qtd, valor: Math.round((d.cupomDaLoja.valor + daMesa.valor) * 100) / 100 };
    linha(`Pago pela loja (${pelaLoja.qtd})`, reais(pelaLoja.valor), pelaLoja.valor > 0.01 ? "saiu do bolso da loja" : undefined);
    if (daMesa.valor > 0.01) {
      linha(`- Nos pedidos (${d.cupomDaLoja.qtd})`, reais(d.cupomDaLoja.valor));
      if (d.cupomDaLoja.porCanal.length > 1) {
        for (const c of d.cupomDaLoja.porCanal) linha(`  - ${c.nome} (${c.qtd})`, reais(c.valor));
      }
      linha(`- No fechamento das mesas (${daMesa.qtd})`, reais(daMesa.valor));
    } else if (d.cupomDaLoja.porCanal.length > 1) {
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
  if (d.fiado.length > 0 && mostra("fiado")) {
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
  if (mostra("entregadores") && (d.entregadores.length > 0 || d.entregaParceira.qtd > 0 || d.semEntregador.qtd > 0)) {
    titulo("Entregadores");
    for (const m of d.entregadores) {
      // "Jobson 30 notas, e o valor dos pedidos das 30 do lado" (Delícia de
      // Casa, 09/10/2026): o nome com as entregas, e à direita quanto valem
      // os pedidos que ele levou, de todas as formas — as linhas abaixo abrem.
      const valorDosPedidos = m.dinheiro + m.cartao + m.pix + m.online + m.outros;
      linha(`${m.nome} (${vezes(m.entregas, "entrega", "entregas")})`, reais(valorDosPedidos), "valor dos pedidos");
      if ((m.canceladasComCorrida || 0) > 0) texto(`Inclui ${vezes(m.canceladasComCorrida || 0, "cancelada", "canceladas")} depois de sair: a corrida conta, o dinheiro nao.`);
      // "Pedidos R$ X + troco levado R$ Y = entregar R$ Z" — a mesma conta do
      // acerto do motoboy. O papel dizia só o valor dos pedidos ("Dinheiro
      // recebido R$ 84,95") e o acerto, a nota com o troco (R$ 170,00): o
      // mesmo Marlon com dois números.
      // Troco feito pelo Pix (lib/troco-no-pix.ts): no da loja ele traz a
      // nota inteira (a parte além do pedido entra no a entregar, sem ser
      // troco levado); no dele, fica com essa parte e entrega só o pedido.
      const troco = m.trocoLevado || 0;
      const notaDoPixDaLoja = m.trocoNoPixDaLoja || 0;
      const pixDele = m.trocoNoPixDoMotoboy || 0;
      if (m.dinheiro > 0.01 && (troco > 0.005 || notaDoPixDaLoja > 0.005)) {
        const partes = [`pedidos ${reais(m.dinheiro)}`];
        if (troco > 0.005) partes.push(`troco levado ${reais(troco)}`);
        if (notaDoPixDaLoja > 0.005) partes.push(`${reais(notaDoPixDaLoja)} da nota (troco no Pix da loja)`);
        linha("- Dinheiro a entregar", reais(m.dinheiro + troco + notaDoPixDaLoja), partes.join(" + "));
      } else if (m.dinheiro > 0.01) {
        linha("- Dinheiro a entregar", reais(m.dinheiro), "pedidos em dinheiro; prestar contas no caixa");
      }
      if (pixDele > 0.005) texto(`Troco no Pix dele: ${reais(pixDele)} - ficou com essa parte da nota (fora do a entregar e do a pagar).`);
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
  if (d.cancelados.qtd > 0 && mostra("cancelados")) {
    titulo("Cancelados");
    const LIMITE = 40;
    for (const c of d.cancelados.lista.slice(0, LIMITE)) {
      const ref = c.referencia ? ` #${c.referencia}` : "";
      const quem = c.quem ? (c.quem === "loja" ? "pela loja" : c.quem === "cliente" ? "pelo cliente" : `pelo ${c.quem}`) : "";
      // "pela loja (Maria - funcionário)": o nome vem do rastro do pedido.
      const quemComNome = c.operador ? `${quem || "por"} (${c.operador})`.trim() : quem;
      const nota = [quemComNome, c.motivo].filter(Boolean).join(": ");
      linha(`${hora(c.hora)} ${c.numero} ${c.canal}${ref}`.replace(/\s+/g, " ").trim(), reais(c.valor), nota ? `cancelado ${nota}` : undefined);
    }
    if (d.cancelados.lista.length > LIMITE) texto(`e mais ${d.cancelados.lista.length - LIMITE} cancelados`);
    linha(`Total cancelado (${d.cancelados.qtd})`, reais(d.cancelados.valor), "nao entra em conta nenhuma");
  }

  // ── ITENS CANCELADOS ────────────────────────────────────────────────────
  //
  // O item tirado de um pedido que continuou valendo — a bebida tirada da
  // mesa, o item tirado na edição. Não está em Cancelados (o pedido não foi
  // cancelado), e era a conferência que o dono da Pizzaria 17 pediu
  // (09/10/2026): quem tirou, quando, o item, o valor e o motivo.
  const itensFora = d.itensCancelados || [];
  if (itensFora.length > 0 && mostra("itensCancelados")) {
    titulo("Itens cancelados");
    const LIMITE = 40;
    for (const i of itensFora.slice(0, LIMITE)) {
      const onde = [i.numero, i.onde].filter(Boolean).join(" ");
      linha(`${hora(i.hora)} ${onde} ${i.item}`.replace(/\s+/g, " ").trim(), reais(i.valor), `por ${i.quem}: ${i.motivo || "sem motivo"}`);
    }
    if (itensFora.length > LIMITE) texto(`e mais ${itensFora.length - LIMITE} itens`);
    const soma = Math.round(itensFora.reduce((t, i) => t + (Number(i.valor) || 0), 0) * 100) / 100;
    linha(`Total de itens cancelados (${itensFora.length})`, reais(soma), "ja fora dos pedidos");
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
  if (deFora.length > 0 && mostra("deFora")) {
    titulo("Ficou de fora do faturamento");
    L.push(...deFora);
  }

  // ── MAIS VENDIDOS ───────────────────────────────────────────────────────
  if (d.maisVendidos.length > 0 && mostra("maisVendidos")) {
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
    //
    // O fecho "NÃO É DOCUMENTO FISCAL" é obrigatório em todo comprovante não
    // fiscal desde 01/02/2025 (Ajuste SINIEF 32/24, cl. 10ª §4º) — e este
    // papel se chama "comprovante" no próprio texto. Em título de bloco, que o
    // Assistente imprime em caixa e negrito: é para ser visto.
    relatorio: e.relatorio ? [...e.relatorio, { tipo: "titulo" as const, texto: "NÃO É DOCUMENTO FISCAL" }] : e.relatorio,
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
