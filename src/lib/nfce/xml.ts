/**
 * /src/lib/nfce/xml.ts
 *
 * O pouco de XML que o emissor precisa, escrito à mão de propósito.
 *
 * A SEFAZ é exigente com o texto do XML de um jeito que biblioteca genérica
 * não é (MOC 7.0, item 4.1.7 e "Padrões técnicos"): sem espaço entre as tags,
 * sem tag vazia (a tag opcional sem valor NÃO vai — `<xCpl></xCpl>` é falha de
 * schema), sem prefixo de namespace, UTF-8, e todo texto dentro do tipo
 * TString do schema, que só aceita caracteres de U+0020 a U+00FF, sem espaço
 * na ponta (tiposBasico_v4.00.xsd, TString: `[!-ÿ]{1}[ -ÿ]{0,}[!-ÿ]{1}`).
 * Um travessão "–" copiado do cardápio ou um emoji no nome do cliente é
 * rejeição 225 ("Falha no schema XML") — por isso todo texto passa por
 * `textoDaSefaz` antes de entrar.
 */
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

export const NS_NFE = "http://www.portalfiscal.inf.br/nfe";
export const NS_DSIG = "http://www.w3.org/2000/09/xmldsig#";

/** Escapa o texto para dentro de uma tag ou atributo. */
export function escaparXml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Classe de caracteres montada por código (e não com os caracteres literais no
 * fonte): travessão, aspas curvas e espaço rígido são invisíveis ou iguais a
 * olho nu, e um fonte com eles escondidos é um fonte que ninguém revisa.
 */
const hex4 = (cp: number): string => "\\" + "u" + cp.toString(16).padStart(4, "0");
const classe = (...faixas: Array<number | [number, number]>): RegExp =>
  new RegExp("[" + faixas.map((f) => (Array.isArray(f) ? `${hex4(f[0])}-${hex4(f[1])}` : hex4(f))).join("") + "]", "g");

/** Troca a tipografia comum por equivalentes Latin-1 antes de descartar o resto. */
const TROCAS: Array<[RegExp, string]> = [
  [classe([0x2010, 0x2015], 0x2212), "-"], // hífens, travessões e o sinal de menos
  [classe(0x2018, 0x2019, 0x201a, 0x201b, 0x2032), "'"],
  [classe(0x201c, 0x201d, 0x201e, 0x201f, 0x2033), '"'],
  [classe(0x2026), "..."],
  [classe(0x2022, 0x2023, 0x2043, 0x25cf), "-"],
  [classe(0x00a0, [0x2000, 0x200a], 0x202f, 0x205f, 0x3000), " "], // espaços "especiais" viram espaço
  [classe(0x20ac), "EUR"],
];

/** Tudo que NÃO é aceito: fora de U+0020–U+007E e U+00A0–U+00FF (sai também o bloco de controle C1). */
const FORA_DO_TSTRING = new RegExp("[^" + `${hex4(0x20)}-${hex4(0x7e)}${hex4(0xa0)}-${hex4(0xff)}` + "]", "g");

/**
 * O texto como a SEFAZ aceita: só U+0020–U+00FF (sem os controles C1),
 * espaços colapsados, sem espaço nas pontas, cortado em `maximo`.
 * Devolve "" quando não sobra nada — e tag com "" não é escrita.
 */
export function textoDaSefaz(v: unknown, maximo?: number): string {
  let s = String(v ?? "").normalize("NFC");
  for (const [de, para] of TROCAS) s = s.replace(de, para);
  s = s
    .replace(/[\r\n\t]+/g, " ")
    .replace(FORA_DO_TSTRING, "")
    .replace(/\s+/g, " ")
    .trim();
  if (maximo && s.length > maximo) s = s.slice(0, maximo).trim();
  return s;
}

type Atributos = Record<string, string | number | null | undefined>;

function atributos(attrs?: Atributos): string {
  if (!attrs) return "";
  return Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ` ${k}="${escaparXml(String(v))}"`)
    .join("");
}

/**
 * Uma tag com TEXTO. Valor nulo, indefinido ou vazio → nada (a SEFAZ recusa
 * tag vazia). O texto é escapado aqui; quem chama já passou por
 * `textoDaSefaz` quando o valor veio de fora.
 */
export function tag(nome: string, valor: string | number | null | undefined, attrs?: Atributos): string {
  if (valor === null || valor === undefined) return "";
  const s = String(valor);
  if (s === "") return "";
  return `<${nome}${atributos(attrs)}>${escaparXml(s)}</${nome}>`;
}

/** Um grupo com FILHOS já montados. Sem filhos → nada. */
export function grupo(nome: string, filhos: string | string[], attrs?: Atributos): string {
  const conteudo = Array.isArray(filhos) ? filhos.join("") : filhos;
  if (!conteudo) return "";
  return `<${nome}${atributos(attrs)}>${conteudo}</${nome}>`;
}

/** Valor com duas casas e ponto (TDec_1302): 12.5 → "12.50". Trabalha em centavos para não errar. */
export const dec2 = (centavos: number): string => {
  const negativo = centavos < 0;
  const abs = Math.abs(Math.round(centavos));
  return `${negativo ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};

/** Reais (número) → centavos inteiros, sem o erro de ponto flutuante. */
export const emCentavos = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

// ─── Leitura ────────────────────────────────────────────────────────────────

/** Lê um XML. Erro de sintaxe vira exceção com a mensagem do parser. */
export function lerXml(xml: string): Document {
  const erros: string[] = [];
  const doc = new DOMParser({
    onError: (nivel: string, msg: string) => {
      if (nivel !== "warning") erros.push(msg);
    },
  }).parseFromString(xml, "text/xml");
  if (erros.length) throw new Error(`XML inválido: ${erros[0]}`);
  return doc as unknown as Document;
}

export function serializar(no: Node): string {
  return new XMLSerializer().serializeToString(no as any);
}

/** Todos os descendentes com esse nome local (ignora namespace e prefixo). */
export function elementos(raiz: Node, nomeLocal: string): Element[] {
  const achados: Element[] = [];
  const visitar = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1) {
        const e = c as Element;
        if ((e.localName || e.nodeName.replace(/^.*:/, "")) === nomeLocal) achados.push(e);
        visitar(e);
      }
    }
  };
  visitar(raiz);
  return achados;
}

export const primeiro = (raiz: Node, nomeLocal: string): Element | null => elementos(raiz, nomeLocal)[0] ?? null;

/** Filho DIRETO com esse nome local (para não pegar o cStat de dentro do protNFe no lugar do do lote). */
export function filho(pai: Node, nomeLocal: string): Element | null {
  for (let c = pai.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && ((c as Element).localName || c.nodeName.replace(/^.*:/, "")) === nomeLocal) return c as Element;
  }
  return null;
}

export const textoDoFilho = (pai: Node | null, nomeLocal: string): string | null => {
  if (!pai) return null;
  const e = filho(pai, nomeLocal);
  return e ? (e.textContent ?? "").trim() : null;
};

/** Tira a declaração <?xml ...?> (o XML vai dentro do SOAP e do nfeProc sem ela). */
export const semDeclaracao = (xml: string): string =>
  (xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml).replace(/^\s*<\?xml[^>]*\?>\s*/, "");
