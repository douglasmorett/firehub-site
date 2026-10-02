/**
 * Pedidos simulados — a demonstração do vendedor.
 *
 * Pedido do Douglas (02/10/2026): o Victor (vendedor) mostra o sistema às lojas
 * pela loja de demonstração dele, e a tela vazia não mostra nada. O botão
 * "▶ Simular pedidos" da barra do painel (components/customer/SimularPedidos)
 * joga 20 pedidos de todos os canais na tela — iFood, 99Food, site, robô,
 * retirada, mesa, balcão, totem — em etapas diferentes do quadro, e o mesmo
 * botão os apaga depois.
 *
 * ── SÓ NA LOJA DE DEMONSTRAÇÃO ──────────────────────────────────────────────
 * A lista abaixo é a trava: a rota recusa qualquer outra loja, e o botão nem
 * aparece. Loja de cliente com pedido inventado no caixa é o pior engano que
 * dá para fabricar.
 *
 * ── O QUE NÃO PODE VAZAR PARA O MUNDO REAL ──────────────────────────────────
 *   • marketplace: o pedido do iFood leva o SELO e o número do parceiro
 *     (`ifoodReference`), nunca o `ifoodOrderId` — é por ele que aceitar,
 *     pronto e cancelar chamam a API do iFood. O 99Food é mais sensível: a
 *     sincronização dispara por `source`/`openDeliveryChannel` iguais a
 *     "99FOOD" (lib/food99-status.ts, ehPedido99Food), mesmo sem id. Por isso
 *     o simulado vai como OPEN_DELIVERY + canal "99FOOD_DEMONSTRACAO": o selo
 *     e o caixa (que procuram "99" no canal) o reconhecem, a sincronização não;
 *   • WhatsApp do cliente: telefone vazio (a notificação para antes de tudo);
 *   • alerta de pedido atrasado ao dono: a loja de demonstração fica fora do
 *     cron (api/cron/pedidos-atrasados);
 *   • impressora: `printedAt` já preenchido — a fila da nuvem não devolve;
 *   • nota fiscal: fora da emissão automática (ver `fiscalStatus` abaixo).
 *
 * ── A MARCA ─────────────────────────────────────────────────────────────────
 * `posTerminalId` = MARCA_DA_SIMULACAO. A coluna só é lida pelo fluxo da
 * maquininha, e sempre junto de `posStatus` — que pedido simulado não tem.
 * Usar uma coluna que já existe evita mexer no schema de CustomerOrder (a
 * tabela mais consultada do sistema) por causa de uma loja só.
 */
import { prisma } from "@/lib/prisma";
import { generateDailyOrderNumber } from "@/lib/order-number";

/** Lojas (User.id) que têm o botão. Victor Henriques (demonstração), criada em 01/10/2026. */
const LOJAS_DE_DEMONSTRACAO = new Set<string>(["cmupkiesh0000ujmcjwtpd706"]);

export function ehLojaDeDemonstracao(lojaId: string | null | undefined): boolean {
  return !!lojaId && LOJAS_DE_DEMONSTRACAO.has(lojaId);
}

export const MARCA_DA_SIMULACAO = "simulacao-demonstracao";

// Vazio, e não o "00000000000" do balcão: a saída da rota (roteirização)
// manda mensagem a qualquer telefone com dígito, sem passar por lib/telefone.
const TELEFONE_QUE_NAO_RECEBE = "";

type Produto = { id: string; name: string; price: number; priceSalao: number | null; priceDelivery: number | null; isBeverage: boolean };

type Roteiro = {
  canal: "IFOOD" | "99FOOD" | "SITE" | "ROBO" | "BALCAO" | "TOTEM" | "MESA";
  tipo: "DELIVERY" | "RETIRADA" | "MESA";
  status: "NOVO" | "ACEITO" | "PREPARANDO" | "PRONTO" | "SAIU_ENTREGA" | "ENTREGUE";
  pagamento: string;
  /** Pago antes de chegar à loja (app, Pix/cartão do site, totem). */
  pago?: boolean;
  /** Minutos atrás que o pedido entrou. */
  minutos: number;
  troco?: number;
  /** Quem entrega o pedido do parceiro: o entregador DELES ou o da loja. */
  entregaParceira?: boolean;
  obs?: string;
};

