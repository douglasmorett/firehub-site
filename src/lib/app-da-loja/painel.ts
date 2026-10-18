/**
 * TUDO O QUE A TELA "MEU APLICATIVO" MOSTRA, num GET (/api/store/meu-aplicativo).
 * As contas são das libs puras (analise.ts, segmentos.ts, mensagem.ts,
 * resultado-dos-envios.ts); aqui só se busca e se junta.
 *
 * Régua: pedidos fora da venda e reposição nunca vêm (STATUS_FORA_DA_VENDA,
 * SEM_REPOSICAO); valor e atendimento por regua-da-venda; dia operacional da
 * loja (vira às 5h). Período: 7, 30 ou 90 dias, este mês ou o mês anterior,
 * sempre contra o período anterior de mesmo tamanho.
 */
import { prisma } from "@/lib/prisma";
import { telefoneCanonico } from "@/lib/telefone";
import { COLUNAS_DOS_FILTROS, janelaDoPeriodo } from "@/lib/relatorios/servidor";
import { STATUS_FORA_DA_VENDA, naLoja, periodoAnterior, periodoDoAtalho, somarDias, diasNoPeriodo } from "@/lib/relatorios/base";
import { SEM_REPOSICAO } from "@/lib/relatorios/sem-reposicao";
import { atendimentosDaVenda, cent, entraNaVenda, reais } from "@/lib/relatorios/regua-da-venda";
import { precoPorDisparo } from "@/lib/disparo-oficial/regras";
import { aberturasPorDia, type AppDaConta } from "@/lib/app-da-loja/instalacoes";
import { carregarPerfis } from "@/lib/app-da-loja/perfis";
import { contarBase, type ContagemDaBase } from "@/lib/app-da-loja/regras-do-push";
import {
  NOMES_DOS_DIAS_LONGOS,
  antesDepois,
  canalDaAnalise,
  destaquesDoApp,
  mapaDeCalor,
  melhorHorario,
  numerosPorCanal,
  participacaoSemanal,
  type AntesDepois,
  type CanalDoApp,
  type Destaque,
  type NumerosDoCanal,
  type PedidoDaAnalise,
} from "@/lib/app-da-loja/analise";
import { alcancePorProdutoECategoria, tamanhosDosSegmentos, type TipoDeSegmento } from "@/lib/app-da-loja/segmentos";
import { sugestoesProntas, type Sugestao } from "@/lib/app-da-loja/mensagem";
import { oQueFunciona, rankingDosEnvios, type Achado } from "@/lib/app-da-loja/resultado-dos-envios";
import { historicoDeEnvios, marcosDaConta, quantosNoDia, type Envio } from "@/lib/app-da-loja/notificacoes";

export type Periodo = "7d" | "30d" | "90d" | "mes" | "mesAnterior";
export const PERIODOS: Periodo[] = ["7d", "30d", "90d", "mes", "mesAnterior"];

const DIA_MS = 24 * 60 * 60 * 1000;

export type DiaDaSerie = { dia: string; app: number; appPedidos: number; total: number; porCanal: Record<CanalDoApp, number>; aberturas: number };

export type PainelDoApp = {
  periodo: { chave: Periodo; de: string; ate: string; dias: number; anteriorDe: string; anteriorAte: string };
  base: ContagemDaBase;
  canais: NumerosDoCanal[];
  canaisAnterior: NumerosDoCanal[];
  total: { pedidos: number; faturamento: number; ticketMedio: number };
  totalAnterior: { pedidos: number; faturamento: number; ticketMedio: number };
  destaques: Destaque[];
  serie: DiaDaSerie[];
  serieAnterior: DiaDaSerie[];
  semanal: { inicio: string; app: number; total: number; participacao: number }[];
  antesDepois: AntesDepois;
  calor: number[][];
  horario: { pico: number; enviar: number; diaForte: string; diaFraco: string } | null;
  porUnidade: { id: string; nome: string; pedidosApp: number; faturamentoApp: number; faturamentoTotal: number }[];
  notificacoes: {
    envios: (Envio & { custoNoWhatsApp: number })[];
    quantosHoje: number;
    titulosRecentes: string[];
    resumo30: { envios: number; entregues: number; abertos: number; pedidos: number; faturamento: number; desligaram: number };
    aprendizado: { aprendendo: boolean; faltam: number; achados: Achado[] };
    melhores: string[];
    segmentos: Partial<Record<TipoDeSegmento, number>>;
    alcanceProdutos: Record<string, number>;
    alcanceCategorias: Record<string, number>;
    sugestoes: Sugestao[];
    precoWhatsApp: number;
  };
  temAberturas: boolean;
};

