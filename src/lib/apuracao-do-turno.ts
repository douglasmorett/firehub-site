/**
 * A apuração das VENDAS de um turno de caixa — pura, sem banco.
 *
 * É o miolo de lib/esperado-do-turno.ts: recebe os pedidos e as contas de mesa
 * fechadas que aquela função buscou e decide, venda por venda, UMA forma de
 * pagamento — a que vai para a conferência (o esperado) e a que vai para o
 * retrato do papel (faturamento por forma, por canal e por tipo de venda).
 *
 * Saiu de lá em 02/10/2026, quando o fechamento passou a separar as vendas
 * por tipo (Delivery, Retirada, Balcão, Mesas, Totem — pedido da Delícia de
 * Casa): a conta nova tinha de ser provada com casos de verdade
 * (scripts/teste-caixa-por-tipo.ts), e o arquivo de lá importa o Prisma, que
 * não carrega sem banco.
 *
 * ── UMA RÉGUA DE FORMAS, A DO RELATÓRIO (11/10/2026) ────────────────────────
 *
 * Até aqui o caixa tinha a sua cascata de palavras e o relatório Formas de
 * pagamento a dele, "a mesma, com quatro correções que o caixa ainda não
 * tem". Na auditoria de 11/10/2026, em 30 dias, 30 pedidos e R$ 2.625,93 caíam
 * numa forma no caixa e noutra no relatório: a Wabiz grava o débito como
 * "Cartão Deb Master (Cobrar na Entrega)" e o caixa contava CRÉDITO (NIK, 27
 * pedidos, R$ 2.412,96 — o débito sobrava e o crédito faltava todo dia);
 * "Cartão Alimentação/Refeição" virava crédito; o "CASH" cru do iFood ia para
 * o pago online. Agora o caixa lê pelas MESMAS funções do relatório
 * (`formaDoTexto`, `foiPagoOnline`, `formaDoPedido`, `cupomDaPlataforma`, em
 * lib/relatorios/formas-de-pagamento.ts) e o acerto do motoboy também
 * (lib/resumo-do-entregador.ts): mudou a régua, muda nos três.
 */
import { cupomBancadoPelo99, ehDo99Food } from "@/lib/cupom-do-parceiro";
import { lerPagamentos } from "@/lib/pagamentos-da-mesa";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { tipoDeVenda, type TipoDeVenda } from "@/lib/relatorios/base";
import { situacaoDoPedido, temValorImpossivel, totalDosItens } from "@/lib/relatorios/regua-da-venda";
import { cupomDaPlataforma as cupomPagoPelaPlataforma, formaDoPedido, formaDoTexto, type ChaveDaForma } from "@/lib/relatorios/formas-de-pagamento";
import type { BlocoDoTipo, DetalheDoTurno, ParteDoRetrato } from "@/lib/cupom-do-caixa";

/** A forma de quem já pagou pelo app ou pelo site. No papel ela leva o canal junto. */
export const PAGO_ONLINE = "Pago online";
export const NAO_IDENTIFICADA = "Forma nao identificada";
export const CUPOM_DA_PLATAFORMA = "Cupom da plataforma";

export type Forma = { forma: string; valor: number };

// Tudo do retrato soma em CENTAVOS e só vira reais na saída: o bloco de cada
// tipo tem de fechar no centavo com o total faturado, e somar float com float
// (a taxa de serviço da mesa é gravada sem arredondar: 6,359) deixa a soma
// dos blocos um centavo longe do total no primeiro turno com mesa.
const cent = (v: unknown) => Math.round((Number(v) || 0) * 100);
const reais = (c: number) => Math.round(c) / 100;

type Soma = { qtd: number; c: number };
const somarEm = (mapa: Map<string, Soma>, chave: string, centavos: number, qtd = 1) => {
  const atual = mapa.get(chave) || { qtd: 0, c: 0 };
  atual.qtd += qtd;
  atual.c += centavos;
  mapa.set(chave, atual);
};
const listar = (mapa: Map<string, Soma>): ParteDoRetrato[] =>
  [...mapa.entries()]
    .map(([nome, s]) => ({ nome, qtd: s.qtd, valor: reais(s.c) }))
    .sort((a, b) => b.valor - a.valor);

/**
 * O nome do canal no papel. É o do selo do painel, com uma exceção: o site
 * próprio se chama "Online" no selo, e no papel ele fica ao lado de "Pago
 * online" — "Online: pago online" não diz nada a ninguém.
 */
function canalNoPapel(o: any): string {
  const c = canalDoPedido(o);
  return c.chave === "SITE" ? "Site" : c.nome;
}

// ── O TIPO DE VENDA ──────────────────────────────────────────────────────────
//
// O caixa tinha uma régua própria ("Entrega" também para deliveryType
// ENTREGA, balcão pelo canal PDV, "Outro tipo" para o que sobrasse). Agora é a
// dos relatórios (`tipoDeVenda`, lib/relatorios/base.ts, que é a `origemDaVenda`
// do painel de pedidos com o totem à parte): mesa antes de tudo, delivery, o
// lançado no caixa é balcão, o resto é retirada. O papel do fechamento e o
// relatório "Vendas por período" do mesmo dia dizem o mesmo número por tipo.

