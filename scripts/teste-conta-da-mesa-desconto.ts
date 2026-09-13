/**
 * scripts/teste-conta-da-mesa-desconto.ts
 *
 * Prova do desconto da loja na conta da mesa (lib/conta-da-mesa.ts): a tela, o
 * cupom impresso e o fechamento usam esta conta, e os três precisam fechar no
 * centavo.
 *
 *   npx tsx scripts/teste-conta-da-mesa-desconto.ts
 */
import { calcularContaDaMesa, montarCupomDaConta, type MesaParaConta } from "../src/lib/conta-da-mesa";

let falhas = 0;
const conferir = (nome: string, ok: boolean, detalhe?: unknown) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};
const c = (v: number) => Math.round(v * 100);

const pessoas = [
  { id: "ana", name: "Ana" },
  { id: "bia", name: "Bia" },
  { id: "caio", name: "Caio" },
];

function mesa(extra: Partial<MesaParaConta> = {}): MesaParaConta {
  return {
    table: { number: 5, label: "Varanda" },
    waiterTip: null,
    orders: [
      {
        status: "ENTREGUE", totalAmount: 96.4, dailyOrderNumber: 12,
        items: [
          { quantity: 2, price: 34.9, productName: "Pizza broto", tableGuestId: "ana" },
          { quantity: 1, price: 26.6, productName: "Porção de batata", tableGuestId: null },
        ],
      },
      {
        status: "ENTREGUE", totalAmount: 41.9, dailyOrderNumber: 13,
        items: [
          { quantity: 3, price: 8.9, productName: "Refrigerante lata", tableGuestId: "bia" },
          { quantity: 1, price: 15.2, productName: "Suco", tableGuestId: "caio" },
        ],
      },
      {
        // Cancelado: não entra na conta nem na base do desconto.
        status: "CANCELADO", totalAmount: 50, dailyOrderNumber: 14,
        items: [{ quantity: 1, price: 50, productName: "Vinho", tableGuestId: "caio" }],
      },
    ],
    ...extra,
  };
}

console.log("\n1) Sem desconto: nada muda");
const sem = calcularContaDaMesa(mesa(), pessoas, 10, 0);
conferir("consumo 138,30 (cancelado fora)", sem.consumo === 138.3, sem.consumo);
conferir("taxa 10% = 13,83", sem.taxaServico.valor === 13.83, sem.taxaServico);
conferir("total 152,13", sem.total === 152.13, sem.total);
conferir("desconto zerado", sem.desconto.valor === 0 && sem.desconto.tipo === null && sem.desconto.rotulo === null, sem.desconto);
conferir("pessoas somam o total", c(sem.pessoas.reduce((s, p) => s + p.aPagar, 0)) === c(sem.total));
// O rateio ANTES do desconto existir, copiado: sem desconto, cada pessoa tem
// que pagar exatamente o mesmo que pagava.
function rateioAntigo(consumoPorPessoa: number[], daMesa: number, taxa: number, gorjeta: number, total: number): number[] {
  const n = consumoPorPessoa.length;
  const consumoTotal = consumoPorPessoa.reduce((s, x) => s + x, 0) + daMesa;
  const partes = consumoPorPessoa.map((own) => {
    const parteDaMesa = n > 0 ? Math.floor(daMesa / n) : 0;
    const base = consumoTotal > 0 ? own / consumoTotal : 0;
    return own + parteDaMesa + Math.floor((taxa + gorjeta) * base);
  });
  const sobra = total - partes.reduce((s, x) => s + x, 0);
  if (n > 0 && sobra !== 0) partes[0] += sobra;
  return partes;
}
for (const [taxa, gorjeta] of [[10, 0], [0, 0], [12, 7.5], [13, 0.01]] as const) {
  const conta = calcularContaDaMesa(mesa(), pessoas, taxa, gorjeta);
  const antigo = rateioAntigo(
    conta.pessoas.map((p) => c(p.consumo)), c(conta.itensDaMesa.valor), c(conta.taxaServico.valor), c(conta.gorjeta), c(conta.total)
  );
  conferir(`taxa ${taxa}% gorjeta ${gorjeta}: cada pessoa paga o mesmo que no rateio antigo`, conta.pessoas.every((p, i) => c(p.aPagar) === antigo[i]), { novo: conta.pessoas.map((p) => c(p.aPagar)), antigo });
}
const cupomSem = montarCupomDaConta(sem, { sessionId: "s1", agora: new Date("2026-09-12T23:00:00Z") });
conferir("cupom sem linha de desconto", !cupomSem.items.some((i) => i.price < 0 && /Desconto/.test(i.name)));

