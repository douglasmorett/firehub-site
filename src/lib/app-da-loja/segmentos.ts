/**
 * NOTIFICAÇÃO DIRECIONADA — para quem mandar, em grupos que o dono entende
 * ("sumidos", "fiéis", "quem pediu pizza"). Puro: o servidor monta os perfis
 * (lib/app-da-loja/perfis.ts) e isto só escolhe. Teste em
 * scripts/teste-meu-aplicativo.ts.
 *
 * Todo segmento é um RECORTE de quem recebe notificação: permitiu no celular
 * e aceitou o termo do app (que avisa das promoções — Apple 4.5.4). Fora
 * disso, ninguém entra em segmento nenhum.
 *
 * O aparelho se liga ao cliente pelos pedidos feitos nele (o telefone do
 * pedido). Aparelho que nunca pediu só entra em "todos", "ativos agora",
 * "ativos 30 dias" e "nunca pediu pelo app".
 */
import { ATIVO_AGORA_MS } from "@/lib/app-da-loja/regras-do-push";

const DIA_MS = 24 * 60 * 60 * 1000;

export type TipoDeSegmento =
  | "todos"
  | "ativosAgora"
  | "ativos30"
  | "sumidos30"
  | "sumidos60"
  | "fieis"
  | "ticketAlto"
  | "nuncaPediuNoApp"
  | "produto"
  | "categoria"
  | "aniversariantes";

export const SEGMENTOS: { tipo: TipoDeSegmento; rotulo: string; explica: string; comValor?: "produto" | "categoria" }[] = [
  { tipo: "todos", rotulo: "Todos", explica: "Todos que recebem notificação (aceitaram o termo e permitiram no celular)." },
  { tipo: "ativosAgora", rotulo: "Com o app aberto agora", explica: "Abriram o app nos últimos 5 minutos." },
  { tipo: "ativos30", rotulo: "Ativos no mês", explica: "Abriram o app nos últimos 30 dias." },
  { tipo: "sumidos30", rotulo: "Sumidos há 30 dias", explica: "Já pediram, mas não pedem há 30 dias ou mais (em nenhum canal)." },
  { tipo: "sumidos60", rotulo: "Sumidos há 60 dias", explica: "Não pedem há 60 dias ou mais." },
  { tipo: "fieis", rotulo: "Fiéis", explica: "3 pedidos ou mais nos últimos 30 dias." },
  { tipo: "ticketAlto", rotulo: "Ticket alto", explica: "Gastam por pedido mais que 3 de cada 4 clientes do app (90 dias)." },
  { tipo: "nuncaPediuNoApp", rotulo: "Nunca pediram pelo app", explica: "Instalaram, mas ainda não fizeram o primeiro pedido pelo app." },
  { tipo: "produto", rotulo: "Pediram um produto", explica: "Pediram este produto nos últimos 90 dias.", comValor: "produto" },
  { tipo: "categoria", rotulo: "Pediram de uma categoria", explica: "Pediram desta categoria nos últimos 90 dias.", comValor: "categoria" },
  { tipo: "aniversariantes", rotulo: "Aniversariantes do mês", explica: "Fazem aniversário este mês (data do cadastro no cardápio)." },
];

export type Segmento = { tipo: TipoDeSegmento; valor?: string | null };

export function segmentoValido(s: unknown): Segmento | null {
  const tipo = (s as any)?.tipo;
  const def = SEGMENTOS.find((x) => x.tipo === tipo);
  if (!def) return null;
  const valor = typeof (s as any)?.valor === "string" ? (s as any).valor.trim().slice(0, 120) : "";
  if (def.comValor && !valor) return null;
  return { tipo: def.tipo, valor: def.comValor ? valor : null };
}

/** Um aparelho que pode receber promoção (token válido, termo aceito, promoção ligada). */
export type AparelhoDoSegmento = {
  pushToken: string;
  ultimaAbertura: Date | null;
  telefones: string[];
  /** Pedidos feitos PELO APP neste aparelho. */
  pedidosNoApp: number;
};

/** O cliente por trás do telefone: pedidos em TODOS os canais (até 120 dias) e o aniversário ("MM-DD"). */
export type ClienteDoSegmento = {
  pedidos: { em: Date; valor: number; produtos: string[]; categorias: string[] }[];
  ultimoPedidoEm: Date | null;
  aniversario: string | null;
};

