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
import { temEstruturaDeCaixa } from "@/lib/garantir-colunas";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { ganhoDoPedido, lerAcerto } from "@/lib/ganho-do-entregador";
// A apuração das vendas (forma de cada venda, conferência e retrato por forma,
// canal e TIPO) é pura e mora em lib/apuracao-do-turno.ts, para o teste
// provar a conta sem banco (scripts/teste-caixa-por-tipo.ts). Aqui fica o que
// precisa do banco: buscar, e o que vem depois das vendas.
import { apurarVendasDoTurno, PAGO_ONLINE, type MesaDoTurno } from "@/lib/apuracao-do-turno";
import type { DetalheDoTurno, ParteDoRetrato } from "@/lib/cupom-do-caixa";

export { PAGO_ONLINE };

type Soma = { qtd: number; valor: number };

const centavos = (n: number) => Math.round(n * 100) / 100;

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

  let movimentacaoEntradas = 0;
  let movimentacaoSaidas = 0;
  let vendasEmDinheiro = 0;
  let reforcosQtd = 0;
  let sangriasQtd = 0;
  let movimentacoes: { tipo: string; valor: number; descricao: string | null; hora: Date }[] = [];
  let cancelados: DetalheDoTurno["cancelados"] = { qtd: 0, valor: 0, lista: [] };
  let entregadores: DetalheDoTurno["entregadores"] = [];
  let maisVendidos: ParteDoRetrato[] = [];

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
    // `totemLicenseId` e os itens são do bloco por tipo de venda: o totem se
    // separa do balcão, e o "valor dos produtos" é o dos itens.
    select: { status: true, paymentMethod: true, paymentMethods: true, totalAmount: true, source: true, paymentPaidAt: true, gatewayProvider: true, deliveryFee: true, discountIfood: true, discountTotal: true, discountMerchant: true, notes: true, tableSessionId: true, openDeliveryChannel: true, discountDetails: true,
      ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryReference: true,
      createdAt: true, dailyOrderNumber: true, customerName: true, employeeName: true, deliveryType: true, deliveryBy: true, motoboyId: true, motoboyFee: true, deliveryDistance: true,
      totemLicenseId: true, items: { select: { price: true, quantity: true } } },
  });

  // ── AS CONTAS DE MESA FECHADAS NESTE TURNO ────────────────────────────
  //
  // O critério é a mesa ter FECHADO depois de o caixa abrir: uma mesa aberta
  // às 20h e paga às 23h é dinheiro deste turno, e a data do pedido não diz
  // isso — a do fechamento diz. Os pedidos da conta vêm junto para o retrato
  // tirar o troco e achar o desconto do fechamento (lib/apuracao-do-turno.ts).
  //
  // Envelopado em try/catch pelo mesmo motivo das movimentações: se por
  // qualquer razão isto falhar, o caixa continua fechando como antes.
  let mesasFechadas: MesaDoTurno[] = [];
  try {
    mesasFechadas = await prisma.tableSession.findMany({
      where: {
        status: "CLOSED",
        closedAt: janela,
        table: { franchiseeId: targetId },
      },
      select: { paymentMethods: true, serviceFee: true, waiterTip: true, orders: { select: { status: true, totalAmount: true, discountTotal: true } } },
    });
  } catch (e: any) {
    console.error("[Caixa] Não consegui somar as baixas das mesas do turno:", e?.message);
  }

  const apurado = apurarVendasDoTurno(orders, mesasFechadas);
  const { expected, foraDaConferencia, pendentesValor, pendentesQuantidade, onlineProprio, entregasProprias, retrato } = apurado;

  // Tudo o que entrou em dinheiro até aqui é VENDA — o troco e as
  // movimentações entram logo abaixo. O papel mostra a gaveta nessa ordem.
  vendasEmDinheiro = expected.cash;

  // -- O TROCO DE ABERTURA CONTA NOS DOIS LUGARES ------------------------
  // Ele entrava so em `expected.cash`, e nunca em `expected.total` -- que e
  // somado dentro do laco dos pedidos. O rodape do fechamento saia menor que
  // a soma das proprias linhas impressas acima dele (R$ 472,10 de diferenca
  // no turno de 27/08 da Hakim Centro). Quem confere linha por linha e
  // depois olha o TOTAL nao tinha como fazer os dois baterem.
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

  const detalhe: DetalheDoTurno = {
    ...retrato,
    gaveta: { vendasEmDinheiro: centavos(vendasEmDinheiro), reforcosQtd, sangriasQtd },
    movimentacoes,
    cancelados,
    entregadores,
    maisVendidos,
  };

  return {
    expected,
    foraDaConferencia,
    pendentesValor,
    pendentesQuantidade,
    movimentacaoEntradas,
    movimentacaoSaidas,
    onlineProprio,
    // O retrato do turno — só informação, não entra em conta nenhuma.
    detalhe,
  };
}
