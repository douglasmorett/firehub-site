/**
 * Telefone com máscara e prêmio do Cartão de Carimbos no pedido (17/10/2026).
 *
 *   npx tsx scripts/teste-carimbos-premio.ts
 *
 * Prova, sem banco:
 * 1) a busca acha o pedido por SÓ OS DÍGITOS (máscaras do robô e do balcão, com
 *    e sem o 9, com e sem o 55) — `mesmoTelefoneDoCardapio` é o espelho do SQL;
 * 2) cartela completa aplica o prêmio UMA vez e a cartela recomeça;
 * 3) desconto limitado ao valor dos produtos (não vira troco);
 * 4) prêmio produto (item grátis; produto fora do cardápio guarda o prêmio);
 * 5) não aplica em canal fora do site e do robô; marketplace não ganha carimbo;
 * 6) pedido com prêmio cancelado devolve o prêmio;
 * 7) a etiqueta do pedido, a comanda do robô e o brinde fora da comparação da tag.
 */
import {
  carimbosNoAr,
  contarCarimbos,
  efeitoDosCarimbos,
  ehItemDoPremioDosCarimbos,
  etiquetaDoPremioDosCarimbos,
  ganhaCarimbo,
  lerCarimbos,
  lerResgateDosCarimbos,
  NOTA_DO_ITEM_DO_PREMIO,
  type PedidoDoCarimbo,
} from "../src/lib/carimbos";
import { finalDoTelefone, mesmoTelefoneDoCardapio } from "../src/lib/pedidos-do-telefone";
import { comandaDoRobo } from "../src/lib/comanda-do-robo";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── 1) Telefone com máscara ──────────────────────────────────────────────────
console.log("\n1) A busca compara só os dígitos");
// As grafias reais da Pizzaria Lapastine (Neon, 17/10/2026).
const GRAVADOS: [string, string][] = [
  ["+55 (91) 8011-9516", "91980119516"], // robô do WhatsApp, sem o 9 na gravação
  ["(91) 9914-1284", "91999141284"],     // balcão
  ["+55 (91) 9914-1284", "(91) 99914-1284"],
  ["9198044-9586", "91 98044-9586"],
  ["918751-8026", "91987518026"],
  ["98554-5702", "+55 91 98554-5702"],
  ["91991077190", "91991077190"],        // site, sem máscara
  ["5591991077190", "(91) 99107-7190"],
];
for (const [gravado, digitado] of GRAVADOS) {
  confere(`"${gravado}" é achado por "${digitado}"`, mesmoTelefoneDoCardapio(gravado, digitado), true);
}
confere("antes (texto CONTÉM os 8 dígitos) a máscara escondia o pedido",
  GRAVADOS.filter(([g, d]) => g.includes(finalDoTelefone(d)!)).length, 2);
confere("outro número não casa", mesmoTelefoneDoCardapio("+55 (91) 8011-9517", "91980119516"), false);
confere("8 dígitos no MEIO de um número maior não casam (o fim é que conta)",
  mesmoTelefoneDoCardapio("80119516 9999", "91980119516"), false);
confere("telefone curto não procura nada", [finalDoTelefone("1234567"), mesmoTelefoneDoCardapio("1234567", "1234567")], [null, false]);
confere("vazio não casa com vazio", mesmoTelefoneDoCardapio("", ""), false);

// ── 2) Cartela completa aplica uma vez ───────────────────────────────────────
console.log("\n2) Cartela completa: o prêmio entra uma vez e a cartela recomeça");
const LAPASTINE = { stampsActive: true, stampGoal: 10, stampMinOrder: 43, stampRewardType: "discount", stampRewardValue: 50 };
const regra = lerCarimbos(LAPASTINE);
let seq = 0;
const ped = (totalAmount: number, extra: Partial<PedidoDoCarimbo> = {}): PedidoDoCarimbo =>
  ({ id: `p${++seq}`, status: "ENTREGUE", source: "ONLINE", totalAmount, ...extra });
