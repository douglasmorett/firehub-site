/**
 * CANCELAMENTOS E CORTESIAS (lib/relatorios/cancelamentos.ts, lib/cortesia.ts)
 * e o DESCONTO MANUAL POR OPERADOR (lib/relatorios/descontos.ts,
 * descontosManuaisPorOperador). Sintético, sem banco.
 *
 *   npx tsx scripts/teste-cancelamentos.ts
 *
 * O Alex (Hambúrgueria Avenida) veio do SWFast, onde o relatório de
 * cancelamentos é cupom × item por operador e motivo, e a cortesia tem
 * cliente, motivo, valor e operador. Aqui se prova:
 *
 *   1. A cortesia: quando pode, o plano (inteira ou parte das unidades) e que
 *      ela sai da venda (régua) sem sair do pedido.
 *   2. O relatório: item tirado × pedido inteiro, pela hora do cancelamento;
 *      o operador pelo id (e o nome antigo cai no mesmo grupo); "Operador não
 *      registrado"; os de fora (iFood, cliente) à parte; os alertas (depois da
 *      conta impressa, de pronto, da cozinha); o operador fora da curva; por
 *      motivo e por produto; as cortesias; o % sobre o valor vendido.
 *   3. O desconto manual por quem deu e motivo: balcão com rastro, balcão
 *      antigo, edição, conta da mesa nova (rastro) e antiga (quem fechou).
 *   4. As rotas gravam o operador (nome + id) nos caminhos que cancelam,
 *      tiram item, dão desconto e cortesia.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cancelamentosDoPeriodo, chaveDoOperador, mapaDeNomesParaId, nomeDoOperadorDoRastro, OPERADOR_NAO_REGISTRADO } from "../src/lib/relatorios/cancelamentos";
import { cortesiaNaEdicao, planejarCortesia } from "../src/lib/cortesia";
import { descontosManuaisPorOperador, rastroDoDesconto } from "../src/lib/relatorios/descontos";
import { entraNaVenda, totalDosItens } from "../src/lib/relatorios/regua-da-venda";
import { recalcularTotal } from "../src/lib/edicao-de-pedido";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

const TZ = "America/Sao_Paulo";
// 06/11/2026 inteiro no dia operacional (vira às 5h, -03:00): 08:00Z de 06/11 até 08:00Z de 07/11.
const INICIO = new Date("2026-11-06T08:00:00.000Z");
const FIM = new Date("2026-11-07T08:00:00.000Z");
const h = (hhmm: string, dia = "2026-11-06") => new Date(`${dia}T${hhmm}:00.000-03:00`).toISOString();

// ── 1. CORTESIA ─────────────────────────────────────────────────────────────
function secaoCortesia() {
  console.log("\n— 1. Cortesia");
  const itens = [
    { id: "a", quantity: 2, price: 9, productName: "Cerveja" },
    { id: "b", quantity: 1, price: 30, productName: "X-Bacon" },
    { id: "c", quantity: 1, price: 0, productName: "Brinde" },
  ];
  const parte = planejarCortesia(itens, { itemId: "a", quantidade: 1 });
  confere("1 de 2 cervejas: separa a linha, vale R$ 9", parte.ok && { separa: parte.separa, linha: parte.linha, descricao: parte.descricao },
    { separa: true, linha: { nome: "Cerveja", quantidade: 1, valor: 9 }, descricao: "cortesia: 1x Cerveja (R$ 9,00)" });
  const inteira = planejarCortesia(itens, { itemId: "b" });
  confere("Sem quantidade = o item inteiro, não separa", inteira.ok && { separa: inteira.separa, valor: inteira.linha.valor }, { separa: false, valor: 30 });
  confere("Item já a R$ 0,00 não vira cortesia", planejarCortesia(itens, { itemId: "c" }).ok, false);
  confere("Mais unidades que o item tem: recusa", planejarCortesia(itens, { itemId: "a", quantidade: 3 }).ok, false);

  // O pedido depois da cortesia do X-Bacon: o total cai 30, a taxa e o desconto ficam.
  const depois = [{ price: 9, quantity: 2 }, { price: 0, quantity: 1 }];
  confere("Total refeito: 18 + entrega 5 − desconto 2 = 21", recalcularTotal({ itens: depois, deliveryFee: 5, discountTotal: 2 }), 21);
  confere("Régua: o item a R$ 0,00 não soma no total dos itens", totalDosItens({ items: depois }), 18);
  confere("Régua: o pedido continua sendo venda (o valor vendido é o total, já sem a cortesia)", entraNaVenda({ status: "ENTREGUE", totalAmount: 21, items: depois }), true);

  const balcao = { status: "ACEITO", source: "PRESENCIAL", paymentMethod: "Dinheiro" } as any;
  confere("Balcão no dinheiro: pode", cortesiaNaEdicao(balcao, { modo: "COMPLETO", totalMuda: true }).pode, true);
  confere("Mesa aberta: pode", cortesiaNaEdicao({ status: "ACEITO", tableSessionId: "s1" } as any, { modo: "MESA", totalMuda: true }).pode, true);
  confere("iFood: não pode (o cliente pagou lá)", cortesiaNaEdicao({ status: "ACEITO", ifoodOrderId: "x" } as any, { modo: "MARKETPLACE", totalMuda: false, canal: "iFood" }).pode, false);
  confere("Pago online: não pode", cortesiaNaEdicao({ status: "ACEITO", gatewayPaymentId: "pay_1" } as any, { modo: "COMPLETO", totalMuda: true }).pode, false);
  confere("Bloqueado (sem permissão / nota): não pode", cortesiaNaEdicao(balcao, { modo: "BLOQUEADO", motivo: "sem permissão" }).pode, false);
}

// ── 2. O RELATÓRIO ──────────────────────────────────────────────────────────
function secaoRelatorio() {
  console.log("\n— 2. Cancelamentos e cortesias");
  const base = { deliveryType: "MESA", source: "PRESENCIAL" };
  const pedidos: any[] = [
    // Mesa 4: a conta foi impressa às 21h00 e a Ana tirou a Coca às 21h10 → DEPOIS DA CONTA.
    { id: "m1", ...base, tableSessionId: "s4", mesa: "Mesa 4", createdAt: h("20:00"), status: "ACEITO", totalAmount: 50, dailyOrderNumber: 11,
      editHistory: [{ quando: h("21:10"), quem: "Ana (funcionário)", quemId: "u-ana", acao: "REMOVEU", descricao: "−Coca", totalAntes: 58, totalDepois: 50, motivo: "Cliente desistiu", itensRetirados: [{ nome: "Coca", quantidade: 1, valor: 8 }] }] },
    // Delivery cancelado inteiro pela Ana — registro ANTIGO, só com o nome: cai no grupo do id dela. Já estava pronto.
    { id: "d1", deliveryType: "DELIVERY", source: "ONLINE", createdAt: h("19:00"), status: "CANCELADO", cancelledBy: "LOJA", cancelReason: "Erro de lançamento", cancelledAt: h("19:40"),
      totalAmount: 60, readyAt: h("19:30"), dailyOrderNumber: 12, items: [{ productName: "X-Bacon", quantity: 2, price: 30 }],
      editHistory: [{ quando: h("19:40"), quem: "Ana (funcionário)", acao: "CANCELOU", descricao: "Pedido cancelado pelo painel", totalAntes: 60, totalDepois: 0, motivo: "Erro de lançamento" }] },
    // Rodada da Mesa 4 lançada ONTEM e cancelada hoje (11h) pela Ana: entra hoje, com os itens do rastro. Comanda já impressa → DEPOIS DA COZINHA.
    { id: "m2", ...base, tableSessionId: "s9", mesa: "Mesa 9", createdAt: h("23:30", "2026-11-05"), status: "CANCELADO", cancelledBy: "LOJA", cancelledAt: h("11:00"), totalAmount: 40,
      printedAt: h("23:31", "2026-11-05"), dailyOrderNumber: 30,
      editHistory: [{ quando: h("11:00"), quem: "Ana (funcionário)", quemId: "u-ana", acao: "CANCELOU", descricao: "Rodada cancelada", totalAntes: 40, totalDepois: 0, motivo: "Erro de lançamento", itensRetirados: [{ nome: "X-Bacon", quantidade: 1, valor: 30 }, { nome: "Batata", quantidade: 1, valor: 10 }] }] },
    // Bruno tira uma batata (R$ 10) de um balcão.
    { id: "b1", deliveryType: "RETIRADA", source: "PRESENCIAL", createdAt: h("12:00"), status: "ENTREGUE", totalAmount: 20, dailyOrderNumber: 13,
      editHistory: [{ quando: h("12:05"), quem: "Bruno (dono)", quemId: "u-bruno", acao: "MUDOU_QTD", descricao: "Batata 2x → 1x", totalAntes: 30, totalDepois: 20, motivo: "cliente desistiu", itensRetirados: [{ nome: "Batata", quantidade: 1, valor: 10 }] }] },
    // Carla tira um suco (R$ 7).
    { id: "c1", deliveryType: "RETIRADA", source: "PRESENCIAL", createdAt: h("13:00"), status: "ENTREGUE", totalAmount: 30, dailyOrderNumber: 14,
      editHistory: [{ quando: h("13:05"), quem: "Carla (funcionário)", quemId: "u-carla", acao: "REMOVEU", descricao: "−Suco", totalAntes: 37, totalDepois: 30, motivo: "Falta de produto", itensRetirados: [{ nome: "Suco", quantidade: 1, valor: 7 }] }] },
    // Cancelado pela loja sem rastro (caminho antigo): "Operador não registrado".
    { id: "x1", deliveryType: "DELIVERY", source: "ONLINE", createdAt: h("14:00"), status: "CANCELADO", cancelledBy: "LOJA", cancelReason: "Pedido duplicado", cancelledAt: h("14:10"), totalAmount: 25, dailyOrderNumber: 15,
      items: [{ productName: "Pizza", quantity: 1, price: 25 }] },
    // Cancelado pelo iFood: por fora, sem operador nem alerta.
    { id: "i1", deliveryType: "DELIVERY", source: "IFOOD", ifoodOrderId: "if-1", createdAt: h("15:00"), status: "CANCELADO", cancelledBy: "IFOOD", cancelledAt: h("15:20"), totalAmount: 80, readyAt: h("15:10") },
    // Cancelamento de ONTEM (fora do período), num pedido de ontem.
    { id: "o1", deliveryType: "DELIVERY", source: "ONLINE", createdAt: h("10:00", "2026-11-05"), status: "CANCELADO", cancelledBy: "LOJA", cancelledAt: h("10:10", "2026-11-05"), totalAmount: 99,
      editHistory: [{ quando: h("10:10", "2026-11-05"), quem: "Ana (funcionário)", quemId: "u-ana", acao: "CANCELOU", descricao: "x", totalAntes: 99, totalDepois: 0, motivo: "Ontem" }] },
    // Cortesia do Bruno: sobremesa de aniversário (R$ 15) numa mesa que continua; o pedido vale 100 depois dela.
    { id: "m3", ...base, tableSessionId: "s5", mesa: "Mesa 5", customerName: "Joana", createdAt: h("20:30"), status: "ENTREGUE", totalAmount: 100, dailyOrderNumber: 16,
      editHistory: [{ quando: h("21:30"), quem: "Bruno (dono)", quemId: "u-bruno", acao: "CORTESIA", descricao: "cortesia: 1x Petit gâteau (R$ 15,00)", totalAntes: 115, totalDepois: 100, motivo: "Aniversário", itensCortesia: [{ nome: "Petit gâteau", quantidade: 1, valor: 15 }] }] },
    // Mais duas da Ana, para o fora da curva (Ana bem acima de Bruno e Carla).
    { id: "a2", deliveryType: "RETIRADA", source: "PRESENCIAL", createdAt: h("16:00"), status: "ENTREGUE", totalAmount: 10,
      editHistory: [{ quando: h("16:01"), quem: "Ana (funcionário)", quemId: "u-ana", acao: "REMOVEU", descricao: "−Combo", totalAntes: 45, totalDepois: 10, motivo: "Cliente desistiu", itensRetirados: [{ nome: "Combo", quantidade: 1, valor: 35 }] }] },
  ];
  const contasImpressas = new Map([["s4", h("21:00")]]);
  const r = cancelamentosDoPeriodo(pedidos, { tz: TZ, inicio: INICIO, fim: FIM, contasImpressas });

  confere("Nome do rastro sem o papel", nomeDoOperadorDoRastro("Ana (funcionário)"), "Ana");
  const mapa = mapaDeNomesParaId(pedidos.map((p) => p.editHistory));
  confere("Nome antigo sem id cai no id que o nome já teve", chaveDoOperador("Ana (funcionário)", null, mapa).chave, "id:u-ana");

  // Da loja no período: m1 (8), d1 (60), m2 (40), b1 (10), c1 (7), x1 (25), a2 (35) = 185. Fora: o1 (ontem), i1 (iFood).
  confere("Cancelado pela loja: 7 cancelamentos, R$ 185", [r.resumo.cancelamentos, r.resumo.valor], [7, 185]);
  confere("Pedidos inteiros: d1, m2, x1 = R$ 125", [r.resumo.pedidos, r.resumo.valorPedidos], [3, 125]);
  confere("Itens tirados: m1, b1, c1, a2 = R$ 60, 4 unidades", [r.resumo.itens, r.resumo.valorItens, r.resumo.unidades], [4, 60, 4]);
  confere("A rodada de ontem cancelada hoje entra hoje, com os itens do rastro", r.lista.find((l) => l.pedidoId === "m2")?.itens, "1x X-Bacon, 1x Batata");
  confere("O cancelamento de ontem não entra", r.lista.some((l) => l.pedidoId === "o1"), false);
  confere("iFood vai para 'por fora'", r.porFora, [{ quem: "pelo iFood", pedidos: 1, valor: 80 }]);
  confere("Sem rastro: 'Operador não registrado' (1)", [r.lista.find((l) => l.pedidoId === "x1")?.quem, r.resumo.semOperador], [OPERADOR_NAO_REGISTRADO, 1]);
  confere("Pedido inteiro sem itens no rastro usa os itens do pedido", r.lista.find((l) => l.pedidoId === "d1")?.itens, "2x X-Bacon");

  confere("Alerta: Coca tirada depois da conta impressa", r.lista.find((l) => l.pedidoId === "m1")?.alertas, ["DEPOIS_DA_CONTA"]);
  confere("Alerta: delivery cancelado depois de pronto", r.lista.find((l) => l.pedidoId === "d1")?.alertas, ["DEPOIS_DE_PRONTO"]);
  confere("Alerta: rodada cancelada depois de a comanda sair", r.lista.find((l) => l.pedidoId === "m2")?.alertas, ["DEPOIS_DA_COZINHA"]);
  confere("Sem alerta: a batata do balcão", r.lista.find((l) => l.pedidoId === "b1")?.alertas, []);
  confere("Para conferir: 3 cancelamentos, R$ 108", [r.resumo.comAlerta, r.resumo.valorComAlerta], [3, 108]);

  const ana = r.porOperador.find((o) => o.nome === "Ana");
  confere("Ana: 4 cancelamentos (o antigo junto), R$ 143", ana && [ana.cancelamentos, ana.valor, ana.chave], [4, 143, "id:u-ana"]);
  confere("Ana fora da curva (R$ 143 contra média de R$ 8,50 dos outros)", r.foraDaCurva, ["Ana"]);
  confere("Bruno: 1 cancelamento e 1 cortesia de R$ 15", (() => { const b = r.porOperador.find((o) => o.nome === "Bruno"); return b && [b.cancelamentos, b.cortesias, b.valorCortesias, b.foraDaCurva]; })(), [1, 1, 15, false]);

  confere("Por motivo: 'Cliente desistiu' junta a grafia minúscula (3, R$ 53)", (() => { const m = r.porMotivo.find((x) => x.motivo === "Cliente desistiu"); return m && [m.cancelamentos, m.valor]; })(), [3, 53]);
  confere("Por produto: X-Bacon em 2 cancelamentos, 3 unidades, R$ 90", (() => { const p = r.porProduto.find((x) => x.nome === "X-Bacon"); return p && [p.vezes, p.quantidade, p.valor]; })(), [2, 3, 90]);

  confere("Cortesia: Joana, Bruno, Aniversário, R$ 15", r.cortesias.map((c) => [c.cliente, c.quem, c.motivo, c.valor, c.onde]), [["Joana", "Bruno", "Aniversário", 15, "Mesa 5"]]);
  // Valor vendido de hoje: m1 50 + b1 20 + c1 30 + m3 100 + a2 10 = 210 (m2 é de ontem e cancelado; os cancelados não são venda).
  confere("Valor vendido R$ 210; cancelado 88,095% dele; cortesias 7,143%", [r.resumo.valorVendido, r.resumo.pctDoValorVendido, r.resumo.pctCortesias], [210, 88.095, 7.143]);
  confere("Lista do mais recente para o mais antigo", r.lista[0].pedidoId, "m1");
}

// ── 3. DESCONTO MANUAL POR OPERADOR ─────────────────────────────────────────
function secaoDescontos() {
  console.log("\n— 3. Desconto manual por quem deu e motivo");
  const balcao = { deliveryType: "RETIRADA", source: "PRESENCIAL", status: "ENTREGUE" };
  const pedidos: any[] = [
    // Balcão novo: o rastro do lançamento diz quem deu; o motivo vem da observação.
    { id: "p1", ...balcao, createdAt: h("12:00"), totalAmount: 45, discountTotal: 5, discountMerchant: 5, dailyOrderNumber: 1, notes: "[Desconto: R$ 5,00 — Cliente fiel]",
      editHistory: [{ quando: h("12:00"), quem: "Caixa Rita (funcionário)", quemId: "u-rita", acao: "DESCONTO", descricao: "desconto no lançamento: R$ 5,00", totalAntes: 50, totalDepois: 45 }] },
    // Balcão antigo: sem rastro.
    { id: "p2", ...balcao, createdAt: h("13:00"), totalAmount: 18, discountTotal: 2, discountMerchant: 2, dailyOrderNumber: 2, notes: "[Desconto: 10% (R$ 2,00) — Pedido atrasado]" },
    // Edição do pedido (desconto junto com a remoção de item): o registro de item com "desconto" na descrição.
    { id: "p3", deliveryType: "DELIVERY", source: "ONLINE", status: "ENTREGUE", createdAt: h("14:00"), totalAmount: 30, discountTotal: 3, dailyOrderNumber: 3, notes: "[Desconto: R$ 3,00 — Pedido atrasado]",
      editHistory: [{ quando: h("14:30"), quem: "Rita (funcionário)", quemId: "u-rita", acao: "REMOVEU", descricao: "−Coca, desconto R$ 3,00 — Pedido atrasado", totalAntes: 41, totalDepois: 30 }] },
    // Cupom do site: não é manual, não entra.
    { id: "p4", deliveryType: "DELIVERY", source: "ONLINE", status: "ENTREGUE", createdAt: h("15:00"), totalAmount: 40, discountTotal: 4, notes: "[Cupom: BEMVINDO]" },
    // Cancelado com desconto: não entra.
    { id: "p5", ...balcao, status: "CANCELADO", createdAt: h("16:00"), totalAmount: 10, discountTotal: 1, notes: "[Desconto: R$ 1,00 — x]",
      editHistory: [{ quando: h("16:00"), quem: "Rita", quemId: "u-rita", acao: "DESCONTO", descricao: "d", totalAntes: 11, totalDepois: 10 }] },
  ];
  const consumo = [{ status: "ENTREGUE", totalAmount: 100, discountTotal: null }];
  const mesas: any[] = [
    // Mesa nova: o rastro do fechamento diz quem deu e o motivo.
    { id: "s1", fechadaEm: h("22:00"), mesa: 7, pago: 90, taxaServico: 0, gorjeta: 0, pedidos: consumo, fechadaPor: "Garçom Zé",
      rastro: { quem: "Garçom Zé", quemId: "garcom:w1", motivo: "Cliente fiel" } },
    // Mesa antiga: quem fechou, sem motivo.
    { id: "s2", fechadaEm: h("23:00"), mesa: 8, pago: 95, taxaServico: 0, gorjeta: 0, pedidos: consumo, fechadaPor: "Bruno" },
  ];
  confere("rastroDoDesconto pega o último registro de desconto", rastroDoDesconto(pedidos[2].editHistory), { quem: "Rita (funcionário)", quemId: "u-rita", motivo: null });
  const daMesa = [{ quando: h("22:00"), quem: "Garçom Zé", quemId: "garcom:w1", acao: "DESCONTO", descricao: "desconto na conta da mesa: 10% (R$ 10,00) — Cliente fiel", totalAntes: 100, totalDepois: 100, motivo: "Cliente fiel" }];
  confere("rastroDoDesconto da conta da mesa (daConta) e só ele", [rastroDoDesconto(daMesa, true)?.motivo, rastroDoDesconto(daMesa), rastroDoDesconto(pedidos[0].editHistory, true)], ["Cliente fiel", null, null]);

  const r = descontosManuaisPorOperador(pedidos, mesas, TZ);
  confere("5 descontos manuais, R$ 25 (5 + 2 + 3 + 10 + 5)", [r.vezes, r.total], [5, 25]);
  const rita = r.porOperador.find((o) => o.chave === "id:u-rita");
  confere("Rita: o 'Caixa Rita' e a 'Rita' do mesmo id juntos — 2 vezes, R$ 8", rita && [rita.vezes, rita.valor], [2, 8]);
  confere("Motivos da Rita: Cliente fiel e Pedido atrasado", rita?.motivos.map((m) => m.motivo).sort(), ["Cliente fiel", "Pedido atrasado"]);
  confere("Balcão antigo: Operador não registrado (1)", [r.lista.find((l) => l.id === "p2")?.quem, r.semOperador], [OPERADOR_NAO_REGISTRADO, 1]);
  confere("Mesa nova: Garçom Zé, Cliente fiel, R$ 10", (() => { const l = r.lista.find((x) => x.id === "s1"); return l && [l.quem, l.motivo, l.valor, l.numero]; })(), ["Garçom Zé", "Cliente fiel", 10, "Mesa 7"]);
  confere("Mesa antiga: quem fechou, sem motivo registrado", (() => { const l = r.lista.find((x) => x.id === "s2"); return l && [l.quem, l.motivo]; })(), ["Bruno", "Sem motivo registrado (mesa antiga)"]);
  confere("Cupom e cancelado não entram", r.lista.some((l) => l.id === "p4" || l.id === "p5"), false);
  confere("Por motivo: Pedido atrasado 2× (R$ 5)", (() => { const m = r.porMotivo.find((x) => x.motivo === "Pedido atrasado"); return m && [m.vezes, m.valor]; })(), [2, 5]);
}

// ── 4. AS ROTAS GRAVAM O OPERADOR ───────────────────────────────────────────
function secaoRotas() {
  console.log("\n— 4. O operador gravado nas rotas");
  const ler = (...p: string[]) => readFileSync(join(__dirname, "..", "src", ...p), "utf8");
  confere("Quadro (status): CANCELOU com quemId", /quemId: currentUser\.id,\s*acao: "CANCELOU"/.test(ler("app", "api", "customer-order", "status", "route.ts")), true);
  const itens = ler("app", "api", "store", "orders", "[id]", "itens", "route.ts");
  confere("Edição do pedido: quemId em tirar item, desconto, cancelar e na mesa (5)", (itens.match(/quemId: (operador|ctx\.operador)\.id/g) || []).length, 5);
  confere("Mesas (tela e garçom): quemId do operador da mesa", (ler("app", "api", "store", "table-sessions", "[id]", "orders", "[orderId]", "route.ts").match(/quemId: idDoOperadorDaMesa/g) || []).length, 2);
  const mesa = ler("lib", "edicao-na-mesa.ts");
  confere("edicao-na-mesa: o quemId vai para o registro (editar e cancelar)", (mesa.match(/\.\.\.\(quemId \? \{ quemId \} : \{\}\)/g) || []).length, 2);
  confere("Ajustar o desconto: quemId e motivo", /quemId: operador\.id,\s*acao: "DESCONTO",\s*\.\.\.\(motivo/.test(ler("app", "api", "store", "orders", "[id]", "desconto", "route.ts")), true);
  confere("Fechamento da mesa: DESCONTO com quem, id e motivo na primeira rodada", /quemId: idDoOperadorDaMesa\(operador\),\s*acao: "DESCONTO"/.test(ler("app", "api", "store", "table-sessions", "[id]", "close", "route.ts")), true);
  confere("Balcão (PDV): o rastro do desconto no lançamento", /acao: "DESCONTO",\s*descricao: `desconto no lançamento/.test(ler("lib", "venda-presencial.ts")) && /quemId: dbUser\.id/.test(ler("app", "api", "store", "orders", "presencial", "route.ts")), true);
  confere("Brendi e JotaJá: CANCELOU com quemId", ["brendi-action", "jotaja-action"].every((r) => /quemId: user\.id,\s*acao: "CANCELOU"/.test(ler("app", "api", "customer-order", r, "route.ts"))), true);
  const cortesia = ler("app", "api", "store", "orders", "[id]", "cortesia", "route.ts");
  confere("Cortesia: CORTESIA com quemId, motivo e itensCortesia", /quemId: operador\.id,\s*acao: "CORTESIA"/.test(cortesia) && cortesia.includes("itensCortesia: [plano.linha]"), true);
}

secaoCortesia();
secaoRelatorio();
secaoDescontos();
secaoRotas();
console.log(falhas ? `\n❌ ${falhas} falha(s).` : "\n✅ Tudo certo.");
process.exit(falhas ? 1 : 0);
