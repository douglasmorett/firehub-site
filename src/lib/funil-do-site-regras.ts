/**
 * O FUNIL DO SITE — as regras sem banco (a tela da Início e o servidor fazem
 * a MESMA conta; lib/funil-do-site.ts explica o banco).
 *
 * Douglas, 16/10/2026: "no começo da página Início quero mostrando quantas
 * pessoas tem no seu site online nesse momento, quantas entraram no seu site
 * (vai variar pelo filtro) e um funil mostrando quantos acessaram, quantos
 * colocaram itens no carrinho e tudo que um funil de restaurante precisa".
 *
 * Uma VISITA é uma pessoa (um navegador) num dia de operação. Cada visita
 * guarda até onde chegou; as etapas são cumulativas (quem fez o pedido também
 * abriu o checkout, pôs no carrinho e viu um produto), então o funil nunca
 * "sobe" de uma etapa para a outra.
 */

export const ETAPAS_DO_FUNIL = ["visita", "produto", "carrinho", "checkout", "pedido"] as const;
export type EtapaDoFunil = (typeof ETAPAS_DO_FUNIL)[number];

export const NOME_DA_ETAPA: Record<EtapaDoFunil, string> = {
  visita: "Entraram no site",
  produto: "Abriram um produto",
  carrinho: "Puseram no carrinho",
  checkout: "Foram finalizar",
  pedido: "Fizeram o pedido",
};

export function ehEtapa(v: unknown): v is EtapaDoFunil {
  return typeof v === "string" && (ETAPAS_DO_FUNIL as readonly string[]).includes(v);
}

/** As etapas que a etapa marca (cumulativas): "carrinho" também marca "produto". */
export function etapasAte(etapa: EtapaDoFunil): EtapaDoFunil[] {
  return ETAPAS_DO_FUNIL.slice(0, ETAPAS_DO_FUNIL.indexOf(etapa) + 1);
}

// ── De onde veio ────────────────────────────────────────────────────────────

export const ORIGENS = ["instagram", "whatsapp", "google", "facebook", "tiktok", "ifood", "direto", "outro"] as const;
export type OrigemDaVisita = (typeof ORIGENS)[number];

export const NOME_DA_ORIGEM: Record<OrigemDaVisita, string> = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  google: "Google",
  facebook: "Facebook",
  tiktok: "TikTok",
  ifood: "iFood",
  direto: "Link direto / QR",
  outro: "Outros sites",
};

/**
 * De onde a pessoa veio: o `utm_source` do link manda; sem ele, o site que
 * mandou (referrer). O WhatsApp e o app do Instagram quase nunca mandam
 * referrer — por isso os links que o FireHub gera levam utm_source.
 */
export function origemDaVisita(opts: { utm?: string | null; referrer?: string | null; host?: string | null }): OrigemDaVisita {
  const utm = String(opts.utm || "").toLowerCase();
  const ref = String(opts.referrer || "").toLowerCase();
  const pista = utm || ref;
  if (!pista) return "direto";
  if (/instagram|\big\b|l\.instagram/.test(pista)) return "instagram";
  if (/whatsapp|wa\.me|\bwpp\b|\bzap\b/.test(pista)) return "whatsapp";
  if (/google/.test(pista)) return "google";
  if (/facebook|fb\.com|\bfb\b|m\.facebook|l\.facebook/.test(pista)) return "facebook";
  if (/tiktok/.test(pista)) return "tiktok";
  if (/ifood/.test(pista)) return "ifood";
  if (!utm && opts.host) {
    // Navegar dentro do próprio site não é origem.
    try { if (new URL(ref).host === String(opts.host).toLowerCase()) return "direto"; } catch { /* referrer torto */ }
  }
  return "outro";
}

export type DispositivoDaVisita = "celular" | "computador";
export function dispositivoDaVisita(userAgent: string | null | undefined): DispositivoDaVisita {
  return /mobi|android|iphone|ipad|ipod/i.test(String(userAgent || "")) ? "celular" : "computador";
}

/** Robô de busca e prévia de link não são gente. */
export function ehRobo(userAgent: string | null | undefined): boolean {
  return /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp|python|curl|wget/i.test(String(userAgent || ""));
}

// ── O funil ─────────────────────────────────────────────────────────────────

export type ContagemDoFunil = Record<EtapaDoFunil, number>;

export const FUNIL_VAZIO: ContagemDoFunil = { visita: 0, produto: 0, carrinho: 0, checkout: 0, pedido: 0 };

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 1000) / 10 : 0);

