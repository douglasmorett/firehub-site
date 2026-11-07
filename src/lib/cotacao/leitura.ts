/**
 * O QUE ENTRA COMO TEXTO NA COTAÇÃO, LIMPO. Puro (sem banco e sem IA).
 *
 *  - a resposta da IA (./ia.ts) vira linhas de preço conferidas: nome, unidade,
 *    preço e validade — a IA às vezes devolve preço em texto ("R$ 42,90"),
 *    linha sem preço ou o mesmo item duas vezes;
 *  - a mensagem de texto do fornecedor só vai para a IA se tiver cara de preço
 *    ("bom dia, tudo certo?" não custa chamada nenhuma);
 *  - a lista colada pelo lojista vira produtos ("Tomate kg 10") ou
 *    fornecedores ("Hortifruti Silva (22) 99999-8888 João").
 */
import { lerNumeroBr } from "@/lib/cmv/numero";
import { normalizarNome } from "./casamento";

export type LinhaDePreco = { nome: string; unidade: string | null; preco: number; validade: string | null };
export type ProdutoLido = { nome: string; unidade: string; quantidade: number | null; categoria: string | null };
export type FornecedorLido = { nome: string; telefone: string | null; contato: string | null };

/** Unidades de compra que a tela oferece; o resto entra como veio, limpo. */
export const UNIDADES_DE_COMPRA = ["un", "kg", "g", "cx", "fd", "pct", "dz", "l", "ml", "sc", "bd", "gf", "lt"];
const APELIDOS_DE_UNIDADE: Record<string, string> = {
  un: "un", und: "un", unid: "un", unidade: "un", unidades: "un", pc: "un", peca: "un", pecas: "un",
  kg: "kg", kgs: "kg", quilo: "kg", quilos: "kg", kilo: "kg", kilos: "kg",
  g: "g", gr: "g", grs: "g", grama: "g", gramas: "g",
  cx: "cx", caixa: "cx", caixas: "cx",
  fd: "fd", fardo: "fd", fardos: "fd",
  pct: "pct", pacote: "pct", pacotes: "pct", pt: "pct",
  dz: "dz", duzia: "dz", duzias: "dz",
  l: "l", litro: "l", litros: "l",
  ml: "ml",
  sc: "sc", saco: "sc", sacos: "sc",
  bd: "bd", bandeja: "bd", bandejas: "bd",
  gf: "gf", garrafa: "gf", garrafas: "gf",
  lt: "lt", lata: "lt", latas: "lt",
};

