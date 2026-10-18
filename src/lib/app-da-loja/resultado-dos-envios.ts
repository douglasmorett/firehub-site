/**
 * O RESULTADO DE CADA NOTIFICAÇÃO — puro (teste em scripts/teste-meu-aplicativo.ts).
 *
 * Funil: no público → entregues (recibo do Google/Apple) → abertos (o cliente
 * tocou: o app avisa em /api/app-da-loja/notificacao-aberta) → pedidos.
 *
 * Atribuição (a regra que a tela explica numa linha): pedido feito PELO APP,
 * num aparelho que RECEBEU a notificação, até 24 h depois do envio. Se o
 * aparelho recebeu duas, o pedido vai para a mais recente antes dele (último
 * toque). Não prova que a notificação causou o pedido — mostra o que veio
 * depois dela.
 */

export const JANELA_DE_ATRIBUICAO_MS = 24 * 60 * 60 * 1000;
/** Quanto tempo depois do envio um "desligou as promoções"/"desinstalou" conta para ele. */
export const JANELA_DE_DESLIGAMENTO_MS = 48 * 60 * 60 * 1000;

export type EnvioParaAtribuir = { id: string; enviadoEm: Date; destinos: Set<string> };
export type PedidoParaAtribuir = { id: string; em: Date; valor: number; chaves: string[] };
export type Atribuido = { pedidos: number; faturamento: number; ids: string[] };

export function atribuirPedidos(envios: EnvioParaAtribuir[], pedidos: PedidoParaAtribuir[], janelaMs = JANELA_DE_ATRIBUICAO_MS): Map<string, Atribuido> {
  const saida = new Map<string, Atribuido>(envios.map((e) => [e.id, { pedidos: 0, faturamento: 0, ids: [] }]));
  for (const p of pedidos) {
    const t = p.em.getTime();
    let melhor: EnvioParaAtribuir | null = null;
    for (const e of envios) {
      const t0 = e.enviadoEm.getTime();
      if (t < t0 || t >= t0 + janelaMs) continue;
      if (!p.chaves.some((c) => e.destinos.has(c))) continue;
      if (!melhor || t0 > melhor.enviadoEm.getTime()) melhor = e;
    }
    if (!melhor) continue;
    const a = saida.get(melhor.id)!;
    a.pedidos++;
    a.faturamento = Math.round((a.faturamento + p.valor) * 100) / 100;
    a.ids.push(p.id);
  }
  return saida;
}

/**
 * Quantos dos que receberam desligaram as promoções ou desinstalaram o app em
 * até 48 h. É o "efeito colateral" do envio — a loja vê o preço de mandar demais.
 */
export function desligaramDepois(enviadoEm: Date, destinos: Set<string>, eventos: { chave: string; em: Date }[]): number {
  const t0 = enviadoEm.getTime();
  const quem = new Set<string>();
  for (const e of eventos) {
    const t = e.em.getTime();
    if (t >= t0 && t < t0 + JANELA_DE_DESLIGAMENTO_MS && destinos.has(e.chave)) quem.add(e.chave);
  }
  return quem.size;
}

// ── O QUE FUNCIONA NA LOJA ──────────────────────────────────────────────────

export type EnvioComResultado = {
  id: string;
  titulo: string;
  mensagem: string;
  /** Hora e dia da semana (0 = domingo) do envio, no relógio da loja. */
  hora: number;
  diaSemana: number;
  comProduto: boolean;
  entregues: number;
  abertos: number;
  pedidos: number;
  faturamento: number;
};

/** Envios com entrega suficiente para o aprendizado valer. */
export const MINIMO_PARA_APRENDER = 6;
const ENTREGUES_MINIMOS = 10;

export type Achado = { texto: string; melhor: string; pior: string; vezes: number };

const EMOJI = /\p{Extended_Pictographic}/u;

/**
 * Compara grupos de envios da PRÓPRIA loja (com × sem produto, título curto ×
 * longo, com × sem emoji, hora do almoço/jantar × resto, fim de semana × dia
 * útil) pela taxa de pedido (pedidos ÷ entregues). Só vira frase quando cada
 * lado tem 2 envios ou mais e um rende 30% mais que o outro.
 */
export function oQueFunciona(envios: EnvioComResultado[]): { aprendendo: boolean; faltam: number; achados: Achado[] } {
  const validos = envios.filter((e) => e.entregues >= ENTREGUES_MINIMOS);
  if (validos.length < MINIMO_PARA_APRENDER) return { aprendendo: true, faltam: MINIMO_PARA_APRENDER - validos.length, achados: [] };
  const taxa = (l: EnvioComResultado[]) => {
    const ent = l.reduce((s, e) => s + e.entregues, 0);
    return ent ? l.reduce((s, e) => s + e.pedidos, 0) / ent : 0;
  };
  const refeicao = (h: number) => (h >= 10 && h < 14) || (h >= 17 && h < 21);
  const dimensoes: { sim: string; nao: string; f: (e: EnvioComResultado) => boolean }[] = [
    { sim: "com produto no link", nao: "sem produto", f: (e) => e.comProduto },
    { sim: "com título de até 40 letras", nao: "com título longo", f: (e) => [...e.titulo].length <= 40 },
    { sim: "com emoji", nao: "sem emoji", f: (e) => EMOJI.test(`${e.titulo} ${e.mensagem}`) },
    { sim: "perto do almoço ou do jantar", nao: "fora da hora das refeições", f: (e) => refeicao(e.hora) },
    { sim: "no fim de semana", nao: "em dia de semana", f: (e) => e.diaSemana === 0 || e.diaSemana >= 5 },
  ];
  const achados: Achado[] = [];
  for (const d of dimensoes) {
    const a = validos.filter(d.f), b = validos.filter((e) => !d.f(e));
    if (a.length < 2 || b.length < 2) continue;
    const ta = taxa(a), tb = taxa(b);
    if (ta === 0 && tb === 0) continue;
    const [melhor, pior, tm, tp] = ta >= tb ? [d.sim, d.nao, ta, tb] : [d.nao, d.sim, tb, ta];
    const vezes = tp > 0 ? tm / tp : Infinity;
    if (vezes < 1.3) continue;
    achados.push({
      texto: Number.isFinite(vezes)
        ? `Notificações ${melhor} trouxeram ${vezes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}× mais pedidos que ${pior}.`
        : `Só as notificações ${melhor} trouxeram pedidos até agora.`,
      melhor, pior, vezes: Number.isFinite(vezes) ? Math.round(vezes * 10) / 10 : 99,
    });
  }
  achados.sort((x, y) => y.vezes - x.vezes);
  return { aprendendo: false, faltam: 0, achados: achados.slice(0, 4) };
}

/** Os melhores envios: mais faturamento atribuído; empate, maior taxa de pedido. */
export function rankingDosEnvios<T extends EnvioComResultado>(envios: T[], quantos = 3): T[] {
  return envios
    .filter((e) => e.pedidos > 0)
    .sort((a, b) => b.faturamento - a.faturamento || b.pedidos / Math.max(1, b.entregues) - a.pedidos / Math.max(1, a.entregues))
    .slice(0, quantos);
}
