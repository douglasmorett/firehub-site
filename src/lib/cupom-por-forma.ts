/**
 * EM QUAIS FORMAS DE PAGAMENTO O CUPOM VALE.
 *
 * Pedido da Ligeiro Lanches (Niterói, 18/10/2026): o desconto de 10% vale só
 * para Pix, Débito e Crédito — não para a Arariboia, a moeda social de
 * Niterói, que a loja cadastrou como bandeira de Vale.
 *
 * ── O que fica gravado no cupom (`User.storeCoupons[]`) ─────────────────────
 *
 *   formasDePagamento  ["PIX", "DEBITO", "CREDITO"] — as formas em que vale.
 *                      Chaves: DINHEIRO, PIX, DEBITO, CREDITO, VALE e
 *                      "PROPRIA:<nome>" para a forma própria da loja
 *                      (lib/formas-proprias.ts). AUSENTE (ou vazio) = vale em
 *                      todas: nenhum cupom gravado antes disto muda.
 *   valesFora          ["Arariboia"] — bandeiras de Vale em que NÃO vale, mesmo
 *                      com o Vale marcado. Só bandeira de Vale: o cardápio é o
 *                      único lugar com cupom que grava a bandeira, e só a do
 *                      Vale (VOUCHER_<nome>); o crédito chega sem bandeira.
 *
 * ── Como se lê a forma do pedido ────────────────────────────────────────────
 *
 * Pix pelo site (Asaas) conta como Pix; o cartão pelo site, como Crédito. A
 * bandeira de Vale da loja é procurada no texto ANTES da leitura canônica:
 * "Cartão Arariboia" leria Crédito. Pagamento dividido ("Dividido: A R$ x +
 * B R$ y", ou a lista de partes) só leva o cupom se TODAS as partes valem.
 * Forma ainda não escolhida (vazia) não recusa — o robô monta o pedido aos
 * poucos e o pagamento chega no fim; forma escrita que não se reconhece
 * recusa, num cupom com restrição: na dúvida, não dá o desconto.
 *
 * Puro: o cardápio, o checkout, o robô e os testes leem daqui.
 * Teste: scripts/teste-cupom-por-forma.ts.
 */
import { formaCanonica } from "./pagamento-na-entrega";
import { chaveDoNome, lerFormasProprias, nomeDaFormaPropria } from "./formas-proprias";

export type FormaBaseDoCupom = "DINHEIRO" | "PIX" | "DEBITO" | "CREDITO" | "VALE";

/** Ordem e rótulo das caixinhas e da frase "vale só para ...". */
export const FORMAS_DO_CUPOM: { chave: FormaBaseDoCupom; rotulo: string }[] = [
  { chave: "DINHEIRO", rotulo: "Dinheiro" },
  { chave: "PIX", rotulo: "Pix" },
  { chave: "DEBITO", rotulo: "Débito" },
  { chave: "CREDITO", rotulo: "Crédito" },
  { chave: "VALE", rotulo: "Vale-refeição" },
];

export const PREFIXO_DA_PROPRIA = "PROPRIA:";
export const chaveDaPropria = (nome: string) => `${PREFIXO_DA_PROPRIA}${String(nome || "").trim()}`;

export type RestricaoDoCupom = {
  code: string;
  /** null = vale em todas. */
  formasDePagamento: string[] | null;
  valesFora: string[];
};

const BASES = new Set<string>(FORMAS_DO_CUPOM.map((f) => f.chave));

/** O que está gravado, lido com tolerância. Lista vazia ou sem chave válida = todas. */
export function lerFormasDoCupom(bruto: unknown): string[] | null {
  if (!Array.isArray(bruto)) return null;
  const saida: string[] = [];
  for (const b of bruto) {
    const t = String(b ?? "").trim();
    const k = t.toUpperCase();
    if (BASES.has(k)) {
      if (!saida.includes(k)) saida.push(k);
    } else if (k.startsWith(PREFIXO_DA_PROPRIA) && t.slice(PREFIXO_DA_PROPRIA.length).trim()) {
      const p = chaveDaPropria(t.slice(PREFIXO_DA_PROPRIA.length));
      if (!saida.some((s) => s.toUpperCase() === p.toUpperCase())) saida.push(p);
    }
  }
  return saida.length > 0 ? saida : null;
}

