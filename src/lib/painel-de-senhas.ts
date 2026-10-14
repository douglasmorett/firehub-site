/**
 * lib/painel-de-senhas.ts — a TV do salão que chama a senha (o painel do
 * McDonald's, do Sweet Table).
 *
 * Pedido do Douglas (13/10/2026): loja de shopping e salão querem pôr uma TV
 * com o painel de senha — marca da loja em destaque, a do FireHub no canto.
 *
 * Como funciona:
 *   - a loja configura em /store/painel-de-senhas (`User.painelDeSenhas`);
 *   - a TV abre firehubfood.com.br/tv e digita o CÓDIGO da loja (curto, para
 *     digitar com o controle remoto), ou abre o link direto /tv/<código>;
 *   - a TV pergunta a /api/painel-de-senhas a cada poucos segundos e desenha
 *     duas colunas: Preparando e Pronto. Quando um número entra em Pronto,
 *     ele é chamado em tela cheia, com som.
 *
 * Arquivo puro (sem banco): a regra de "o que aparece onde" é a mesma na rota
 * e no teste (scripts/teste-painel-de-senhas.ts).
 */

/** O que a loja escolhe na tela de configuração. */
export type ConfigDoPainel = {
  /** O código que a TV digita. Trocar o código desconecta as TVs antigas. */
  codigo: string;
  /** Quais pedidos aparecem. Balcão e retirada é o caso da praça de alimentação. */
  balcao: boolean;
  mesa: boolean;
  delivery: boolean;
  /** Primeiro nome embaixo do número ("347 · Maria"). */
  mostrarNome: boolean;
  /** Toca o "plim-plom" quando um número fica pronto. */
  som: boolean;
  /** Fala "Senha 347" (voz do navegador da TV). */
  voz: boolean;
  /** Quantos minutos o número fica em Pronto se ninguém finalizar o pedido. */
  prontoFicaMin: number;
  /** Frase do rodapé ("Peça também pelo nosso site!"). */
  mensagem: string;
  /** QR do cardápio online no canto ("Peça pelo celular"). */
  qrDoCardapio: boolean;
  /** Cor do destaque (coluna Pronto e chamada). */
  cor: string;
};

export const CORES_DO_PAINEL = ["#22C55E", "#F59E0B", "#EF4444", "#3B82F6", "#A855F7", "#EC4899", "#14B8A6"];

/** Onde a TV guarda o último código: religou a TV, abriu /tv, volta sozinha ao painel. */
export const CHAVE_DO_CODIGO = "firehub-tv-codigo";

/** Sem 0/O, 1/I/L: o código é digitado no controle remoto da TV. */
const ALFABETO_DO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TAMANHO_DO_CODIGO = 6;

export function novoCodigo(aleatorio: () => number = Math.random): string {
  let c = "";
  for (let i = 0; i < TAMANHO_DO_CODIGO; i++) c += ALFABETO_DO_CODIGO[Math.floor(aleatorio() * ALFABETO_DO_CODIGO.length)];
  return c;
}

