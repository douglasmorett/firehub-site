/**
 * Teste da simulação de pedidos (lib/pedidos-simulados.ts) contra um banco
 * LOCAL — nunca produção. Sobe um PGlite (`pglite-server --port=5441`), faz
 * `prisma db push` nele e roda `npx tsx scripts/teste-pedidos-simulados.ts`
 * com a DATABASE_URL do PGlite (127.0.0.1:5441, `pgbouncer=true` e
 * `connection_limit=1`). Qualquer outra URL é recusada.
 */
import { prisma } from "@/lib/prisma";
import { apagarSimulacao, contarSimulados, criarSimulacao, ehLojaDeDemonstracao, MARCA_DA_SIMULACAO } from "@/lib/pedidos-simulados";
import { calcularEsperadoDoTurno } from "@/lib/esperado-do-turno";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import { ehDo99Food } from "@/lib/cupom-do-parceiro";
import { ehPedido99Food } from "@/lib/food99-status";

const LOJA = "cmupkiesh0000ujmcjwtpd706";
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL || "")) {
  console.error("DATABASE_URL não é local — recusado.");
  process.exit(1);
}

let falhas = 0;
const conferir = (ok: boolean, o: string) => { console.log(`${ok ? "✔" : "✘"} ${o}`); if (!ok) falhas++; };