/** "Caixa" → "cx"; "KG" → "kg"; desconhecida → limpa (ou nulo, vazia). */
export function unidadeDeCompra(bruta: unknown): string | null {
  const t = String(bruta ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
  if (!t) return null;
  return APELIDOS_DE_UNIDADE[t] || t.slice(0, 8);
}

/** Preço lido de qualquer jeito ("R$ 42,90", "42.9", 42.9). Nulo se não for preço de verdade. */
export function lerPreco(v: unknown): number | null {
  const n = typeof v === "number" ? v : lerNumeroBr(String(v ?? "").replace(/[^\d,.\-]/g, ""));
  if (!Number.isFinite(n) || n <= 0 || n >= 100_000) return null;
  return Math.round(n * 100) / 100;
}

/**
 * As linhas que a IA devolveu, conferidas. Item repetido fica com a ÚLTIMA
 * ocorrência (no encarte, o preço de baixo costuma ser a correção).
 */
export function linhasDaIa(bruto: unknown): LinhaDePreco[] {
  const lista = Array.isArray(bruto) ? bruto : Array.isArray((bruto as any)?.itens) ? (bruto as any).itens : [];
  const porNome = new Map<string, LinhaDePreco>();
  for (const it of lista) {
    const nome = String(it?.nome ?? it?.produto ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    const preco = lerPreco(it?.preco ?? it?.valor);
    if (!nome || preco === null) continue;
    const validade = String(it?.validade ?? "").trim().slice(0, 40) || null;
    const chave = normalizarNome(nome) || nome.toLowerCase();
    porNome.delete(chave);
    porNome.set(chave, { nome, unidade: unidadeDeCompra(it?.unidade), preco, validade });
  }
  return [...porNome.values()].slice(0, 300);
}

/**
 * A mensagem de texto tem cara de tabela de preço? Número com centavos, "R$"
 * ou várias linhas com número. Sem isso, não chama a IA.
 */
export function textoTemPreco(texto: string): boolean {
  const t = String(texto || "");
  if (/r\$\s*\d/i.test(t)) return true;
  if (/\d+[,.]\d{2}\b/.test(t)) return true;
  const linhasComNumero = t.split(/\n/).filter((l) => /[a-zA-ZÀ-ú]{3,}.*\d|\d.*[a-zA-ZÀ-ú]{3,}/.test(l)).length;
  return linhasComNumero >= 3;
}

const TELEFONE_RE = /(\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/;

/**
 * Uma linha por produto: "Tomate kg 10", "10 cx Coca-Cola lata", "Mussarela - kg".
 * A unidade é a primeira palavra que é unidade; o número solto, a quantidade
 * padrão. Linha de título ("HORTIFRUTI:") vira a categoria das de baixo.
 */
export function lerListaDeProdutos(texto: string): ProdutoLido[] {
  const saida: ProdutoLido[] = [];
  let categoria: string | null = null;
  for (const bruta of String(texto || "").split(/\r?\n/)) {
    const linha = bruta.replace(/^[\s\-–•*·\d]+[.)]\s+/, "").replace(/^[\s\-–•*·]+/, "").trim();
    if (!linha) continue;
    if (/:$/.test(linha) && !/\d/.test(linha)) { categoria = linha.replace(/:$/, "").trim().slice(0, 60) || null; continue; }
    // O hífen separa só com espaço em volta ("Cebola - kg"): "Coca-Cola" continua inteiro.
    const pedacos = linha.split(/\s+[-–]\s+|[\s;|]+/).filter((x) => x && x !== "-" && x !== "–");
    let unidade: string | null = null;
    let quantidade: number | null = null;
    const nome: string[] = [];
    for (const p of pedacos) {
      const u = APELIDOS_DE_UNIDADE[p.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "")];
      // "350ml" e "2L" são parte do nome (o tamanho), não a unidade de compra.
      if (!unidade && u && !/\d/.test(p)) { unidade = u; continue; }
      if (quantidade === null && /^\d+([,.]\d+)?$/.test(p)) { quantidade = lerNumeroBr(p); continue; }
      nome.push(p);
    }
    const n = nome.join(" ").trim();
    if (n.length < 2) continue;
    saida.push({ nome: n.charAt(0).toUpperCase() + n.slice(1), unidade: unidade || "un", quantidade, categoria });
  }
  return saida.slice(0, 300);
}

/** Uma linha por fornecedor: o telefone é o número com DDD; antes dele, o nome; depois, o contato. */
export function lerListaDeFornecedores(texto: string): FornecedorLido[] {
  const saida: FornecedorLido[] = [];
  for (const bruta of String(texto || "").split(/\r?\n/)) {
    const linha = bruta.replace(/^[\s\-–•*·]+/, "").trim();
    if (!linha) continue;
    const m = TELEFONE_RE.exec(linha);
    const telefone = m ? m[0].replace(/\D/g, "") : null;
    const antes = (m ? linha.slice(0, m.index) : linha).replace(/[\s\-–:;,|]+$/, "").trim();
    const depois = m ? linha.slice(m.index + m[0].length).replace(/^[\s\-–:;,|]+/, "").trim() : "";
    const nome = antes || depois;
    if (!nome) continue;
    saida.push({ nome: nome.slice(0, 80), telefone, contato: antes && depois ? depois.slice(0, 60) : null });
  }
  return saida.slice(0, 200);
}
