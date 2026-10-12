/**
 * scripts/teste-ganho-na-entrega-gratis.ts — entrega grátis para o CLIENTE
 * não é corrida grátis para o MOTOBOY.
 *
 * Hakim Centro #72 (12/10/2026): Pix pelo site com entrega grátis gravou
 * `deliveryFee: 0`, e o acerto pela taxa do pedido pagou R$ 0,00. A conta
 * (lib/ganho-do-entregador.ts) lê o valor cheio de `entregaGratis`.
 *
 *   npx tsx scripts/teste-ganho-na-entrega-gratis.ts
 */
import { ganhoDoPedido, lerAcerto, taxaDaCorrida } from "../src/lib/ganho-do-entregador";
import { lerRegraDeRepasse } from "../src/lib/repasse-do-entregador";

let falhas = 0;
const confere = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✓" : "✗"} ${nome}${ok ? "" : ` — esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}`}`);
};

const pelaTaxa = lerAcerto({ paymentType: "DAILY_PLUS_FEE", dailyRate: 50 });
const porEntrega = lerAcerto({ paymentType: "PER_DELIVERY", perDeliveryRate: 5 });
const gratis = { valor: 7, motivo: "Prêmio da Trilha Premiada" };

confere("taxa cobrada vale", taxaDaCorrida({ deliveryFee: 8, entregaGratis: gratis }), 8);
confere("taxa zerada pela entrega grátis: o valor cheio", taxaDaCorrida({ deliveryFee: 0, entregaGratis: gratis }), 7);
confere("taxa zerada sem entrega grátis: zero", taxaDaCorrida({ deliveryFee: 0, entregaGratis: null }), 0);
confere("entrega grátis inválida: zero", taxaDaCorrida({ deliveryFee: 0, entregaGratis: { valor: "x" } }), 0);

confere(
  "#72: diária + taxa do pedido, entrega grátis",
  ganhoDoPedido({ acerto: pelaTaxa, pedido: { deliveryFee: 0, motoboyFee: null, entregaGratis: gratis } }),
  { valor: 7, origem: "TAXA_DO_CLIENTE" },
);
confere(
  "por entrega não muda",
  ganhoDoPedido({ acerto: porEntrega, pedido: { deliveryFee: 0, motoboyFee: null, entregaGratis: gratis } }),
  { valor: 5, origem: "POR_ENTREGA" },
);
confere(
  "repasse gravado não muda",
  ganhoDoPedido({ acerto: pelaTaxa, pedido: { deliveryFee: 0, motoboyFee: 4, entregaGratis: gratis } }),
  { valor: 4, origem: "GRAVADO" },
);
confere(
  "app com 'pagar o que veio do app' e frete zerado: o valor cheio",
  ganhoDoPedido({
    acerto: lerAcerto({ paymentType: "PER_DELIVERY" }),
    pedido: { deliveryFee: 0, motoboyFee: null, entregaGratis: gratis },
    regraDaLoja: { ...lerRegraDeRepasse({}), marketplace: "APP" } as any,
    ehMarketplace: true,
  }),
  { valor: 7, origem: "REGRA_DA_LOJA" },
);

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1); }
console.log("\nTudo certo.");
