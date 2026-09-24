/**
 * Os 6 passos do kit "a IA indica o seu restaurante" (a isca do "comenta IA").
 *
 * Origem: os passos 1 (cardápio), 3 (fotos) e 4 (avaliações) são os da
 * palestra do FireHub Conect (21/09/2026, slide 15) e do roteiro do Dia 10 da
 * Comanda de Conteúdo. Os passos 2 (Google), 5 (mesma informação) e 6 (o que
 * só você tem) foram escritos em 24/09/2026 sem o slide na mão: conferir com
 * o slide 15 e trocar pelo texto do Douglas se divergir — a mensagem do
 * ManyChat promete "o que eu mostrei na palestra".
 *
 * Regra da casa: nenhum passo tem número de pesquisa. O kit só afirma o que
 * dá para conferir na própria loja.
 *
 * Este arquivo não tem nada de navegador: o page.tsx (servidor) usa os passos
 * para o JSON-LD, e o Kit.tsx (cliente) para a tela.
 */
export type PassoId = "cardapio" | "google" | "fotos" | "avaliacoes" | "igual" | "diferente";

export type Passo = {
  id: PassoId;
  titulo: string;
  /** Quanto tempo leva, do jeito que o dono de restaurante mede: "uma vez" ou "por semana". */
  tempo: string;
  /** Quanto o passo vale na nota de 0 a 100. A soma dos seis é 100. */
  peso: number;
  porque: string;
  faca: string[];
  confere: string;
};

export const PASSOS: Passo[] = [
  {
    id: "cardapio",
    titulo: "Cardápio que a IA consegue ler",
    tempo: "1 hora, uma vez",
    peso: 25,
    porque: "A IA monta a resposta com o que ela consegue ler. Cardápio em PDF, em foto ou só no story, ela não lê.",
    faca: [
      "Tenha o cardápio numa página com endereço próprio (site ou cardápio digital), e não em PDF ou foto.",
      "Cada prato com nome, descrição e preço, escritos em texto.",
      "Descrição com a fórmula: o que é + ingrediente principal + como é feito + um detalhe só seu.",
      "Coloque o link desse cardápio no Google, na bio do Instagram e no WhatsApp.",
    ],
    confere: "Abra o cardápio no celular e segure o dedo no nome de um prato. Se der para selecionar o texto, a IA lê. Se não der, é imagem.",
  },
  {
    id: "google",
    titulo: "Perfil do Google completo",
    tempo: "40 minutos, uma vez",
    peso: 20,
    porque: "É a ficha oficial da sua loja no Google. Quanto mais completa, mais informação certa sobre você existe na internet para a IA usar.",
    faca: [
      "Entre em business.google.com com o e-mail da loja. Se o perfil já existe, peça para ser o dono.",
      "Categoria principal: a mais específica que existir para o que você vende. Nas categorias extras, marque as que também valem.",
      "Preencha horário (e feriados), telefone, endereço ou área de entrega, link do cardápio e link de pedido.",
      "Cole a descrição pronta aqui embaixo e suba fotos (passo 3).",
    ],
    confere: "Pesquise o nome da sua loja no Google. Horário, telefone, fotos e o link do cardápio aparecem sem precisar clicar em nada?",
  },
  {
    id: "fotos",
    titulo: "Foto nova toda semana",
    tempo: "15 minutos por semana",
    peso: 10,
    porque: "Foto recente mostra que a loja está viva, para o cliente e para quem organiza a informação.",
    faca: [
      "Tire com luz de janela ou de dia, sem filtro.",
      "Suba no Google e no Instagram, sempre com legenda dizendo o prato e o bairro.",
      "Siga o calendário de 4 semanas e depois repita.",
    ],
    confere: "A foto mais recente do seu Google tem menos de 7 dias?",
  },
  {
    id: "avaliacoes",
    titulo: "Peça avaliação e responda todas",
    tempo: "10 minutos por dia",
    peso: 20,
    porque: "Avaliação é o cliente escrevendo o nome do seu prato e do seu bairro com as palavras dele. Cada resposta sua é mais texto verdadeiro sobre a loja.",
    faca: [
      "No seu Perfil do Google, toque em \"Pedir avaliações\" e copie o link.",
      "Mande a mensagem pronta para quem pediu, no mesmo dia ou no dia seguinte.",
      "Coloque o bilhete dentro da embalagem.",
      "Responda toda avaliação em até 2 dias, citando o prato.",
    ],
    confere: "Todas as avaliações dos últimos 30 dias têm resposta sua?",
  },
  {
    id: "igual",
    titulo: "A mesma informação em todo lugar",
    tempo: "30 minutos, uma vez",
    peso: 15,
    porque: "Quando o Google diz 18h e o iFood diz 19h, a IA não sabe em qual confiar e pode passar o horário errado para o cliente.",
    faca: [
      "Preencha a ficha única da loja aqui embaixo.",
      "Cole a mesma ficha em cada lugar da lista e vá marcando.",
      "Mudou o horário? Muda em todos no mesmo dia.",
    ],
    confere: "Abra o Google, o iFood e a bio do Instagram. Nome, telefone e horário estão iguais nos três?",
  },
  {
    id: "diferente",
    titulo: "Escreva o que só você tem",
    tempo: "30 minutos, uma vez",
    peso: 10,
    porque: "Quando alguém pergunta \"onde comer esfirra no Centro\", a IA procura quem escreveu isso. Quem só escreve \"comida boa\" não é indicado para nada.",
    faca: [
      "Responda as 3 perguntas aqui embaixo.",
      "Use a frase que sair delas na bio, no Google, no topo do cardápio e no fim das respostas de avaliação.",
      "Coloque as perguntas frequentes no cardápio e na mensagem automática do WhatsApp.",
    ],
    confere: "Leia a descrição do seu prato mais vendido. Ela diz alguma coisa que o concorrente não pode dizer?",
  },
];

/**
 * A ordem do plano de 7 dias. Não é a ordem da tela: o Google vem primeiro
 * porque o link de avaliação e as fotos moram nele, e a ficha única vem logo
 * depois porque é colada no próprio Google. As fotos ficam por último porque
 * são hábito de toda semana, e não tarefa de um dia.
 */
export const ORDEM_DO_PLANO: PassoId[] = ["google", "igual", "cardapio", "avaliacoes", "diferente", "fotos"];

const UTM = "utm_source=instagram&utm_medium=isca&utm_campaign=ia";

export const LINK_FIREHUB = `/cadastro?ref=insta&${UTM}`;
export const LINK_WHATS =
  "https://wa.me/5522981118514?text=" +
  encodeURIComponent("Oi, Douglas! Vim do passo a passo da IA e quero ajuda na minha loja.");
export const LINK_COMPARTILHAR =
  "https://wa.me/?text=" +
  encodeURIComponent("Olha esse passo a passo para a IA indicar a nossa loja: https://firehubfood.com.br/ia");