async function main() {
  await prisma.customerOrder.deleteMany({ where: { franchiseeId: LOJA } });
  await prisma.tableSession.deleteMany({ where: { franchiseeId: LOJA } });
  await prisma.table.deleteMany({ where: { franchiseeId: LOJA } });
  await prisma.cashSession.deleteMany({ where: { franchiseeId: LOJA } });
  await prisma.menuProduct.deleteMany({ where: { franchiseeId: LOJA } });
  await prisma.user.deleteMany({ where: { id: LOJA } });

  await prisma.user.create({ data: { id: LOJA, email: "demo@teste.local", name: "Victor demo", password: "x", storeName: "Victor (demonstração)" } as any });
  const comidas = ["Esfiha de Carne", "Esfiha de Queijo", "Beirute de Frango", "Kibe", "Pizza Calabresa", "Esfiha de Calabresa", "Fatayer", "Esfiha de Frango"];
  for (const [i, nome] of comidas.entries()) {
    await prisma.menuProduct.create({ data: { franchiseeId: LOJA, name: nome, description: "", price: 3.9 + i * 4, priceSalao: i === 0 ? 3.5 : null, sortOrder: i } });
  }
  for (const [i, nome] of ["Coca-Cola Lata", "Guaraná 2L", "Suco de Laranja"].entries()) {
    await prisma.menuProduct.create({ data: { franchiseeId: LOJA, name: nome, description: "", price: 6 + i * 3, isBeverage: true, sortOrder: 20 + i } });
  }
  await prisma.menuProduct.create({ data: { franchiseeId: LOJA, name: "Só no combo", description: "", price: 5, apenasEmCombo: true } });
  await prisma.menuProduct.create({ data: { franchiseeId: LOJA, name: "Desativado", description: "", price: 5, active: false } });
  // Um pedido DE VERDADE e uma mesa ocupada: nenhum dos dois pode ser tocado.
  const real = await prisma.customerOrder.create({ data: { franchiseeId: LOJA, customerName: "Cliente real", customerPhone: "22999998888", totalAmount: 40, paymentMethod: "Dinheiro", source: "ONLINE" } });
  const mesaOcupada = await prisma.table.create({ data: { franchiseeId: LOJA, number: 1 } });
  await prisma.tableSession.create({ data: { tableId: mesaOcupada.id, franchiseeId: LOJA, status: "OPEN" } });

  conferir(ehLojaDeDemonstracao(LOJA) && !ehLojaDeDemonstracao("outra") && !ehLojaDeDemonstracao(null), "só a loja de demonstração é reconhecida");

  const r = await criarSimulacao(LOJA);
  conferir(r.quantidade === 20, `20 pedidos criados (${r.quantidade})`);
  conferir(r.caixaAberto, "caixa fechado foi aberto");
  conferir((await contarSimulados(LOJA)) === 20, "contagem pela marca = 20");

  const pedidos = await prisma.customerOrder.findMany({ where: { franchiseeId: LOJA, posTerminalId: MARCA_DA_SIMULACAO }, include: { items: true }, orderBy: { createdAt: "asc" } });
  const porCanal: Record<string, number> = {};
  for (const p of pedidos) { const c = canalDoPedido(p as any).nome; porCanal[c] = (porCanal[c] || 0) + 1; }
  console.log("   canais:", porCanal);
  conferir((porCanal["iFood"] || 0) >= 2 && (porCanal["99Food"] || 0) >= 2, "iFood e 99Food com o selo certo");
  conferir(pedidos.filter((p) => p.deliveryType === "RETIRADA").length >= 2, "retiradas ≥ 2");
  conferir(pedidos.filter((p) => p.tableSessionId).length === 2, "2 pedidos de mesa");
  conferir(pedidos.every((p) => !p.ifoodOrderId && !p.openDeliveryOrderId), "nenhum id de pedido no parceiro");
  conferir(pedidos.every((p) => !ehPedido99Food(p as any)), "nenhum dispara a sincronização do 99Food");
  conferir(pedidos.filter((p) => ehDo99Food(p as any)).length === 2, "caixa reconhece os 2 do 99Food");
  conferir(pedidos.every((p) => p.customerPhone === ""), "telefone vazio em todos");
  conferir(pedidos.every((p) => p.printedAt), "printedAt preenchido em todos");
  conferir(pedidos.every((p) => p.items.length > 0 && p.items.every((i) => !["Só no combo", "Desativado"].includes(i.productName || ""))), "itens só de produto vendável");
  conferir(pedidos.every((p) => Math.abs(p.totalAmount - (p.items.reduce((s, i) => s + i.price * i.quantity, 0) + p.deliveryFee)) < 0.01), "total = itens + entrega");
  const numeros = pedidos.map((p) => p.dailyOrderNumber as number);
  conferir(new Set(numeros).size === 20 && numeros.every((n, i) => i === 0 || n > numeros[i - 1]), `numeração crescente (${numeros.join(",")})`);
  const statuses: Record<string, number> = {};
  pedidos.forEach((p) => (statuses[p.status] = (statuses[p.status] || 0) + 1));
  console.log("   status:", statuses);
  conferir((await prisma.tableSession.count({ where: { tableId: mesaOcupada.id } })) === 1, "mesa ocupada não recebeu sessão simulada");

  const caixa = await prisma.cashSession.findFirst({ where: { franchiseeId: LOJA, status: "OPEN" } });
  const d = await calcularEsperadoDoTurno(LOJA, caixa!);
  console.log("   esperado:", d.expected, "onlineProprio:", d.onlineProprio, "fora:", d.foraDaConferencia);
  const e = d.expected;
  conferir(e.cash > 0 && e.debit > 0 && e.credit > 0 && e.pix > 0 && e.voucher > 0, "todas as formas da gaveta têm valor");
  conferir(e.ifoodOnline > 0 && e.food99Online > 0 && d.onlineProprio > 0 && d.onlineProprio < e.ifoodOnline, "online: plataforma e site separáveis");
  conferir(d.foraDaConferencia.naoIdentificadoQtd === 0, "nenhuma forma não identificada");
  conferir(d.foraDaConferencia.mesasAbertasQtd === 2, "as 2 mesas aparecem como abertas");

  const apagados = await apagarSimulacao(LOJA);
  conferir(apagados === 20, `apagou 20 (${apagados})`);
  conferir((await contarSimulados(LOJA)) === 0, "nenhum simulado sobrou");
  conferir(!!(await prisma.customerOrder.findUnique({ where: { id: real.id } })), "pedido real continua");
  conferir((await prisma.tableSession.count({ where: { franchiseeId: LOJA } })) === 1, "só a sessão da mesa ocupada ficou");
  conferir((await prisma.customerOrderItem.count({ where: { order: { franchiseeId: LOJA, posTerminalId: MARCA_DA_SIMULACAO } } })) === 0, "itens apagados");

  // De novo: a segunda rodada não pode falhar (mesas criadas na 1ª são reaproveitadas).
  const r2 = await criarSimulacao(LOJA);
  conferir(r2.quantidade === 20 && !r2.caixaAberto, "segunda simulação com o caixa já aberto");
  conferir((await prisma.table.count({ where: { franchiseeId: LOJA } })) === 3, "mesas reaproveitadas (1 real + 2 criadas)");
  await apagarSimulacao(LOJA);

  console.log(falhas === 0 ? "\nTUDO CERTO" : `\n${falhas} FALHA(S)`);
  process.exit(falhas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