// A ordem é a de chegada (mais antigo primeiro), e o quadro fica com cada
// coluna povoada: novos, em preparo, prontos, a caminho e finalizados.
const ROTEIROS: Roteiro[] = [
  { canal: "BALCAO", tipo: "RETIRADA", status: "ENTREGUE",     pagamento: "Cartão de Débito",                 minutos: 58 },
  { canal: "SITE",   tipo: "DELIVERY", status: "ENTREGUE",     pagamento: "CREDITO_ONLINE", pago: true,       minutos: 52 },
  { canal: "IFOOD",  tipo: "DELIVERY", status: "ENTREGUE",     pagamento: "Crédito (Pago Online)", pago: true, minutos: 47, entregaParceira: true },
  { canal: "SITE",   tipo: "DELIVERY", status: "SAIU_ENTREGA", pagamento: "Cartão de Crédito",                minutos: 38, obs: "Levar a maquininha" },
  { canal: "IFOOD",  tipo: "DELIVERY", status: "SAIU_ENTREGA", pagamento: "Dinheiro (Cobrar na Entrega)", troco: 100, minutos: 34 },
  { canal: "MESA",   tipo: "MESA",     status: "ACEITO",       pagamento: "N/A",                              minutos: 31 },
  { canal: "99FOOD", tipo: "DELIVERY", status: "PRONTO",       pagamento: "Pago Online (99Food)", pago: true, minutos: 27, entregaParceira: true },
  { canal: "IFOOD",  tipo: "RETIRADA", status: "PRONTO",       pagamento: "Pix (Pago Online)", pago: true,    minutos: 24 },
  { canal: "SITE",   tipo: "RETIRADA", status: "PRONTO",       pagamento: "PIX_ONLINE", pago: true,           minutos: 22 },
  { canal: "TOTEM",  tipo: "RETIRADA", status: "PREPARANDO",   pagamento: "Cartão CRÉDITO (maquininha)", pago: true, minutos: 19 },
  { canal: "MESA",   tipo: "MESA",     status: "ACEITO",       pagamento: "N/A",                              minutos: 17 },
  { canal: "ROBO",   tipo: "RETIRADA", status: "PREPARANDO",   pagamento: "Dinheiro",                         minutos: 15 },
  { canal: "SITE",   tipo: "DELIVERY", status: "PREPARANDO",   pagamento: "Vale Refeição",                    minutos: 13, obs: "Interfone quebrado, ligar quando chegar" },
  { canal: "IFOOD",  tipo: "DELIVERY", status: "PREPARANDO",   pagamento: "Pix (Pago Online)", pago: true,    minutos: 11 },
  { canal: "BALCAO", tipo: "RETIRADA", status: "ACEITO",       pagamento: "Dinheiro", troco: 50,              minutos: 9 },
  { canal: "99FOOD", tipo: "DELIVERY", status: "ACEITO",       pagamento: "Dinheiro (cobrar na entrega)", troco: 100, minutos: 7 },
  { canal: "ROBO",   tipo: "DELIVERY", status: "NOVO",         pagamento: "Pix",                              minutos: 5 },
  { canal: "SITE",   tipo: "RETIRADA", status: "NOVO",         pagamento: "Dinheiro", troco: 100,             minutos: 4 },
  { canal: "SITE",   tipo: "DELIVERY", status: "NOVO",         pagamento: "PIX_ONLINE", pago: true,           minutos: 2, obs: "Sem cebola, por favor" },
  { canal: "IFOOD",  tipo: "DELIVERY", status: "NOVO",         pagamento: "Crédito (Pago Online)", pago: true, minutos: 1, entregaParceira: true },
];

const NOMES = [
  "Mariana Costa", "Rafael Souza", "Juliana Alves", "Bruno Ferreira", "Camila Rocha",
  "Lucas Martins", "Fernanda Lima", "Diego Carvalho", "Patrícia Gomes", "Thiago Ribeiro",
  "Aline Barbosa", "Gustavo Pereira", "Larissa Mendes", "Felipe Araújo", "Beatriz Nunes",
  "Rodrigo Teixeira", "Vanessa Cardoso", "André Moreira", "Natália Freitas", "Leonardo Dias",
];

const RUAS = [
  "Rua das Flores, 120 - Centro", "Av. Brasil, 845 - Jardim América", "Rua Sete de Setembro, 33 - Centro",
  "Rua Tiradentes, 512 - Vila Nova", "Av. Getúlio Vargas, 1020 - São José", "Rua Santos Dumont, 77 - Boa Vista",
  "Rua Rio Branco, 260 - Parque das Árvores", "Rua XV de Novembro, 98 - Centro",
];

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Status → etapa do KDS, como o painel e a cozinha gravam. */
function etapaDoKds(status: Roteiro["status"], minutos: number, agora: number) {
  const em = (m: number) => new Date(agora - m * 60_000);
  switch (status) {
    case "NOVO": return {};
    case "ACEITO":
    case "PREPARANDO": return { kdsStage: "PRODUCTION", kdsProductionAt: em(Math.max(0, minutos - 1)) };
    default: return { kdsStage: "FINISHED", kdsProductionAt: em(Math.max(0, minutos - 1)), kdsFinishedAt: em(Math.max(0, minutos - 12)) };
  }
}

