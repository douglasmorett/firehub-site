/**
 * Levantamento da Brendi (27/09/2026), o que dá para provar sem banco:
 *
 *   • troco: a Brendi manda `change` = valor do pedido quando NÃO há troco
 *     (pedido 6018 da Frangoso, R$ 58,99 em dinheiro) — não é troco;
 *   • forma OTHER vira "Outro", não "Cartão";
 *   • descrição da NFC-e: item da Brendi com as opções no nome vai só com o
 *     cabeçalho e nunca passa de 120 caracteres;
 *   • nome para a comanda: cabeçalho antes do primeiro " | ".
 *
 * Rode: npx tsx scripts/teste-brendi-pagamento-e-nome.ts
 */
import { parseOrderPaymentInfo } from "../src/lib/payment-parser";
import { montarItensDaNota } from "../src/lib/fiscal-itens";
import { nomeDoItem, nomeDoItemParaComanda } from "../src/lib/nome-do-item";

let falhas = 0;
function ok(cond: boolean, msg: string) {
  console.log(`${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) falhas++;
}

// ── Troco ────────────────────────────────────────────────────────────────────
const semTroco = parseOrderPaymentInfo(
  { payments: { prepaid: 0, pending: 58.99, methods: [{ type: "PENDING", method: "CASH", value: 58.99, change: 58.99 }] } } as any,
  "BRENDI" as any
);
ok(semTroco.changeAmount === null, `dinheiro R$ 58,99 com change 58,99 → sem troco (veio ${semTroco.changeAmount})`);
ok(/Dinheiro \(Cobrar na Entrega\)/.test(semTroco.paymentMethod), `forma "${semTroco.paymentMethod}"`);

const comTroco = parseOrderPaymentInfo(
  { payments: { prepaid: 0, pending: 58.99, methods: [{ type: "PENDING", method: "CASH", value: 58.99, change: 100 }] } } as any,
  "BRENDI" as any
);
ok(comTroco.changeAmount === 100, `dinheiro R$ 58,99 com change 100 → troco para 100 (veio ${comTroco.changeAmount})`);

const ifoodTroco = parseOrderPaymentInfo(
  { payments: { prepaid: 0, pending: 40, methods: [{ type: "PENDING", method: "CASH", value: 40, changeFor: 50 }] } } as any,
  "IFOOD" as any
);
ok(ifoodTroco.changeAmount === 50, `iFood changeFor 50 em pedido de 40 → troco para 50 (veio ${ifoodTroco.changeAmount})`);

// ── OTHER ────────────────────────────────────────────────────────────────────
const outro = parseOrderPaymentInfo(
  { payments: { prepaid: 0, pending: 30, methods: [{ type: "PENDING", method: "OTHER", value: 30 }] } } as any,
  "BRENDI" as any
);
ok(/^Outro/.test(outro.paymentMethod), `método OTHER → "${outro.paymentMethod}"`);

// ── Pix pago online continua igual ──────────────────────────────────────────
const pix = parseOrderPaymentInfo(
  { payments: { prepaid: 45.99, pending: 0, methods: [{ type: "PREPAID", method: "PIX", value: 45.99 }] } } as any,
  "BRENDI" as any
);
ok(pix.paymentMethod === "Pix (Pago Online)", `Pix pré-pago → "${pix.paymentMethod}"`);

// ── Descrição da nota ────────────────────────────────────────────────────────
const nomeLongo =
  "Combo Box de Frango GG (1kg) + Acompanhamento (250g)  +  Molhos | Peito de frango | Porção de Batata frita  | 3x Sachē Maionese de Alho | Sachē Maionese de Bacon";
const linhas = montarItensDaNota([
  {
    id: "i1", quantity: 1, price: 105.99, productName: nomeLongo,
    comboSelections: JSON.stringify([{ name: "Peito de frango", quantity: 1, price: 0 }]),
    menuProduct: { id: "brendi-x", name: "Combo Box de Frango GG (1kg) + Acompanhamento (250g)  +  Molhos" },
  } as any,
]);
ok(linhas.length === 1 && linhas[0].descricao === "Combo Box de Frango GG (1kg) + Acompanhamento (250g)  +  Molhos", `nota leva só o cabeçalho: "${linhas[0]?.descricao}"`);
ok(linhas[0].descricao.length <= 120, `descrição com ${linhas[0].descricao.length} caracteres (≤ 120)`);

const semCombo = montarItensDaNota([{ id: "i2", quantity: 1, price: 10, productName: "X".repeat(150), menuProduct: { id: "p" } } as any]);
ok(semCombo[0].descricao.length === 120, `nome de 150 caracteres sem opções é cortado em 120 (veio ${semCombo[0].descricao.length})`);

// ── Nome para a comanda ──────────────────────────────────────────────────────
const item = { productName: "Box de Frango P + molho | Peito de frango | Sachë Malonese verde", comboSelections: "[...]", menuProduct: { name: "Box de Frango P + molho | Peito de frango | Sachē Maionese de Bacon" } };
ok(nomeDoItemParaComanda(item) === "Box de Frango P + molho", `cabeçalho da comanda: "${nomeDoItemParaComanda(item)}"`);
ok(nomeDoItem(item).startsWith("Box de Frango P + molho | Peito de frango | Sachë"), "nome do dia vem de productName, não do espelho");

console.log(falhas === 0 ? "\n✅ tudo certo" : `\n❌ ${falhas} falha(s)`);
process.exit(falhas === 0 ? 0 : 1);
