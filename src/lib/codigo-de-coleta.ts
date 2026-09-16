/**
 * O CÓDIGO DE COLETA que o entregador do parceiro informa para retirar o pedido.
 *
 * ── Para que serve ──────────────────────────────────────────────────────────
 *
 * Quando quem entrega é o motoboy do parceiro (99Food, iFood, JotaJá), ele
 * chega no balcão e diz um código. A loja confere: bate, entrega o lanche; não
 * bate, não entrega. Sem esse número na comanda e no painel, o atendente não
 * tem contra o que conferir — e a proteção vira um teatro.
 *
 * No iFood isto já existia em coluna própria (`ifoodPickupCode`). Nos demais
 * canais o campo `openDeliveryPickupCode` era LIDO em três lugares — o cartão do
 * painel, a lib de entrega parceira e a comanda do Assistente, que já sabe
 * imprimir "CODIGO DE COLETA: #1234" — e não era escrito por ninguém. A coluna
 * nem existia. Mesma classe do `deliveryDistance`: a ponta lê, o começo não
 * grava, e o buraco fica invisível.
 *
 * ── Por que um leitor tolerante ─────────────────────────────────────────────
 *
 * O contrato do 99Food não declara este campo, e cada parceiro batiza o seu de
 * um jeito. Escrever um leitor por parceiro é descobrir o formato de cada um em
 * produção, um pedido por vez. Este procura os nomes plausíveis em qualquer
 * profundidade razoável e valida o que achou — o que não casar é ignorado,
 * nunca chutado. É o mesmo desenho de `coordenadas-do-parceiro.ts`, que nasceu
 * do mesmo problema.
 *
 * E quando NÃO acha, `chavesParaLog` lista o que o objeto realmente tem: sem
 * isso, "o parceiro não manda código" é um beco — ninguém sabe se o campo não
 * veio ou se veio com um nome que o leitor não conhece.
 */

/**
 * Nomes que os parceiros usam para o código de coleta, na ordem da busca.
 *
 * ── O 99Food, confirmado em pedido real (#403003, 16/09/2026) ──────────────
 *
 * Eles mandam DOIS códigos, e não são a mesma coisa:
 *
 *   `pickup_code`    → o que o entregador fala no BALCÃO, para levar o pedido.
 *                      É este. Está na lista.
 *   `handover_code`  → o da entrega ao cliente, no fim da corrida. NÃO está na
 *                      lista de propósito: na comanda da loja ele mandaria o
 *                      atendente conferir o número errado e segurar um pedido
 *                      que estava certo.
 */
const NOMES = [
  "pickupcode",
  "pickup_code",
  "takecode",
  "take_code",
  "deliverycode",
  "delivery_code",
  "collectcode",
  "collect_code",
  "verificationcode",
  "verification_code",
  "verifycode",
  "verify_code",
  "fetchcode",
  "fetch_code",
  "ordercode",
  "order_code",
];

const normalizar = (chave: string) => chave.toLowerCase().replace(/[\s_-]/g, "");
const NOMES_NORMALIZADOS = new Set(NOMES.map(normalizar));

/**
 * Um código de coleta é curto e legível em voz alta: 3 a 12 caracteres de
 * letras e números. O que fugir disso é outra coisa com nome parecido — um
 * `order_code` de 19 dígitos é o id do pedido, não o que o entregador fala.
 */
function codigoValido(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "object") return null;
  const s = String(valor).trim();
  if (!s || /^(0|null|undefined|n\/?a|-+)$/i.test(s)) return null;
  if (!/^[A-Za-z0-9-]{3,12}$/.test(s)) return null;
  // Só dígitos e comprido demais é identificador, não código de coleta.
  if (/^\d{13,}$/.test(s)) return null;
  return s.toUpperCase();
}

/**
 * Procura o código de coleta em qualquer um dos objetos passados.
 *
 * Aceita vários porque o pedido chega repartido: o corpo do webhook, o detalhe
 * buscado depois, o bloco de entrega. Devolve o PRIMEIRO válido — e `null`
 * quando não há, que é resposta legítima: pedido com entrega da própria loja
 * não tem código nenhum.
 */
export function codigoDeColetaDoParceiro(...fontes: unknown[]): string | null {
  for (const fonte of fontes) {
    const achado = procurar(fonte, 0);
    if (achado) return achado;
  }
  return null;
}

function procurar(obj: unknown, nivel: number): string | null {
  if (!obj || typeof obj !== "object" || nivel > 6) return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const achado = procurar(item, nivel + 1);
      if (achado) return achado;
    }
    return null;
  }

  // Primeiro os campos deste nível: um `pickup_code` na raiz vale mais que um
  // `code` perdido dentro de um objeto aninhado.
  for (const [chave, valor] of Object.entries(obj as Record<string, unknown>)) {
    if (!NOMES_NORMALIZADOS.has(normalizar(chave))) continue;
    const codigo = codigoValido(valor);
    if (codigo) return codigo;
  }

  for (const valor of Object.values(obj as Record<string, unknown>)) {
    const achado = procurar(valor, nivel + 1);
    if (achado) return achado;
  }
  return null;
}

/**
 * As chaves que o objeto REALMENTE tem, para o log de quando nada casou.
 *
 * É o que transforma "o parceiro não manda o código" em "o parceiro manda, e
 * chama de X" — sem precisar de acesso ao ambiente deles.
 */
export function chavesParaLog(obj: unknown, nivel = 0): string {
  if (!obj || typeof obj !== "object" || nivel > 2) return "";
  const partes: string[] = [];
  for (const [chave, valor] of Object.entries(obj as Record<string, unknown>)) {
    if (valor && typeof valor === "object" && !Array.isArray(valor)) {
      const dentro = chavesParaLog(valor, nivel + 1);
      partes.push(dentro ? `${chave}{${dentro}}` : chave);
    } else {
      partes.push(chave);
    }
  }
  return partes.join(", ").slice(0, 600);
}