/** "1990-03-15", "15/03/1990", "15/03" → "03-15". Inválido → null. */
export function mesDiaDoAniversario(bruto: unknown): string | null {
  const t = String(bruto || "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/.exec(t);
  if (m) {
    const d = Number(m[1]), mes = Number(m[2]);
    if (d >= 1 && d <= 31 && mes >= 1 && mes <= 12) return `${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

type Contexto = { agora: Date; mesDaLoja: string /* "MM" */ };

/** O ticket de corte do "ticket alto": o percentil 75 dos tickets médios (90 dias) de quem pediu. */
export function corteDoTicketAlto(aparelhos: AparelhoDoSegmento[], clientes: Map<string, ClienteDoSegmento>, agora: Date): number | null {
  const tickets: number[] = [];
  for (const a of aparelhos) {
    const t = ticketDoAparelho(a, clientes, agora);
    if (t != null) tickets.push(t);
  }
  if (tickets.length < 3) return null;
  tickets.sort((x, y) => x - y);
  return tickets[Math.floor(tickets.length * 0.75)];
}

function pedidosDoAparelho(a: AparelhoDoSegmento, clientes: Map<string, ClienteDoSegmento>) {
  return a.telefones.flatMap((t) => clientes.get(t)?.pedidos || []);
}

function ticketDoAparelho(a: AparelhoDoSegmento, clientes: Map<string, ClienteDoSegmento>, agora: Date): number | null {
  const desde = agora.getTime() - 90 * DIA_MS;
  const l = pedidosDoAparelho(a, clientes).filter((p) => p.em.getTime() >= desde);
  if (!l.length) return null;
  return l.reduce((s, p) => s + p.valor, 0) / l.length;
}

/** O aparelho está no segmento? */
export function noSegmento(a: AparelhoDoSegmento, seg: Segmento, clientes: Map<string, ClienteDoSegmento>, ctx: Contexto & { corteTicket: number | null }): boolean {
  const agora = ctx.agora.getTime();
  const pedidos = () => pedidosDoAparelho(a, clientes);
  const ultimo = () => {
    let u = 0;
    for (const t of a.telefones) { const c = clientes.get(t); if (c?.ultimoPedidoEm) u = Math.max(u, c.ultimoPedidoEm.getTime()); }
    return u || null;
  };
  switch (seg.tipo) {
    case "todos": return true;
    case "ativosAgora": return !!a.ultimaAbertura && a.ultimaAbertura.getTime() >= agora - ATIVO_AGORA_MS;
    case "ativos30": return !!a.ultimaAbertura && a.ultimaAbertura.getTime() >= agora - 30 * DIA_MS;
    case "sumidos30": { const u = ultimo(); return u != null && u <= agora - 30 * DIA_MS; }
    case "sumidos60": { const u = ultimo(); return u != null && u <= agora - 60 * DIA_MS; }
    case "fieis": return pedidos().filter((p) => p.em.getTime() >= agora - 30 * DIA_MS).length >= 3;
    case "ticketAlto": { const t = ticketDoAparelho(a, clientes, ctx.agora); return ctx.corteTicket != null && t != null && t >= ctx.corteTicket; }
    case "nuncaPediuNoApp": return a.pedidosNoApp === 0;
    case "produto": return pedidos().some((p) => p.em.getTime() >= agora - 90 * DIA_MS && p.produtos.includes(String(seg.valor)));
    case "categoria": {
      const alvo = String(seg.valor || "").toLowerCase();
      return pedidos().some((p) => p.em.getTime() >= agora - 90 * DIA_MS && p.categorias.some((c) => c.toLowerCase() === alvo));
    }
    case "aniversariantes": return a.telefones.some((t) => clientes.get(t)?.aniversario?.slice(0, 2) === ctx.mesDaLoja);
  }
}

/** Os tokens do segmento, sem repetir. */
export function tokensDoSegmento(aparelhos: AparelhoDoSegmento[], seg: Segmento, clientes: Map<string, ClienteDoSegmento>, ctx: Contexto): string[] {
  const corteTicket = seg.tipo === "ticketAlto" ? corteDoTicketAlto(aparelhos, clientes, ctx.agora) : null;
  const vistos = new Set<string>();
  for (const a of aparelhos) if (noSegmento(a, seg, clientes, { ...ctx, corteTicket })) vistos.add(a.pushToken);
  return [...vistos];
}

/** O tamanho de cada segmento fixo agora (produto/categoria a tela pede na hora). */
export function tamanhosDosSegmentos(aparelhos: AparelhoDoSegmento[], clientes: Map<string, ClienteDoSegmento>, ctx: Contexto): Partial<Record<TipoDeSegmento, number>> {
  const corteTicket = corteDoTicketAlto(aparelhos, clientes, ctx.agora);
  const saida: Partial<Record<TipoDeSegmento, number>> = {};
  for (const s of SEGMENTOS) {
    if (s.comValor) continue;
    const vistos = new Set<string>();
    for (const a of aparelhos) if (noSegmento(a, { tipo: s.tipo }, clientes, { ...ctx, corteTicket })) vistos.add(a.pushToken);
    saida[s.tipo] = vistos.size;
  }
  return saida;
}

/** Quantos aparelhos cada produto e cada categoria alcançam (para a lista da tela). */
export function alcancePorProdutoECategoria(aparelhos: AparelhoDoSegmento[], clientes: Map<string, ClienteDoSegmento>, agora: Date): { produtos: Record<string, number>; categorias: Record<string, number> } {
  const desde = agora.getTime() - 90 * DIA_MS;
  const produtos: Record<string, Set<string>> = {}, categorias: Record<string, Set<string>> = {};
  for (const a of aparelhos) {
    for (const p of pedidosDoAparelho(a, clientes)) {
      if (p.em.getTime() < desde) continue;
      for (const id of p.produtos) (produtos[id] ||= new Set()).add(a.pushToken);
      for (const c of p.categorias) (categorias[c] ||= new Set()).add(a.pushToken);
    }
  }
  const contar = (o: Record<string, Set<string>>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.size]));
  return { produtos: contar(produtos), categorias: contar(categorias) };
}