function source(canal: Roteiro["canal"]): string {
  switch (canal) {
    case "IFOOD": return "IFOOD";
    case "99FOOD": return "OPEN_DELIVERY";
    case "ROBO": return "WHATSAPP_IA";
    case "BALCAO":
    case "MESA": return "PRESENCIAL";
    case "TOTEM": return "TOTEM";
    default: return "ONLINE";
  }
}

/** Itens do pedido: 1 a 3 comidas e, em metade dos pedidos, uma bebida. */
function montarItens(n: number, comidas: Produto[], bebidas: Produto[], canal: Roteiro["canal"]) {
  const preco = (p: Produto) =>
    canal === "MESA" || canal === "BALCAO" || canal === "TOTEM"
      ? (p.priceSalao ?? p.price)
      : (p.priceDelivery ?? p.price);
  const lista = comidas.length > 0 ? comidas : bebidas;
  const quantosItens = 1 + (n % 3);
  const itens: { menuProductId: string; productName: string; quantity: number; price: number }[] = [];
  for (let i = 0; i < quantosItens; i++) {
    const p = lista[(n * 3 + i * 7) % lista.length];
    if (itens.some((x) => x.menuProductId === p.id)) continue;
    itens.push({ menuProductId: p.id, productName: p.name, quantity: 1 + ((n + i) % 2), price: centavos(preco(p)) });
  }
  if (bebidas.length > 0 && comidas.length > 0 && n % 2 === 0) {
    const b = bebidas[n % bebidas.length];
    itens.push({ menuProductId: b.id, productName: b.name, quantity: 1 + (n % 2), price: centavos(preco(b)) });
  }
  return itens;
}

/** Quantos pedidos simulados a loja tem agora. */
export async function contarSimulados(lojaId: string): Promise<number> {
  return prisma.customerOrder.count({ where: { franchiseeId: lojaId, posTerminalId: MARCA_DA_SIMULACAO } });
}

/**
 * Joga a simulação na tela. Abre o caixa se estiver fechado (sem caixa aberto
 * o fechamento não mostra nada e a mesa não aceita lançamento) e cria duas
 * mesas se a loja não tiver mesa livre.
 */
