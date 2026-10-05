/**
 * E2E do acréscimo contra um banco LOCAL (PGlite) e um gateway de WhatsApp falso.
 * Nunca rodar com o DATABASE_URL de produção: o script recusa se não for 127.0.0.1.
 *
 *   pglite-server --db=<pasta> --port=5441
 *   DATABASE_URL=<url do pglite local, com &pgbouncer=true&connection_limit=1> \
 *     npx prisma db push --skip-generate --schema node_modules/.prisma/client/schema.prisma
 *   node scripts/e2e-acrescimo-pglite.cjs
 */
const http = require("http");
const path = require("path");
const assert = require("assert/strict");

if (!process.env.DATABASE_URL) throw new Error("defina DATABASE_URL com o banco LOCAL (pglite)");
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL)) throw new Error("só roda contra banco local");
process.env.EVOLUTION_API_URL = "http://127.0.0.1:8099";
process.env.EVOLUTION_API_KEY = "teste";

const enviadas = [];
const gateway = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c)).on("end", () => {
    try { enviadas.push({ url: req.url, body: JSON.parse(b || "{}") }); } catch { enviadas.push({ url: req.url, body: b }); }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ key: { id: "x" }, status: "PENDING" }));
  });
});

const { createJiti } = require("jiti");
const src = path.join(__dirname, "..", "src");
const jiti = createJiti(__filename, { alias: { "@/": src + "/" } });

let ok = 0;
const caso = async (nome, f) => { await f(); ok++; console.log("ok -", nome); };