const nove = Array.from({ length: 9 }, () => ped(60));
confere("9 carimbos: nada a receber, sem efeito no pedido",
  [contarCarimbos(regra, nove).aReceber, efeitoDosCarimbos(regra, contarCarimbos(regra, nove), { canal: "site", produtosAPagar: 80 })], [0, null]);
const dez = [...nove, ped(60, { source: "WHATSAPP_IA" })];
const cartaoDez = contarCarimbos(regra, dez);
confere("o 10º (pelo robô) completa: 1 a receber", [cartaoDez.noCartao, cartaoDez.completas, cartaoDez.aReceber], [0, 1, 1]);
const efeito = efeitoDosCarimbos(regra, cartaoDez, { canal: "site", produtosAPagar: 80 }, new Date("2026-10-17T12:00:00Z"))!;
confere("o 11º pedido pelo site recebe R$ 50 de desconto, cartela 1",
  [efeito.descontoExtra, efeito.produtoGratis, efeito.resgate.cartela, efeito.resgate.valorAplicado, efeito.resgate.programa],
  [50, null, 1, 50, "carimbos"]);
// O pedido é gravado com a marca; o total já vem com o desconto (R$ 80 - 50 = 30).
const onze = [ped(30, { carimboPremio: efeito.resgate }), ...dez];
const cartaoOnze = contarCarimbos(regra, onze);
confere("depois de usado: nada a receber (não dá duas vezes)", [cartaoOnze.usados, cartaoOnze.aReceber], [1, 0]);
confere("e o 12º pedido não recebe de novo", efeitoDosCarimbos(regra, cartaoOnze, { canal: "site", produtosAPagar: 80 }), null);
confere("a cartela recomeça: o pedido de R$ 30 ficou abaixo do mínimo, 0 de 10", cartaoOnze.noCartao, 0);
const comNovos = [ped(60), ped(45), ...onze];
confere("dois pedidos depois: 2 de 10, nada a receber", [contarCarimbos(regra, comNovos).noCartao, contarCarimbos(regra, comNovos).aReceber], [2, 0]);
const vinte = [...Array.from({ length: 10 }, () => ped(60)), ...onze];
const cartaoVinte = contarCarimbos(regra, vinte);
confere("20 carimbos e 1 prêmio usado: a 2ª cartela está a receber", [cartaoVinte.completas, cartaoVinte.usados, cartaoVinte.aReceber], [2, 1, 1]);
confere("e o próximo resgate é a cartela 2", efeitoDosCarimbos(regra, cartaoVinte, { canal: "whatsapp", produtosAPagar: 99 })?.resgate.cartela, 2);
const vinteSemUsar = [...Array.from({ length: 10 }, () => ped(60)), ...dez];
confere("2 cartelas sem usar: 2 a receber, mas UM prêmio por pedido",
  [contarCarimbos(regra, vinteSemUsar).aReceber, efeitoDosCarimbos(regra, contarCarimbos(regra, vinteSemUsar), { canal: "site", produtosAPagar: 200 })?.descontoExtra],
  [2, 50]);
confere("rascunho do robô e Pix esperando pagamento não completam cartela",
  contarCarimbos(regra, [...nove, ped(60, { status: "CRIANDO_IA" }), ped(60, { status: "AGUARDANDO_PAGAMENTO" })]).aReceber, 0);

// ── 3) Desconto limitado ─────────────────────────────────────────────────────
console.log("\n3) Desconto: até o valor dos produtos, não vira troco");
const pequeno = efeitoDosCarimbos(regra, cartaoDez, { canal: "site", produtosAPagar: 32.9 })!;
confere("pedido de R$ 32,90 com prêmio de R$ 50: abate R$ 32,90 e gasta o prêmio",
  [pequeno.descontoExtra, pequeno.resgate.valorAplicado, pequeno.resgate.valor], [32.9, 32.9, 50]);
confere("produtos já pagos pelo cupom (R$ 0 a pagar): o prêmio não é consumido",
  efeitoDosCarimbos(regra, cartaoDez, { canal: "site", produtosAPagar: 0 }), null);
confere("centavos arredondados", efeitoDosCarimbos(regra, cartaoDez, { canal: "site", produtosAPagar: 10.005 })?.descontoExtra, 10.01);

