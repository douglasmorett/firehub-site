/**
 * Quais maquininhas rodam os apps do FireHub, num lugar só: o quadro "Use na
 * maquininha" das telas Totem, Garçons e Motoboys lê daqui. Quando uma
 * adquirente liberar o app na loja dela, muda a `situacao` aqui e as três
 * telas mudam juntas.
 *
 * - disponivel: o lojista já instala e usa.
 * - liberando: app pronto, em análise na loja da adquirente.
 * - em-breve: parceria/homologação em andamento.
 */

export type ProdutoDaMaquininha = "TOTEM" | "GARCOM" | "MOTOBOY";

export type MaquininhaCompativel = {
  adquirente: string;
  modelos: string;
  situacao: "disponivel" | "liberando" | "em-breve";
  /** Em quais apps do FireHub ela entra. */
  produtos: ProdutoDaMaquininha[];
  /** Onde o lojista baixa o app (ou por que não precisa). */
  ondeBaixar: string;
};

export const MAQUININHAS_COMPATIVEIS: MaquininhaCompativel[] = [
  {
    adquirente: "Cielo",
    modelos: "Cielo Smart: LIO On, DX8000, L400, L300 e N950",
    situacao: "liberando",
    produtos: ["TOTEM", "GARCOM", "MOTOBOY"],
    ondeBaixar: "Cielo Store, na própria maquininha",
  },
  {
    adquirente: "Mercado Pago",
    modelos: "Point Smart",
    situacao: "disponivel",
    produtos: ["TOTEM"],
    ondeBaixar: "Não precisa de app: o totem cobra pela conta Mercado Pago da loja",
  },
  { adquirente: "PagBank", modelos: "Smart (P2 e A930)", situacao: "em-breve", produtos: ["TOTEM", "GARCOM", "MOTOBOY"], ondeBaixar: "Loja de apps do PagBank" },
  { adquirente: "Stone", modelos: "Stone Smart", situacao: "em-breve", produtos: ["TOTEM", "GARCOM", "MOTOBOY"], ondeBaixar: "Loja de apps da Stone" },
  { adquirente: "Getnet", modelos: "Get Smart", situacao: "em-breve", produtos: ["TOTEM", "GARCOM", "MOTOBOY"], ondeBaixar: "Get Store" },
  { adquirente: "Rede", modelos: "Laranjinha Smart", situacao: "em-breve", produtos: ["TOTEM", "GARCOM", "MOTOBOY"], ondeBaixar: "Loja de apps da Rede" },
];

export const APP_DA_MAQUININHA: Record<ProdutoDaMaquininha, { nome: string; icone: string; cor: string; serve: string }> = {
  TOTEM: {
    nome: "FireHub Totem",
    icone: "/images/maquininha/app-totem.png",
    cor: "#FF5000",
    serve: "O cliente faz o pedido no totem e paga na maquininha ao lado. O pedido só vai para a cozinha com o cartão aprovado.",
  },
  GARCOM: {
    nome: "FireHub Garçom",
    icone: "/images/maquininha/app-garcom.png",
    cor: "#0F766E",
    serve: "O garçom tira o pedido da mesa e cobra a conta na própria maquininha. O pagamento já cai baixado na mesa.",
  },
  MOTOBOY: {
    nome: "FireHub Motoboy",
    icone: "/images/maquininha/app-motoboy.png",
    cor: "#1D4ED8",
    serve: "O motoboy leva a maquininha: vê as entregas, cobra na porta (até dividido em dinheiro e cartão) e a localização vai junto. O acerto e o caixa já saem conferidos.",
  },
};
