/**
 * A regra da troca de tipo (src/lib/troca-de-tipo.ts), sem banco:
 *   npx tsx scripts/teste-troca-de-tipo.ts
 */
import { avaliarTrocaDeTipo, totalSemATaxa, tipoAtualDoPedido } from "../src/lib/troca-de-tipo";

const dono = { role: "FRANCHISEE", permissions: "" };
const funcionarioSem = { role: "STAFF", permissions: "pedidos" };
const delivery = { status: "ACEITO", deliveryType: "DELIVERY", source: "ONLINE", paymentMethod: "Dinheiro", totalAmount: 58, deliveryFee: 8 };

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  if (!ok) falhas++;
  console.log(`${ok ? "OK  " : "FALHOU"} ${nome}${ok ? "" : ` → ${JSON.stringify(detalhe)}`}`);
}

const a = avaliarTrocaDeTipo(delivery, dono);
confere("delivery a pagar: mesa e balcão", a.pode && a.destinos.join() === "MESA,BALCAO" && !a.barrados.MESA, a);

const pago = avaliarTrocaDeTipo({ ...delivery, paymentMethod: "Pix (Pago Online)", gatewayPaymentId: "pay_1" }, dono);
confere("pago online: mesa barrada, balcão livre", pago.pode && !!pago.barrados.MESA && !pago.barrados.BALCAO, pago);

const confirmado = avaliarTrocaDeTipo({ ...delivery, paymentPaidAt: new Date() }, dono);
confere("pagamento confirmado: mesa barrada", confirmado.pode && !!confirmado.barrados.MESA, confirmado);

const saiu = avaliarTrocaDeTipo({ ...delivery, status: "SAIU_ENTREGA" }, dono);
confere("já saiu: não troca", !saiu.pode, saiu);

const pronto = avaliarTrocaDeTipo({ ...delivery, status: "PRONTO", dispatchedAt: new Date() }, dono);
confere("PRONTO com saída carimbada: não troca", !pronto.pode, pronto);

const ifood = avaliarTrocaDeTipo({ ...delivery, source: "IFOOD", ifoodOrderId: "x" }, dono);
confere("iFood: não troca, motivo fala do app", !ifood.pode && /iFood/.test(ifood.motivo), ifood);

const mesa = avaliarTrocaDeTipo({ ...delivery, deliveryType: "MESA", tableSessionId: "s1" }, dono);
confere("mesa: não troca", !mesa.pode, mesa);

const balcao = avaliarTrocaDeTipo({ ...delivery, deliveryType: "RETIRADA", deliveryFee: 0 }, dono);
confere("balcão/retirada: só mesa", balcao.pode && balcao.destinos.join() === "MESA", balcao);

const cancelado = avaliarTrocaDeTipo({ ...delivery, status: "CANCELADO" }, dono);
confere("cancelado: não troca", !cancelado.pode, cancelado);

const semPermissao = avaliarTrocaDeTipo(delivery, funcionarioSem);
confere("funcionário sem 'editar pedidos': não troca", !semPermissao.pode, semPermissao);

const comPermissao = avaliarTrocaDeTipo(delivery, { role: "STAFF", permissions: "pedidos,editar_pedidos" });
confere("funcionário com 'editar pedidos': troca", comPermissao.pode, comPermissao);

const rascunho = avaliarTrocaDeTipo({ ...delivery, status: "CRIANDO_IA" }, dono);
confere("rascunho do robô: não troca", !rascunho.pode, rascunho);

confere("total sem a taxa", totalSemATaxa({ totalAmount: 58, deliveryFee: 8 }) === 50);
confere("total sem a taxa com centavos", totalSemATaxa({ totalAmount: 41.9, deliveryFee: 6.95 }) === 34.95, totalSemATaxa({ totalAmount: 41.9, deliveryFee: 6.95 }));
confere("total nunca negativo", totalSemATaxa({ totalAmount: 5, deliveryFee: 8 }) === 0);
confere("tipo: PICKUP é balcão", tipoAtualDoPedido({ deliveryType: "PICKUP" }) === "BALCAO");
confere("tipo: vazio é delivery", tipoAtualDoPedido({ deliveryType: null }) === "DELIVERY");

console.log(falhas ? `${falhas} falha(s)` : "Tudo certo");
process.exit(falhas ? 1 : 0);