// ── 4) Produto ───────────────────────────────────────────────────────────────
console.log("\n4) Prêmio produto: item grátis, como o da trilha");
const PRODUTO = { ...LAPASTINE, stampRewardType: "product", stampRewardProductId: "prd_guarana", stampRewardProductName: "GUARANA TUCHAUA 1 LT" };
const regraProduto = lerCarimbos(PRODUTO);
const cartaoProduto = contarCarimbos(regraProduto, dez);
const guarana = { id: "prd_guarana", name: "GUARANA TUCHAUA 1 LT", price: 9.9, active: true };
const efeitoProduto = efeitoDosCarimbos(regraProduto, cartaoProduto, { canal: "whatsapp", produtosAPagar: 80, produto: guarana })!;
confere("o produto entra grátis, sem desconto em R$, e o resgate guarda o preço",
  [efeitoProduto.descontoExtra, efeitoProduto.produtoGratis, efeitoProduto.resgate.tipo, efeitoProduto.resgate.valorAplicado],
  [0, { id: "prd_guarana", nome: "GUARANA TUCHAUA 1 LT", preco: 9.9 }, "product", 9.9]);
confere("produto desativado no cardápio: o prêmio fica guardado",
  efeitoDosCarimbos(regraProduto, cartaoProduto, { canal: "site", produtosAPagar: 80, produto: { ...guarana, active: false } }), null);
confere("produto apagado do cardápio: o prêmio fica guardado",
  efeitoDosCarimbos(regraProduto, cartaoProduto, { canal: "site", produtosAPagar: 80, produto: null }), null);
confere("produto sem produto escolhido: o cartão não vai ao ar",
  carimbosNoAr(lerCarimbos({ ...LAPASTINE, stampRewardType: "product" })), false);
confere("o brinde é reconhecido pela observação e preço zero",
  [ehItemDoPremioDosCarimbos({ notes: NOTA_DO_ITEM_DO_PREMIO, price: 0 }), ehItemDoPremioDosCarimbos({ notes: NOTA_DO_ITEM_DO_PREMIO, price: 9.9 }), ehItemDoPremioDosCarimbos({ notes: "sem cebola", price: 0 })],
  [true, false, false]);

// ── 5) Canal fora ────────────────────────────────────────────────────────────
console.log("\n5) Só site e robô aplicam; marketplace não ganha carimbo");
for (const canal of ["balcao", "mesa", "totem", "marketplace", "ifood"]) {
  confere(`canal ${canal}: o prêmio não entra (e não é consumido)`, efeitoDosCarimbos(regra, cartaoDez, { canal, produtosAPagar: 80 }), null);
}
confere("pedido do iFood e da 99 não ganham carimbo",
  [ganhaCarimbo(ped(80, { source: "IFOOD", ifoodOrderId: "x" }), regra), ganhaCarimbo(ped(80, { openDeliveryChannel: "99FOOD", source: "OPEN_DELIVERY" }), regra)], [false, false]);
confere("balcão, mesa e robô ganham carimbo (venda da casa)",
  [ganhaCarimbo(ped(80, { source: "PRESENCIAL" }), regra), ganhaCarimbo(ped(80, { source: "PRESENCIAL", tableSessionId: "m1" }), regra), ganhaCarimbo(ped(80, { source: "WHATSAPP_IA" }), regra)],
  [true, true, true]);
confere("lanche da equipe não ganha carimbo", ganhaCarimbo(ped(80, { source: "EQUIPE" }), regra), false);
confere("cartão desligado: nada aplica", efeitoDosCarimbos(lerCarimbos({ ...LAPASTINE, stampsActive: false }), cartaoDez, { canal: "site", produtosAPagar: 80 }), null);
confere("prêmio R$ 0 (Point da Pizza): cartão fora do ar, nada aplica",
  [carimbosNoAr(lerCarimbos({ ...LAPASTINE, stampRewardValue: 0 })), efeitoDosCarimbos(lerCarimbos({ ...LAPASTINE, stampRewardValue: 0 }), cartaoDez, { canal: "site", produtosAPagar: 80 })],
  [false, null]);
