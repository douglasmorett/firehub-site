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
 * ── Uma permissão só (Douglas, 18/10/2026) ─────────────────────────────────
 *
 * "Todo mundo que tem o app tem que receber notificação push." Recebe
 * promoção quem: abriu a versão do app com o TERMO DE USO
 * (apps/loja/src/lib/termo.ts), aceitou, e tocou em "Permitir" no pedido de
 * notificação do celular que vem logo depois. O termo diz em destaque que as
 * notificações incluem promoções: é o aceite explícito da Apple 4.5.4. Sair
 * é desligar as notificações nos ajustes do celular (a aba Loja do app tem a
 * linha que abre os ajustes); não há chave para tirar só a promoção
 * ("nada de botão de tirar notificação", Douglas, 18/10/2026). A exceção é
 * quem tocou "Agora não" na tela ANTIGA de promoções: escolha explícita,
 * continua sem promoção.
 *
 * O celular só deixa mandar para quem tocou em "Permitir": sem token, não há
 * como. E a notificação nunca é obrigatória para usar o app (4.5.4).
 *
 * Aparelho que só existe em PedidoAparelho (versão antiga do app) tem token,
 * mas o cliente permitiu a notificação para o aviso do PEDIDO, numa tela e
 * numa política que diziam que ela não servia para propaganda. Ele conta na
 * base, NÃO recebe promoção, e passa a receber quando abrir a versão nova e
 * aceitar o termo (o EAS Update chega sozinho na abertura).
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
  todos: "Todos que recebem notificação",
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
  /** Quando respondeu (aceitou o termo ou mexeu na chave). Null = ainda não. */
  promocoesRespondidoEm?: Date | null;
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
  /** Recebe promoção: tem token e aceitou o termo (fora quem recusou na tela antiga). */
  promocoes: boolean;
  /** Já respondeu (termo aceito ou a tela antiga) — separa "recusou na tela antiga" de "ainda não aceitou". */
  respondeu: boolean;
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
      respondeu: Boolean(a.promocoesRespondidoEm),
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
      respondeu: false,
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
  /** Permitiram notificação no celular e aceitaram o termo: quem a notificação alcança. */
  recebemNotificacao: number;
  /** Têm notificação permitida, mas tocaram "Agora não" na tela ANTIGA de promoções (escolha explícita, poucos). */
  recusaramNaTelaAntiga: number;
  /** Abriram o app e não permitiram notificação no celular (o sistema não deixa mandar). */
  semPermissao: number;
  /** Têm notificação permitida mas ainda não aceitaram o termo (abrem a versão nova e passam a receber). */
  aguardandoTermo: number;
  /** Só conhecidos por pedido da versão antiga do app. */
  versaoAntiga: number;
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
  let ativosAgora = 0, ativos7 = 0, ativos30 = 0, novosNoMes = 0;
  let recebemNotificacao = 0, recusaramNaTelaAntiga = 0, semPermissao = 0, aguardandoTermo = 0, versaoAntiga = 0;
  for (const a of base) {
    if (a.ultimaAbertura && a.ultimaAbertura.getTime() >= limiteAgora) ativosAgora++;
    if (a.ultimo >= marcos.inicio7) ativos7++;
    if (a.ultimo >= marcos.inicio30) ativos30++;
    if (a.primeiro >= marcos.inicioDoMes) novosNoMes++;
    if (!a.abriuApp) versaoAntiga++;
    else if (!a.pushToken) semPermissao++;
    else if (a.promocoes) recebemNotificacao++;
    else if (a.respondeu) recusaramNaTelaAntiga++;
    else aguardandoTermo++;
  }
  return { instalacoes: base.length, ativosAgora, ativos7, ativos30, novosNoMes, recebemNotificacao, recusaramNaTelaAntiga, semPermissao, aguardandoTermo, versaoAntiga };
}

/** Os tokens que o envio alcança — quem recebe notificação (ver acima), sem repetir. */
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
