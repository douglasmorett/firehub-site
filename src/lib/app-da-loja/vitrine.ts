/**
 * AS FOTOS DE VITRINE da página "Aplicativo da loja" (/store/aplicativo): o
 * celular de demonstração e a galeria usam os pratos do próprio cardápio; sem
 * foto suficiente, os da Hakim (Douglas, 17/10/2026: "pode usar as fotos da Hakim").
 */
/** Categoria que não é vitrine: limão, água e molho não vendem aplicativo. */
const NAO_E_VITRINE = /bebida|refri|acompanh|adiciona|molho|extra|opcion|complement|insumo|oculto|ifood|jotaj/i;

type ItemComFoto = { name: string; price: number; imageUrl: string | null; category: string };

/**
 * Os pratos de vitrine para o celular e a galeria: do mais caro para o mais
 * barato, alternando as categorias (combo, esfirra, pizza…), sem repetir nome.
 */
export function pratosDeVitrine(itens: ItemComFoto[], quantos = 8) {
  const bons = itens
    .filter((i) => i.imageUrl && i.price >= 5 && !NAO_E_VITRINE.test(i.category))
    .sort((a, b) => b.price - a.price);
  const porCategoria = new Map<string, ItemComFoto[]>();
  for (const i of bons) porCategoria.set(i.category, [...(porCategoria.get(i.category) || []), i]);
  const filas = [...porCategoria.values()];
  const escolhidos: ItemComFoto[] = [];
  const nomes = new Set<string>();
  for (let rodada = 0; escolhidos.length < quantos && filas.some((f) => f.length > rodada); rodada++) {
    for (const fila of filas) {
      const i = fila[rodada];
      if (i && !nomes.has(i.name) && escolhidos.length < quantos) { nomes.add(i.name); escolhidos.push(i); }
    }
  }
  return escolhidos.map((i) => ({ nome: i.name, preco: i.price, foto: i.imageUrl as string, categoria: i.category }));
}

