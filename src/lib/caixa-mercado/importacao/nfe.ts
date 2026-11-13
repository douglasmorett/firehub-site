/**
 * O XML DA NOTA DE COMPRA (NF-e modelo 55 do fornecedor) → os itens com o que
 * o fiscal do mercado precisa: EAN (cEAN, ou cEANTrib), NCM, CEST, descrição,
 * unidade e custo unitário. É assim que o NCM dos milhares de produtos chega
 * sem ninguém digitar: o fornecedor já declarou na nota dele.
 *
 * Aceita o `nfeProc` (autorizada, o que o fornecedor manda por e-mail) e a
 * `NFe` sozinha. "SEM GTIN" (o que a SEFAZ exige quando não há código) vira
 * nulo. Sem parser de XML: os campos da NF-e são folhas simples e o layout é
 * fixo (MOC 7.0); regex por bloco <det> basta e não puxa dependência.
 *
 * Puro.
 */
import { eanValido } from "../etiqueta";

export type ItemDaNotaDeCompra = {
  numeroItem: number;
  codigoDoFornecedor: string;
  ean: string | null;
  descricao: string;
  ncm: string | null;
  cest: string | null;
  cfopDeEntrada: string | null;
  unidade: string;
  quantidade: number;
  custoUnitarioCentavos: number;
  /** A unidade tributável (às vezes a caixa vem em uCom e a unidade em uTrib). */
  eanTributavel: string | null;
  unidadeTributavel: string | null;
  quantidadeTributavel: number | null;
};

export type NotaDeCompra = {
  chave: string | null;
  numero: string | null;
  emitente: string | null;
  cnpjDoEmitente: string | null;
  emitidaEm: string | null;
  itens: ItemDaNotaDeCompra[];
};

const desescapar = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** O texto da primeira <tag> dentro de `xml` (ignora prefixo de namespace). */
function tag(xml: string, nome: string): string | null {
  const m = new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`).exec(xml);
  return m ? desescapar(m[1].trim()) : null;
}

function bloco(xml: string, nome: string): string | null {
  const m = new RegExp(`<(?:\\w+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${nome}>`).exec(xml);
  return m ? m[1] : null;
}

function eanDe(v: string | null): string | null {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 8 && eanValido(d) ? d : null;
}

export function lerNotaDeCompra(xml: string): NotaDeCompra | null {
  const texto = String(xml || "");
  const inf = bloco(texto, "infNFe");
  if (!inf) return null;
  const chave = /<(?:\w+:)?infNFe[^>]*\bId="NFe(\d{44})"/.exec(texto)?.[1] ?? tag(texto, "chNFe");
  const ide = bloco(inf, "ide") || "";
  const emit = bloco(inf, "emit") || "";
  const itens: ItemDaNotaDeCompra[] = [];
  for (const m of inf.matchAll(/<(?:\w+:)?det\b[^>]*\bnItem="(\d+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?det>/g)) {
    const prod = bloco(m[2], "prod") || "";
    const ncm = String(tag(prod, "NCM") ?? "").replace(/\D/g, "");
    const cest = String(tag(prod, "CEST") ?? "").replace(/\D/g, "");
    const qCom = Number(tag(prod, "qCom"));
    const vUnCom = Number(tag(prod, "vUnCom"));
    const qTrib = Number(tag(prod, "qTrib"));
    itens.push({
      numeroItem: Number(m[1]),
      codigoDoFornecedor: tag(prod, "cProd") || "",
      ean: eanDe(tag(prod, "cEAN")),
      descricao: (tag(prod, "xProd") || "").replace(/\s+/g, " ").slice(0, 120),
      // "00000000" é o NCM de serviço/sem classificação: não serve para produto.
      ncm: ncm.length === 8 && ncm !== "00000000" ? ncm : null,
      cest: cest.length === 7 ? cest : null,
      cfopDeEntrada: tag(prod, "CFOP"),
      unidade: (tag(prod, "uCom") || "UN").toUpperCase().slice(0, 6),
      quantidade: Number.isFinite(qCom) ? qCom : 0,
      custoUnitarioCentavos: Number.isFinite(vUnCom) ? Math.round(vUnCom * 100) : 0,
      eanTributavel: eanDe(tag(prod, "cEANTrib")),
      unidadeTributavel: (tag(prod, "uTrib") || "").toUpperCase().slice(0, 6) || null,
      quantidadeTributavel: Number.isFinite(qTrib) ? qTrib : null,
    });
  }
  return {
    chave: chave || null,
    numero: tag(ide, "nNF"),
    emitente: tag(emit, "xFant") || tag(emit, "xNome"),
    cnpjDoEmitente: tag(emit, "CNPJ") || tag(emit, "CPF"),
    emitidaEm: tag(ide, "dhEmi") || tag(ide, "dEmi"),
    itens,
  };
}

/**
 * O custo da UNIDADE que o caixa vende. A nota traz a caixa (uCom "CX",
 * qCom 2, vUnCom 60,00) e a unidade em uTrib ("UN", qTrib 24): o custo de
 * cada unidade é vProd ÷ qTrib = 5,00. Sem uTrib diferente, é o vUnCom.
 */
export function custoDaUnidade(i: ItemDaNotaDeCompra): number {
  if (i.unidadeTributavel && i.unidadeTributavel !== i.unidade && i.quantidadeTributavel && i.quantidadeTributavel > 0 && i.quantidade > 0) {
    return Math.round((i.custoUnitarioCentavos * i.quantidade) / i.quantidadeTributavel);
  }
  return i.custoUnitarioCentavos;
}

/** O EAN que o caixa lê: o da unidade tributável quando a nota vende a caixa. */
export function eanDaUnidade(i: ItemDaNotaDeCompra): string | null {
  if (i.unidadeTributavel && i.unidadeTributavel !== i.unidade && i.eanTributavel) return i.eanTributavel;
  return i.ean || i.eanTributavel;
}
