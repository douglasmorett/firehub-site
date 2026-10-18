import { PRODUTOS_DA_REDE, type ProdutoDaRede } from "./previa-dados";

/**
 * PRÉVIA da vitrine da rede (Lucas / Frangoso - Trindade, 17/10/2026).
 *
 * Várias marcas na MESMA cozinha: o cliente entra numa, põe no carrinho, entra
 * em outra, põe mais, e fecha UM pedido com UMA entrega. Por isso a marca aqui
 * não é uma loja (User) do FireHub — é um conjunto de categorias do cardápio
 * da mesma loja. As 5 marcas do iFood do Lucas já caem todas na Frangoso.
 *
 * Nesta prévia a config mora no localStorage (o painel grava, a vitrine lê).
 * Na versão de verdade ela vira uma coluna da loja, como `paginaDoGrupo`.
 */

export type MarcaDaRede = {
  id: string;
  nome: string;
  /** Tipo de comida — vira o filtro da página inicial. */
  tipo: string;
  /** Uma linha embaixo do nome no cartão. */
  frase: string;
  cor: string;
  logo: string | null;
  capa: string | null;
  /** Nota de EXEMPLO; na versão real sai das avaliações dos pedidos. */
  nota: number;
  avaliacoes: number;
  aberta: boolean;
  oculta: boolean;
};

export type BannerDaRede = {
  id: string;
  titulo: string;
  texto: string;
  imagem: string | null;
  /** Para onde o banner leva: uma marca ou nada. */
  marca: string | null;
  ativo: boolean;
};

export type ConfigDaRede = {
  nome: string;
  frase: string;
  cor: string;
  entrega: { taxa: number; min: number; max: number; minimo: number };
  marcas: MarcaDaRede[];
  banners: BannerDaRede[];
};

/** Bebida, sobremesa, porção: aparecem dentro de toda marca e vão na mesma entrega. */
export const MARCA_DOS_EXTRAS = "extras";

const foto = (nome: string) => PRODUTOS_DA_REDE.find((p) => p.nome === nome)?.foto ?? null;

export const CONFIG_PADRAO: ConfigDaRede = {
  nome: "Rede Trindade",
  frase: "Várias lojas, uma cozinha. Peça de todas e pague uma entrega só.",
  cor: "#E8590C",
  entrega: { taxa: 5.99, min: 35, max: 50, minimo: 25 },
  marcas: [
    {
      id: "salzburg", nome: "Salzburg Hamburgueria", tipo: "Hambúrguer", frase: "Burguers artesanais",
      cor: "#1F1F23", logo: null, capa: foto("SalzBurg"), nota: 4.8, avaliacoes: 412, aberta: true, oculta: false,
    },
    {
      id: "frangoso", nome: "Frangoso", tipo: "Frango", frase: "Frango frito no box",
      cor: "#F08C00", logo: null, capa: foto("Box de Frango M + molho"), nota: 4.7, avaliacoes: 538, aberta: true, oculta: false,
    },
    {
      id: "braseou", nome: "Braseou! Burguers na Brasa", tipo: "Hambúrguer", frase: "Burguer na brasa e combos",
      cor: "#C92A2A", logo: null, capa: foto("Duplo Cheddar e Bacon"), nota: 4.6, avaliacoes: 287, aberta: true, oculta: false,
    },
    {
      id: "refeicoes", nome: "Refeições a partir de 18,99", tipo: "Marmita", frase: "Prato feito todo dia",
      cor: "#2B8A3E", logo: null, capa: null, nota: 4.5, avaliacoes: 96, aberta: true, oculta: false,
    },
    {
      id: "feijao", nome: "Feijão com Amor", tipo: "Feijoada", frase: "Feijoada, baião e tropeiro",
      cor: "#7C4A1E", logo: null, capa: null, nota: 4.9, avaliacoes: 61, aberta: false, oculta: false,
    },
  ],
  banners: [
    {
      id: "b1", titulo: "2 Burguers por R$ 29,99", texto: "Só hoje no Salzburg", imagem: foto("2 Burguers por 29,99"),
      marca: "salzburg", ativo: true,
    },
    {
      id: "b2", titulo: "Frango no Box a partir de R$ 21", texto: "Com acompanhamento e molho", imagem: foto("Box de Frango P (250g) + Acompanhamento (250g)+ Molhos"),
      marca: "frangoso", ativo: true,
    },
    {
      id: "b3", titulo: "Monte seu pedido com várias lojas", texto: "Um burguer daqui, um frango dali — uma entrega só", imagem: foto("2 Burguers + 1 Box de Frango P (250g)"),
      marca: null, ativo: true,
    },
  ],
};

export const CHAVE_DA_CONFIG = "firehub-rede-previa-config";
export const CHAVE_DA_SACOLA = "firehub-rede-previa-sacola";

export function lerConfig(): ConfigDaRede {
  try {
    const bruto = localStorage.getItem(CHAVE_DA_CONFIG);
    if (!bruto) return CONFIG_PADRAO;
    const c = JSON.parse(bruto) as Partial<ConfigDaRede>;
    if (!c || !Array.isArray(c.marcas) || !Array.isArray(c.banners)) return CONFIG_PADRAO;
    return { ...CONFIG_PADRAO, ...c, entrega: { ...CONFIG_PADRAO.entrega, ...(c.entrega || {}) } } as ConfigDaRede;
  } catch {
    return CONFIG_PADRAO;
  }
}

export function gravarConfig(c: ConfigDaRede) {
  try {
    localStorage.setItem(CHAVE_DA_CONFIG, JSON.stringify(c));
  } catch {}
}

export function produtosDaMarca(marca: string): ProdutoDaRede[] {
  return PRODUTOS_DA_REDE.filter((p) => p.marca === marca);
}

export function produtosExtras(): ProdutoDaRede[] {
  return PRODUTOS_DA_REDE.filter((p) => p.marca === MARCA_DOS_EXTRAS);
}

/** A partir de quanto a marca vende — o "a partir de R$" do cartão. */
export function precoInicial(marca: string): number | null {
  const ps = produtosDaMarca(marca);
  return ps.length ? Math.min(...ps.map((p) => p.preco)) : null;
}

export function fotosDisponiveis(): { nome: string; foto: string }[] {
  return PRODUTOS_DA_REDE.filter((p) => p.foto).map((p) => ({ nome: p.nome, foto: p.foto! }));
}

export const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