export type DegrauDoFunil = {
  etapa: EtapaDoFunil;
  nome: string;
  pessoas: number;
  /** % de quem entrou no site. */
  doTotal: number;
  /** % de quem estava na etapa anterior (a primeira é 100). */
  daAnterior: number;
  /** Quantos ficaram na etapa anterior e não chegaram nesta. */
  perdidos: number;
};

/** Os degraus do funil, já com as porcentagens. Garante que nenhum degrau passe do anterior. */
export function degrausDoFunil(c: ContagemDoFunil): DegrauDoFunil[] {
  let anterior = Math.max(0, Math.floor(c.visita || 0));
  return ETAPAS_DO_FUNIL.map((etapa, i) => {
    const bruto = Math.max(0, Math.floor(c[etapa] || 0));
    const pessoas = i === 0 ? bruto : Math.min(bruto, anterior);
    const degrau: DegrauDoFunil = {
      etapa,
      nome: NOME_DA_ETAPA[etapa],
      pessoas,
      doTotal: i === 0 ? (pessoas > 0 ? 100 : 0) : pct(pessoas, c.visita),
      daAnterior: i === 0 ? 100 : pct(pessoas, anterior),
      perdidos: i === 0 ? 0 : Math.max(0, anterior - pessoas),
    };
    anterior = pessoas;
    return degrau;
  });
}

/** Onde o funil mais perde gente — e o que costuma resolver, em linguagem de lojista. */
export const DICA_DA_ETAPA: Record<Exclude<EtapaDoFunil, "visita">, string> = {
  produto: "Muita gente entra e sai sem abrir nenhum produto. Capriche nas fotos, ponha os mais vendidos no topo e deixe o preço à vista.",
  carrinho: "Abrem o produto e não colocam no carrinho. Confira preço, descrição e se as escolhas obrigatórias não estão complicadas demais.",
  checkout: "Põem no carrinho e desistem antes de finalizar. Pedido mínimo, taxa de entrega e loja fechada costumam travar aqui.",
  pedido: "Chegam a finalizar e não fecham. Veja a taxa de entrega, as formas de pagamento e se o endereço é fácil de preencher.",
};

export function maiorPerda(degraus: DegrauDoFunil[]): { etapa: Exclude<EtapaDoFunil, "visita">; perdidos: number; daAnterior: number; dica: string } | null {
  let pior: DegrauDoFunil | null = null;
  for (const d of degraus.slice(1)) {
    const antes = d.pessoas + d.perdidos;
    if (antes < 3) continue; // pouca gente: qualquer % engana
    if (!pior || d.daAnterior < pior.daAnterior) pior = d;
  }
  if (!pior || pior.perdidos === 0) return null;
  const etapa = pior.etapa as Exclude<EtapaDoFunil, "visita">;
  return { etapa, perdidos: pior.perdidos, daAnterior: pior.daAnterior, dica: DICA_DA_ETAPA[etapa] };
}

/** Pedidos ÷ visitas, em %. */
export function conversao(c: ContagemDoFunil): number {
  return pct(Math.min(c.pedido, c.visita), c.visita);
}

/** Quem está no site agora: a visita deu sinal nos últimos 2 minutos. */
export const ONLINE_POR_MS = 2 * 60 * 1000;
/** De quanto em quanto a página aberta avisa que a pessoa continua lá. */
export const BATIDA_DO_ONLINE_MS = 45 * 1000;
/** De quanto em quanto o painel pergunta quem está no site agora — a mesma
 *  pergunta leve (só o "online") na Início e na tela de Pedidos. */
export const PERGUNTA_DO_ONLINE_MS = 20 * 1000;

/**
 * A caixinha da tela de Pedidos (components/customer/PessoasNoSiteAgora.tsx):
 * o funcionário da loja só tem a tela de Pedidos (Jerrajê, 16/10/2026) e vê
 * ali o mesmo "agora" da Início, em poucas palavras.
 */
export function textoDoOnline(agora: number): string {
  const n = Math.max(0, Math.round(Number(agora) || 0));
  if (n === 0) return "ninguém no site agora";
  return `${n.toLocaleString("pt-BR")} no site agora`;
}

/** A dica ao passar o mouse: de onde vem o número e quem está comprando. */
export function dicaDoOnline(o: { agora: number; comCarrinho: number; finalizando: number }): string {
  const partes = ["Clientes com o cardápio da loja aberto (sinal nos últimos 2 minutos). Atualiza sozinho a cada 20 s."];
  if (o.comCarrinho > 0) partes.push(`🛒 ${o.comCarrinho} com carrinho${o.finalizando > 0 ? ` · ${o.finalizando} finalizando` : ""}.`);
  return partes.join(" ");
}
