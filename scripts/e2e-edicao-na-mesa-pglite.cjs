/**
 * E2E da edição de rodada de mesa (lib/edicao-na-mesa.ts) contra um banco LOCAL
 * (PGlite). Nunca rodar com o DATABASE_URL de produção: o script recusa se não
 * for 127.0.0.1.
 *
 *   pglite-server --db=<pasta> --port=5443
 *   DATABASE_URL=<url do pglite local, com &pgbouncer=true&connection_limit=1> \
 *     npx prisma db push --skip-generate --schema node_modules/.prisma/client/schema.prisma
 *   node scripts/e2e-edicao-na-mesa-pglite.cjs
 *
 * Confere o que a tela de Mesas e o lápis do quadro de Pedidos gravam pela
 * MESMA função: o total da rodada, a conta da mesa (calcularContaDaMesa, a
 * mesma do fechamento), o rastro em editHistory e as guardas (mesa fechada,
 * nota emitida, rodada de outra mesa).
 */
const path = require("path");
const assert = require("assert/strict");

if (!process.env.DATABASE_URL) throw new Error("defina DATABASE_URL com o banco LOCAL (pglite)");
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL)) throw new Error("só roda contra banco local");

const { createJiti } = require("jiti");
const src = path.join(__dirname, "..", "src");
const jiti = createJiti(__filename, { alias: { "@/": src + "/" } });

let ok = 0;
const caso = async (nome, f) => { await f(); ok++; console.log("ok -", nome); };

