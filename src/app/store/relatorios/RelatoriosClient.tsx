"use client";
import React, { useState, useMemo, useCallback } from "react";
import { minutosEntre } from "@/lib/order-stages";
import FiltroMultiplo from "@/components/customer/FiltroMultiplo";
import { chaveDaLoja, lojasDosPedidos, type PedidoDoRelatorio } from "@/lib/origem-do-relatorio";
import { itemEntra, opcoesQueEntram, somarVendas } from "@/lib/soma-do-relatorio";
import type { LojaDeOrigem } from "@/lib/loja-de-origem";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  ShoppingBag,
  BarChart2,
  Calendar,
  ChevronDown,
  Award,
  Activity,
  Tag,
  Download,
  Filter,
  Package,
  Search,
  PieChart,
  Grid,
  Clock,
  Timer,
  Bike,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Store as StoreIcon
} from "lucide-react";

// Presets de período
const PERIOD_PRESETS = [
  { label: "Hoje", days: 0 },
  { label: "Ontem", days: 1 },
  { label: "Últimos 7 dias", days: 7 },
  { label: "Últimos 15 dias", days: 15 },
  { label: "Últimos 30 dias", days: 30 },
  { label: "Este mês", days: -1 },
  { label: "Tudo (365 dias)", days: 365 },
];

function getRange(presetDays: number): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date();
  
  if (presetDays === 0) {
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  }
  
  if (presetDays === 1) {
    from.setDate(to.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    
    const tempTo = new Date(from);
    tempTo.setHours(23, 59, 59, 999);
    return { from, to: tempTo };
  }
  
  if (presetDays === -1) {
    // Este mês
    const startOfMonth = new Date(to.getFullYear(), to.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);
    return { from: startOfMonth, to };
  }
  
  from.setDate(to.getDate() - presetDays);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

// Formatação
const fmtR = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

// ── OPERAÇÃO ────────────────────────────────────────────────────────────────
// Tudo daqui para baixo lê os marcos de tempo do pedido (acceptedAt,
// dispatchedAt, deliveredAt...) gravados pela extensão do Prisma. Ver
// src/lib/order-stages.ts.

// A plataforma de cada pedido vem pronta do servidor (`canal`), decidida por
// lib/canal-do-pedido.ts — a mesma régua do selo do painel e da comanda. Aqui
// fica só o nome e a cor com que o RELATÓRIO mostra cada uma. Balcão e PDV são
// o mesmo canal (a venda do caixa grava "PRESENCIAL"), e o site próprio é um só,
// escreva a rota "SITE" ou "ONLINE".
const PLATAFORMAS: Record<string, { label: string; cor: string }> = {
  IFOOD:        { label: "iFood",           cor: "#EA1D2C" },
  "99FOOD":     { label: "99Food",          cor: "#B45309" },
  JOTAJA:       { label: "Jotajá",          cor: "#475569" },
  BRENDI:       { label: "Brendi",          cor: "#44403C" },
  WABIZ:        { label: "Wabiz",           cor: "#0F766E" },
  TOTEM:        { label: "Totem",           cor: "#E8590C" },
  PDV:          { label: "Balcão",          cor: "#64748B" },
  MESA:         { label: "Mesa",            cor: "#B45309" },
  WHATSAPP_IA:  { label: "WhatsApp (robô)", cor: "#25D366" },
  SITE:         { label: "Site próprio",    cor: "#1C1917" },
  DESCONHECIDO: { label: "Outro canal",     cor: "#94A3B8" },
};

const plataformaDe = (chave: string) =>
  PLATAFORMAS[String(chave || "").toUpperCase()] || { label: chave || "Outro canal", cor: "#94A3B8" };

// Prazo do pedido — MESMA regra que pinta o card no painel de pedidos
// (StoreOrdersDashboard): agendamento de verdade manda; senão, 40 min para
// retirada e 45 min para entrega. Se a regra mudar lá, muda aqui também, ou o
// relatório passa a contar atraso que a tela não mostrou.
const MIN_PADRAO_RETIRADA = 40;
const MIN_PADRAO_ENTREGA = 45;

function ehRetirada(o: any) {
  const t = String(o.deliveryType || "").toUpperCase();
  return t === "RETIRADA" || t === "TAKEOUT" || t.includes("RETIRADA");
}

/** Saiu para a rua. Mesa e balcão não contam como entrega. */
function ehEntrega(o: any) {
  return String(o.deliveryType || "").toUpperCase() === "DELIVERY";
}

function prazoDoPedido(o: any): number {
  const criado = new Date(o.createdAt).getTime();
  const agendado = o.scheduledDatetime ? new Date(o.scheduledDatetime).getTime() : 0;
  const agendamentoReal = agendado > criado + 2 * 60000;
  if (agendamentoReal) return agendado;
  return criado + (ehRetirada(o) ? MIN_PADRAO_RETIRADA : MIN_PADRAO_ENTREGA) * 60000;
}

// Momento em que o pedido saiu das mãos da loja: para entrega é a saída do
// motoboy; para retirada, a hora em que o cliente levou.
function momentoDaSaida(o: any): string | null {
  return o.dispatchedAt || (ehRetirada(o) ? o.deliveredAt : null);
}

const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);

