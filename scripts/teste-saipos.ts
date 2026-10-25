/**
 * FireHub → Saipos (lib/saipos): casamento de códigos, o pedido e a conversa com a API.
 *
 *   npx tsx scripts/teste-saipos.ts
 *
 * Servidor falso no lugar do order-api.saipos.com. Confere:
 *   1. o casamento por nome (item, item+tamanho, opção do item, opção solta, ambiguidade);
 *   2. o pedido: delivery e retirada, itens, opções, pagamentos, desconto, agendamento, endereço;
 *   3. o que NÃO vai (iFood, mesa, rascunho) e o item sem código (não envia);
 *   4. a API: token guardado, token vencido renova, 904/920 contam como enviado, 5xx repete.
 */
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET ||= "x";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const verdade = (oQue: string, c: unknown) => confere(oQue, !!c, true);

async function main() {
  const C = await import("../src/lib/saipos/codigos");
  const P = await import("../src/lib/saipos/pedido");
  const A = await import("../src/lib/saipos/cliente");

  // ── o catálogo do Saipos (formato do GET /v2/catalog) ──
  const catalogo = [
    { tipo: "PRATO", categoria: "Pizzas", tamanho: "Grande", item: "Pizza", codigo_saipos: "100", store_item_enabled: "Y" },
    { tipo: "PRATO", categoria: "Pizzas", tamanho: "Média", item: "Pizza", codigo_saipos: "101", store_item_enabled: "Y" },
    { tipo: "COMPLEMENTO", item: "Pizza", tamanho: "Grande", complemento: "Sabores", complemento_item: "Calabresa Acebolada", codigo_saipos: "100.11", store_item_enabled: "Y", store_choice_enabled: "Y", store_choice_item_enabled: "Y" },
    { tipo: "COMPLEMENTO", item: "Pizza", tamanho: "Grande", complemento: "Sabores", complemento_item: "Mussarela", codigo_saipos: "100.12", store_item_enabled: "Y", store_choice_enabled: "Y", store_choice_item_enabled: "Y" },
    { tipo: "COMPLEMENTO", item: "Pizza", tamanho: "Grande", complemento: "Borda", complemento_item: "Borda de Catupiry", codigo_saipos: "100.21", store_item_enabled: "Y", store_choice_enabled: "Y", store_choice_item_enabled: "Y" },
    { tipo: "COMPLEMENTO", item: "Pizza", tamanho: "Média", complemento: "Sabores", complemento_item: "Mussarela", codigo_saipos: "101.12", store_item_enabled: "Y", store_choice_enabled: "Y", store_choice_item_enabled: "Y" },
    { tipo: "PRATO", categoria: "Bebidas", tamanho: "Único", item: "Coca-Cola 2L", codigo_saipos: "200", store_item_enabled: "Y" },
    { tipo: "PRATO", categoria: "Bebidas", tamanho: "Único", item: "Guaraná 2L", codigo_saipos: "201", store_item_enabled: "N" },
    { tipo: "PRATO", categoria: "A", tamanho: "Único", item: "Brownie", codigo_saipos: "300", store_item_enabled: "Y" },
    { tipo: "PRATO", categoria: "B", tamanho: "Único", item: "Brownie", codigo_saipos: "301", store_item_enabled: "Y" },
  ];
  const ind = C.indiceDoCatalogo(catalogo);

  console.log("\n[1] Casamento");
  confere("normaliza acento, caixa e pontuação", C.normalizar("  Média   Pizza-Grande! "), "media pizza grande");
  confere("item + tamanho: 'Pizza Grande' → 100", C.codigoDoItem(ind, ["Pizza Grande"]), "100");
  confere("item + tamanho: 'Pizza Média' → 101", C.codigoDoItem(ind, ["Pizza Média"]), "101");
  confere("'Pizza' sozinho é ambíguo (dois tamanhos): não chuta", C.codigoDoItem(ind, ["Pizza"]), null);
  confere("tamanho 'Único' não entra no nome", C.codigoDoItem(ind, ["Coca-Cola 2L"]), "200");
  confere("item desligado no Saipos não casa", C.codigoDoItem(ind, ["Guaraná 2L"]), null);
  confere("mesmo nome em duas categorias: ambíguo", C.codigoDoItem(ind, ["Brownie"]), null);
  confere("tenta o segundo nome (o do cardápio) se o do pedido não casa", C.codigoDoItem(ind, ["Pizza do Dia", "Pizza Grande"]), "100");
  confere("opção do item certo (Mussarela na Grande)", C.codigoDaOpcao(ind, "100", "Mussarela"), "100.12");
  confere("opção do outro item (Mussarela na Média)", C.codigoDaOpcao(ind, "101", "Mussarela"), "101.12");
  confere("opção sem item, nome em dois itens: ambígua", C.codigoDaOpcao(ind, null, "Mussarela"), null);
  confere("opção sem item, nome único: acha", C.codigoDaOpcao(ind, null, "Borda de Catupiry"), "100.21");
  confere("opção que não existe", C.codigoDaOpcao(ind, "100", "Borda de Cheddar"), null);

  // ── o pedido ──
  const loja = { storeName: "Pizzaria Teste", city: "Brasília - DF", storeAddress: "Quadra 1, Brasília - DF" };
  const integ = { codStore: "LOJA-7" };
  const base = {
    id: "ped_abc123", status: "ACEITO", source: "ONLINE", deliveryType: "DELIVERY", dailyOrderNumber: 41,
    createdAt: "2026-10-25T15:00:00.000Z", customerName: "Ana", customerPhone: "(61) 99999-0000",
    customerAddress: "Rua das Flores, 120 - Centro (apto 3)", deliveryFee: 5, totalAmount: 95, notes: "sem cebola",
    paymentMethod: "PIX", paymentPaidAt: "2026-10-25T15:01:00.000Z",
    items: [
      { id: "i1", quantity: 1, price: 50, productName: "Pizza Grande", comboSelections: [{ name: "Calabresa Acebolada", quantity: 1 }, { name: "Mussarela", quantity: 1 }, { name: "Borda de Catupiry", quantity: 1 }] },
      { id: "i2", quantity: 2, price: 20, productName: "Coca-Cola 2L" },
    ],
  };
  console.log("\n[2] O pedido");
  const r: any = P.pedidoNoFormatoSaipos(base, loja, integ, ind);
  verdade("pedido normal vai", r.ok);
  const pl = r.payload;
  confere("order_id, display_id, cod_store", [pl.order_id, pl.display_id, pl.cod_store], ["ped_abc123", "41", "LOJA-7"]);
  confere("delivery pela loja, taxa 5", [pl.order_method.mode, pl.order_method.delivery_by, pl.order_method.delivery_fee], ["DELIVERY", "RESTAURANT", 5]);
  confere("cliente: telefone só em dígitos", [pl.customer.id, pl.customer.phone], ["61999990000", "61999990000"]);
  confere("item com código PDV e preço unitário", [pl.items[0].integration_code, pl.items[0].unit_price, pl.items[0].quantity], ["100", 50, 1]);
  confere("opções com código e adicional 0", pl.items[0].choice_items.map((c: any) => [c.integration_code, c.aditional_price]), [["100.11", 0], ["100.12", 0], ["100.21", 0]]);
  confere("segundo item (2x)", [pl.items[1].integration_code, pl.items[1].quantity, pl.items[1].unit_price], ["200", 2, 20]);
  confere("UF da loja no endereço, país BR", [pl.delivery_address.country, pl.delivery_address.state, pl.delivery_address.city], ["BR", "DF", "Brasília"]);
  confere("rua e número vieram do texto gravado", [pl.delivery_address.street_name, pl.delivery_address.street_number], ["Rua das Flores", "120"]);
  confere("Pix pago pelo site = PARTNER_PAYMENT online", pl.payment_types.map((p: any) => [p.code, p.complement, p.type, p.amount]), [["PARTNER_PAYMENT", "pix", "ONLINE", 95]]);
  confere("sem desconto e sem acréscimo", [pl.total_discount, pl.total_increase], [0, 0]);
  confere("observação do pedido vai", pl.notes, "sem cebola");
  confere("a conta fecha (nenhum aviso)", r.avisos, []);

  const comDesconto: any = P.pedidoNoFormatoSaipos({ ...base, discountTotal: 10, totalAmount: 85, paymentMethod: "Dinheiro", paymentPaidAt: null, changeAmount: 100 }, loja, integ, ind);
  confere("desconto do pedido vira total_discount", comDesconto.payload.total_discount, 10);
  confere("dinheiro com troco: DIN e change_for", comDesconto.payload.payment_types.map((p: any) => [p.code, p.type, p.change_for]), [["DIN", "OFFLINE", 100]]);

  const agendado: any = P.pedidoNoFormatoSaipos({ ...base, agendado: true, scheduledDatetime: "2026-10-26T01:30:00.000Z" }, loja, integ, ind);
  confere("agendado: scheduled true e hora nas observações", [agendado.payload.order_method.scheduled, /AGENDADO PARA/.test(agendado.payload.notes)], [true, true]);

  const retirada: any = P.pedidoNoFormatoSaipos({ ...base, deliveryType: "RETIRADA", deliveryFee: 0, totalAmount: 90, customerAddress: "" }, loja, integ, ind);
  confere("retirada vira TAKEOUT, sem endereço", [retirada.payload.order_method.mode, retirada.payload.delivery_address], ["TAKEOUT", undefined]);

  const semFone: any = P.pedidoNoFormatoSaipos({ ...base, customerPhone: "" }, loja, integ, ind);
  confere("sem telefone: cliente -1 e telefone zerado (o Saipos exige o campo)", [semFone.payload.customer.id, semFone.payload.customer.phone], ["-1", "00000000000"]);

  const opcaoSemCodigo: any = P.pedidoNoFormatoSaipos({ ...base, items: [{ ...base.items[0], comboSelections: [{ name: "Borda de Cheddar", quantity: 1 }, { name: "Mussarela", quantity: 1 }] }] , totalAmount: 55 }, loja, integ, ind);
  verdade("opção sem código NÃO trava o pedido", opcaoSemCodigo.ok);
  confere("…vai nas observações do item e no aviso", [/Borda de Cheddar \(sem código no Saipos\)/.test(opcaoSemCodigo.payload.items[0].notes), opcaoSemCodigo.avisos.length], [true, 1]);

  const itemSemCodigo: any = P.pedidoNoFormatoSaipos({ ...base, items: [{ id: "x", quantity: 1, price: 30, productName: "Esfiha Doce" }], totalAmount: 35 }, loja, integ, ind);
  confere("item sem código: NÃO envia e diz qual", [itemSemCodigo.ok, itemSemCodigo.faltando], [false, ["Esfiha Doce"]]);

  const fecha: any = P.pedidoNoFormatoSaipos({ ...base, totalAmount: 100 }, loja, integ, ind);
  confere("total maior que itens+taxa: a diferença segue como acréscimo e a conta fecha com o do Saipos", [fecha.payload.total_increase, fecha.payload.total_amount, fecha.avisos], [5, 100, []]);

  console.log("\n[3] Quem vai");
  confere("site: DELIVERY", P.modoNoSaipos(base as any), "DELIVERY");
  confere("retirada: TAKEOUT", P.modoNoSaipos({ ...base, deliveryType: "RETIRADA" } as any), "TAKEOUT");
  confere("iFood não vai (já entra no Saipos pela integração dele)", P.modoNoSaipos({ ...base, source: "IFOOD", ifoodOrderId: "x" } as any), null);
  confere("mesa não vai", P.modoNoSaipos({ ...base, deliveryType: "MESA", tableSessionId: "s" } as any), null);
  confere("rascunho do robô não vai", P.modoNoSaipos({ ...base, status: "CRIANDO_IA" } as any), null);
  confere("acréscimo colado não vai", P.modoNoSaipos({ ...base, parentOrderId: "p" } as any), null);

  // ── a API, com servidor falso ──
  console.log("\n[4] A API");
  const chamadas: { url: string; metodo: string; auth?: string; corpo?: any }[] = [];
  let tokenSeq = 0;
  let modo: "ok" | "token-vence" | "ja-existe" | "sem-caixa" | "cai" = "ok";
  const falso = (async (url: any, init: any) => {
    const u = String(url);
    const corpo = init?.body ? JSON.parse(init.body) : undefined;
    chamadas.push({ url: u.replace("https://api.falsa", ""), metodo: init?.method || "GET", auth: init?.headers?.Authorization, corpo });
    const resp = (status: number, c: unknown) => new Response(typeof c === "string" ? c : JSON.stringify(c), { status });
    if (u.endsWith("/auth")) return resp(200, { token: `tok-${++tokenSeq}` });
    if (u.endsWith("/order")) {
      if (modo === "token-vence" && init.headers.Authorization === "tok-1") return resp(401, { code: 901, errorMessage: "Token inválido" });
      if (modo === "ja-existe") return resp(400, { code: 904, errorMessage: "Pedido já importado" });
      if (modo === "sem-caixa") return resp(400, { code: 920, errorMessage: "Sem caixa aberto" });
      if (modo === "cai") return resp(503, "fora");
      return resp(200, { code: "order-success", id: 9 });
    }
    if (u.endsWith("/cancel-order")) return resp(200, { status: true });
    if (u.endsWith("/v2/catalog")) return resp(200, { url: "https://s3.falso/catalogo.json?assinado" });
    if (u.startsWith("https://s3.falso")) return resp(200, catalogo);
    return resp(404, {});
  }) as unknown as typeof fetch;
  const o = { fetchImpl: falso, base: "https://api.falsa", agora: () => 1_000_000 };

  A.esquecerTokens();
  const e1 = await A.enviarPedido("PARC1", "seg", { order_id: "a" }, o);
  confere("envia: ok, autenticou antes", [e1.ok, chamadas[0].url, chamadas[1].url], [true, "/auth", "/order"]);
  confere("o /auth leva idPartner e secret", chamadas[0].corpo, { idPartner: "PARC1", secret: "seg" });
  confere("o token vai no header Authorization", chamadas[1].auth, "tok-1");
  await A.enviarPedido("PARC1", "seg", { order_id: "b" }, o);
  confere("segundo envio reaproveita o token (um /auth só)", chamadas.filter((c) => c.url === "/auth").length, 1);
  const outroParceiro = await A.enviarPedido("PARC2", "seg", { order_id: "c" }, o);
  confere("outro idPartner, outro token", [outroParceiro.ok, chamadas.filter((c) => c.url === "/auth").length], [true, 2]);

  A.esquecerTokens(); chamadas.length = 0; tokenSeq = 0; modo = "token-vence";
  const e2 = await A.enviarPedido("PARC1", "seg", { order_id: "d" }, o);
  confere("token recusado (901): renova e envia de novo", [e2.ok, chamadas.filter((c) => c.url === "/auth").length], [true, 2]);

  modo = "ja-existe";
  const e3 = await A.enviarPedido("PARC1", "seg", { order_id: "e" }, o);
  confere("904 (já importado) conta como enviado", A.destinoDaResposta(e3), "ENVIADO");
  modo = "sem-caixa";
  const e4 = await A.enviarPedido("PARC1", "seg", { order_id: "f" }, o);
  confere("920 (sem caixa aberto) conta como enviado: o Saipos importa quando abrir", A.destinoDaResposta(e4), "ENVIADO");
  modo = "cai";
  const e5 = await A.enviarPedido("PARC1", "seg", { order_id: "g" }, o);
  confere("503 do Saipos: repetir depois", A.destinoDaResposta(e5), "REPETIR");

  const rede = await A.enviarPedido("PARC1", "seg", {}, { ...o, fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch });
  confere("rede caiu: repetir depois", A.destinoDaResposta(rede), "REPETIR");

  modo = "ok"; chamadas.length = 0;
  const c1 = await A.cancelarPedido("PARC1", "seg", "ped_abc123", "LOJA-7", o);
  confere("cancelamento leva order_id e cod_store", [c1.ok, chamadas.find((c) => c.url === "/cancel-order")?.corpo], [true, { order_id: "ped_abc123", cod_store: "LOJA-7" }]);

  const cat = await A.baixarCatalogo("PARC1", "seg", o);
  confere("catálogo: pede o link e baixa o arquivo (sem o header de autorização no S3)", [cat.ok, (cat as any).linhas?.length, chamadas.find((c) => c.url.startsWith("https://s3"))?.auth], [true, catalogo.length, undefined]);

  console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

export {};