export function lerValesFora(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((b) => String(b ?? "").trim()).filter(Boolean);
}

export function cupomTemRestricaoDeForma(c: Pick<RestricaoDoCupom, "formasDePagamento" | "valesFora">): boolean {
  return c.formasDePagamento !== null || c.valesFora.length > 0;
}

/** "Pix, Débito e Crédito" ("ou", para "pagando com…") — a lista para o cliente. Vale em todas → null. */
export function textoDasFormasDoCupom(c: Pick<RestricaoDoCupom, "formasDePagamento" | "valesFora">, conectivo: "e" | "ou" = "e"): string | null {
  if (!cupomTemRestricaoDeForma(c)) return null;
  const marcadas = c.formasDePagamento;
  const nomes: string[] = [];
  for (const f of FORMAS_DO_CUPOM) {
    if (marcadas && !marcadas.includes(f.chave)) continue;
    if (f.chave === "VALE" && c.valesFora.length > 0) nomes.push(`Vale-refeição (menos ${juntar(c.valesFora, "e")})`);
    else nomes.push(f.rotulo);
  }
  for (const m of marcadas || []) if (m.startsWith(PREFIXO_DA_PROPRIA)) nomes.push(m.slice(PREFIXO_DA_PROPRIA.length));
  return juntar(nomes, conectivo);
}

function juntar(lista: string[], conectivo: string): string {
  if (lista.length <= 1) return lista.join("");
  return `${lista.slice(0, -1).join(", ")} ${conectivo} ${lista[lista.length - 1]}`;
}

/** "A R$ 20,00 + B R$ 15,00" → ["A", "B"]; texto comum → [texto]. */
export function partesDaForma(texto: unknown): string[] {
  const t = String(texto ?? "").trim();
  if (!t) return [];
  if (!/^dividido\s*:/i.test(t)) return [t];
  return t
    .replace(/^dividido\s*:\s*/i, "")
    .split(/\s+\+\s+/)
    .map((p) => p.replace(/\s*R\$\s*[\d.,]+\s*$/i, "").trim())
    .filter(Boolean);
}

export type FormaLidaParaOCupom =
  | { forma: FormaBaseDoCupom; bandeira?: string }
  | { forma: "PROPRIA"; nome: string }
  | { forma: null };

/** Palavras sem acento/caixa/pontuação, com espaço nas pontas, para casar palavra inteira. */
const palavras = (s: unknown) => ` ${chaveDoNome(String(s ?? "")).replace(/[^a-z0-9]+/g, " ").trim()} `;

function bandeirasDeVale(paymentFees: unknown): string[] {
  const brands = (paymentFees as any)?.VOUCHER?.brands;
  if (!Array.isArray(brands)) return [];
  return brands.map((b: any) => String(b?.name ?? "").trim()).filter(Boolean);
}

