/**
 * Trava a conta da mesa com desconto (lib/conta-da-mesa.ts).
 *
 *   npx tsx scripts/teste-conta-da-mesa-com-desconto.ts
 *
 * A queixa (25/09/2026): dado desconto na mesa, os 10% continuavam sobre o
 * valor cheio. O fechamento já calculava certo; a conta IMPRESSA não recebia
 * o desconto e saía com o consumo cheio e a taxa sobre ele.
 */
import { calcularContaDaMesa, montarCupomDaConta } from "../src/lib/conta-da-mesa";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// Mesa de R$ 100,00: dois pratos de R$ 50.
const mesa = {
  table: { number: 4, label: null },
  waiterTip: null,
  orders: [
    {
      status: "ENTREGUE",
      totalAmount: 100,
      dailyOrderNumber: 76,
      items: [{ productName: "Prato", quantity: 2, price: 50, tableGuestId: null }],
    },
  ],
} as any;

{
  const conta = calcularContaDaMesa(mesa, [], 10, 0, { tipo: "percent", valor: 10, motivo: "Cliente fiel" });
  confere("desconto de 10% sobre 100", conta.desconto.valor, 10);
  confere("taxa de 10% sobre os 90 que sobraram, não sobre 100", conta.taxaServico.valor, 9);
  confere("total = 90 + 9", conta.total, 99);

  // Assistente novo: consumo, desconto, taxa e total em linhas próprias.
  const novo = montarCupomDaConta(conta, { sessionId: "s1", taxaSeparada: true, agora: new Date(0) });
  confere("cupom novo: total impresso é o cobrado", novo.totalAmount, 99);
  confere("cupom novo: leva a linha do desconto", (novo as any).descontoDaConta, { valor: 10, motivo: "Cliente fiel" });
  confere("cupom novo: taxa impressa sobre o descontado", novo.taxaServico, { percentual: 10, valor: 9 });

  // Assistente antigo: tudo vira item, e o desconto precisa ser um deles —
  // senão sai como "Ajuste de centavos -R$ 10,00".
  const antigo = montarCupomDaConta(conta, { sessionId: "s1", taxaSeparada: false, agora: new Date(0) });
  const nomes = antigo.items.map((i) => `${i.name} ${i.price}`);
  confere("cupom antigo: desconto é linha com nome", nomes.includes("Desconto (Cliente fiel) -10"), true);
  confere("cupom antigo: sem ajuste de centavos inventado", nomes.some((n) => n.startsWith("Ajuste de centavos")), false);
  confere("cupom antigo: itens somam o total", Math.round(antigo.items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100, 99);
}

{
  const semDesconto = calcularContaDaMesa(mesa, [], 10, 0, null);
  confere("sem desconto nada muda: taxa 10 e total 110", [semDesconto.taxaServico.valor, semDesconto.total], [10, 110]);
  const antigo = montarCupomDaConta(semDesconto, { sessionId: "s1", taxaSeparada: false, agora: new Date(0) });
  confere("sem desconto não aparece linha de desconto", antigo.items.some((i) => i.name.startsWith("Desconto")), false);
}

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
