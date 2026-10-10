/**
 * Mesa em fechamento (lib/mesa-em-fechamento.ts): roxa depois da conta pedida.
 *
 *   npx tsx scripts/teste-mesa-em-fechamento.ts
 *
 * Pedido da Ragnar (Fabiano, 09/10/2026): pediu a conta, o quadrado da mesa
 * muda de cor para a casa saber que ela está para vagar.
 */
import { contaPedidaEm } from "../src/lib/mesa-em-fechamento";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const conta = new Date("2026-10-09T22:00:00-03:00");
const antes = { createdAt: new Date("2026-10-09T21:10:00-03:00"), status: "ENTREGUE" };
const depois = { createdAt: new Date("2026-10-09T22:05:00-03:00"), status: "ACEITO" };

confere("sem conta impressa: só ocupada", contaPedidaEm(null, [antes]), null);
confere("conta impressa depois dos pedidos: em fechamento", contaPedidaEm(conta, [antes]), conta.toISOString());
confere("pediu mais depois da conta: volta a ocupada", contaPedidaEm(conta, [antes, depois]), null);
confere("o pedido de depois foi cancelado: segue em fechamento",
  contaPedidaEm(conta, [antes, { ...depois, status: "CANCELADO" }]), conta.toISOString());
confere("datas em texto (JSON)", contaPedidaEm(conta.toISOString(), [{ createdAt: antes.createdAt.toISOString() }]), conta.toISOString());
confere("data inválida não pinta", contaPedidaEm("lixo", [antes]), null);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
