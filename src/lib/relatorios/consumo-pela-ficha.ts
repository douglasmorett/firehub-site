/**
 * O CONSUMO DE INSUMO PELAS VENDAS × A FICHA TÉCNICA DE HOJE — a base da
 * Lista de compras (sugestao-de-compras.ts) e da Previsão de insumos
 * (previsao-de-insumos.ts).
 *
 * ── Por que não as baixas gravadas, como o Itens consumidos ─────────────────
 *
 * O Itens consumidos olha para TRÁS e usa a baixa que o estoque gravou (a
 * ficha da hora da venda). Aqui a pergunta é para a FRENTE: quanto vou gastar
 * na semana que vem? Isso se responde com a receita de hoje sobre o ritmo de
 * vendas das últimas semanas. E a loja que acabou de cadastrar a ficha (a
 * Hambúrgueria Avenida, 86 insumos gravados em 06/11/2026) já tem a lista de
 * compras no primeiro dia, sem esperar semanas de baixa acumular.
 *
 * A resolução do item é a do custo pela ficha (lib/financeiro/
 * custo-pela-ficha.ts, `consumoDoItem`): ficha do produto, espelho do
 * iFood/99 pelo nome, opções do combo × quantidade da opção.
 *
 * ── Preparo (massa, recheio) ────────────────────────────────────────────────
 *
 * O preparo com receita é feito na cozinha, não comprado: o que ele gasta
 * desce para os insumos dele (`explodirPreparo`, lib/cmv/custo-do-insumo.ts)
 * — 1.315 g de recheio puxam 1 kg de carne para a lista. O próprio preparo
 * fica numa lista à parte, "para produzir".
 *
 * Puro (sem banco). Testado em scripts/teste-sugestao-de-compras.ts.
 */
import { explodirPreparo, ehPreparo, type InsumoParaCusto } from "@/lib/cmv/custo-do-insumo";
import { consumoDoItem, type Catalogo, type ItemParaCusto } from "@/lib/financeiro/custo-pela-ficha";
import { naLoja } from "@/lib/relatorios/base";

export type PedidoParaConsumo = { createdAt: Date | string; items: ItemParaCusto[] };

export type ConsumoPorDia = {
  /** dia operacional → insumoId → quantidade (direto da ficha, sem descer o preparo). */
  porDia: Map<string, Map<string, number>>;
  /** Os produtos vendidos que não gastaram insumo nenhum na conta (sem ficha), com a quantidade. */
  semFicha: Map<string, number>;
  /** Itens com opção escolhida sem ficha: o consumo deles saiu menor. */
  incompletos: number;
};

/** Soma o consumo de cada pedido no dia operacional dele (vira às 5h, fuso da loja). */
export function consumoPorDia(pedidos: PedidoParaConsumo[], cat: Catalogo, tz: string, acumulado?: ConsumoPorDia): ConsumoPorDia {
  const saida: ConsumoPorDia = acumulado ?? { porDia: new Map(), semFicha: new Map(), incompletos: 0 };
  for (const p of pedidos) {
    const dia = naLoja(p.createdAt instanceof Date ? p.createdAt : new Date(p.createdAt), tz).dia;
    let doDia = saida.porDia.get(dia);
    for (const item of p.items || []) {
      if (!(Number(item.quantidade) > 0)) continue;
      const c = consumoDoItem(item, cat);
      if (c.semFicha) { saida.semFicha.set(c.nome, (saida.semFicha.get(c.nome) || 0) + Number(item.quantidade)); continue; }
      if (c.incompleto) saida.incompletos++;
      if (!doDia) { doDia = new Map(); saida.porDia.set(dia, doDia); }
      for (const [id, q] of c.insumos) doDia.set(id, (doDia.get(id) || 0) + q);
    }
  }
  return saida;
}

/** O preparo que a cozinha produz: tem receita e rendimento. Sem receita, ele é tratado como comprado. */
export const ehPreparoComReceita = (i: Pick<InsumoParaCusto, "tipo" | "componentes" | "rendimento">) =>
  ehPreparo(i) && i.componentes.length > 0 && Number(i.rendimento) > 0;

/**
 * Separa o consumo direto em COMPRADOS (com o que os preparos gastam, descido
 * até o insumo de verdade) e PREPAROS (o que a cozinha tem de produzir).
 */
export function separarPreparos(direto: Map<string, number>, insumos: InsumoParaCusto[]): { comprados: Map<string, number>; preparos: Map<string, number> } {
  const porId = new Map(insumos.map((i) => [i.id, i]));
  const comprados = new Map<string, number>();
  const preparos = new Map<string, number>();
  const somar = (m: Map<string, number>, id: string, q: number) => m.set(id, (m.get(id) || 0) + q);
  for (const [id, q] of direto) {
    const i = porId.get(id);
    if (!i || !ehPreparoComReceita(i)) { somar(comprados, id, q); continue; }
    somar(preparos, id, q);
    for (const [folha, qf] of explodirPreparo(insumos, id, q)) somar(comprados, folha, qf);
  }
  return { comprados, preparos };
}

/** Soma os dias num total por insumo. */
export function totalDosDias(porDia: Map<string, Map<string, number>>, dias?: Iterable<string>): Map<string, number> {
  const total = new Map<string, number>();
  const lista = dias ? [...dias] : [...porDia.keys()];
  for (const d of lista) for (const [id, q] of porDia.get(d) || []) total.set(id, (total.get(id) || 0) + q);
  return total;
}

/** "5,2 kg" no lugar de "5.200 g": o lojista compra queijo em quilo. Unidade sem família fica como está. */
export function quantidadeLegivel(q: number, unidade: string): string {
  const fmt = (n: number, casas = 2) => (Math.round(n * 10 ** casas) / 10 ** casas).toLocaleString("pt-BR", { maximumFractionDigits: casas });
  const u = String(unidade || "un").toLowerCase();
  if (u === "g" && Math.abs(q) >= 1000) return `${fmt(q / 1000)} kg`;
  if (u === "ml" && Math.abs(q) >= 1000) return `${fmt(q / 1000)} l`;
  return `${fmt(q, u === "g" || u === "ml" ? 0 : 2)} ${u}`;
}
