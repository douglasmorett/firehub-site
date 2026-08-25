/**
 * Parse de JSON que não destrói os IDs do 99Food.
 *
 * Eles usam inteiros de 64 bits como id de app, de loja e de PEDIDO. O maior
 * inteiro que o JavaScript representa exatamente é 2^53-1 (16 dígitos), e os
 * ids deles têm 19. O `JSON.parse` nativo, então, entrega um número errado sem
 * avisar:
 *
 *   JSON.parse('{"id":5764613856220155403}').id  →  5764613856220156000
 *
 * Esse não é um exemplo inventado: 5764613856220155403 é o id da Brasa Burguer
 * no 99Food. A própria documentação deles abre um "ATTENTION" sobre isto no
 * Integration Guide e manda usar json-bigint.
 *
 * O estrago é silencioso e caro. `openDeliveryOrderId` gravado com o id
 * corrompido faz a checagem de duplicado nunca casar (o mesmo pedido entra de
 * novo a cada reenvio do webhook) e o update de status não achar o pedido. E
 * `confirmarPedido` devolveria ao 99Food um order_id que não existe — pedido
 * não confirmado a tempo é cancelado do lado deles.
 *
 * A correção é converter os inteiros longos em STRING antes do parse, porque é
 * como string que esses ids são usados aqui dentro (o schema guarda texto e a
 * comparação é textual). Sem dependência nova: a lib json-bigint devolveria
 * objetos BigInt, que não sobrevivem a um JSON.stringify nem entram no Prisma
 * sem conversão — e a conversão de volta seria mais um lugar para errar.
 */

/**
 * Envolve em aspas todo inteiro com 16+ dígitos que esteja em posição de VALOR,
 * deixando o resto do documento intacto.
 *
 * O regex ignora o que está dentro de string: ele exige que o número venha logo
 * depois de `:`, `,` ou `[` e seja SEGUIDO por `,`, `}` ou `]`. Seguido, não
 * consumido — o delimitador final está num lookahead de propósito: em
 * `[id1,id2,id3]` a vírgula precisa sobrar para abrir o match seguinte, senão
 * só o primeiro e o último id do array seriam convertidos e o do meio passaria
 * corrompido. Um `"5764613856220155403"` que já seja texto não casa, porque vem
 * precedido de aspas. Números com ponto decimal também não casam — preço não é
 * id, e arredondar centavos aqui seria trocar um problema por outro.
 */
export function citarIdsLongos(json: string): string {
  return json.replace(
    /([:,[]\s*)(-?\d{16,})(?=\s*[,}\]])/g,
    (_todo, antes, numero) => `${antes}"${numero}"`
  );
}

/**
 * `JSON.parse` que preserva os ids de 64 bits do 99Food como string.
 *
 * Lança igual ao nativo se o texto não for JSON — quem chama decide o que
 * fazer com payload ilegível.
 */
export function parseJson99Food(texto: string): any {
  return JSON.parse(citarIdsLongos(texto));
}
