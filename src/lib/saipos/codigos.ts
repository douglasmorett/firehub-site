/**
 * lib/saipos/codigos.ts — o código PDV de cada item e opção, tirado do cardápio da loja no Saipos.
 *
 * A API de Pedidos do Saipos (FireHub → Saipos) exige o `integration_code` em
 * cada item e em cada complemento. O código vem do cardápio dela
 * (GET /v2/catalog, o arquivo JSON do link): um registro PRATO por item e um
 * COMPLEMENTO por opção, com `codigo_saipos` ("12606018" no item,
 * "12606018.12326242" na opção — o prefixo é o item dono).
 *
 * Casamos por NOME, sem acento nem caixa nem pontuação. A loja que copiou o
 * cardápio de um para o outro costuma ter nomes iguais; o que não casar o
 * admin vê na lista de "sem código" e a loja acerta o nome de um dos lados.
 *
 * Puro: não lê banco nem rede.
 */

export type LinhaDoCatalogo = {
  tipo?: string | null; // "PRATO" | "COMPLEMENTO"
  categoria?: string | null;
  tamanho?: string | null;
  item?: string | null;
  complemento?: string | null;
  complemento_item?: string | null;
  codigo_saipos?: string | number | null;
  store_item_enabled?: string | null;
  store_choice_enabled?: string | null;
  store_choice_item_enabled?: string | null;
};

/** Nome comparável: sem acento, caixa, pontuação e espaço sobrando. */
export function normalizar(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type IndiceDoCatalogo = {
  /** nome normalizado do item (e "item tamanho") → códigos do item. */
  pratos: Map<string, string[]>;
  /** código do item → (nome normalizado da opção → código). */
  opcoesDoPrato: Map<string, Map<string, string>>;
  /** nome normalizado da opção → códigos, em qualquer item (quando o item não casou). */
  opcoesSoltas: Map<string, string[]>;
  totalDePratos: number;
  totalDeOpcoes: number;
};

const ativo = (v: unknown) => v == null || String(v).toUpperCase() !== "N";
const empurra = (m: Map<string, string[]>, k: string, v: string) => {
  const l = m.get(k);
  if (!l) m.set(k, [v]);
  else if (!l.includes(v)) l.push(v);
};

export function indiceDoCatalogo(linhas: ReadonlyArray<LinhaDoCatalogo>): IndiceDoCatalogo {
  const pratos = new Map<string, string[]>();
  const opcoesDoPrato = new Map<string, Map<string, string>>();
  const opcoesSoltas = new Map<string, string[]>();
  let totalDePratos = 0;
  let totalDeOpcoes = 0;

  for (const l of linhas || []) {
    const codigo = String(l?.codigo_saipos ?? "").trim();
    if (!codigo) continue;
    const tipo = String(l?.tipo || "").toUpperCase();
    if (tipo === "PRATO") {
      if (!ativo(l.store_item_enabled)) continue;
      const nome = normalizar(l.item);
      if (!nome) continue;
      totalDePratos++;
      empurra(pratos, nome, codigo);
      const tam = normalizar(l.tamanho);
      // "Único" é o tamanho de quem não tem tamanho: não entra no nome.
      if (tam && tam !== "unico") empurra(pratos, `${nome} ${tam}`, codigo);
    } else if (tipo === "COMPLEMENTO") {
      if (!ativo(l.store_item_enabled) || !ativo(l.store_choice_enabled) || !ativo(l.store_choice_item_enabled)) continue;
      const nome = normalizar(l.complemento_item);
      if (!nome) continue;
      totalDeOpcoes++;
      const dono = codigo.includes(".") ? codigo.slice(0, codigo.indexOf(".")) : "";
      if (dono) {
        let m = opcoesDoPrato.get(dono);
        if (!m) opcoesDoPrato.set(dono, (m = new Map()));
        if (!m.has(nome)) m.set(nome, codigo);
      }
      empurra(opcoesSoltas, nome, codigo);
    }
  }
  return { pratos, opcoesDoPrato, opcoesSoltas, totalDePratos, totalDeOpcoes };
}

/** O código do item pelos nomes que ele pode ter (o do pedido e o do cardápio), ou null se não casa/for ambíguo. */
export function codigoDoItem(indice: IndiceDoCatalogo, nomes: ReadonlyArray<string | null | undefined>): string | null {
  for (const n of nomes) {
    const l = indice.pratos.get(normalizar(n));
    if (l && l.length === 1) return l[0];
  }
  return null;
}

/** O código da opção: primeiro entre as do item, depois em qualquer item se o nome é único. */
export function codigoDaOpcao(indice: IndiceDoCatalogo, codigoDoItemPai: string | null, nome: string | null | undefined): string | null {
  const chave = normalizar(nome);
  if (!chave) return null;
  const dono = codigoDoItemPai ? indice.opcoesDoPrato.get(codigoDoItemPai) : null;
  const doItem = dono?.get(chave);
  if (doItem) return doItem;
  const solta = indice.opcoesSoltas.get(chave);
  return solta && solta.length === 1 ? solta[0] : null;
}

/** Quantos itens do cardápio do FireHub casam com o catálogo — o que o admin mostra ao ligar. */
export function relatorioDoCasamento(
  indice: IndiceDoCatalogo,
  produtos: ReadonlyArray<{ name: string; apenasEmCombo?: boolean | null }>,
): { casaram: string[]; semCodigo: string[]; opcoesSemCodigo: string[] } {
  const casaram: string[] = [];
  const semCodigo: string[] = [];
  const opcoesSemCodigo: string[] = [];
  for (const p of produtos) {
    if (p.apenasEmCombo) {
      if (!codigoDaOpcao(indice, null, p.name) && !indice.opcoesSoltas.has(normalizar(p.name))) opcoesSemCodigo.push(p.name);
      continue;
    }
    (codigoDoItem(indice, [p.name]) ? casaram : semCodigo).push(p.name);
  }
  return { casaram, semCodigo, opcoesSemCodigo };
}
