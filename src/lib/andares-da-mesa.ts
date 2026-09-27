/**
 * /src/lib/andares-da-mesa.ts
 *
 * ANDARES DO SALÃO: quais mesas estão em cada piso e qual impressora é dele.
 *
 * Pedido do dono (27/09/2026): "quem tem mais de um andar dá o nome — Piso 1,
 * Piso 2 — e escolhe quais mesas estão naquele andar. Normalmente tem uma
 * impressora em cada andar: no térreo as mesas de 1 a 30 saem na impressora B,
 * no segundo andar as de 31 a 60 saem na C."
 *
 * Mora em `printerConfig.andares` e só a tela de Mesas grava (a de Impressoras
 * nunca manda esta chave, e o PUT mescla por chave). Roda no servidor (fila da
 * nuvem) e no navegador (painel aberto): sem Prisma aqui.
 *
 * A REGRA DA IMPRESSORA, uma só para os dois caminhos:
 *   • impressora que NENHUM andar escolheu não muda nada (a cozinha que atende
 *     o prédio inteiro continua recebendo de todas as mesas);
 *   • impressora escolhida por algum andar só recebe o pedido — e a conta — das
 *     mesas DAQUELE andar;
 *   • pedido que não é de mesa (delivery, balcão) não passa por aqui.
 * O que cada impressora imprime (categorias, só bebida) continua sendo da tela
 * de Impressoras: o andar escolhe ONDE, não O QUÊ.
 */

export type AndarDaMesa = {
  id: string;
  nome: string;
  /** "1-30", "1 a 30, 45", "31-60" — como o dono escreveria. */
  mesas: string;
  /** Ids das impressoras (printerConfig.printers[].id) que imprimem este andar. */
  impressoras: string[];
};

const MAX_ANDARES = 20;
const MAX_MESA = 9999;

/** "1-30, 45, 50 a 55" → {1..30, 45, 50..55}. Lixo é ignorado. */
export function numerosDaFaixa(texto: unknown): Set<number> {
  const saida = new Set<number>();
  for (const pedaco of String(texto ?? "").split(/[,;\n]+/)) {
    const m = pedaco.trim().match(/^(\d{1,4})\s*(?:(?:-|–|a|até|ate)\s*(\d{1,4}))?$/i);
    if (!m) continue;
    let de = Number(m[1]);
    let ate = m[2] != null ? Number(m[2]) : de;
    if (ate < de) [de, ate] = [ate, de];
    if (ate - de > MAX_MESA) continue;
    for (let n = de; n <= ate && n <= MAX_MESA; n++) saida.add(n);
  }
  return saida;
}

/** O que está gravado, limpo: nunca confia no formato de fora. */
export function lerAndares(cfg: unknown): AndarDaMesa[] {
  const lista = (cfg as { andares?: unknown } | null | undefined)?.andares;
  if (!Array.isArray(lista)) return [];
  const vistos = new Set<string>();
  const saida: AndarDaMesa[] = [];
  for (const a of lista.slice(0, MAX_ANDARES)) {
    if (!a || typeof a !== "object") continue;
    const bruto = a as Record<string, unknown>;
    const id = String(bruto.id ?? "").trim().slice(0, 40);
    const nome = String(bruto.nome ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!id || !nome || vistos.has(id)) continue;
    vistos.add(id);
    saida.push({
      id,
      nome,
      mesas: String(bruto.mesas ?? "").trim().slice(0, 200),
      impressoras: Array.isArray(bruto.impressoras)
        ? [...new Set(bruto.impressoras.map((x) => String(x ?? "").trim()).filter(Boolean))].slice(0, 20)
        : [],
    });
  }
  return saida;
}

/** O andar da mesa (o PRIMEIRO que a lista, se duas faixas se cruzarem). */
export function andarDaMesa(andares: AndarDaMesa[], numero: unknown): AndarDaMesa | null {
  const n = Number(String(numero ?? "").trim());
  if (!Number.isInteger(n) || n <= 0) return null;
  for (const a of andares) if (numerosDaFaixa(a.mesas).has(n)) return a;
  return null;
}

/**
 * As impressoras que podem receber o papel desta mesa. `numeroDaMesa` vazio
 * (pedido que não é de mesa) ou nenhum andar com impressora: a lista volta
 * inteira. Mesa fora de todo andar: só as impressoras sem andar.
 */
export function impressorasDoAndar<T extends { id?: string | number | null }>(
  printers: T[],
  andares: AndarDaMesa[],
  numeroDaMesa: unknown
): T[] {
  if (!numeroDaMesa || String(numeroDaMesa).trim() === "") return printers;
  const deAlgumAndar = new Set(andares.flatMap((a) => a.impressoras));
  if (deAlgumAndar.size === 0) return printers;
  const andar = andarDaMesa(andares, numeroDaMesa);
  const doAndar = new Set(andar?.impressoras || []);
  return printers.filter((p) => {
    const id = String(p?.id ?? "");
    return !deAlgumAndar.has(id) || doAndar.has(id);
  });
}