/** O código como a pessoa digitou ("k7p 2qx") → "K7P2QX"; "" se não for um código. */
export function normalizarCodigo(bruto: unknown): string {
  const c = String(bruto ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === TAMANHO_DO_CODIGO ? c : "";
}

const PADRAO: Omit<ConfigDoPainel, "codigo"> = {
  balcao: true,
  mesa: false,
  delivery: false,
  mostrarNome: false,
  som: true,
  voz: false,
  prontoFicaMin: 10,
  mensagem: "",
  qrDoCardapio: false,
  cor: CORES_DO_PAINEL[0],
};

const bool = (v: unknown, padrao: boolean) => (typeof v === "boolean" ? v : padrao);

/** Lê o JSON gravado (ou o que a tela mandou) com tudo no lugar e nos limites. */
export function lerConfigDoPainel(bruto: unknown): ConfigDoPainel {
  const o = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const min = Number(o.prontoFicaMin);
  const cor = typeof o.cor === "string" && /^#[0-9a-fA-F]{6}$/.test(o.cor) ? o.cor.toUpperCase() : PADRAO.cor;
  return {
    codigo: normalizarCodigo(o.codigo),
    balcao: bool(o.balcao, PADRAO.balcao),
    mesa: bool(o.mesa, PADRAO.mesa),
    delivery: bool(o.delivery, PADRAO.delivery),
    mostrarNome: bool(o.mostrarNome, PADRAO.mostrarNome),
    som: bool(o.som, PADRAO.som),
    voz: bool(o.voz, PADRAO.voz),
    prontoFicaMin: Number.isFinite(min) ? Math.min(60, Math.max(1, Math.round(min))) : PADRAO.prontoFicaMin,
    mensagem: typeof o.mensagem === "string" ? o.mensagem.replace(/\s+/g, " ").trim().slice(0, 120) : "",
    qrDoCardapio: bool(o.qrDoCardapio, PADRAO.qrDoCardapio),
    cor,
  };
}

/** O pedido como a rota lê do banco — só o que a TV precisa. */
export type PedidoDoPainel = {
  id: string;
  dailyOrderNumber: number | null;
  customerName: string | null;
  status: string;
  deliveryType: string | null;
  kdsStage: string | null;
  readyAt: Date | string | null;
  updatedAt: Date | string;
  createdAt: Date | string;
  scheduledDatetime?: Date | string | null;
};

export type SenhaNaTela = { id: string; numero: number; nome: string; desde: string };

/** Status em que o pedido ainda está sendo feito (aceito ou esperando o aceite). */
const PREPARANDO = new Set(["NOVO", "ACEITO", "PREPARANDO"]);
/** Retirada/balcão/mesa pronto: o KDS manda SAIU_ENTREGA, o quadro manda PRONTO. */
const PRONTO_SEM_ENTREGA = new Set(["PRONTO", "SAIU_ENTREGA"]);

function grupoDoPedido(deliveryType: string | null): "balcao" | "mesa" | "delivery" {
  const t = String(deliveryType || "").toUpperCase();
  if (t === "DELIVERY") return "delivery";
  if (t === "MESA") return "mesa";
  return "balcao";
}

/** "MARIA DA SILVA" → "Maria"; nome que não diz quem é ("Cliente Balcão") → "". */
export function nomeNaTela(nome: string | null | undefined): string {
  const primeiro = String(nome || "").trim().split(/\s+/)[0] || "";
  const sem = primeiro.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (sem.length < 2 || /^(cliente|whatsapp|user|usuario|ifood|balcao|mesa|consumidor|totem|pdv|anonimo|-)/.test(sem)) return "";
  if (/\d/.test(primeiro)) return "";
  return primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase().slice(0, 13);
}

const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : NaN);

/**
 * Divide os pedidos entre Preparando e Pronto.
 *
 * Pronto some sozinho depois de `prontoFicaMin` (a loja que não finaliza o
 * pedido de balcão não pode ter a coluna crescendo a noite toda) e na hora em
 * que o pedido é finalizado ou cancelado.
 */
export function separarSenhas(
  pedidos: PedidoDoPainel[],
  config: Pick<ConfigDoPainel, "balcao" | "mesa" | "delivery" | "mostrarNome" | "prontoFicaMin">,
  agora: number = Date.now(),
): { preparando: SenhaNaTela[]; prontos: SenhaNaTela[] } {
  const preparando: (SenhaNaTela & { t: number })[] = [];
  const prontos: (SenhaNaTela & { t: number })[] = [];
  const janelaDoPronto = config.prontoFicaMin * 60_000;

  for (const p of pedidos) {
    if (p.dailyOrderNumber == null) continue;
    const grupo = grupoDoPedido(p.deliveryType);
    if (!config[grupo]) continue;
    // Encomenda para mais tarde ainda não é senha de ninguém.
    if (p.scheduledDatetime && ms(p.scheduledDatetime) > agora + 30 * 60_000) continue;

    const status = String(p.status || "").toUpperCase();
    const finalizadoNoKds = p.kdsStage === "FINISHED";
    const pronto =
      grupo === "delivery"
        ? status === "PRONTO" || (finalizadoNoKds && PREPARANDO.has(status))
        : PRONTO_SEM_ENTREGA.has(status) || (finalizadoNoKds && PREPARANDO.has(status));

    const senha = {
      id: p.id,
      numero: p.dailyOrderNumber,
      nome: config.mostrarNome ? nomeNaTela(p.customerName) : "",
    };

    if (pronto) {
      const desde = Number.isFinite(ms(p.readyAt)) ? ms(p.readyAt) : ms(p.updatedAt);
      if (agora - desde > janelaDoPronto) continue;
      prontos.push({ ...senha, desde: new Date(desde).toISOString(), t: desde });
    } else if (PREPARANDO.has(status)) {
      const desde = ms(p.createdAt);
      preparando.push({ ...senha, desde: new Date(desde).toISOString(), t: desde });
    }
  }

  // Preparando: quem pediu primeiro, primeiro. Pronto: o que acabou de ficar
  // pronto no topo — é o que o cliente procura.
  preparando.sort((a, b) => a.t - b.t);
  prontos.sort((a, b) => b.t - a.t);
  const limpa = ({ t: _t, ...s }: SenhaNaTela & { t: number }): SenhaNaTela => s;
  return { preparando: preparando.map(limpa), prontos: prontos.map(limpa) };
}
