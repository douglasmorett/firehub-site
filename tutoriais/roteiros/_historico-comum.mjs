// O HISTÓRICO da loja fictícia, comum aos vídeos de Financeiro e de Relatórios.
//
// As duas telas só têm o que mostrar com meses de venda para trás. Aqui nascem
// os pedidos fictícios dos últimos dias (entregues, alguns cancelados), com
// itens do cardápio-base, formas de pagamento, bairros e canais variados, e as
// despesas lançadas à mão. Tudo inventado e sempre igual: o sorteio tem semente
// fixa, para duas gravações mostrarem a mesma loja.
//
// O fuso: a loja fictícia vive no fuso em que agora são 20h (ambiente/relogio.mjs).
// Os relatórios cortam o dia operacional às 5h nesse fuso e o DRE corta pela
// meia-noite do navegador, que usa o mesmo fuso. Todo pedido daqui cai entre
// 11h e 22h30 no relógio da loja: longe das duas viradas.
import { fusoDaNoite } from "../ambiente/relogio.mjs";

const MIN = 60_000, DIA = 86_400_000;

/** Sorteio com semente fixa (o mesmo histórico em toda gravação). */
function sorteador(semente) {
  let s = semente >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** O relógio da loja agora: dia ("YYYY-MM-DD"), dia da semana (0 = domingo) e minutos desde a meia-noite. */
export function relogioDaLoja(agora = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: fusoDaNoite(agora), year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(agora).map((x) => [x.type, x.value]));
  const minutos = (Number(p.hour) % 24) * 60 + Number(p.minute);
  return {
    dia: `${p.year}-${p.month}-${p.day}`,
    diaDaSemana: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
    minutos,
    /** O instante da meia-noite de hoje no relógio da loja. */
    meiaNoite: new Date(agora.getTime() - minutos * MIN - agora.getSeconds() * 1000 - agora.getMilliseconds()),
  };
}

