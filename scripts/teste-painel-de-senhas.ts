/**
 * Prova do Painel de senhas (lib/painel-de-senhas.ts) e da numeração
 * sorteada (lib/senha-aleatoria.ts).
 *
 *   npx tsx scripts/teste-painel-de-senhas.ts
 */
import { senhaDaPosicao } from "../src/lib/senha-aleatoria";
import {
  lerConfigDoPainel, separarSenhas, nomeNaTela, normalizarCodigo, novoCodigo, lerTela, entregadorDePlataforma, type PedidoDoPainel,
} from "../src/lib/painel-de-senhas";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ── Numeração sorteada ───────────────────────────────────────────────────────
const periodo = "loja1:fechamento:abc";
const primeiros900 = Array.from({ length: 900 }, (_, i) => senhaDaPosicao(i + 1, periodo));
confere("900 primeiros pedidos: nenhum número repetido", new Set(primeiros900).size, 900);
confere("900 primeiros pedidos: todos com 3 dígitos (100–999)", primeiros900.every((n) => n >= 100 && n <= 999), true);
confere("mesma posição e mesmo período = mesmo número", senhaDaPosicao(37, periodo), primeiros900[36]);
const seguintes = Array.from({ length: 2000 }, (_, i) => senhaDaPosicao(901 + i, periodo));
confere("do 901º em diante: 4 dígitos", seguintes.every((n) => n >= 1000 && n <= 9999), true);
confere("2.900 pedidos sem repetir", new Set([...primeiros900, ...seguintes]).size, 2900);
const outroPeriodo = Array.from({ length: 10 }, (_, i) => senhaDaPosicao(i + 1, "loja1:fechamento:def"));
confere("caixa novo embaralha diferente", JSON.stringify(outroPeriodo) !== JSON.stringify(primeiros900.slice(0, 10)), true);
const outraLoja = Array.from({ length: 10 }, (_, i) => senhaDaPosicao(i + 1, "loja2:fechamento:abc"));
confere("outra loja embaralha diferente", JSON.stringify(outraLoja) !== JSON.stringify(primeiros900.slice(0, 10)), true);
// Não dá para "contar" pela diferença entre senhas seguidas.
const difs = new Set(primeiros900.slice(1, 50).map((n, i) => n - primeiros900[i]));
confere("as diferenças entre senhas seguidas variam", difs.size > 40, true);
console.log(`   primeiras senhas: ${primeiros900.slice(0, 8).join(", ")}`);

// ── Configuração ─────────────────────────────────────────────────────────────
const vazia = lerConfigDoPainel(null);
confere("config vazia: só balcão, som ligado, 10 min, sem código", [vazia.balcao, vazia.mesa, vazia.delivery, vazia.som, vazia.prontoFicaMin, vazia.codigo], [true, false, false, true, 10, ""]);
confere("tempo fora do limite vira 60", lerConfigDoPainel({ prontoFicaMin: 500 }).prontoFicaMin, 60);
confere("cor inválida volta para a padrão", lerConfigDoPainel({ cor: "red" }).cor, "#22C55E");
confere("recado é cortado em 120", lerConfigDoPainel({ mensagem: "x".repeat(300) }).mensagem.length, 120);
confere("código digitado com espaço e minúscula", normalizarCodigo("k7p 2qx"), "K7P2QX");
confere("código curto não vale", normalizarCodigo("K7P"), "");
const codigos = new Set(Array.from({ length: 200 }, () => novoCodigo()));
confere("código novo: 6 letras sem 0/O/1/I/L", [...codigos].every((c) => /^[A-HJKMNP-Z2-9]{6}$/.test(c)), true);

// ── Nome na tela ─────────────────────────────────────────────────────────────
confere("primeiro nome", nomeNaTela("MARIA DA SILVA"), "Maria");
confere("nome com acento", nomeNaTela("joão pedro"), "João");
confere("nome genérico some", [nomeNaTela("Cliente Balcão"), nomeNaTela("Balcão"), nomeNaTela("Consumidor"), nomeNaTela("Mesa 4"), nomeNaTela("")], ["", "", "", "", ""]);

