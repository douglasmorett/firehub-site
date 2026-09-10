/**
 * Os "você sabia?" da página de venda.
 *
 * Cada um é uma frase LITERAL de uma fonte pública, conferida palavra por
 * palavra na data anotada em `conferido`. A regra da página é dura: número
 * que não foi medido por nós nem publicado por alguém com nome não entra.
 * O dono pediu "até 67% de aumento nas vendas" — esse número não existe em
 * nenhuma fonte que a gente achou (o 67% que circula é sobre preço da taxa
 * de entrega, Locomotiva/2025), então não está aqui. O "5x mais cancelamentos
 * na entrega própria" que um resumo de busca atribuiu ao iFood também não
 * existe na página citada. Antes de acrescentar gatilho: abrir a URL, exigir
 * a frase verbatim, anotar a data.
 *
 * Os mesmos gatilhos casam o anúncio com a página: o link do anúncio leva
 * `?g=<chave>` e o hero abre com o gancho que a pessoa acabou de ler
 * (message match). Sem `?g`, vale o primeiro da lista.
 *
 *   /prazos?g=posicao   /prazos?g=atraso   /prazos?g=cliente
 */
export type Gatilho = {
  chave: "posicao" | "atraso" | "cliente";
  /** Etiqueta curta do cartão. */
  rotulo: string;
  /** O "você sabia que…?" na voz do lojista. */
  pergunta: string;
  /** Frase literal da fonte, sem aspas. */
  citacao: string;
  /** Nome curto da fonte, com data quando a página tem. */
  fonte: string;
  url: string;
  /** Uma linha para o pré-título do hero. */
  hero: string;
  conferido: string;
};

export const GATILHOS: Gatilho[] = [
  {
    chave: "posicao",
    rotulo: "Posição no app",
    pergunta: "Você sabia que o iFood escolhe quem aparece primeiro olhando o tempo de preparo e a pontualidade?",
    citacao:
      "Entre os fatores que mais pesam no posicionamento estão o tempo de preparo dos pedidos, a pontualidade na entrega, a taxa de cancelamento, a disponibilidade da loja no aplicativo, o volume de vendas e as avaliações dos clientes.",
    fonte: "iFood para parceiros, 13/07/2026",
    url: "https://blog-parceiros.ifood.com.br/como-melhorar-posicao-ifood/",
    hero: "O iFood diz que tempo de preparo e pontualidade estão entre o que mais pesa na posição da sua loja.",
    conferido: "09/09/2026",
  },
  {
    chave: "atraso",
    rotulo: "Nota e posição",
    pergunta: "Você sabia que prazo curto demais derruba a sua loja em vez de vender mais?",
    citacao: "tempo curto demais gera atraso, e atraso derruba a posição e a avaliação.",
    fonte: "iFood para parceiros, 13/07/2026",
    url: "https://blog-parceiros.ifood.com.br/como-melhorar-posicao-ifood/",
    hero: "O iFood avisa: “tempo curto demais gera atraso, e atraso derruba a posição e a avaliação”.",
    conferido: "09/09/2026",
  },
  {
    chave: "cliente",
    rotulo: "Cliente",
    pergunta: "Você sabia que mais de 1 em cada 3 clientes larga o app depois de uma experiência ruim?",
    citacao: "36% já deixaram de usar um app de entregas por causa de uma experiência negativa.",
    fonte: "Opinion Box, 2.067 entrevistas, 2023",
    url: "https://blog.opinionbox.com/mercado-de-delivery-no-brasil/",
    hero: "36% dos clientes já largaram um app de entrega por uma experiência ruim (Opinion Box, 2.067 entrevistas).",
    conferido: "09/09/2026",
  },
];

/** Frase que vira a ponte entre os gatilhos e o produto — também literal. */
export const PICO = {
  citacao: "ajuste o tempo no Portal do Parceiro para refletir o que você de fato consegue cumprir, especialmente no horário de pico.",
  url: "https://blog-parceiros.ifood.com.br/como-melhorar-posicao-ifood/",
};

/** O que mais as plataformas e as pesquisas publicam — fica dobrado em <details>. */
export const OUTRAS_FONTES: { texto: string; url: string; fonte: string }[] = [
  {
    texto: "“Se o pedido for em restaurante e o atraso ultrapassar 10 minutos do prazo estimado durante a preparação, é considerado atrasado.”",
    url: "https://institucional.ifood.com.br/ajuda/problemas-com-o-pedido-ifood/",
    fonte: "Página de ajuda do iFood",
  },
  {
    texto: "“Prometer 20 minutos e entregar em 50, por exemplo, gera uma percepção mais negativa do que ter cadastrado 40 minutos”",
    url: "https://blog-parceiros.ifood.com.br/aparecer-no-ifood/",
    fonte: "iFood para parceiros, 03/07/2026",
  },
  {
    texto: "“cancelamentos frequentes impactam negativamente a percepção do cliente e reduzem a visibilidade da sua loja”",
    url: "https://blog-parceiros.ifood.com.br/aparecer-no-ifood/",
    fonte: "iFood para parceiros, 03/07/2026",
  },
  {
    texto: "“a loja pode ser fechada no iFood em caso de muitos entregadores esperando” — errar para cima também custa.",
    url: "https://blog-parceiros.ifood.com.br/tempo-de-preparo/",
    fonte: "Blog de parceiros do iFood",
  },
  {
    texto: "99Food: “Tempo menor que o real: pode causar atrasos, avaliações negativas ou cancelamentos.” E “Tempo maior que o real: pode afastar clientes, reduzir pedidos e impactar seus ganhos”.",
    url: "https://99app.com/99food/restaurantes/guias/como-configurar-o-tempo-de-preparo/",
    fonte: "Guia oficial do 99Food",
  },
  {
    texto: "Selo Super Restaurante: nota ≥ 4,7, cancelamento ≤ 0,90%, reclamações ≤ 1%. Um cancelamento consome a folga de 111 pedidos bons.",
    url: "https://institucional.ifood.com.br/restaurantes/selo-super-do-ifood/",
    fonte: "Critérios do Selo Super",
  },
  {
    texto: "“52% desistem de comprar em restaurantes ou lojas que têm avaliações ruins nos aplicativos.”",
    url: "https://blog.opinionbox.com/mercado-de-delivery-no-brasil/",
    fonte: "Opinion Box, 2.067 entrevistas, 2023",
  },
];
