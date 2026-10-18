/**
 * "MEU APLICATIVO" — as regras puras (sem banco, sem rede), para o teste
 * (scripts/teste-meu-aplicativo.ts) e para as telas.
 *
 * Douglas, 17/10/2026: "depois que a gente ativou, abre uma aba para ele: Meu
 * aplicativo. Nessa aba vai ter a opção de mandar notificação push, quantas
 * pessoas estão ativas no aplicativo nesse momento, quantas pessoas ele tem na
 * base, todas as informações que ele precisa."
 *
 * ── De onde vem cada aparelho ───────────────────────────────────────────────
 *
 * - AppDaLojaAparelho (lib/app-da-loja/instalacoes.ts): o app avisa ao ABRIR e
 *   ao voltar para a frente, e de 4 em 4 minutos enquanto está na tela. Cada
 *   instalação tem um id sorteado no próprio celular; o token de aviso vem só
 *   quando o cliente deixou.
 * - PedidoAparelho (lib/app-da-loja/aparelhos.ts): o aparelho ligado a um
 *   pedido, desde a primeira versão do app. Entra na base pelo token — o mesmo
 *   token nas duas tabelas é UM aparelho.
 *
 * ── Promoção só para quem aceitou ───────────────────────────────────────────
 *
 * Apple 4.5.4: aviso de promoção só com o cliente tendo aceitado NO APP, com
 * texto claro, e com um jeito de sair. O app pergunta uma vez ("Quer receber
 * promoções da loja?") e tem a chave na aba Loja. Aparelho que só existe em
 * PedidoAparelho (versão velha do app, que não perguntava) conta na base mas
 * NÃO recebe promoção.
 */

/** "Ativo agora": o app avisa a cada 4 min com a tela aberta; 5 min dá a folga de uma batida perdida. */
export const ATIVO_AGORA_MS = 5 * 60 * 1000;
/** De quanto em quanto tempo o app avisa que segue aberto (apps/loja/src/lib/presenca.ts). */
export const BATIDA_DO_APP_MS = 4 * 60 * 1000;

/**
 * Envios no mesmo dia: SEM limite (Douglas, 17/10/2026 — nenhuma regra da
 * Apple, do Google ou do Expo obriga, e o app é da loja). A partir do 3º no
 * dia da loja, a tela avisa (não bloqueia) e o histórico mostra quantos
 * desligaram as promoções depois de cada envio.
 */
export const AVISAR_A_PARTIR_DE = 3;
/** A API do Expo aceita até 100 mensagens por chamada. */
export const LOTE_DO_EXPO = 100;
/** A consulta de recibos aceita até 1000 ids por chamada. */
export const LOTE_DE_RECIBOS = 1000;
/** Quanto tempo antes de perguntar ao Expo se entregou (ele pede ~15 min). */
export const ESPERA_DO_RECIBO_MS = 15 * 60 * 1000;
/** Agendar no máximo uma semana à frente. */
export const AGENDAR_ATE_MS = 7 * 24 * 60 * 60 * 1000;
/** Promoção de ontem não interessa: o Expo/FCM/APNs desistem depois de 12 h com o celular desligado. */
export const VALIDADE_DO_AVISO_S = 12 * 60 * 60;

export const TITULO_MAX = 50;
export const MENSAGEM_MAX = 180;

export type Publico = "todos" | "ativos30";
export const PUBLICOS: Publico[] = ["todos", "ativos30"];
export const ROTULO_DO_PUBLICO: Record<Publico, string> = {
  todos: "Todos que aceitaram promoções",
  ativos30: "Quem abriu o app nos últimos 30 dias",
};

// ── A BASE ──────────────────────────────────────────────────────────────────

/** Uma linha de AppDaLojaAparelho. */
export type AparelhoDaAbertura = {
  instalacaoId: string;
  pushToken: string | null;
  primeiroAcesso: Date;
  ultimoAcesso: Date;
  promocoes: boolean;
  removidoEm: Date | null;
};

/** PedidoAparelho agrupado por token: o primeiro e o último pedido daquele aparelho. */
export type AparelhoDePedido = { pushToken: string; primeiroPedido: Date; ultimoPedido: Date };

/** Um aparelho da base, já sem repetição. */
export type AparelhoDaBase = {
  chave: string;
  pushToken: string | null;
  primeiro: Date;
  ultimo: Date;
  /** Visto pelo aviso de abertura (versão nova do app). Só estes contam em "ativos agora". */
  abriuApp: boolean;
  /** Ultimo aviso de abertura (null = só conhecido por pedido). */
  ultimaAbertura: Date | null;
  promocoes: boolean;
};

