import type { ItemDaNota } from "./fiscal-emissao";
import { ratearEmCentavos } from "./rateio";

// Reexportado para quem já importava daqui.
export { ratearEmCentavos };

/**
 * /src/lib/fiscal-itens.ts
 *
 * Transforma os itens do pedido nas LINHAS da nota fiscal — inclusive abrindo
 * os combos.
 *
 * ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
 *
 * A "Engenharia de Cardápio Fiscal" é vendida na home ("sai detalhado na nota
 * fiscal, maximizando a isenção de PIS e COFINS monofásico") e repetida na FAQ
 * da tela fiscal. O lojista abre o combo, informa que dentro dele vão um lanche
 * e um refrigerante, dá o NCM de cada um, e a tela responde "🟢 Engenharia
 * Discriminada Ativa".
 *
 * Só que `fiscalBreakdown` era apenas GRAVADO e EXIBIDO. Nenhum arquivo da
 * emissão sequer mencionava o campo: a nota saía com o combo em linha única,
 * com o NCM do combo. O lojista configurava, via o selo verde e recebia uma
 * nota que não tinha nada daquilo — pagando o imposto que a discriminação
 * existia justamente para evitar.
 *
 * ── POR QUE O RATEIO É OBRIGATÓRIO ──────────────────────────────────────────
 *
 * Os preços do breakdown são o valor "de tabela" de cada parte. O combo quase
 * sempre é vendido por MENOS que a soma das partes — é isso que faz dele um
 * combo. Jogar os preços do breakdown direto na nota faria o somatório dos
 * itens não bater com o total cobrado, e a SEFAZ rejeita por isso (regra 610:
 * "valor total difere do somatório dos itens").
 *
 * Então as partes entram RATEADAS na proporção que o lojista configurou, e a
 * sobra de arredondamento vai para a maior linha — a que absorve centavo sem
 * distorcer percentual. O total da nota continua exatamente o que o cliente
 * pagou; o que muda é como ele aparece discriminado.
 */

export type ProdutoDoItem = {
  id?: string | null;
  name?: string | null;
  isCombo?: boolean | null;
  fiscalBreakdown?: unknown;
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  origem?: string | null;
  csosn?: string | null;
  pis?: string | null;
  cofins?: string | null;
};

export type ItemDoPedido = {
  id: string;
  productName?: string | null;
  quantity: number;
  price: number;
  menuProduct?: ProdutoDoItem | null;
};

type ParteDoCombo = {
  name: string;
  price: number;
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  origem?: string | number | null;
  csosn?: string | null;
  pis?: string | null;
  cofins?: string | null;
};

/** O breakdown é JSON livre no banco. Só passa o que tem nome e preço usável. */
function lerBreakdown(bruto: unknown): ParteDoCombo[] {
  if (!Array.isArray(bruto)) return [];
  const partes: ParteDoCombo[] = [];
  for (const p of bruto) {
    if (!p || typeof p !== "object") continue;
    const nome = String((p as any).name ?? "").trim();
    const preco = Number((p as any).price);
    if (!nome || !Number.isFinite(preco) || preco < 0) continue;
    partes.push({
      name: nome,
      price: preco,
      ncm: (p as any).ncm ?? null,
      cest: (p as any).cest ?? null,
      cfop: (p as any).cfop ?? null,
      origem: (p as any).origem ?? null,
      csosn: (p as any).csosn ?? null,
      pis: (p as any).pis ?? null,
      cofins: (p as any).cofins ?? null,
    });
  }
  return partes;
}

/**
 * As linhas da nota, com os combos abertos quando houver discriminação.
 *
 * Um combo SEM `fiscalBreakdown` continua indo em linha única — é o que o
 * lojista configurou, e inventar uma abertura que ele não pediu seria pior que
 * não abrir.
 */
export function montarItensDaNota(itensDoPedido: ItemDoPedido[]): ItemDaNota[] {
  const linhas: ItemDaNota[] = [];

  for (const item of itensDoPedido) {
    const p = item.menuProduct;
    const situacaoDoProduto = String(p?.csosn ?? "").trim();

    const linhaSimples = (): ItemDaNota => ({
      codigo: p?.id ?? item.id,
      descricao: item.productName || p?.name || "Item",
      ncm: p?.ncm ?? "",
      cest: p?.cest ?? null,
      cfop: p?.cfop ?? "5102",
      unidadeComercial: "UN",
      quantidade: item.quantity,
      valorUnitario: item.price,
      valorTotal: item.price * item.quantity,
      origem: Number(p?.origem ?? 0) || 0,
      csosn: situacaoDoProduto || null,
      cst: situacaoDoProduto.length === 2 ? situacaoDoProduto : null,
      pis: p?.pis ?? null,
      cofins: p?.cofins ?? null,
    });

    const partes = p?.isCombo ? lerBreakdown(p?.fiscalBreakdown) : [];
    if (partes.length === 0) {
      linhas.push(linhaSimples());
      continue;
    }

    // O rateio é feito sobre o PREÇO UNITÁRIO do combo, não sobre o total.
    //
    // Isso não é detalhe de estilo: a SEFAZ confere item a item que
    // `valor_bruto = quantidade × valor_unitario`. Ratear o total e depois
    // dividir pela quantidade produz dízima (7,51 ÷ 2 = 3,755) que arredonda
    // para 3,76 e faz a linha não fechar consigo mesma. Rateando o unitário em
    // centavos inteiros, cada linha fecha, e a soma das linhas dá exatamente o
    // que o cliente pagou.
    const unitarios = ratearEmCentavos(
      Number(item.price.toFixed(2)),
      partes.map((parte) => parte.price)
    );

    // Parte que ficou em R$ 0,00 (combo barato dividido em muitas partes) não
    // vira linha de nota. Nesse caso a discriminação não cabe no valor, e sair
    // com item de valor zero é pior que sair em linha única.
    if (unitarios.some((v) => v <= 0)) {
      linhas.push(linhaSimples());
      continue;
    }

    partes.forEach((parte, i) => {
      // Toda parte fica com quantidade = a do combo vendido: 2 combos viram
      // 2 lanches e 2 refrigerantes, não 1 de cada.
      const quantidade = item.quantity;
      const valorUnitario = unitarios[i];
      const valorTotal = Number((valorUnitario * quantidade).toFixed(2));
      const situacaoDaParte = String(parte.csosn ?? situacaoDoProduto ?? "").trim();

      linhas.push({
        codigo: `${p?.id ?? item.id}-${i + 1}`,
        // O nome do combo fica junto: na DANFE o cliente precisa reconhecer o
        // que comprou, e "Refrigerante 350ml" solto não diz que veio do combo.
        descricao: `${parte.name} (${item.productName || p?.name || "Combo"})`.slice(0, 120),
        ncm: String(parte.ncm ?? p?.ncm ?? ""),
        cest: parte.cest ?? p?.cest ?? null,
        cfop: String(parte.cfop ?? p?.cfop ?? "5102"),
        unidadeComercial: "UN",
        quantidade,
        valorUnitario,
        valorTotal,
        origem: Number(parte.origem ?? p?.origem ?? 0) || 0,
        csosn: situacaoDaParte || null,
        cst: situacaoDaParte.length === 2 ? situacaoDaParte : null,
        pis: parte.pis ?? p?.pis ?? null,
        cofins: parte.cofins ?? p?.cofins ?? null,
      });
    });
  }

  return linhas;
}
