/**
 * "O APP VALE O QUE CUSTA?" — as contas puras da aba Resultados do Meu
 * aplicativo (sem banco, sem rede; testes em scripts/teste-meu-aplicativo.ts).
 *
 * Douglas, 17/10/2026: "comparações: ticket médio e volume de vendas no
 * aplicativo vs. no site; coisas que fazem entender que é vantajoso estar no
 * aplicativo; quanto aumentou a venda dele por estar no aplicativo".
 *
 * Régua: o que é venda, o valor e o atendimento saem de
 * lib/relatorios/regua-da-venda.ts (entraNaVenda, atendimentosDaVenda — mesa
 * conta uma vez) e o dia de lib/relatorios/base.ts (dia operacional, vira às
 * 5h, fuso da loja). Nada é somado à mão fora daqui.
 *
 * Honestidade: só afirma o que os números mostram, com amostra mínima; quando
 * o app perde, diz que perde e sugere o que fazer. Antes × depois é
 * comparação, não prova de causa — a tela diz isso.
 */
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { canalDoRelatorio, naLoja, somarDias, diasNoPeriodo } from "@/lib/relatorios/base";
import { atendimentosDaVenda, cent, entraNaVenda, reais, ticketMedio, type PedidoDaRegua } from "@/lib/relatorios/regua-da-venda";

const DIA_MS = 24 * 60 * 60 * 1000;

// ── CANAIS ──────────────────────────────────────────────────────────────────

export type CanalDoApp = "APP" | "SITE" | "WHATSAPP" | "LOJA" | "MARKETPLACE" | "OUTRO";
export const CANAIS_DO_APP: CanalDoApp[] = ["APP", "SITE", "WHATSAPP", "LOJA", "MARKETPLACE", "OUTRO"];
export const ROTULO_DO_CANAL: Record<CanalDoApp, string> = {
  APP: "Aplicativo",
  SITE: "Site (navegador)",
  WHATSAPP: "WhatsApp (robô)",
  LOJA: "Balcão, mesa e totem",
  MARKETPLACE: "Marketplaces",
  OUTRO: "Outros",
};

/**
 * O canal do pedido nesta tela. O pedido feito no app é um pedido do SITE
 * (a página roda dentro do app): quem separa é a lista de pedidos do app
 * (PedidoAparelho/AppDaLojaPedido). O resto segue `canalDoRelatorio`.
 */
export function canalDaAnalise(pedido: Record<string, unknown> & { id: string; tableSessionId?: string | null }, idsDoApp: Set<string>): CanalDoApp {
  if (idsDoApp.has(pedido.id)) return "APP";
  const c = canalDoRelatorio(pedido);
  if (c === "SITE") return "SITE";
  if (c === "WHATSAPP_IA") return "WHATSAPP";
  if (c === "PDV" || c === "MESA" || c === "TOTEM") return "LOJA";
  if (canalDoPedido(pedido as any).ehMarketplace) return "MARKETPLACE";
  return "OUTRO";
}

/** Um pedido já com canal e telefone canônico ("" = sem telefone). */
export type PedidoDaAnalise = PedidoDaRegua & { createdAt: Date; canal: CanalDoApp; telefone: string };

export type NumerosDoCanal = {
  canal: CanalDoApp;
  pedidos: number;
  faturamento: number;
  ticketMedio: number;
  /** Fração (0–1) do faturamento do período. */
  participacao: number;
  clientes: number;
  /** Pedidos por cliente identificado (pelo telefone). */
  frequencia: number | null;
  /** Fração dos clientes que fizeram OUTRO pedido (qualquer canal) em até 30 dias. Null = amostra pequena. */
  recorrencia: number | null;
  /** Clientes com a janela de 30 dias fechada ou que já voltaram (o denominador). */
  recorrenciaBase: number;
};

const RECORRENCIA_MIN = 5;

/**
 * Os números de cada canal no período [inicio, fim). `todos` traz também os
 * pedidos DEPOIS do período (até `agora`), para saber quem voltou.
 *
 * Recorrência: para cada cliente do canal, o primeiro pedido dele no canal
 * dentro do período; voltou = fez outro pedido (em qualquer canal) até 30 dias
 * depois. Quem ainda não voltou e cuja janela de 30 dias não fechou fica de
 * fora da conta (ainda pode voltar).
 */
