/**
 * Números que o robô não atende: motoboy, cozinha, fornecedor, contador.
 *
 * Gente que fala com a loja o dia inteiro e não quer cardápio. Sem esta lista,
 * o entregador manda "tô na portaria" e recebe de volta um "posso anotar seu
 * pedido?" — no meio de uma rota.
 *
 * ── Por que a comparação não é `===` ────────────────────────────────────────
 * O mesmo telefone chega em quatro formatos: o dono digita "(21) 99007-3399",
 * o WhatsApp entrega "5521999073399", um contato antigo tem 10 dígitos sem o
 * nono. Comparar texto cru faria a lista falhar em silêncio — o pior modo,
 * porque quem cadastrou acha que resolveu.
 *
 * Então compara-se o miolo: os últimos 8 dígitos, mais o DDD quando os dois
 * lados o trazem. Isso reconhece o mesmo número com ou sem o 55, com ou sem o
 * nono dígito, e ainda separa dois assinantes de DDDs diferentes.
 */

/** Tira máscara e o 55 do país, deixando só o número nacional. */
export function normalizarNumero(valor: unknown): string {
  const digitos = String(valor ?? "").replace(/\D/g, "");
  if (digitos.startsWith("55") && digitos.length >= 12) return digitos.slice(2);
  return digitos;
}

/** É o mesmo assinante, ainda que escrito de outro jeito? */
export function mesmoNumero(a: unknown, b: unknown): boolean {
  const x = normalizarNumero(a);
  const y = normalizarNumero(b);
  if (x.length < 8 || y.length < 8) return false;
  if (x.slice(-8) !== y.slice(-8)) return false;

  // DDD são os dois primeiros dígitos do número nacional, tenha ele 10 ou 11
  // dígitos. E só entra na conta quando os DOIS lados o trazem: um contato
  // salvo sem DDD não pode ser descartado por uma informação que ninguém deu.
  const dddX = x.length >= 10 ? x.slice(0, 2) : null;
  const dddY = y.length >= 10 ? y.slice(0, 2) : null;
  if (dddX && dddY && dddX !== dddY) return false;

  return true;
}

/**
 * O telefone está na lista de quem o robô não responde?
 *
 * `lista` vem de `chatbotConfig.numerosIgnorados` e pode ser qualquer coisa —
 * é JSON livre no banco, editado por uma tela. Entrada inválida nunca pode
 * derrubar o atendimento, então tudo que não for lista vira "não está".
 */
export function numeroEstaNaListaDeIgnorados(telefone: unknown, lista: unknown): boolean {
  if (!Array.isArray(lista) || lista.length === 0) return false;
  return lista.some((item: any) => {
    const numero = typeof item === "string" ? item : item?.numero;
    return mesmoNumero(telefone, numero);
  });
}
