/**
 * Trava a regra "Na entrega, só pagamento online" (lib/formas-do-cardapio.ts,
 * `formaRecusadaNaEntrega`), que o cardápio e o api/customer-order leem.
 *
 *   node node_modules/jiti/lib/jiti-cli.mjs scripts/teste-entrega-so-online.ts
 */
import {
  ehFormaPeloSite, ehPedidoDeEntrega, entregaSoOnlineMarcada, formaDesligada, formaRecusadaNaEntrega,
} from "../src/lib/formas-do-cardapio";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const marcada = { PIX: { active: true }, DINHEIRO: { active: true }, entregaSoOnline: true };
const semMarcar = { PIX: { active: true }, DINHEIRO: { active: true } };

console.log("\n— Entrega com a opção marcada e o Asaas ligado —");
for (const forma of ["DINHEIRO", "PIX_ENTREGA", "DEBITO", "CREDITO", "VOUCHER", "VOUCHER_VR", "", null]) {
  confere(`${JSON.stringify(forma)} na entrega é recusado`, formaRecusadaNaEntrega(marcada, forma, "DELIVERY", true), true);
}
for (const forma of ["PIX", "pix", "PIX_ONLINE", "CREDITO_ONLINE", "CARTAO_ONLINE"]) {
  confere(`${forma} pelo site passa`, formaRecusadaNaEntrega(marcada, forma, "DELIVERY", true), false);
}

console.log("\n— Retirada, balcão e mesa seguem com tudo —");
for (const tipo of ["PICKUP", "pickup", "TAKEOUT", "RETIRADA", "BALCAO", "BALCÃO", "MESA", " PICKUP "]) {
  confere(`dinheiro em ${JSON.stringify(tipo)} passa`, formaRecusadaNaEntrega(marcada, "DINHEIRO", tipo, true), false);
}

console.log("\n— Palavra desconhecida cai no lado seguro (entrega) —");
for (const tipo of ["DELIVERY", "delivery", "ENTREGA", "", undefined, "QUALQUER"]) {
  confere(`${JSON.stringify(tipo)} é entrega`, ehPedidoDeEntrega(tipo), true);
}
confere("dinheiro com tipo vazio é recusado", formaRecusadaNaEntrega(marcada, "DINHEIRO", "", true), true);

console.log("\n— Sem a opção, ou sem receber pelo site, nada muda —");
confere("opção desmarcada: dinheiro na entrega passa", formaRecusadaNaEntrega(semMarcar, "DINHEIRO", "DELIVERY", true), false);
confere("paymentFees nulo: passa", formaRecusadaNaEntrega(null, "DINHEIRO", "DELIVERY", true), false);
confere("entregaSoOnline 'true' (texto) não conta", formaRecusadaNaEntrega({ entregaSoOnline: "true" }, "DINHEIRO", "DELIVERY", true), false);
confere("marcada mas Asaas desligado: não fecha a entrega", formaRecusadaNaEntrega(marcada, "DINHEIRO", "DELIVERY", false), false);
confere("entregaSoOnlineMarcada lê só true", [entregaSoOnlineMarcada(marcada), entregaSoOnlineMarcada(semMarcar), entregaSoOnlineMarcada(undefined)], [true, false, false]);

console.log("\n— As formas do site e a chave nova não confundem a régua antiga —");
confere("PIX_ENTREGA não é pelo site", ehFormaPeloSite("PIX_ENTREGA"), false);
confere("CREDITO (maquininha) não é pelo site", ehFormaPeloSite("CREDITO"), false);
confere("formaDesligada ignora a chave entregaSoOnline", formaDesligada(marcada, "DINHEIRO"), null);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