(async () => {
  const { prisma } = jiti("../src/lib/prisma");
  const mesa = jiti("../src/lib/edicao-na-mesa");
  const { calcularContaDaMesa } = jiti("../src/lib/conta-da-mesa");
  const { lerHistorico } = jiti("../src/lib/historico-do-pedido");

  const sufixo = Date.now();
  const loja = await prisma.user.create({
    data: { email: `loja-${sufixo}@teste.local`, password: "x", name: "Loja Teste", storeName: "Loja Teste" },
  });
  const outraLoja = await prisma.user.create({
    data: { email: `outra-${sufixo}@teste.local`, password: "x", name: "Outra", storeName: "Outra" },
  });
  const mesa1 = await prisma.table.create({ data: { franchiseeId: loja.id, number: 1 } });
  const sessao = await prisma.tableSession.create({ data: { tableId: mesa1.id, franchiseeId: loja.id, status: "OPEN" } });

  const novaRodada = (numero, itens, extra = {}) =>
    prisma.customerOrder.create({
      data: {
        franchiseeId: loja.id, customerName: "Mesa 1", customerPhone: "", deliveryType: "MESA", source: "PRESENCIAL",
        paymentMethod: "N/A", status: "PREPARANDO", dailyOrderNumber: numero, tableSessionId: sessao.id,
        customerAddress: "Mesa 1",
        totalAmount: Math.round(itens.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100,
        items: { create: itens },
        ...extra,
      },
      include: { items: true },
    });

  // A rodada do print do Victor: R$ 35,90.
  const r1 = await novaRodada(10, [
    { productName: "X Burguer", quantity: 1, price: 25.9 },
    { productName: "Coca lata", quantity: 2, price: 5 },
  ]);
  const r2 = await novaRodada(11, [{ productName: "Batata", quantity: 1, price: 18 }]);
  const coca = r1.items.find((i) => i.productName === "Coca lata");
  const xburguer = r1.items.find((i) => i.productName === "X Burguer");

  const contaDaMesa = async () => {
    const s = await prisma.tableSession.findUnique({
      where: { id: sessao.id },
      include: {
        table: { select: { number: true, label: true } },
        orders: { select: { status: true, totalAmount: true, dailyOrderNumber: true, items: { select: { id: true, quantity: true, price: true, productName: true, tableGuestId: true, comboSelections: true, menuProduct: { select: { name: true } } } } } },
      },
    });
    return calcularContaDaMesa(s, [], 0, 0);
  };

  await caso("conta antes: 35,90 + 18,00", async () => {
    assert.equal((await contaDaMesa()).consumo, 53.9);
  });

  await caso("carrega a rodada pelo pedido (lápis do quadro, sem a sessão na URL)", async () => {
    const c = await mesa.carregarRodadaDaMesa(loja.id, r1.id);
    assert.ok(!("erro" in c), JSON.stringify(c));
    assert.equal(c.mesa, 1);
  });

  await caso("outra loja não alcança a rodada", async () => {
    const c = await mesa.carregarRodadaDaMesa(outraLoja.id, r1.id);
    assert.equal(c.erro.status, 404);
  });

  await caso("rodada não é da sessão da URL → 404 (tela de Mesas)", async () => {
    const c = await mesa.carregarRodadaDaMesa(loja.id, r1.id, "sessao-que-nao-e");
    assert.equal(c.erro.status, 404);
  });

  await caso("tirar a Coca sem motivo é recusado e nada muda", async () => {
    const c = await mesa.carregarRodadaDaMesa(loja.id, r1.id);
    const r = await mesa.editarRodadaDaMesa({
      lojaId: loja.id, rodada: c.rodada, pedido: { removerItemIds: [coca.id] }, quem: "Douglas (dono)", podeRemoverItem: true,
    });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.precisaDeMotivo, true);
    const p = await prisma.customerOrder.findUnique({ where: { id: r1.id }, include: { items: true } });
    assert.equal(p.items.length, 2);
  });

  await caso("tira a Coca: rodada 25,90, conta 43,90, rastro gravado, status intacto", async () => {
    const c = await mesa.carregarRodadaDaMesa(loja.id, r1.id);
    const r = await mesa.editarRodadaDaMesa({
      lojaId: loja.id, rodada: c.rodada, pedido: { removerItemIds: [coca.id], motivo: "cliente desistiu" }, quem: "Douglas (dono)", podeRemoverItem: true,
    });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.totalAmount, 25.9);
    const p = await prisma.customerOrder.findUnique({ where: { id: r1.id }, include: { items: true } });
    assert.equal(p.items.length, 1);
    assert.equal(p.totalAmount, 25.9);
    assert.equal(p.status, "PREPARANDO");
    const h = lerHistorico(p.editHistory);
    assert.equal(h.length, 1);
    assert.equal(h[0].acao, "REMOVEU");
    assert.equal(h[0].quem, "Douglas (dono)");
    assert.equal(h[0].descricao, "−Coca lata");
    assert.deepEqual([h[0].totalAntes, h[0].totalDepois], [35.9, 25.9]);
    assert.equal(h[0].motivo, "cliente desistiu");
    assert.deepEqual(h[0].itensRetirados, [{ nome: "Coca lata", quantidade: 2, valor: 10 }]);
    assert.equal((await contaDaMesa()).consumo, 43.9);
  });

  await caso("garçom sem 'remover item' é recusado e nada muda", async () => {
    const c = await mesa.carregarRodadaDaMesa(loja.id, r2.id, sessao.id);
    const item = c.rodada.items[0];
    const r = await mesa.editarRodadaDaMesa({
      lojaId: loja.id, rodada: c.rodada, pedido: { removerItemIds: [item.id], motivo: "lançou errado" }, quem: "Garçom Zé", podeRemoverItem: false,
    });
    assert.equal(r.status, 403);
    assert.equal((await contaDaMesa()).consumo, 43.9);
  });

  await caso("aumenta o X Burguer para 2x: conta 69,80", async () => {
    const c = await mesa.carregarRodadaDaMesa(loja.id, r1.id);
    const r = await mesa.editarRodadaDaMesa({
      lojaId: loja.id, rodada: c.rodada, pedido: { itens: [{ itemId: xburguer.id, quantity: 2 }] }, quem: "Garçom Zé", podeRemoverItem: false,
    });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.totalAmount, 51.8);
    assert.equal((await contaDaMesa()).consumo, 69.8);
    const p = await prisma.customerOrder.findUnique({ where: { id: r1.id } });
    assert.equal(lerHistorico(p.editHistory).length, 2);
  });

  await caso("tirou o último item: a rodada cancela e sai da conta", async () => {
    const c = await mesa.carregarRodadaDaMesa(loja.id, r2.id);
    const r = await mesa.editarRodadaDaMesa({
      lojaId: loja.id, rodada: c.rodada, pedido: { removerItemIds: [c.rodada.items[0].id], motivo: "mesa trocou o pedido" }, quem: "Douglas (dono)", podeRemoverItem: true,
    });
    assert.equal(r.corpo.cancelado, true);
    const p = await prisma.customerOrder.findUnique({ where: { id: r2.id } });
    assert.equal(p.status, "CANCELADO");
    assert.equal(lerHistorico(p.editHistory).at(-1).acao, "CANCELOU");
    assert.equal(lerHistorico(p.editHistory).at(-1).motivo, "mesa trocou o pedido");
    assert.equal(p.cancelReason, "mesa trocou o pedido");
    assert.equal((await contaDaMesa()).consumo, 51.8);
  });

  await caso("rodada cancelada não edita de novo", async () => {
    const c = await mesa.carregarRodadaDaMesa(loja.id, r2.id);
    assert.equal(c.erro.status, 409);
  });

  await caso("nota emitida trava", async () => {
    const r3 = await novaRodada(12, [{ productName: "Suco", quantity: 1, price: 9 }], { fiscalStatus: "EMITTED" });
    const c = await mesa.carregarRodadaDaMesa(loja.id, r3.id);
    assert.equal(c.erro.status, 409);
    assert.match(c.erro.corpo.error, /nota fiscal/);
  });

  await caso("mesa fechada (paga) não edita", async () => {
    await prisma.tableSession.update({ where: { id: sessao.id }, data: { status: "CLOSED" } });
    const c = await mesa.carregarRodadaDaMesa(loja.id, r1.id);
    assert.equal(c.erro.status, 409);
    assert.match(c.erro.corpo.error, /fechada/);
  });

  console.log(`\n${ok} casos ok`);
  await prisma.$disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error("FALHOU:", e);
  process.exit(1);
});