/** A ordem dos blocos no papel e na tela: a mesma da Saipos e dos relatórios. */
export const ORDEM_DOS_TIPOS: TipoDeVenda[] = ["DELIVERY", "RETIRADA", "BALCAO", "MESA", "TOTEM"];

/** O nome do bloco ("VENDAS MESAS"). Sem acento: o papel sai em ASCII. */
export const NOME_DO_TIPO: Record<TipoDeVenda, string> = {
  DELIVERY: "Delivery",
  RETIRADA: "Retirada",
  BALCAO: "Balcao",
  MESA: "Mesas",
  TOTEM: "Totem",
};

/** "Func. Joao" é como a venda presencial grava o nome no pedido fiado. */
function quemComprouFiado(o: any): string {
  const doCadastro = String(o.employeeName || "").trim();
  if (doCadastro) return doCadastro;
  const doPedido = String(o.customerName || "").replace(/^Func\.\s*/i, "").trim();
  return doPedido || "sem nome";
}

/**
 * O TROCO DE UMA CONTA DE MESA.
 *
 * A baixa da mesa grava o que o cliente ENTREGOU, não o que devia: a tela
 * pede "quanto foi recebido" e mostra o troco para o garçom devolver
 * (components/mesas/MesasApp.tsx), e o fechamento aceita a sobra. Na Pastel da
 * Paulista, 01–23/09/2026, eram ~R$ 298 de troco em 17 contas pagas com nota
 * redonda (ver pago-da-mesa-inclui-troco).
 *
 * A mesma conta do relatório Formas de pagamento
 * (lib/relatorios/formas-de-pagamento.ts): o entregue além de consumo +
 * serviço + gorjeta sai do DINHEIRO desta conta, da maior nota para a menor,
 * até o que ela pagou em dinheiro. Pago a mais no cartão/Pix não tem troco a
 * devolver e fica como está. Tudo em centavos.
 */
export function trocoDaConta(e: { formas: Forma[]; consumo: number; servico: number; gorjeta: number }): { formas: Forma[]; troco: number } {
  const baixas = e.formas.map((f, i) => ({ ...f, c: cent(f.valor), i }));
  const entregue = baixas.reduce((s, b) => s + b.c, 0);
  const aMais = Math.max(0, entregue - cent(e.servico) - cent(e.gorjeta) - cent(e.consumo));
  let troco = 0;
  for (const b of baixas.filter((x) => x.forma === "Dinheiro").sort((x, y) => y.c - x.c)) {
    if (troco >= aMais) break;
    const sai = Math.min(b.c, aMais - troco);
    b.c -= sai;
    troco += sai;
  }
  return {
    formas: baixas.filter((b) => b.c > 0).sort((x, y) => x.i - y.i).map((b) => ({ forma: b.forma, valor: reais(b.c) })),
    troco: reais(troco),
  };
}

/**
 * A forma, como o papel a escreve (ASCII: o Assistente imprime sem acento), e a
 * linha da conferência que ela cobra. A forma vem da régua do relatório
 * (`formaDoTexto`/`formaDoPedido`); aqui só se dá nome e lugar a ela.
 */
type ChaveDoEsperado = "cash" | "debit" | "credit" | "pix" | "voucher";
const NOME_DA_FORMA: Record<ChaveDaForma, string> = {
  DINHEIRO: "Dinheiro",
  DEBITO: "Debito",
  CREDITO: "Credito",
  PIX: "Pix",
  VALE: "Vale-refeicao",
  ONLINE: PAGO_ONLINE,
  FIADO: "Fiado",
  OUTROS: NAO_IDENTIFICADA,
};
const LINHA_DA_CONFERENCIA: Partial<Record<ChaveDaForma, ChaveDoEsperado>> = {
  DINHEIRO: "cash", DEBITO: "debit", CREDITO: "credit", PIX: "pix", VALE: "voucher",
};

/** Uma conta de mesa FECHADA no turno, como esperado-do-turno a busca. */
export type MesaDoTurno = {
  paymentMethods: unknown;
  serviceFee: number | null;
  waiterTip: number | null;
  /** Os pedidos da conta, para o consumo (troco e desconto). Sem eles, o bloco não separa troco. */
  orders?: { status: string | null; totalAmount: number | null; discountTotal?: number | null }[];
};

export type EntregaPropria = {
  motoboyId: string;
  formas: Forma[];
  pedido: { motoboyFee: number | null; deliveryFee: number | null; deliveryDistance: number | null };
  ehMarketplace: boolean;
};

export type Esperado = { cash: number; debit: number; credit: number; pix: number; voucher: number; ifoodOnline: number; ifoodCoupons: number; food99Online: number; food99Coupons: number; total: number };

