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
import { Prisma } from "@prisma/client";
import { temEstruturaDeCaixa } from "@/lib/garantir-colunas";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { ganhoDoPedido, lerAcerto } from "@/lib/ganho-do-entregador";
import { pedidoDeAppDosEntregadores } from "@/lib/pedido-de-app-no-banco";
import { canceladoComCorrida, ehEntregaDaLoja } from "@/lib/resumo-do-entregador";
// A apuração das vendas (forma de cada venda, conferência e retrato por forma,
// canal e TIPO) é pura e mora em lib/apuracao-do-turno.ts, para o teste
// provar a conta sem banco (scripts/teste-caixa-por-tipo.ts). Aqui fica o que
// precisa do banco: buscar, e o que vem depois das vendas.
import { apurarVendasDoTurno, PAGO_ONLINE, type MesaDoTurno } from "@/lib/apuracao-do-turno";
import type { DetalheDoTurno, ParteDoRetrato } from "@/lib/cupom-do-caixa";
import { itensCanceladosNoTurno, quemCancelouPeloRastro } from "@/lib/cancelamentos-do-turno";
import { SELECT_TROCO_NO_PIX } from "@/lib/troco-no-pix";
import { somarConferidoNaMaquininha } from "@/lib/cobranca-da-entrega-na-maquininha";

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
  let movimentacoes: { tipo: string; valor: number; descricao: string | null; hora: Date; quem: string | null; depoisDoFechamento?: boolean }[] = [];
  let cancelados: DetalheDoTurno["cancelados"] = { qtd: 0, valor: 0, lista: [] };
  let itensCancelados: NonNullable<DetalheDoTurno["itensCancelados"]> = [];
  let entregadores: DetalheDoTurno["entregadores"] = [];
  // As entregas canceladas DEPOIS de o motoboy sair: são corrida (a régua do
  // acerto, lib/resumo-do-entregador.ts) e vão para o "a pagar" do papel.
  let corridasCanceladas: { motoboyId: string; pedido: { motoboyFee: number | null; deliveryFee: number | null; deliveryDistance: number | null; entregaGratis?: unknown; customerAddress?: string | null }; ehMarketplace: boolean }[] = [];
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
    // separa do balcão, e o "valor dos produtos" é o dos itens. `id` e
    // `parentOrderId` são da régua única (as vendas = atendimentos, o acréscimo
    // com o pai no turno não abre venda nova).
    select: { id: true, parentOrderId: true, status: true, paymentMethod: true, paymentMethods: true, totalAmount: true, source: true, paymentPaidAt: true, gatewayProvider: true, deliveryFee: true, discountIfood: true, discountTotal: true, discountMerchant: true, notes: true, tableSessionId: true, openDeliveryChannel: true, discountDetails: true,
      ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryReference: true,
      createdAt: true, dailyOrderNumber: true, customerName: true, employeeName: true, deliveryType: true, deliveryBy: true, motoboyId: true, motoboyFee: true, deliveryDistance: true, entregaGratis: true,
      // O bairro do pedido de app pago pela tabela da loja sai do texto (lib/ganho-do-entregador.ts).
      customerAddress: true,
      // Quem entregou (a régua `ehEntregaDaLoja`, a mesma do acerto do motoboy) e
      // a nota do cliente no dinheiro (o troco que o motoboy levou e devolve).
      ifoodDriverStatus: true, ifoodDriverName: true, changeAmount: true,
      totemLicenseId: true, items: { select: { price: true, quantity: true } },
      // Reposição (faltou item / troca): fora da venda, só a corrida do motoboy (apurarVendasDoTurno).
      reposicao: true,
      // Troco feito pelo Pix (lib/troco-no-pix.ts): muda a gaveta e o Pix
      // esperados e o dinheiro a entregar do motoboy.
      ...SELECT_TROCO_NO_PIX,
      // O comprovante da maquininha do motoboy (FireHub Motoboy): o selo
      // "conferido na maquininha" do fechamento.
      posDadosTransacao: true },
  });

  // ── AS CONTAS DE MESA FECHADAS NESTE TURNO ────────────────────────────
  //
  // O critério é a mesa ter FECHADO depois de o caixa abrir: uma mesa aberta
  // às 20h e paga às 23h é dinheiro deste turno, e a data do pedido não diz
  // isso — a do fechamento diz. Os pedidos da conta vêm junto para tirar o
  // troco e achar o desconto do fechamento (lib/apuracao-do-turno.ts); o id, o
  // total pago e a hora do fechamento são da régua do desconto
  // (`descontoNoFechamento`) e da mesa ainda aberta (a conta que não fechou).
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
      select: { id: true, paymentMethods: true, serviceFee: true, waiterTip: true, totalPaid: true, closedAt: true, orders: { select: { id: true, status: true, totalAmount: true, discountTotal: true } } },
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
        // `criadoPor`: quem lançou, no papel ao lado do motivo (Pizzaria 17,
        // 14/10/2026) — o mesmo e-mail que o comprovante da sangria imprime.
        select: { tipo: true, valor: true, descricao: true, createdAt: true, criadoPor: true },
        orderBy: { createdAt: "asc" },
      });
      for (const m of movs) {
        if (m.tipo === "ENTRADA") { movimentacaoEntradas += m.valor; expected.cash += m.valor; reforcosQtd += 1; }
        else { movimentacaoSaidas += m.valor; expected.cash -= m.valor; sangriasQtd += 1; }
        movimentacoes.push({
          tipo: m.tipo, valor: m.valor, descricao: m.descricao || null, hora: m.createdAt, quem: m.criadoPor || null,
          // A esquecida, lançada no Histórico depois de fechar (a 2ª via passa
          // o `closedAt` em `ate`): ela conta igual, e o papel diz que foi depois.
          ...(opcoes.ate && m.createdAt > opcoes.ate ? { depoisDoFechamento: true } : {}),
        });
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
      select: { createdAt: true, dailyOrderNumber: true, totalAmount: true, cancelReason: true, cancelledBy: true, editHistory: true,
        source: true, openDeliveryChannel: true, ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryReference: true, tableSessionId: true,
        // A corrida do cancelado: com motoboy da loja e saído antes de cancelar.
        status: true, deliveryType: true, motoboyId: true, dispatchedAt: true, cancelledAt: true, deliveryBy: true, ifoodDriverStatus: true, ifoodDriverName: true,
        motoboyFee: true, deliveryFee: true, deliveryDistance: true, entregaGratis: true, customerAddress: true },
      orderBy: { createdAt: "asc" },
    });
    corridasCanceladas = lista
      .filter((o) => o.motoboyId && o.deliveryType === "DELIVERY" && canceladoComCorrida(o) && ehEntregaDaLoja(o))
      .map((o) => ({
        motoboyId: o.motoboyId as string,
        pedido: { motoboyFee: o.motoboyFee ?? null, deliveryFee: o.deliveryFee ?? null, deliveryDistance: o.deliveryDistance ?? null, entregaGratis: o.entregaGratis, customerAddress: o.customerAddress ?? null },
        ehMarketplace: canalDoPedido(o as any).ehMarketplace,
      }));
    cancelados = {
      qtd: lista.length,
      valor: centavos(lista.reduce((s, o) => s + (o.totalAmount || 0), 0)),
      // Um a um também para a TELA do fechamento (não só o papel): o dono
      // confere o motivo de cada cancelamento antes de fechar (Pizzaria 17,
      // 09/10/2026). A lista já vinha nesta consulta; montar é barato.
      lista: lista.map((o) => {
            const c = canalDoPedido(o as any);
            return {
              hora: o.createdAt,
              numero: o.dailyOrderNumber != null ? `#${o.dailyOrderNumber}` : "",
              canal: o.tableSessionId ? "Mesa" : c.chave === "SITE" ? "Site" : c.nome,
              referencia: c.referencia,
              valor: centavos(o.totalAmount || 0),
              motivo: o.cancelReason ? String(o.cancelReason).trim() || null : null,
              quem: quemCancelou(o.cancelledBy),
              // O nome de quem cancelou na loja, pelo rastro (lib/cancelamentos-do-turno.ts).
              operador: quemCancelouPeloRastro(o.editHistory),
            };
          }),
    };
  } catch (e: any) {
    console.error("[Caixa] Não consegui somar os cancelados do turno:", e?.message);
  }

  // ── OS ITENS TIRADOS NO TURNO (lib/cancelamentos-do-turno.ts) ──────────
  //
  // A bebida tirada da mesa, o item tirado na edição do pedido: o pedido
  // continua valendo, então não aparece em Cancelados — e o dono quer ver na
  // conferência quem tirou, o quê, quanto e por quê. Vem do rastro do pedido
  // (`editHistory`) de quem foi mexido no turno; o pedido de mesa pode ter
  // nascido antes de o caixa abrir, por isso a janela é a do `updatedAt` e a
  // hora de cada retirada é conferida lá dentro.
  try {
    const mexidos = await prisma.customerOrder.findMany({
      where: {
        franchiseeId: targetId,
        updatedAt: janela,
        editHistory: { not: Prisma.DbNull },
      },
      select: { dailyOrderNumber: true, status: true, editHistory: true, tableSessionId: true, source: true,
        openDeliveryChannel: true, ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryReference: true,
        tableSession: { select: { table: { select: { number: true } } } } },
    });
    itensCancelados = itensCanceladosNoTurno(
      mexidos.map((o: any) => {
        const c = canalDoPedido(o as any);
        const mesa = o.tableSession?.table?.number;
        return {
          dailyOrderNumber: o.dailyOrderNumber,
          status: o.status,
          editHistory: o.editHistory,
          onde: o.tableSessionId ? (mesa != null ? `Mesa ${mesa}` : "Mesa") : c.chave === "SITE" ? "Site" : c.nome,
        };
      }),
      { de: openSession.openedAt, ate: opcoes.ate || null }
    );
  } catch (e: any) {
    console.error("[Caixa] Não consegui listar os itens cancelados do turno:", e?.message);
  }

  // ── ENTREGADORES ──────────────────────────────────────────────────────
  //
  // O que cada motoboy trouxe (dinheiro e maquininha, para a prestação de
  // contas) e quanto a loja deve a ele. A taxa de cada entrega sai de
  // lib/ganho-do-entregador.ts — a MESMA conta do relatório de entregadores
  // e do cartão "Hoje" da lista, para o papel nunca discordar da tela.
  if (opcoes.retrato && (entregasProprias.length > 0 || corridasCanceladas.length > 0)) {
    try {
      const ids = [...new Set([...entregasProprias, ...corridasCanceladas].map((e) => e.motoboyId))];
      const [motoboys, loja] = await Promise.all([
        prisma.motoboy.findMany({
          where: { id: { in: ids }, franchiseeId: targetId },
          select: { id: true, name: true, paymentType: true, dailyRate: true, perDeliveryRate: true, perKmRate: true, faixasDeKm: true },
        }),
        prisma.user.findUnique({ where: { id: targetId }, select: { deliveryZones: true, deliveryConfig: true, city: true } }),
      ]);
      const regraDaLoja = lerRegraDeRepasse(loja?.deliveryConfig);
      // "Pagar diferente nos pedidos de app", do cadastro de cada um — por SQL
      // (lib/pedido-de-app-no-banco.ts); sem a coluna, segue a regra da loja.
      const escolhaNoApp = await pedidoDeAppDosEntregadores(ids);
      const porId = new Map(motoboys.map((m) => [m.id, { ...m, pedidoDeApp: escolhaNoApp.get(m.id) ?? null }]));
      const acumulado = new Map<string, DetalheDoTurno["entregadores"][number]>();
      for (const e of entregasProprias) {
        const mb = porId.get(e.motoboyId);
        const atual = acumulado.get(e.motoboyId) || {
          nome: mb?.name || "Entregador removido",
          entregas: 0, dinheiro: 0, cartao: 0, pix: 0, online: 0, outros: 0,
          taxas: 0, diaria: 0, semDistancia: 0, pelaTaxaDoCliente: 0, trocoLevado: 0, canceladasComCorrida: 0,
        };
        atual.entregas += 1;
        // O troco que ele levou da loja para a nota do cliente: volta junto
        // com o dinheiro (o acerto mostra o mesmo, pedido a pedido).
        atual.trocoLevado = (atual.trocoLevado || 0) + (e.trocoLevado || 0);
        // Troco feito pelo Pix (lib/troco-no-pix.ts): o da loja ele entrega
        // junto com a nota; o dele fica com ele. Só aparece quando houve.
        if (e.trocoNoPixDaLoja) atual.trocoNoPixDaLoja = (atual.trocoNoPixDaLoja || 0) + e.trocoNoPixDaLoja;
        if (e.trocoNoPixDoMotoboy) atual.trocoNoPixDoMotoboy = (atual.trocoNoPixDoMotoboy || 0) + e.trocoNoPixDoMotoboy;
        for (const f of e.formas) {
          if (f.forma === "Dinheiro") atual.dinheiro += f.valor;
          else if (f.forma === "Debito" || f.forma === "Credito" || f.forma === "Vale-refeicao") atual.cartao += f.valor;
          else if (f.forma === "Pix") atual.pix += f.valor;
          else if (f.forma === PAGO_ONLINE) atual.online += f.valor;
          else atual.outros += f.valor;
        }
        if (mb) {
          const acerto = lerAcerto(mb as any);
          const g = ganhoDoPedido({ acerto, pedido: e.pedido, regraDaLoja, zonas: loja?.deliveryZones, cidadeDaLoja: loja?.city, ehMarketplace: e.ehMarketplace });
          atual.taxas += g.valor;
          if (g.origem === "SEM_DISTANCIA") atual.semDistancia += 1;
          if (g.origem === "TAXA_DO_CLIENTE") atual.pelaTaxaDoCliente += 1;
          // A diária é do cadastro, uma por turno em que ele rodou.
          atual.diaria = acerto.dailyRate;
        }
        acumulado.set(e.motoboyId, atual);
      }
      // ── O CANCELADO DEPOIS DE SAIR É CORRIDA ──────────────────────────
      // Até 11/10/2026 o papel não contava nenhum cancelado e o acerto contava
      // todos: o mesmo motoboy com dois números. A regra é a do acerto
      // (canceladoComCorrida): saiu antes de cancelar → conta entrega e taxa,
      // sem dinheiro.
      for (const e of corridasCanceladas) {
        const mb = porId.get(e.motoboyId);
        const atual = acumulado.get(e.motoboyId) || {
          nome: mb?.name || "Entregador removido",
          entregas: 0, dinheiro: 0, cartao: 0, pix: 0, online: 0, outros: 0,
          taxas: 0, diaria: 0, semDistancia: 0, pelaTaxaDoCliente: 0, trocoLevado: 0, canceladasComCorrida: 0,
        };
        atual.entregas += 1;
        atual.canceladasComCorrida = (atual.canceladasComCorrida || 0) + 1;
        if (mb) {
          const acerto = lerAcerto(mb as any);
          const g = ganhoDoPedido({ acerto, pedido: e.pedido, regraDaLoja, zonas: loja?.deliveryZones, cidadeDaLoja: loja?.city, ehMarketplace: e.ehMarketplace });
          atual.taxas += g.valor;
          if (g.origem === "SEM_DISTANCIA") atual.semDistancia += 1;
          if (g.origem === "TAXA_DO_CLIENTE") atual.pelaTaxaDoCliente += 1;
          atual.diaria = acerto.dailyRate;
        }
        acumulado.set(e.motoboyId, atual);
      }
      entregadores = [...acumulado.values()]
        .map((m) => ({
          ...m,
          dinheiro: centavos(m.dinheiro), cartao: centavos(m.cartao), pix: centavos(m.pix),
          online: centavos(m.online), outros: centavos(m.outros), taxas: centavos(m.taxas), trocoLevado: centavos(m.trocoLevado || 0),
          ...(m.trocoNoPixDaLoja ? { trocoNoPixDaLoja: centavos(m.trocoNoPixDaLoja) } : {}),
          ...(m.trocoNoPixDoMotoboy ? { trocoNoPixDoMotoboy: centavos(m.trocoNoPixDoMotoboy) } : {}),
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
    itensCancelados,
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
    naMaquininha: somarConferidoNaMaquininha(orders.filter((o) => o.status !== "AGUARDANDO_PAGAMENTO")),
    // O retrato do turno — só informação, não entra em conta nenhuma.
    detalhe,
  };
}