export function numerosPorCanal(todos: PedidoDaAnalise[], inicio: Date, fim: Date, agora: Date): { canais: NumerosDoCanal[]; total: { pedidos: number; faturamento: number; ticketMedio: number } } {
  const validos = todos.filter((p) => entraNaVenda(p));
  const doPeriodo = validos.filter((p) => p.createdAt >= inicio && p.createdAt < fim);
  const totalCent = doPeriodo.reduce((s, p) => s + cent(p.totalAmount), 0);
  const totalVendas = atendimentosDaVenda(doPeriodo).vendas;

  // Pedidos de cada telefone em ordem, para a recorrência.
  const porTelefone = new Map<string, number[]>();
  for (const p of validos) {
    if (!p.telefone) continue;
    const l = porTelefone.get(p.telefone) || [];
    l.push(p.createdAt.getTime());
    porTelefone.set(p.telefone, l);
  }
  for (const l of porTelefone.values()) l.sort((a, b) => a - b);

  const canais = CANAIS_DO_APP.map((canal): NumerosDoCanal => {
    const lista = doPeriodo.filter((p) => p.canal === canal);
    const vendas = atendimentosDaVenda(lista).vendas;
    const valorCent = lista.reduce((s, p) => s + cent(p.totalAmount), 0);
    const primeiro = new Map<string, number>();
    let comTelefone = 0;
    for (const p of lista) {
      if (!p.telefone) continue;
      comTelefone++;
      const t = p.createdAt.getTime();
      if (!primeiro.has(p.telefone) || t < primeiro.get(p.telefone)!) primeiro.set(p.telefone, t);
    }
    let voltaram = 0, base = 0;
    for (const [tel, t0] of primeiro) {
      const depois = (porTelefone.get(tel) || []).some((t) => t > t0 && t <= t0 + 30 * DIA_MS);
      if (depois) { voltaram++; base++; }
      else if (t0 + 30 * DIA_MS <= agora.getTime()) base++;
    }
    return {
      canal,
      pedidos: vendas,
      faturamento: reais(valorCent),
      ticketMedio: ticketMedio(reais(valorCent), vendas),
      participacao: totalCent > 0 ? valorCent / totalCent : 0,
      clientes: primeiro.size,
      frequencia: primeiro.size > 0 ? Math.round((comTelefone / primeiro.size) * 100) / 100 : null,
      recorrencia: base >= RECORRENCIA_MIN ? voltaram / base : null,
      recorrenciaBase: base,
    };
  });
  return { canais, total: { pedidos: totalVendas, faturamento: reais(totalCent), ticketMedio: ticketMedio(reais(totalCent), totalVendas) } };
}

export type Destaque = { tipo: "ganha" | "perde" | "neutro"; titulo: string; detalhe: string; acao?: string };

/** Amostra mínima para comparar dois canais. */
export const PEDIDOS_PARA_COMPARAR = 10;

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * O que a tela pode AFIRMAR sobre o app, comparado ao site (o mesmo cardápio
 * pelo navegador) e aos marketplaces. Diferença menor que 5% é "empate" e não
 * vira frase. Sem amostra, nada.
 */
export function destaquesDoApp(canais: NumerosDoCanal[]): Destaque[] {
  const de = (c: CanalDoApp) => canais.find((x) => x.canal === c)!;
  const app = de("APP"), site = de("SITE"), mkt = de("MARKETPLACE");
  const saida: Destaque[] = [];
  if (app.pedidos < PEDIDOS_PARA_COMPARAR) return saida;

  if (site.pedidos >= PEDIDOS_PARA_COMPARAR && site.ticketMedio > 0) {
    const d = app.ticketMedio / site.ticketMedio - 1;
    if (d >= 0.05) saida.push({ tipo: "ganha", titulo: `Ticket ${pct(d)} maior que o do site`, detalhe: `${brl(app.ticketMedio)} no app contra ${brl(site.ticketMedio)} no navegador.` });
    else if (d <= -0.05) saida.push({ tipo: "perde", titulo: `Ticket ${pct(d)} menor que o do site`, detalhe: `${brl(app.ticketMedio)} no app contra ${brl(site.ticketMedio)} no navegador.`, acao: "Mande notificação de combo ou de “leve 2” para quem tem o app." });
  }
  if (site.frequencia && app.frequencia && site.clientes >= PEDIDOS_PARA_COMPARAR) {
    const d = app.frequencia / site.frequencia - 1;
    if (d >= 0.05) saida.push({ tipo: "ganha", titulo: `Quem tem o app pede ${pct(d)} mais vezes`, detalhe: `${app.frequencia.toLocaleString("pt-BR")} pedidos por cliente no app contra ${site.frequencia.toLocaleString("pt-BR")} no site, no mesmo período.` });
    else if (d <= -0.05) saida.push({ tipo: "perde", titulo: `No app, o cliente pede ${pct(d)} menos vezes que no site`, detalhe: `${app.frequencia.toLocaleString("pt-BR")} contra ${site.frequencia.toLocaleString("pt-BR")} pedidos por cliente.`, acao: "Use o segmento “Sumidos” para chamar de volta quem parou de pedir." });
  }
  if (app.recorrencia != null && site.recorrencia != null) {
    const d = app.recorrencia - site.recorrencia;
    if (d >= 0.05) saida.push({ tipo: "ganha", titulo: `${pct(app.recorrencia)} voltam em 30 dias (site: ${pct(site.recorrencia)})`, detalhe: "Cliente do app volta mais — o ícone na tela do celular lembra da loja." });
    else if (d <= -0.05) saida.push({ tipo: "perde", titulo: `Retorno em 30 dias abaixo do site (${pct(app.recorrencia)} × ${pct(site.recorrencia)})`, detalhe: "Menos clientes do app voltaram a pedir no mês.", acao: "Uma notificação 20–25 dias depois do último pedido costuma trazer de volta." });
  }
  if (mkt.pedidos >= PEDIDOS_PARA_COMPARAR && mkt.ticketMedio > 0) {
    const d = app.ticketMedio / mkt.ticketMedio - 1;
    if (d >= 0.05) saida.push({ tipo: "ganha", titulo: `Ticket ${pct(d)} maior que nos marketplaces`, detalhe: `E sem comissão: o pedido do app é 100% da loja.` });
  }
  if (app.participacao > 0) {
    saida.push({ tipo: "neutro", titulo: `${(Math.round(app.participacao * 1000) / 10).toLocaleString("pt-BR")}% do faturamento veio do app`, detalhe: `${app.pedidos.toLocaleString("pt-BR")} pedidos, ${brl(app.faturamento)} no período.` });
  }
  return saida;
}

