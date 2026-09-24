import { type Loja, comArtigo, maiuscula, ondeFica, ou } from "./loja";

/**
 * Os textos prontos do kit. Cada função recebe o que o lojista contou da loja
 * e devolve o texto para ele copiar e colar. O que ele não preencheu vira um
 * marcador entre colchetes, para ele trocar depois de colar — nunca um dado
 * inventado.
 */

const nome = (l: Loja) => ou(l.nome, "[nome da loja]");
const comida = (l: Loja) => ou(l.comida, "[o que você vende]");
const prato = (l: Loja) => ou(l.prato, "[seu prato mais vendido]");

// ─── Teste ──────────────────────────────────────────────────────────────────

export function perguntaDoTeste(l: Loja): string {
  return `Onde comer ${l.comida.trim() || "[sua comida]"} em ${l.cidade.trim() || "[sua cidade]"}?`;
}

/**
 * As IAs que aceitam a pergunta no próprio link. O Gemini não aceita: para
 * ele o kit copia a pergunta e abre o app.
 */
export function linksDoTeste(pergunta: string) {
  const q = encodeURIComponent(pergunta);
  return {
    chatgpt: `https://chatgpt.com/?q=${q}`,
    // udm=50 é o Modo IA da busca do Google.
    google: `https://www.google.com/search?udm=50&q=${q}`,
    perplexity: `https://www.perplexity.ai/search?q=${q}`,
    gemini: "https://gemini.google.com/app",
  };
}

// ─── Passo 1: cardápio ──────────────────────────────────────────────────────

export function promptCardapio(l: Loja): string {
  return `Você é redator de cardápio de delivery. Reescreva a descrição de cada prato ${comArtigo(l, "de")}, que vende ${comida(l)} em ${ondeFica(l)}.

Regras:
- Use só os ingredientes que eu passar. Não invente nada.
- Até 140 caracteres por prato.
- Comece pelo que o prato é, depois o ingrediente principal e como é feito.
- Escreva com as palavras que o cliente usa para pedir. Nada de "o melhor" ou "irresistível".
- Devolva uma tabela: prato | descrição nova | preço.

Meu cardápio (nome, ingredientes e preço de cada prato):
[cole aqui]`;
}

// ─── Passo 2: Google ────────────────────────────────────────────────────────

/** A descrição do Perfil da Empresa. O Google aceita até 750 caracteres. */
export function descricaoGoogle(l: Loja): string {
  const partes = [
    `${nome(l)}: ${comida(l)} em ${ondeFica(l)}.`,
    l.diferencial.trim() ? `${maiuscula(l.diferencial.trim())}.` : "[Conte aqui o que vocês fazem de diferente.]",
    `O mais pedido da casa é ${prato(l)}.`,
    l.horario.trim() ? `Aberto ${l.horario.trim()}.` : "",
    "Faça seu pedido pelo nosso cardápio online.",
  ];
  return partes.filter(Boolean).join(" ");
}

export const LIMITE_DESCRICAO_GOOGLE = 750;

// ─── Passo 3: fotos ─────────────────────────────────────────────────────────

export function calendarioDeFotos(l: Loja): [string, string][] {
  return [
    ["Semana 1", `${maiuscula(prato(l))}, de perto, com luz de janela.`],
    ["Semana 2", "A cozinha trabalhando: mãos, forno, montagem. Sem rosto de cliente."],
    ["Semana 3", "Fachada e entrada, de dia e à noite: quem vem retirar precisa achar."],
    ["Semana 4", "A equipe (com autorização) ou a embalagem pronta para sair."],
  ];
}

export function legendaDeFoto(l: Loja): string {
  return `${maiuscula(prato(l))} saindo agora ${comArtigo(l, "em")}, em ${ondeFica(l)}. Peça pelo cardápio online (link na bio).`;
}

// ─── Passo 4: avaliações ────────────────────────────────────────────────────

export function mensagemPedirAvaliacao(l: Loja): string {
  return `Oi! Aqui é ${comArtigo(l, "de")} 😊 Chegou tudo certinho? Se gostou, deixa uma avaliação no Google contando o que você pediu. Leva 30 segundos e ajuda muito uma loja do bairro: [cole aqui o seu link de avaliação]`;
}