/** O que sai da apuração: a conferência e as partes do retrato que vêm das vendas. */
export type ApuracaoDasVendas = {
  /** Só as vendas: sem troco de abertura e sem sangria/reforço (quem soma é esperado-do-turno). */
  expected: Esperado;
  foraDaConferencia: { fiado: number; fiadoQtd: number; naoIdentificado: number; naoIdentificadoQtd: number; mesasAbertas: number; mesasAbertasQtd: number };
  pendentesValor: number;
  pendentesQuantidade: number;
  onlineProprio: number;
  entregasProprias: EntregaPropria[];
  retrato: Pick<DetalheDoTurno,
    "vendas" | "porForma" | "porCanal" | "porTipo" | "cupomDaLoja" | "cupomDaPlataforma" | "onlinePorCanal" |
    "taxaDeEntrega" | "mesas" | "fiado" | "entregaParceira" | "semEntregador">;
};

/** O acumulador de um bloco de tipo, em centavos. */
type Bloco = {
  qtd: number; c: number; formas: Map<string, Soma>; canais: Map<string, Soma>;
  produtos: number; taxa: number; taxaQtd: number; servico: number; servicoQtd: number; gorjeta: number;
  desconto: number; descontoQtd: number; troco: number; trocoQtd: number;
};

export function apurarVendasDoTurno(pedidos: any[], mesasFechadas: MesaDoTurno[]): ApuracaoDasVendas {
  const expected: Esperado = { cash: 0, debit: 0, credit: 0, pix: 0, voucher: 0, ifoodOnline: 0, ifoodCoupons: 0, food99Online: 0, food99Coupons: 0, total: 0 };
  // -- VENDA QUE NUNCA VIRA CEDULA ---------------------------------------
  //
  // O `else` do fim da cascata mandava para DINHEIRO tudo que nao casasse com
  // uma forma conhecida. E onde caia a refeicao fiada da equipe ("Conta
  // Funcionario"), o pedido de mesa (que nasce "N/A" e nunca recebe a forma
  // real) e qualquer rotulo novo que uma integracao invente. Medido no banco
  // em 28/08/2026: R$ 4.175,24 em 45 dias exigidos da gaveta sem que uma
  // cedula tivesse entrado -- R$ 3.533,96 so de refeicao de funcionario.
  //
  // O operador via "Faltam R$ X" todo dia, sem pista do motivo. Falta que
  // aparece sempre e nunca se explica e falta que o lojista aprende a ignorar,
  // e ai o caixa deixa de conferir qualquer coisa.
  //
  // Sai da conferencia e volta em linha propria -- mesmo tratamento que ja foi
  // dado a `pendentesDePagamento`. Some da conta, nao da tela.
  // `mesasAbertas`: pedidos de mesa cuja mesa AINDA não fechou. Não há dinheiro
  // deles em lugar nenhum ainda — entram como informação, nunca conferência.
  const foraDaConferencia = { fiado: 0, fiadoQtd: 0, naoIdentificado: 0, naoIdentificadoQtd: 0, mesasAbertas: 0, mesasAbertasQtd: 0 };
  // Pedidos do turno que ainda não têm pagamento nenhum. Ficam FORA do
  // esperado (ver o porquê no laço abaixo) e voltam aqui só para o lojista
  // saber que existem — informação, nunca conferência.
  let pendentesValor = 0;
  let pendentesQuantidade = 0;
  // A parte do pago online que entrou pelos canais da PRÓPRIA loja (site,
  // robô, totem) — o resto é repasse de plataforma. Só informação: a
  // conferência continua somando tudo em `ifoodOnline`, e a loja de
  // demonstração mostra as duas linhas separadas (lib/pedidos-simulados.ts).
  let onlineProprio = 0;

  // ── O RETRATO DO TURNO ───────────────────────────────────────────────────
  //
  // Nada disto entra em conta nenhuma: é o que o papel do fechamento precisa
  // para o lojista entender o turno sem abrir o sistema.
  //
  // A base é a mesma da conferência: pedido sem mesa e já pago (ou fiado),
  // mais as contas de mesa FECHADAS no turno, pelas baixas. Pedido aguardando
  // pagamento, mesa ainda aberta e cancelado ficam de fora — cada um volta em
  // linha própria. Com a mesma base, a soma das formas, a soma dos canais e a
  // soma dos tipos dão o MESMO total faturado, e o papel não se contradiz.
  const porForma = new Map<string, Soma>();
  const porCanal = new Map<string, { qtd: number; c: number; formas: Map<string, Soma> }>();
  const porTipo = new Map<TipoDeVenda, Bloco>();
  const cupomDaPlataforma = new Map<string, Soma>();
  const cupomDaLoja = { qtd: 0, c: 0, porCanal: new Map<string, Soma>() };
  const onlinePorCanal = new Map<string, Soma>();
  const taxaDeEntrega = { qtd: 0, c: 0 };
  const mesas = { servico: 0, servicoQtd: 0, gorjeta: 0, troco: 0, trocoQtd: 0 };
  const vendas = { qtd: 0, c: 0 };
  const fiado: DetalheDoTurno["fiado"] = [];
  const entregaParceira = { qtd: 0, c: 0 };
  const semEntregador = { qtd: 0, c: 0 };
  const entregasProprias: EntregaPropria[] = [];

  const blocoDo = (tipo: TipoDeVenda): Bloco => {
    let b = porTipo.get(tipo);
    if (!b) {
      b = { qtd: 0, c: 0, formas: new Map(), canais: new Map(), produtos: 0, taxa: 0, taxaQtd: 0, servico: 0, servicoQtd: 0, gorjeta: 0, desconto: 0, descontoQtd: 0, troco: 0, trocoQtd: 0 };
      porTipo.set(tipo, b);
    }
    return b;
  };

  /**
   * Uma venda no retrato. O canal e o tipo contam a VENDA uma vez; cada parte
   * do pagamento conta na sua forma. O cupom que a plataforma pagou entra como
   * se fosse mais uma forma: é dinheiro que ela repassa, e sem ele a soma do
   * canal não bate com o que o parceiro mostra no portal.
   *
   * Devolve o bloco do tipo, para quem chamou somar os produtos, as taxas e o
   * desconto daquela venda.
   */
  const registrarVenda = (canal: string, tipo: TipoDeVenda, formas: Forma[], cupom: number): Bloco => {
    const cCupom = cent(cupom);
    const valor = formas.reduce((s, f) => s + cent(f.valor), 0) + Math.max(0, cCupom);
    vendas.qtd += 1;
    vendas.c += valor;
    const b = blocoDo(tipo);
    b.qtd += 1;
    b.c += valor;
    somarEm(b.canais, canal, valor);
    const c = porCanal.get(canal) || { qtd: 0, c: 0, formas: new Map<string, Soma>() };
    c.qtd += 1;
    c.c += valor;
    for (const f of formas) {
      somarEm(c.formas, f.forma, cent(f.valor));
      somarEm(b.formas, f.forma === PAGO_ONLINE ? `${PAGO_ONLINE} ${canal}` : f.forma, cent(f.valor));
      somarEm(porForma, f.forma === PAGO_ONLINE ? `${PAGO_ONLINE} ${canal}` : f.forma, cent(f.valor));
    }
    if (cCupom > 0) {
      somarEm(c.formas, CUPOM_DA_PLATAFORMA, cCupom);
      somarEm(b.formas, CUPOM_DA_PLATAFORMA, cCupom);
      somarEm(cupomDaPlataforma, canal, cCupom);
    }
    porCanal.set(canal, c);
    return b;
  };

  /** O que o pedido traz além do pagamento: cupom da loja, taxa, fiado, entrega. */
  const registrarPedido = (o: any, canal: string, tipo: TipoDeVenda, formas: Forma[], bloco: Bloco, cupom: number) => {
    const valor = formas.reduce((s, f) => s + cent(f.valor), 0);
    const daLoja = cent(o.discountMerchant);
    if (daLoja > 0) {
      cupomDaLoja.qtd += 1;
      cupomDaLoja.c += daLoja;
      somarEm(cupomDaLoja.porCanal, canal, daLoja);
      bloco.desconto += daLoja;
      bloco.descontoQtd += 1;
    }
    const taxa = cent(o.deliveryFee);
    if (taxa > 0) {
      taxaDeEntrega.qtd += 1;
      taxaDeEntrega.c += taxa;
      bloco.taxa += taxa;
      bloco.taxaQtd += 1;
    }
    // O valor dos produtos é o dos ITENS (preço × quantidade, a régua do Itens
    // vendidos). Pedido sem itens gravados não inventa nada: os produtos são o
    // que sobra do total depois da taxa e do desconto, e o ajuste fica zero.
    const itens = Array.isArray(o.items) && o.items.length > 0 ? cent(totalDosItens(o)) : null;
    bloco.produtos += itens ?? (valor + Math.max(0, cent(cupom)) - taxa + Math.max(0, daLoja));
    const fiadoDoPedido = formas.filter((f) => f.forma === "Fiado").reduce((s, f) => s + cent(f.valor), 0);
    if (fiadoDoPedido > 0) {
      fiado.push({
        hora: o.createdAt,
        numero: o.dailyOrderNumber != null ? `#${o.dailyOrderNumber}` : "",
        nome: quemComprouFiado(o),
        valor: reais(fiadoDoPedido),
      });
    }
    if (tipo === "DELIVERY") {
      // Entrega parceira (iFood/99 mandaram o entregador deles) não é do
      // motoboy da loja: nem prestação de contas, nem taxa a pagar.
      const quemEntrega = String(o.deliveryBy || "").toUpperCase();
      if (quemEntrega && quemEntrega !== "MERCHANT") {
        entregaParceira.qtd += 1;
        entregaParceira.c += valor;
      } else if (o.motoboyId) {
        entregasProprias.push({
          motoboyId: o.motoboyId,
          formas,
          pedido: { motoboyFee: o.motoboyFee ?? null, deliveryFee: o.deliveryFee ?? null, deliveryDistance: o.deliveryDistance ?? null },
          ehMarketplace: canalDoPedido(o).ehMarketplace,
        });
      } else {
        semEntregador.qtd += 1;
        semEntregador.c += valor;
      }
    }
  };

  // A conferência soma em CENTAVOS e só vira reais no fim: o total é a soma
  // das linhas por construção — antes ele somava o `totalAmount` do dividido
  // e a parte fiada ou não identificada dele entrava no total sem estar em
  // linha nenhuma (falta que nenhuma linha explicava).
  const esp = { cash: 0, debit: 0, credit: 0, pix: 0, voucher: 0, ifoodOnline: 0, food99Online: 0 };
  let fiadoC = 0, naoIdentificadoC = 0;

  // Uma parte de pagamento feita na loja (do balcão dividido, da baixa da mesa
  // ou o pedido inteiro) na linha da conferência da forma dela. Devolve o nome
  // da forma para o retrato contar a parte onde a conferência contou.
  const conferirParte = (chave: ChaveDaForma, v: number): string => {
    const linha = LINHA_DA_CONFERENCIA[chave];
    if (linha) {
      esp[linha] += cent(v);
    } else if (chave === "FIADO") {
      // Fiado: consumo da equipe e venda anotada. Tem ficha própria e é
      // acertado depois — nunca passa pela gaveta no fechamento do dia. Na
      // parte do dividido e na baixa da mesa ele era "não identificado".
      fiadoC += cent(v);
      foraDaConferencia.fiadoQtd += 1;
    } else {
      // Antes: `expected.cash += val`. Jogar o desconhecido na gaveta é
      // exatamente o que produz falta sem causa — o pedido de mesa com "N/A",
      // o "Pendente" do robô, o "99Food" de forma desconhecida, o rótulo que a
      // próxima integração inventar. Fica visível numa linha própria, fora da
      // conferência, até alguém identificar o que é.
      naoIdentificadoC += cent(v);
      foraDaConferencia.naoIdentificadoQtd += 1;
    }
    return NOME_DA_FORMA[chave];
  };

  for (const o of pedidos) {
    // ── PEDIDO DE MESA: O DINHEIRO ESTÁ NA MESA, NÃO NO PEDIDO ──────────
    //
    // O pedido de mesa nasce com paymentMethod "N/A" e nunca recebe a forma
    // real: a baixa (Dinheiro, Débito, Crédito, Pix) é gravada na SESSÃO da
    // mesa, no fechamento dela, junto com a taxa de serviço. Contar o pedido
    // aqui pela forma dele é contar "N/A" — foi assim que o fechamento da
    // Pastel da Paulista em 09/09 mostrou 26 pedidos "não identificados" e
    // R$ 1.416,69 fora da conferência, com a caixa sem conseguir fechar.
    //
    // Então o pedido de mesa sai deste laço. Mesa já FECHADA: o valor entra
    // pelas baixas da sessão, por forma, no bloco logo depois do laço. Mesa
    // ainda ABERTA: ninguém pagou nada ainda; vira a linha "mesas abertas",
    // informação para o lojista saber que existe conta em andamento.
    if (o.tableSessionId) {
      const fechado = o.status === "ENTREGUE" || o.status === "ENCERRADO";
      if (!fechado) {
        foraDaConferencia.mesasAbertas += o.totalAmount || 0;
        foraDaConferencia.mesasAbertasQtd += 1;
      }
      continue;
    }

    const canal = canalNoPapel(o);
    const tipo = tipoDeVenda(o);

    // O cupom que a PLATAFORMA pagou neste pedido — a conta do relatório
    // Formas de pagamento (`cupomDaPlataforma`): o campo do iFood (e do 99 desde
    // 17/09/2026), o total menos a loja, o "iFood: R$" das observações e, no
    // 99Food antigo, as promoções gravadas (lib/cupom-do-parceiro.ts).
    const channelDisc = cupomPagoPelaPlataforma(o);
    // -- O CUPOM DA PLATAFORMA NAO ENTRA NA GAVETA -----------------------
    //
    // Era `val = totalAmount + channelDisc` para TODAS as linhas: o desconto
    // bancado pelo iFood voltava para dentro do valor do pedido e passava a
    // ser cobrado de quem confere. Em 45 dias, R$ 43.245,98 somados ao
    // esperado, dos quais R$ 7.522,67 foram parar em linha que alguem tem
    // que conferir de verdade -- gaveta, debito, credito e pix. O cliente
    // que pagou R$ 30 com R$ 10 de cupom entrega R$ 20; a gaveta nao sabe o
    // que e cupom.
    //
    // `valReal` e o que a pessoa entrega -- e ele que vai para as linhas
    // conferiveis. `valRepasse` so existe na linha do iFood pago online, que
    // e informativa e travada na tela: ali o cupom faz parte do que a
    // plataforma repassa.
    const valReal = o.totalAmount || 0;
    const valRepasse = valReal + channelDisc;

    // ── PEDIDO SEM PAGAMENTO NÃO É DINHEIRO NA GAVETA ───────────────────
    //
    // O esperado somava todo pedido que não estivesse CANCELADO, e
    // AGUARDANDO_PAGAMENTO estava nesse bolo. O pedido do totem NASCE nesse
    // status, antes de o cartão passar (/api/totem/order), e nada o cancela
    // depois: quem desiste na tela da maquininha, tem o cartão recusado ou
    // vai embora com a senha do "pagar no caixa" deixa o pedido parado aí
    // para sempre. Como "Cartão (Maquininha)" e "Pagar no caixa" não casam
    // com nenhuma forma conhecida, ele caía no `else` lá embaixo e virava
    // DINHEIRO esperado — o fechamento cobrava da gaveta um valor que
    // ninguém entregou e o operador via "Faltam R$ X" sem pista nenhuma do
    // motivo. Num dia de totem isso não é um pedido: são vários.
    //
    // É a mesma classe de defeito já corrigida no DRE (ver o comentário do
    // saldo fantasma da Hakim Centro em src/app/store/financeiro/
    // DREClient.tsx): nome de forma de pagamento é intenção, não prova. Aqui
    // a prova é o status — quem paga sai de AGUARDANDO_PAGAMENTO dentro de
    // confirmOrderPayment, seja pelo webhook, pela maquininha ou pela mão do
    // atendente. Todo o resto do sistema (KDS, fila de impressão, poll,
    // numeração) já ignorava esse status; o caixa era o único que somava.
    //
    // Some do esperado, mas não some da tela: volta em `pendentesDePagamento`
    // para o lojista enxergar o que ficou pendurado sem que isso vire
    // diferença de caixa.
    if (o.status === "AGUARDANDO_PAGAMENTO") {
      pendentesValor += valReal;
      pendentesQuantidade += 1;
      continue;
    }

    // ── PAGAMENTO DIVIDIDO (BALCÃO) ─────────────────────────────────────
    //
    // Metade no Pix, metade em dinheiro: cada parte vai para a SUA linha da
    // conferência, pela forma escrita nela (`formaDoTexto`, a régua do
    // relatório). Ler o `paymentMethod` de texto ("Dividido: Pix R$ 20,00 +
    // Dinheiro R$ 15,00") jogaria o pedido inteiro na primeira forma que
    // casasse. A parte "Fiado" vai para o fiado (era "não identificada").
    const divisao = lerPagamentos(o.paymentMethods);
    if (divisao.length > 0) {
      const formas = divisao.map((p) => ({ forma: conferirParte(formaDoTexto(p.method), p.amount), valor: p.amount }));
      const bloco = registrarVenda(canal, tipo, formas, 0);
      registrarPedido(o, canal, tipo, formas, bloco, 0);
      continue;
    }

    // ── A FORMA DO PEDIDO: A RÉGUA DO RELATÓRIO ─────────────────────────
    //
    // `formaDoPedido` = foi pago online (`foiPagoOnline`)? Senão, a cascata do
    // texto (`formaDoTexto`). Os casos que já custaram diferença de caixa
    // moram lá, num lugar só, e valem igual aqui, no relatório e no acerto:
    //   • venda de salão (PDV, totem) não é pago online pelo carimbo de pago —
    //     o cartão passa na maquininha da loja, e o dinheiro do "pagar no
    //     caixa" é da gaveta (o totem caía inteiro no "iFood (Pago Online)");
    //   • a forma trocada na entrega ("Pix", "Vale-refeição") é pagamento na
    //     porta (pix-trocado-na-entrega-nao-e-online), e o "CASH" cru do iFood
    //     é dinheiro — aqui ele ia para o pago online;
    //   • "Cartão Deb Master" (Wabiz) é débito e "Cartão Alimentação/Refeição"
    //     é vale — aqui viravam crédito; o cartão sem o tipo (o Mercado Pago
    //     Point não devolve) continua crédito, a linha que se confere contra o
    //     extrato da adquirente;
    //   • o que ninguém reconhece ("N/A", "Pendente", "99Food" de pay_type
    //     desconhecido) fica "não identificado", nunca na gaveta nem no vale.
    const chave = formaDoPedido(o);
    let forma: string;
    if (chave === "ONLINE") {
      // Pago no app ou no site: não passa pela gaveta nem pela maquininha. O
      // 99Food em linha própria: o lojista confere o repasse do 99 contra o
      // extrato DELES — somados ao do iFood, os dois números não conferem com
      // nenhum dos dois extratos.
      if (ehDo99Food(o)) esp.food99Online += cent(valRepasse);
      else esp.ifoodOnline += cent(valRepasse);
      forma = PAGO_ONLINE;
      somarEm(onlinePorCanal, canal, cent(valRepasse));
      if (!canalDoPedido(o).ehMarketplace) onlineProprio += valRepasse;
    } else {
      forma = conferirParte(chave, valReal);
    }

    // O cupom que a plataforma pagou NESTE pedido, no retrato. É o mesmo
    // `channelDisc` que a conferência somou no repasse do pago online.
    const formas = [{ forma, valor: valReal }];
    const bloco = registrarVenda(canal, tipo, formas, channelDisc);
    registrarPedido(o, canal, tipo, formas, bloco, channelDisc);

    // Desconto custeado pela PLATAFORMA — informativo, nunca entra na gaveta.
    //
    // O iFood manda em campo proprio. O 99Food nao manda nada equivalente: o
    // que ele manda e a lista de promocoes com `shop_subside_price`, quanto
    // daquele desconto saiu do bolso da LOJA. O resto e dinheiro deles.
    // O dado ja estava gravado desde sempre em discountDetails.promocoes —
    // so nunca tinha sido lido (lib/cupom-do-parceiro.ts).
    //
    // ── O CUPOM DO 99 ERA CONTADO DUAS VEZES ────────────────────────────
    //
    // Desde 17/09/2026 o 99Food também grava a parte DELE em
    // `discountIfood` (nome histórico: "desconto do parceiro"), e esta linha
    // somava o campo sem olhar o canal. O cupom do 99 entrava na linha do
    // iFood E na do 99Food. Não mexia no dinheiro — as duas linhas são
    // informativas —, mas o lojista lia um cupom do iFood que o iFood nunca
    // pagou.
    if (!ehDo99Food(o) && o.discountIfood && o.discountIfood > 0) {
      expected.ifoodCoupons += o.discountIfood;
    }
    const do99 = cupomBancadoPelo99(o);
    if (do99 > 0) expected.food99Coupons += do99;
  }

  // ── AS BAIXAS DAS MESAS FECHADAS NESTE TURNO ──────────────────────────
  //
  // É aqui que o dinheiro da mesa entra na conferência — por forma, como o
  // garçom registrou, e já com a taxa de serviço (que não existe em pedido
  // nenhum, só na sessão). O critério é a mesa ter FECHADO depois de o caixa
  // abrir: uma mesa aberta às 20h e paga às 23h é dinheiro deste turno, e a
  // data do pedido não diz isso — a do fechamento diz.
  for (const mesa of mesasFechadas) {
    const baixas: { chave: ChaveDaForma; forma: string; valor: number }[] = lerPagamentos(mesa.paymentMethods)
      .map((p) => { const chave = formaDoTexto(p.method); return { chave, forma: NOME_DA_FORMA[chave], valor: p.amount }; });
    const servico = Number(mesa.serviceFee || 0);
    const gorjeta = Number(mesa.waiterTip || 0);
    if (servico > 0) { mesas.servico += cent(servico); mesas.servicoQtd += 1; }
    mesas.gorjeta += cent(gorjeta);
    // Uma conta de mesa é UMA venda no retrato, com as baixas nas formas.
    if (baixas.length === 0) continue;

    // ── A MESA ENTRA SEM O TROCO — NO RETRATO E NA CONFERÊNCIA ───────────
    //
    // A baixa grava a NOTA que o cliente entregou (pago-da-mesa-inclui-troco);
    // o que passou de consumo + serviço + gorjeta voltou como troco, DESTA
    // gaveta. Até 11/10/2026 só o retrato tirava o troco: a conferência
    // cobrava a nota inteira, e a falta do tamanho do troco aparecia todo dia
    // sem explicação — 32 turnos e R$ 3.113,52 em 30 dias (Delícias da Maria,
    // R$ 1.916,50; Mesa 3 de 10/10 consumiu R$ 7 e a baixa "Dinheiro 100"
    // fazia a gaveta esperar R$ 100). Agora a conferência recebe as baixas já
    // sem o troco (trocoDaConta, a mesma regra do relatório Formas de
    // pagamento). Sem os pedidos da conta não há consumo para comparar, e a
    // baixa vai inteira.
    const consumo = mesa.orders
      ? mesa.orders
          .filter((o) => situacaoDoPedido(o.status) === "venda" && !temValorImpossivel(o))
          .reduce((s, o) => s + cent(o.totalAmount), 0)
      : null;
    const { formas: semTroco, troco } = consumo != null
      ? trocoDaConta({ formas: baixas, consumo: reais(consumo), servico, gorjeta })
      : { formas: baixas as Forma[], troco: 0 };
    // Forma que a mesa gravou e o caixa não soube ler: continua visível, fora
    // da conferência, em vez de sumir na gaveta (conferirParte).
    const chaveDoNome = new Map(baixas.map((b) => [b.forma, b.chave]));
    const formas: Forma[] = semTroco.map((f) => ({ forma: conferirParte(chaveDoNome.get(f.forma) ?? "OUTROS", f.valor), valor: f.valor }));
    const bloco = registrarVenda("Mesa", "MESA", formas, 0);
    const servicoCobrado = Math.max(0, cent(servico));
    const gorjetaCobrada = Math.max(0, cent(gorjeta));
    if (servicoCobrado > 0) { bloco.servico += servicoCobrado; bloco.servicoQtd += 1; }
    bloco.gorjeta += gorjetaCobrada;
    if (cent(troco) > 0) {
      bloco.troco += cent(troco); bloco.trocoQtd += 1;
      mesas.troco += cent(troco); mesas.trocoQtd += 1;
    }
    const recebido = formas.reduce((s, f) => s + cent(f.valor), 0);
    if (consumo != null) {
      bloco.produtos += consumo;
      // A conta fechada ABAIXO de consumo + serviço + gorjeta é desconto no
      // fechamento (ele não é gravado; a taxa negativa das contas antigas cai
      // aqui também). Acima, sem troco a devolver, é pago a mais no cartão ou
      // no Pix: fica nos ajustes, que o bloco calcula sozinho.
      const resto = recebido - consumo - servicoCobrado - gorjetaCobrada;
      if (resto < -1) { bloco.desconto += -resto; bloco.descontoQtd += 1; }
    } else {
      bloco.produtos += recebido - servicoCobrado - gorjetaCobrada;
    }
  }

  // A conferência em reais. O total é a soma das linhas, por construção.
  expected.cash = reais(esp.cash);
  expected.debit = reais(esp.debit);
  expected.credit = reais(esp.credit);
  expected.pix = reais(esp.pix);
  expected.voucher = reais(esp.voucher);
  expected.ifoodOnline = reais(esp.ifoodOnline);
  expected.food99Online = reais(esp.food99Online);
  expected.total = reais(esp.cash + esp.debit + esp.credit + esp.pix + esp.voucher + esp.ifoodOnline + esp.food99Online);
  expected.ifoodCoupons = reais(cent(expected.ifoodCoupons));
  expected.food99Coupons = reais(cent(expected.food99Coupons));
  foraDaConferencia.fiado = reais(fiadoC);
  foraDaConferencia.naoIdentificado = reais(naoIdentificadoC);
  foraDaConferencia.mesasAbertas = reais(cent(foraDaConferencia.mesasAbertas));

  const blocos: BlocoDoTipo[] = ORDEM_DOS_TIPOS.filter((t) => porTipo.has(t)).map((t) => {
    const b = porTipo.get(t)!;
    // O ajuste é o que sobra para a conta do bloco fechar — calculado, nunca
    // estimado: produtos + taxa + serviço + gorjeta − desconto + ajustes = total.
    const ajustes = b.c - b.produtos - b.taxa - b.servico - b.gorjeta + b.desconto;
    return {
      chave: t,
      nome: NOME_DO_TIPO[t],
      qtd: b.qtd,
      valor: reais(b.c),
      formas: listar(b.formas),
      canais: listar(b.canais),
      produtos: reais(b.produtos),
      taxaDeEntrega: { qtd: b.taxaQtd, valor: reais(b.taxa) },
      servico: { qtd: b.servicoQtd, valor: reais(b.servico) },
      gorjeta: reais(b.gorjeta),
      desconto: { qtd: b.descontoQtd, valor: reais(b.desconto) },
      ajustes: Math.abs(ajustes) > 0 ? reais(ajustes) : 0,
      troco: { qtd: b.trocoQtd, valor: reais(b.troco) },
    };
  });

  return {
    expected,
    foraDaConferencia,
    pendentesValor,
    pendentesQuantidade,
    onlineProprio,
    entregasProprias,
    retrato: {
      vendas: { qtd: vendas.qtd, valor: reais(vendas.c) },
      porForma: listar(porForma),
      porCanal: [...porCanal.entries()]
        .map(([nome, c]) => ({ nome, qtd: c.qtd, valor: reais(c.c), formas: listar(c.formas) }))
        .sort((a, b) => b.valor - a.valor),
      porTipo: blocos,
      cupomDaLoja: { qtd: cupomDaLoja.qtd, valor: reais(cupomDaLoja.c), porCanal: listar(cupomDaLoja.porCanal) },
      cupomDaPlataforma: listar(cupomDaPlataforma),
      onlinePorCanal: listar(onlinePorCanal),
      taxaDeEntrega: { qtd: taxaDeEntrega.qtd, valor: reais(taxaDeEntrega.c) },
      mesas: { servico: reais(mesas.servico), servicoQtd: mesas.servicoQtd, gorjeta: reais(mesas.gorjeta), troco: reais(mesas.troco), trocoQtd: mesas.trocoQtd },
      fiado,
      entregaParceira: { qtd: entregaParceira.qtd, valor: reais(entregaParceira.c) },
      semEntregador: { qtd: semEntregador.qtd, valor: reais(semEntregador.c) },
    },
  };
}