// ── Quem vai para Preparando e Pronto ────────────────────────────────────────
const agora = new Date("2026-10-13T23:00:00Z").getTime();
const min = (m: number) => new Date(agora - m * 60_000).toISOString();
const pedido = (id: string, n: number, status: string, extra: Partial<PedidoDoPainel> = {}): PedidoDoPainel => ({
  id, dailyOrderNumber: n, customerName: "Ana Souza", status, deliveryType: "RETIRADA",
  kdsStage: "PRODUCTION", readyAt: null, updatedAt: min(1), createdAt: min(10), ...extra,
});
const pedidos: PedidoDoPainel[] = [
  pedido("a", 347, "ACEITO", { createdAt: min(5) }),
  pedido("b", 812, "NOVO", { createdAt: min(8) }),
  pedido("c", 129, "SAIU_ENTREGA", { readyAt: min(2) }),           // pronto pelo KDS
  pedido("d", 560, "PRONTO", { readyAt: min(1) }),                 // pronto pelo quadro
  pedido("e", 233, "SAIU_ENTREGA", { readyAt: min(25) }),          // pronto há muito tempo
  pedido("f", 418, "ACEITO", { kdsStage: "FINISHED", readyAt: min(3) }), // finalizado no KDS, status ainda não andou
  pedido("g", 871, "ACEITO", { deliveryType: "DELIVERY" }),        // delivery desligado
  pedido("h", 95, "ACEITO", { deliveryType: "MESA" }),             // mesa desligada
  pedido("i", 700, "ACEITO", { dailyOrderNumber: null }),          // rascunho sem número
  pedido("j", 701, "ACEITO", { scheduledDatetime: new Date(agora + 3 * 3600_000).toISOString() }), // encomenda
];
const cfg = { ...lerConfigDoPainel({}), mostrarNome: true };
const r = separarSenhas(pedidos, cfg, agora);
confere("Preparando: o mais antigo primeiro", r.preparando.map((s) => s.numero), [812, 347]);
confere("Pronto: o mais recente primeiro; o de 25 min já saiu", r.prontos.map((s) => s.numero), [560, 129, 418]);
confere("primeiro nome vai junto", r.preparando[0].nome, "Ana");
const comTudo = separarSenhas(pedidos, { ...cfg, mesa: true, delivery: true }, agora);
confere("com mesa e delivery ligados", comTudo.preparando.map((s) => s.numero).sort(), [347, 812, 871, 95].sort());
const deliveryPronto = separarSenhas([pedido("k", 300, "SAIU_ENTREGA", { deliveryType: "DELIVERY", readyAt: min(1) })], { ...cfg, delivery: true }, agora);
confere("delivery que já saiu não fica em Pronto", deliveryPronto.prontos.length + deliveryPronto.preparando.length, 0);
const semNome = separarSenhas(pedidos, { ...cfg, mostrarNome: false }, agora);
confere("sem nome quando desligado", semNome.preparando[0].nome, "");

// ── Tela dos motoboys de aplicativo (?tela=motoboy) ─────────────────────────
// Pedidos como estão no banco da Ragnar Burger (07/11/2026, só leitura).
confere("tela: só 'motoboy' liga a dos motoboys", [lerTela("motoboy"), lerTela(null), lerTela("x")], ["motoboy", "balcao", "balcao"]);
const app = (id: string, n: number, status: string, extra: Partial<PedidoDoPainel>): PedidoDoPainel =>
  pedido(id, n, status, { deliveryType: "DELIVERY", customerName: "Fulano", ...extra });
const ifood = (id: string, n: number, ref: string, status: string, extra: Partial<PedidoDoPainel> = {}) =>
  app(id, n, status, { source: "IFOOD", ifoodOrderId: `if-${id}`, ifoodReference: ref, deliveryBy: "IFOOD", ...extra });