const cache = new Map<string, { ate: number; valor: PainelDoApp }>();

export async function painelDoApp(app: AppDaConta, periodo: Periodo, agora: Date = new Date()): Promise<PainelDoApp> {
  const chaveDoCache = `${app.chave}:${app.lojaIds.length}:${periodo}`;
  const c = cache.get(chaveDoCache);
  if (c && c.ate > Date.now()) return c.valor;

  const tz = app.tz;
  const m = marcosDaConta(tz, agora);
  const hoje = m.hoje;
  const atual = periodo === "90d" ? { de: somarDias(hoje, -89), ate: hoje } : periodoDoAtalho(periodo, hoje);
  const anterior = periodoAnterior(atual.de, atual.ate);
  const jAtual = janelaDoPeriodo(atual.de, atual.ate, tz);
  const jAnterior = janelaDoPeriodo(anterior.de, anterior.ate, tz);
  const desdeTudo = new Date(Math.min(jAnterior.inicio.getTime(), agora.getTime() - 180 * DIA_MS));

  const perfis = await carregarPerfis(app, agora);
  const base = contarBase(perfis.base, m);
  const pedidosDoApp = perfis.pedidosDoApp;
  const idsDoApp = new Set(pedidosDoApp.map((p) => p.id));

  const brutos = await prisma.customerOrder.findMany({
    where: { franchiseeId: { in: app.lojaIds }, createdAt: { gte: desdeTudo }, status: { notIn: [...STATUS_FORA_DA_VENDA] }, ...SEM_REPOSICAO },
    select: { ...COLUNAS_DOS_FILTROS, parentOrderId: true, customerPhone: true, reposicao: true, openDeliveryReference: true },
  });
  const pedidos: (PedidoDaAnalise & { franchiseeId: string })[] = brutos.map((p: any) => ({
    ...p,
    createdAt: new Date(p.createdAt),
    canal: canalDaAnalise(p, idsDoApp),
    telefone: telefoneCanonico(p.customerPhone),
  }));

  const agoraOuFim = (fim: Date) => (fim > agora ? agora : fim);
  const r = numerosPorCanal(pedidos, jAtual.inicio, agoraOuFim(jAtual.fim), agora);
  const ra = numerosPorCanal(pedidos, jAnterior.inicio, jAnterior.fim, agora);

  // Séries por dia (o atual e o anterior, alinhados pelo índice do dia).
  const abriram = await aberturasPorDia(app.chave, anterior.de);
  const serieDe = (de: string, ate: string): DiaDaSerie[] => {
    const n = diasNoPeriodo(de, ate);
    const dias = Array.from({ length: n }, (_, i) => somarDias(de, i));
    const idx = new Map(dias.map((d, i) => [d, i]));
    const vazio = () => ({ APP: 0, SITE: 0, WHATSAPP: 0, LOJA: 0, MARKETPLACE: 0, OUTRO: 0 }) as Record<CanalDoApp, number>;
    const s = dias.map((dia) => ({ dia, appC: 0, appPedidos: 0, totalC: 0, porCanalC: vazio(), aberturas: abriram[dia] || 0 }));
    const doPeriodo = pedidos.filter((p) => entraNaVenda(p));
    const abre = atendimentosDaVenda(doPeriodo.filter((p) => p.canal === "APP")).abre;
    for (const p of doPeriodo) {
      const i = idx.get(naLoja(p.createdAt, tz).dia);
      if (i == null) continue;
      const v = cent(p.totalAmount);
      s[i].totalC += v;
      s[i].porCanalC[p.canal] += v;
      if (p.canal === "APP") { s[i].appC += v; if (abre.has(p.id)) s[i].appPedidos++; }
    }
    return s.map((x) => ({
      dia: x.dia, app: reais(x.appC), appPedidos: x.appPedidos, total: reais(x.totalC), aberturas: x.aberturas,
      porCanal: Object.fromEntries(Object.entries(x.porCanalC).map(([k, v]) => [k, reais(v)])) as Record<CanalDoApp, number>,
    }));
  };

  // Antes × depois: a instalação de cada telefone = o primeiro acesso do aparelho
  // em que ele pediu (ou o primeiro pedido pelo app, se o aparelho é da versão velha).
  const primeiroDaChave = new Map<string, Date>();
  for (const b of perfis.base) {
    const k = b.chave.startsWith("t:") ? b.chave.slice(2) : b.chave;
    primeiroDaChave.set(k, b.primeiro);
    if (b.pushToken) primeiroDaChave.set(b.pushToken, b.primeiro);
  }
  const instalou = new Map<string, Date>();
  for (const p of pedidosDoApp) {
    if (!p.telefone) continue;
    let t = p.em;
    for (const k of p.chaves) { const d = primeiroDaChave.get(k); if (d && d < t) t = d; }
    const atualT = instalou.get(p.telefone);
    if (!atualT || t < atualT) instalou.set(p.telefone, t);
  }
  const ad = antesDepois(
    [...instalou].map(([telefone, instalouEm]) => ({ telefone, instalouEm })),
    pedidos.filter((p) => p.telefone && entraNaVenda(p)).map((p) => ({ telefone: p.telefone, em: p.createdAt, valor: Number(p.totalAmount) || 0 })),
    agora,
  );

  const desdeAtivacao = app.plano.ativoDesde ? naLoja(new Date(app.plano.ativoDesde), tz).dia : somarDias(hoje, -83);
  const semanal = participacaoSemanal(pedidos, desdeAtivacao < somarDias(hoje, -181) ? somarDias(hoje, -181) : desdeAtivacao, hoje, tz);

  const ultimos90 = pedidos.filter((p) => p.createdAt.getTime() >= agora.getTime() - 90 * DIA_MS && entraNaVenda(p));
  const calor = mapaDeCalor(ultimos90.filter((p) => p.canal === "APP"), tz);
  const h = melhorHorario(calor);
  const hTodos = melhorHorario(mapaDeCalor(ultimos90, tz));
  const horario = h || hTodos ? {
    pico: (h || hTodos)!.pico,
    enviar: (h || hTodos)!.enviar,
    diaForte: NOMES_DOS_DIAS_LONGOS[(h || hTodos)!.diaForte],
    diaFraco: NOMES_DOS_DIAS_LONGOS[(hTodos || h)!.diaFraco],
  } : null;

  // Por unidade (conta com filial).
  let porUnidade: PainelDoApp["porUnidade"] = [];
  if (app.lojaIds.length > 1) {
    const nomes = new Map((await prisma.user.findMany({ where: { id: { in: app.lojaIds } }, select: { id: true, storeName: true, name: true } })).map((u) => [u.id, (u.storeName || u.name || "Loja").trim()]));
    const doPeriodo = pedidos.filter((p) => p.createdAt >= jAtual.inicio && p.createdAt < jAtual.fim && entraNaVenda(p));
    porUnidade = app.lojaIds.map((id) => {
      const daLoja = doPeriodo.filter((p) => p.franchiseeId === id);
      const doApp = daLoja.filter((p) => p.canal === "APP");
      return {
        id, nome: nomes.get(id) || "Loja",
        pedidosApp: atendimentosDaVenda(doApp).vendas,
        faturamentoApp: reais(doApp.reduce((s, p) => s + cent(p.totalAmount), 0)),
        faturamentoTotal: reais(daLoja.reduce((s, p) => s + cent(p.totalAmount), 0)),
      };
    }).sort((a, b) => b.faturamentoApp - a.faturamentoApp);
  }

  // Notificações.
  const envios = await historicoDeEnvios(app.chave, 60);
  const preco = precoPorDisparo();
  const enviados = envios.filter((e) => e.status === "ENVIADO");
  const ult30 = enviados.filter((e) => e.enviadoEm && new Date(e.enviadoEm).getTime() >= agora.getTime() - 30 * DIA_MS);
  const comResultado = enviados.map((e) => {
    const l = naLoja(new Date(e.enviadoEm!), tz);
    return { id: e.id, titulo: e.titulo, mensagem: e.mensagem, hora: l.hora, diaSemana: l.diaSemana, comProduto: !!e.produtoNome, entregues: e.entregues || e.aceitos, abertos: e.abertos, pedidos: e.pedidos, faturamento: e.faturamento };
  });
  const mes = hoje.slice(5, 7);
  const segmentos = tamanhosDosSegmentos(perfis.aparelhos, perfis.clientes, { agora, mesDaLoja: mes });
  const alcance = alcancePorProdutoECategoria(perfis.aparelhos, perfis.clientes, agora);

  // O produto mais pedido no app (90 dias) e a categoria dele, para as sugestões.
  const idsApp90 = ultimos90.filter((p) => p.canal === "APP").map((p) => p.id);
  let produtoTop: { id: string; nome: string; preco: number } | null = null;
  let categoriaTop: string | null = null;
  if (idsApp90.length) {
    const itens = await prisma.customerOrderItem.groupBy({
      by: ["menuProductId"],
      where: { orderId: { in: idsApp90.slice(0, 5000) }, menuProductId: { not: null } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    });
    const topId = itens[0]?.menuProductId;
    if (topId) {
      const prod = await prisma.menuProduct.findUnique({ where: { id: topId }, select: { id: true, name: true, price: true, category: true, active: true } });
      if (prod?.active) { produtoTop = { id: prod.id, nome: prod.name, preco: prod.price }; categoriaTop = prod.category; }
    }
  }

  const valor: PainelDoApp = {
    periodo: { chave: periodo, de: atual.de, ate: atual.ate, dias: diasNoPeriodo(atual.de, atual.ate), anteriorDe: anterior.de, anteriorAte: anterior.ate },
    base,
    canais: r.canais,
    canaisAnterior: ra.canais,
    total: r.total,
    totalAnterior: ra.total,
    destaques: destaquesDoApp(r.canais),
    serie: serieDe(atual.de, atual.ate),
    serieAnterior: serieDe(anterior.de, anterior.ate),
    semanal,
    antesDepois: ad,
    calor,
    horario,
    porUnidade,
    notificacoes: {
      envios: envios.map((e) => ({ ...e, custoNoWhatsApp: Math.round(e.alvo * preco * 100) / 100 })),
      quantosHoje: await quantosNoDia(app.chave, hoje),
      titulosRecentes: envios.filter((e) => e.status !== "CANCELADO" && new Date(e.criadoEm).getTime() >= agora.getTime() - 7 * DIA_MS).map((e) => e.titulo),
      resumo30: {
        envios: ult30.length,
        entregues: ult30.reduce((s, e) => s + (e.entregues || e.aceitos), 0),
        abertos: ult30.reduce((s, e) => s + e.abertos, 0),
        pedidos: ult30.reduce((s, e) => s + e.pedidos, 0),
        faturamento: Math.round(ult30.reduce((s, e) => s + e.faturamento, 0) * 100) / 100,
        desligaram: ult30.reduce((s, e) => s + e.desligaram, 0),
      },
      aprendizado: oQueFunciona(comResultado),
      melhores: rankingDosEnvios(comResultado).map((e) => e.id),
      segmentos,
      alcanceProdutos: alcance.produtos,
      alcanceCategorias: alcance.categorias,
      sugestoes: sugestoesProntas({ loja: app.nome, produtoTop, categoriaTop, diaFraco: horario?.diaFraco ?? null, horaDeEnvio: horario?.enviar ?? null }),
      precoWhatsApp: preco,
    },
    temAberturas: perfis.base.some((b) => b.abriuApp),
  };
  if (cache.size > 200) cache.clear();
  cache.set(chaveDoCache, { ate: Date.now() + 60_000, valor });
  return valor;
}

/** Limpa o cache da conta (depois de um envio, o histórico tem de aparecer na hora). */
export function esquecerPainel(chave: string): void {
  for (const k of cache.keys()) if (k.startsWith(`${chave}:`)) cache.delete(k);
}
