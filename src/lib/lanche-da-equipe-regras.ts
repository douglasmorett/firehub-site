/**
 * As regras do lanche dos motoboys sem banco — a tela e o servidor fazem a
 * MESMA conta (lib/lanche-da-equipe.ts explica o resto).
 */
/** As lojas que têm a tela. É da Hakim Centro, não do FireHub (Douglas, 11/10/2026). */
export const LOJAS_COM_LANCHE_DA_EQUIPE = new Set(["cmpx96phr0000ujf0sb0qk5vr"]);

export const SOURCE_DO_LANCHE = "EQUIPE";
export const FORMA_DO_LANCHE = "Conta Funcionário (acerto do motoboy)";

export type ConfigDoLanche = {
  ativo: boolean;
  /** R$ por dia, por motoboy, a preço do site. */
  limite: number;
};

export const LANCHE_PADRAO: ConfigDoLanche = { ativo: false, limite: 22.9 };

const centavos = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

export function lerConfigDoLanche(bruto: unknown): ConfigDoLanche {
  const cfg = { ...LANCHE_PADRAO };
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) {
    const o = bruto as Record<string, unknown>;
    if (typeof o.ativo === "boolean") cfg.ativo = o.ativo;
    const limite = Number(o.limite);
    if (o.limite != null && Number.isFinite(limite) && limite >= 0) cfg.limite = Math.min(500, centavos(limite));
  }
  return cfg;
}

const semAcento = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** A "Promoção do Dia" (a isca de R$ 1,90): pela categoria ou pela etiqueta. */
export function ehPromocaoDoDia(produto: { category?: string | null; tags?: unknown }): boolean {
  if (semAcento(produto.category) === "promocao do dia") return true;
  let tags: unknown = produto.tags;
  if (typeof tags === "string") {
    try { tags = JSON.parse(tags); } catch { tags = [tags]; }
  }
  return Array.isArray(tags) && tags.some((t) => semAcento(t) === "promocao do dia");
}

/**
 * Quanto deste pedido cabe no limite do dia e quanto passa.
 * `jaUsado` = o que o motoboy já pediu hoje (pedidos não cancelados).
 */
export function dividirNoLimite(jaUsado: number, valor: number, limite: number): { coberto: number; excedente: number; restanteDepois: number } {
  const livre = Math.max(0, centavos(limite) - centavos(jaUsado));
  const coberto = centavos(Math.min(livre, Math.max(0, valor)));
  const excedente = centavos(Math.max(0, valor) - coberto);
  return { coberto, excedente, restanteDepois: centavos(livre - coberto) };
}