const doMotoboy: PedidoDoPainel[] = [
  ifood("m1", 52, "2922", "ACEITO", { createdAt: min(4) }),
  ifood("m2", 41, "3517", "PREPARANDO", { kdsStage: "FINISHED", readyAt: min(2), ifoodDriverStatus: "ARRIVED_AT_ORIGIN" }),
  ifood("m3", 34, "2312", "PRONTO", { readyAt: min(1), ifoodDriverStatus: "COLLECTED" }),            // motoboy já pegou
  app("m4", 54, "ACEITO", { source: "99FOOD", openDeliveryChannel: "99FOOD", openDeliveryReference: "569048", openDeliveryPickupCode: "9380", deliveryBy: "99FOOD", createdAt: min(6) }),
  app("m5", 49, "PREPARANDO", { source: "99FOOD", openDeliveryChannel: "99FOOD", openDeliveryReference: "569046", openDeliveryPickupCode: "7580", deliveryBy: "99FOOD", kdsStage: "FINISHED", readyAt: min(3) }),
  app("m6", 60, "ACEITO", { source: "KEETA", openDeliveryChannel: "KEETA", openDeliveryOrderId: "k1", openDeliveryReference: "1187", deliveryBy: "LOGISTICS" }),
  ifood("m7", 61, "4421", "ACEITO", { deliveryBy: "MERCHANT" }),                                       // iFood com entrega da loja
  app("m8", 62, "ACEITO", { source: "ONLINE" }),                                                        // site, motoboy da loja
  app("m9", 63, "PRONTO", { source: "ONLINE", deliveryBy: "IFOOD", ifoodDriverStatus: "REQUESTED", readyAt: min(1) }), // site com entregador do iFood chamado
  app("m10", 64, "ACEITO", { source: "ONLINE", sobDemandaIfood: "8814" }),                              // site com iFood Sob Demanda
  ifood("m11", 65, "0059", "PRONTO", { deliveryType: "RETIRADA", deliveryBy: "MERCHANT", readyAt: min(1) }), // cliente do iFood retira
  pedido("m12", 66, "ACEITO"),                                                                          // balcão
  app("m13", 67, "SAIU_ENTREGA", { source: "99FOOD", openDeliveryReference: "569040", openDeliveryPickupCode: "1610", deliveryBy: "99FOOD", readyAt: min(1) }),
];
const mot = separarSenhas(doMotoboy, cfg, agora, "motoboy");
const cod = (l: { codigo?: string }[]) => l.map((s) => s.codigo);
confere("motoboy · Preparando: iFood, 99 e Keeta pelo código do app, e o Sob Demanda", cod(mot.preparando).sort(), ["1187", "2922", "8814", "9380"].sort());
confere("motoboy · Pronto: KDS finalizado / PRONTO; o que o motoboy do iFood já coletou saiu", cod(mot.prontos), ["63", "3517", "7580"]);
confere("motoboy · iFood mostra o número do iFood com o nome e o vermelho", (({ codigo, plataforma, corDaPlataforma }) => [codigo, plataforma, corDaPlataforma])(mot.preparando.find((s) => s.id === "m1")!), ["2922", "iFood", "#EA1D2C"]);
confere("motoboy · 99 mostra o código de verificação, em amarelo", (({ codigo, plataforma, corDaPlataforma }) => [codigo, plataforma, corDaPlataforma])(mot.preparando.find((s) => s.id === "m4")!), ["9380", "99Food", "#FFDD00"]);
confere("motoboy · Keeta pelo número de exibição", mot.preparando.find((s) => s.id === "m6")?.plataforma, "Keeta");
confere("motoboy · site com entregador do iFood chamado entra (sem código do iFood, vai o nosso)", mot.prontos.find((s) => s.id === "m9")?.plataforma, "iFood");
const fora = ["m7", "m8", "m11", "m12", "m13", "m3"];
confere("motoboy · entrega própria, retirada, balcão, saiu para entrega e coletado ficam de fora", [...mot.preparando, ...mot.prontos].filter((s) => fora.includes(s.id)).length, 0);
confere("motoboy · 99 sem código de verificação cai no número do pedido no 99", entregadorDePlataforma(app("x", 1, "ACEITO", { source: "99FOOD", openDeliveryReference: "569048", deliveryBy: "99FOOD" }))?.codigo, "569048");
confere("motoboy · aparece mesmo com a caixinha Delivery desligada", cfg.delivery, false);
// O balcão não muda: os mesmos pedidos na tela de sempre.
confere("balcão inalterado com os campos novos no pedido", separarSenhas([...pedidos, ...doMotoboy], cfg, agora).preparando.map((s) => s.numero), [66, 812, 347]); // o 66 é o balcão da lista dos motoboys
confere("balcão não ganha código de app", separarSenhas([...pedidos, ...doMotoboy], { ...cfg, delivery: true }, agora).preparando.some((s) => s.codigo), false);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