/** "YYYY-MM-DD" de `n` dias atrás no relógio da loja. */
export function diaDaLoja(n, agora = new Date()) {
  const d = new Date(`${relogioDaLoja(agora).dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** O custo de cada produto do cardápio-base (sem ele o DRE conta o produto como de graça). */
export const CUSTOS = {
  "X-Burger": 8.5, "X-Bacon": 10.8, "X-Tudo": 13.2, "Pizza Calabresa": 19.5, "Pizza Marguerita": 18,
  "Batata Frita": 5.4, "Coca-Cola lata": 3.2, "Guaraná 2 L": 6.5,
};

/** Os custos fixos do mês, no formato que a aba Custos Fixos grava (User.fixedCosts). */
export const CUSTOS_FIXOS = [
  { id: "cf-aluguel", label: "Aluguel", value: 1800 },
  { id: "cf-salarios", label: "Salários", value: 3200 },
  { id: "cf-energia", label: "Energia", value: 520 },
  { id: "cf-internet", label: "Internet", value: 120 },
];

const BAIRROS = [
  // [bairro, taxa de entrega, peso]
  ["Centro", 5, 34], ["Vila Nova", 6, 24], ["Jardim América", 7, 20], ["Santa Luzia", 8, 13], ["Parque das Flores", 9, 9],
];
const RUAS = ["Rua das Acácias", "Rua do Sol", "Av. Brasil", "Rua Sete de Setembro", "Rua das Palmeiras", "Rua das Flores",
  "Rua Bela Vista", "Rua dos Ipês", "Av. Central", "Rua São José", "Rua da Paz", "Rua Projetada"];
const NOMES = ["Ana", "Bruno", "Camila", "Daniel", "Elaine", "Fábio", "Gabriela", "Heitor", "Isabela", "João", "Karina", "Leandro",
  "Marina", "Nelson", "Olívia", "Paulo", "Rafaela", "Samuel", "Tatiana", "Vítor", "Yara", "Wesley", "Lívia", "Otávio"];
const SOBRENOMES = ["Silva", "Souza", "Oliveira", "Santos", "Pereira", "Lima", "Carvalho", "Rocha", "Almeida", "Barbosa",
  "Cardoso", "Teixeira", "Moreira", "Nunes", "Freitas", "Ramos"];

/** Pedidos por dia da semana (domingo primeiro): a semana fraca no começo e forte de sexta a domingo. */
const POR_DIA = [17, 9, 10, 11, 12, 18, 22];

/**
 * Cria o histórico de vendas: `dias` dias para trás (ontem inclusive) e as
 * vendas de hoje antes do movimento da noite que a semente já traz.
 * Devolve quantos pedidos criou.
 */
export async function criarHistorico(prisma, { loja, produtos, motoboys }, { dias = 62 } = {}) {
  const L = loja.id;
  const sorteio = sorteador(20261002);
  const entre = (a, b) => a + Math.floor(sorteio() * (b - a + 1));
  const um = (lista) => lista[Math.floor(sorteio() * lista.length)];
  const pesado = (lista, peso) => {
    let alvo = sorteio() * lista.reduce((t, x) => t + peso(x), 0);
    for (const x of lista) { alvo -= peso(x); if (alvo <= 0) return x; }
    return lista[lista.length - 1];
  };
  const relogio = relogioDaLoja();
  const pedidos = [], itens = [];
  let serie = 0;

  const montar = (quando, numero) => {
    serie++;
    const id = `hist-${String(serie).padStart(5, "0")}`;
    const minutosDoDia = Math.round((quando.getTime() - relogio.meiaNoite.getTime()) / MIN) % 1440;
    const noite = ((minutosDoDia % 1440) + 1440) % 1440 >= 17 * 60;

    // De onde veio: site, balcão, iFood ou o robô do WhatsApp.
    const canal = pesado([["ONLINE", 44], ["PRESENCIAL", 24], ["IFOOD", 22], ["WHATSAPP_IA", 10]], (c) => c[1])[0];
    const entrega = canal === "PRESENCIAL" ? false : canal === "ONLINE" ? sorteio() < 0.8 : true;

    // O que pediu: lanche, pizza (só à noite) ou porção, com bebida na maior parte das vezes.
    const linhas = [];
    const tipo = sorteio();
    if (noite && tipo < 0.32) {
      linhas.push([um(["Pizza Calabresa", "Pizza Calabresa", "Pizza Marguerita"]), 1]);
      if (sorteio() < 0.65) linhas.push(["Guaraná 2 L", 1]);
    } else if (tipo < 0.9) {
      const lanche = pesado([["X-Burger", 30], ["X-Bacon", 38], ["X-Tudo", 32]], (c) => c[1])[0];
      const quantos = sorteio() < 0.3 ? 2 : 1;
      linhas.push([lanche, quantos]);
      if (sorteio() < 0.45) linhas.push(["Batata Frita", 1]);
      if (sorteio() < 0.7) linhas.push(["Coca-Cola lata", quantos]);
    } else {
      linhas.push(["Batata Frita", entre(1, 2)]);
      linhas.push([um(["Coca-Cola lata", "Guaraná 2 L"]), 1]);
    }
    const totalDosItens = linhas.reduce((t, [nome, q]) => t + produtos[nome].price * q, 0);

    const [bairro, taxa] = entrega ? pesado(BAIRROS, (b) => b[2]) : [null, 0];
    const rua = entrega ? `${um(RUAS)}, ${entre(12, 980)} - ${bairro}` : null;

    // Forma de pagamento, do jeito que cada canal grava.
    const forma = canal === "IFOOD" ? "DIGITAL_WALLET"
      : canal === "PRESENCIAL" ? pesado([["Dinheiro", 34], ["PIX", 36], ["Cartão Débito", 16], ["Cartão Crédito", 14]], (c) => c[1])[0]
      : pesado([["PIX", 46], ["CREDITO", 22], ["DEBITO", 12], ["DINHEIRO", 20]], (c) => c[1])[0];

    // Cupom: um pouco no site (a loja banca) e no iFood (parte a loja, parte o aplicativo).
    let desconto = 0, descontoDaLoja = null, descontoDoApp = null, observacao = null;
    if (canal === "ONLINE" && sorteio() < 0.1) {
      desconto = Math.round(totalDosItens * 0.1 * 100) / 100;
      descontoDaLoja = desconto;
      observacao = "[Cupom: BEMVINDO10]";
    } else if (canal === "IFOOD" && sorteio() < 0.22) {
      descontoDoApp = 5; descontoDaLoja = sorteio() < 0.4 ? 3 : 0;
      desconto = descontoDoApp + descontoDaLoja;
      if (!descontoDaLoja) descontoDaLoja = null;
    }

    const cancelado = sorteio() < 0.045;
    const aceito = new Date(quando.getTime() + (canal === "PRESENCIAL" ? 0 : entre(1, 4) * MIN));
    const pronto = new Date(aceito.getTime() + entre(9, 24) * MIN);
    const saiu = entrega ? new Date(pronto.getTime() + entre(2, 9) * MIN) : null;
    const entregue = new Date((saiu || pronto).getTime() + (entrega ? entre(9, 26) : entre(1, 6)) * MIN);

    pedidos.push({
      id, franchiseeId: L, source: canal, dailyOrderNumber: numero,
      customerName: `${um(NOMES)} ${um(SOBRENOMES)}`, customerPhone: `1196${String(1000000 + entre(0, 8999999)).slice(-7)}`,
      customerAddress: canal === "IFOOD" && rua ? `${rua} - Cidade Exemplo` : rua,
      deliveryType: entrega ? "DELIVERY" : "RETIRADA", paymentMethod: forma,
      deliveryFee: taxa, motoboyFee: entrega ? 6 : null,
      motoboyId: entrega && !cancelado ? (sorteio() < 0.55 ? motoboys.carlos.id : motoboys.rafael.id) : null,
      totalAmount: Math.round((totalDosItens + taxa - desconto) * 100) / 100,
      discountTotal: desconto || null, discountMerchant: descontoDaLoja, discountIfood: descontoDoApp, notes: observacao,
      ...(canal === "IFOOD" ? { ifoodOrderId: `tutorial-hist-${serie}`, ifoodReference: String(entre(1000, 9999)) } : {}),
      ...(cancelado
        ? { status: "CANCELADO", cancelledBy: sorteio() < 0.5 ? "RESTAURANT" : "CUSTOMER", cancelReason: um(["Cliente desistiu", "Endereço fora da área", "Produto em falta"]),
          cancelledAt: new Date(quando.getTime() + entre(3, 14) * MIN) }
        : { status: "ENTREGUE", kdsStage: "FINISHED", acceptedAt: aceito, kdsProductionAt: aceito, readyAt: pronto, kdsFinishedAt: pronto,
          dispatchedAt: saiu, deliveredAt: entregue }),
      createdAt: quando, updatedAt: cancelado ? quando : entregue,
    });
    for (const [nome, quantity] of linhas) {
      itens.push({
        orderId: id, menuProductId: produtos[nome].id, productName: nome, quantity, price: produtos[nome].price,
        prontoEm: cancelado ? null : new Date(pronto.getTime() - entre(0, 3) * MIN),
      });
    }
  };

  /** Os horários de um dia: 30% no almoço, 70% à noite, com o pico entre 19h e 21h. */
  const horarios = (quantos, ateMinuto = 22 * 60 + 30) => {
    const lista = [];
    for (let i = 0; i < quantos; i++) {
      const m = sorteio() < 0.3 ? entre(11 * 60 + 15, 14 * 60) : pesado(
        [[18 * 60, 19 * 60, 22], [19 * 60, 20 * 60, 30], [20 * 60, 21 * 60, 28], [21 * 60, 22 * 60 + 30, 20]], (f) => f[2],
      ).slice(0, 2).reduce((a, b) => entre(a, b - 1));
      if (m <= ateMinuto) lista.push(m);
    }
    return lista.sort((a, b) => a - b);
  };

  for (let d = dias; d >= 1; d--) {
    const diaDaSemana = (((relogio.diaDaSemana - d) % 7) + 7) % 7;
    // A loja vem crescendo: o mês passado vendeu um pouco menos que este.
    const quantos = Math.round(POR_DIA[diaDaSemana] * (d > 30 ? 0.82 : 1)) + entre(-1, 2);
    const base = relogio.meiaNoite.getTime() - d * DIA;
    horarios(quantos).forEach((m, i) => montar(new Date(base + m * MIN + entre(0, 50) * 1000), i + 1));
  }

  // Hoje, antes do movimento da noite: os pedidos da semente (os das últimas
  // 2h30) passam a vir DEPOIS destes na numeração do dia.
  const deHoje = horarios(9, relogio.minutos - 170);
  deHoje.forEach((m, i) => montar(new Date(relogio.meiaNoite.getTime() + m * MIN), i + 1));
  if (deHoje.length) {
    await prisma.customerOrder.updateMany({ where: { franchiseeId: L, id: { not: { startsWith: "hist-" } } }, data: { dailyOrderNumber: { increment: deHoje.length } } });
  }

  for (let i = 0; i < pedidos.length; i += 200) await prisma.customerOrder.createMany({ data: pedidos.slice(i, i + 200) });
  for (let i = 0; i < itens.length; i += 400) await prisma.customerOrderItem.createMany({ data: itens.slice(i, i + 400) });
  return pedidos.length;
}

/** As despesas que a loja lançou à mão no DRE nas últimas semanas (modelo DespesaLancada). */
export async function criarDespesas(prisma, { loja }) {
  const despesas = [
    [2, "Gás", "Botijão P13", 125],
    [4, "Embalagens", "Caixas de pizza e sacos de papel", 248],
    [6, "Material de limpeza", "Detergente, desengordurante e pano", 86.5],
    [9, "Gás", "Botijão P13", 125],
    [11, "Manutenção e conserto", "Conserto da chapa", 180],
    [15, "Embalagens", "Embalagem de lanche e guardanapo", 192],
    [17, "Gás", "Botijão P13", 125],
    [20, "Marketing e anúncios", "Panfletos do bairro", 150],
    [24, "Gás", "Botijão P13", 120],
    [27, "Material de limpeza", "Reposição do mês", 74],
    [33, "Embalagens", "Caixas de pizza", 210],
    [38, "Gás", "Botijão P13", 120],
    [45, "Manutenção e conserto", "Troca da resistência da estufa", 95],
  ];
  await prisma.despesaLancada.createMany({
    data: despesas.map(([haDias, categoria, descricao, valor], i) => ({
      franchiseeId: loja.id, dia: diaDaLoja(haDias), categoria, descricao, valor, criadoPor: "demo@tutorial.local",
      createdAt: new Date(Date.now() - haDias * DIA - i * MIN),
    })),
  });
}

/** Custo em cada produto e custos fixos do mês: é o que faz o DRE mostrar lucro de verdade. */
export async function cadastrarCustos(prisma, { loja, produtos }) {
  for (const [nome, cost] of Object.entries(CUSTOS)) {
    await prisma.menuProduct.update({ where: { id: produtos[nome].id }, data: { cost } });
  }
  await prisma.user.update({ where: { id: loja.id }, data: { fixedCosts: CUSTOS_FIXOS } });
}
