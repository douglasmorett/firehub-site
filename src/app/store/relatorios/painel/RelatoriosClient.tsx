"use client";
import React, { useState, useMemo, useCallback, useEffect } from "react";
import Link from "next/link";
import { minutosEntre } from "@/lib/order-stages";
import FiltroMultiplo from "@/components/customer/FiltroMultiplo";
import { chaveDaLoja, lojasDosPedidos, type PedidoDoRelatorio } from "@/lib/origem-do-relatorio";
import {
  itemEntra, itensVendidosPorCategoria, opcoesQueEntram, perguntouPorItem, somarVendas, type FiltroDeItens,
} from "@/lib/soma-do-relatorio";
import {
  atendimentosDaVenda, cent, entraNaVenda, reais, ticketMedio as ticketDaRegua, type PedidoDaRegua,
} from "@/lib/relatorios/regua-da-venda";
import type { LojaDeOrigem } from "@/lib/loja-de-origem";
import { ATALHOS, ehCancelado, fmtDia, naLoja, periodoDoAtalho, somarDias, hojeNaLoja, type AtalhoDePeriodo } from "@/lib/relatorios/base";
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

// ── O PERÍODO É O DOS RELATÓRIOS ────────────────────────────────────────────
//
// Até 11/10/2026 o painel tinha atalhos próprios: a meia-noite do NAVEGADOR e
// "Últimos 7 dias" de hoje−7 até agora — oito dias. Na abertura (o padrão é 7
// dias) o painel mostrava de 20% a 48% a mais que o Vendas por período: Ragnar
// R$ 68.741,88 × R$ 54.867,76; Divinos R$ 6.148,86 × R$ 4.136,68. E "Hoje" às
// 8h de domingo mostrava a madrugada da noite de sábado.
//
// Agora são os atalhos e o dia operacional dos relatórios (lib/relatorios/
// base.ts): o dia vira às 5h, no fuso da loja, e "7 dias" são hoje e os seis
// anteriores. "Tudo (365 dias)" é o que a página carrega.
export type AtalhoDoPainel = AtalhoDePeriodo | "365d";
const ATALHOS_DO_PAINEL: { chave: AtalhoDoPainel; rotulo: string }[] = [
  ...ATALHOS,
  { chave: "365d", rotulo: "Tudo (365 dias)" },
];

/** O período ("YYYY-MM-DD", dias operacionais) do atalho ou das datas escolhidas. */
export function periodoDoPainel(atalho: AtalhoDoPainel, hoje: string, escolhido?: { de?: string; ate?: string } | null): { de: string; ate: string } {
  const de = escolhido?.de || "", ate = escolhido?.ate || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(de) && /^\d{4}-\d{2}-\d{2}$/.test(ate)) return de <= ate ? { de, ate } : { de: ate, ate: de };
  if (atalho === "365d") return { de: somarDias(hoje, -364), ate: hoje };
  return periodoDoAtalho(atalho, hoje);
}

