/**
 * "Importar saldos" da aba Clientes: a loja cola uma lista (telefone, valor e,
 * se quiser, o nome) e cada linha vira um crédito de cashback.
 *
 * Nasceu da Showrrascão (03/10/2026): os clientes tinham saldo na carteira do
 * Gama Delivery, e a loja precisava levar esse saldo para o FireHub antes de
 * apontar o domínio para o cardápio novo. A lista vem de qualquer jeito —
 * planilha colada (tab), CSV com ";" ou ",", ou texto do WhatsApp
 * ("João (22) 99999-1234 R$ 25,50") — então a leitura procura o telefone e o
 * valor na linha em vez de exigir colunas.
 *
 * Sem banco: provado em scripts/teste-lote-de-saldo.mjs.
 */

export type LinhaDoLote = {
  linha: number;
  texto: string;
  /** DDD + número, só dígitos. */
  telefone: string | null;
  valor: number | null;
  nome: string | null;
  erro: string | null;
};

export const MAXIMO_DE_LINHAS = 2_000;

/** "1.234,56", "25,5", "25.50" e "30" dão o que o lojista quis dizer. */
export function lerValorEmReais(bruto: unknown): number {
  if (typeof bruto === "number") return bruto;
  const limpo = String(bruto ?? "").trim().replace(/[^\d.,]/g, "");
  if (!limpo) return NaN;
  if (limpo.includes(",")) return Number(limpo.replace(/\./g, "").replace(",", "."));
  const partes = limpo.split(".");
  if (partes.length === 1) return Number(limpo);
  const ultimo = partes[partes.length - 1];
  if (partes.length > 2 || ultimo.length === 3) return Number(partes.join(""));
  return Number(partes.slice(0, -1).join("") + "." + ultimo);
}

/** DDD + número sem o 55 do país; null quando não tem cara de telefone brasileiro. */
export function telefoneNacional(bruto: unknown): string | null {
  let d = String(bruto ?? "").replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d.startsWith("0")) return null;
  return d;
}

// +55 opcional, DDD com ou sem parênteses, o 9 opcional, hífen/espaço/ponto no meio.
const TELEFONE = /(?:\+?55[\s.-]*)?\(?\d{2}\)?[\s.-]*9?\d{4}[\s.-]?\d{4}/;
const VALOR = /\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+[.,]\d{1,2}|\d+/;

export function lerLote(texto: string, valorMaximo = 5_000): LinhaDoLote[] {
  const linhas = String(texto || "").split(/\r?\n/);
  const vistos = new Map<string, number>();
  const saida: LinhaDoLote[] = [];
  linhas.forEach((bruta, i) => {
    const t = bruta.replace(/\s+/g, " ").trim();
    // Linha vazia e cabeçalho ("telefone;valor;nome") não são cliente.
    if (!t || !/\d/.test(t)) return;
    const base: LinhaDoLote = { linha: i + 1, texto: t.slice(0, 200), telefone: null, valor: null, nome: null, erro: null };

    const achou = t.match(TELEFONE);
    const telefone = achou ? telefoneNacional(achou[0]) : null;
    if (!achou || !telefone) {
      saida.push({ ...base, erro: "telefone não encontrado" });
      return;
    }
    const resto = t.replace(achou[0], " ");
    const v = resto.match(VALOR);
    const valor = v ? Math.round(lerValorEmReais(v[0]) * 100) / 100 : NaN;
    const nome = resto
      .replace(v ? v[0] : "", " ")
      .replace(/R\$/gi, " ")
      .replace(/[;,\t|]+/g, " ")
      .replace(/[^\p{L}\s'.-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
    const comNome = { ...base, telefone, valor: Number.isFinite(valor) ? valor : null, nome: nome.replace(/[^\p{L}]/gu, "").length >= 2 ? nome.slice(0, 120) : null };

    if (!Number.isFinite(valor) || valor <= 0) {
      saida.push({ ...comNome, erro: "valor não encontrado" });
      return;
    }
    if (valor > valorMaximo) {
      saida.push({ ...comNome, erro: `valor acima de R$ ${valorMaximo.toLocaleString("pt-BR")}` });
      return;
    }
    const antes = vistos.get(telefone);
    if (antes) {
      saida.push({ ...comNome, erro: `telefone repetido (linha ${antes})` });
      return;
    }
    vistos.set(telefone, i + 1);
    saida.push(comNome);
  });
  return saida.slice(0, MAXIMO_DE_LINHAS);
}
