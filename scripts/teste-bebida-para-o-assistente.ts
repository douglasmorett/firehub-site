/**
 * O servidor decide a bebida quando a lista antiga do Assistente erraria
 * (lib/bebida-para-o-assistente.ts). Rodar: npx tsx scripts/teste-bebida-para-o-assistente.ts
 */
import { assistenteErraABebida, bebidaDecididaPeloServidor } from "../src/lib/bebida-para-o-assistente";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const calzone = { name: "Calzone carne de sol", menuProduct: { category: "CALZONE" } };
const coca = { name: "Coca-Cola Lata 350ml", menuProduct: { category: "Bebidas" } };
const pizza = { name: "Pizza Calabresa", menuProduct: { category: "Pizzas" } };

confere("carne de SOL: o Assistente erraria", assistenteErraABebida([calzone], ""), true);
confere("pedido só com bebida de verdade: não erra", assistenteErraABebida([coca, pizza], ""), false);
confere("chá gelado no nome com contexto continua bebida (sem erro)", assistenteErraABebida([{ name: "Cha gelado 500ml" }], ""), false);

const job = bebidaDecididaPeloServidor({ order: { items: [calzone, coca] } });
confere("com erro: lista do Assistente desligada", (job.order as any).printerConfig?.autoBeverageTag, false);
confere("calzone NÃO vira bebida", (job.order.items[0] as any).isBeverage, undefined);
confere("coca vira bebida pelo servidor", (job.order.items[1] as any).isBeverage, true);

const semErro = { order: { items: [coca, pizza] } };
confere("sem erro: job intacto", bebidaDecididaPeloServidor(semErro) === semErro, true);

const comDestino = bebidaDecididaPeloServidor({ order: { items: [calzone] }, destinos: [{ printer: "Cozinha", items: [calzone] }, { printer: "Bar", items: [coca] }] });
confere("destinos também recebem a marca", (comDestino.destinos![1].items[0] as any).isBeverage, true);

const combo = { name: "Combo Smash", menuProduct: { category: "Combos" }, comboSelections: JSON.stringify([{ name: "Guaraná Lata", quantity: 1 }, { name: "Molho de sol" }]) };
const jc = bebidaDecididaPeloServidor({ order: { items: [combo] } });
confere("combo com opção ambígua: desliga e marca o combo (tem guaraná)", [(jc.order as any).printerConfig?.autoBeverageTag, (jc.order.items[0] as any).isBeverage], [false, true]);

const desligada = { order: { items: [calzone], printerConfig: { autoBeverageTag: false } } };
confere("loja que já desligou a marca: intacto", bebidaDecididaPeloServidor(desligada) === desligada, true);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
