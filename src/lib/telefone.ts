/**
 * Comparação de telefone brasileiro — uma só regra para todo o sistema.
 *
 * ── POR QUE ISTO EXISTE ─────────────────────────────────────────────────────
 *
 * O código comparava telefones assim:
 *
 *     donoDaLoja.includes(telefoneDoCliente.slice(-8))
 *
 * Oito dígitos é o número local SEM o DDD. Quem mora em São Paulo com
 * 11 98765-4321 e o dono da loja no Rio com 21 98765-4321 têm os mesmos oito
 * dígitos finais — e o cliente entrava no "modo dono" do robô, recebendo
 * faturamento do dia, total de pedidos e status do caixa da loja. Não era um
 * cenário teórico: com milhares de clientes por loja, colisão de oito dígitos
 * acontece.
 *
 * Pior, `includes()` com string curta é traiçoeiro: telefone de um dígito
 * gerava `includes("1")`, verdadeiro em quase todo número.
 *
 * ── A REGRA ─────────────────────────────────────────────────────────────────
 *
 * Compara DDD + número, exatos. O nono dígito é a única tolerância: a mesma
 * linha aparece como 11 98765-4321 e 11 8765-4321 conforme quem cadastrou, e
 * recusar isso quebraria cadastro antigo de loja de verdade.
 */

/** Só os dígitos, já sem o 55 do Brasil e sem o zero de operadora. */
function nacional(bruto: string | null | undefined): string {
  let d = String(bruto || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  return d;
}

/**
 * Forma canônica: DDD (2) + 8 dígitos, com o nono removido.
 * Devolve "" quando não dá para ter certeza — e "" nunca é igual a nada aqui.
 */
export function telefoneCanonico(bruto: string | null | undefined): string {
  const d = nacional(bruto);
  // 10 = DDD + 8 (fixo/celular antigo). 11 = DDD + 9 (celular atual).
  if (d.length !== 10 && d.length !== 11) return "";
  const ddd = d.slice(0, 2);
  let numero = d.slice(2);
  // Tira o nono dígito para que 98765-4321 e 8765-4321 sejam a mesma linha.
  if (numero.length === 9 && numero.startsWith("9")) numero = numero.slice(1);
  if (numero.length !== 8) return "";
  return ddd + numero;
}

/**
 * Os dois números são a mesma linha?
 *
 * Devolve `false` quando qualquer um dos lados não vira forma canônica —
 * número incompleto, estrangeiro ou lixo NUNCA passa por igual. É o que impede
 * que uma entrada vazia libere acesso que deveria ser só do dono.
 */
export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = telefoneCanonico(a);
  const cb = telefoneCanonico(b);
  return ca !== "" && ca === cb;
}