// ── COMISSÃO QUE O APP ECONOMIZOU ───────────────────────────────────────────

/** Taxa padrão (editável na tela): iFood cobra de 12% (Básico) a 23% (Entrega), mais 3,2% do pagamento online. */
export const TAXA_DE_MARKETPLACE_PADRAO = 15;

/**
 * Estimativa: se os pedidos do app tivessem vindo por um marketplace, a loja
 * pagaria `taxa`% de comissão. "Se pagou N vezes" = economia ÷ o plano no
 * mesmo número de dias (plano × dias ÷ 30).
 */
export function comissaoEconomizada(faturamentoDoApp: number, taxaPct: number, valorDoPlano: number, dias: number): { economia: number; planoNoPeriodo: number; vezes: number | null } {
  const taxa = Math.min(50, Math.max(0, Number(taxaPct) || 0));
  const economia = reais(Math.round(cent(faturamentoDoApp) * taxa / 100));
  const planoNoPeriodo = reais(Math.round(cent(valorDoPlano) * Math.max(1, dias) / 30));
  return { economia, planoNoPeriodo, vezes: planoNoPeriodo > 0 ? Math.round((economia / planoNoPeriodo) * 10) / 10 : null };
}

// ── ANTES × DEPOIS DE INSTALAR ──────────────────────────────────────────────

export type ClienteQueInstalou = { telefone: string; instalouEm: Date };
export type PedidoDoCliente = { telefone: string; em: Date; valor: number };

export type AntesDepois = {
  clientes: number;
  /** Desses, quantos não tinham pedido nenhum antes (chegaram pelo app). */
  novos: number;
  janelaMediaDias: number;
  pedidosMesAntes: number;
  pedidosMesDepois: number;
  gastoMesAntes: number;
  gastoMesDepois: number;
  variacaoPedidos: number | null;
  variacaoGasto: number | null;
};

export const JANELA_MAXIMA_DIAS = 60;
export const JANELA_MINIMA_DIAS = 14;

/**
 * O MESMO cliente (telefone), em TODOS os canais, nos N dias antes e nos N
 * dias depois de instalar o app — N igual dos dois lados (simétrico), até 60,
 * e só quem instalou há 14 dias ou mais. Normalizado para 30 dias. O pedido do
 * dia da instalação conta no "depois".
 */
