/**
 * O turno do caixa, apurado no servidor.
 *
 * Duas respostas saem da MESMA varredura dos pedidos:
 *
 *   • o ESPERADO — quanto a conferência cobra de cada forma de pagamento;
 *   • o RETRATO — o que o papel do fechamento conta ao lojista: faturamento
 *     por forma, venda por canal com o pagamento de cada um, tipo de venda,
 *     cupons da loja e das plataformas, fiado com o nome de quem comprou,
 *     entregadores, cancelados um a um e os mais vendidos.
 *
 * Mora aqui, e não na rota do caixa, porque agora são três a perguntar: a tela
 * (GET), o fechamento (PUT) e a 2ª via (api/cash-session/imprimir). A 2ª via
 * só tinha o que a sessão guarda — esperado e contado — e o papel reimpresso
 * saía sem nada do turno. Arquivo de rota do Next não pode exportar função.
 *
 * Uma varredura só, e não uma por seção do papel: duas contas feitas em
 * lugares diferentes divergem no primeiro caso que só uma delas trata, e aí o
 * papel diz um número no faturamento e outro na conferência. Aqui cada pedido
 * decide UMA forma de pagamento, e é essa forma que vai para a conferência e
 * para o retrato.
 */
import { prisma } from "@/lib/prisma";
import { cupomBancadoPelo99, ehDo99Food } from "@/lib/cupom-do-parceiro";
import { temEstruturaDeCaixa } from "@/lib/garantir-colunas";
import { lerPagamentos } from "@/lib/pagamentos-da-mesa";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { ehMesa, ehRetirada } from "@/lib/status-para-o-cliente";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { ganhoDoPedido, lerAcerto } from "@/lib/ganho-do-entregador";
import type { DetalheDoTurno, ParteDoRetrato } from "@/lib/cupom-do-caixa";

type Soma = { qtd: number; valor: number };
type Forma = { forma: string; valor: number };

/** A forma de quem já pagou pelo app ou pelo site. No papel ela leva o canal junto. */
export const PAGO_ONLINE = "Pago online";
const NAO_IDENTIFICADA = "Forma nao identificada";

const centavos = (n: number) => Math.round(n * 100) / 100;

const somarEm = (mapa: Map<string, Soma>, chave: string, valor: number, qtd = 1) => {
  const atual = mapa.get(chave) || { qtd: 0, valor: 0 };
  atual.qtd += qtd;
  atual.valor += valor;
  mapa.set(chave, atual);
};

const listar = (mapa: Map<string, Soma>): ParteDoRetrato[] =>
  [...mapa.entries()]
    .map(([nome, s]) => ({ nome, qtd: s.qtd, valor: centavos(s.valor) }))
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

/**
 * Entrega, retirada, balcão, mesa ou totem — o "resumo por tipo de venda".
 *
 * A venda de balcão do PDV grava deliveryType RETIRADA (a tela manda BALCAO
 * como RETIRADA), então quem separa balcão de retirada é o CANAL: retirada é o
 * cliente do site, do app ou do robô que vem buscar; balcão é quem comprou no
 * caixa.
 */
function tipoDaVenda(o: any): string {
  if (o.tableSessionId || ehMesa(o.deliveryType)) return "Mesa";
  const chave = canalDoPedido(o).chave;
  if (chave === "TOTEM") return "Totem";
  const t = String(o.deliveryType || "").toUpperCase();
  if (t === "DELIVERY" || t === "ENTREGA") return "Entrega";
  if (chave === "PDV") return "Balcao";
  if (ehRetirada(o.deliveryType)) return "Retirada";
  return "Outro tipo";
}

/** "Func. Joao" é como a venda presencial grava o nome no pedido fiado. */
function quemComprouFiado(o: any): string {
  const doCadastro = String(o.employeeName || "").trim();
  if (doCadastro) return doCadastro;
  const doPedido = String(o.customerName || "").replace(/^Func\.\s*/i, "").trim();
  return doPedido || "sem nome";
}

/** Quem cancelou, como o lojista fala. O iFood manda RESTAURANT/IFOOD/CUSTOMER. */
function quemCancelou(bruto: string | null | undefined): string | null {
  const q = String(bruto || "").toUpperCase().trim();
  if (!q) return null;
  if (q.includes("RESTAURANT") || q.includes("MERCHANT") || q.includes("LOJA")) return "loja";
  if (q.includes("CUSTOMER") || q.includes("CLIENTE")) return "cliente";
  if (q.includes("IFOOD")) return "iFood";
  if (q.includes("99")) return "99Food";
  return String(bruto).trim().toLowerCase();
}