/** Lê UMA forma (não o dividido) do jeito que o cupom precisa. */
export function formaParaOCupom(texto: unknown, paymentFees: unknown): FormaLidaParaOCupom {
  const bruto = String(texto ?? "").trim();
  if (!bruto) return { forma: null };

  // Forma própria: pela marca, ou pelo nome cadastrado (o robô escreve "Macaíba").
  const marcada = nomeDaFormaPropria(bruto);
  const proprias = lerFormasProprias(paymentFees);
  const nomeLimpo = chaveDoNome(marcada ?? bruto.replace(/\s*\([^)]*\)/g, ""));
  const propria = proprias.find((f) => chaveDoNome(f.nome) === nomeLimpo);
  if (propria) return { forma: "PROPRIA", nome: propria.nome };
  if (marcada) return { forma: "PROPRIA", nome: marcada };

  // Os códigos do cardápio.
  const pm = bruto.toUpperCase();
  if (pm === "PIX" || pm === "PIX_ONLINE" || pm === "PIX_ENTREGA") return { forma: "PIX" };
  if (pm === "DINHEIRO") return { forma: "DINHEIRO" };
  if (pm === "DEBITO") return { forma: "DEBITO" };
  if (pm === "CREDITO" || pm === "CREDITO_ONLINE" || pm === "CARTAO_ONLINE") return { forma: "CREDITO" };
  if (pm === "VOUCHER") return { forma: "VALE" };
  if (pm.startsWith("VOUCHER_")) return { forma: "VALE", bandeira: bruto.slice("VOUCHER_".length).trim() };

  // Bandeira de Vale da loja escrita no texto ("Arariboia", "vale VR").
  const noTexto = palavras(bruto);
  const bandeira = bandeirasDeVale(paymentFees).find((b) => palavras(b).trim() && noTexto.includes(palavras(b)));
  if (bandeira) return { forma: "VALE", bandeira };

  const canonica = formaCanonica(bruto);
  if (canonica === "Dinheiro") return { forma: "DINHEIRO" };
  if (canonica === "Pix") return { forma: "PIX" };
  if (canonica === "Cartão Débito") return { forma: "DEBITO" };
  if (canonica === "Cartão Crédito") return { forma: "CREDITO" };
  if (canonica === "Vale-refeição") return { forma: "VALE" };
  return { forma: null };
}

function formaPermitida(c: RestricaoDoCupom, lida: FormaLidaParaOCupom): boolean {
  if (lida.forma === null) return false;
  const marcadas = c.formasDePagamento;
  if (lida.forma === "PROPRIA") {
    if (!marcadas) return true;
    const k = chaveDoNome(lida.nome);
    return marcadas.some((m) => m.startsWith(PREFIXO_DA_PROPRIA) && chaveDoNome(m.slice(PREFIXO_DA_PROPRIA.length)) === k);
  }
  if (marcadas && !marcadas.includes(lida.forma)) return false;
  if (lida.forma === "VALE" && lida.bandeira) {
    const k = chaveDoNome(lida.bandeira);
    if (c.valesFora.some((v) => chaveDoNome(v) === k)) return false;
  }
  return true;
}

/**
 * A trava. Recebe a forma do pedido (texto, código do cardápio, resumo do
 * dividido ou a lista de partes) e devolve a frase da recusa, ou null quando
 * o cupom pode entrar. Cupom sem restrição → sempre null.
 */
export function formaRecusadaPeloCupom(c: RestricaoDoCupom, formaDoPedido: unknown, paymentFees: unknown): string | null {
  if (!cupomTemRestricaoDeForma(c)) return null;
  const brutas = Array.isArray(formaDoPedido) ? formaDoPedido : [formaDoPedido];
  const partes = brutas.flatMap((b) => partesDaForma(b && typeof b === "object" ? (b as any).method ?? (b as any).metodo : b));
  if (partes.length === 0) return null; // ainda não escolheu
  const lista = textoDasFormasDoCupom(c);
  for (const parte of partes) {
    const lida = formaParaOCupom(parte, paymentFees);
    if (formaPermitida(c, lida)) continue;
    const dividido = partes.length > 1 ? " No pagamento dividido, todas as formas precisam estar nessa lista." : "";
    if (lida.forma === "VALE" && lida.bandeira && (!c.formasDePagamento || c.formasDePagamento.includes("VALE"))) {
      return `O cupom ${c.code} não vale para ${lida.bandeira}: vale só para ${lista}.${dividido}`;
    }
    return `O cupom ${c.code} vale só para ${lista}.${dividido}`;
  }
  return null;
}