/**
 * Junta as duas fontes sem contar o mesmo celular duas vezes: o token de
 * PedidoAparelho que já está numa instalação é aquela instalação (vale a data
 * mais antiga e a mais nova das duas). Instalação removida (o Expo disse que o
 * app saiu do celular) não entra, e o token dela também não volta pela porta
 * de PedidoAparelho.
 */
export function juntarBase(aberturas: AparelhoDaAbertura[], pedidos: AparelhoDePedido[]): AparelhoDaBase[] {
  const porToken = new Map<string, AparelhoDaBase>();
  const base: AparelhoDaBase[] = [];
  const tokensRemovidos = new Set<string>();
  for (const a of aberturas) {
    if (a.removidoEm) {
      if (a.pushToken) tokensRemovidos.add(a.pushToken);
      continue;
    }
    const item: AparelhoDaBase = {
      chave: `i:${a.instalacaoId}`,
      pushToken: a.pushToken,
      primeiro: a.primeiroAcesso,
      ultimo: a.ultimoAcesso,
      abriuApp: true,
      ultimaAbertura: a.ultimoAcesso,
      promocoes: a.promocoes && Boolean(a.pushToken),
    };
    base.push(item);
    if (a.pushToken) porToken.set(a.pushToken, item);
  }
  for (const p of pedidos) {
    if (tokensRemovidos.has(p.pushToken)) continue;
    const ja = porToken.get(p.pushToken);
    if (ja) {
      if (p.primeiroPedido < ja.primeiro) ja.primeiro = p.primeiroPedido;
      if (p.ultimoPedido > ja.ultimo) ja.ultimo = p.ultimoPedido;
      continue;
    }
    const item: AparelhoDaBase = {
      chave: `t:${p.pushToken}`,
      pushToken: p.pushToken,
      primeiro: p.primeiroPedido,
      ultimo: p.ultimoPedido,
      abriuApp: false,
      ultimaAbertura: null,
      promocoes: false,
    };
    base.push(item);
    porToken.set(p.pushToken, item);
  }
  return base;
}

export type ContagemDaBase = {
  /** Aparelhos com o app (instalações conhecidas). */
  instalacoes: number;
  ativosAgora: number;
  ativos7: number;
  ativos30: number;
  novosNoMes: number;
  /** Aceitaram promoção e têm token: é quem a notificação alcança. */
  recebemPromocao: number;
  /** Conhecidos só por pedido de versão velha do app (não perguntou da promoção). */
  semResposta: number;
};

/**
 * As contas da tela. `inicio7`/`inicio30`/`inicioDoMes` são o começo do dia
 * operacional (lib/relatorios/servidor.ts `inicioOperacional`): "7 dias" são
 * hoje e os 6 dias anteriores, iguais aos relatórios.
 */
export function contarBase(
  base: AparelhoDaBase[],
  marcos: { agora: Date; inicio7: Date; inicio30: Date; inicioDoMes: Date },
): ContagemDaBase {
  const limiteAgora = marcos.agora.getTime() - ATIVO_AGORA_MS;
  let ativosAgora = 0, ativos7 = 0, ativos30 = 0, novosNoMes = 0, recebemPromocao = 0, semResposta = 0;
  for (const a of base) {
    if (a.ultimaAbertura && a.ultimaAbertura.getTime() >= limiteAgora) ativosAgora++;
    if (a.ultimo >= marcos.inicio7) ativos7++;
    if (a.ultimo >= marcos.inicio30) ativos30++;
    if (a.primeiro >= marcos.inicioDoMes) novosNoMes++;
    if (a.promocoes) recebemPromocao++;
    if (!a.abriuApp) semResposta++;
  }
  return { instalacoes: base.length, ativosAgora, ativos7, ativos30, novosNoMes, recebemPromocao, semResposta };
}

/** Os tokens que o envio alcança — só quem aceitou promoção, sem repetir. */
export function tokensDoPublico(base: AparelhoDaBase[], publico: Publico, inicio30: Date): string[] {
  const vistos = new Set<string>();
  for (const a of base) {
    if (!a.promocoes || !a.pushToken) continue;
    if (publico === "ativos30" && !(a.ultimaAbertura && a.ultimaAbertura >= inicio30)) continue;
    vistos.add(a.pushToken);
  }
  return [...vistos];
}

// ── ENVIOS NO DIA ───────────────────────────────────────────────────────────

/** Um envio no dia operacional em que sai. */
export type EnvioNoDia = { dia: string; status: string };

/** Quantos envios saem (ou já saíram) no dia. Cancelado e falho não contam. */
export function enviosNoDia(envios: EnvioNoDia[], dia: string): number {
  return envios.filter((e) => e.dia === dia && e.status !== "CANCELADO" && e.status !== "FALHOU").length;
}

// ── O TEXTO ─────────────────────────────────────────────────────────────────

export type Composicao = { titulo: string; mensagem: string };