export function bilheteDaEmbalagem(l: Loja): string {
  return `Gostou? Conta pro Google 😊
Aponte a câmera e avalie ${comArtigo(l, "o")}.
Leva 30 segundos e ajuda muito a gente.
[QR code do seu link de avaliação]`;
}

export function respostaElogio(l: Loja): string {
  return `Obrigado, [nome do cliente]! Que bom que você gostou. A gente capricha no ${prato(l)} aqui ${comArtigo(l, "em")}, em ${ondeFica(l)}. Até o próximo pedido!`;
}

export function respostaReclamacao(l: Loja): string {
  const zap = l.whatsapp.trim() ? ` ${l.whatsapp.trim()}` : " [seu número]";
  return `[Nome do cliente], obrigado por avisar, e desculpa pelo [o que deu errado: atraso, item faltando...]. Isso não é o padrão ${comArtigo(l, "de")}: já [o que você mudou]. Me chama no WhatsApp${zap} que eu resolvo pessoalmente.`;
}

export function respostaNeutra(l: Loja): string {
  return `Obrigado pela avaliação, [nome do cliente]! Se puder, conta pra gente o que faltou para ser 5 estrelas. A gente lê tudo aqui ${comArtigo(l, "em")}.`;
}

export function promptAvaliacaoDificil(l: Loja): string {
  return `Você é o dono ${comArtigo(l, "de")}, que vende ${comida(l)} em ${ondeFica(l)}. Um cliente escreveu esta avaliação:

[cole a avaliação aqui]

Escreva uma resposta de até 3 frases, educada, sem desculpa genérica, que cite o problema dele, diga o que vamos mudar e convide a falar com a gente no WhatsApp.`;
}

// ─── Passo 5: a mesma informação em todo lugar ──────────────────────────────

export function fichaUnica(l: Loja): string {
  return [
    nome(l),
    `${maiuscula(comida(l))} em ${ondeFica(l)}`,
    `Endereço: ${ou(l.endereco, "[rua, número, bairro — ou: só delivery]")}`,
    `WhatsApp: ${ou(l.whatsapp, "[seu número]")}`,
    `Horário: ${ou(l.horario, "[dias e horas]")}`,
    `Cardápio e pedidos: ${ou(l.linkCardapio, "[link do cardápio]")}`,
  ].join("\n");
}

export const ONDE_COLAR: [string, string][] = [
  ["google", "Perfil do Google"],
  ["ifood", "iFood (dados da loja)"],
  ["99", "99Food (dados da loja)"],
  ["instagram", "Bio do Instagram e botão de contato"],
  ["whatsapp", "Perfil do WhatsApp Business"],
  ["cardapio", "Topo do seu cardápio ou site"],
  ["facebook", "Página da loja no Facebook"],
];

// ─── Passo 6: o que só você tem ─────────────────────────────────────────────

export function fraseAssinatura(l: Loja): string {
  const dif = ou(l.diferencial, "[o que vocês fazem diferente]");
  const ref = l.referencia.trim() ? `, ${l.referencia.trim()}` : "";
  const ocasiao = l.ocasiao.trim() ? ` Para ${l.ocasiao.trim()}.` : "";
  return `${nome(l)}: ${comida(l)} ${dif}. Em ${ondeFica(l)}${ref}.${ocasiao}`;
}

export function perguntasFrequentes(l: Loja): string {
  const pares: [string, string][] = [
    [
      "Vocês entregam em que bairros?",
      `Entregamos em [bairros que você atende].${l.endereco.trim() ? ` Nosso endereço: ${l.endereco.trim()}.` : ""}`,
    ],
    ["Qual o horário?", l.horario.trim() ? `Abrimos ${l.horario.trim()}.` : "[Seu horário, igual ao do Google.]"],
    ["Quais as formas de pagamento?", "[Pix, cartão e dinheiro — ajuste para o seu caso.]"],
    ["Qual o prato mais pedido?", `${maiuscula(prato(l))}.`],
    ["Tem opção vegetariana ou sem lactose?", "[Responda com os pratos que servem.]"],
  ];
  return pares.map(([p, r]) => `P: ${p}\nR: ${r}`).join("\n\n");
}
