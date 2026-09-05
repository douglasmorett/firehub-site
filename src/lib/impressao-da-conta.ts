/**
 * /src/lib/impressao-da-conta.ts
 *
 * Quais impressoras recebem a impressão PEDIDA no módulo de mesa — hoje a
 * conta da mesa (PrintRequest), amanhã qualquer papel que nasça de um clique
 * do garçom e não de um pedido.
 *
 * Antes esta escolha era uma ADIVINHAÇÃO, escrita duas vezes (na fila da nuvem
 * e na tela de mesas): "impressora do salão que tira a comanda inteira, sem
 * filtro de categoria — conta é papel do caixa". Funciona na loja com uma
 * impressora de caixa e uma de cozinha, e erra em toda loja que fuja disso:
 * duas de salão imprimiam a mesma conta duas vezes, e a loja que quisesse a
 * conta SÓ numa delas não tinha onde dizer isso.
 *
 * Agora a loja diz, na tela de Impressoras, marca por impressora
 * (`printers[].contaDaMesa`). E a regra mora aqui, num lugar só, porque a
 * impressão tem dois trilhos (navegador e fila da nuvem) e todo recurso de
 * comanda precisa existir nos dois — ver lib/qr-puxar.ts.
 *
 * Três estados, de propósito:
 *
 *   - NINGUÉM marcou nada (loja que nunca abriu esta opção) → a adivinhação de
 *     sempre, para nada mudar embaixo de quem já usa;
 *   - alguma marcada → sai EXATAMENTE nas marcadas;
 *   - todas desmarcadas de propósito → `null`: a loja escolheu, e escolheu
 *     ninguém. Não imprime — diferente de `[]`, que é "não há impressora
 *     cadastrada, deixa o Assistente usar a padrão dele, como sempre fez".
 */
import { impressoraAtendeModulo, type ModuloDePedido } from "./modulo-do-pedido";

export type ImpressoraDaConta = {
  name?: string | null;
  categories?: string[] | null;
  modulos?: ModuloDePedido[] | null;
  somenteBebidas?: boolean | null;
  /** Recebe a conta da mesa? Ausente = automático (a regra abaixo decide). */
  contaDaMesa?: boolean | null;
};

/** A adivinhação de sempre: impressora do salão que tira a comanda inteira. */
function palpiteDoCaixa<T extends ImpressoraDaConta>(validas: T[]): T[] {
  const doSalao = validas.filter(
    (p) => impressoraAtendeModulo(p.modulos as any, "salao") && p.somenteBebidas !== true
  );
  const doCaixa = doSalao.filter((p) => !(Array.isArray(p.categories) && p.categories.length > 0));
  return doCaixa.length > 0 ? doCaixa : doSalao;
}

/**
 * As impressoras que recebem a conta da mesa.
 *
 * `null` = a loja desmarcou todas: não imprimir em lugar nenhum.
 * `[]`    = sem impressora cadastrada/elegível: quem chama decide (o navegador
 *           não imprime, a fila manda sem `destinos` e o Assistente usa a padrão).
 */
export function impressorasDaContaDaMesa<T extends ImpressoraDaConta>(
  printers: T[] | null | undefined
): T[] | null {
  const validas = (printers || []).filter((p) => p && String(p.name || "").trim());

  const marcadas = validas.filter((p) => p.contaDaMesa === true);
  if (marcadas.length > 0) return marcadas;

  // Nenhuma marcada, mas alguém desmarcou: é escolha, não ausência de escolha.
  if (validas.some((p) => p.contaDaMesa === false)) return null;

  return palpiteDoCaixa(validas);
}

/**
 * ESTA impressora sai na conta? Para a tela de Impressoras mostrar o mesmo que
 * o papel faz — inclusive o palpite, enquanto a loja não tiver escolhido.
 */
export function contaSaiNestaImpressora(
  impressora: ImpressoraDaConta,
  printers: ImpressoraDaConta[] | null | undefined
): boolean {
  if (impressora?.contaDaMesa === true) return true;
  if (impressora?.contaDaMesa === false) return false;
  const escolhidas = impressorasDaContaDaMesa(printers) || [];
  return escolhidas.includes(impressora);
}

/**
 * Congela o palpite em marca explícita, para o clique do lojista mexer numa
 * impressora sem mudar as outras por tabela: enquanto tudo é automático,
 * marcar a cozinha tiraria o caixa da lista (passaria a valer "só as
 * marcadas") sem ninguém ter pedido isso.
 */
export function materializarEscolhaDaConta<T extends ImpressoraDaConta>(printers: T[]): T[] {
  return (printers || []).map((p) =>
    // Impressora ainda sem nome (linha recém-criada na tela) fica de fora: ela
    // não entra em escolha nenhuma até ter nome, e congelá-la como "não" a
    // deixaria desmarcada por acidente assim que a loja escolhesse o nome.
    String(p?.name || "").trim() ? { ...p, contaDaMesa: contaSaiNestaImpressora(p, printers) } : p
  );
}
