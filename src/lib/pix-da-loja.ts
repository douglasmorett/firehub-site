/**
 * A chave Pix da própria loja, que o robô do WhatsApp manda ao cliente.
 *
 * Pedido de um lojista em 01/10/2026: ~200 vendas no Pix por mês, cliente paga
 * no copia e cola e manda o comprovante, e ele confere no app do banco. O Pix
 * pelo Asaas (lib/pix-online.ts) custaria R$ 450–500 por mês para ele — o que
 * ele quer é só que o robô passe a chave dele.
 *
 * Duas regras moram aqui, e não no prompt:
 *   - a CHAVE nunca é digitada pelo modelo. Uma chave aleatória tem 36
 *     caracteres; um erro de um dígito manda o dinheiro do cliente para outra
 *     pessoa. O robô só pede o envio (`[[ENVIAR_PIX]]`) e o sistema manda a
 *     chave gravada, sozinha numa mensagem — no WhatsApp, segurar e copiar
 *     copia a mensagem inteira;
 *   - o robô não confirma pagamento. Quem confere é a loja, no banco dela.
 *
 * Mora em `chatbotConfig.pixDaLoja` = { chave, tipo, titular, banco }.
 */

export type TipoDeChavePix = "CPF" | "CNPJ" | "EMAIL" | "TELEFONE" | "ALEATORIA";

export type PixDaLoja = {
  /** Exatamente o que o cliente cola no banco: CPF/CNPJ só dígitos, celular com +55. */
  chave: string;
  tipo: TipoDeChavePix;
  /** O nome que o banco mostra antes de confirmar — é o que dá confiança ao cliente. */
  titular: string;
  banco: string;
};

/**
 * A marca que o modelo escreve para o sistema mandar a chave, em qualquer
 * grafia ("[[ENVIAR PIX]]", "[[enviar_pix: sim]]"). Some antes de chegar ao
 * cliente. Global: use com `search`/`replace`, nunca `test` (guarda lastIndex).
 */
export const MARCA_ENVIAR_PIX = /\[\[\s*ENVIAR[_\s]?PIX[^\]]*\]\]/gi;

const NOME_DO_TIPO: Record<TipoDeChavePix, string> = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  EMAIL: "e-mail",
  TELEFONE: "celular",
  ALEATORIA: "chave aleatória",
};

export function nomeDoTipoDeChave(tipo: TipoDeChavePix): string {
  return NOME_DO_TIPO[tipo];
}

function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (const t of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(d[i]) * (t + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[t])) return false;
  }
  return true;
}

function cnpjValido(d: string): boolean {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const t of [12, 13]) {
    let soma = 0;
    for (let i = 0; i < t; i++) soma += Number(d[i]) * pesos[i + 13 - t];
    const resto = soma % 11;
    const dv = resto < 2 ? 0 : 11 - resto;
    if (dv !== Number(d[t])) return false;
  }
  return true;
}

/**
 * Reconhece a chave do jeito que o lojista digita ("123.456.789-09",
 * "(22) 99962-7179", "+55 22 99962-7179", e-mail, chave aleatória).
 *
 * 11 dígitos é CPF ou celular. A máscara decide quando existe (ponto = CPF,
 * parêntese ou "+" = celular); sem máscara, CPF com dígito verificador certo
 * é CPF e o resto, se parece celular, é celular.
 */
export function reconhecerChavePix(bruta: unknown): { chave: string; tipo: TipoDeChavePix } | { erro: string } {
  const texto = String(bruta ?? "").trim();
  if (!texto) return { erro: "Digite a chave Pix." };

  const semEspaco = texto.replace(/\s+/g, "");
  if (semEspaco.includes("@")) {
    const email = semEspaco.toLowerCase();
    if (/^[^@]+@[^@]+\.[a-z]{2,}$/.test(email) && email.length <= 77) return { chave: email, tipo: "EMAIL" };
    return { erro: "Esse e-mail não parece completo." };
  }

  const uuid = semEspaco.toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) return { chave: uuid, tipo: "ALEATORIA" };

  if (/[a-z]/i.test(semEspaco)) {
    return { erro: "Não reconheci essa chave. Use CPF, CNPJ, e-mail, celular ou a chave aleatória (com os tracinhos)." };
  }

  const digitos = semEspaco.replace(/\D/g, "");
  const pareceTelefone = /^\+|\(/.test(semEspaco);
  const pareceDocumento = semEspaco.includes(".") || semEspaco.includes("/");

  const comoTelefone = (): { chave: string; tipo: TipoDeChavePix } | null => {
    const nacional = digitos.length === 13 && digitos.startsWith("55") ? digitos.slice(2) : digitos;
    // DDD (11–99) + celular de 9 dígitos começando com 9.
    if (/^[1-9][1-9]9\d{8}$/.test(nacional)) return { chave: `+55${nacional}`, tipo: "TELEFONE" };
    return null;
  };

  if (pareceTelefone) {
    return comoTelefone() || { erro: "Celular com DDD, por exemplo (22) 99999-9999." };
  }
  if (digitos.length === 14) {
    return cnpjValido(digitos) ? { chave: digitos, tipo: "CNPJ" } : { erro: "Esse CNPJ não confere. Confira os números." };
  }
  if (digitos.length === 11) {
    if (cpfValido(digitos)) return { chave: digitos, tipo: "CPF" };
    if (pareceDocumento) return { erro: "Esse CPF não confere. Confira os números." };
    return comoTelefone() || { erro: "Esse CPF não confere. Confira os números." };
  }
  if (digitos.length === 13) {
    return comoTelefone() || { erro: "Celular com DDD, por exemplo (22) 99999-9999." };
  }
  return { erro: "Não reconheci essa chave. Use CPF, CNPJ, e-mail, celular ou a chave aleatória (com os tracinhos)." };
}