/**
 * Esperado do turno: o que a loja vendeu desde que este caixa foi aberto,
 * separado por onde o dinheiro entra.
 *
 * Virou função porque a ABERTURA de um caixa novo também precisa disto: ela
 * encerra o turno anterior e, sem calcular, gravava um turno inteiro com tudo
 * zerado (ver o comentário no POST de api/cash-session).
 *
 * `ate` fecha a janela: a 2ª via de um caixa já fechado passa o `closedAt`,
 * senão o papel reimpresso dias depois contaria as vendas dos dias seguintes.
 * `retrato` liga o que só o papel usa e custa consulta a mais (entregadores,
 * cancelados um a um, mais vendidos) — a tela consulta isto a cada abertura
 * do fechamento e não precisa de nada disso.
 */
export async function calcularEsperadoDoTurno(
  targetId: string,
  openSession: { id: string; openedAt: Date; openingAmount: number },
  opcoes: { ate?: Date | null; retrato?: boolean } = {}
) {
  const janela = { gte: openSession.openedAt, ...(opcoes.ate ? { lte: opcoes.ate } : {}) };

  // Se tem sessão aberta, calcular os valores esperados com base em TODOS os pedidos do período
  // `food99Online` e `food99Coupons` sao novos. Ficavam os dois dentro das
  // linhas do iFood — o dinheiro pago online no 99Food somava em
  // `ifoodOnline`, e o cupom bancado pelo 99 nao aparecia em lugar nenhum,
  // porque o 99Food nao manda campo equivalente ao `discountIfood`.
  let expected = { cash: 0, debit: 0, credit: 0, pix: 0, voucher: 0, ifoodOnline: 0, ifoodCoupons: 0, food99Online: 0, food99Coupons: 0, total: 0 };
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
  let foraDaConferencia = { fiado: 0, fiadoQtd: 0, naoIdentificado: 0, naoIdentificadoQtd: 0, mesasAbertas: 0, mesasAbertasQtd: 0 };
  // Pedidos do turno que ainda não têm pagamento nenhum. Ficam FORA do
  // esperado (ver o porquê no laço abaixo) e voltam aqui só para o lojista
  // saber que existem — informação, nunca conferência.
  let pendentesValor = 0;
  let pendentesQuantidade = 0;
  let movimentacaoEntradas = 0;
  let movimentacaoSaidas = 0;

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
  const porCanal = new Map<string, { qtd: number; valor: number; formas: Map<string, Soma> }>();
  const porTipo = new Map<string, Soma>();
  const cupomDaPlataforma = new Map<string, Soma>();
  const cupomDaLoja = { qtd: 0, valor: 0, porCanal: new Map<string, Soma>() };
  const onlinePorCanal = new Map<string, Soma>();
  const taxaDeEntrega = { qtd: 0, valor: 0 };
  const mesas = { servico: 0, servicoQtd: 0, gorjeta: 0 };
  const vendas = { qtd: 0, valor: 0 };
  const fiado: DetalheDoTurno["fiado"] = [];
  const entregaParceira = { qtd: 0, valor: 0 };
  const semEntregador = { qtd: 0, valor: 0 };
  type EntregaPropria = {
    motoboyId: string;
    formas: Forma[];
    pedido: { motoboyFee: number | null; deliveryFee: number | null; deliveryDistance: number | null };
    ehMarketplace: boolean;
  };
  const entregasProprias: EntregaPropria[] = [];
  let vendasEmDinheiro = 0;
  let reforcosQtd = 0;
  let sangriasQtd = 0;
  let movimentacoes: { tipo: string; valor: number; descricao: string | null; hora: Date }[] = [];
  let cancelados: DetalheDoTurno["cancelados"] = { qtd: 0, valor: 0, lista: [] };
  let entregadores: DetalheDoTurno["entregadores"] = [];
  let maisVendidos: ParteDoRetrato[] = [];

  /**
   * Uma venda no retrato. O canal e o tipo contam a VENDA uma vez; cada parte
   * do pagamento conta na sua forma. O cupom que a plataforma pagou entra como
   * se fosse mais uma forma: é dinheiro que ela repassa, e sem ele a soma do
   * canal não bate com o que o parceiro mostra no portal.
   */
  const registrarVenda = (canal: string, tipo: string, formas: Forma[], cupom: number) => {
    const valor = formas.reduce((s, f) => s + f.valor, 0) + cupom;
    vendas.qtd += 1;
    vendas.valor += valor;
    somarEm(porTipo, tipo, valor);
    const c = porCanal.get(canal) || { qtd: 0, valor: 0, formas: new Map<string, Soma>() };
    c.qtd += 1;
    c.valor += valor;
    for (const f of formas) {
      somarEm(c.formas, f.forma, f.valor);
      somarEm(porForma, f.forma === PAGO_ONLINE ? `${PAGO_ONLINE} ${canal}` : f.forma, f.valor);
    }
    if (cupom > 0) {
      somarEm(c.formas, "Cupom da plataforma", cupom);
      somarEm(cupomDaPlataforma, canal, cupom);
    }
    porCanal.set(canal, c);
  };

  /** O que o pedido traz além do pagamento: cupom da loja, taxa, fiado, entrega. */
  const registrarPedido = (o: any, canal: string, tipo: string, formas: Forma[]) => {
    const valor = formas.reduce((s, f) => s + f.valor, 0);
    const daLoja = Number(o.discountMerchant || 0);
    if (daLoja > 0) {
      cupomDaLoja.qtd += 1;
      cupomDaLoja.valor += daLoja;
      somarEm(cupomDaLoja.porCanal, canal, daLoja);
    }
    const taxa = Number(o.deliveryFee || 0);
    if (taxa > 0) {
      taxaDeEntrega.qtd += 1;
      taxaDeEntrega.valor += taxa;
    }
    const fiadoDoPedido = formas.filter((f) => f.forma === "Fiado").reduce((s, f) => s + f.valor, 0);
    if (fiadoDoPedido > 0) {
      fiado.push({
        hora: o.createdAt,
        numero: o.dailyOrderNumber != null ? `#${o.dailyOrderNumber}` : "",
        nome: quemComprouFiado(o),
        valor: centavos(fiadoDoPedido),
      });
    }
    if (tipo === "Entrega") {
      // Entrega parceira (iFood/99 mandaram o entregador deles) não é do
      // motoboy da loja: nem prestação de contas, nem taxa a pagar.
      const quemEntrega = String(o.deliveryBy || "").toUpperCase();
      if (quemEntrega && quemEntrega !== "MERCHANT") {
        entregaParceira.qtd += 1;
        entregaParceira.valor += valor;
      } else if (o.motoboyId) {
        entregasProprias.push({
          motoboyId: o.motoboyId,
          formas,
          pedido: { motoboyFee: o.motoboyFee ?? null, deliveryFee: o.deliveryFee ?? null, deliveryDistance: o.deliveryDistance ?? null },
          ehMarketplace: canalDoPedido(o).ehMarketplace,
        });
      } else {
        semEntregador.qtd += 1;
        semEntregador.valor += valor;
      }
    }
  };

  if (openSession) {
    const orders = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: targetId,
        // CRIANDO_IA é rascunho que o assistente ainda está montando: não é
        // pedido, não tem valor fechado e não pode entrar em conta nenhuma.
        // AGUARDANDO_PAGAMENTO continua vindo de propósito, para ser separado
        // no laço em vez de sumir sem explicação.
        status: { notIn: ["CANCELADO", "CRIANDO_IA"] },
        createdAt: janela,
      },
      // Os campos de identificação de canal (ifood*, openDelivery*) entram
      // porque `chaveDoCanal` lê todos eles: sem um deles, o pedido do parceiro
      // cai em "Outro canal" no papel do fechamento. Os do fim (número, nome,
      // entrega, motoboy) são do retrato: fiado com nome e entregadores.
      select: { status: true, paymentMethod: true, paymentMethods: true, totalAmount: true, source: true, paymentPaidAt: true, gatewayProvider: true, deliveryFee: true, discountIfood: true, discountTotal: true, discountMerchant: true, notes: true, tableSessionId: true, openDeliveryChannel: true, discountDetails: true,
        ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryReference: true,
        createdAt: true, dailyOrderNumber: true, customerName: true, employeeName: true, deliveryType: true, deliveryBy: true, motoboyId: true, motoboyFee: true, deliveryDistance: true },
    });

    // Uma parte de pagamento (do balcão dividido) na sua forma. A mesma régua
    // do laço abaixo, para as duas nunca divergirem. Devolve o nome da forma
    // para o retrato contar a parte onde a conferência contou.
    const somarParte = (metodo: string, v: number): string => {
      const m = metodo.toLowerCase();
      if (m.includes("dinheiro") || m.includes("cash")) { expected.cash += v; return "Dinheiro"; }
      if (m.includes("débito") || m.includes("debito") || m.includes("debit")) { expected.debit += v; return "Debito"; }
      if (m.includes("crédito") || m.includes("credito") || m.includes("credit")) { expected.credit += v; return "Credito"; }
      if (m.includes("pix")) { expected.pix += v; return "Pix"; }
      if (m.includes("voucher") || m.includes("vale") || m.includes("meal") || m.includes("food")) { expected.voucher += v; return "Vale-refeicao"; }
      if (m.includes("cart") || m.includes("maquin")) { expected.credit += v; return "Credito"; }
      foraDaConferencia.naoIdentificado += v;
      foraDaConferencia.naoIdentificadoQtd += 1;
      return NAO_IDENTIFICADA;
    };

    for (const o of orders) {
      const pm = (o.paymentMethod || "").toLowerCase();
      const src = ((o as any).source || "").toUpperCase();

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
      if ((o as any).tableSessionId) {
        const fechado = o.status === "ENTREGUE" || o.status === "ENCERRADO";
        if (!fechado) {
          foraDaConferencia.mesasAbertas += o.totalAmount || 0;
          foraDaConferencia.mesasAbertasQtd += 1;
        }
        continue;
      }

      const canal = canalNoPapel(o);
      const tipo = tipoDaVenda(o);

      // ── PAGAMENTO DIVIDIDO (BALCÃO) ─────────────────────────────────────
      //
      // Metade no Pix, metade em dinheiro: cada parte vai para a SUA linha da
      // conferência. Ler o `paymentMethod` de texto ("Dividido: Pix R$ 20,00 +
      // Dinheiro R$ 15,00") pela régua de palavras jogaria o pedido inteiro na
      // primeira forma que casasse.
      const partes = lerPagamentos((o as any).paymentMethods);
      if (partes.length > 0) {
        expected.total += o.totalAmount || 0;
        const formas = partes.map((p) => ({ forma: somarParte(p.method, p.amount), valor: p.amount }));
        registrarVenda(canal, tipo, formas, 0);
        registrarPedido(o, canal, tipo, formas);
        continue;
      }

      const channelDisc = (o.discountIfood && o.discountIfood > 0)
        ? o.discountIfood
        : (o.discountTotal && o.discountMerchant && o.discountTotal > o.discountMerchant
            ? o.discountTotal - o.discountMerchant
            : (o.notes?.match(/(?:iFood|Plataforma):\s*R\$\s*(\d+[.,]\d{2})/i)?.[1]
                ? parseFloat(o.notes.match(/(?:iFood|Plataforma):\s*R\$\s*(\d+[.,]\d{2})/i)![1].replace(",", "."))
                : 0));
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

      // ── VENDA DE SALÃO NÃO É PAGAMENTO ONLINE ───────────────────────────
      //
      // `paymentPaidAt` diz que o pedido FOI PAGO — não diz por onde o dinheiro
      // entrou. Ele sozinho ligava `isOnlinePayment` e, como o único source
      // isento era "PDV", toda venda do totem caía em `expected.ifoodOnline`,
      // a linha travada de "iFood (Pago Online)" que a tela de fechamento soma
      // sozinha no total. O estrago era duplo e acontecia todo dia:
      //
      //   • cartão passado na Point DA PRÓPRIA LOJA sumia de crédito/débito.
      //     Ficava impossível conferir contra o extrato da adquirente e, quando
      //     o operador digitava esse extrato, o valor era contado duas vezes —
      //     sobra fantasma do tamanho exato das vendas do totem no cartão;
      //   • dinheiro vivo do "pagar no caixa" (que o atendente confirma e vira
      //     "Dinheiro (recebido por ...)") saía do esperado em dinheiro, porque
      //     este teste vem ANTES do `pm.includes("dinheiro")`. A gaveta fechava
      //     "certinha" faltando exatamente esse valor — e é justamente essa
      //     conferência que existe para pegar furo.
      //
      // O totem é venda de salão igual ao PDV: o cliente está aqui dentro e o
      // cartão passa na maquininha da loja. A exceção de "PDV" já provava que
      // o autor sabia disso; só faltou o totem entrar na mesma lista. Para
      // venda de salão quem manda é a forma de pagamento, não o carimbo de pago.
      const ehVendaDeSalao = src === "PDV" || src === "TOTEM";

      // Identificar pagamentos ON-LINE (iFood Pago Online, PIX Online, Crédito Online via App)
      // Pagamentos Online NÃO passam pelas maquininhas da loja nem dinheiro de motoboy!
      const isOnlinePayment =
        pm.includes("online") ||
        pm.includes("prepaid") ||
        pm.includes("ifood") ||
        pm.includes("pago_online") ||
        (!ehVendaDeSalao && !!(o.paymentPaidAt || o.gatewayProvider)) ||
        (src === "IFOOD" && !pm.includes("dinheiro") && !pm.includes("debito") && !pm.includes("débito") && !pm.includes("credito") && !pm.includes("crédito") && !pm.includes("maquininha") && !pm.includes("cobrar"));

      // Fiado: consumo da equipe e venda anotada. Tem ficha propria e e
      // acertado depois -- nunca passa pela gaveta no fechamento do dia.
      const ehFiado = pm.includes("funcion") || pm.includes("fiado");

      // A forma que o retrato conta é a MESMA que a conferência cobrou: cada
      // ramo abaixo diz as duas coisas, e não há uma segunda régua para errar.
      let forma: string;
      if (ehDo99Food(o as any) && isOnlinePayment) {
        // Linha propria: o lojista confere o repasse do 99Food contra o extrato
        // DELES, nao contra o do iFood. Somados, os dois numeros nao conferem
        // com nenhum dos dois extratos.
        expected.food99Online += valRepasse;
        expected.total += valRepasse;
        forma = PAGO_ONLINE;
      } else if (src === "IFOOD" && isOnlinePayment) {
        expected.ifoodOnline += valRepasse;
        expected.total += valRepasse;
        forma = PAGO_ONLINE;
      } else if (isOnlinePayment && !ehVendaDeSalao) {
        expected.ifoodOnline += valRepasse;
        expected.total += valRepasse;
        forma = PAGO_ONLINE;
      } else if (ehFiado) {
        foraDaConferencia.fiado += valReal;
        foraDaConferencia.fiadoQtd += 1;
        forma = "Fiado";
      } else if (pm.includes("dinheiro") || pm.includes("cash")) {
        expected.cash += valReal;
        expected.total += valReal;
        forma = "Dinheiro";
      } else if (pm.includes("débito") || pm.includes("debito") || pm.includes("debit")) {
        expected.debit += valReal;
        expected.total += valReal;
        forma = "Debito";
      } else if (pm.includes("crédito") || pm.includes("credito") || pm.includes("credit")) {
        expected.credit += valReal;
        expected.total += valReal;
        forma = "Credito";
      } else if (pm.includes("pix")) {
        expected.pix += valReal;
        expected.total += valReal;
        forma = "Pix";
      } else if (pm.includes("voucher") || pm.includes("vale") || pm.includes("meal") || pm.includes("food")) {
        expected.voucher += valReal;
        expected.total += valReal;
        forma = "Vale-refeicao";
      } else if (pm.includes("maquininha") || pm.includes("cartão") || pm.includes("cartao")) {
        // Cartão sem o tipo: o Mercado Pago Point não devolve se foi crédito ou
        // débito, então o pedido do totem fica com o genérico "Cartão
        // (Maquininha)" e nenhuma das faixas acima o reconhecia. Cair no `else`
        // abaixo era o pior destino possível — venda de cartão exigida da
        // gaveta em espécie. Vai para crédito, que é onde a maioria dessas
        // passagens de fato cai e, principalmente, é uma linha que o operador
        // consegue conferir contra o extrato da adquirente.
        // (Quando o app da maquininha informa o tipo, o paymentMethod já vem
        // "Cartão CRÉDITO/DÉBITO (maquininha)" e as faixas acima o pegam antes.)
        expected.credit += valReal;
        expected.total += valReal;
        forma = "Credito";
      } else {
        // Antes: `expected.cash += val`. Jogar o desconhecido na gaveta e
        // exatamente o que produz falta sem causa -- o pedido de mesa com
        // "N/A", o "Pendente" do robo, o rotulo que a proxima integracao
        // inventar. Fica visivel numa linha propria, fora da conferencia, ate
        // alguem identificar o que e.
        foraDaConferencia.naoIdentificado += valReal;
        foraDaConferencia.naoIdentificadoQtd += 1;
        forma = NAO_IDENTIFICADA;
      }
      if (forma === PAGO_ONLINE) somarEm(onlinePorCanal, canal, valRepasse);

      // O cupom que a plataforma pagou NESTE pedido, no retrato. É o mesmo
      // `channelDisc` que a conferência somou no repasse do pago online — com
      // uma exceção: pedido do 99Food anterior a 17/09/2026 não tem o campo, e
      // a conta sai das promoções gravadas (lib/cupom-do-parceiro.ts).
      const cupomDoPedido = ehDo99Food(o as any) ? (channelDisc || cupomBancadoPelo99(o as any)) : channelDisc;
      const formas = [{ forma, valor: valReal }];
      registrarVenda(canal, tipo, formas, cupomDoPedido);
      registrarPedido(o, canal, tipo, formas);

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
      if (!ehDo99Food(o as any) && o.discountIfood && o.discountIfood > 0) {
        expected.ifoodCoupons += o.discountIfood;
      }
      const do99 = cupomBancadoPelo99(o as any);
      if (do99 > 0) expected.food99Coupons += do99;
    }
    // -- O TROCO DE ABERTURA CONTA NOS DOIS LUGARES ------------------------
    // Ele entrava so em `expected.cash`, e nunca em `expected.total` -- que e
    // somado dentro do laco dos pedidos. O rodape do fechamento saia menor que
    // a soma das proprias linhas impressas acima dele (R$ 472,10 de diferenca
    // no turno de 27/08 da Hakim Centro). Quem confere linha por linha e
    // depois olha o TOTAL nao tinha como fazer os dois baterem.
    // ── AS BAIXAS DAS MESAS FECHADAS NESTE TURNO ──────────────────────────
    //
    // É aqui que o dinheiro da mesa entra na conferência — por forma, como o
    // garçom registrou, e já com a taxa de serviço (que não existe em pedido
    // nenhum, só na sessão). O critério é a mesa ter FECHADO depois de o caixa
    // abrir: uma mesa aberta às 20h e paga às 23h é dinheiro deste turno, e a
    // data do pedido não diz isso — a do fechamento diz.
    //
    // Envelopado em try/catch pelo mesmo motivo das movimentações: se por
    // qualquer razão isto falhar, o caixa continua fechando como antes.
    try {
      const mesasFechadas = await prisma.tableSession.findMany({
        where: {
          status: "CLOSED",
          closedAt: janela,
          table: { franchiseeId: targetId },
        },
        select: { paymentMethods: true, serviceFee: true, waiterTip: true },
      });
      for (const mesa of mesasFechadas) {
        const formas: Forma[] = [];
        for (const p of lerPagamentos(mesa.paymentMethods)) {
          const m = p.method.toLowerCase();
          const v = p.amount;
          let forma: string;
          if (m.includes("dinheiro") || m.includes("cash")) { expected.cash += v; forma = "Dinheiro"; }
          else if (m.includes("débito") || m.includes("debito") || m.includes("debit")) { expected.debit += v; forma = "Debito"; }
          else if (m.includes("crédito") || m.includes("credito") || m.includes("credit")) { expected.credit += v; forma = "Credito"; }
          else if (m.includes("pix")) { expected.pix += v; forma = "Pix"; }
          else if (m.includes("voucher") || m.includes("vale") || m.includes("meal") || m.includes("food")) { expected.voucher += v; forma = "Vale-refeicao"; }
          else if (m.includes("maquininha") || m.includes("cartão") || m.includes("cartao")) { expected.credit += v; forma = "Credito"; }
          else {
            // Forma que a mesa gravou e o caixa não soube ler: continua
            // visível, fora da conferência, em vez de sumir na gaveta.
            foraDaConferencia.naoIdentificado += v;
            foraDaConferencia.naoIdentificadoQtd += 1;
            formas.push({ forma: NAO_IDENTIFICADA, valor: v });
            continue;
          }
          expected.total += v;
          formas.push({ forma, valor: v });
        }
        // Uma conta de mesa é UMA venda no retrato, com as baixas nas formas.
        if (formas.length > 0) registrarVenda("Mesa", "Mesa", formas, 0);
        const servico = Number(mesa.serviceFee || 0);
        if (servico > 0) { mesas.servico += servico; mesas.servicoQtd += 1; }
        mesas.gorjeta += Number(mesa.waiterTip || 0);
      }
    } catch (e: any) {
      console.error("[Caixa] Não consegui somar as baixas das mesas do turno:", e?.message);
    }

    // Tudo o que entrou em dinheiro até aqui é VENDA — o troco e as
    // movimentações entram logo abaixo. O papel mostra a gaveta nessa ordem.
    vendasEmDinheiro = expected.cash;

    expected.cash += openSession.openingAmount;
    expected.total += openSession.openingAmount;

    // ── Sangria e reforço lançados durante o turno ─────────────────────────
    //
    // Sem isto, o esperado era "pedidos em dinheiro + troco inicial" e mais
    // nada: uma sangria de R$ 200 aparecia no fechamento como R$ 200 de FALTA,
    // sem nenhuma explicação no sistema. Diferença que aparece todo dia sem
    // motivo é diferença que o lojista aprende a ignorar — e aí o caixa deixa
    // de conferir qualquer coisa.
    //
    // Envelopado em try/catch porque a tabela pode não existir ainda (boot que
    // não conseguiu criar): o caixa continua funcionando como sempre funcionou,
    // só sem a parcela nova.
    try {
      if (await temEstruturaDeCaixa()) {
        const movs = await prisma.cashMovement.findMany({
          where: { cashSessionId: openSession.id, franchiseeId: targetId },
          // `descricao` e `createdAt` entram para o papel do fechamento poder
          // listar sangria por sangria, com hora e motivo. O total sozinho
          // ("Sangrias R$ 800,00") não deixa ninguém conferir nada.
          select: { tipo: true, valor: true, descricao: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        });
        for (const m of movs) {
          if (m.tipo === "ENTRADA") { movimentacaoEntradas += m.valor; expected.cash += m.valor; reforcosQtd += 1; }
          else { movimentacaoSaidas += m.valor; expected.cash -= m.valor; sangriasQtd += 1; }
          movimentacoes.push({ tipo: m.tipo, valor: m.valor, descricao: m.descricao || null, hora: m.createdAt });
        }
        expected.total += movimentacaoEntradas - movimentacaoSaidas;
      }
    } catch (e: any) {
      console.error("[Caixa] Não consegui somar as movimentações do turno:", e?.message);
    }

    // ── O QUE FOI CANCELADO NO TURNO ──────────────────────────────────────
    //
    // Cancelado não entra em conta nenhuma — e é justamente por isso que
    // precisa aparecer. "Sumiram R$ 300 de venda" quase sempre é cancelamento,
    // e sem a linha no papel o lojista vai procurar o dinheiro na gaveta.
    //
    // Um a um no papel, com o número do parceiro: é por ele que o lojista acha
    // o pedido no portal do iFood quando o cliente liga reclamando.
    try {
      const lista = await prisma.customerOrder.findMany({
        where: { franchiseeId: targetId, status: "CANCELADO", createdAt: janela },
        select: { createdAt: true, dailyOrderNumber: true, totalAmount: true, cancelReason: true, cancelledBy: true,
          source: true, openDeliveryChannel: true, ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryReference: true, tableSessionId: true },
        orderBy: { createdAt: "asc" },
      });
      cancelados = {
        qtd: lista.length,
        valor: centavos(lista.reduce((s, o) => s + (o.totalAmount || 0), 0)),
        lista: opcoes.retrato
          ? lista.map((o) => {
              const c = canalDoPedido(o as any);
              return {
                hora: o.createdAt,
                numero: o.dailyOrderNumber != null ? `#${o.dailyOrderNumber}` : "",
                canal: o.tableSessionId ? "Mesa" : c.chave === "SITE" ? "Site" : c.nome,
                referencia: c.referencia,
                valor: centavos(o.totalAmount || 0),
                motivo: o.cancelReason ? String(o.cancelReason).trim() || null : null,
                quem: quemCancelou(o.cancelledBy),
              };
            })
          : [],
      };
    } catch (e: any) {
      console.error("[Caixa] Não consegui somar os cancelados do turno:", e?.message);
    }

    // ── ENTREGADORES ──────────────────────────────────────────────────────
    //
    // O que cada motoboy trouxe (dinheiro e maquininha, para a prestação de
    // contas) e quanto a loja deve a ele. A taxa de cada entrega sai de
    // lib/ganho-do-entregador.ts — a MESMA conta do relatório de entregadores
    // e do cartão "Hoje" da lista, para o papel nunca discordar da tela.
    if (opcoes.retrato && entregasProprias.length > 0) {
      try {
        const ids = [...new Set(entregasProprias.map((e) => e.motoboyId))];
        const [motoboys, loja] = await Promise.all([
          prisma.motoboy.findMany({
            where: { id: { in: ids }, franchiseeId: targetId },
            select: { id: true, name: true, paymentType: true, dailyRate: true, perDeliveryRate: true, perKmRate: true, faixasDeKm: true },
          }),
          prisma.user.findUnique({ where: { id: targetId }, select: { deliveryZones: true, deliveryConfig: true } }),
        ]);
        const regraDaLoja = lerRegraDeRepasse(loja?.deliveryConfig);
        const porId = new Map(motoboys.map((m) => [m.id, m]));
        const acumulado = new Map<string, DetalheDoTurno["entregadores"][number]>();
        for (const e of entregasProprias) {
          const mb = porId.get(e.motoboyId);
          const atual = acumulado.get(e.motoboyId) || {
            nome: mb?.name || "Entregador removido",
            entregas: 0, dinheiro: 0, cartao: 0, pix: 0, online: 0, outros: 0,
            taxas: 0, diaria: 0, semDistancia: 0, pelaTaxaDoCliente: 0,
          };
          atual.entregas += 1;
          for (const f of e.formas) {
            if (f.forma === "Dinheiro") atual.dinheiro += f.valor;
            else if (f.forma === "Debito" || f.forma === "Credito" || f.forma === "Vale-refeicao") atual.cartao += f.valor;
            else if (f.forma === "Pix") atual.pix += f.valor;
            else if (f.forma === PAGO_ONLINE) atual.online += f.valor;
            else atual.outros += f.valor;
          }
          if (mb) {
            const acerto = lerAcerto(mb as any);
            const g = ganhoDoPedido({ acerto, pedido: e.pedido, regraDaLoja, zonas: loja?.deliveryZones, ehMarketplace: e.ehMarketplace });
            atual.taxas += g.valor;
            if (g.origem === "SEM_DISTANCIA") atual.semDistancia += 1;
            if (g.origem === "TAXA_DO_CLIENTE") atual.pelaTaxaDoCliente += 1;
            // A diária é do cadastro, uma por turno em que ele rodou.
            atual.diaria = acerto.dailyRate;
          }
          acumulado.set(e.motoboyId, atual);
        }
        entregadores = [...acumulado.values()]
          .map((m) => ({
            ...m,
            dinheiro: centavos(m.dinheiro), cartao: centavos(m.cartao), pix: centavos(m.pix),
            online: centavos(m.online), outros: centavos(m.outros), taxas: centavos(m.taxas),
          }))
          .sort((a, b) => b.entregas - a.entregas);
      } catch (e: any) {
        console.error("[Caixa] Não consegui montar os entregadores do turno:", e?.message);
      }
    }

    // ── MAIS VENDIDOS ─────────────────────────────────────────────────────
    //
    // Tudo que saiu da cozinha no turno, inclusive a mesa ainda aberta: o
    // item já foi feito, mesmo que a conta não tenha sido paga. Só o
    // cancelado e o que ninguém pagou ficam de fora.
    if (opcoes.retrato) {
      try {
        const itens = await prisma.customerOrderItem.findMany({
          where: {
            order: { franchiseeId: targetId, status: { notIn: ["CANCELADO", "CRIANDO_IA", "AGUARDANDO_PAGAMENTO"] }, createdAt: janela },
          },
          select: { productName: true, quantity: true, price: true, menuProduct: { select: { name: true } } },
        });
        const porNome = new Map<string, Soma & { nome: string }>();
        for (const it of itens) {
          const nome = String(it.productName || it.menuProduct?.name || "").trim();
          if (!nome) continue;
          const chave = nome.toLowerCase();
          const atual = porNome.get(chave) || { nome, qtd: 0, valor: 0 };
          atual.qtd += Number(it.quantity || 0);
          atual.valor += Number(it.quantity || 0) * Number(it.price || 0);
          porNome.set(chave, atual);
        }
        maisVendidos = [...porNome.values()]
          .sort((a, b) => b.qtd - a.qtd || b.valor - a.valor)
          .slice(0, 10)
          .map((i) => ({ nome: i.nome, qtd: i.qtd, valor: centavos(i.valor) }));
      } catch (e: any) {
        console.error("[Caixa] Não consegui listar os mais vendidos do turno:", e?.message);
      }
    }
  }

  const detalhe: DetalheDoTurno = {
    vendas: { qtd: vendas.qtd, valor: centavos(vendas.valor) },
    porForma: listar(porForma),
    porCanal: [...porCanal.entries()]
      .map(([nome, c]) => ({ nome, qtd: c.qtd, valor: centavos(c.valor), formas: listar(c.formas) }))
      .sort((a, b) => b.valor - a.valor),
    porTipo: listar(porTipo),
    cupomDaLoja: { qtd: cupomDaLoja.qtd, valor: centavos(cupomDaLoja.valor), porCanal: listar(cupomDaLoja.porCanal) },
    cupomDaPlataforma: listar(cupomDaPlataforma),
    onlinePorCanal: listar(onlinePorCanal),
    taxaDeEntrega: { qtd: taxaDeEntrega.qtd, valor: centavos(taxaDeEntrega.valor) },
    mesas: { servico: centavos(mesas.servico), servicoQtd: mesas.servicoQtd, gorjeta: centavos(mesas.gorjeta) },
    gaveta: { vendasEmDinheiro: centavos(vendasEmDinheiro), reforcosQtd, sangriasQtd },
    movimentacoes,
    fiado,
    cancelados,
    entregadores,
    entregaParceira: { qtd: entregaParceira.qtd, valor: centavos(entregaParceira.valor) },
    semEntregador: { qtd: semEntregador.qtd, valor: centavos(semEntregador.valor) },
    maisVendidos,
  };

  return {
    expected,
    foraDaConferencia,
    pendentesValor,
    pendentesQuantidade,
    movimentacaoEntradas,
    movimentacaoSaidas,
    // O retrato do turno — só informação, não entra em conta nenhuma.
    detalhe,
  };
}
