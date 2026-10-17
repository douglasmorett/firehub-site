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
import { ehEntregaDaLoja, partesDaEntrega, trocoLevadoDaParte, trocoNoPixDaParte } from "@/lib/resumo-do-entregador";
import { lerPagamentos } from "@/lib/pagamentos-da-mesa";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { tipoDeVenda, type TipoDeVenda } from "@/lib/relatorios/base";
import {
  atendimentosDaVenda, descontoNoFechamento, ehReposicao, entraNaVenda, situacaoDoPedido, temValorImpossivel, ticketMedio, totalDosItens,
} from "@/lib/relatorios/regua-da-venda";
import { cupomDaPlataforma as cupomPagoPelaPlataforma, formaDoPedido, formaDoTexto, type ChaveDaForma } from "@/lib/relatorios/formas-de-pagamento";
import type { BlocoDoTipo, DetalheDoTurno, ParteDoRetrato } from "@/lib/cupom-do-caixa";

/** A forma de quem já pagou pelo app ou pelo site. No papel ela leva o canal junto. */
export const PAGO_ONLINE = "Pago online";
/**
 * O que o entregador do APP (iFood/99) cobrou na porta: o cliente pagou em
 * dinheiro ou na maquininha DELE, e o app acerta com a loja no repasse. Não
 * passa pela gaveta nem pela maquininha da loja.
 */
export const COBRADO_PELO_APP = "Cobrado pelo entregador";
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
  /** Sem o id, a mesa ainda aberta sai pelo status do pedido, não pela conta. */
  id?: string;
  paymentMethods: unknown;
  serviceFee: number | null;
  waiterTip: number | null;
  /** O que a conta recebeu (com o troco) e quando fechou: o desconto do fechamento (`descontoNoFechamento`). */
  totalPaid?: number | null;
  closedAt?: Date | string | null;
  /** Os pedidos da conta, para o consumo (troco e desconto). Sem eles, o bloco não separa troco. */
  orders?: { id?: string; status: string | null; totalAmount: number | null; discountTotal?: number | null }[];
};

export type EntregaPropria = {
  motoboyId: string;
  formas: Forma[];
  /** `customerAddress`: no pedido de app pago pela tabela, o bairro sai dele (lib/ganho-do-entregador.ts). */
  pedido: { motoboyFee: number | null; deliveryFee: number | null; deliveryDistance: number | null; entregaGratis?: unknown; customerAddress?: string | null };
  ehMarketplace: boolean;
  /** O troco que o motoboy levou da loja para a nota do cliente ("troco para 100"): ele devolve junto. */
  trocoLevado: number;
  /**
   * Troco feito pelo Pix DA LOJA: a parte da nota que passa do pedido. Ele a
   * entrega junto com o dinheiro dos pedidos, mas não é troco levado
   * (lib/troco-no-pix.ts). Opcional para o papel montado à mão.
   */
  trocoNoPixDaLoja?: number;
  /** Troco feito pelo Pix DO MOTOBOY: ele ficou com essa parte da nota. */
  trocoNoPixDoMotoboy?: number;
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
    "taxaDeEntrega" | "mesas" | "fiado" | "entregaParceira" | "semEntregador" | "cobradoPeloApp" | "dinheiroCobradoPeloApp" | "trocoNoPix"> &
    Required<Pick<DetalheDoTurno, "recebido" | "ponte" | "descontoNasMesas">>;
};

/** O acumulador de um bloco de tipo, em centavos. */
type Bloco = {
  qtd: number; c: number; formas: Map<string, Soma>; canais: Map<string, Soma>;
  produtos: number; taxa: number; taxaQtd: number; servico: number; servicoQtd: number; gorjeta: number;
  desconto: number; descontoQtd: number; troco: number; trocoQtd: number;
  /** O cupom que a plataforma pagou nas vendas deste tipo: abate dos produtos, fora do total. */
  cupom: number; cupomQtd: number;
  /** Do que sobra para a conta fechar, a parte dos pedidos de marketplace (a taxa de serviço do app). */
  ajustesDoApp: number;
};

