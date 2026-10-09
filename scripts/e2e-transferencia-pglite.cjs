/**
 * E2E do "Enviar para outra loja" contra um banco LOCAL (PGlite).
 * Nunca rodar com o DATABASE_URL de produção: o script recusa se não for 127.0.0.1.
 *
 *   pglite-server --db=<pasta> --port=5442
 *   DATABASE_URL=<url do pglite local, com &pgbouncer=true&connection_limit=1> \
 *     npx prisma db push --skip-generate --schema node_modules/.prisma/client/schema.prisma
 *   node scripts/e2e-transferencia-pglite.cjs
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
  const tr = jiti("../src/lib/transferencia-no-banco");
  const marca = Date.now();

  const lagomar = await prisma.user.create({ data: { email: `lagomar-${marca}@teste.local`, password: "x", name: "Antonio", storeName: "PIZZARIA 17", isPrimaryStore: true } });
  const aeroporto = await prisma.user.create({ data: { email: `aero-${marca}@teste.local`, password: "x", name: "Aero", storeName: "PIZZARIA 17 AEROPORTO", accountGroupId: lagomar.id } });
  const sozinha = await prisma.user.create({ data: { email: `outra-${marca}@teste.local`, password: "x", name: "Outra", storeName: "Outra" } });
  // Um pedido de hoje no Aeroporto, para o número de lá seguir a fila de lá.
  await prisma.customerOrder.create({ data: { franchiseeId: aeroporto.id, customerName: "Já era de lá", customerPhone: "1", deliveryType: "DELIVERY", totalAmount: 10, status: "ACEITO", source: "ONLINE", dailyOrderNumber: 1 } });

  const novoPedido = (extra = {}) => prisma.customerOrder.create({
    data: {
      franchiseeId: lagomar.id, customerName: "Bia", customerPhone: "22999587712", deliveryType: "DELIVERY",
      customerAddress: "Rua Professor Antonio Alvaro Paraíba, 962 - Aeroporto", deliveryFee: 5, totalAmount: 88,
      paymentMethod: "Voucher", status: "PREPARANDO", source: "ONLINE", dailyOrderNumber: 104, kdsStage: "PRODUCTION",
      printedAt: new Date(), acceptedAt: new Date(Date.now() - 600000),
      items: { create: [{ productName: "Pizza Grande", quantity: 1, price: 83, prontoEm: new Date() }] },
      ...extra,
    },
  });

  await caso("tabela nasce no boot", async () => {
    assert.equal(await tr.garantirTabelaDeTransferencias(), true);
  });

  const p1 = await novoPedido();

  await caso("sem a palavra de confirmação não envia", async () => {
    const r = await tr.pedirTransferencia({ lojaId: lagomar.id, orderId: p1.id, paraLojaId: aeroporto.id, confirmacao: "sim", quem: "Antonio" });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  await caso("loja de fora do acesso é recusada", async () => {
    const r = await tr.pedirTransferencia({ lojaId: lagomar.id, orderId: p1.id, paraLojaId: sozinha.id, confirmacao: "transferir", quem: "Antonio" });
    assert.equal(r.ok, false);
  });

  let t1;
  await caso("envia e o pedido CONTINUA na loja de origem", async () => {
    const r = await tr.pedirTransferencia({ lojaId: lagomar.id, orderId: p1.id, paraLojaId: aeroporto.id, confirmacao: "Transferir", quem: "Antonio" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.paraNome, "PIZZARIA 17 AEROPORTO");
    t1 = r.id;
    const p = await prisma.customerOrder.findUnique({ where: { id: p1.id } });
    assert.equal(p.franchiseeId, lagomar.id);
    assert.equal(p.dailyOrderNumber, 104);
  });

  await caso("enviar de novo para a mesma loja não duplica", async () => {
    const r = await tr.pedirTransferencia({ lojaId: lagomar.id, orderId: p1.id, paraLojaId: aeroporto.id, confirmacao: "transferir", quem: "Antonio" });
    assert.equal(r.ok, true);
    assert.equal(r.repetido, true);
    assert.equal(r.id, t1);
  });

  await caso("a loja de destino vê o pop-up; a origem vê 'esperando'", async () => {
    const lá = await tr.transferenciasDaVisao([aeroporto.id]);
    assert.equal(lá.paraEstaLoja.length, 1);
    assert.equal(lá.paraEstaLoja[0].deNome, "PIZZARIA 17");
    assert.equal(lá.paraEstaLoja[0].numero, "104");
    assert.match(lá.paraEstaLoja[0].itens, /Pizza Grande/);
    const aqui = await tr.transferenciasDaVisao([lagomar.id]);
    assert.equal(aqui.paraEstaLoja.length, 0);
    assert.equal(aqui.enviadas[0].status, "PENDENTE");
  });

  await caso("o painel do Editar sabe que está esperando", async () => {
    const pend = await tr.transferenciaPendenteDoPedido(p1.id);
    assert.equal(pend.paraNome, "PIZZARIA 17 AEROPORTO");
  });

  await caso("a origem não pode responder pela outra loja", async () => {
    const r = await tr.responderTransferencia({ id: t1, lojaIds: [lagomar.id], aceitar: true, quem: "Antonio" });
    assert.equal(r.ok, false);
  });

  await caso("recusar sem motivo não vale", async () => {
    const r = await tr.responderTransferencia({ id: t1, lojaIds: [aeroporto.id], aceitar: false, motivo: "no", quem: "Aero" });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  await caso("recusa com motivo: o pedido fica na origem e ela vê o motivo", async () => {
    const r = await tr.responderTransferencia({ id: t1, lojaIds: [aeroporto.id], aceitar: false, motivo: "Estamos sem forno agora", quem: "Aero" });
    assert.equal(r.ok, true, JSON.stringify(r));
    const p = await prisma.customerOrder.findUnique({ where: { id: p1.id } });
    assert.equal(p.franchiseeId, lagomar.id);
    const aqui = await tr.transferenciasDaVisao([lagomar.id]);
    assert.equal(aqui.enviadas[0].status, "RECUSADA");
    assert.equal(aqui.enviadas[0].motivo, "Estamos sem forno agora");
    assert.equal((await tr.transferenciasDaVisao([aeroporto.id])).paraEstaLoja.length, 0);
  });

  await caso("'Entendi' tira o aviso da origem", async () => {
    await tr.marcarVisto({ id: t1, lojaIds: [lagomar.id] });
    assert.equal((await tr.transferenciasDaVisao([lagomar.id])).enviadas.length, 0);
  });

  await caso("aceitar: o pedido muda de loja, vai para o fim da fila de lá e volta para a cozinha", async () => {
    const r1 = await tr.pedirTransferencia({ lojaId: lagomar.id, orderId: p1.id, paraLojaId: aeroporto.id, confirmacao: "transferir", quem: "Antonio" });
    assert.equal(r1.ok, true);
    const r = await tr.responderTransferencia({ id: r1.id, lojaIds: [aeroporto.id], aceitar: true, quem: "Aero" });
    assert.equal(r.ok, true, JSON.stringify(r));
    const p = await prisma.customerOrder.findUnique({ where: { id: p1.id }, include: { items: true } });
    assert.equal(p.franchiseeId, aeroporto.id);
    assert.equal(p.dailyOrderNumber, r.numero);
    assert.ok(r.numero >= 2, `número de lá: ${r.numero}`);
    assert.equal(p.status, "ACEITO");
    assert.equal(p.kdsStage, "PRODUCTION");
    assert.equal(p.printedAt, null, "a comanda tem de sair na impressora de lá");
    assert.equal(p.items[0].prontoEm, null);
    assert.equal(p.totalAmount, 88);
    assert.match(p.notes, /Transferido da loja PIZZARIA 17/);
    const ultimo = p.editHistory[p.editHistory.length - 1];
    assert.equal(ultimo.acao, "TRANSFERIU");
    assert.match(ultimo.descricao, /#104 da loja PIZZARIA 17 → #\d+ da loja PIZZARIA 17 AEROPORTO/);
    const aqui = await tr.transferenciasDaVisao([lagomar.id]);
    assert.equal(aqui.enviadas[0].status, "ACEITA");
    assert.equal(aqui.enviadas[0].numeroDepois, String(r.numero));
  });

  await caso("responder duas vezes a mesma não muda nada", async () => {
    const linhas = await prisma.$queryRawUnsafe(`SELECT id FROM "TransferenciaDoPedido" WHERE "orderId" = '${p1.id}' AND status = 'ACEITA'`);
    const r = await tr.responderTransferencia({ id: linhas[0].id, lojaIds: [aeroporto.id], aceitar: true, quem: "Aero" });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
  });

  await caso("pedido que saiu enquanto esperava expira e a origem é avisada", async () => {
    const p2 = await novoPedido({ dailyOrderNumber: 105 });
    const r1 = await tr.pedirTransferencia({ lojaId: lagomar.id, orderId: p2.id, paraLojaId: aeroporto.id, confirmacao: "transferir", quem: "Antonio" });
    assert.equal(r1.ok, true);
    await prisma.customerOrder.update({ where: { id: p2.id }, data: { status: "SAIU_ENTREGA" } });
    assert.equal((await tr.transferenciasDaVisao([aeroporto.id])).paraEstaLoja.length, 0);
    const aqui = await tr.transferenciasDaVisao([lagomar.id]);
    const e = aqui.enviadas.find((x) => x.numero === "105");
    assert.equal(e.status, "EXPIRADA");
    assert.match(e.motivo, /saiu para entrega/);
    const r = await tr.responderTransferencia({ id: r1.id, lojaIds: [aeroporto.id], aceitar: true, quem: "Aero" });
    assert.equal(r.ok, false);
  });

  await caso("desfazer antes da resposta: some do pop-up de lá", async () => {
    const p3 = await novoPedido({ dailyOrderNumber: 106 });
    const r1 = await tr.pedirTransferencia({ lojaId: lagomar.id, orderId: p3.id, paraLojaId: aeroporto.id, confirmacao: "transferir", quem: "Antonio" });
    const d = await tr.desfazerTransferencia({ id: r1.id, lojaIds: [lagomar.id], quem: "Antonio" });
    assert.equal(d.ok, true);
    assert.equal((await tr.transferenciasDaVisao([aeroporto.id])).paraEstaLoja.length, 0);
    assert.equal((await tr.transferenciasDaVisao([lagomar.id])).enviadas.find((x) => x.numero === "106"), undefined);
    const r = await tr.responderTransferencia({ id: r1.id, lojaIds: [aeroporto.id], aceitar: true, quem: "Aero" });
    assert.equal(r.ok, false);
  });

  await caso("pedido do iFood não vai", async () => {
    const p4 = await novoPedido({ dailyOrderNumber: 107, source: "IFOOD", ifoodOrderId: `if-${marca}` });
    const r = await tr.pedirTransferencia({ lojaId: lagomar.id, orderId: p4.id, paraLojaId: aeroporto.id, confirmacao: "transferir", quem: "Antonio" });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
  });

  console.log(`\n✅ ${ok} casos ok`);
  await prisma.$disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error("❌", e);
  process.exit(1);
});