export function antesDepois(clientes: ClienteQueInstalou[], pedidos: PedidoDoCliente[], agora: Date): AntesDepois {
  const porTelefone = new Map<string, PedidoDoCliente[]>();
  for (const p of pedidos) {
    if (!p.telefone) continue;
    const l = porTelefone.get(p.telefone) || [];
    l.push(p);
    porTelefone.set(p.telefone, l);
  }
  let n = 0, novos = 0, somaJanela = 0;
  let pa = 0, pd = 0, ga = 0, gd = 0;
  const vistos = new Set<string>();
  for (const c of clientes) {
    if (!c.telefone || vistos.has(c.telefone)) continue;
    vistos.add(c.telefone);
    const dias = Math.min(JANELA_MAXIMA_DIAS, Math.floor((agora.getTime() - c.instalouEm.getTime()) / DIA_MS));
    if (dias < JANELA_MINIMA_DIAS) continue;
    const t = c.instalouEm.getTime(), j = dias * DIA_MS;
    const lista = porTelefone.get(c.telefone) || [];
    const antes = lista.filter((p) => p.em.getTime() >= t - j && p.em.getTime() < t);
    const depois = lista.filter((p) => p.em.getTime() >= t && p.em.getTime() < t + j);
    const f = 30 / dias;
    pa += antes.length * f; pd += depois.length * f;
    ga += antes.reduce((s, p) => s + p.valor, 0) * f; gd += depois.reduce((s, p) => s + p.valor, 0) * f;
    if (antes.length === 0) novos++;
    somaJanela += dias;
    n++;
  }
  const media = (x: number) => (n ? Math.round((x / n) * 100) / 100 : 0);
  const variacao = (a: number, d: number) => (a > 0 ? Math.round((d / a - 1) * 1000) / 1000 : null);
  return {
    clientes: n,
    novos,
    janelaMediaDias: n ? Math.round(somaJanela / n) : 0,
    pedidosMesAntes: media(pa),
    pedidosMesDepois: media(pd),
    gastoMesAntes: media(ga),
    gastoMesDepois: media(gd),
    variacaoPedidos: variacao(pa, pd),
    variacaoGasto: variacao(ga, gd),
  };
}

// ── EVOLUÇÃO E HORÁRIOS ─────────────────────────────────────────────────────

/** Semana a semana desde `desdeDia` (dia operacional): quanto do faturamento veio do app. */
export function participacaoSemanal(pedidos: PedidoDaAnalise[], desdeDia: string, hoje: string, tz: string | null): { inicio: string; app: number; total: number; participacao: number }[] {
  const semanas = Math.max(1, Math.ceil(diasNoPeriodo(desdeDia, hoje) / 7));
  const saida = Array.from({ length: Math.min(semanas, 26) }, (_, i) => ({ inicio: somarDias(desdeDia, i * 7), appC: 0, totalC: 0 }));
  const primeiro = semanas > 26 ? semanas - 26 : 0;
  for (const p of pedidos) {
    if (!entraNaVenda(p)) continue;
    const dia = naLoja(p.createdAt, tz).dia;
    if (dia < desdeDia || dia > hoje) continue;
    const i = Math.floor((diasNoPeriodo(desdeDia, dia) - 1) / 7) - primeiro;
    const s = saida[i];
    if (!s) continue;
    s.totalC += cent(p.totalAmount);
    if (p.canal === "APP") s.appC += cent(p.totalAmount);
  }
  if (primeiro) saida.forEach((s, i) => (s.inicio = somarDias(desdeDia, (i + primeiro) * 7)));
  return saida.map((s) => ({ inicio: s.inicio, app: reais(s.appC), total: reais(s.totalC), participacao: s.totalC > 0 ? s.appC / s.totalC : 0 }));
}

/** Pedidos por dia da semana (0 = domingo, do dia operacional) × hora do relógio da loja. */
export function mapaDeCalor(pedidos: { createdAt: Date }[], tz: string | null): number[][] {
  const m = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const p of pedidos) {
    const l = naLoja(p.createdAt, tz);
    m[l.diaSemana][l.hora]++;
  }
  return m;
}

export const NOMES_DOS_DIAS_LONGOS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/**
 * O melhor horário para notificar: uma hora antes do pico de pedidos do app
 * (a pessoa decide o que comer um pouco antes de pedir). Nunca antes das 10h
 * nem depois das 21h. Sem pedido nenhum, null.
 */
export function melhorHorario(mapa: number[][]): { pico: number; enviar: number; diaForte: number; diaFraco: number } | null {
  const porHora = Array(24).fill(0) as number[];
  const porDia = mapa.map((l) => l.reduce((s, x) => s + x, 0));
  mapa.forEach((l) => l.forEach((x, h) => (porHora[h] += x)));
  const total = porHora.reduce((s, x) => s + x, 0);
  if (!total) return null;
  const pico = porHora.indexOf(Math.max(...porHora));
  const enviar = Math.min(21, Math.max(10, pico - 1));
  const diaForte = porDia.indexOf(Math.max(...porDia));
  const diaFraco = porDia.indexOf(Math.min(...porDia));
  return { pico, enviar, diaForte, diaFraco };
}