/** Limpa e confere título e mensagem. Devolve o erro para mostrar à loja, ou o texto pronto. */
export function conferirComposicao(bruto: { titulo?: unknown; mensagem?: unknown }): { ok: true; texto: Composicao } | { ok: false; erro: string } {
  const limpar = (v: unknown) => String(v ?? "").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").trim();
  const titulo = limpar(bruto.titulo).replace(/\s+/g, " ");
  const mensagem = limpar(bruto.mensagem).replace(/\n{3,}/g, "\n\n");
  if (!titulo) return { ok: false, erro: "Escreva o título." };
  if (!mensagem) return { ok: false, erro: "Escreva a mensagem." };
  if ([...titulo].length > TITULO_MAX) return { ok: false, erro: `O título passa de ${TITULO_MAX} letras — o celular corta.` };
  if ([...mensagem].length > MENSAGEM_MAX) return { ok: false, erro: `A mensagem passa de ${MENSAGEM_MAX} letras.` };
  return { ok: true, texto: { titulo, mensagem } };
}

/**
 * Para onde o toque no aviso leva, DENTRO do app: o cardápio da loja ou um
 * produto dele. Montado no servidor a partir do slug e do id do produto — a
 * tela nunca manda endereço livre (o aviso não pode virar link para fora).
 */
export function caminhoDoAviso(slug: string | null | undefined, produtoId?: string | null): string | null {
  const s = String(slug || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(s)) return null;
  const p = String(produtoId || "").trim();
  if (p && /^[A-Za-z0-9_-]{4,60}$/.test(p)) return `/loja/${s}?produto=${encodeURIComponent(p)}`;
  return `/loja/${s}`;
}

// ── EXPO ────────────────────────────────────────────────────────────────────

/** Corta a lista em lotes do tamanho que a API aceita. */
export function emLotesDe<T>(lista: T[], tamanho = LOTE_DO_EXPO): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

/** O que voltou de um lote no envio (os "tickets" do Expo, na mesma ordem das mensagens). */
export type ResultadoDoLote = {
  aceitos: { token: string; ticketId: string }[];
  erros: number;
  /** O app saiu do celular: o token sai da base. */
  mortos: string[];
};

/**
 * Lê a resposta do Expo para um lote. Lote recusado inteiro (HTTP de erro, ou
 * sem `data`) conta tudo como erro e não mata token nenhum — o problema foi
 * do envio, não dos aparelhos.
 */
export function lerTickets(tokens: string[], corpo: unknown, httpOk: boolean): ResultadoDoLote {
  const tickets: any[] = httpOk && Array.isArray((corpo as any)?.data) ? (corpo as any).data : [];
  if (tickets.length === 0) return { aceitos: [], erros: tokens.length, mortos: [] };
  const r: ResultadoDoLote = { aceitos: [], erros: 0, mortos: [] };
  tokens.forEach((token, i) => {
    const t = tickets[i];
    if (t?.status === "ok" && typeof t.id === "string") r.aceitos.push({ token, ticketId: t.id });
    else {
      r.erros++;
      if (t?.details?.error === "DeviceNotRegistered") r.mortos.push(token);
    }
  });
  return r;
}

/** O que voltou da consulta de recibos: quem o Google/Apple aceitou, quem não, e os tokens mortos. */
export function lerRecibos(
  pedidos: { ticketId: string; token: string }[],
  corpo: unknown,
): { entregues: number; erros: number; mortos: string[]; respondidos: string[] } {
  const recibos: Record<string, any> = ((corpo as any)?.data && typeof (corpo as any).data === "object") ? (corpo as any).data : {};
  const r = { entregues: 0, erros: 0, mortos: [] as string[], respondidos: [] as string[] };
  for (const p of pedidos) {
    const rec = recibos[p.ticketId];
    if (!rec) continue; // ainda não saiu: pergunta de novo na próxima rodada
    r.respondidos.push(p.ticketId);
    if (rec.status === "ok") r.entregues++;
    else {
      r.erros++;
      if (rec?.details?.error === "DeviceNotRegistered") r.mortos.push(p.token);
    }
  }
  return r;
}

// ── AGENDA ──────────────────────────────────────────────────────────────────

/** Confere a hora do agendamento: no futuro (com 2 min de folga) e até 7 dias. */
export function conferirAgendamento(quando: Date, agora: Date): string | null {
  if (!Number.isFinite(quando.getTime())) return "Hora do agendamento inválida.";
  if (quando.getTime() < agora.getTime() + 2 * 60 * 1000) return "Escolha um horário daqui a pelo menos 2 minutos.";
  if (quando.getTime() > agora.getTime() + AGENDAR_ATE_MS) return "Dá para agendar até 7 dias à frente.";
  return null;
}