console.log("\n2) Desconto em reais");
const r20 = calcularContaDaMesa(mesa({ discountType: "VALOR", discountValue: 20, discountReason: "Pedido atrasou" }), pessoas, 10, 0);
conferir("taxa continua sobre o consumo (13,83)", r20.taxaServico.valor === 13.83, r20.taxaServico);
conferir("desconto de 20,00", r20.desconto.valor === 20 && r20.desconto.tipo === "VALOR", r20.desconto);
conferir("total = consumo + taxa - desconto = 132,13", r20.total === 132.13, r20.total);
conferir("rótulo com o motivo", r20.desconto.rotulo === "Desconto: Pedido atrasou", r20.desconto.rotulo);
conferir("as partes das pessoas somam exatamente o total", c(r20.pessoas.reduce((s, p) => s + p.aPagar, 0)) === c(r20.total), r20.pessoas);
conferir("quem consumiu mais leva mais desconto", (r20.pessoas.find((p) => p.id === "ana")!.desconto) > (r20.pessoas.find((p) => p.id === "caio")!.desconto), r20.pessoas);
conferir("por igual acompanha o total com desconto", r20.porIgual === Math.floor(c(r20.total) / 3) / 100, r20.porIgual);
const cupom20 = montarCupomDaConta(r20, { sessionId: "s1", agora: new Date("2026-09-12T23:00:00Z") });
const linha = cupom20.items.find((i) => /Desconto/.test(i.name));
conferir("cupom tem a linha negativa com o motivo", !!linha && linha.price === -20 && linha.name === "Desconto: Pedido atrasou", linha);
conferir("cupom: soma das linhas = total impresso", c(cupom20.items.reduce((s, i) => s + i.price * i.qty, 0)) === c(cupom20.totalAmount), cupom20.items);

console.log("\n3) Desconto em percentual");
const p10 = calcularContaDaMesa(mesa({ discountType: "PERCENTUAL", discountValue: 10, discountReason: "Aniversário" }), pessoas, 10, 5);
conferir("10% do consumo = 13,83", p10.desconto.valor === 13.83, p10.desconto);
conferir("rótulo com o percentual", p10.desconto.rotulo === "Desconto 10%: Aniversário", p10.desconto.rotulo);
conferir("total = 138,30 + 13,83 + 5 gorjeta - 13,83 = 143,30", p10.total === 143.3, p10.total);
conferir("pessoas fecham com gorjeta e desconto", c(p10.pessoas.reduce((s, p) => s + p.aPagar, 0)) === c(p10.total));
const maisPedidos = mesa({ discountType: "PERCENTUAL", discountValue: 10, discountReason: "Aniversário" });
maisPedidos.orders.push({ status: "ENTREGUE", totalAmount: 61.7, dailyOrderNumber: 15, items: [{ quantity: 1, price: 61.7, productName: "Rodízio", tableGuestId: "bia" }] });
const p10b = calcularContaDaMesa(maisPedidos, pessoas, 10, 0);
conferir("percentual acompanha o pedido que chegou depois (10% de 200,00)", p10b.consumo === 200 && p10b.desconto.valor === 20, p10b.desconto);

console.log("\n4) Limites");
const maior = calcularContaDaMesa(mesa({ discountType: "VALOR", discountValue: 500, discountReason: "Cortesia" }), pessoas, 10, 0);
conferir("desconto maior que o consumo fica no consumo (a taxa segue devida)", maior.desconto.valor === 138.3 && maior.total === 13.83, { desconto: maior.desconto.valor, total: maior.total });
conferir("ninguém fica com valor negativo a pagar", maior.pessoas.every((p) => p.aPagar >= 0), maior.pessoas);
conferir("100% com taxa: as partes somam o total", c(maior.pessoas.reduce((s, p) => s + p.aPagar, 0)) === c(maior.total), maior.pessoas);
const cemSemTaxa = calcularContaDaMesa(mesa({ discountType: "PERCENTUAL", discountValue: 100, discountReason: "Cortesia" }), pessoas, 0, 0);
conferir("100% sem taxa: total zero, ninguém paga nem fica negativo", cemSemTaxa.total === 0 && cemSemTaxa.pessoas.every((p) => p.aPagar === 0), cemSemTaxa.pessoas);
const quebrado = calcularContaDaMesa(mesa({ discountType: "VALOR", discountValue: 33.33, discountReason: "Cortesia" }), pessoas, 7, 0);
conferir("R$ 33,33 com taxa 7%: partes fecham no centavo e ninguém negativo", c(quebrado.pessoas.reduce((s, p) => s + p.aPagar, 0)) === c(quebrado.total) && quebrado.pessoas.every((p) => p.aPagar >= 0), quebrado.pessoas);
conferir("os descontos das pessoas somam o desconto da mesa", c(quebrado.pessoas.reduce((s, p) => s + p.desconto, 0)) <= c(quebrado.desconto.valor), quebrado.pessoas.map((p) => p.desconto));
const semTipo = calcularContaDaMesa(mesa({ discountType: null, discountValue: 20, discountReason: "x" }), pessoas, 0, 0);
conferir("valor sem tipo não vale como desconto", semTipo.desconto.valor === 0 && semTipo.total === 138.3, semTipo.desconto);
const semPessoas = calcularContaDaMesa(mesa({ discountType: "VALOR", discountValue: 10, discountReason: "Cliente fiel" }), [], 0, 0);
conferir("mesa sem pessoas: por igual = total", semPessoas.porIgual === semPessoas.total && semPessoas.total === 128.3, semPessoas);

console.log(falhas ? `\n❌ ${falhas} falha(s)\n` : "\n✅ tudo certo\n");
process.exit(falhas ? 1 : 0);