export function apurarVendasDoTurno(todos: any[], mesasFechadas: MesaDoTurno[]): ApuracaoDasVendas {
  // ── REPOSIÇÃO NÃO É VENDA ───────────────────────────────────────────────
  // O pedido de reposição (faltou item / troca, R$ 0,00, "Pago Online (reposição
  // do #N)") não entra em venda, forma de pagamento nem tipo do papel (o dono,
  // 16/10/2026). A corrida dele continua: o motoboy rodou e o acerto paga
  // (lib/relatorios/sem-reposicao.ts).
  const pedidos = todos.filter((o) => !ehReposicao(o));
  const reposicoes = todos.filter((o) => ehReposicao(o));
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
  // Duas bases, cada uma com o seu nome:
  //
  //   • RECEBIDO — a mesma base da conferência: pedido sem mesa e já pago (ou
  //     fiado), mais as contas de mesa FECHADAS no turno, pelas baixas (sem o
  //     troco). A soma das formas, a dos canais e a dos tipos dão o mesmo
  //     TOTAL RECEBIDO, e o papel não se contradiz.
  //   • FATURADO — a régua única dos relatórios (lib/relatorios/regua-da-venda.ts):
  //     Σ `totalAmount` dos pedidos do turno que são venda, a mesa pelo lançado
  //     (aberta ou fechada), sem o cupom que a plataforma pagou; vendas =
  //     atendimentos (a mesa conta uma vez). Até 11/10/2026 o "TOTAL FATURADO"
  //     do caixa era o recebido MAIS o cupom da plataforma: Hakim, 10/10,
  //     R$ 2.347,27 no papel × R$ 1.883,53 nos relatórios (R$ 463,74 de cupom
  //     do iFood). O lojista que confere o papel contra o relatório desconfia
  //     dos dois.
  //
  // A diferença entre os dois é explicada linha a linha (`ponte`): taxa de
  // serviço e gorjeta das mesas, desconto no fechamento, mesa ainda aberta,
  // lançamento de antes do caixa abrir, pago a mais e centavos do dividido.
  const porForma = new Map<string, Soma>();
  const porCanal = new Map<string, { qtd: number; c: number; formas: Map<string, Soma> }>();
  const porTipo = new Map<TipoDeVenda, Bloco>();
  const cupomDaPlataforma = new Map<string, Soma & { noOnline: number; qtdNoOnline: number }>();
  const cupomDaLoja = { qtd: 0, c: 0, porCanal: new Map<string, Soma>() };
  const onlinePorCanal = new Map<string, Soma>();
  const cobradoPeloApp = new Map<string, Soma>();
  let dinheiroCobradoPeloApp = 0;
  const taxaDeEntrega = { qtd: 0, c: 0 };
  // Troco feito pelo Pix (lib/troco-no-pix.ts), em centavos: o da loja mexe na
  // conferência (nota inteira na gaveta; o Pix sai da conta, fora do caixa); o do motoboy é
  // só informação — a gaveta recebe o pedido, como sempre esperou.
  const trocoNoPix = { qtd: 0, c: 0, motoboyQtd: 0, motoboyC: 0 };
  const mesas = { servico: 0, servicoQtd: 0, gorjeta: 0, troco: 0, trocoQtd: 0 };
  const recebido = { qtd: 0, c: 0 };
  // A régua única: o valor vendido do turno e o lançado em cada conta de mesa.
  let faturadoC = 0;
  const lancadoNaConta = new Map<string, number>();
  let centavosDoDividido = 0;
  // As contas fechadas neste caixa. Sem os ids (quem chama não mandou), a mesa
  // aberta sai pelo status do pedido, como era.
  const idsFechadas = mesasFechadas.every((m) => m.id) ? new Set(mesasFechadas.map((m) => m.id as string)) : null;
  const fiado: DetalheDoTurno["fiado"] = [];
  const entregaParceira = { qtd: 0, c: 0 };
  const semEntregador = { qtd: 0, c: 0 };
  const entregasProprias: EntregaPropria[] = [];

  const blocoDo = (tipo: TipoDeVenda): Bloco => {
    let b = porTipo.get(tipo);
    if (!b) {
      b = { qtd: 0, c: 0, formas: new Map(), canais: new Map(), produtos: 0, taxa: 0, taxaQtd: 0, servico: 0, servicoQtd: 0, gorjeta: 0, desconto: 0, descontoQtd: 0, troco: 0, trocoQtd: 0, cupom: 0, cupomQtd: 0, ajustesDoApp: 0 };
      porTipo.set(tipo, b);
    }
    return b;
  };

  /**
   * Uma venda no RECEBIDO. O canal e o tipo contam a venda uma vez; cada parte
   * do pagamento conta na sua forma. O cupom que a plataforma pagou NÃO entra
   * no valor (desde 11/10/2026): ele vai para a linha própria "cupom pago pela
   * plataforma", com quanto dele já está dentro do pago online da conferência
   * (`noOnline`) — no pedido pago na porta, ninguém o vê na gaveta: o app o
   * repassa depois.
   *
   * Devolve o bloco do tipo, para quem chamou somar os produtos, as taxas e o
   * desconto daquela venda.
   */
  const registrarVenda = (canal: string, tipo: TipoDeVenda, formas: Forma[], cupom: number): Bloco => {
    const cCupom = Math.max(0, cent(cupom));
    const valor = formas.reduce((s, f) => s + cent(f.valor), 0);
    recebido.qtd += 1;
    recebido.c += valor;
    const b = blocoDo(tipo);
    b.qtd += 1;
    b.c += valor;
    somarEm(b.canais, canal, valor);
    const c = porCanal.get(canal) || { qtd: 0, c: 0, formas: new Map<string, Soma>() };
    c.qtd += 1;
    c.c += valor;
    for (const f of formas) {
      somarEm(c.formas, f.forma, cent(f.valor));
      // O pago no app e o cobrado pelo entregador do app levam o canal no
      // nome: cada um se confere contra o extrato DAQUELE app.
      const nome = f.forma === PAGO_ONLINE || f.forma === COBRADO_PELO_APP ? `${f.forma} ${canal}` : f.forma;
      somarEm(b.formas, nome, cent(f.valor));
      somarEm(porForma, nome, cent(f.valor));
    }
    if (cCupom > 0) {
      b.cupom += cCupom;
      b.cupomQtd += 1;
      // Pago no app ou cobrado pelo entregador do app: o repasse da linha
      // travada já leva o que o app pagou de cupom.
      const noOnline = formas.some((f) => f.forma === PAGO_ONLINE || f.forma === COBRADO_PELO_APP);
      const atual = cupomDaPlataforma.get(canal) || { qtd: 0, c: 0, noOnline: 0, qtdNoOnline: 0 };
      atual.qtd += 1;
      atual.c += cCupom;
      if (noOnline) { atual.noOnline += cCupom; atual.qtdNoOnline += 1; }
      cupomDaPlataforma.set(canal, atual);
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
    // que sobra do total depois da taxa e dos descontos, e o ajuste fica zero.
    const cCupom = Math.max(0, cent(cupom));
    const itens = Array.isArray(o.items) && o.items.length > 0 ? cent(totalDosItens(o)) : null;
    const produtos = itens ?? (valor + cCupom - taxa + Math.max(0, daLoja));
    bloco.produtos += produtos;
    // O que sobra para a conta deste pedido fechar. No pedido de marketplace é
    // a taxa de serviço do app (iFood/99, varia — a-conta-do-pedido-nao-fecha-
    // sozinha); no da loja é o acréscimo do vale ou da maquininha do balcão
    // (venda-presencial soma "Taxa de vale (5%)" ao total) e centavos do
    // dividido. Separados, cada um com o seu nome no papel — o "taxa de serviço
    // do app" no bloco Balcão era o acréscimo do VR.
    if (canalDoPedido(o).ehMarketplace) bloco.ajustesDoApp += valor - (produtos + taxa - Math.max(0, daLoja) - cCupom);
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
      // motoboy da loja: nem prestação de contas, nem taxa a pagar. A régua é
      // a do acerto do motoboy (`ehEntregaDaLoja`, lib/resumo-do-entregador.ts):
      // o caixa olhava só `deliveryBy` e o acerto não olhava nada.
      if (!ehEntregaDaLoja(o)) {
        entregaParceira.qtd += 1;
        entregaParceira.c += valor;
      } else if (o.motoboyId) {
        // O troco levado: a nota do cliente menos o pedido, nas partes em
        // dinheiro (a mesma conta do acerto do motoboy, `partesDaEntrega`).
        // Com o troco feito pelo Pix não houve troco levado: ver
        // `trocoLevadoDaParte` e lib/troco-no-pix.ts.
        const partes = partesDaEntrega(o);
        const trocoLevado = partes.reduce((s, p) => s + cent(trocoLevadoDaParte(p)), 0);
        const pixDaLoja = partes.filter((p) => p.trocoNoPix === "LOJA").reduce((s, p) => s + cent(trocoNoPixDaParte(p)), 0);
        const pixDoMotoboy = partes.filter((p) => p.trocoNoPix === "MOTOBOY").reduce((s, p) => s + cent(trocoNoPixDaParte(p)), 0);
        entregasProprias.push({
          motoboyId: o.motoboyId,
          formas,
          pedido: { motoboyFee: o.motoboyFee ?? null, deliveryFee: o.deliveryFee ?? null, deliveryDistance: o.deliveryDistance ?? null, entregaGratis: o.entregaGratis, customerAddress: o.customerAddress ?? null },
          ehMarketplace: canalDoPedido(o).ehMarketplace,
          trocoLevado: reais(trocoLevado),
          ...(pixDaLoja > 0 ? { trocoNoPixDaLoja: reais(pixDaLoja) } : {}),
          ...(pixDoMotoboy > 0 ? { trocoNoPixDoMotoboy: reais(pixDoMotoboy) } : {}),
        });
      } else {
        semEntregador.qtd += 1;
        semEntregador.c += valor;
      }
    }
  };

  // ── O QUE O APP REPASSA POR UM PEDIDO ─────────────────────────────────────
  //
  // Era `totalAmount + cupom da plataforma`. Só que o `totalAmount` do iFood e
  // do 99 leva a TAXA DE SERVIÇO DO APP (o `service_price` do 99, os R$ 0,99 a
  // R$ 2,49 do iFood), que o cliente paga e o app guarda — a linha do online
  // dizia que a loja receberia o que não recebe (Brazza, pedido do 99: R$ 43,11
  // na linha × R$ 41,79 a receber). O devido à loja é o que ELA vendeu: itens +
  // taxa de entrega − o desconto que ELA deu (antes da comissão do app, que
  // nenhum pedido grava). Sem os itens gravados, fica a conta antiga. Canal
  // próprio (site, robô) não tem taxa de app: o gateway cobra o total.
  const repasseDoApp = (o: any, valReal: number, cupom: number): number => {
    const bruto = cent(valReal) + Math.max(0, cent(cupom));
    if (!canalDoPedido(o).ehMarketplace) return bruto;
    const itens = Array.isArray(o.items) && o.items.length > 0 ? cent(totalDosItens(o)) : null;
    if (itens == null) return bruto;
    return itens + cent(o.deliveryFee) - Math.max(0, cent(o.discountMerchant));
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
  // ── O TROCO FEITO PELO PIX NA CONFERÊNCIA ───────────────────────────────
  //
  // Pedido de R$ 40 pago com nota de R$ 50, troco de R$ 10 devolvido por Pix
  // (lib/troco-no-pix.ts). Sem a marca, a conta é a de sempre: o troco saiu
  // em cédula da gaveta e a nota voltou, então a gaveta fica com os R$ 40.
  //   • Pix DA LOJA: nenhuma cédula saiu, a nota inteira entrou: o dinheiro
  //     espera R$ 50. O Pix do troco saiu da CONTA da loja, que não é o caixa
  //     — decisão do Douglas (17/10/2026): "se for pelo Pix, não espera nada
  //     no caixa". A linha do Pix não ganha −R$ 10; o faturamento continua
  //     R$ 40 em dinheiro (retrato) e o caixa mostra a nota inteira.
  //   • Pix DO MOTOBOY: ele ficou com os R$ 10 da nota e entregou R$ 40 — o
  //     que a gaveta já esperava. Nada muda na conferência; fica a informação.
  // Só para a parte que passou pela gaveta da loja (`conferirParte`): o que o
  // entregador do app cobrou na porta nem entra aqui.
  const conferirTrocoNoPix = (o: any) => {
    for (const p of partesDaEntrega(o)) {
      const t = cent(trocoNoPixDaParte(p));
      if (t <= 0) continue;
      if (p.trocoNoPix === "LOJA") {
        esp.cash += t;
        trocoNoPix.qtd += 1;
        trocoNoPix.c += t;
      } else {
        trocoNoPix.motoboyQtd += 1;
        trocoNoPix.motoboyC += t;
      }
    }
  };

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
    //
    // ABERTA é a CONTA que não fechou neste caixa — não o pedido com status
    // diferente de entregue: o pedido da conta já paga que ficou "PRONTO" no
    // KDS aparecia como "mesa aberta" e, ao mesmo tempo, dentro do pago.
    if (entraNaVenda(o)) faturadoC += cent(o.totalAmount);
    if (o.tableSessionId) {
      const venda = entraNaVenda(o);
      if (venda) lancadoNaConta.set(o.tableSessionId, (lancadoNaConta.get(o.tableSessionId) || 0) + cent(o.totalAmount));
      const aberta = idsFechadas ? !idsFechadas.has(o.tableSessionId) : !(o.status === "ENTREGUE" || o.status === "ENCERRADO");
      if (aberta && venda) {
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
    // conferiveis. O repasse (`repasseDoApp`) so existe na linha do pago
    // online, que e informativa e travada na tela: ali o cupom faz parte do
    // que a plataforma repassa, e a taxa de servico do app nao.
    const valReal = o.totalAmount || 0;

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
      conferirTrocoNoPix(o);
      // As partes fecham com o total com 2 centavos de tolerância
      // (lib/pagamento-dividido.ts): a diferença vai para a ponte.
      centavosDoDividido += formas.reduce((s, f) => s + cent(f.valor), 0) - cent(o.totalAmount);
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
    // ── A ENTREGA DO APP COBRADA NA PORTA NÃO É DA GAVETA ───────────────
    //
    // Pedido do 99 (ou do iFood) entregue pelo entregador DELES e pago na
    // porta — "Dinheiro (cobrar na entrega)", "Débito (Cobrar na Entrega)": quem
    // recebe é o entregador do app, e o app acerta com a loja no repasse. A
    // gaveta cobrava esse dinheiro da loja: em 60 dias, 42 pedidos do 99
    // (R$ 2.796,31) e 43 do iFood (24 no débito, 14 no crédito, 5 em
    // dinheiro). Vai para a linha travada do app, com o seu nome.
    const peloEntregadorDoApp = chave !== "ONLINE" && chave !== "FIADO" && chave !== "OUTROS" && !ehEntregaDaLoja(o);
    let forma: string;
    if (chave === "ONLINE" || peloEntregadorDoApp) {
      // Pago no app ou no site: não passa pela gaveta nem pela maquininha. O
      // 99Food em linha própria: o lojista confere o repasse do 99 contra o
      // extrato DELES — somados ao do iFood, os dois números não conferem com
      // nenhum dos dois extratos.
      const repasse = repasseDoApp(o, valReal, channelDisc);
      if (ehDo99Food(o)) esp.food99Online += repasse;
      else esp.ifoodOnline += repasse;
      if (peloEntregadorDoApp) {
        forma = COBRADO_PELO_APP;
        somarEm(cobradoPeloApp, canal, repasse);
        if (chave === "DINHEIRO") dinheiroCobradoPeloApp += cent(valReal);
      } else {
        forma = PAGO_ONLINE;
        somarEm(onlinePorCanal, canal, repasse);
        if (!canalDoPedido(o).ehMarketplace) onlineProprio += reais(repasse);
      }
    } else {
      forma = conferirParte(chave, valReal);
      conferirTrocoNoPix(o);
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

  // A corrida da reposição: só o motoboy (entrega, taxa a pagar), sem dinheiro.
  for (const o of reposicoes) {
    if (situacaoDoPedido(o.status) !== "venda" || tipoDeVenda(o) !== "DELIVERY" || !o.motoboyId || !ehEntregaDaLoja(o)) continue;
    entregasProprias.push({
      motoboyId: o.motoboyId,
      formas: [],
      pedido: { motoboyFee: o.motoboyFee ?? null, deliveryFee: o.deliveryFee ?? null, deliveryDistance: o.deliveryDistance ?? null, entregaGratis: o.entregaGratis, customerAddress: o.customerAddress ?? null },
      ehMarketplace: false,
      trocoLevado: 0,
    });
  }

  // ── AS BAIXAS DAS MESAS FECHADAS NESTE TURNO ──────────────────────────
  //
  // É aqui que o dinheiro da mesa entra na conferência — por forma, como o
  // garçom registrou, e já com a taxa de serviço (que não existe em pedido
  // nenhum, só na sessão). O critério é a mesa ter FECHADO depois de o caixa
  // abrir: uma mesa aberta às 20h e paga às 23h é dinheiro deste turno, e a
  // data do pedido não diz isso — a do fechamento diz.
  // O que a ponte RECEBIDO → FATURADO precisa das contas, em centavos.
  const ponteDaMesa = { servico: 0, servicoQtd: 0, gorjeta: 0, gorjetaQtd: 0, desconto: 0, descontoQtd: 0, aMais: 0, aMaisQtd: 0, aMenos: 0, aMenosQtd: 0, deAntes: 0, deAntesQtd: 0 };
  for (const mesa of mesasFechadas) {
    const baixas: { chave: ChaveDaForma; forma: string; valor: number }[] = lerPagamentos(mesa.paymentMethods)
      .map((p) => { const chave = formaDoTexto(p.method); return { chave, forma: NOME_DA_FORMA[chave], valor: p.amount }; });
    const servico = Number(mesa.serviceFee || 0);
    const gorjeta = Number(mesa.waiterTip || 0);
    if (servico > 0) { mesas.servico += cent(servico); mesas.servicoQtd += 1; }
    mesas.gorjeta += cent(gorjeta);

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
    const validos = mesa.orders ? mesa.orders.filter((o) => situacaoDoPedido(o.status) === "venda" && !temValorImpossivel(o)) : null;
    const consumo = validos ? validos.reduce((s, o) => s + cent(o.totalAmount), 0) : null;
    // Conta fechada sem pagamento nenhum e sem consumo não é venda de ninguém.
    // Sem pagamento COM consumo é a cortesia (desconto de 100%): entra, com o
    // desconto à vista no bloco.
    if (baixas.length === 0 && !(consumo && consumo > 0)) continue;
    const { formas: semTroco, troco } = consumo != null
      ? trocoDaConta({ formas: baixas, consumo: reais(consumo), servico, gorjeta })
      : { formas: baixas as Forma[], troco: 0 };
    // Forma que a mesa gravou e o caixa não soube ler: continua visível, fora
    // da conferência, em vez de sumir na gaveta (conferirParte).
    const chaveDoNome = new Map(baixas.map((b) => [b.forma, b.chave]));
    const formas: Forma[] = semTroco.map((f) => ({ forma: conferirParte(chaveDoNome.get(f.forma) ?? "OUTROS", f.valor), valor: f.valor }));
    // Uma conta de mesa é UMA venda no recebido, com as baixas nas formas.
    const bloco = registrarVenda("Mesa", "MESA", formas, 0);
    const servicoCobrado = Math.max(0, cent(servico));
    const gorjetaCobrada = Math.max(0, cent(gorjeta));
    if (servicoCobrado > 0) { bloco.servico += servicoCobrado; bloco.servicoQtd += 1; ponteDaMesa.servico += servicoCobrado; ponteDaMesa.servicoQtd += 1; }
    if (gorjetaCobrada > 0) { ponteDaMesa.gorjeta += gorjetaCobrada; ponteDaMesa.gorjetaQtd += 1; }
    bloco.gorjeta += gorjetaCobrada;
    if (cent(troco) > 0) {
      bloco.troco += cent(troco); bloco.trocoQtd += 1;
      mesas.troco += cent(troco); mesas.trocoQtd += 1;
    }
    const recebidoDaConta = formas.reduce((s, f) => s + cent(f.valor), 0);
    if (consumo != null) {
      bloco.produtos += consumo;
      // ── O DESCONTO DO FECHAMENTO É O DA RÉGUA ──────────────────────────
      //
      // `descontoNoFechamento` (lib/relatorios/regua-da-venda.ts) é o desconto
      // que o relatório Cupons e descontos e o Vendas por período mostram:
      // consumo − (pago − serviço − gorjeta), nas contas fechadas desde
      // 13/09/2026, nunca mais que o consumo. O papel dizia "Desconto no
      // fechamento R$ 879" no bloco das mesas e o "Pago pela loja" não o
      // somava (Ragnar, 10/10: R$ 1.984,55 no papel × R$ 2.863,55 no
      // relatório). Agora é o mesmo número nos três lugares. O que a conta
      // recebeu acima disso (pago a mais no cartão/Pix) ou abaixo sem ser
      // desconto fica nos ajustes, cada um com o seu nome.
      const desconto = cent(descontoNoFechamento({
        id: mesa.id || "", serviceFee: servico, waiterTip: gorjeta, fechadaEm: mesa.closedAt ?? null,
        pago: mesa.totalPaid ?? baixas.reduce((s, b) => s + b.valor, 0), pedidos: mesa.orders,
      }));
      if (desconto > 0) {
        bloco.desconto += desconto; bloco.descontoQtd += 1;
        ponteDaMesa.desconto += desconto; ponteDaMesa.descontoQtd += 1;
      }
      const resto = recebidoDaConta - consumo - servicoCobrado - gorjetaCobrada + desconto;
      if (resto > 0) { ponteDaMesa.aMais += resto; ponteDaMesa.aMaisQtd += 1; }
      else if (resto < 0) { ponteDaMesa.aMenos += resto; ponteDaMesa.aMenosQtd += 1; }
      // O consumo de antes deste caixa: a conta fechou agora com pedidos
      // lançados antes de ele abrir (estão no recebido, não no faturado).
      const lancadoAgora = mesa.id ? (lancadoNaConta.get(mesa.id) ?? 0) : consumo;
      if (consumo - lancadoAgora !== 0) { ponteDaMesa.deAntes += consumo - lancadoAgora; ponteDaMesa.deAntesQtd += 1; }
    } else {
      bloco.produtos += recebidoDaConta - servicoCobrado - gorjetaCobrada;
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
    // estimado: produtos + taxa + serviço + gorjeta − desconto − cupom da
    // plataforma + ajustes = total.
    const ajustes = b.c - b.produtos - b.taxa - b.servico - b.gorjeta + b.desconto + b.cupom;
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
      cupomDaPlataforma: { qtd: b.cupomQtd, valor: reais(b.cupom) },
      ajustes: Math.abs(ajustes) > 0 ? reais(ajustes) : 0,
      ajustesDoApp: t === "MESA" ? 0 : reais(b.ajustesDoApp),
      troco: { qtd: b.trocoQtd, valor: reais(b.troco) },
    };
  });

  // ── O FATURADO, PELA RÉGUA ÚNICA ──────────────────────────────────────────
  // Vendas = atendimentos (a mesa uma vez, o acréscimo com o pai no turno não
  // abre venda nova); ticket = valor ÷ vendas. O MESMO número do Vendas por
  // período e do Faturamento por dia, para a mesma janela.
  const at = atendimentosDaVenda(pedidos.map((o, i) => ({
    id: String(o.id ?? `sem-id-${i}`), createdAt: o.createdAt, status: o.status, totalAmount: o.totalAmount,
    tableSessionId: o.tableSessionId ?? null, parentOrderId: o.parentOrderId ?? null, items: o.items,
  })));

  // ── A PONTE: POR QUE O RECEBIDO NÃO É O FATURADO ──────────────────────────
  // Cada linha é dinheiro que está num e não no outro; a última, se aparecer,
  // é o que nenhuma explica (e não devia existir).
  let abertas = 0, abertasQtd = 0;
  for (const [sessao, c] of lancadoNaConta) {
    if (idsFechadas && !idsFechadas.has(sessao)) { abertas += c; abertasQtd += 1; }
  }
  const ponte: NonNullable<DetalheDoTurno["ponte"]> = [];
  const naPonte = (chave: string, rotulo: string, qtd: number, centavos: number) => {
    if (centavos !== 0) ponte.push({ chave, rotulo, qtd, valor: reais(centavos) });
  };
  naPonte("SERVICO", "Taxa de servico das mesas", ponteDaMesa.servicoQtd, ponteDaMesa.servico);
  naPonte("GORJETA", "Gorjeta das mesas", ponteDaMesa.gorjetaQtd, ponteDaMesa.gorjeta);
  naPonte("DESCONTO_MESA", "Desconto no fechamento das mesas", ponteDaMesa.descontoQtd, -ponteDaMesa.desconto);
  naPonte("MESA_ABERTA", "Lancado em mesa ainda aberta", abertasQtd, -abertas);
  naPonte("MESA_DE_ANTES", "Lancado antes deste caixa, conta fechada nele", ponteDaMesa.deAntesQtd, ponteDaMesa.deAntes);
  naPonte("SOBRA", "Pago a mais nas mesas (cartao ou Pix)", ponteDaMesa.aMaisQtd, ponteDaMesa.aMais);
  naPonte("MESA_A_MENOS", "Mesa fechada recebendo menos que a conta", ponteDaMesa.aMenosQtd, ponteDaMesa.aMenos);
  naPonte("DIVIDIDO", "Centavos do pagamento dividido", 0, centavosDoDividido);
  const explicado = ponte.reduce((s, l) => s + cent(l.valor), 0);
  naPonte("OUTROS", "Outras diferencas", 0, recebido.c - faturadoC - explicado);

  return {
    expected,
    foraDaConferencia,
    pendentesValor,
    pendentesQuantidade,
    onlineProprio,
    entregasProprias,
    retrato: {
      vendas: { qtd: at.vendas, valor: reais(faturadoC), ticketMedio: ticketMedio(reais(faturadoC), at.vendas), lancamentos: at.lancamentos, mesas: at.mesas },
      recebido: { qtd: recebido.qtd, valor: reais(recebido.c) },
      ponte,
      porForma: listar(porForma),
      porCanal: [...porCanal.entries()]
        .map(([nome, c]) => ({ nome, qtd: c.qtd, valor: reais(c.c), formas: listar(c.formas) }))
        .sort((a, b) => b.valor - a.valor),
      porTipo: blocos,
      cupomDaLoja: { qtd: cupomDaLoja.qtd, valor: reais(cupomDaLoja.c), porCanal: listar(cupomDaLoja.porCanal) },
      descontoNasMesas: { qtd: ponteDaMesa.descontoQtd, valor: reais(ponteDaMesa.desconto) },
      cupomDaPlataforma: [...cupomDaPlataforma.entries()]
        .map(([nome, s]) => ({ nome, qtd: s.qtd, valor: reais(s.c), noOnline: reais(s.noOnline), qtdNoOnline: s.qtdNoOnline }))
        .sort((a, b) => b.valor - a.valor),
      onlinePorCanal: listar(onlinePorCanal),
      cobradoPeloApp: listar(cobradoPeloApp),
      dinheiroCobradoPeloApp: reais(dinheiroCobradoPeloApp),
      taxaDeEntrega: { qtd: taxaDeEntrega.qtd, valor: reais(taxaDeEntrega.c) },
      mesas: { servico: reais(mesas.servico), servicoQtd: mesas.servicoQtd, gorjeta: reais(mesas.gorjeta), troco: reais(mesas.troco), trocoQtd: mesas.trocoQtd },
      fiado,
      entregaParceira: { qtd: entregaParceira.qtd, valor: reais(entregaParceira.c) },
      semEntregador: { qtd: semEntregador.qtd, valor: reais(semEntregador.c) },
      ...(trocoNoPix.qtd > 0 || trocoNoPix.motoboyQtd > 0
        ? { trocoNoPix: { qtd: trocoNoPix.qtd, valor: reais(trocoNoPix.c), motoboyQtd: trocoNoPix.motoboyQtd, motoboyValor: reais(trocoNoPix.motoboyC) } }
        : {}),
    },
  };
}
