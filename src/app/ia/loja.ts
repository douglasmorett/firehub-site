/**
 * O que o lojista conta sobre a loja no topo do kit. Tudo o que o kit gera
 * (a pergunta do teste, a descrição do Google, as respostas de avaliação...)
 * sai daqui. Fica só no aparelho dele (localStorage): o kit não envia nada.
 */
export type Loja = {
  nome: string;
  comida: string;
  prato: string;
  cidade: string;
  bairro: string;
  endereco: string;
  whatsapp: string;
  horario: string;
  linkCardapio: string;
  diferencial: string;
  referencia: string;
  ocasiao: string;
};

export const LOJA_VAZIA: Loja = {
  nome: "",
  comida: "",
  prato: "",
  cidade: "",
  bairro: "",
  endereco: "",
  whatsapp: "",
  horario: "",
  linkCardapio: "",
  diferencial: "",
  referencia: "",
  ocasiao: "",
};

/** O valor que o lojista digitou, ou o marcador entre colchetes que ele troca depois de colar. */
export function ou(valor: string, marcador: string): string {
  return valor.trim() || marcador;
}

export function maiuscula(texto: string): string {
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}

/**
 * "Rio das Ostras (Centro)" — ou só a cidade, ou o marcador. O bairro vai
 * entre parênteses porque a preposição dele não dá para adivinhar: é "no
 * Centro", mas "na Praia do Siqueira" e "em Costazul". Os textos dizem
 * "em Rio das Ostras (Centro)", que vale para qualquer bairro.
 */
export function ondeFica(l: Loja): string {
  const bairro = l.bairro.trim();
  const cidade = l.cidade.trim();
  if (bairro && cidade) return `${cidade} (${bairro})`;
  return cidade || bairro || "[sua cidade]";
}

/**
 * "do Hakim", mas "da Pizzaria do Digão": o artigo segue a primeira palavra
 * do nome (Pizzaria, Lanchonete, Casa, Cantina... terminam em "a"). É uma
 * regra de bolso — erra em nome raro, e o texto é para o lojista conferir
 * antes de colar de qualquer jeito.
 */
export function comArtigo(l: Loja, forma: "de" | "em" | "o"): string {
  const nome = l.nome.trim();
  const feminino = /a$/i.test(nome.split(/\s+/)[0] || "");
  const artigo = {
    de: feminino ? "da" : "do",
    em: feminino ? "na" : "no",
    o: feminino ? "a" : "o",
  }[forma];
  return `${artigo} ${nome || "[nome da loja]"}`;
}