export async function criarSimulacao(lojaId: string): Promise<{ quantidade: number; caixaAberto: boolean }> {
  const produtos = await prisma.menuProduct.findMany({
    where: { franchiseeId: lojaId, active: true, apenasEmCombo: false, price: { gt: 0 } },
    select: { id: true, name: true, price: true, priceSalao: true, priceDelivery: true, isBeverage: true, comboGroups: { select: { id: true }, take: 1 } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 300,
  });
  if (produtos.length === 0) throw new Error("A loja não tem produto ativo no cardápio para montar os pedidos.");
  // Produto com pergunta (sabor, ponto, adicional) sem a resposta fica
  // estranho na comanda — vai primeiro o que não pergunta nada.
  const semPergunta = produtos.filter((p) => p.comboGroups.length === 0);
  const base = semPergunta.length >= 6 ? semPergunta : produtos;
  const comidas = base.filter((p) => !p.isBeverage);
  const bebidas = base.filter((p) => p.isBeverage);

  const agora = Date.now();

  // ── CAIXA ──────────────────────────────────────────────────────────────
  // O esperado do fechamento só conta pedido feito depois da abertura; o
  // caixa aberto agora deixaria os pedidos "de 50 minutos atrás" de fora.
  let caixaAberto = false;
  let caixa = await prisma.cashSession.findFirst({
    where: { franchiseeId: lojaId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
    select: { openedAt: true },
  });
  if (!caixa) {
    caixa = await prisma.cashSession.create({
      data: { franchiseeId: lojaId, openingAmount: 100, status: "OPEN", openedAt: new Date(agora - 70 * 60_000) },
      select: { openedAt: true },
    });
    await prisma.user.updateMany({ where: { OR: [{ id: lojaId }, { ownerId: lojaId }] }, data: { cashOpen: true } });
    caixaAberto = true;
  }
  const primeiroMinuto = caixa.openedAt.getTime() + 1000;

  // ── MESAS ──────────────────────────────────────────────────────────────
  const quantasMesas = ROTEIROS.filter((r) => r.canal === "MESA").length;
  const mesas = await prisma.table.findMany({
    where: { franchiseeId: lojaId, isActive: true, sessions: { none: { status: { in: ["OPEN", "CLOSING"] } } } },
    orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
    take: quantasMesas,
    select: { id: true, number: true },
  });
  if (mesas.length < quantasMesas) {
    const usados = new Set((await prisma.table.findMany({ where: { franchiseeId: lojaId }, select: { number: true } })).map((t) => t.number));
    for (let numero = 1; mesas.length < quantasMesas; numero++) {
      if (usados.has(numero)) continue;
      mesas.push(await prisma.table.create({ data: { franchiseeId: lojaId, number: numero, sortOrder: numero }, select: { id: true, number: true } }));
    }
  }

  let quantidade = 0;
  let mesaDaVez = 0;
  for (const [n, r] of ROTEIROS.entries()) {
    const criadoEm = new Date(Math.max(agora - r.minutos * 60_000, primeiroMinuto + n * 1000));
    const itens = montarItens(n, comidas, bebidas, r.canal);
    const subtotal = centavos(itens.reduce((s, i) => s + i.price * i.quantity, 0));
    const entrega = r.tipo === "DELIVERY" ? (r.canal === "IFOOD" || r.canal === "99FOOD" ? 7.99 : 6) : 0;
    const total = centavos(subtotal + entrega);
    const nome = NOMES[n % NOMES.length];

    let tableSessionId: string | null = null;
    let endereco = r.tipo === "DELIVERY" ? RUAS[n % RUAS.length] : "";
    if (r.canal === "MESA") {
      const mesa = mesas[mesaDaVez++];
      const sessao = await prisma.tableSession.create({
        data: { tableId: mesa.id, franchiseeId: lojaId, status: "OPEN", customerName: nome.split(" ")[0], waiterName: "Carlos", openedAt: criadoEm },
        select: { id: true },
      });
      tableSessionId = sessao.id;
      endereco = `Mesa ${mesa.number}`;
    }

    const parceiro = r.canal === "IFOOD" || r.canal === "99FOOD";
    const numeroNoParceiro = String(4100 + n * 37);

    await prisma.customerOrder.create({
      data: {
        franchiseeId: lojaId,
        dailyOrderNumber: await generateDailyOrderNumber(lojaId),
        customerName: r.canal === "MESA" ? nome.split(" ")[0] : r.canal === "BALCAO" ? "Balcão" : nome,
        customerPhone: TELEFONE_QUE_NAO_RECEBE,
        customerAddress: endereco,
        deliveryType: r.canal === "TOTEM" ? "TAKEOUT" : r.tipo,
        paymentMethod: r.pagamento,
        totalAmount: total,
        deliveryFee: entrega,
        changeAmount: r.troco ?? null,
        notes: r.obs ?? "",
        status: r.status,
        source: source(r.canal),
        ...(r.pago ? { paymentPaidAt: criadoEm } : {}),
        ...(r.canal === "IFOOD" ? { ifoodReference: numeroNoParceiro } : {}),
        ...(r.canal === "99FOOD" ? { openDeliveryChannel: "99FOOD_DEMONSTRACAO", openDeliveryReference: numeroNoParceiro } : {}),
        ...(parceiro && r.tipo === "DELIVERY"
          ? { deliveryBy: r.entregaParceira ? (r.canal === "IFOOD" ? "IFOOD" : "99FOOD") : "MERCHANT" }
          : {}),
        ...(r.canal === "IFOOD" && r.entregaParceira ? { ifoodPickupCode: String(1000 + n * 53).slice(-4) } : {}),
        ...(tableSessionId ? { tableSessionId } : {}),
        ...etapaDoKds(r.status, r.minutos, agora),
        createdAt: criadoEm,
        printedAt: new Date(agora),
        posTerminalId: MARCA_DA_SIMULACAO,
        items: { create: itens },
      },
    });
    quantidade++;
  }
  return { quantidade, caixaAberto };
}

/**
 * Tira a simulação: os pedidos com a marca, e as mesas que ela abriu (só as
 * que ficaram sem pedido de verdade). O caixa e as mesas cadastradas ficam.
 */
export async function apagarSimulacao(lojaId: string): Promise<number> {
  const simulados = await prisma.customerOrder.findMany({
    where: { franchiseeId: lojaId, posTerminalId: MARCA_DA_SIMULACAO },
    select: { id: true, tableSessionId: true },
  });
  if (simulados.length === 0) return 0;
  const ids = simulados.map((o) => o.id);
  const sessoes = [...new Set(simulados.map((o) => o.tableSessionId).filter(Boolean) as string[])];

  await prisma.$transaction(async (tx) => {
    await tx.customerOrder.updateMany({ where: { parentOrderId: { in: ids } }, data: { parentOrderId: null } });
    // Avaliação não cai junto (a relação não tem cascata) e travaria o resto.
    await tx.storeReview.deleteMany({ where: { orderId: { in: ids } } });
    await tx.customerOrderItem.deleteMany({ where: { orderId: { in: ids } } });
    await tx.customerOrder.deleteMany({ where: { id: { in: ids } } });
    if (sessoes.length > 0) {
      await tx.tableSession.deleteMany({ where: { id: { in: sessoes }, franchiseeId: lojaId, orders: { none: {} } } });
    }
  });
  return ids.length;
}
