// O texto do vídeo "Prazo automático no iFood: instalando e vendo funcionar".
// Parte A: a instalação pela Chrome Web Store (Chrome de verdade, perfil limpo).
// Parte B: o computador do caixa — FireHub à esquerda, iFood à direita — com
// pedidos chegando e a extensão mudando o tempo de entrega no iFood ao vivo.
// A fala só afirma o que a gravação mostra (regra de todo tutorial).
export const ID = "extensao-ifood-ao-vivo";
export const TITULO = "Prazo automático no iFood: instalando e vendo funcionar";

export const PRONUNCIA = {
  "28 minutos": "vinte e oito minutos",
  "38 minutos": "trinta e oito minutos",
  "58 minutos": "cinquenta e oito minutos",
};

export const CENAS_A = [
  { id: "a1", capitulo: "Instalar", fala: "Neste vídeo, a extensão de prazo funcionando de verdade, mexendo no iFood. Primeiro, a instalação: na tela Extensão iFood do painel, clique em Abrir na Chrome Web Store." },
  { id: "a2", fala: "Abre a página da extensão na loja do Google. Clique em Usar no Chrome, e depois em Adicionar extensão." },
  { id: "a3", capitulo: "O ícone de fogo", fala: "Pronto, ela foi adicionada. O ícone de fogo já aparece aqui em cima, ao lado da peça de quebra-cabeça." },
  { id: "a4", fala: "Se ele não aparecer, clique na peça de quebra-cabeça e no alfinete ao lado da extensão do FireHub. Assim ele fica sempre à vista." },
];

export const CENAS_B = [
  { id: "b1", capitulo: "Entrar", fala: "Agora, o computador do caixa. À esquerda, a tela de pedidos do FireHub. À direita, a tela de Entrega do iFood, já logada com a loja. Clique no ícone de fogo." },
  { id: "b2", fala: "Entre com o mesmo e-mail e a mesma senha do FireHub, e clique em Entrar e Conectar Loja." },
  { id: "b3", capitulo: "Motoboys e robô", fala: "Diga quantos motoboys estão na casa, no menos e no mais. Aqui, dois. Depois ligue a chave Robô Automático: ela fica verde." },
  // Ligar o robô já ajusta o iFood em uns 2 segundos (38 → 28, pela fila da
  // loja de teste): a câmera mostra a tela inteira nessa hora e esta fala conta
  // o que se viu.
  { id: "b4", fala: "Na mesma hora, o iFood, à direita, foi de 38 para 28 minutos: dois pedidos na cozinha para dois motoboys deixam a entrega rápida." },
  { id: "b5", capitulo: "Ao vivo no iFood", fala: "Agora, ao vivo. Chegaram mais pedidos na cozinha: veja na esquerda." },
  { id: "b6", fala: "Quatro pedidos para dois motoboys: a extensão mudou o tempo de entrega no iFood para 38 minutos, sozinha, sem ninguém clicar." },
  { id: "b7", fala: "Encheu mais: seis pedidos na cozinha. O prazo no iFood sobe para 58 minutos." },
  { id: "b8", capitulo: "Esvaziou, ele desce", fala: "Os pedidos saíram para entrega e a cozinha esvaziou. O prazo no iFood volta para 28 minutos, sozinho." },
  { id: "b9", capitulo: "No dia a dia", fala: "Ela só mexe no tempo de entrega: não pausa a loja e não mexe no cardápio. Deixe as duas abas abertas no computador do caixa, e pronto." },
  { id: "b10", capitulo: "Para rever este vídeo", fala: "Para rever este vídeo, é só clicar em Tutoriais em vídeo, no menu do painel." },
];
