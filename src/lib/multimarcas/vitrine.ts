/**
 * Os dados que a VITRINE do Multimarcas desenha (components/multimarcas/Vitrine.tsx):
 * a página pública /marcas/<slug>, a prévia no editor do dono e o exemplo da
 * página de venda. Sem banco: a tela importa.
 */

export type MarcaDaVitrine = {
  id: string;
  nome: string;
  /** Tipo de comida — vira o filtro da página inicial. */
  tipo: string;
  cor: string;
  logo: string | null;
  capa: string | null;
  /** Nota média dos pedidos com itens da marca; null = ainda sem avaliação ("Nova"). */
  nota: number | null;
  avaliacoes: number;
  aberta: boolean;
  oculta: boolean;
};

export type BannerDaVitrine = {
  id: string;
  titulo: string;
  texto: string;
  imagem: string | null;
  /** Para onde o banner leva: um produto, uma marca ou nada (aviso, cupom). */
  marca: string | null;
  produto?: string | null;
  ativo: boolean;
};

export type ConfigDaVitrine = {
  nome: string;
  frase: string;
  /** Onde entrega, na barra do topo ("Entrega em …"). Vazio = não mostra. */
  local: string;
  cor: string;
  /** Logo da loja no topo da página; sem ela, as iniciais. */
  logo?: string | null;
  /** O que o cartão diz quando a loja está fechada ("Fechada · abre às 18:30"). */
  avisoFechada?: string;
  /** Taxa nula = depende do endereço (a página pública não sabe onde o cliente está). */
  entrega: { taxa: number | null; min: number | null; max: number | null; minimo: number };
  marcas: MarcaDaVitrine[];
  banners: BannerDaVitrine[];
  /** Ids dos produtos da fileira de destaques; vazio = um com foto por marca. */
  destaques?: string[];
};

export type ProdutoDaVitrine = {
  id: string;
  /** Id da marca, ou MARCA_DOS_EXTRAS para o que acompanha qualquer marca. Em mais de uma marca: a primeira. */
  marca: string;
  /**
   * Todas as marcas em que o produto aparece: a categoria pode estar em várias
   * (bebida só em duas das cinco — Lucas, 11/11/2026). Vazio ou ausente = só `marca`.
   */
  marcas?: string[];
  categoria: string;
  nome: string;
  descricao: string;
  preco: number;
  foto: string | null;
};

/** Bebida, sobremesa, porção: categoria que não é de nenhuma marca — aparece em todas e vai na mesma entrega. */
export const MARCA_DOS_EXTRAS = "extras";

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** As marcas do produto (a primeira é `marca`). Para acompanhar: [MARCA_DOS_EXTRAS]. */
export const marcasDoProduto = (p: Pick<ProdutoDaVitrine, "marca" | "marcas">): string[] => (p.marcas?.length ? p.marcas : [p.marca]);

// ─── Contraste ───────────────────────────────────────────────────────────
// A cor é livre (Lucas, 11/11/2026: o amarelo da marca dele). Texto branco em
// cima de amarelo some, e amarelo como texto no fundo branco também.

/** Luminância relativa (WCAG) de "#RRGGBB"; null se não for uma cor assim. */
function luminancia(cor: string): number | null {
  if (!/^#[0-9a-f]{6}$/i.test(cor)) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraComBranco = (l: number) => 1.05 / (l + 0.05);

/** O texto EM CIMA da cor (botão, selo, iniciais): branco, ou escuro quando a cor é clara (amarelo). */
export function textoSobreCor(cor: string): string {
  const l = luminancia(cor);
  return l !== null && contraComBranco(l) < 3 ? "#1F1F23" : "#FFFFFF";
}

/** A cor usada COMO TEXTO no fundo branco (nome da marca, "+"): cor clara escurece até dar para ler. */
export function corParaTexto(cor: string): string {
  if (luminancia(cor) === null) return cor;
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16));
  let atual = cor;
  for (let i = 0; i < 20 && contraComBranco(luminancia(atual)!) < 3; i++) {
    [r, g, b] = [r, g, b].map((c) => Math.round(c * 0.9));
    atual = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }
  return atual;
}
