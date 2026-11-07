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
 * Duas telas no mesmo código (pedido do Douglas pelo Ragnar, 07/11/2026): a
 * dos CLIENTES DO BALCÃO, de sempre, e a dos MOTOBOYS DE APLICATIVO
 * (/tv/<código>?tela=motoboy) — o entregador do iFood/99 não conhece o nosso
 * número, só o da plataforma, e ficava perguntando na portinhola. As duas
 * podem estar ligadas ao mesmo tempo, em TVs diferentes.
 *
 * Arquivo puro (sem banco): a regra de "o que aparece onde" é a mesma na rota
 * e no teste (scripts/teste-painel-de-senhas.ts).
 */
import { canalDoPedido, type ChaveDeCanal } from "./canal-do-pedido";
import { infoDaEntrega } from "./entrega-parceira";

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
/** E a tela: a TV dos motoboys que religa volta para a dos motoboys. */
export const CHAVE_DA_TELA = "firehub-tv-tela";

/** Qual das duas telas a TV mostra (vem da URL, não da configuração). */
export type TelaDoPainel = "balcao" | "motoboy";
export const lerTela = (v: unknown): TelaDoPainel => (v === "motoboy" ? "motoboy" : "balcao");

/** Sem 0/O, 1/I/L: o código é digitado no controle remoto da TV. */
const ALFABETO_DO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const TAMANHO_DO_CODIGO = 6;

/**
 * Sorteio de 0 a max-1 com o gerador criptográfico. O código é a única senha
 * da TV, e o Math.random dá para prever vendo os códigos que ele já soltou
 * (auditoria de 23/10/2026). Web Crypto em vez de node:crypto: este arquivo
 * também roda no navegador (tv/DigitarCodigo.tsx). Descarta o topo para não
 * puxar o sorteio para as primeiras letras.
 */
function sorteioSeguro(max: number): number {
  const teto = Math.floor(0x100000000 / max) * max;
  const n = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(n);
  while (n[0] >= teto);
  return n[0] % max;
}

/** Mesmo formato de sempre (6 do alfabeto acima): os códigos já emitidos seguem valendo. */
export function novoCodigo(sorteio: (max: number) => number = sorteioSeguro): string {
  let c = "";
  for (let i = 0; i < TAMANHO_DO_CODIGO; i++) c += ALFABETO_DO_CODIGO[sorteio(ALFABETO_DO_CODIGO.length)];
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
  // Daqui para baixo, só a tela dos motoboys usa.
  source?: string | null;
  openDeliveryChannel?: string | null;
  openDeliveryOrderId?: string | null;
  ifoodOrderId?: string | null;
  ifoodReference?: string | null;
  openDeliveryReference?: string | null;
  ifoodPickupCode?: string | null;
  openDeliveryPickupCode?: string | null;
  deliveryBy?: string | null;
  ifoodDriverName?: string | null;
  ifoodDriverStatus?: string | null;
  /** Número do iFood quando a loja chamou o entregador do iFood Sob Demanda para este pedido (lib/ifood-sob-demanda.ts). */
  sobDemandaIfood?: string | null;
};

export type SenhaNaTela = {
  id: string;
  numero: number;
  nome: string;
  desde: string;
  /** Tela dos motoboys: o código que o entregador conhece e de qual app ele é. */
  codigo?: string;
  plataforma?: string;
  corDaPlataforma?: string;
  textoDaPlataforma?: string;
};

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

/** Cor da marca no cartão escuro da TV: iFood vermelho, 99 amarelo. Os outros usam a cor do selo do painel. */
const COR_NA_TV: Partial<Record<ChaveDeCanal, [string, string]>> = {
  IFOOD: ["#EA1D2C", "#FFFFFF"],
  "99FOOD": ["#FFDD00", "#0B0F17"],
  KEETA: ["#FACC15", "#0B0F17"],
};

/** O entregador do iFood já pegou o pedido: sai da TV mesmo antes de a loja despachar. */
const ENTREGADOR_JA_LEVOU = new Set(["COLLECTED", "DISPATCHED", "ARRIVED_AT_DESTINATION", "DELIVERED"]);

/**
 * Se quem vem buscar este pedido é entregador de plataforma, o que vai no
 * cartão; senão null (entrega própria, retirada, balcão, mesa).
 *
 * Quem decide é `infoDaEntrega` (lib/entrega-parceira.ts), a mesma regra do
 * quadro e da comanda — mais o vínculo do iFood Sob Demanda, que não marca
 * nada no pedido da loja.
 *
 * O código é o NÚMERO DO PEDIDO NA PLATAFORMA, nunca o nosso (Douglas, 07/11:
 * "tem que aparecer o número do pedido da plataforma e não o da loja"):
 *   - iFood: o número de exibição (o "N. no iFood: 3704" da comanda);
 *   - 99Food, Keeta, Jotajá…: o número do pedido no app; sem ele, o código de coleta.
 *     O "Código de verificação" do 99 não vai na TV: é o que o balcão confere;
 *   - pedido da loja com entregador chamado no iFood: o número do iFood Sob
 *     Demanda; sem ele, o código de coleta. Sem nenhum dos dois, não entra na TV.
 */
export function entregadorDePlataforma(
  p: PedidoDoPainel,
): { codigo: string; plataforma: string; corDaPlataforma: string; textoDaPlataforma: string } | null {
  if (grupoDoPedido(p.deliveryType) !== "delivery") return null;
  const sobDemanda = String(p.sobDemandaIfood || "").trim();
  const info = infoDaEntrega(p);
  if (!sobDemanda && !info.parceira) return null;

  const canal = canalDoPedido(p);
  const chave: ChaveDeCanal = sobDemanda || info.parceiro === "IFOOD" ? "IFOOD" : info.parceiro === "99FOOD" ? "99FOOD" : canal.chave;
  const coleta = String(info.codigoDeColeta || "").trim();
  let codigo = sobDemanda || canal.referencia || coleta;
  // Pedido do NOSSO site com entregador chamado no iFood não tem número de app:
  // o entregador recebe o pedido com o número da loja.
  if (!codigo && !canal.ehMarketplace && p.dailyOrderNumber != null) codigo = String(p.dailyOrderNumber);
  if (!codigo) return null;

  const nome = chave === "IFOOD" ? "iFood" : chave === "99FOOD" ? "99Food" : canal.ehMarketplace ? canal.nome : info.parceiro || canal.nome;
  const [corDaPlataforma, textoDaPlataforma] = COR_NA_TV[chave] || [canal.fundo, canal.texto];
  return { codigo: codigo.toUpperCase(), plataforma: nome, corDaPlataforma, textoDaPlataforma };
}

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
  tela: TelaDoPainel = "balcao",
): { preparando: SenhaNaTela[]; prontos: SenhaNaTela[] } {
  const preparando: (SenhaNaTela & { t: number })[] = [];
  const prontos: (SenhaNaTela & { t: number })[] = [];
  const janelaDoPronto = config.prontoFicaMin * 60_000;

  for (const p of pedidos) {
    if (p.dailyOrderNumber == null) continue;
    const grupo = grupoDoPedido(p.deliveryType);
    // A tela dos motoboys não segue as caixinhas Balcão/Mesa/Delivery: mostra
    // o pedido que um entregador de plataforma vem buscar, e só ele.
    const entregador = tela === "motoboy" ? entregadorDePlataforma(p) : null;
    if (tela === "motoboy") {
      if (!entregador) continue;
      if (ENTREGADOR_JA_LEVOU.has(String(p.ifoodDriverStatus || "").toUpperCase())) continue;
    } else if (!config[grupo]) continue;
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
      ...entregador,
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
