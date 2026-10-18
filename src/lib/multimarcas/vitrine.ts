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
  /** Para onde o banner leva: uma marca ou nada. */
  marca: string | null;
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
};

export type ProdutoDaVitrine = {
  id: string;
  /** Id da marca, ou MARCA_DOS_EXTRAS para o que acompanha qualquer marca. */
  marca: string;
  categoria: string;
  nome: string;
  descricao: string;
  preco: number;
  foto: string | null;
};

/** Bebida, sobremesa, porção: categoria que não é de nenhuma marca — aparece em todas e vai na mesma entrega. */
export const MARCA_DOS_EXTRAS = "extras";

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