(async () => {
  await new Promise((r) => gateway.listen(8099, r));
  const { prisma } = jiti("../src/lib/prisma");
  const ac = jiti("../src/lib/acrescimo-no-banco");

  const loja = await prisma.user.create({
    data: { email: `loja-${Date.now()}@teste.local`, password: "x", name: "Loja Teste", storeName: "Loja Teste" },
  });
  const outraLoja = await prisma.user.create({
    data: { email: `outra-${Date.now()}@teste.local`, password: "x", name: "Outra", storeName: "Outra" },
  });
  const pedido = await prisma.customerOrder.create({
    data: {
      franchiseeId: loja.id, customerName: "Maria", customerPhone: "+55 (22) 99999-1234",
      deliveryType: "DELIVERY", deliveryFee: 6, totalAmount: 46, status: "PRONTO", source: "WHATSAPP_IA",
      dailyOrderNumber: 47, kdsStage: "FINISHED",
      items: { create: [{ productName: "Pizza Grande", quantity: 1, price: 40 }] },
    },
  });
  const coca = { productName: "Coca 2L", quantity: 2, price: 12, notes: null, comboSelections: null, menuProductId: null };

  await caso("tabela nasce no boot", async () => {
    assert.equal(await ac.garantirTabelaDeAcrescimos(), true);
  });

  await caso("pedido ativo acha pelo telefone com máscara", async () => {
    const a = await ac.pedidoAtivoDoTelefone(loja.id, "5522999991234");
    assert.equal(a.pedido.id, pedido.id);
    assert.equal(a.pendente, null);
  });

  await caso("número de outro pedido não é aceito", async () => {
    const r = await ac.registrarAcrescimo({ franchiseeId: loja.id, telefone: "5522999991234", numeroDoPedido: 12, itens: [coca] });
    assert.equal(r.ok, false);
  });

  await caso("registra e a tag repetida não duplica", async () => {
    const r1 = await ac.registrarAcrescimo({ franchiseeId: loja.id, telefone: "5522999991234", remoteJid: "5522999991234@s.whatsapp.net", numeroDoPedido: 47, itens: [coca] });
    assert.deepEqual([r1.ok, r1.repetido, r1.numero], [true, false, 47]);
    const r2 = await ac.registrarAcrescimo({ franchiseeId: loja.id, telefone: "5522999991234", remoteJid: "5522999991234@s.whatsapp.net", numeroDoPedido: 47, itens: [coca] });
    assert.equal(r2.repetido, true);
    const lista = await ac.acrescimosPendentes([loja.id]);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].valor, 24);
    assert.equal(lista[0].novoTotal, 70);
    assert.equal(lista[0].itensEmTexto, "2x Coca 2L");
  });

  await caso("outra loja não vê nem responde", async () => {
    assert.equal((await ac.acrescimosPendentes([outraLoja.id])).length, 0);
    const [p] = await ac.acrescimosPendentes([loja.id]);
    const r = await ac.responderAcrescimo({ id: p.id, lojaIds: [outraLoja.id], aceitar: true, quem: "intruso" });
    assert.equal(r.ok, false);
    assert.equal(r.status, 404);
  });

  await caso("dois cliques ao mesmo tempo: só um vale", async () => {
    const [p] = await ac.acrescimosPendentes([loja.id]);
    const [a, b] = await Promise.all([
      ac.responderAcrescimo({ id: p.id, lojaIds: [loja.id], aceitar: true, quem: "Caixa" }),
      ac.responderAcrescimo({ id: p.id, lojaIds: [loja.id], aceitar: false, texto: "não dá", quem: "Balcão" }),
    ]);
    assert.equal([a, b].filter((r) => r.ok).length, 1, JSON.stringify([a, b]));
    const vencedor = a.ok ? "aceitar" : "recusar";
    console.log("   (venceu:", vencedor + ")");
    if (vencedor === "recusar") {
      // O caso seguinte confere o aceite: um acréscimo novo, aceito sozinho.
      await ac.registrarAcrescimo({ franchiseeId: loja.id, telefone: "5522999991234", remoteJid: "5522999991234@s.whatsapp.net", numeroDoPedido: 47, itens: [coca] });
      const [q] = await ac.acrescimosPendentes([loja.id]);
      const r = await ac.responderAcrescimo({ id: q.id, lojaIds: [loja.id], aceitar: true, quem: "Caixa" });
      assert.equal(r.ok, true, JSON.stringify(r));
    }
  });

  await caso("aceito: itens, total, histórico, KDS reaberto, papel e mensagem", async () => {
    const p = await prisma.customerOrder.findUnique({ where: { id: pedido.id }, include: { items: true } });
    assert.equal(p.items.length, 2);
    assert.equal(p.totalAmount, 70);
    assert.equal(p.status, "PREPARANDO");
    assert.equal(p.kdsStage, "FINISHING");
    assert.equal(p.kdsFinishedAt, null);
    assert.equal(p.editHistory.at(-1).acao, "ACRESCENTOU");
    const papel = await prisma.printRequest.findFirst({ where: { franchiseeId: loja.id, kind: "REIMPRESSAO" } });
    assert.ok(papel, "sem papel na fila");
    assert.equal(papel.payload.items.length, 1);
    assert.match(papel.payload.notes, /ACRÉSCIMO DO PEDIDO Nº 47/);
    const msg = enviadas.map((e) => JSON.stringify(e.body)).find((t) => /incluiu no seu pedido/.test(t));
    assert.ok(msg, "mensagem de aceito não saiu: " + JSON.stringify(enviadas));
    assert.match(msg, /Novo total: R\$ 70,00/);
    assert.equal((await ac.acrescimosPendentes([loja.id])).length, 0);
  });

  await caso("pedido que saiu antes da resposta: expira e avisa", async () => {
    const r = await ac.registrarAcrescimo({ franchiseeId: loja.id, telefone: "5522999991234", remoteJid: "5522999991234@s.whatsapp.net", numeroDoPedido: 47, itens: [{ ...coca, productName: "Guaraná", price: 8, quantity: 1 }] });
    assert.equal(r.ok, true);
    await prisma.customerOrder.update({ where: { id: pedido.id }, data: { status: "SAIU_ENTREGA" } });
    assert.equal((await ac.acrescimosPendentes([loja.id])).length, 0);
    assert.ok(enviadas.some((e) => /já saiu para entrega antes/.test(JSON.stringify(e.body))));
  });

  await caso("pedido a caminho recusa o acréscimo na hora", async () => {
    const r = await ac.registrarAcrescimo({ franchiseeId: loja.id, telefone: "5522999991234", numeroDoPedido: 47, itens: [coca] });
    assert.equal(r.ok, false);
    assert.equal(r.situacao, "SAIU");
  });

  await caso("recusa leva o texto da loja", async () => {
    await prisma.customerOrder.update({ where: { id: pedido.id }, data: { status: "PREPARANDO" } });
    await ac.registrarAcrescimo({ franchiseeId: loja.id, telefone: "5522999991234", remoteJid: "5522999991234@s.whatsapp.net", numeroDoPedido: 47, itens: [coca] });
    const [p] = await ac.acrescimosPendentes([loja.id]);
    const r = await ac.responderAcrescimo({ id: p.id, lojaIds: [loja.id], aceitar: false, texto: "A Coca acabou, desculpa!", quem: "Caixa" });
    assert.equal(r.ok, true);
    assert.ok(enviadas.some((e) => /A Coca acabou, desculpa!/.test(JSON.stringify(e.body))));
    const ped = await prisma.customerOrder.findUnique({ where: { id: pedido.id } });
    assert.equal(ped.totalAmount, 70);
  });

  console.log(`\n${ok} casos ok · ${enviadas.length} mensagens no gateway falso`);
  await prisma.$disconnect();
  gateway.close();
  process.exit(0);
})().catch(async (e) => {
  console.error("FALHOU:", e);
  console.error("mensagens:", JSON.stringify(enviadas, null, 1).slice(0, 1500));
  gateway.close();
  process.exit(1);
});