/**
 * Limpa o que a tela mandou. `null` = apagar a chave; `{ erro }` = recusar e
 * manter a que estava.
 */
export function limparPixDaLoja(entrada: any): PixDaLoja | null | { erro: string } {
  if (entrada == null || entrada === "") return null;
  if (typeof entrada !== "object") return { erro: "Chave Pix inválida." };
  if (!String(entrada.chave ?? "").trim()) return null;
  const reconhecida = reconhecerChavePix(entrada.chave);
  if ("erro" in reconhecida) return reconhecida;
  const titular = String(entrada.titular ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!titular) return { erro: "Digite o nome que aparece no banco (titular da conta)." };
  const banco = String(entrada.banco ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return { ...reconhecida, titular, banco };
}

/** A chave gravada, conferida de novo — o que estiver estragado vale como "sem chave". */
export function lerPixDaLoja(chatbotConfig: any): PixDaLoja | null {
  const limpo = limparPixDaLoja(chatbotConfig?.pixDaLoja);
  return limpo && !("erro" in limpo) ? limpo : null;
}

/** O pedido vai ser pago no Pix (e não no cartão/dinheiro da entrega). */
export function pagaNoPix(formaDePagamento: unknown): boolean {
  return /\bpix\b/i.test(String(formaDePagamento ?? ""));
}

const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

/** "Em nome de Fulano · Nubank" */
function linhaDoTitular(pix: PixDaLoja): string {
  return `Em nome de: ${pix.titular}${pix.banco ? ` · ${pix.banco}` : ""}`;
}

/**
 * O que vai junto da confirmação do pedido pago no Pix. A chave em si vai na
 * mensagem SEGUINTE (`pix.chave`), sozinha, para copiar.
 */
export function textoDoPixNoPedido(pix: PixDaLoja, total: number): string {
  return (
    `\n\n💠 Pagamento no Pix: ${reais(total)}\n` +
    `A chave (${nomeDoTipoDeChave(pix.tipo)}) vai na mensagem abaixo, é só copiar e colar.\n` +
    `${linhaDoTitular(pix)}\n` +
    `Depois de pagar, manda o comprovante aqui, por favor 😊`
  );
}

/**
 * O trecho do prompt. Com chave: o modelo pede o envio pela marca e nunca
 * digita a chave. Sem chave: proibido inventar uma.
 */
export function regraDoPixNoPrompt(pix: PixDaLoja | null, robotAnotaPedido: boolean): string {
  if (!pix) {
    return `PIX DA LOJA: a loja NÃO cadastrou chave Pix aqui. Se o cliente pedir a chave, diga que a loja passa por esta conversa — NUNCA invente, chute ou repita uma chave que apareceu no histórico.`;
  }
  return [
    `PIX DA LOJA (cadastrada pela loja — ${nomeDoTipoDeChave(pix.tipo)}; ${linhaDoTitular(pix)}):`,
    `    - Quando o cliente pedir a chave Pix, escreva uma frase curta ("Segue a chave Pix 👇") e coloque a marca [[ENVIAR_PIX]] no final. O sistema manda a chave certinha numa mensagem separada, para ele copiar.`,
    `    - É PROIBIDO digitar a chave Pix na resposta, mesmo que ela apareça no histórico: um caractere errado manda o dinheiro do cliente para outra pessoa.`,
    robotAnotaPedido
      ? `    - Pedido FECHADO com pagamento no Pix: o sistema já manda o valor e a chave junto com a confirmação. Não use a marca nessa resposta.`
      : "",
    `    - Comprovante: quando o cliente mandar o comprovante (imagem ou PDF) ou disser que pagou, agradeça e diga que a loja confere o pagamento. NUNCA diga que o pagamento foi confirmado ou recebido — você não vê a conta da loja.`,
  ].filter(Boolean).join("\n");
}