// A MEDIANA E O NUMERO HONESTO AQUI.
//
// Medido na Hakim Centro em 01/09/2026: metade das entregas chega em ate 29
// min, mas a media da 65 -- a operacao finaliza pedido em lote (o operador
// arrasta uma leva inteira para "Entregue" quando lembra), e essa cauda longa
// puxa a media para cima sozinha. O lojista que le "1h05 na rua" conclui que a
// entrega esta pessima quando o problema e a hora em que alguem clica.
const mediana = (v: number[]) => {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

const fmtMin = (v: number | null) => {
  if (v === null) return "—";
  if (v < 60) return `${Math.round(v)} min`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return `${h}h${String(m).padStart(2, "0")}`;
};

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function RelatoriosClient({
  orders,
  products,
  categorias,
  storeName,
  timeAlertConfig,
  lojasDeOrigem,
}: {
  orders: any[];
  products: any[];
  /** As categorias do cardápio de verdade — sem "iFood"/"99Food" (page.tsx). */
  categorias: string[];
  storeName: string;
  /** Vazia quando a conta não tem o que separar (lib/lojas-de-origem-da-conta.ts). */
  lojasDeOrigem?: LojaDeOrigem[];
  timeAlertConfig?: { yellowEnabled?: boolean; yellowMinutes?: number; redEnabled?: boolean; redMinutes?: number } | null;
}) {
  const [preset, setPreset] = useState(2); // 7 dias padrão
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  // ── OS FILTROS SÃO LISTAS ────────────────────────────────────────────────
  //
  // Lista VAZIA = todos, e não "nenhum". É o estado em que a tela abre e o
  // único que o lojista alcança sem querer (desmarcando o último item) — e um
  // relatório que zerasse por isso pareceria quebrado. Ver FiltroMultiplo.
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedPlataformas, setSelectedPlataformas] = useState<string[]>([]);
  const [selectedLojas, setSelectedLojas] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  // Set é o que a conta usa: o filtro roda dentro do laço de TODO item de TODO
  // pedido do período (365 dias), e `array.includes` ali dentro é quadrático.
  const produtosMarcados = useMemo(() => new Set(selectedProducts), [selectedProducts]);
  const categoriasMarcadas = useMemo(() => new Set(selectedCategories), [selectedCategories]);
  const plataformasMarcadas = useMemo(() => new Set(selectedPlataformas), [selectedPlataformas]);
  const lojasMarcadas = useMemo(() => new Set(selectedLojas), [selectedLojas]);

  // O filtro de itens que a conta dos cartões e do ranking usa. A regra das
  // opções (a borda dentro da pizza) mora em lib/soma-do-relatorio.ts.
  const filtroDeItens = useMemo(
    () => ({ produtos: produtosMarcados, categorias: categoriasMarcadas }),
    [produtosMarcados, categoriasMarcadas],
  );

  // A linha do espelho do iFood/99 no ranking leva a categoria do ITEM vendido,
  // que o servidor resolveu com as opções escolhidas ("GRANDE 2 SABORES" é
  // pizza pelas metades que o cliente escolheu).
  const idsDeEspelho = useMemo(
    () => new Set(products.filter((p) => p.espelho).map((p) => p.id)),
    [products],
  );

  // As categorias vêm do servidor, só as do cardápio de verdade: "iFood" e
  // "99Food" são plataforma, e têm filtro próprio.
  const categories = categorias;

  // ── AS OPÇÕES DE CADA FILTRO ─────────────────────────────────────────────
  //
  // O produto leva a categoria como detalhe à direita: o cardápio tem "Esfiha
  // Calabresa" em Tradicionais e em Combos, e sem a categoria ao lado são duas
  // linhas iguais na lista.
  const opcoesDeProduto = useMemo(
    () => products.map((p) => ({ valor: p.id, rotulo: p.name, detalhe: p.category || "Outros" })),
    [products],
  );

  const opcoesDeCategoria = useMemo(
    () => categories.map((c) => ({ valor: c, rotulo: c })),
    [categories],
  );

  // Intervalo de datas selecionado
  const { from, to } = useMemo(() => {
    if (useCustom && customFrom && customTo) {
      return {
        from: new Date(customFrom + "T00:00:00"),
        to: new Date(customTo + "T23:59:59"),
      };
    }
    return getRange(PERIOD_PRESETS[preset].days);
  }, [preset, useCustom, customFrom, customTo]);

  // 1. Filtrar pedidos por data
  const noPeriodo = useMemo(() => {
    return orders.filter((o) => {
      const d = new Date(o.createdAt);
      return d >= from && d <= to && o.status !== "CANCELADO";
    });
  }, [orders, from, to]);

  // ── DE QUAL PLATAFORMA E DE QUAL LOJA ────────────────────────────────────
  //
  // Dois filtros desde 23/09/2026 (lib/origem-do-relatorio.ts conta o porquê):
  // a PLATAFORMA — iFood, 99Food, Site próprio, Balcão… — e a LOJA, que só
  // existe quando a conta tem mais de uma. As opções saem dos pedidos DO
  // PERÍODO, antes destes filtros: se saíssem dos já filtrados, marcar o iFood
  // apagaria as outras plataformas da lista e não haveria como voltar sem
  // limpar tudo. A contagem de pedidos vai ao lado: diz de cara qual é a grande.
  const opcoesDePlataforma = useMemo(() => {
    const conta = new Map<string, number>();
    for (const o of noPeriodo) conta.set(o.canal, (conta.get(o.canal) || 0) + 1);
    return Array.from(conta.entries())
      .sort((a, b) => b[1] - a[1] || plataformaDe(a[0]).label.localeCompare(plataformaDe(b[0]).label))
      .map(([chave, quantidade]) => ({
        valor: chave, rotulo: plataformaDe(chave).label, cor: plataformaDe(chave).cor,
        detalhe: `${quantidade} ${quantidade === 1 ? "pedido" : "pedidos"}`,
      }));
  }, [noPeriodo]);

  const opcoesDeLoja = useMemo(
    () => lojasDosPedidos(noPeriodo as PedidoDoRelatorio[], lojasDeOrigem).map((l) => ({
      valor: l.chave, rotulo: l.rotulo,
      detalhe: `${l.quantidade} ${l.quantidade === 1 ? "pedido" : "pedidos"}`,
    })),
    [noPeriodo, lojasDeOrigem],
  );

  // Plataforma e loja valem para o RELATÓRIO INTEIRO — faturamento, ranking,
  // tempos, cancelamentos —, porque "quanto vendi no iFood" é uma pergunta
  // sobre o relatório todo, não sobre um cartão dele. Entre os dois é E.
  const passaNaOrigem = useCallback(
    (o: any) =>
      (plataformasMarcadas.size === 0 || plataformasMarcadas.has(o.canal)) &&
      (lojasMarcadas.size === 0 || lojasMarcadas.has(chaveDaLoja(o as PedidoDoRelatorio, lojasDeOrigem))),
    [plataformasMarcadas, lojasMarcadas, lojasDeOrigem],
  );

  const dateFilteredOrders = useMemo(() => {
    if (plataformasMarcadas.size === 0 && lojasMarcadas.size === 0) return noPeriodo;
    return noPeriodo.filter(passaNaOrigem);
  }, [noPeriodo, plataformasMarcadas, lojasMarcadas, passaNaOrigem]);

  // 2. Filtrar itens dos pedidos baseados no filtro de produto e categoria.
  // Lista vazia = todos; dentro de cada filtro as marcas são OU, e entre
  // filtros é E — "Bebidas ou Sobremesas, dos produtos X e Y". A borda que vem
  // DENTRO da pizza entra quando a categoria dela é marcada, sem contar o
  // dinheiro dela duas vezes (lib/soma-do-relatorio.ts).
  const processedData = useMemo(() => {
    const soma = somarVendas(dateFilteredOrders, filtroDeItens);
    const totalProfit = soma.receita - soma.cmv;

    return {
      revenue: soma.receita,
      cmv: soma.cmv,
      profit: totalProfit,
      margin: soma.receita > 0 ? (totalProfit / soma.receita) * 100 : 0,
      unitsSold: soma.unidades,
      // Quantas das unidades vieram como opção dentro de outro produto — é o
      // que o cartão explica embaixo do número, para ninguém procurar a borda
      // entre os itens do pedido.
      unidadesDeOpcao: soma.unidadesDeOpcao,
      ordersCount: soma.pedidos,
      ticketMedio: soma.pedidos > 0 ? soma.receita / soma.pedidos : 0,
    };
  }, [dateFilteredOrders, filtroDeItens]);

  // 3. Gerar Ranking de Produtos no período selecionado
  const productRanking = useMemo(() => {
    const counts: Record<
      string,
      {
        id: string;
        name: string;
        category: string;
        qty: number;
        revenue: number;
        cost: number;
        profit: number;
        price: number;
      }
    > = {};

    // Inicializa todos os produtos com 0 vendas
    products.forEach((p) => {
      counts[p.id] = {
        id: p.id,
        name: p.name,
        category: p.category || "Outros",
        qty: 0,
        revenue: 0,
        cost: 0,
        profit: 0,
        price: p.price,
      };
    });

    // Soma as vendas
    dateFilteredOrders.forEach((o) => {
      o.items.forEach((item: any) => {
        if (!item.productId) return;
        
        // Se o produto foi removido e não está na lista oficial de produtos, inicializa dinamicamente
        if (!counts[item.productId]) {
          counts[item.productId] = {
            id: item.productId,
            name: item.productName || "Produto Removido",
            category: item.productCategory || "Outros",
            qty: 0,
            revenue: 0,
            cost: 0,
            profit: 0,
            price: item.price,
          };
        }

        const data = counts[item.productId];
        // Espelho: a categoria que vale é a do item, resolvida no servidor.
        if (idsDeEspelho.has(item.productId)) data.category = item.productCategory || data.category;
        data.qty += item.quantity;
        data.revenue += item.price * item.quantity;
        data.cost += item.productCost * item.quantity;
        data.profit = data.revenue - data.cost;

        // As opções (borda, adicional) viram linha própria — a do complemento
        // do cadastro, ou uma com o nome que o canal mandou quando só a
        // categoria foi reconhecida. A MESMA regra dos cartões, da mesma lib:
        // só quando o lojista perguntou por categoria ou produto, e o dinheiro
        // só quando o item que carrega a opção ficou fora da conta.
        for (const { opcao: op, valor } of opcoesQueEntram(item, filtroDeItens, itemEntra(item, filtroDeItens))) {
          const chave = op.id || `opcao:${op.categoria}:${op.nome}`;
          if (!counts[chave]) {
            counts[chave] = {
              id: chave, name: op.nome, category: op.categoria,
              qty: 0, revenue: 0, cost: 0, profit: 0, price: op.preco || 0,
            };
          }
          const linha = counts[chave];
          linha.qty += op.quantidade;
          linha.revenue += valor;
          linha.cost += (op.custo || 0) * op.quantidade;
          linha.profit = linha.revenue - linha.cost;
        }
      });
    });

    return Object.values(counts)
      .filter((p) => {
        const matchesCategory = categoriasMarcadas.size === 0 || categoriasMarcadas.has(p.category);
        // O FILTRO DE PRODUTO PASSOU A VALER AQUI TAMBÉM.
        //
        // Antes o produto mexia só nos cartões de cima: marcar "Coca Cola 2l"
        // dava o faturamento dela e uma tabela com o cardápio inteiro embaixo
        // — e o "Produto Campeão", que sai desta lista, mostrava outro
        // produto. Com três produtos marcados o desencontro ficaria gritante.
        const matchesProduct = produtosMarcados.size === 0 || produtosMarcados.has(p.id);
        const matchesSearch =
          searchQuery.trim() === "" ||
          p.name.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesProduct && matchesSearch;
      })
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
  }, [dateFilteredOrders, products, categoriasMarcadas, produtosMarcados, searchQuery, idsDeEspelho, filtroDeItens]);

  // ── ENTREGAS E O QUE ELAS CUSTARAM ───────────────────────────────────────
  //
  // Dois números, e o segundo tem uma armadilha: o que a loja PAGA ao
  // entregador não é a taxa que o cliente pagou (lib/repasse-do-entregador.ts).
  // Em pedido de app a taxa é dinheiro do marketplace — o Lucas via "Taxa
  // R$ 6,94" numa entrega que ele paga R$ 2,00. Por isso o custo vem calculado
  // do servidor, pela mesma conta do fechamento de motoboys.
  //
  // Entrega SEM entregador atribuído chega com `custoDaEntrega: null` e é
  // contada à parte, não como zero. Somar null como zero afirmaria que aquela
  // entrega saiu de graça — e é justamente o contrário: é a que ninguém sabe
  // quanto custou.
  const entregas = useMemo(() => {
    let quantidade = 0, custo = 0, semCusto = 0;
    for (const o of dateFilteredOrders) {
      if (!ehEntrega(o)) continue;
      quantidade++;
      const c = (o as any).custoDaEntrega;
      if (typeof c === "number") custo += c; else semCusto++;
    }
    return {
      quantidade,
      custo: Math.round(custo * 100) / 100,
      semCusto,
      apuradas: quantidade - semCusto,
      medio: quantidade - semCusto > 0 ? custo / (quantidade - semCusto) : 0,
    };
  }, [dateFilteredOrders]);

  // ── O TOTAL DO QUE ESTÁ LISTADO ──────────────────────────────────────────
  //
  // Soma a coluna do ranking COMO ELE ESTÁ na tela — com os filtros e a busca
  // aplicados. É o que responde "quantas esfihas eu vendi": marca a categoria
  // Esfihas e o rodapé dá o total delas, sem calculadora e sem exportar.
  //
  // Não é a mesma conta dos cartões lá de cima e não deve ser: lá o total é do
  // PEDIDO (faturamento com taxa de entrega, desconto, pedidos contados uma
  // vez); aqui é a soma dos ITENS listados. Por isso o rodapé diz "dos X
  // produtos listados" — o número tem que carregar o próprio recorte, senão
  // vira mais um total para o lojista conferir contra os outros.
  const totalDoRanking = useMemo(() => {
    let qty = 0, revenue = 0, cost = 0, profit = 0, comVenda = 0;
    for (const p of productRanking) {
      qty += p.qty;
      revenue += p.revenue;
      cost += p.cost;
      profit += p.profit;
      if (p.qty > 0) comVenda++;
    }
    return { qty, revenue, cost, profit, comVenda, listados: productRanking.length };
  }, [productRanking]);

  // Produto Campeão (Top 1)
  const championProduct = useMemo(() => {
    if (productRanking.length === 0) return null;
    const top = productRanking[0];
    return top.qty > 0 ? top : null;
  }, [productRanking]);

  // 4. De onde vem os pedidos (plataforma): quantidade, % e faturamento
  const sourceStats = useMemo(() => {
    const stats: Record<string, { count: number; total: number }> = {};
    let totalRevenue = 0;

    dateFilteredOrders.forEach((o) => {
      // A mesma chave do filtro de plataforma: a fatia "iFood" da rosca e a
      // opção "iFood" do filtro são os mesmos pedidos.
      const source = o.canal || "DESCONHECIDO";
      if (!stats[source]) stats[source] = { count: 0, total: 0 };
      stats[source].count++;
      stats[source].total += o.totalAmount;
      totalRevenue += o.totalAmount;
    });

    const totalPedidos = dateFilteredOrders.length;

    return Object.entries(stats).map(([key, value]) => {
      const plat = plataformaDe(key);
      return {
        key,
        label: plat.label,
        color: plat.cor,
        count: value.count,
        total: value.total,
        ticket: value.count > 0 ? value.total / value.count : 0,
        // pctQtd e a fatia do grafico: o lojista pergunta "quantos por cento
        // dos meus pedidos vem do iFood", nao quanto por cento do dinheiro.
        pctQtd: totalPedidos > 0 ? (value.count / totalPedidos) * 100 : 0,
        pct: totalRevenue > 0 ? (value.total / totalRevenue) * 100 : 0,
      };
    }).sort((a, b) => b.count - a.count);
  }, [dateFilteredOrders]);

  // 5. Formas de Pagamento
  const paymentStats = useMemo(() => {
    const stats: Record<string, { count: number; total: number }> = {};
    let totalRevenue = 0;

    dateFilteredOrders.forEach((o) => {
      const method = o.paymentMethod || "Outros";
      if (!stats[method]) stats[method] = { count: 0, total: 0 };
      stats[method].count++;
      stats[method].total += o.totalAmount;
      totalRevenue += o.totalAmount;
    });

    const PM_COLORS: Record<string, string> = {
      PIX: "#0D9488",
      DINHEIRO: "#0D9488",
      CREDITO: "#44403C",
      DEBITO: "#2196F3",
      VOUCHER: "#E8590C"
    };

    return Object.entries(stats).map(([key, value]) => ({
      key,
      count: value.count,
      total: value.total,
      pct: totalRevenue > 0 ? (value.total / totalRevenue) * 100 : 0,
      color: PM_COLORS[key.toUpperCase()] || "#64748B",
    })).sort((a, b) => b.total - a.total);
  }, [dateFilteredOrders]);

  // 6. TEMPOS MEDIOS DE CADA TELA
  // So entra na conta o pedido que TEM os dois carimbos da etapa. Pedido
  // anterior a medicao fica de fora em vez de virar zero -- media com zero
  // fantasma e pior que media sobre menos pedidos.
  const tempos = useMemo(() => {
    const fila: number[] = [];
    const cozinha: number[] = [];
    const esperandoSaida: number[] = [];
    const naRua: number[] = [];
    const total: number[] = [];
    const kdsMontagem: number[] = [];

    const junta = (destino: number[], v: number | null) => { if (v !== null) destino.push(v); };

    dateFilteredOrders.forEach((o) => {
      junta(fila, minutosEntre(o.createdAt, o.acceptedAt));
      junta(cozinha, minutosEntre(o.acceptedAt, o.readyAt || o.dispatchedAt || (ehRetirada(o) ? o.deliveredAt : null)));
      junta(esperandoSaida, minutosEntre(o.readyAt, o.dispatchedAt));
      junta(naRua, minutosEntre(o.dispatchedAt, o.deliveredAt));
      junta(total, minutosEntre(o.createdAt, o.deliveredAt));
      junta(kdsMontagem, minutosEntre(o.kdsProductionAt, o.kdsFinishingAt));
    });

    const etapas = [
      { chave: "fila", titulo: "Esperando aceite", legenda: "Da hora que o pedido caiu ate alguem aceitar", cor: "#1C1917", dados: fila },
      { chave: "cozinha", titulo: "Na cozinha", legenda: "Do aceite ate o pedido ficar pronto ou sair", cor: "#B45309", dados: cozinha },
      { chave: "esperandoSaida", titulo: "Pronto esperando motoboy", legenda: "Do PRONTO ate sair para entrega", cor: "#64748B", dados: esperandoSaida },
      { chave: "naRua", titulo: "Na rua", legenda: "Da saida ate a entrega no cliente", cor: "#0F766E", dados: naRua },
      { chave: "kds", titulo: "Finalizacao no KDS", legenda: "Da producao ate a montagem terminar", cor: "#44403C", dados: kdsMontagem },
      { chave: "total", titulo: "Tempo total", legenda: "Do pedido ate o cliente receber", cor: "#0F172A", dados: total },
    ].map((e) => ({ ...e, media: media(e.dados), mediana: mediana(e.dados), medidos: e.dados.length }));

    const comDados = etapas.filter((e) => e.medidos > 0);

    return { etapas, comDados, temAlgumaMedicao: comDados.length > 0 };
  }, [dateFilteredOrders]);

  // 7. COMO OS PEDIDOS SAIRAM (faixa de alerta no momento da saida)
  // Mesma regua do painel: sobra de tempo ate o prazo. Vermelho e amarelo sao
  // os limites que o lojista configurou nos Alertas de Producao.
  const saidas = useMemo(() => {
    const cfg = {
      yellowEnabled: timeAlertConfig?.yellowEnabled ?? true,
      yellowMinutes: Number(timeAlertConfig?.yellowMinutes ?? 10),
      redEnabled: timeAlertConfig?.redEnabled ?? true,
      redMinutes: Number(timeAlertConfig?.redMinutes ?? 5),
    };
    const amareloAtivo = cfg.yellowEnabled && cfg.yellowMinutes > 0;
    const vermelhoAtivo = cfg.redEnabled && cfg.redMinutes > 0;

    let noPrazo = 0, amarelo = 0, vermelho = 0, estourado = 0, medidos = 0;
    let somaFolga = 0;

    dateFilteredOrders.forEach((o) => {
      const saida = momentoDaSaida(o);
      if (!saida) return;
      const folga = (prazoDoPedido(o) - new Date(saida).getTime()) / 60000;
      if (!Number.isFinite(folga)) return;
      medidos++;
      somaFolga += folga;
      if (folga < 0) estourado++;
      else if (vermelhoAtivo && folga <= cfg.redMinutes) vermelho++;
      else if (amareloAtivo && folga <= cfg.yellowMinutes) amarelo++;
      else noPrazo++;
    });

    const pct = (n: number) => (medidos > 0 ? (n / medidos) * 100 : 0);

    return {
      medidos,
      folgaMedia: medidos > 0 ? somaFolga / medidos : null,
      limites: cfg,
      faixas: [
        { chave: "noPrazo", titulo: "Saiu no prazo", n: noPrazo, pct: pct(noPrazo), cor: "#0F766E", fundo: "#F0FDFA", detalhe: "Mais de " + cfg.yellowMinutes + " min de folga" },
        { chave: "amarelo", titulo: "Alerta amarelo", n: amarelo, pct: pct(amarelo), cor: "#B45309", fundo: "#FFF7E6", detalhe: "Saiu com " + cfg.redMinutes + " a " + cfg.yellowMinutes + " min de folga" },
        { chave: "vermelho", titulo: "Alerta vermelho", n: vermelho, pct: pct(vermelho), cor: "#C92E09", fundo: "#FEE2E2", detalhe: "Saiu em cima da hora (ate " + cfg.redMinutes + " min)" },
        { chave: "estourado", titulo: "Prazo estourado", n: estourado, pct: pct(estourado), cor: "#B71C1C", fundo: "#FECACA", detalhe: "Ja tinha passado do prazo prometido" },
      ],
    };
  }, [dateFilteredOrders, timeAlertConfig]);

  // 8. MOVIMENTO: hora do dia, dia da semana, entrega x retirada, cancelamentos
  const movimento = useMemo(() => {
    const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: h, count: 0, total: 0 }));
    const porDia = Array.from({ length: 7 }, (_, d) => ({ dia: d, count: 0, total: 0 }));
    let entrega = 0, retirada = 0, receitaTotal = 0;

    dateFilteredOrders.forEach((o) => {
      const d = new Date(o.createdAt);
      porHora[d.getHours()].count++;
      porHora[d.getHours()].total += o.totalAmount;
      porDia[d.getDay()].count++;
      porDia[d.getDay()].total += o.totalAmount;
      if (ehRetirada(o)) retirada++; else entrega++;
      receitaTotal += o.totalAmount;
    });

    // Cancelados ficam de fora de dateFilteredOrders -- para a taxa, contamos
    // de novo direto do periodo. Os filtros de PLATAFORMA e LOJA valem aqui
    // também: sem eles, marcar o iFood mostraria o faturamento dele com a taxa
    // de cancelamento da conta inteira, lado a lado, como se fossem do mesmo
    // recorte.
    let cancelados = 0, brutoNoPeriodo = 0;
    orders.forEach((o) => {
      const d = new Date(o.createdAt);
      if (d < from || d > to) return;
      if (!passaNaOrigem(o)) return;
      brutoNoPeriodo++;
      if (o.status === "CANCELADO") cancelados++;
    });

    const picoHora = porHora.reduce((a, b) => (b.count > a.count ? b : a), porHora[0]);
    const picoDia = porDia.reduce((a, b) => (b.count > a.count ? b : a), porDia[0]);
    const maxHora = Math.max(1, ...porHora.map((h) => h.count));
    const maxDia = Math.max(1, ...porDia.map((h) => h.count));
    const totalValidos = dateFilteredOrders.length;

    return {
      porHora, porDia, maxHora, maxDia, picoHora, picoDia,
      entrega, retirada, totalValidos, receitaTotal,
      ticketMedio: totalValidos > 0 ? receitaTotal / totalValidos : 0,
      cancelados,
      brutoNoPeriodo,
      taxaCancelamento: brutoNoPeriodo > 0 ? (cancelados / brutoNoPeriodo) * 100 : 0,
    };
  }, [dateFilteredOrders, orders, from, to, passaNaOrigem]);

  // Exportar dados como CSV
  const handleExportCSV = () => {
    const headers = ["Rank", "Produto", "Categoria", "Preço Base", "Quantidade Vendida", "Faturamento", "Custo Total", "Lucro Líquido"];
    const rows = productRanking.map((p, index) => [
      index + 1,
      `"${p.name.replace(/"/g, '""')}"`,
      `"${p.category.replace(/"/g, '""')}"`,
      p.price.toFixed(2),
      p.qty,
      p.revenue.toFixed(2),
      p.cost.toFixed(2),
      p.profit.toFixed(2),
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8,\uFEFF" +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `relatorio_vendas_${from.toISOString().split("T")[0]}_a_${to.toISOString().split("T")[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const CARD_SECAO = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 18, marginBottom: "1.5rem", padding: "1.25rem", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" };
  const CARD_SECAO_INTERNO = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 18, padding: "1.25rem", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" };

  return (
    <div style={{ padding: "1.5rem 1rem", maxWidth: 1280, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      
      {/* ── HEADER ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontWeight: 900, fontSize: "1.8rem", color: "#0F172A", margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            📈 Relatórios da Loja
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "#64748B", fontWeight: 500 }}>
            Operação, plataformas e vendas · <strong>{storeName}</strong>
          </p>
        </div>

        <button
          onClick={handleExportCSV}
          disabled={productRanking.length === 0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            background: "linear-gradient(135deg,#0F172A,#1E293B)",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            fontWeight: 700,
            fontSize: "0.88rem",
            cursor: productRanking.length === 0 ? "not-allowed" : "pointer",
            boxShadow: "0 4px 12px rgba(15,23,42,0.15)",
            opacity: productRanking.length === 0 ? 0.6 : 1,
            transition: "transform 0.1s"
          }}
        >
          <Download size={16} /> Exportar CSV
        </button>
      </div>

      {/* ── CONTRÔLES / FILTROS ── */}
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 18, padding: "1.25rem", marginBottom: "1.5rem", boxShadow: "0 2px 10px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", gap: "1rem" }}>
        
        {/* Filtros de Período Rápido */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.5px", marginRight: 6 }}>Período:</span>
          {PERIOD_PRESETS.map((p, i) => (
            <button
              key={i}
              onClick={() => {
                setPreset(i);
                setUseCustom(false);
              }}
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                border: "none",
                fontWeight: 700,
                fontSize: "0.8rem",
                cursor: "pointer",
                background: !useCustom && preset === i ? "#E8360C" : "#F1F5F9",
                color: !useCustom && preset === i ? "#fff" : "#475569",
                transition: "all 0.15s"
              }}
            >
              {p.label}
            </button>
          ))}
          <div style={{ display: "flex", gap: 5, alignItems: "center", marginLeft: "auto" }}>
            <Calendar size={14} color="#94A3B8" />
            <input
              type="date"
              value={customFrom}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                setUseCustom(true);
              }}
              style={{ padding: "5px 8px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.78rem", fontFamily: "inherit" }}
            />
            <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>até</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => {
                setCustomTo(e.target.value);
                setUseCustom(true);
              }}
              style={{ padding: "5px 8px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.78rem", fontFamily: "inherit" }}
            />
          </div>
        </div>

        <div style={{ height: "1px", background: "#F1F5F9" }} />

        {/* ── FILTROS: marcar vários em cada um ────────────────────────────
            Dentro de um filtro as marcas somam (OU); entre filtros, restringem
            (E). "Bordas" × "iFood" = quantas bordas saíram no iFood.

            A PLATAFORMA aparece sempre (abre em todas). A LOJA só aparece
            quando a conta tem o que separar — mais de uma loja no iFood, no
            99Food, ou um grupo de lojas. Numa loja só, o filtro ofereceria uma
            opção que não filtra nada. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
          <FiltroMultiplo
            rotulo="🔍 Filtrar por Produto"
            nomeDoTipo="produtos"
            placeholderBusca="buscar produto…"
            textoTodos={`Todos os produtos (${products.length})`}
            opcoes={opcoesDeProduto}
            selecionados={selectedProducts}
            onChange={setSelectedProducts}
          />

          <FiltroMultiplo
            rotulo="🍔 Filtrar por Categoria"
            nomeDoTipo="categorias"
            placeholderBusca="buscar categoria…"
            textoTodos={`Todas as categorias (${categories.length})`}
            opcoes={opcoesDeCategoria}
            selecionados={selectedCategories}
            onChange={setSelectedCategories}
          />

          <FiltroMultiplo
            rotulo="📱 Filtrar por Plataforma"
            nomeDoTipo="plataformas"
            placeholderBusca="buscar plataforma…"
            textoTodos={`Todas as plataformas (${opcoesDePlataforma.length})`}
            opcoes={opcoesDePlataforma}
            selecionados={selectedPlataformas}
            onChange={setSelectedPlataformas}
          />

          {opcoesDeLoja.length > 1 && (
            <FiltroMultiplo
              rotulo="🏪 Filtrar por Loja"
              nomeDoTipo="lojas"
              placeholderBusca="buscar loja…"
              textoTodos={`Todas as lojas (${opcoesDeLoja.length})`}
              opcoes={opcoesDeLoja}
              selecionados={selectedLojas}
              onChange={setSelectedLojas}
            />
          )}
        </div>

      </div>

      {/* ── BANNER DO PERÍODO ── */}
      <div style={{ background: "linear-gradient(135deg, #1E293B, #0F172A)", border: "1px solid #334155", color: "white", padding: "10px 1.5rem", borderRadius: 14, textAlign: "center", fontSize: "0.82rem", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: "1.5rem" }}>
        <span>📅 Visualizando dados de</span>
        <strong>{from.toLocaleDateString("pt-BR")}</strong>
        <span>até</span>
        <strong>{to.toLocaleDateString("pt-BR")}</strong>
      </div>

      {/* ── KPIs CARDS ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        
        {/* Receita dos Itens */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(15, 118, 110,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <DollarSign size={18} color="#0F766E" />
            </div>
            <span style={{ fontSize: "0.7rem", color: "#0F766E", background: "rgba(15, 118, 110,0.12)", padding: "3px 8px", borderRadius: 12, fontWeight: 700 }}>
              Faturamento
            </span>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>Valor Vendido</p>
            <p style={{ margin: "2px 0 0", fontSize: "1.4rem", fontWeight: 900, color: "#0F172A" }}>{fmtR(processedData.revenue)}</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>Exclui taxas de entrega</p>
          </div>
        </div>

        {/* Quantidade Vendida */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(28, 25, 23,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Package size={18} color="#1C1917" />
            </div>
            <span style={{ fontSize: "0.7rem", color: "#1C1917", background: "rgba(28, 25, 23,0.12)", padding: "3px 8px", borderRadius: 12, fontWeight: 700 }}>
              Volume
            </span>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>Quantidade de Itens</p>
            <p style={{ margin: "2px 0 0", fontSize: "1.4rem", fontWeight: 900, color: "#0F172A" }}>{processedData.unitsSold} u.</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>Unidades de produtos vendidas</p>
            {processedData.unidadesDeOpcao > 0 && (
              // A borda nunca é item do pedido: vem escolhida dentro da pizza.
              // Sem esta linha o lojista procura as bordas entre os itens e
              // não entende de onde saiu o número.
              <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#64748B", fontWeight: 600 }}>
                {processedData.unidadesDeOpcao === processedData.unitsSold ? "Todas" : processedData.unidadesDeOpcao} escolhidas dentro de outro produto (ex.: a borda da pizza)
              </p>
            )}
          </div>
        </div>

        {/* ── ENTREGAS ───────────────────────────────────────────────────── */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(14,165,233,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Bike size={18} color="#44403C" />
            </div>
            <span style={{ fontSize: "0.7rem", color: "#44403C", background: "rgba(14,165,233,0.12)", padding: "3px 8px", borderRadius: 12, fontWeight: 700 }}>
              Entregas
            </span>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>Pedidos Entregues</p>
            <p style={{ margin: "2px 0 0", fontSize: "1.4rem", fontWeight: 900, color: "#0F172A" }}>{entregas.quantidade}</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>
              {movimento.totalValidos > 0
                ? `${fmtPct((entregas.quantidade / movimento.totalValidos) * 100)} dos pedidos do período`
                : "Pedidos que saíram para a rua"}
            </p>
          </div>
        </div>

        {/* ── GASTO COM ENTREGAS ─────────────────────────────────────────────
            O que a LOJA paga ao entregador — não a taxa que o cliente pagou.
            Em pedido de app a taxa é dinheiro do marketplace, e confundir as
            duas foi reclamação real (ver lib/repasse-do-entregador.ts).

            Quando não há entrega apurada, o cartão DIZ isso em vez de mostrar
            R$ 0,00: zero é uma afirmação, e a afirmação estaria errada. */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(220,38,38,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Bike size={18} color="#C92E09" />
            </div>
            <span style={{ fontSize: "0.7rem", color: "#C92E09", background: "rgba(220,38,38,0.12)", padding: "3px 8px", borderRadius: 12, fontWeight: 700 }}>
              Custo
            </span>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>Gasto com Entregas</p>
            {entregas.apuradas > 0 ? (
              <>
                <p style={{ margin: "2px 0 0", fontSize: "1.4rem", fontWeight: 900, color: "#C92E09" }}>{fmtR(entregas.custo)}</p>
                <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>
                  {fmtR(entregas.medio)} por entrega · o que a loja paga ao entregador
                  {entregas.semCusto > 0 && (
                    <><br /><span style={{ color: "#B45309", fontWeight: 700 }}>
                      {entregas.semCusto} {entregas.semCusto === 1 ? "entrega sem entregador atribuído" : "entregas sem entregador atribuído"} — fora desta conta
                    </span></>
                  )}
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: "2px 0 0", fontSize: "1.1rem", fontWeight: 800, color: "#94A3B8" }}>Sem apuração</p>
                <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#B45309", fontWeight: 600, lineHeight: 1.45 }}>
                  {entregas.quantidade === 0
                    ? "Nenhuma entrega no período."
                    : `As ${entregas.quantidade} entregas do período não têm entregador atribuído, então não dá para saber quanto custaram. Atribua o entregador no pedido para este número aparecer.`}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Total de Pedidos */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(139,92,246,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ShoppingBag size={18} color="#64748B" />
            </div>
            <span style={{ fontSize: "0.7rem", color: "#64748B", background: "rgba(139,92,246,0.12)", padding: "3px 8px", borderRadius: 12, fontWeight: 700 }}>
              Movimentação
            </span>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>Pedidos no Filtro</p>
            <p style={{ margin: "2px 0 0", fontSize: "1.4rem", fontWeight: 900, color: "#0F172A" }}>{processedData.ordersCount} ped.</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>Ticket Médio do filtro: {fmtR(processedData.ticketMedio)}</p>
          </div>
        </div>

        {/* Lucro e Margem */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(245,158,11,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <TrendingUp size={18} color="#B45309" />
            </div>
            <span style={{ fontSize: "0.7rem", color: "#B45309", background: "rgba(245,158,11,0.12)", padding: "3px 8px", borderRadius: 12, fontWeight: 700 }}>
              Rentabilidade
            </span>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>Margem Estimada (Lucro)</p>
            <p style={{ margin: "2px 0 0", fontSize: "1.4rem", fontWeight: 900, color: "#0F172A" }}>
              {fmtPct(processedData.margin)}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>Lucro Líquido: {fmtR(processedData.profit)}</p>
          </div>
        </div>

      </div>

      {/* ── OPERAÇÃO: TEMPOS MÉDIOS DE CADA TELA ── */}
      <div style={CARD_SECAO}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: "1rem" }}>
          <div>
            <h2 style={{ margin: 0, fontWeight: 900, fontSize: "1rem", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
              <Timer size={18} color="#1C1917" /> Quanto tempo o pedido passa em cada tela
            </h2>
            <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
              Conta só o pedido que passou pela etapa com hora registrada. O número grande é a mediana — o pedido do meio, que não se deixa distorcer por um pedido esquecido aberto.
            </p>
          </div>
        </div>

        {!tempos.temAlgumaMedicao ? (
          <div style={{ background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 14, padding: "1.25rem", textAlign: "center", color: "#64748B", fontSize: "0.85rem" }}>
            <Clock size={22} style={{ opacity: 0.4 }} />
            <p style={{ margin: "8px 0 0", fontWeight: 700, color: "#475569" }}>Ainda não há pedido medido neste período</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.78rem" }}>
              A marcação de horário em cada tela começou agora. Pedidos antigos não têm esse registro —
              os tempos aparecem conforme a operação for rodando.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.85rem" }}>
            {tempos.comDados.map((e) => (
              <div key={e.chave} style={{ border: "1px solid #E2E8F0", borderRadius: 14, padding: "0.9rem 1rem", background: "#fff", borderTop: `4px solid ${e.cor}` }}>
                <p style={{ margin: 0, fontSize: "0.78rem", fontWeight: 800, color: "#334155" }}>{e.titulo}</p>
                <p style={{ margin: "6px 0 0", fontSize: "1.5rem", fontWeight: 900, color: e.cor, lineHeight: 1 }}>{fmtMin(e.mediana)}</p>
                <p style={{ margin: "3px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>metade dos pedidos leva até isso</p>
                <p style={{ margin: "6px 0 0", fontSize: "0.72rem", color: "#94A3B8", lineHeight: 1.35 }}>{e.legenda}</p>
                <p style={{ margin: "6px 0 0", fontSize: "0.7rem", color: "#CBD5E1", fontWeight: 700 }}>{e.medidos} pedido{e.medidos !== 1 ? "s" : ""} medido{e.medidos !== 1 ? "s" : ""} · média {fmtMin(e.media)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── OPERAÇÃO: COMO OS PEDIDOS SAÍRAM ── */}
      <div style={CARD_SECAO}>
        <div style={{ marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontWeight: 900, fontSize: "1rem", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
            <Bike size={18} color="#0F766E" /> Como os pedidos saíram para entrega
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
            Quanto tempo ainda faltava para o prazo prometido na hora em que o pedido saiu.
            Usa os mesmos limites dos Alertas de Produção: amarelo em {saidas.limites.yellowMinutes} min, vermelho em {saidas.limites.redMinutes} min.
          </p>
        </div>

        {saidas.medidos === 0 ? (
          <div style={{ background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 14, padding: "1.25rem", textAlign: "center", color: "#64748B", fontSize: "0.82rem" }}>
            Nenhuma saída medida neste período.
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem", marginBottom: "1rem" }}>
              {saidas.faixas.map((f) => (
                <div key={f.chave} style={{ background: f.fundo, borderRadius: 14, padding: "0.9rem 1rem", border: `1px solid ${f.cor}22` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    {f.chave === "noPrazo" ? <CheckCircle2 size={15} color={f.cor} /> : f.chave === "estourado" ? <XCircle size={15} color={f.cor} /> : <AlertTriangle size={15} color={f.cor} />}
                    <span style={{ fontSize: "0.78rem", fontWeight: 800, color: f.cor }}>{f.titulo}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: "1.7rem", fontWeight: 900, color: f.cor, lineHeight: 1 }}>
                    {f.n}
                    <span style={{ fontSize: "0.85rem", fontWeight: 800, marginLeft: 6 }}>({fmtPct(f.pct)})</span>
                  </p>
                  <p style={{ margin: "6px 0 0", fontSize: "0.71rem", color: "#475569", lineHeight: 1.35 }}>{f.detalhe}</p>
                </div>
              ))}
            </div>

            {/* Barra única: dá para ver a proporção de um relance */}
            <div style={{ display: "flex", height: 14, borderRadius: 8, overflow: "hidden", background: "#F1F5F9" }}>
              {saidas.faixas.map((f) => (
                f.pct > 0 ? <div key={f.chave} title={`${f.titulo}: ${f.n} (${fmtPct(f.pct)})`} style={{ width: `${f.pct}%`, background: f.cor }} /> : null
              ))}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: "0.75rem", color: "#94A3B8" }}>
              {saidas.medidos} saída{saidas.medidos !== 1 ? "s" : ""} medida{saidas.medidos !== 1 ? "s" : ""} no período
              {saidas.folgaMedia !== null && (
                <> · folga média na saída: <strong style={{ color: saidas.folgaMedia < 0 ? "#C92E09" : "#0F766E" }}>
                  {saidas.folgaMedia < 0 ? `${fmtMin(Math.abs(saidas.folgaMedia))} depois do prazo` : `${fmtMin(saidas.folgaMedia)} antes do prazo`}
                </strong></>
              )}
            </p>
          </>
        )}
      </div>

      {/* ── DE ONDE VÊM OS PEDIDOS ── */}
      <div style={CARD_SECAO}>
        <h2 style={{ margin: "0 0 4px", fontWeight: 900, fontSize: "1rem", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
          <PieChart size={18} color="#475569" /> De onde vêm os pedidos
        </h2>
        <p style={{ margin: "0 0 1rem", fontSize: "0.78rem", color: "#64748B" }}>
          Quantidade e porcentagem por plataforma, e quanto cada uma faturou.
        </p>

        {sourceStats.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.82rem", color: "#94A3B8" }}>Sem pedidos no período.</p>
        ) : (
          <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>
            {/* Rosca: cada fatia é a porcentagem de PEDIDOS da plataforma */}
            <svg width={160} height={160} viewBox="0 0 160 160" style={{ flexShrink: 0 }}>
              <g transform="rotate(-90 80 80)">
                <circle cx={80} cy={80} r={56} fill="none" stroke="#F1F5F9" strokeWidth={22} />
                {(() => {
                  const CIRC = 2 * Math.PI * 56;
                  let acumulado = 0;
                  return sourceStats.map((f) => {
                    const traco = (f.pctQtd / 100) * CIRC;
                    const fatia = (
                      <circle
                        key={f.key} cx={80} cy={80} r={56} fill="none"
                        stroke={f.color} strokeWidth={22}
                        strokeDasharray={`${traco} ${CIRC - traco}`}
                        strokeDashoffset={-acumulado}
                      />
                    );
                    acumulado += traco;
                    return fatia;
                  });
                })()}
              </g>
              <text x={80} y={76} textAnchor="middle" style={{ fontSize: 24, fontWeight: 900, fill: "#0F172A" }}>{movimento.totalValidos}</text>
              <text x={80} y={94} textAnchor="middle" style={{ fontSize: 10, fontWeight: 800, fill: "#94A3B8", letterSpacing: 1 }}>PEDIDOS</text>
            </svg>

            <div style={{ flex: 1, minWidth: 260, display: "flex", flexDirection: "column", gap: 10 }}>
              {sourceStats.map((f) => (
                <div key={f.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "0.8rem", marginBottom: 4, gap: 8 }}>
                    <span style={{ fontWeight: 700, color: "#0F172A", display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: f.color, display: "inline-block", flexShrink: 0 }} />
                      {f.label}
                    </span>
                    <span style={{ color: "#64748B", whiteSpace: "nowrap" }}>
                      <strong style={{ color: "#0F172A" }}>{f.count} ped.</strong> · <strong style={{ color: f.color }}>{fmtPct(f.pctQtd)}</strong> · {fmtR(f.total)}
                    </span>
                  </div>
                  <div style={{ background: "#F1F5F9", height: 7, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ background: f.color, height: "100%", width: `${f.pctQtd}%`, borderRadius: 4 }} />
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>Ticket médio: {fmtR(f.ticket)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── MOVIMENTO DA LOJA: PICO, DIAS, ENTREGA x RETIRADA, CANCELAMENTO ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1.5rem", marginBottom: "1.5rem" }}>

        {/* Horário de pico */}
        <div style={CARD_SECAO_INTERNO}>
          <h3 style={{ margin: "0 0 4px", fontWeight: 900, fontSize: "0.92rem", color: "#0F172A", display: "flex", alignItems: "center", gap: 7 }}>
            <Clock size={16} color="#B45309" /> Horários de pico
          </h3>
          <p style={{ margin: "0 0 1rem", fontSize: "0.76rem", color: "#64748B" }}>
            Pedidos por hora do dia. Pico às <strong>{String(movimento.picoHora.hora).padStart(2, "0")}h</strong> com {movimento.picoHora.count} pedidos.
          </p>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 120 }}>
            {movimento.porHora.map((h) => (
              <div key={h.hora} title={`${String(h.hora).padStart(2, "0")}h — ${h.count} pedidos`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                <div style={{
                  height: `${(h.count / movimento.maxHora) * 100}%`,
                  minHeight: h.count > 0 ? 3 : 0,
                  background: h.hora === movimento.picoHora.hora ? "#B45309" : "#CBD5E1",
                  borderRadius: "3px 3px 0 0",
                }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: "0.65rem", color: "#94A3B8", fontWeight: 700 }}>
            <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
          </div>
        </div>

        {/* Dias da semana */}
        <div style={CARD_SECAO_INTERNO}>
          <h3 style={{ margin: "0 0 4px", fontWeight: 900, fontSize: "0.92rem", color: "#0F172A", display: "flex", alignItems: "center", gap: 7 }}>
            <Calendar size={16} color="#1C1917" /> Dias da semana
          </h3>
          <p style={{ margin: "0 0 1rem", fontSize: "0.76rem", color: "#64748B" }}>
            Dia mais forte: <strong>{DIAS_SEMANA[movimento.picoDia.dia]}</strong> com {movimento.picoDia.count} pedidos.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {movimento.porDia.map((d) => (
              <div key={d.dia} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 34, fontSize: "0.74rem", fontWeight: 800, color: "#475569", flexShrink: 0 }}>{DIAS_SEMANA[d.dia]}</span>
                <div style={{ flex: 1, background: "#F1F5F9", height: 16, borderRadius: 5, overflow: "hidden" }}>
                  <div style={{ width: `${(d.count / movimento.maxDia) * 100}%`, height: "100%", background: d.dia === movimento.picoDia.dia ? "#1C1917" : "#E7DDD3", borderRadius: 5 }} />
                </div>
                <span style={{ width: 74, textAlign: "right", fontSize: "0.72rem", color: "#64748B", flexShrink: 0 }}>
                  <strong style={{ color: "#0F172A" }}>{d.count}</strong> · {fmtR(d.total)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Entrega x Retirada + ticket + cancelamento */}
        <div style={CARD_SECAO_INTERNO}>
          <h3 style={{ margin: "0 0 1rem", fontWeight: 900, fontSize: "0.92rem", color: "#0F172A", display: "flex", alignItems: "center", gap: 7 }}>
            <StoreIcon size={16} color="#0F172A" /> Resumo da operação
          </h3>

          <div style={{ display: "flex", gap: 10, marginBottom: "1rem" }}>
            <div style={{ flex: 1, background: "#FAF6F2", borderRadius: 12, padding: "0.8rem" }}>
              <p style={{ margin: 0, fontSize: "0.72rem", fontWeight: 800, color: "#1C1917" }}>🛵 Entrega</p>
              <p style={{ margin: "4px 0 0", fontSize: "1.35rem", fontWeight: 900, color: "#0F172A" }}>{movimento.entrega}</p>
              <p style={{ margin: 0, fontSize: "0.7rem", color: "#64748B" }}>
                {fmtPct(movimento.totalValidos ? (movimento.entrega / movimento.totalValidos) * 100 : 0)} dos pedidos
              </p>
            </div>
            <div style={{ flex: 1, background: "#FFF4EF", borderRadius: 12, padding: "0.8rem" }}>
              <p style={{ margin: 0, fontSize: "0.72rem", fontWeight: 800, color: "#9A3412" }}>🏃 Retirada</p>
              <p style={{ margin: "4px 0 0", fontSize: "1.35rem", fontWeight: 900, color: "#0F172A" }}>{movimento.retirada}</p>
              <p style={{ margin: 0, fontSize: "0.7rem", color: "#64748B" }}>
                {fmtPct(movimento.totalValidos ? (movimento.retirada / movimento.totalValidos) * 100 : 0)} dos pedidos
              </p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: "0.8rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #F1F5F9" }}>
              <span style={{ color: "#64748B", fontWeight: 600 }}>Ticket médio do período</span>
              <strong style={{ color: "#0F172A" }}>{fmtR(movimento.ticketMedio)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #F1F5F9" }}>
              <span style={{ color: "#64748B", fontWeight: 600 }}>Faturamento com taxas</span>
              <strong style={{ color: "#0F172A" }}>{fmtR(movimento.receitaTotal)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0" }}>
              <span style={{ color: "#64748B", fontWeight: 600 }}>Pedidos cancelados</span>
              <strong style={{ color: movimento.taxaCancelamento > 5 ? "#C92E09" : "#0F172A" }}>
                {movimento.cancelados} ({fmtPct(movimento.taxaCancelamento)})
              </strong>
            </div>
          </div>
        </div>

      </div>

      {/* ── GRID: CAMPEÃO + GRÁFICOS CANAL / PAGAMENTO ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "1.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        
        {/* Produto Campeão Destaque */}
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 18, padding: "1.25rem", boxShadow: "0 2px 10px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: 300 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #F1F5F9", paddingBottom: "0.75rem", marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Award size={18} color="#FF6B35" />
              <h2 style={{ margin: 0, fontWeight: 900, fontSize: "1rem", color: "#0F172A" }}>🥇 Produto Campeão de Vendas</h2>
            </div>
            <span style={{ fontSize: "0.68rem", fontWeight: 800, background: "#FFF5F3", border: "1px solid #FFCDC4", color: "#E8360C", padding: "4px 10px", borderRadius: 20 }}>
              TOP SELLER
            </span>
          </div>

          {championProduct ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: "1.5rem", alignItems: "center", flex: 1 }}>
              
              {/* Lado Esquerdo: Identificação */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ background: "linear-gradient(135deg, #FFF5F3, #FFEBE7)", width: 70, height: 70, borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2.2rem" }}>
                  🍔
                </div>
                <div>
                  <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#E8360C", background: "#FFF5F3", padding: "2px 8px", borderRadius: 6, textTransform: "uppercase" }}>
                    {championProduct.category}
                  </span>
                  <h3 style={{ margin: "6px 0 2px", fontWeight: 900, fontSize: "1.2rem", color: "#0F172A", lineHeight: 1.2 }}>
                    {championProduct.name}
                  </h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B" }}>
                    Preço base: <strong>{fmtR(championProduct.price)}</strong>
                  </p>
                </div>
              </div>

              {/* Lado Direito: Métricas Consolidadas */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "#F8FAFC", borderRadius: 14, padding: "12px 16px", border: "1px solid #F1F5F9" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                  <span style={{ color: "#64748B" }}>Unidades Vendidas:</span>
                  <strong style={{ color: "#0F172A" }}>{championProduct.qty} u.</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                  <span style={{ color: "#64748B" }}>Faturamento Gerado:</span>
                  <strong style={{ color: "#0F766E" }}>{fmtR(championProduct.revenue)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                  <span style={{ color: "#64748B" }}>Custo Total (CMV):</span>
                  <strong style={{ color: "#C92E09" }}>{fmtR(championProduct.cost)}</strong>
                </div>
                <div style={{ height: "1px", background: "#E2E8F0", margin: "4px 0" }} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", fontWeight: 800 }}>
                  <span style={{ color: "#475569" }}>Lucro Líquido:</span>
                  <span style={{ color: "#FF6B35" }}>{fmtR(championProduct.profit)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#94A3B8" }}>
                  <span>Margem no item:</span>
                  <span>{championProduct.revenue > 0 ? fmtPct((championProduct.profit / championProduct.revenue) * 100) : "0.0%"}</span>
                </div>
              </div>

            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, color: "#94A3B8" }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>📊</div>
              <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600 }}>Nenhum produto vendido no período</p>
            </div>
          )}

          <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: "0.75rem", marginTop: "1rem" }}>
            <span style={{ fontSize: "0.7rem", color: "#94A3B8", display: "flex", alignItems: "center", gap: 5 }}>
              <Activity size={12} /> Atualizado de acordo com o fluxo de pedidos sincronizado.
            </span>
          </div>
        </div>

        {/* Canais e Formas de Pagamento */}
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 18, padding: "1.25rem", boxShadow: "0 2px 10px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", gap: "1.25rem", minHeight: 300 }}>
          
          {/* Formas de Pagamento */}
          <div>
            <h3 style={{ margin: "0 0 10px", fontWeight: 900, fontSize: "0.88rem", color: "#0F172A", display: "flex", alignItems: "center", gap: 6 }}>
              <PieChart size={15} /> Meios de Pagamento (Breakdown)
            </h3>
            {paymentStats.length === 0 ? (
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#94A3B8" }}>Sem dados no período.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {paymentStats.map((item) => (
                  <div key={item.key}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: 3 }}>
                      <span style={{ fontWeight: 600 }}>{item.key}</span>
                      <strong>{fmtR(item.total)} <span style={{ fontWeight: 400, color: "#94A3B8", marginLeft: 4 }}>({item.count} ped. · {fmtPct(item.pct)})</span></strong>
                    </div>
                    <div style={{ background: "#F1F5F9", height: 6, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ background: item.color, height: "100%", width: `${item.pct}%`, borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

      </div>

      {/* ── CARD: RANKING COMPLETO DE PRODUTOS ── */}
      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 18, overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" }}>
        
        {/* Tabela Header com Barra de Pesquisa */}
        <div style={{ padding: "1.25rem", borderBottom: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", background: "#F8FAFC" }}>
          <div>
            <h2 style={{ margin: 0, fontWeight: 900, fontSize: "1rem", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
              <BarChart2 size={18} color="#E8360C" /> Ranking Geral de Produtos ({productRanking.length})
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748B" }}>
              Ordenado por quantidade vendida (do campeão ao mais fraco)
            </p>
          </div>

          <div style={{ position: "relative", minWidth: 260 }}>
            <Search size={14} color="#94A3B8" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input
              type="text"
              placeholder="Buscar no ranking..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px 8px 30px",
                borderRadius: 10,
                border: "1.5px solid #E2E8F0",
                fontSize: "0.82rem",
                outline: "none",
                fontFamily: "inherit",
                boxSizing: "border-box"
              }}
            />
          </div>
        </div>

        {/* Tabela do Ranking */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ borderBottom: "1.5px solid #E2E8F0", background: "#fff", color: "#475569" }}>
                <th style={{ padding: "12px 1.25rem", fontWeight: 700, width: 60 }}>Rank</th>
                <th style={{ padding: "12px 1rem", fontWeight: 700 }}>Produto</th>
                <th style={{ padding: "12px 1rem", fontWeight: 700 }}>Categoria</th>
                <th style={{ padding: "12px 1rem", fontWeight: 700, textAlign: "right" }}>Preço Base</th>
                <th style={{ padding: "12px 1rem", fontWeight: 700, textAlign: "right" }}>Qtd. Vendida</th>
                <th style={{ padding: "12px 1rem", fontWeight: 700, textAlign: "right" }}>Receita total</th>
                <th style={{ padding: "12px 1rem", fontWeight: 700, textAlign: "right" }}>CMV Total</th>
                <th style={{ padding: "12px 1.25rem", fontWeight: 700, textAlign: "right" }}>Lucro estimado</th>
              </tr>
            </thead>
            <tbody>
              {productRanking.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "3rem", textAlign: "center", color: "#94A3B8" }}>
                    Nenhum produto encontrado.
                  </td>
                </tr>
              ) : (
                productRanking.map((p, index) => {
                  const isTop = index === 0 && p.qty > 0;
                  const isZero = p.qty === 0;
                  return (
                    <tr
                      key={p.id}
                      style={{
                        borderBottom: "1px solid #F1F5F9",
                        background: isTop ? "#FFF7F5" : isZero ? "#FAFAFA" : "#fff",
                        transition: "background 0.15s"
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = isTop ? "#FFEFEA" : isZero ? "#F5F5F5" : "#F8FAFC";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = isTop ? "#FFF7F5" : isZero ? "#FAFAFA" : "#fff";
                      }}
                    >
                      <td style={{ padding: "12px 1.25rem", fontWeight: 800, color: isTop ? "#E8360C" : "#64748B" }}>
                        {isTop ? "🥇 1" : `${index + 1}`}
                      </td>
                      <td style={{ padding: "12px 1rem", fontWeight: 700, color: "#0F172A" }}>
                        {p.name}
                      </td>
                      <td style={{ padding: "12px 1rem" }}>
                        <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#475569", background: "#F1F5F9", padding: "2px 8px", borderRadius: 6 }}>
                          {p.category}
                        </span>
                      </td>
                      <td style={{ padding: "12px 1rem", textAlign: "right", color: "#475569" }}>
                        {fmtR(p.price)}
                      </td>
                      <td style={{ padding: "12px 1rem", textAlign: "right", fontWeight: 800, color: isZero ? "#94A3B8" : "#0F172A" }}>
                        {p.qty} u.
                      </td>
                      <td style={{ padding: "12px 1rem", textAlign: "right", fontWeight: 700, color: isZero ? "#94A3B8" : "#0F766E" }}>
                        {fmtR(p.revenue)}
                      </td>
                      <td style={{ padding: "12px 1rem", textAlign: "right", color: isZero ? "#94A3B8" : "#C92E09" }}>
                        {fmtR(p.cost)}
                      </td>
                      <td style={{ padding: "12px 1.25rem", textAlign: "right", fontWeight: 800, color: isZero ? "#94A3B8" : "#FF6B35" }}>
                        {fmtR(p.profit)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* ── O TOTAL, NO FIM DA LISTA ────────────────────────────────
                Gruda no rodapé da tabela porque é onde o olho chega depois de
                ler a última linha — e porque a soma é DESTA lista, com os
                filtros que estão valendo. Some quando não há o que somar. */}
            {productRanking.length > 0 && (
              <tfoot>
                <tr style={{ background: "#FFF4EF", borderTop: "2px solid #FFD3C2" }}>
                  <td colSpan={3} style={{ padding: "14px 1.25rem", fontWeight: 900, color: "#9A3412", fontSize: "0.86rem" }}>
                    TOTAL
                    <span style={{ display: "block", fontWeight: 600, fontSize: "0.72rem", color: "#9A3412", marginTop: 2 }}>
                      {totalDoRanking.listados} {totalDoRanking.listados === 1 ? "produto listado" : "produtos listados"}
                      {totalDoRanking.comVenda !== totalDoRanking.listados && ` · ${totalDoRanking.comVenda} com venda no período`}
                    </span>
                  </td>
                  <td style={{ padding: "14px 1rem", textAlign: "right", color: "#9A3412", fontSize: "0.78rem", fontWeight: 700 }}>
                    —
                  </td>
                  <td style={{ padding: "14px 1rem", textAlign: "right", fontWeight: 900, color: "#9A3412", fontSize: "0.95rem" }}>
                    {totalDoRanking.qty} u.
                  </td>
                  <td style={{ padding: "14px 1rem", textAlign: "right", fontWeight: 900, color: "#0F766E" }}>
                    {fmtR(totalDoRanking.revenue)}
                  </td>
                  <td style={{ padding: "14px 1rem", textAlign: "right", fontWeight: 800, color: "#C92E09" }}>
                    {fmtR(totalDoRanking.cost)}
                  </td>
                  <td style={{ padding: "14px 1.25rem", textAlign: "right", fontWeight: 900, color: "#E8590C" }}>
                    {fmtR(totalDoRanking.profit)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

      </div>

    </div>
  );
}