confere("mínimo 0 na configuração = qualquer pedido ganha (antes virava R$ 30)",
  ganhaCarimbo(ped(12), lerCarimbos({ ...LAPASTINE, stampMinOrder: 0 })), true);

// ── 6) Cancelado devolve ─────────────────────────────────────────────────────
console.log("\n6) Pedido com prêmio cancelado devolve o prêmio");
for (const status of ["CANCELADO", "CANCELLED", "RECUSADO"]) {
  const cancelou = [ped(30, { carimboPremio: efeito.resgate, status }), ...dez];
  const c = contarCarimbos(regra, cancelou);
  confere(`pedido ${status}: o prêmio volta (1 a receber, 0 usado)`, [c.usados, c.aReceber], [0, 1]);
}
const esperandoPix = contarCarimbos(regra, [ped(30, { carimboPremio: efeito.resgate, status: "AGUARDANDO_PAGAMENTO" }), ...dez]);
confere("Pix ainda esperando pagamento SEGURA o prêmio (não dá para usar em dois pedidos)", [esperandoPix.usados, esperandoPix.aReceber], [1, 0]);
const rascunho = contarCarimbos(regra, [ped(30, { carimboPremio: efeito.resgate, status: "CRIANDO_IA" }), ...dez]);
confere("rascunho do robô com o prêmio também segura (a faxina cancela e devolve)", [rascunho.usados, rascunho.aReceber], [1, 0]);
const pedidoQueCompletouCancelado = contarCarimbos(regra, [ped(30, { carimboPremio: efeito.resgate }), ped(60, { status: "CANCELADO" }), ...nove]);
confere("o pedido que completou a cartela foi cancelado DEPOIS do prêmio usado: nada é cobrado de volta",
  [pedidoQueCompletouCancelado.completas, pedidoQueCompletouCancelado.usados, pedidoQueCompletouCancelado.aReceber], [0, 1, 0]);

// ── 7) Registro e textos ─────────────────────────────────────────────────────
console.log("\n7) A marca no pedido, a etiqueta e a comanda");
confere("a marca é lida de volta (e a da trilha não é confundida com ela)",
  [lerResgateDosCarimbos(efeito.resgate)?.cartela, lerResgateDosCarimbos({ pedidos: 5, tipo: "frete", valorAplicado: 8 })], [1, null]);
confere("etiqueta da observação", [etiquetaDoPremioDosCarimbos(efeito.resgate), etiquetaDoPremioDosCarimbos(efeitoProduto.resgate)],
  ["[Cartão de Carimbos: -R$ 50,00]", "[Cartão de Carimbos: GUARANA TUCHAUA 1 LT grátis]"]);
const comanda = comandaDoRobo({
  numero: 12, status: "NOVO", itens: [{ quantity: 1, productName: "Pizza G", price: 80 }],
  formaDePagamento: "Pix", entrega: true, taxaDeEntrega: 6, total: 36,
  premioDosCarimbos: { descricao: "R$ 50,00 de desconto", desconto: 50 },
});
confere("comanda do robô: linha do cartão entre o subtotal e o total",
  ["Subtotal: R$ 80,00", "🎫 Cartão de Carimbos completo: -R$ 50,00", "*Total: R$ 36,00*"].every((l) => comanda.includes(l)), true);
const comandaProduto = comandaDoRobo({
  numero: 13, status: "NOVO",
  itens: [{ quantity: 1, productName: "Pizza G", price: 80 }, { quantity: 1, productName: "GUARANA TUCHAUA 1 LT", price: 0, notes: NOTA_DO_ITEM_DO_PREMIO }],
  formaDePagamento: "Pix", entrega: false, taxaDeEntrega: 0, total: 80,
  premioDosCarimbos: { descricao: "GUARANA TUCHAUA 1 LT", desconto: 0 },
});
confere("comanda do robô: o brinde sai nos itens e o aviso de presente",
  [comandaProduto.includes("1x GUARANA TUCHAUA 1 LT"), comandaProduto.includes("GUARANA TUCHAUA 1 LT vai de presente")], [true, true]);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
