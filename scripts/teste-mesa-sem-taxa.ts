/**
 * "Pagar sem taxa de serviço" na conta aberta (lib/taxa-da-mesa.ts).
 *
 *   npx tsx scripts/teste-mesa-sem-taxa.ts
 *
 * Pedido de 12/11/2026 (Garçom na Cielo): o cliente tem que poder pagar sem a
 * taxa, e o garçom tira na maquininha. A escolha vai para a conta aberta e o
 * fechamento do painel abre sem a taxa — e o caixa/relatório contam zero.
 */
import { contaSemTaxa, gravacaoDaTaxa, taxaSugeridaDaConta } from "../src/lib/taxa-da-mesa";
import { calcularContaDaMesa } from "../src/lib/conta-da-mesa";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

// ── a marca na conta ──
confere("conta aberta sem nada gravado: com a taxa da loja", contaSemTaxa({ status: "OPEN", serviceFee: null }), false);
confere("conta aberta com 0: sem taxa", contaSemTaxa({ status: "OPEN", serviceFee: 0 }), true);
confere("conta fechada com R$ 0 de taxa não é marca de conta aberta", contaSemTaxa({ status: "CLOSED", serviceFee: 0 }), false);
confere("conta fechada com R$ 24 de taxa: não", contaSemTaxa({ status: "CLOSED", serviceFee: 24 }), false);
confere("sem sessão: não", contaSemTaxa(null), false);

// ── o que a rota grava ──
confere("semTaxa true grava 0", gravacaoDaTaxa(true), { serviceFee: 0 });
confere("semTaxa false volta a nulo (taxa da loja)", gravacaoDaTaxa(false), { serviceFee: null });
confere("texto \"true\" não vale (pedido malformado)", gravacaoDaTaxa("true"), null);
confere("ausente não grava nada", gravacaoDaTaxa(undefined), null);
confere("gravar e ler de volta: sem taxa", contaSemTaxa({ status: "OPEN", ...gravacaoDaTaxa(true)! }), true);
confere("gravar e ler de volta: com taxa", contaSemTaxa({ status: "OPEN", ...gravacaoDaTaxa(false)! }), false);

// ── a sugestão do fechamento no painel ──
confere("sem marca: a taxa da loja", taxaSugeridaDaConta(12, undefined), 12);
confere("com marca: zero", taxaSugeridaDaConta(12, true), 0);
confere("marca desligada: a taxa da loja", taxaSugeridaDaConta(10, false), 10);

// ── a conta que a maquininha mostra e imprime (mesma função do fechamento) ──
const mesa = {
  table: { number: 7, label: null },
  orders: [{
    status: "ENTREGUE", totalAmount: 100, dailyOrderNumber: 1,
    items: [{ id: "i1", quantity: 2, price: 50, productName: "Pizza", tableGuestId: null, comboSelections: null, menuProduct: null }],
  }],
};
const comTaxa = calcularContaDaMesa(mesa as any, [], 10, null, null);
const semTaxa = calcularContaDaMesa(mesa as any, [], taxaSugeridaDaConta(10, true), null, null);
confere("com taxa: R$ 10 de taxa, total R$ 110", [comTaxa.taxaServico.valor, comTaxa.total], [10, 110]);
confere("sem taxa: taxa zero, total R$ 100", [semTaxa.taxaServico.valor, semTaxa.total], [0, 100]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