// Formatação
const fmtR = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v: number) => `${(Number.isFinite(v) ? v : 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

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

/** Saiu para a rua. Mesa e balcão não contam como entrega. */
function ehEntrega(o: any) {
  return String(o.deliveryType || "").toUpperCase() === "DELIVERY";
}

// Os tempos e "como os pedidos saíram" vêm prontos da rota do relatório Tempo
// por status (lib/relatorios/tempos.ts), pelo período e filtros desta tela. Até
// 11/10/2026 o painel fazia uma conta própria com o carimbo cru: misturava mesa
// e balcão com entrega, contava o aceite regravado na saída e o "entregue"
// marcado em lote — a NIK via 42,4 min de tempo total aqui e 60,0 min de entrega
// no relatório; a Delícias da Maria, 0,6 min.
const COR_DA_ETAPA: Record<string, string> = {
  aceite: "#1C1917", cozinha: "#B45309", esperandoSaida: "#64748B", rua: "#0F766E",
  totalEntrega: "#0F172A", totalNaLoja: "#44403C",
};

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

// ── VENDAS E TICKET PELA RÉGUA ÚNICA ────────────────────────────────────────
//
// Puras e exportadas para scripts/teste-painel-de-vendas.ts conferir a MESMA
// conta que a tela faz. A régua é lib/relatorios/regua-da-venda.ts: valor
// vendido = Σ totalAmount dos pedidos de venda; vendas = pedido sem mesa + 1
// por mesa (a de três rodadas é uma venda); ticket = valor ÷ vendas, ao centavo.

type ItemDoPainel = Parameters<typeof itemEntra>[0] & Parameters<typeof opcoesQueEntram>[0];
export type PedidoDoPainel = Omit<PedidoDaRegua, "items"> & { items: ItemDoPainel[] };

/** Valor vendido, vendas, lançamentos e ticket do recorte — os do Vendas por período. */
export function vendaDaRegua(pedidos: PedidoDaRegua[]) {
  const at = atendimentosDaVenda(pedidos);
  // Em centavos, como a régua soma: é o que dá o mesmo centavo do Vendas.
  let c = 0;
  for (const p of pedidos) if (entraNaVenda(p)) c += cent(p.totalAmount);
  const valor = reais(c);
  return { valor, vendas: at.vendas, lancamentos: at.lancamentos, ticket: ticketDaRegua(valor, at.vendas) };
}

/**
 * O cartão "Vendas no filtro".
 *
 * SEM filtro de item (produto/categoria), o ticket é o da régua — valor
 * vendido ÷ vendas —, o mesmo do "Ticket médio do período" logo abaixo e do
 * Vendas por período. Até 24/09/2026 o cartão dividia a soma dos ITENS pelas
 * vendas: outro número, na mesma tela, com o mesmo nome. NIK, 09–16/09/2026:
 * R$ 62,99 no cartão (15.243,80 de itens ÷ 242) × R$ 55,00 no Movimento e no
 * Vendas por período (13.309,45 ÷ 242); Pastel da Paulista: 67,99 × 70,16. Os
 * itens não são o que a venda cobrou: falta a taxa de entrega e sobra o
 * desconto (na NIK, R$ 3.458,64 de desconto na semana).
 *
 * COM filtro de item, "o ticket da venda inteira" não responde a pergunta —
 * quem marcou "Bebidas" quer saber quanto de bebida cada venda levou. Aí o
 * ticket é o dos ITENS do filtro ÷ as vendas que tiveram algum deles, e a tela
 * o chama de "ticket dos itens" (`dosItens`), para não passar pelo outro.
 * `receitaDosItens` é a do `somarVendas` que a tela já fez.
 */
export function cartaoDeVendas(pedidos: PedidoDoPainel[], filtro: FiltroDeItens, receitaDosItens: number) {
  if (!perguntouPorItem(filtro)) {
    const r = vendaDaRegua(pedidos);
    return { valor: r.valor, vendas: r.vendas, lancamentos: r.lancamentos, ticket: r.ticket, dosItens: false };
  }
  // Os pedidos com algum item (ou opção) no filtro — a regra de somarVendas,
  // repetida aqui só para saber QUAIS são, porque a mesa se agrupa pelo pedido.
  const comAlgoNoFiltro = pedidos.filter((o) => o.items.some((i) => {
    const entrou = itemEntra(i, filtro);
    return entrou || opcoesQueEntram(i, filtro, entrou).length > 0;
  }));
  const at = atendimentosDaVenda(comAlgoNoFiltro);
  return { valor: receitaDosItens, vendas: at.vendas, lancamentos: at.lancamentos, ticket: ticketDaRegua(receitaDosItens, at.vendas), dosItens: true };
}

// ── O CUSTO CADASTRADO COBRE O QUE FOI VENDIDO? ─────────────────────────────
//
// "Margem 100%" e "Lucro Líquido" igual ao faturamento: em 11/10/2026 nenhuma
// das lojas conferidas (Ragnar, NIK, Delícia de Casa, Frangoso, Divinos) tinha
// custo cadastrado — só 15 lojas do sistema têm algum. Produto sem custo
// contava como se fosse de graça, e o cartão afirmava um lucro que ninguém tem.
//
// Agora a margem só aparece quando o custo cadastrado cobre a maior parte do
// que foi vendido (COBERTURA_MINIMA), e é calculada só sobre o que tem custo.
// E é BRUTA: o custo do produto, sem comissão de app, entrega e taxas.
export const COBERTURA_MINIMA = 0.8;

export function coberturaDoCusto(pedidos: { id: string; items: ItemDoPainel[] }[], f: FiltroDeItens) {
  let receita = 0, receitaComCusto = 0, custo = 0;
  for (const o of pedidos) {
    for (const item of o.items) {
      const entrou = itemEntra(item, f);
      if (entrou) {
        const r = item.price * item.quantity;
        receita += r;
        if ((item.productCost || 0) > 0) { receitaComCusto += r; custo += item.productCost * item.quantity; }
      }
      for (const { opcao, valor } of opcoesQueEntram(item, f, entrou)) {
        receita += valor;
        if ((opcao.custo || 0) > 0) { receitaComCusto += valor; custo += (opcao.custo || 0) * opcao.quantidade; }
      }
    }
  }
  const cobertura = receita > 0 ? receitaComCusto / receita : 0;
  return {
    receita,
    receitaComCusto,
    custo,
    cobertura,
    lucroBruto: receitaComCusto - custo,
    margem: receitaComCusto > 0 ? ((receitaComCusto - custo) / receitaComCusto) * 100 : null,
    suficiente: receita > 0 && cobertura >= COBERTURA_MINIMA,
  };
}

// ── O RESUMO DA OPERAÇÃO POR TIPO ───────────────────────────────────────────
//
// Até 11/10/2026 o cartão tinha só "Entrega" e "Retirada", e o que não era
// retirada caía em Entrega: a MESA, o PICKUP do site e o TAKEOUT do totem.
// Ragnar Burger, 01–11/10/2026: "Entrega 2063 — 99,4% dos pedidos" num
// restaurante de salão cheio; o certo era 1.288 entregas, 393 mesas (773
// rodadas) e 14 retiradas. O lojista leu, com razão, que o relatório "não
// reflete a realidade".
//
// Agora são três tipos e a conta é de VENDAS, a régua da tela (a mesa conta
// uma vez, pelo pedido que a abre — `atendimentosDaVenda().abre`). Os três
// somam exatamente as vendas do "Ticket médio do período" logo abaixo. O valor
// de cada tipo é a soma dos pedidos dele que entram na venda (cada rodada da
// mesa soma no valor da mesa).

export type TipoDaOperacao = "ENTREGA" | "MESA" | "RETIRADA";

/** Entrega = saiu para a rua. Mesa = salão. O resto (retirada, PICKUP, TAKEOUT, balcão) o cliente levou. */
export function tipoDaOperacao(o: { deliveryType?: string | null; tableSessionId?: string | null }): TipoDaOperacao {
  const t = String(o.deliveryType || "").trim().toUpperCase();
  if (o.tableSessionId || t === "MESA" || t === "SALAO" || t === "DINE_IN") return "MESA";
  if (t === "DELIVERY") return "ENTREGA";
  return "RETIRADA";
}

type PedidoComTipo = PedidoDaRegua & { deliveryType?: string | null };

export function resumoDaOperacao(pedidos: PedidoComTipo[]) {
  const { abre, vendas } = atendimentosDaVenda(pedidos);
  const base = () => ({ vendas: 0, lancamentos: 0, valorCent: 0 });
  const por: Record<TipoDaOperacao, ReturnType<typeof base>> = { ENTREGA: base(), MESA: base(), RETIRADA: base() };
  for (const p of pedidos) {
    if (!entraNaVenda(p)) continue;
    const t = tipoDaOperacao(p);
    por[t].lancamentos++;
    por[t].valorCent += cent(p.totalAmount);
    if (abre.has(p.id)) por[t].vendas++;
  }
  const tipo = (t: TipoDaOperacao) => ({
    vendas: por[t].vendas,
    lancamentos: por[t].lancamentos,
    valor: reais(por[t].valorCent),
    pct: vendas > 0 ? (por[t].vendas / vendas) * 100 : 0,
  });
  return { vendas, entrega: tipo("ENTREGA"), mesa: tipo("MESA"), retirada: tipo("RETIRADA") };
}

// ── DIAS DA SEMANA: MÉDIA POR DIA, NÃO SOMA ─────────────────────────────────
//
// Somar os pedidos de cada dia da semana mente quando o período não tem o
// mesmo número de cada dia. "Este mês" de 01 a 11/10/2026 tem 2 quintas, 2
// sextas e 2 sábados, mas 1 segunda, 1 terça e 1 quarta: o sábado aparecia
// quatro vezes mais forte que a quarta (609 × 143) quando a média dele por dia
// era o dobro. E contava cada rodada de mesa como um pedido.
//
// Agora cada dia da semana mostra a MÉDIA por dia (valor ÷ quantos daquele dia
// o período teve) e as vendas da régua. Os dias contados começam no primeiro
// pedido que a loja tem no relatório: "Tudo (365 dias)" numa loja de um mês
// não divide por 52 sábados que ela não existia. O dia é o do navegador, como
// sempre foi nesta tela.

/** Quantos domingos, segundas… há de `de` a `ate` ("YYYY-MM-DD", dias operacionais, os dois inclusos). */
export function diasNoPeriodo(de: string, ate: string): number[] {
  const conta = [0, 0, 0, 0, 0, 0, 0];
  let d = de;
  for (let guarda = 0; d <= ate && guarda < 4000; guarda++) {
    conta[new Date(`${d}T12:00:00Z`).getUTCDay()]++;
    d = somarDias(d, 1);
  }
  return conta;
}

/**
 * As vendas por dia da semana entre os dias operacionais `de` e `ate`, no fuso
 * da loja. Pedido fora desses dias não entra (quem chama tira o "hoje" que
 * ainda não acabou: um domingo que mal começou puxava a média do domingo).
 */
export function vendasPorDiaDaSemana(pedidos: PedidoDaRegua[], de: string, ate: string, fuso: string | null | undefined) {
  const dentro = pedidos.filter((p) => {
    const dia = naLoja(p.createdAt, fuso).dia;
    return dia >= de && dia <= ate;
  });
  const { abre } = atendimentosDaVenda(dentro);
  const ocorrencias = diasNoPeriodo(de, ate);
  const linhas = Array.from({ length: 7 }, (_, dia) => ({ dia, dias: ocorrencias[dia], vendas: 0, valorCent: 0 }));
  for (const p of dentro) {
    if (!entraNaVenda(p)) continue;
    const dia = naLoja(p.createdAt, fuso).diaSemana;
    linhas[dia].valorCent += cent(p.totalAmount);
    if (abre.has(p.id)) linhas[dia].vendas++;
  }
  const dias = linhas.map((l) => ({
    dia: l.dia,
    dias: l.dias,
    vendas: l.vendas,
    valor: reais(l.valorCent),
    mediaValor: l.dias > 0 ? reais(Math.round(l.valorCent / l.dias)) : 0,
    mediaVendas: l.dias > 0 ? l.vendas / l.dias : 0,
  }));
  const comDia = dias.filter((d) => d.dias > 0);
  const pico = comDia.length ? comDia.reduce((a, b) => (b.mediaValor > a.mediaValor ? b : a)) : null;
  const maxMedia = Math.max(0.01, ...dias.map((d) => d.mediaValor));
  return { dias, pico: pico && pico.mediaValor > 0 ? pico : null, maxMedia };
}

/**
 * Os dias operacionais que a média usa: do maior entre o início do período e o
 * primeiro dia com pedido da loja, até o fim do período — sem o dia de hoje,
 * que ainda não acabou (a não ser que o período seja só hoje).
 */
export function diasDaMedia(de: string, ate: string, primeiroDia: string | null, hoje: string) {
  let ini = primeiroDia && primeiroDia > de ? primeiroDia : de;
  let fim = ate > hoje ? hoje : ate;
  let semHoje = false;
  if (fim === hoje && ini < hoje) { fim = somarDias(hoje, -1); semHoje = true; }
  if (fim < ini) ini = fim;
  return { de: ini, ate: fim, semHoje };
}

export default function RelatoriosClient({
  orders,
  products,
  categorias,
  storeName,
  timeAlertConfig,
  lojasDeOrigem,
  fusoDaLoja,
}: {
  orders: any[];
  products: any[];
  /** As categorias do cardápio de verdade — sem "iFood"/"99Food" (page.tsx). */
  categorias: string[];
  storeName: string;
  /** Vazia quando a conta não tem o que separar (lib/lojas-de-origem-da-conta.ts). */
  lojasDeOrigem?: LojaDeOrigem[];
  /** Fuso da loja vista: os dias da semana contam pelo dia operacional dela. */
  fusoDaLoja?: string | null;
  timeAlertConfig?: { yellowEnabled?: boolean; yellowMinutes?: number; redEnabled?: boolean; redMinutes?: number } | null;
}) {
  const [atalho, setAtalho] = useState<AtalhoDoPainel>("7d");
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

  // "Hoje" no dia operacional da loja, e o dia operacional de cada pedido — uma
  // vez só (a página traz 365 dias de pedidos).
  const hoje = useMemo(() => hojeNaLoja(fusoDaLoja), [fusoDaLoja]);
  const diaDoPedido = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) m.set(o.id, naLoja(o.createdAt, fusoDaLoja).dia);
    return m;
  }, [orders, fusoDaLoja]);
  const primeiroDia = useMemo(() => {
    let menor: string | null = null;
    for (const d of diaDoPedido.values()) if (!menor || d < menor) menor = d;
    return menor;
  }, [diaDoPedido]);

  // O período selecionado (dias operacionais)
  const { de, ate } = useMemo(
    () => periodoDoPainel(atalho, hoje, useCustom ? { de: customFrom, ate: customTo } : null),
    [atalho, hoje, useCustom, customFrom, customTo],
  );
  const noDia = useCallback((o: any) => {
    const d = diaDoPedido.get(o.id) || "";
    return d >= de && d <= ate;
  }, [diaDoPedido, de, ate]);

  // 1. Filtrar pedidos por data (o cancelado fica para a taxa de cancelamento)
  const noPeriodo = useMemo(() => orders.filter((o) => noDia(o) && !ehCancelado(o.status)), [orders, noDia]);

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

    // VENDAS, não lançamentos: a régua única (lib/relatorios/regua-da-venda.ts,
    // atendimentosDaVenda) — a mesa de três rodadas são três pedidos e UMA
    // venda. Contados como pedidos, o ticket da mesa de R$ 150 virava três de
    // R$ 50, e o painel dava outro ticket que o Vendas por período. O ticket
    // sem filtro de item é o da régua; com filtro, o dos itens (cartaoDeVendas).
    const cartao = cartaoDeVendas(dateFilteredOrders as PedidoDoPainel[], filtroDeItens, soma.receita);
    const custo = coberturaDoCusto(dateFilteredOrders as PedidoDoPainel[], filtroDeItens);

    return {
      /** Sem filtro de item: o valor vendido da régua. Com filtro: os itens marcados. */
      valorDoCartao: cartao.valor,
      custo,
      revenue: soma.receita,
      cmv: soma.cmv,
      profit: totalProfit,
      margin: soma.receita > 0 ? (totalProfit / soma.receita) * 100 : 0,
      unitsSold: soma.unidades,
      // Quantas das unidades vieram como opção dentro de outro produto — é o
      // que o cartão explica embaixo do número, para ninguém procurar a borda
      // entre os itens do pedido.
      unidadesDeOpcao: soma.unidadesDeOpcao,
      ordersCount: cartao.vendas,
      lancamentos: cartao.lancamentos,
      ticketMedio: cartao.ticket,
      /** O ticket é dos ITENS do filtro, não o da venda inteira (a tela diz). */
      ticketDosItens: cartao.dosItens,
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
        /** Quantas unidades vieram escolhidas DENTRO de um item que já está na conta. */
        dentro: number;
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
        dentro: 0,
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
            dentro: 0,
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
        const oItemEntrou = itemEntra(item, filtroDeItens);
        for (const { opcao: op, valor } of opcoesQueEntram(item, filtroDeItens, oItemEntrou)) {
          const chave = op.id || `opcao:${op.categoria}:${op.nome}`;
          if (!counts[chave]) {
            counts[chave] = {
              id: chave, name: op.nome, category: op.categoria,
              qty: 0, revenue: 0, cost: 0, profit: 0, price: op.preco || 0, dentro: 0,
            };
          }
          const linha = counts[chave];
          linha.qty += op.quantidade;
          // O sabor escolhido dentro da pizza que já está na conta: soma a
          // unidade, e o dinheiro fica na pizza. É a linha "Portuguesa ·
          // R$ 0,00" que fez a NIK perguntar (24/09/2026) — a tela tem que
          // dizer onde está o valor.
          if (oItemEntrou) linha.dentro += op.quantidade;
          linha.revenue += valor;
          linha.cost += (op.custo || 0) * op.quantidade;
          linha.profit = linha.revenue - linha.cost;
        }
      });
    });

    // Uma linha por produto DE NOME, dentro da categoria. O "Esfiha Carne" do
    // cardápio, o espelho do iFood e o da Wabiz são ids diferentes do mesmo
    // produto — a NIK via "Esfiha Carne 7 u." no topo e "2 u." lá embaixo e
    // tinha que somar à mão (vídeo de 30/09/2026). A mesma chave do "Por
    // categoria" e do Itens vendidos. O preço mostrado é o da linha que mais
    // vendeu; o filtro de produto vale se QUALQUER id do grupo foi marcado.
    const juntos = new Map<string, (typeof counts)[string] & { ids: string[]; qtdDoPreco: number }>();
    for (const p of Object.values(counts)) {
      const nome = String(p.name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const chave = `${p.category}\u0000${nome || p.id}`;
      const j = juntos.get(chave);
      if (!j) { juntos.set(chave, { ...p, ids: [p.id], qtdDoPreco: p.qty }); continue; }
      j.ids.push(p.id);
      j.qty += p.qty;
      j.revenue += p.revenue;
      j.cost += p.cost;
      j.profit = j.revenue - j.cost;
      j.dentro += p.dentro;
      if (p.qty > j.qtdDoPreco) { j.price = p.price; j.qtdDoPreco = p.qty; }
    }

    return [...juntos.values()]
      .filter((p) => {
        const matchesCategory = categoriasMarcadas.size === 0 || categoriasMarcadas.has(p.category);
        // O FILTRO DE PRODUTO PASSOU A VALER AQUI TAMBÉM.
        //
        // Antes o produto mexia só nos cartões de cima: marcar "Coca Cola 2l"
        // dava o faturamento dela e uma tabela com o cardápio inteiro embaixo
        // — e o "Produto Campeão", que sai desta lista, mostrava outro
        // produto. Com três produtos marcados o desencontro ficaria gritante.
        const matchesProduct = produtosMarcados.size === 0 || p.ids.some((id) => produtosMarcados.has(id));
        const matchesSearch =
          searchQuery.trim() === "" ||
          p.name.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesCategory && matchesProduct && matchesSearch;
      })
      .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
  }, [dateFilteredOrders, products, categoriasMarcadas, produtosMarcados, searchQuery, idsDeEspelho, filtroDeItens]);

  // ── ITENS VENDIDOS POR CATEGORIA (categoria → produto → escolhas) ─────────
  //
  // A segunda visão do cartão do ranking: a do relatório "Itens vendidos" da
  // Saipos, que a NIK usava. O sabor aparece dentro da pizza que o carregou,
  // em vez de numa linha própria de R$ 0,00. A conta está em
  // lib/soma-do-relatorio.ts (itensVendidosPorCategoria).
  const [visaoDoRanking, setVisaoDoRanking] = useState<"ranking" | "categoria">("ranking");
  const [abertos, setAbertos] = useState<Set<string>>(() => new Set());
  const alternar = useCallback((chave: string) => {
    setAbertos((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
      return novo;
    });
  }, []);
  const itensPorCategoria = useMemo(() => {
    const arvore = itensVendidosPorCategoria(dateFilteredOrders as any, filtroDeItens);
    const busca = searchQuery.trim().toLowerCase();
    if (!busca) return arvore;
    // A busca acha o produto pelo nome; a categoria fica com o que casou.
    const categorias = arvore.categorias
      .map((c) => ({ ...c, produtos: c.produtos.filter((p) => p.nome.toLowerCase().includes(busca)) }))
      .filter((c) => c.produtos.length > 0)
      .map((c) => ({
        ...c,
        quantidade: c.produtos.reduce((s, p) => s + p.quantidade, 0),
        valor: c.produtos.reduce((s, p) => s + p.valor, 0),
      }));
    return {
      categorias,
      quantidade: categorias.reduce((s, c) => s + c.quantidade, 0),
      valor: categorias.reduce((s, c) => s + c.valor, 0),
    };
  }, [dateFilteredOrders, filtroDeItens, searchQuery]);

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
  // A entrega feita pelo entregador do app (iFood/99, `deliveryBy`) não custa
  // nada à loja e não tem entregador dela para atribuir: na Ragnar, 1.197 das
  // "1.229 entregas sem entregador atribuído" eram do iFood.
  const entregas = useMemo(() => {
    let quantidade = 0, custo = 0, semCusto = 0, doApp = 0;
    for (const o of dateFilteredOrders) {
      if (!ehEntrega(o)) continue;
      if ((o as any).entregaDoApp) { doApp++; continue; }
      quantidade++;
      const c = (o as any).custoDaEntrega;
      if (typeof c === "number") custo += c; else semCusto++;
    }
    return {
      quantidade,
      doApp,
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
    let qty = 0, revenue = 0, cost = 0, profit = 0, comVenda = 0, semCusto = 0;
    for (const p of productRanking) {
      qty += p.qty;
      revenue += p.revenue;
      cost += p.cost;
      profit += p.profit;
      if (p.qty > 0) comVenda++;
      if (p.revenue > 0 && p.cost <= 0) semCusto++;
    }
    return { qty, revenue, cost, profit, comVenda, semCusto, listados: productRanking.length };
  }, [productRanking]);

  // Produto Campeão (Top 1)
  const championProduct = useMemo(() => {
    if (productRanking.length === 0) return null;
    const top = productRanking[0];
    return top.qty > 0 ? top : null;
  }, [productRanking]);

  // 4. De onde vem os pedidos (plataforma): quantidade, % e faturamento
  const sourceStats = useMemo(() => {
    const stats: Record<string, { count: number; total: number; vendas: number }> = {};
    let totalRevenue = 0;
    // O ticket da plataforma é por VENDA (a régua única): a venda conta onde
    // ela abre — o pedido comum, o primeiro lançamento da mesa.
    const { abre } = atendimentosDaVenda(dateFilteredOrders);

    dateFilteredOrders.forEach((o) => {
      // A mesma chave do filtro de plataforma: a fatia "iFood" da rosca e a
      // opção "iFood" do filtro são os mesmos pedidos.
      const source = o.canal || "DESCONHECIDO";
      if (!stats[source]) stats[source] = { count: 0, total: 0, vendas: 0 };
      stats[source].count++;
      if (abre.has(o.id)) stats[source].vendas++;
      if (!entraNaVenda(o)) return;
      stats[source].total += o.totalAmount;
      totalRevenue += o.totalAmount;
    });

    // A fatia é de VENDAS (a mesa conta uma vez): pelas rodadas, o iFood da
    // Ragnar aparecia com 60,7% "dos pedidos" e era 74,3% das vendas.
    const totalVendas = abre.size;

    return Object.entries(stats).map(([key, value]) => {
      const plat = plataformaDe(key);
      return {
        key,
        label: plat.label,
        color: plat.cor,
        count: value.count,
        vendas: value.vendas,
        total: value.total,
        ticket: value.vendas > 0 ? value.total / value.vendas : 0,
        // pctQtd e a fatia do grafico: o lojista pergunta "quantos por cento
        // dos meus pedidos vem do iFood", nao quanto por cento do dinheiro.
        pctQtd: totalVendas > 0 ? (value.vendas / totalVendas) * 100 : 0,
        pct: totalRevenue > 0 ? (value.total / totalRevenue) * 100 : 0,
      };
    }).sort((a, b) => b.vendas - a.vendas || b.total - a.total);
  }, [dateFilteredOrders]);

  // 5–7. FORMAS DE PAGAMENTO E TEMPOS: os relatórios de verdade, pelo mesmo
  // período e filtros desta tela.
  //
  // O bloco de pagamentos daqui agrupava o texto cru: a mesa (que paga no
  // fechamento da conta, não no pedido) virava "N/A" — 48% do dinheiro da
  // Ragnar —, e "Pix", "PIX", "Pix (Pago Online)" eram três linhas. A rota de
  // Formas de pagamento já lê a forma pela régua do caixa e a mesa pela conta.
  const consulta = useMemo(() => {
    const q = new URLSearchParams({ de, ate });
    if (selectedPlataformas.length) q.set("canais", selectedPlataformas.join(","));
    if (selectedLojas.length) q.set("marcas", selectedLojas.join(","));
    return q;
  }, [de, ate, selectedPlataformas, selectedLojas]);

  const [formas, setFormas] = useState<{ carregando: boolean; erro?: string; dados?: any }>({ carregando: true });
  useEffect(() => {
    const ctrl = new AbortController();
    setFormas({ carregando: true });
    fetch(`/api/store/relatorios/formas-de-pagamento?${consulta}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((dados) => setFormas({ carregando: false, dados }))
      .catch((e) => { if (e?.name !== "AbortError") setFormas({ carregando: false, erro: "Não deu para carregar as formas de pagamento agora." }); });
    return () => ctrl.abort();
  }, [consulta]);

  const [tempos, setTempos] = useState<{ carregando: boolean; erro?: string; dados?: any }>({ carregando: true });
  useEffect(() => {
    const ctrl = new AbortController();
    const q = new URLSearchParams(consulta);
    if (selectedCategories.length) q.set("categorias", selectedCategories.join(","));
    if (selectedProducts.length) q.set("produtos", selectedProducts.join(","));
    setTempos({ carregando: true });
    fetch(`/api/store/relatorios/tempos?${q}`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((dados) => setTempos({ carregando: false, dados }))
      .catch((e) => { if (e?.name !== "AbortError") setTempos({ carregando: false, erro: "Não deu para carregar os tempos agora." }); });
    return () => ctrl.abort();
  }, [consulta, selectedCategories, selectedProducts]);

  const etapasDosTempos = useMemo(() => {
    const etapas: any[] = Array.isArray(tempos.dados?.etapas) ? tempos.dados.etapas : [];
    return etapas.filter((e) => !e.dentroDaCozinha && (e.medidos || 0) > 0);
  }, [tempos.dados]);

  const saidas = useMemo(() => {
    const pz = tempos.dados?.prazo;
    if (!pz) return null;
    const medidos = Number(pz.medidos) || 0;
    const pct = (n: number) => (medidos > 0 ? (n / medidos) * 100 : 0);
    const amareloMin = pz.limites?.amareloMin ?? 10;
    const vermelhoMin = pz.limites?.vermelhoMin ?? 5;
    // A rota mede o prazo do CLIENTE: na entrega, a hora em que chegou (só as
    // com o "entregue" marcado na hora); na retirada e no balcão, o pronto.
    // Medir pela saída dava 93,5% "no prazo" na NIK com 46,5% chegando no
    // prazo (o prazo do iFood é a hora prometida de chegada).
    return {
      medidos,
      limites: { amareloMin, vermelhoMin },
      atrasoMediano: pz.atrasoMediano ?? null,
      semEntrega: Number(pz.semEntrega) || 0,
      saida: pz.saidaDasEntregas || null,
      faixas: [
        { chave: "noPrazo", titulo: "No prazo", n: pz.noPrazo || 0, pct: pct(pz.noPrazo || 0), cor: "#0F766E", fundo: "#F0FDFA", detalhe: `Com mais de ${amareloMin} min de folga` },
        { chave: "amarelo", titulo: "Alerta amarelo", n: pz.amarelo || 0, pct: pct(pz.amarelo || 0), cor: "#B45309", fundo: "#FFF7E6", detalhe: `Com ${vermelhoMin} a ${amareloMin} min de folga` },
        { chave: "vermelho", titulo: "Alerta vermelho", n: pz.vermelho || 0, pct: pct(pz.vermelho || 0), cor: "#C92E09", fundo: "#FEE2E2", detalhe: `Em cima da hora (até ${vermelhoMin} min)` },
        { chave: "estourado", titulo: "Prazo estourado", n: pz.estourados || 0, pct: pct(pz.estourados || 0), cor: "#B71C1C", fundo: "#FECACA", detalhe: "Depois da hora prometida ao cliente" },
      ],
    };
  }, [tempos.dados]);

  // 8. MOVIMENTO: hora do dia, dia da semana, entrega x retirada, cancelamentos
  const movimento = useMemo(() => {
    // Por hora são PEDIDOS (cada rodada de mesa é um): é o ritmo da cozinha.
    // Só os que entram na venda — o cancelado em inglês e o valor impossível
    // ficavam no gráfico e fora do faturamento.
    const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: h, count: 0, total: 0 }));
    dateFilteredOrders.forEach((o) => {
      if (!entraNaVenda(o)) return;
      const h = naLoja(o.createdAt, fusoDaLoja).hora;
      porHora[h].count++;
      porHora[h].total += o.totalAmount;
    });

    // Dias da semana: média por dia operacional (vira às 5h, no fuso da loja),
    // desde o primeiro pedido que a loja tem no relatório e sem o hoje, que
    // ainda não acabou (diasDaMedia).
    const janela = diasDaMedia(de, ate, primeiroDia, hoje);
    const semana = { ...vendasPorDiaDaSemana(dateFilteredOrders as PedidoDaRegua[], janela.de, janela.ate, fusoDaLoja), semHoje: janela.semHoje };
    const operacao = resumoDaOperacao(dateFilteredOrders as PedidoComTipo[]);

    // Cancelados ficam de fora de dateFilteredOrders -- para a taxa, contamos
    // de novo direto do periodo. Os filtros de PLATAFORMA e LOJA valem aqui
    // também: sem eles, marcar o iFood mostraria o faturamento dele com a taxa
    // de cancelamento da conta inteira, lado a lado, como se fossem do mesmo
    // recorte.
    let cancelados = 0, brutoNoPeriodo = 0;
    orders.forEach((o) => {
      if (!noDia(o)) return;
      if (!passaNaOrigem(o)) return;
      brutoNoPeriodo++;
      if (ehCancelado(o.status)) cancelados++;
    });

    const picoHora = porHora.reduce((a, b) => (b.count > a.count ? b : a), porHora[0]);
    // Quantos dias o período tem até hoje (desde o primeiro pedido da loja):
    // o pico é a SOMA do período, e a média diz quanto é num dia.
    const iniDosDias = primeiroDia && primeiroDia > de ? primeiroDia : de;
    const fimDosDias = ate > hoje ? hoje : ate;
    const diasDoPeriodo = fimDosDias >= iniDosDias ? diasNoPeriodo(iniDosDias, fimDosDias).reduce((a, b) => a + b, 0) : 0;
    const maxHora = Math.max(1, ...porHora.map((h) => h.count));
    const totalValidos = dateFilteredOrders.length;
    // O ticket do período é valor ÷ VENDAS (a régua única), como no Vendas por
    // período: a mesa conta uma vez. Os gráficos de hora e dia continuam
    // contando pedidos — são o movimento da cozinha, rodada a rodada.
    //
    // O "Faturamento com taxas" também sai da régua (vendaDaRegua), e não da
    // soma crua de totalAmount de antes: é a MESMA função do cartão "Vendas no
    // filtro", então os dois tickets da tela são um número só, e faturamento ÷
    // vendas = ticket. A soma crua só diferia no que a régua tira da venda e
    // este painel não tirava: o cancelado gravado em inglês (CANCELLED) e o
    // pedido de valor impossível (R$ 1 milhão ou mais). Em 24/09/2026, nas
    // semanas conferidas da NIK e da Pastel, as duas davam o mesmo centavo.
    const regua = vendaDaRegua(dateFilteredOrders);

    return {
      porHora, maxHora, picoHora, semana, operacao, diasDoPeriodo,
      totalValidos, receitaTotal: regua.valor, vendas: regua.vendas,
      ticketMedio: regua.ticket,
      cancelados,
      brutoNoPeriodo,
      taxaCancelamento: brutoNoPeriodo > 0 ? (cancelados / brutoNoPeriodo) * 100 : 0,
    };
  }, [dateFilteredOrders, orders, noDia, de, ate, primeiroDia, hoje, passaNaOrigem, fusoDaLoja]);

  // Exportar dados como CSV
  //
  // Ponto e vírgula e vírgula decimal: é o que o Excel em português abre
  // direto em colunas. Com vírgula de separador a planilha inteira caía numa
  // coluna só. E Blob em vez de data: URI — um "#" no nome do produto cortava
  // o arquivo ali.
  const handleExportCSV = () => {
    const texto = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const reais = (v: number) => v.toFixed(2).replace(".", ",");
    const periodo = `${de}_a_${ate}`;

    let linhas: (string | number)[][];
    let nome: string;
    if (visaoDoRanking === "categoria") {
      // A árvore achatada: uma linha por categoria, por produto e por escolha,
      // cada uma dizendo a que nível pertence — dá para filtrar no Excel.
      linhas = [["Categoria", "Produto", "Escolha", "Quantidade", "Valor"]];
      for (const c of itensPorCategoria.categorias) {
        linhas.push([texto(c.categoria), "", "", c.quantidade, reais(c.valor)]);
        for (const p of c.produtos) {
          linhas.push([texto(c.categoria), texto(p.nome), "", p.quantidade, reais(p.valor)]);
          for (const e of p.escolhas) linhas.push([texto(c.categoria), texto(p.nome), texto(e.nome), e.quantidade, ""]);
        }
      }
      nome = `itens_vendidos_${periodo}.csv`;
    } else {
      linhas = [["Rank", "Produto", "Categoria", "Preço Base", "Quantidade Vendida", "Dentro de outro item", "Valor dos itens", "Custo cadastrado", "Lucro bruto (só o custo do produto)"]];
      productRanking.forEach((p, index) => linhas.push([
        index + 1,
        texto(p.name),
        texto(p.category),
        reais(p.price),
        p.qty,
        p.dentro,
        reais(p.revenue),
        p.revenue > 0 && p.cost <= 0 ? "sem custo" : reais(p.cost),
        p.revenue > 0 && p.cost <= 0 ? "" : reais(p.profit),
      ]));
      nome = `relatorio_vendas_${periodo}.csv`;
    }

    // O arquivo diz de onde veio: sem isto, a planilha aberta dias depois não
    // tinha período nem filtro.
    const filtrosEscritos = [
      selectedPlataformas.length ? `plataformas: ${selectedPlataformas.map((c) => plataformaDe(c).label).join(", ")}` : "",
      selectedCategories.length ? `categorias: ${selectedCategories.join(", ")}` : "",
      selectedProducts.length ? `${selectedProducts.length} produto(s) marcado(s)` : "",
      selectedLojas.length ? `${selectedLojas.length} loja(s) marcada(s)` : "",
    ].filter(Boolean).join(" · ") || "nenhum";
    const cabecalho = [
      [texto(`Painel de vendas — ${storeName}`)],
      [texto(`Período: ${fmtDia(de)} a ${fmtDia(ate)} (o dia vira às 5h)`)],
      [texto(`Filtros: ${filtrosEscritos}`)],
      [],
    ];
    const blob = new Blob(["\uFEFF" + [...cabecalho, ...linhas].map((l) => l.join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const CARD_SECAO = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 18, marginBottom: "1.5rem", padding: "1.25rem", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" };
  const CARD_SECAO_INTERNO = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 18, padding: "1.25rem", boxShadow: "0 2px 10px rgba(0,0,0,0.03)" };

  return (
    <div style={{ padding: "1.5rem 1rem", maxWidth: 1280, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      
      {/* ── HEADER ── */}
      <Link href="/store/relatorios" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 700, color: "#57534E", textDecoration: "none", marginBottom: 10 }}>
        ← Relatórios
      </Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontWeight: 900, fontSize: "1.8rem", color: "#0F172A", margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
            📈 Painel de vendas
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
          {ATALHOS_DO_PAINEL.map((p) => (
            <button
              key={p.chave}
              onClick={() => {
                setAtalho(p.chave);
                setUseCustom(false);
              }}
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                border: "none",
                fontWeight: 700,
                fontSize: "0.8rem",
                cursor: "pointer",
                background: !useCustom && atalho === p.chave ? "#E8360C" : "#F1F5F9",
                color: !useCustom && atalho === p.chave ? "#fff" : "#475569",
                transition: "all 0.15s"
              }}
            >
              {p.rotulo}
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
        <strong>{fmtDia(de)}</strong>
        <span>até</span>
        <strong>{fmtDia(ate)}</strong>
        <span style={{ opacity: 0.7, fontWeight: 500 }}>· o dia vira às 5h</span>
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
              Vendas
            </span>
          </div>
          <div>
            {/* Sem filtro de item é o VALOR VENDIDO da régua — o mesmo do Vendas por
                período. Até 11/10/2026 este cartão somava os itens a preço de
                cardápio, antes dos descontos (Ragnar: R$ 114.277,35 aqui ×
                R$ 101.159,87 vendidos). Com filtro, são os itens marcados. */}
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>
              {processedData.ticketDosItens ? "Valor dos itens do filtro" : "Valor vendido"}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: "1.4rem", fontWeight: 900, color: "#0F172A" }}>{fmtR(processedData.valorDoCartao)}</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#94A3B8", lineHeight: 1.4 }}>
              {processedData.ticketDosItens
                ? "Os itens marcados, pelo preço de venda (antes dos descontos do pedido)"
                : "O que os clientes pagaram: itens, menos descontos, mais a taxa de entrega"}
            </p>
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
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>Entregas</p>
            <p style={{ margin: "2px 0 0", fontSize: "1.4rem", fontWeight: 900, color: "#0F172A" }}>{movimento.operacao.entrega.vendas}</p>
            <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>
              {movimento.vendas > 0
                ? `${fmtPct(movimento.operacao.entrega.pct)} das vendas do período (a mesa conta uma vez)`
                : "Vendas que saíram para a rua"}
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
                  {entregas.doApp > 0 && (
                    <><br /><span>{entregas.doApp} {entregas.doApp === 1 ? "entrega feita" : "entregas feitas"} pelo entregador do app — sem custo para a loja</span></>
                  )}
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: "2px 0 0", fontSize: "1.1rem", fontWeight: 800, color: "#94A3B8" }}>Sem apuração</p>
                <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#B45309", fontWeight: 600, lineHeight: 1.45 }}>
                  {entregas.quantidade === 0
                    ? (entregas.doApp > 0 ? `As ${entregas.doApp} entregas do período foram feitas pelo entregador do app — sem custo para a loja.` : "Nenhuma entrega no período.")
                    : `As ${entregas.quantidade} entregas próprias do período não têm entregador atribuído, então não dá para saber quanto custaram. Atribua o entregador no pedido para este número aparecer.`}
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
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>Vendas no Filtro</p>
            <p style={{ margin: "2px 0 0", fontSize: "1.4rem", fontWeight: 900, color: "#0F172A" }}>{processedData.ordersCount} vendas</p>
            {/* Dois tickets diferentes com o mesmo nome confundiam: sem filtro de
                item é o ticket da venda (o do Movimento e do Vendas por período);
                com filtro, é o dos itens marcados, e o texto diz isso. */}
            <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>
              {processedData.ticketDosItens
                ? <>Ticket dos itens do filtro: {fmtR(processedData.ticketMedio)} — quanto desses itens cada venda levou</>
                : <>Ticket médio: {fmtR(processedData.ticketMedio)} (valor vendido ÷ vendas)</>}
            </p>
            {/* Só quando há mesa com mais de uma rodada: sem isto, o lojista que
                conta os pedidos da lista acha outro número e não sabe por quê. */}
            {processedData.lancamentos !== processedData.ordersCount && (
              <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#64748B", fontWeight: 600 }}>
                {processedData.lancamentos} pedidos lançados — a mesa de várias rodadas (e o acréscimo de um pedido) conta uma venda só
              </p>
            )}
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
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#64748B", fontWeight: 600 }}>Margem bruta estimada</p>
            {processedData.custo.suficiente && processedData.custo.margem !== null ? (
              <>
                <p style={{ margin: "2px 0 0", fontSize: "1.4rem", fontWeight: 900, color: "#0F172A" }}>
                  {fmtPct(processedData.custo.margem)}
                </p>
                <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#94A3B8", lineHeight: 1.4 }}>
                  Lucro bruto: {fmtR(processedData.custo.lucroBruto)} — só o custo dos produtos; não desconta comissão de app, entrega e taxas
                  {processedData.custo.cobertura < 0.995 && ` · custo cadastrado em ${fmtPct(processedData.custo.cobertura * 100)} do que vendeu`}
                </p>
              </>
            ) : (
              <>
                <p style={{ margin: "2px 0 0", fontSize: "1.1rem", fontWeight: 800, color: "#94A3B8" }}>Sem custo cadastrado</p>
                <p style={{ margin: "4px 0 0", fontSize: "0.7rem", color: "#B45309", fontWeight: 600, lineHeight: 1.45 }}>
                  {processedData.custo.receita > 0
                    ? `O custo cadastrado cobre ${fmtPct(processedData.custo.cobertura * 100)} do que vendeu no período. Cadastre o custo dos produtos no Cardápio para ver a margem.`
                    : "Nenhum item vendido no período."}
                </p>
              </>
            )}
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

        {tempos.carregando ? (
          <div style={{ background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 14, padding: "1.25rem", textAlign: "center", color: "#94A3B8", fontSize: "0.82rem" }}>
            Carregando os tempos do período…
          </div>
        ) : tempos.erro ? (
          <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 14, padding: "1rem", color: "#9A3412", fontSize: "0.82rem" }}>
            {tempos.erro} <Link href={`/store/relatorios/tempos?${consulta}`} style={{ color: "#9A3412", fontWeight: 800 }}>Abrir o relatório Tempo por status →</Link>
          </div>
        ) : etapasDosTempos.length === 0 ? (
          <div style={{ background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 14, padding: "1.25rem", textAlign: "center", color: "#64748B", fontSize: "0.85rem" }}>
            <Clock size={22} style={{ opacity: 0.4 }} />
            <p style={{ margin: "8px 0 0", fontWeight: 700, color: "#475569" }}>Nenhum pedido medido neste período</p>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.85rem" }}>
              {etapasDosTempos.map((e: any) => {
                const cor = COR_DA_ETAPA[e.chave] || "#334155";
                return (
                  <div key={e.chave} style={{ border: "1px solid #E2E8F0", borderRadius: 14, padding: "0.9rem 1rem", background: "#fff", borderTop: `4px solid ${cor}` }}>
                    <p style={{ margin: 0, fontSize: "0.78rem", fontWeight: 800, color: "#334155" }}>{e.titulo}</p>
                    <p style={{ margin: "6px 0 0", fontSize: "1.5rem", fontWeight: 900, color: cor, lineHeight: 1 }}>{fmtMin(e.mediana)}</p>
                    <p style={{ margin: "3px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>metade dos pedidos leva até isso</p>
                    <p style={{ margin: "6px 0 0", fontSize: "0.72rem", color: "#94A3B8", lineHeight: 1.35 }}>{e.legenda}</p>
                    <p style={{ margin: "6px 0 0", fontSize: "0.7rem", color: "#94A3B8", fontWeight: 700 }}>{e.medidos} pedido{e.medidos !== 1 ? "s" : ""} medido{e.medidos !== 1 ? "s" : ""} · média {fmtMin(e.media)}</p>
                  </div>
                );
              })}
            </div>
            <p style={{ margin: "10px 0 0", fontSize: "0.74rem", color: "#64748B" }}>
              Os mesmos números do relatório{" "}
              <Link href={`/store/relatorios/tempos?${consulta}`} style={{ color: "#0F766E", fontWeight: 800 }}>Tempo por status →</Link>
              {" "}— lá aparecem os pedidos que ficaram de fora e por quê.
            </p>
          </>
        )}
      </div>

      {/* ── OPERAÇÃO: COMO OS PEDIDOS SAÍRAM ── */}
      <div style={CARD_SECAO}>
        <div style={{ marginBottom: "1rem" }}>
          <h2 style={{ margin: 0, fontWeight: 900, fontSize: "1rem", color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
            <Bike size={18} color="#0F766E" /> No prazo do cliente
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: "0.78rem", color: "#64748B" }}>
            Na entrega, se o pedido chegou ao cliente até a hora prometida; na retirada e no balcão, se ficou pronto até o prazo.
            {saidas && <>Usa os mesmos limites dos Alertas de Produção: amarelo em {saidas.limites.amareloMin} min, vermelho em {saidas.limites.vermelhoMin} min.</>}
          </p>
        </div>

        {!saidas || saidas.medidos === 0 ? (
          <div style={{ background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 14, padding: "1.25rem", textAlign: "center", color: "#64748B", fontSize: "0.82rem" }}>
            {tempos.carregando ? "Carregando…" : tempos.erro ? tempos.erro : "Nenhuma saída medida neste período."}
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
              {saidas.atrasoMediano !== null && (
                <> · quem estourou passou, na mediana, <strong style={{ color: "#C92E09" }}>{fmtMin(saidas.atrasoMediano)}</strong> do prazo</>
              )}
              {saidas.saida && saidas.saida.medidas > 0 && (
                <><br />Na saída da loja: <strong>{saidas.saida.depoisDoPrazo}</strong> de {saidas.saida.medidas} entregas já saíram depois da hora prometida.</>
              )}
              {saidas.semEntrega > 0 && (
                <><br />{saidas.semEntrega} {saidas.semEntrega === 1 ? "entrega ficou" : "entregas ficaram"} fora: sem a hora de entrega marcada na hora (ex.: "entregue" dado em lote) — detalhes no Tempo por status.</>
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
          Vendas por plataforma (a mesa conta uma vez), a porcentagem e quanto cada uma vendeu.
        </p>

        {sourceStats.length === 0 ? (
          <p style={{ margin: 0, fontSize: "0.82rem", color: "#94A3B8" }}>Sem pedidos no período.</p>
        ) : (
          <div style={{ display: "flex", gap: "1.5rem", alignItems: "center", flexWrap: "wrap" }}>
            {/* Rosca: cada fatia é a porcentagem de VENDAS da plataforma */}
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
              <text x={80} y={76} textAnchor="middle" style={{ fontSize: 24, fontWeight: 900, fill: "#0F172A" }}>{movimento.vendas}</text>
              <text x={80} y={94} textAnchor="middle" style={{ fontSize: 10, fontWeight: 800, fill: "#94A3B8", letterSpacing: 1 }}>VENDAS</text>
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
                      <strong style={{ color: "#0F172A" }}>{f.vendas} {f.vendas === 1 ? "venda" : "vendas"}</strong> · <strong style={{ color: f.color }}>{fmtPct(f.pctQtd)}</strong> · {fmtR(f.total)}
                    </span>
                  </div>
                  <div style={{ background: "#F1F5F9", height: 7, borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ background: f.color, height: "100%", width: `${f.pctQtd}%`, borderRadius: 4 }} />
                  </div>
                  <p style={{ margin: "3px 0 0", fontSize: "0.7rem", color: "#94A3B8" }}>
                    Ticket médio: {fmtR(f.ticket)}{f.vendas !== f.count ? ` · ${f.count} lançamentos (cada rodada da mesa é um)` : ""}
                  </p>
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
            Pedidos lançados por hora (cada rodada de mesa é um — é o ritmo da cozinha). Pico às <strong>{String(movimento.picoHora.hora).padStart(2, "0")}h</strong>: {movimento.picoHora.count} no período
            {movimento.diasDoPeriodo > 1 && <>, média de <strong>{(movimento.picoHora.count / movimento.diasDoPeriodo).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</strong> por dia</>}.
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
          <p style={{ margin: "0 0 1rem", fontSize: "0.76rem", color: "#64748B", lineHeight: 1.45 }}>
            Média vendida <strong>por dia</strong>, porque o período pode ter mais sábados que quartas{movimento.semana.semHoje ? " (hoje entra quando o dia acabar)" : ""}.
            {movimento.semana.pico && (
              <> Dia mais forte: <strong>{DIAS_SEMANA[movimento.semana.pico.dia]}</strong>, {fmtR(movimento.semana.pico.mediaValor)} por dia.</>
            )}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {movimento.semana.dias.map((d) => (
              <div key={d.dia} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 34, fontSize: "0.74rem", fontWeight: 800, color: "#475569", flexShrink: 0 }}>{DIAS_SEMANA[d.dia]}</span>
                <div style={{ flex: 1, background: "#F1F5F9", height: 16, borderRadius: 5, overflow: "hidden" }}>
                  <div style={{ width: `${(d.mediaValor / movimento.semana.maxMedia) * 100}%`, height: "100%", background: movimento.semana.pico && d.dia === movimento.semana.pico.dia ? "#1C1917" : "#E7DDD3", borderRadius: 5 }} />
                </div>
                <span style={{ width: 96, textAlign: "right", fontSize: "0.72rem", color: "#64748B", flexShrink: 0, lineHeight: 1.25 }}>
                  <strong style={{ color: "#0F172A" }}>{fmtR(d.mediaValor)}</strong>/dia
                  <br />
                  <span style={{ fontSize: "0.66rem" }}>
                    {d.dias === 0 ? "nenhum no período" : `${d.dias} ${d.dias === 1 ? "dia" : "dias"} · ${d.vendas} ${d.vendas === 1 ? "venda" : "vendas"}`}
                  </span>
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginBottom: "0.5rem" }}>
            {([
              { chave: "entrega", rotulo: "🛵 Entrega", fundo: "#FAF6F2", cor: "#1C1917", detalhe: null },
              { chave: "mesa", rotulo: "🍽️ Mesa", fundo: "#F0FDFA", cor: "#0F766E",
                detalhe: movimento.operacao.mesa.lancamentos > movimento.operacao.mesa.vendas
                  ? `${movimento.operacao.mesa.lancamentos} rodadas` : null },
              { chave: "retirada", rotulo: "🏃 Retirada/balcão", fundo: "#FFF4EF", cor: "#9A3412", detalhe: null },
            ] as const).map((c) => {
              const t = movimento.operacao[c.chave];
              return (
                <div key={c.chave} style={{ background: c.fundo, borderRadius: 12, padding: "0.7rem", minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: "0.7rem", fontWeight: 800, color: c.cor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.rotulo}</p>
                  <p style={{ margin: "4px 0 0", fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>{t.vendas}</p>
                  <p style={{ margin: 0, fontSize: "0.68rem", color: "#64748B" }}>{fmtPct(t.pct)} das vendas</p>
                  <p style={{ margin: "2px 0 0", fontSize: "0.68rem", color: "#475569", fontWeight: 700 }}>{fmtR(t.valor)}</p>
                  {c.detalhe && <p style={{ margin: "2px 0 0", fontSize: "0.64rem", color: "#64748B" }}>{c.detalhe}</p>}
                </div>
              );
            })}
          </div>
          <p style={{ margin: "0 0 0.8rem", fontSize: "0.68rem", color: "#94A3B8", lineHeight: 1.4 }}>
            Cada mesa conta como uma venda, por mais rodadas que tenha. As três somam as {movimento.vendas} vendas do ticket abaixo.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: "0.8rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #F1F5F9" }}>
              <span style={{ color: "#64748B", fontWeight: 600 }}>Ticket médio do período ({movimento.vendas} {movimento.vendas === 1 ? "venda" : "vendas"})</span>
              <strong style={{ color: "#0F172A" }}>{fmtR(movimento.ticketMedio)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #F1F5F9" }}>
              <span style={{ color: "#64748B", fontWeight: 600 }}>Valor vendido</span>
              <strong style={{ color: "#0F172A" }}>{fmtR(movimento.receitaTotal)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0" }}>
              <span style={{ color: "#64748B", fontWeight: 600 }}>Pedidos cancelados (dos lançados)</span>
              <strong style={{ color: movimento.taxaCancelamento > 5 ? "#C92E09" : "#0F172A" }}>
                {movimento.cancelados} ({fmtPct(movimento.taxaCancelamento)})
              </strong>
            </div>
          </div>
        </div>

      </div>

      {/* ── GRID: CAMPEÃO + GRÁFICOS CANAL / PAGAMENTO ── */}
      {/* Duas colunas fixas empurravam o cartão de pagamentos 100 px para fora da
          tela no celular; com auto-fit, uma coluna embaixo de 700 px. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: "1.5rem", marginBottom: "1.5rem" }}>
        
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
                {championProduct.cost > 0 ? (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                      <span style={{ color: "#64748B" }}>Custo cadastrado:</span>
                      <strong style={{ color: "#C92E09" }}>{fmtR(championProduct.cost)}</strong>
                    </div>
                    <div style={{ height: "1px", background: "#E2E8F0", margin: "4px 0" }} />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", fontWeight: 800 }}>
                      <span style={{ color: "#475569" }}>Lucro bruto:</span>
                      <span style={{ color: "#FF6B35" }}>{fmtR(championProduct.profit)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#94A3B8" }}>
                      <span>Margem bruta no item:</span>
                      <span>{championProduct.revenue > 0 ? fmtPct((championProduct.profit / championProduct.revenue) * 100) : "—"}</span>
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: "0.74rem", color: "#B45309", fontWeight: 600, lineHeight: 1.4 }}>
                    Sem custo cadastrado — cadastre o custo no Cardápio para ver o lucro deste produto.
                  </div>
                )}
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
            <h3 style={{ margin: "0 0 4px", fontWeight: 900, fontSize: "0.88rem", color: "#0F172A", display: "flex", alignItems: "center", gap: 6 }}>
              <PieChart size={15} /> Formas de pagamento
            </h3>
            <p style={{ margin: "0 0 10px", fontSize: "0.72rem", color: "#64748B", lineHeight: 1.4 }}>
              Pela mesma leitura do fechamento de caixa. A mesa entra pela forma em que a conta foi paga, sem o troco.
            </p>
            {formas.carregando ? (
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#94A3B8" }}>Carregando…</p>
            ) : formas.erro ? (
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#9A3412" }}>{formas.erro}</p>
            ) : !(formas.dados?.formas || []).some((f: any) => f.valor > 0) ? (
              <p style={{ margin: 0, fontSize: "0.78rem", color: "#94A3B8" }}>Sem pagamentos no período.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(formas.dados.formas as any[]).filter((f) => f.valor > 0).sort((a, b) => b.valor - a.valor).map((f) => {
                  const cor = f.grupo === "ONLINE" ? "#2563EB" : f.grupo === "SEM_DINHEIRO" ? "#94A3B8" : "#0D9488";
                  return (
                    <div key={f.chave}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem", marginBottom: 3, gap: 8 }}>
                        <span style={{ fontWeight: 600 }}>{f.rotulo}</span>
                        <strong style={{ whiteSpace: "nowrap" }}>{fmtR(f.valor)} <span style={{ fontWeight: 400, color: "#94A3B8", marginLeft: 4 }}>({f.contas} {f.contas === 1 ? "conta" : "contas"} · {fmtPct(f.pct)})</span></strong>
                      </div>
                      <div style={{ background: "#F1F5F9", height: 6, borderRadius: 3, overflow: "hidden" }}>
                        <div style={{ background: cor, height: "100%", width: `${f.pct}%`, borderRadius: 3 }} />
                      </div>
                    </div>
                  );
                })}
                <p style={{ margin: "4px 0 0", fontSize: "0.72rem", color: "#64748B" }}>
                  Total pago: <strong>{fmtR(formas.dados.total?.valor || 0)}</strong> ·{" "}
                  <Link href={`/store/relatorios/formas-de-pagamento?${consulta}`} style={{ color: "#0F766E", fontWeight: 800 }}>ver o relatório completo →</Link>
                </p>
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
              <BarChart2 size={18} color="#E8360C" />
              {visaoDoRanking === "ranking"
                ? `Ranking Geral de Produtos (${productRanking.length})`
                : `Itens vendidos por categoria (${itensPorCategoria.categorias.length})`}
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748B" }}>
              {visaoDoRanking === "ranking"
                ? "Ordenado por quantidade vendida (do campeão ao mais fraco)"
                : "Abra a categoria e o produto para ver os sabores, bordas e opções escolhidos dentro dele"}
            </p>
          </div>

          <div role="tablist" aria-label="Como ver os produtos" style={{ display: "inline-flex", background: "#EEF2F6", borderRadius: 10, padding: 3, gap: 2 }}>
            {([["ranking", "Ranking"], ["categoria", "Por categoria"]] as const).map(([valor, rotulo]) => {
              const ativo = visaoDoRanking === valor;
              return (
                <button
                  key={valor}
                  role="tab"
                  aria-selected={ativo}
                  onClick={() => setVisaoDoRanking(valor)}
                  style={{
                    border: "none", borderRadius: 8, padding: "6px 14px", fontSize: "0.8rem", fontWeight: 700,
                    fontFamily: "inherit", cursor: "pointer",
                    background: ativo ? "#fff" : "transparent",
                    color: ativo ? "#0F172A" : "#64748B",
                    boxShadow: ativo ? "0 1px 3px rgba(15,23,42,0.12)" : "none",
                  }}
                >
                  {rotulo}
                </button>
              );
            })}
          </div>

          <div style={{ position: "relative", minWidth: 260 }}>
            <Search size={14} color="#94A3B8" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input
              type="text"
              placeholder={visaoDoRanking === "ranking" ? "Buscar no ranking..." : "Buscar produto..."}
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

        {/* ── ITENS VENDIDOS POR CATEGORIA ───────────────────────────────
            Categoria → produto → o que foi escolhido dentro dele. O valor
            fica só no produto: o sabor e a borda já estão no preço dele. */}
        {visaoDoRanking === "categoria" && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid #E2E8F0", background: "#fff", color: "#475569" }}>
                  <th style={{ padding: "12px 1.25rem", fontWeight: 700 }}>Categoria · produto · escolhas</th>
                  <th style={{ padding: "12px 1rem", fontWeight: 700, textAlign: "right", width: 130 }}>Quantidade</th>
                  <th style={{ padding: "12px 1.25rem", fontWeight: 700, textAlign: "right", width: 150 }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {itensPorCategoria.categorias.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ padding: "3rem", textAlign: "center", color: "#94A3B8" }}>
                      Nenhum item vendido no período.
                    </td>
                  </tr>
                ) : (
                  itensPorCategoria.categorias.map((c) => {
                    const chaveCat = `c:${c.categoria}`;
                    const catAberta = abertos.has(chaveCat);
                    return (
                      <React.Fragment key={chaveCat}>
                        <tr
                          onClick={() => alternar(chaveCat)}
                          aria-expanded={catAberta}
                          style={{ borderBottom: "1px solid #F1F5F9", background: "#F8FAFC", cursor: "pointer" }}
                        >
                          <td style={{ padding: "11px 1.25rem", fontWeight: 800, color: "#0F172A" }}>
                            <ChevronDown size={14} style={{ verticalAlign: -2, marginRight: 6, transition: "transform 0.15s", transform: catAberta ? "none" : "rotate(-90deg)" }} />
                            {c.categoria}
                          </td>
                          <td style={{ padding: "11px 1rem", textAlign: "right", fontWeight: 800, color: "#0F172A" }}>{c.quantidade} u.</td>
                          <td style={{ padding: "11px 1.25rem", textAlign: "right", fontWeight: 800, color: "#0F766E" }}>{fmtR(c.valor)}</td>
                        </tr>
                        {catAberta && c.produtos.map((p) => {
                          const chaveProd = `p:${c.categoria}:${p.id}`;
                          const temEscolhas = p.escolhas.length > 0;
                          const prodAberto = abertos.has(chaveProd);
                          return (
                            <React.Fragment key={chaveProd}>
                              <tr
                                onClick={temEscolhas ? () => alternar(chaveProd) : undefined}
                                aria-expanded={temEscolhas ? prodAberto : undefined}
                                style={{ borderBottom: "1px solid #F1F5F9", cursor: temEscolhas ? "pointer" : "default" }}
                              >
                                <td style={{ padding: "10px 1.25rem 10px 2.5rem", fontWeight: 700, color: "#1E293B" }}>
                                  {temEscolhas
                                    ? <ChevronDown size={13} style={{ verticalAlign: -2, marginRight: 6, transition: "transform 0.15s", transform: prodAberto ? "none" : "rotate(-90deg)" }} />
                                    : <span style={{ display: "inline-block", width: 19 }} />}
                                  {p.nome}
                                </td>
                                <td style={{ padding: "10px 1rem", textAlign: "right", fontWeight: 700, color: "#1E293B" }}>{p.quantidade} u.</td>
                                <td style={{ padding: "10px 1.25rem", textAlign: "right", fontWeight: 700, color: "#0F766E" }}>{fmtR(p.valor)}</td>
                              </tr>
                              {prodAberto && p.escolhas.map((e) => (
                                <tr key={`${chaveProd}:${e.nome}`} style={{ borderBottom: "1px solid #F8FAFC", background: "#FCFCFD" }}>
                                  <td style={{ padding: "7px 1.25rem 7px 4.4rem", color: "#475569" }}>{e.nome}</td>
                                  <td style={{ padding: "7px 1rem", textAlign: "right", color: "#475569", fontWeight: 600 }}>{e.quantidade}</td>
                                  <td style={{ padding: "7px 1.25rem", textAlign: "right", color: "#94A3B8", fontSize: "0.75rem" }}>no produto</td>
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
              {itensPorCategoria.categorias.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#FFF4EF", borderTop: "2px solid #FFD3C2" }}>
                    <td style={{ padding: "14px 1.25rem", fontWeight: 900, color: "#9A3412", fontSize: "0.86rem" }}>
                      TOTAL
                      <span style={{ display: "block", fontWeight: 600, fontSize: "0.72rem", color: "#9A3412", marginTop: 2 }}>
                        Soma dos itens. A meia pizza conta como uma escolha do sabor.
                      </span>
                    </td>
                    <td style={{ padding: "14px 1rem", textAlign: "right", fontWeight: 900, color: "#9A3412", fontSize: "0.95rem" }}>
                      {itensPorCategoria.quantidade} u.
                    </td>
                    <td style={{ padding: "14px 1.25rem", textAlign: "right", fontWeight: 900, color: "#0F766E" }}>
                      {fmtR(itensPorCategoria.valor)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* Tabela do Ranking */}
        {visaoDoRanking === "ranking" && (
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
                <th style={{ padding: "12px 1rem", fontWeight: 700, textAlign: "right" }}>Custo cadastrado</th>
                <th style={{ padding: "12px 1.25rem", fontWeight: 700, textAlign: "right" }} title="Valor dos itens menos o custo cadastrado. Não desconta comissão de app, entrega e taxas.">Lucro bruto</th>
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
                        {/* O sabor e a borda escolhidos dentro de um item que
                            já está na conta: a unidade conta aqui, o dinheiro
                            fica no item. Sem este aviso a linha lia "vendi uma
                            Portuguesa por R$ 0,00". */}
                        {p.dentro > 0 && (
                          <span style={{ display: "block", fontSize: "0.72rem", fontWeight: 500, color: "#64748B", marginTop: 2 }}>
                            {p.dentro === p.qty ? "Escolhido" : `${p.dentro} escolhido${p.dentro === 1 ? "" : "s"}`} dentro de outro item — o valor está no preço dele
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "12px 1rem" }}>
                        <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "#475569", background: "#F1F5F9", padding: "2px 8px", borderRadius: 6 }}>
                          {p.category}
                        </span>
                      </td>
                      <td style={{ padding: "12px 1rem", textAlign: "right", color: "#475569" }}>
                        {p.dentro > 0 && p.price === 0 ? "—" : fmtR(p.price)}
                      </td>
                      <td style={{ padding: "12px 1rem", textAlign: "right", fontWeight: 800, color: isZero ? "#94A3B8" : "#0F172A" }}>
                        {p.qty} u.
                      </td>
                      <td style={{ padding: "12px 1rem", textAlign: "right", fontWeight: 700, color: isZero ? "#94A3B8" : "#0F766E" }}>
                        {p.dentro > 0 && p.dentro === p.qty && p.revenue === 0
                          ? <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#94A3B8" }}>no item</span>
                          : fmtR(p.revenue)}
                      </td>
                      <td style={{ padding: "12px 1rem", textAlign: "right", color: isZero ? "#94A3B8" : "#C92E09" }}>
                        {p.revenue > 0 && p.cost <= 0 ? <span style={{ fontSize: "0.72rem", color: "#94A3B8", fontWeight: 600 }}>sem custo</span> : fmtR(p.cost)}
                      </td>
                      <td style={{ padding: "12px 1.25rem", textAlign: "right", fontWeight: 800, color: isZero ? "#94A3B8" : "#FF6B35" }}>
                        {p.revenue > 0 && p.cost <= 0 ? <span style={{ color: "#CBD5E1" }}>—</span> : fmtR(p.profit)}
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
                  <td style={{ padding: "14px 1.25rem", textAlign: "right", fontWeight: 900, color: "#E8590C" }}
                    title={totalDoRanking.semCusto > 0 ? `${totalDoRanking.semCusto} produto(s) com venda e sem custo cadastrado: o lucro do total ficaria inflado.` : undefined}>
                    {totalDoRanking.semCusto > 0 ? <span style={{ fontSize: "0.72rem", color: "#9A3412", fontWeight: 700 }}>{totalDoRanking.semCusto} sem custo</span> : fmtR(totalDoRanking.profit)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        )}

      </div>

    </div>
  );
}
