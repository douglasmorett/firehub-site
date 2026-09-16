/**
 * Trava o leitor do código de coleta (src/lib/codigo-de-coleta.ts).
 *
 *   npx tsx scripts/teste-codigo-de-coleta.ts
 *
 * O que mais importa aqui não é o que ele ACEITA — é o que ele RECUSA. Um id de
 * pedido de 19 dígitos tem nome parecido ("order_code") e, se entrasse, a
 * comanda mandaria o atendente conferir um número que o entregador não tem.
 */
import { codigoDeColetaDoParceiro, chavesParaLog } from "../src/lib/codigo-de-coleta";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

console.log("── acha o código onde ele estiver ──");
confere("na raiz", codigoDeColetaDoParceiro({ pickup_code: "4821" }), "4821");
confere("em camelCase", codigoDeColetaDoParceiro({ pickupCode: "4821" }), "4821");
confere("aninhado no delivery", codigoDeColetaDoParceiro({ delivery: { take_code: "A7B2" } }), "A7B2");
confere("aninhado no entregador", codigoDeColetaDoParceiro({ rider: { verification_code: "913" } }), "913");
confere("em número, não texto", codigoDeColetaDoParceiro({ pickup_code: 4821 }), "4821");
confere("minúscula vira maiúscula", codigoDeColetaDoParceiro({ delivery_code: "a7b2" }), "A7B2");
confere("procura em várias fontes", codigoDeColetaDoParceiro({ a: 1 }, null, { collect_code: "77Z" }), "77Z");
confere("dentro de lista", codigoDeColetaDoParceiro({ riders: [{ nome: "x" }, { fetch_code: "5150" }] }), "5150");

console.log("\n── e RECUSA o que não é código de coleta ──");
confere("id de pedido de 19 dígitos", codigoDeColetaDoParceiro({ order_code: "5764687210926376219" }), null);
confere("campo vazio", codigoDeColetaDoParceiro({ pickup_code: "" }), null);
confere("zero", codigoDeColetaDoParceiro({ pickup_code: 0 }), null);
confere("nulo escrito por extenso", codigoDeColetaDoParceiro({ pickup_code: "null" }), null);
confere("traços de preenchimento", codigoDeColetaDoParceiro({ pickup_code: "---" }), null);
confere("curto demais", codigoDeColetaDoParceiro({ pickup_code: "12" }), null);
confere("com espaço no meio (é frase, não código)", codigoDeColetaDoParceiro({ pickup_code: "diga 1234" }), null);
confere("objeto no lugar do valor", codigoDeColetaDoParceiro({ pickup_code: { v: "1234" } }), null);
confere("campo de nome parecido que não está na lista", codigoDeColetaDoParceiro({ zipcode: "28890" }), null);
confere("pedido sem nada disso", codigoDeColetaDoParceiro({ order_id: "1", price: { total: 10 } }), null);
confere("entrada inválida não explode", codigoDeColetaDoParceiro(null, undefined, "texto", 42), null);

console.log("\n── o log que fecha o assunto quando nada casa ──");
const chaves = chavesParaLog({ order_id: "1", delivery: { rider_name: "João", eta: 10 }, price: { total: 2990 } });
confere("lista as chaves reais, com um nível dentro", chaves, "order_id, delivery{rider_name, eta}, price{total}");

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
