import type { ConfigDaVitrine, ProdutoDaVitrine } from "./vitrine";

/**
 * A rede FICTÍCIA da demonstração na página de venda do Multimarcas: marcas,
 * preços e notas inventados; fotos geradas para isto (public/multimarcas/).
 * Nunca usar aqui marca, foto ou cardápio de loja de verdade — a página é
 * vista por todos os lojistas.
 */
const f = (nome: string) => `/multimarcas/${nome}.webp`;

export const CONFIG_DO_EXEMPLO: ConfigDaVitrine = {
  nome: "Cozinha Central",
  frase: "Cinco marcas, uma cozinha. Peça de todas e pague uma entrega só.",
  local: "toda a região",
  cor: "#E8590C",
  entrega: { taxa: 5.99, min: 30, max: 45, minimo: 20 },
  marcas: [
    { id: "smash", nome: "Smash da Vila", tipo: "Hambúrguer", cor: "#1F1F23", logo: null, capa: f("smash"), nota: 4.8, avaliacoes: 326, aberta: true, oculta: false },
    { id: "frango", nome: "Box do Frango", tipo: "Frango", cor: "#F08C00", logo: null, capa: f("frango-box"), nota: 4.7, avaliacoes: 418, aberta: true, oculta: false },
    { id: "pizza", nome: "Forno da Praça", tipo: "Pizza", cor: "#C92A2A", logo: null, capa: f("pizza"), nota: 4.9, avaliacoes: 207, aberta: true, oculta: false },
    { id: "marmita", nome: "Marmita da Casa", tipo: "Marmita", cor: "#2B8A3E", logo: null, capa: f("marmita"), nota: 4.6, avaliacoes: 154, aberta: true, oculta: false },
    { id: "acai", nome: "Açaí Tropical", tipo: "Açaí", cor: "#7048E8", logo: null, capa: f("acai"), nota: 4.8, avaliacoes: 98, aberta: false, oculta: false },
  ],
  banners: [
    { id: "b1", titulo: "Smash em dobro por R$ 29,90", texto: "Só hoje no Smash da Vila", imagem: f("smash-bacon"), marca: "smash", ativo: true },
    { id: "b2", titulo: "Pizza grande a partir de R$ 39,90", texto: "Forno da Praça, direto do forno a lenha", imagem: f("pizza-calabresa"), marca: "pizza", ativo: true },
    { id: "b3", titulo: "Um burguer daqui, um frango dali", texto: "Tudo na mesma sacola, numa entrega só", imagem: f("frango-box"), marca: null, ativo: true },
  ],
};

const p = (id: string, marca: string, categoria: string, nome: string, descricao: string, preco: number, foto: string | null = null): ProdutoDaVitrine =>
  ({ id, marca, categoria, nome, descricao, preco, foto: foto ? f(foto) : null });

export const PRODUTOS_DO_EXEMPLO: ProdutoDaVitrine[] = [
  p("s1", "smash", "Destaques", "Smash em dobro", "Dois smash de 90 g, cheddar e molho da casa", 29.9, "smash"),
  p("s2", "smash", "Burguers", "Smash bacon", "Smash de 90 g, bacon, cebola caramelizada e cheddar", 27.9, "smash-bacon"),
  p("s3", "smash", "Burguers", "Smash clássico", "Smash de 90 g, queijo prato, alface e tomate", 22.9),
  p("f1", "frango", "Destaques", "Box de frango M", "500 g de frango frito, fritas e molho de ervas", 39.9, "frango-box"),
  p("f2", "frango", "Sanduíches", "Chicken crocante", "Filé empanado, alface, tomate e maionese", 24.9, "frango-burguer"),
  p("f3", "frango", "Box", "Box de frango P", "250 g de frango frito e molho", 24.9),
  p("z1", "pizza", "Destaques", "Margherita grande", "Molho de tomate, muçarela e manjericão", 44.9, "pizza"),
  p("z2", "pizza", "Pizzas", "Calabresa grande", "Calabresa fatiada, cebola e muçarela", 39.9, "pizza-calabresa"),
  p("m1", "marmita", "Destaques", "Frango grelhado", "Arroz, feijão, fritas e salada", 19.9, "marmita"),
  p("m2", "marmita", "Pratos do dia", "Bife acebolado", "Arroz, feijão, farofa e salada", 22.9),
  p("a1", "acai", "Destaques", "Açaí 500 ml", "Banana, morango, granola e leite condensado", 22.9, "acai"),
  p("x1", "extras", "Bebidas", "Refrigerante lata", "350 ml", 6.5),
  p("x2", "extras", "Bebidas", "Refrigerante 2 litros", "Gelado", 13.9),
  p("x3", "extras", "Sobremesas", "Pudim no pote", "Pudim de leite condensado", 9.9),
];
