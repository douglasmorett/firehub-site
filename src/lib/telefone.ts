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
 * O número no formato que o WhatsApp exige para RECEBER uma mensagem:
 * 55 + DDD + número, com o nono dígito PRESERVADO.
 *
 * É o oposto de `telefoneCanonico`, e os dois não se substituem. O canônico
 * existe para COMPARAR duas formas do mesmo número, e para isso ele descarta o
 * nono dígito — mandar mensagem para o resultado dele entregaria no número
 * errado, ou em nenhum.
 *
 * O 55 não é detalhe: `storePhone` é gravado como o lojista digitou —
 * "(22) 99213-4504". Só tirando os não-dígitos sai "22992134504", e o gateway
 * monta "22992134504@s.whatsapp.net", que o WhatsApp lê como DDI 22. Foi assim
 * que o primeiro aviso de "seu robô caiu" saiu para um destino inexistente.
 *
 * Devolve "" quando não dá para ter certeza — quem chama deve tratar como
 * "sem telefone utilizável" e registrar, nunca chutar.
 */
export function paraEnvioWhatsApp(bruto: string | null | undefined): string {
  let d = String(bruto || "").replace(/\D/g, "");
  if (d.startsWith("0")) d = d.replace(/^0+/, "");

  // Já veio com DDI do Brasil: 55 + DDD(2) + 8 ou 9 dígitos.
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  // Sem DDI: DDD(2) + 8 ou 9 dígitos.
  if (d.length === 10 || d.length === 11) return "55" + d;

  return "";
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

/**
 * Dá para MANDAR MENSAGEM para este número?
 *
 * ── Por que a pergunta precisa de função própria ────────────────────────────
 *
 * "Tem 11 dígitos" não basta. O FireHub grava telefones-carimbo quando o campo
 * é obrigatório no banco mas o cliente não deu o número:
 *
 *   - venda de balcão e mesa nascem com "00000000000" (11 dígitos: passa em
 *     qualquer verificação de tamanho);
 *   - o iFood manda o 0800 dele com um ramal ("0800 705 1020 ID: 32511427");
 *   - o 99Food manda o próprio 0800 com ramal.
 *
 * Esses números entravam na campanha de recuperação de 7/15/30 dias como se
 * fossem clientes. Cada disparo desses é mensagem perdida e, pior, é a
 * instância de WhatsApp da loja batendo repetidamente num número inválido —
 * exatamente o padrão que o antispam do WhatsApp procura.
 *
 * Uma função só, para a campanha, a notificação de pedido e a próxima tela que
 * precisar disso não divergirem.
 */
export function telefoneDeVerdade(bruto: string | null | undefined): boolean {
  // O RAMAL SAI ANTES DE CONTAR OS DÍGITOS.
  //
  // O 99Food manda "+55 21995358507 (ramal 81513893)" — número de cliente REAL
  // com o ramal deles pendurado. Contando os dígitos do texto inteiro dá 21, e
  // o número seria descartado como inválido: o cliente perderia a notificação
  // do pedido dele por causa de um parêntese. O 0800 do iFood ("0800 705 1020
  // ID: 32511427") continua recusado — pela regra de 0800, logo abaixo.
  const cru = String(bruto || "")
    .replace(/\(\s*ramal[^)]*\)/gi, " ")
    .replace(/\bramal\s*:?\s*\d+/gi, " ")
    .replace(/\bID\s*:?\s*\d+/gi, " ")
    .trim();
  const d = cru.replace(/\D/g, "");
  if (d.length < 10) return false;
  // 0800, 0300, 0500: linhas de atendimento, nunca WhatsApp de cliente.
  if (/^0[3358]00/.test(d)) return false;
  const nac = nacional(cru);
  if (nac.length !== 10 && nac.length !== 11) return false;
  // Carimbo: tudo zero, tudo o mesmo dígito, ou DDD inválido.
  if (/^(\d)\1+$/.test(nac)) return false;
  const ddd = Number(nac.slice(0, 2));
  if (!(ddd >= 11 && ddd <= 99)) return false;
  return true;
}
