/**
 * scripts/teste-acrescimo-banco.ts
 *
 * Prova de ponta a ponta do acréscimo em pedido que está na cozinha, num
 * Postgres DESCARTÁVEL — nunca em produção:
 *
 *   npx prisma dev --name acrescimo-teste --detach
 *     (copie a URL "TCP" que ele mostra — localhost, banco template1)
 *   DATABASE_URL="<URL TCP>" npx prisma db push --skip-generate
 *   DATABASE_URL="<URL TCP>&pgbouncer=true" EVOLUTION_API_URL=http://127.0.0.1:9 EVOLUTION_API_KEY=teste \
 *     npx tsx scripts/teste-acrescimo-banco.ts
 *
 * O `pgbouncer=true` não é enfeite: o Postgres do `prisma dev` (PGlite) guarda
 * as prepared statements entre conexões, e a segunda execução colide com a
 * primeira ("prepared statement s0 already exists").
 *
 * Recusa rodar se o banco não for local, e o gateway de WhatsApp aponta para
 * uma porta fechada: nenhuma mensagem sai para ninguém.
 *
 * O cenário é o da Hakim Centro em 12/09/2026: a Gabi com o #48 do site em
 * preparo pedindo mais itens pelo WhatsApp.
 */
const urlDoBanco = process.env.DATABASE_URL || "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(urlDoBanco)) {
  console.error("🛑 Este teste só roda em banco LOCAL (localhost). DATABASE_URL atual não é local.");
  process.exit(2);
}
if (!/^http:\/\/127\.0\.0\.1:9\/?$/.test(process.env.EVOLUTION_API_URL || "")) {
  console.error("🛑 Defina EVOLUTION_API_URL=http://127.0.0.1:9 — o padrão do código é o gateway de produção.");
  process.exit(2);
}

import { prisma } from "@/lib/prisma";
import {
  registrarAcrescimo,
  listarAcrescimosPendentes,
  responderAcrescimo,
  acrescimosDoPedidoParaOPrompt,
} from "@/lib/acrescimo-servidor";

let falhas = 0;
const conferir = (nome: string, ok: boolean, detalhe?: unknown) => {
  if (ok) { console.log("  ok    " + nome); return; }
  falhas++;
  console.log("  FALHA " + nome + (detalhe !== undefined ? " — " + JSON.stringify(detalhe) : ""));
};

async function main() {
  const marca = `teste_${Date.now()}`;
  const loja = await prisma.user.create({
    data: { name: "Hakim Teste", email: `${marca}@teste.local`, password: "x", storeName: "Hakim Teste", storeTimezone: "America/Sao_Paulo" } as any,
  });
  const coca = await prisma.menuProduct.create({
    data: { name: "Coca-Cola 2L", description: "", price: 12, category: "Bebidas", isBeverage: true, franchiseeId: loja.id } as any,
  });
  const batata = await prisma.menuProduct.create({
    data: { name: "Batata Frita", description: "", price: 18.5, category: "Porções", franchiseeId: loja.id } as any,
  });
  const cardapio = [coca, batata];

  const criarPedido = (dados: Record<string, unknown>) =>
    prisma.customerOrder.create({
      data: {
        franchiseeId: loja.id,
        customerName: "Gabi",
        customerPhone: "22981119535",
        totalAmount: 132.59,
        status: "PREPARANDO",
        source: "ONLINE",
        deliveryType: "DELIVERY",
        paymentMethod: "Crédito (Cobrar na Entrega)",
        dailyOrderNumber: 48,
        ...dados,
      } as any,
    });

  const p48 = await criarPedido({});
  await prisma.customerOrderItem.create({ data: { orderId: p48.id, menuProductId: batata.id, productName: "Batata Frita", quantity: 1, price: 18.5 } });
  const ifood = await criarPedido({
    customerName: "Steffany", customerPhone: "22990000001", source: "IFOOD", ifoodOrderId: `${marca}-ifood`,
    ifoodReference: "0221", dailyOrderNumber: 49, totalAmount: 19.89,
  });

  const registrar = (telefone: string, payload: any) =>
    registrarAcrescimo({ franchiseeId: loja.id, telefone, remoteJid: `${telefone}@s.whatsapp.net`, payload, storeProducts: cardapio, timezone: "America/Sao_Paulo" });

  console.log("\n1) O robô leva o pedido de acréscimo à cozinha");
  const r1 = await registrar("5522981119535", { pedido: 48, items: [{ name: "Coca-Cola 2L", quantity: 1 }] });
  conferir("registrado no #48 com o preço do cardápio", r1.registrado === true && r1.numero === 48 && r1.subtotal === 12, r1);
  const r2 = await registrar("5522981119535", { pedido: "#48", items: [{ name: "coca cola 2l", quantity: 2 }] });
  conferir("cliente mudou a lista antes da resposta: substitui o pendente", r2.registrado === true && r2.substituiuPendente === true && r2.subtotal === 24, r2);
  conferir("continua UM pendente só", (await prisma.pedidoAcrescimo.count({ where: { orderId: p48.id, status: "PENDENTE" } })) === 1);
  const r3 = await registrar("5522981119535", { pedido: 48, items: [{ name: "Pizza de Unicórnio", quantity: 1 }] });
  conferir("item que não existe no cardápio não entra", r3.registrado === false && !r3.registrado && /nenhum item do acréscimo existe no cardápio/.test(r3.motivo), r3);
  const r4 = await registrar("5521977776666", { pedido: 48, items: [{ name: "Coca-Cola 2L", quantity: 1 }] });
  conferir("outro telefone não alcança o #48 da Gabi", r4.registrado === false && /nenhum pedido deste telefone/.test(r4.motivo), r4);
  const r5 = await registrar("5522990000001", { pedido: 221, items: [{ name: "Coca-Cola 2L", quantity: 1 }] });
  conferir("pedido do iFood: recusa e explica o canal", r5.registrado === false && !r5.registrado && r5.mensagemParaOCliente.includes("iFood"), r5);

  console.log("\n2) A tela da loja vê o pedido");
  const lista = await listarAcrescimosPendentes(loja.id);
  conferir("um aviso, do #48, com 2x Coca e R$ 24", lista.length === 1 && lista[0].numero === 48 && lista[0].subtotal === 24 && lista[0].itens[0].quantity === 2, lista);
  conferir("pedido não pago: nada a cobrar à parte", lista[0]?.cobrarNaEntrega === false);

  console.log("\n3) A loja aceita");
  const aceitar = await responderAcrescimo({ franchiseeId: loja.id, acrescimoId: lista[0].id, decisao: "ACEITAR", respondidoPor: "Caixa" });
  conferir("aceito, novo total 156,59", aceitar.ok === true && aceitar.ok && aceitar.novoTotal === 156.59, aceitar);
  const depois = await prisma.customerOrder.findUnique({ where: { id: p48.id }, include: { items: true } });
  conferir("o pedido tem o item novo com a nota de acréscimo", depois?.items.length === 2 && depois.items.some((i) => i.quantity === 2 && i.notes === "➕ ACRÉSCIMO (WhatsApp)"), depois?.items);
  conferir("o total do pedido foi somado", depois?.totalAmount === 156.59, depois?.totalAmount);
  conferir("a observação registra o acréscimo", (depois?.notes || "").includes("➕ Acréscimo pelo WhatsApp"), depois?.notes);
  const comanda = await prisma.printRequest.findFirst({ where: { franchiseeId: loja.id }, orderBy: { createdAt: "desc" } });
  const payload: any = comanda?.payload || {};
  conferir("comanda do acréscimo enfileirada nas impressoras de comanda", comanda?.kind === "REIMPRESSAO", comanda?.kind);
  conferir("comanda só com o item novo e o total do acréscimo", payload.items?.length === 1 && payload.totalAmount === 24 && payload.dailyOrderNumber === 48, { itens: payload.items?.length, total: payload.totalAmount });
  conferir("comanda avisa que é acréscimo", String(payload.notes || "").includes("ACRESCIMO DO PEDIDO #48"), payload.notes);
  conferir("comanda leva o produto com a categoria (roteamento por impressora)", payload.items?.[0]?.menuProduct?.category === "Bebidas", payload.items?.[0]?.menuProduct);
  const deNovo = await responderAcrescimo({ franchiseeId: loja.id, acrescimoId: lista[0].id, decisao: "ACEITAR" });
  conferir("responder de novo: já respondido", deNovo.ok === false && !deNovo.ok && deNovo.codigo === "JA_RESPONDIDO", deNovo);
  const outraLoja = await responderAcrescimo({ franchiseeId: "outra-loja", acrescimoId: lista[0].id, decisao: "RECUSAR" });
  conferir("outra loja não responde acréscimo alheio", outraLoja.ok === false && !outraLoja.ok && outraLoja.codigo === "NAO_ENCONTRADO", outraLoja);

  console.log("\n4) Dois cliques ao mesmo tempo (duas telas abertas)");
  const r6 = await registrar("5522981119535", { pedido: 48, items: [{ name: "Batata Frita", quantity: 1 }] });
  const id6 = r6.registrado ? r6.acrescimoId : "";
  const [c1, c2] = await Promise.all([
    responderAcrescimo({ franchiseeId: loja.id, acrescimoId: id6, decisao: "ACEITAR" }),
    responderAcrescimo({ franchiseeId: loja.id, acrescimoId: id6, decisao: "ACEITAR" }),
  ]);
  conferir("só um clique vale", [c1, c2].filter((c) => c.ok).length === 1, [c1, c2]);
  const aposCorrida = await prisma.customerOrder.findUnique({ where: { id: p48.id }, include: { items: true } });
  conferir("a batata entrou uma vez só", aposCorrida?.items.length === 3 && aposCorrida.totalAmount === 175.09, { itens: aposCorrida?.items.length, total: aposCorrida?.totalAmount });

  console.log("\n5) A loja recusa com motivo");
  const r7 = await registrar("5522981119535", { pedido: 48, items: [{ name: "Coca-Cola 2L", quantity: 1 }] });
  const recusar = await responderAcrescimo({
    franchiseeId: loja.id, acrescimoId: r7.registrado ? r7.acrescimoId : "", decisao: "RECUSAR", motivo: "o pedido já está saindo",
  });
  conferir("recusado", recusar.ok === true && recusar.ok && recusar.status === "RECUSADO", recusar);
  const gravadoRecusa = await prisma.pedidoAcrescimo.findUnique({ where: { id: r7.registrado ? r7.acrescimoId : "" } });
  conferir("motivo gravado", gravadoRecusa?.status === "RECUSADO" && gravadoRecusa.motivo === "o pedido já está saindo", gravadoRecusa);
  conferir("total do pedido não mudou", (await prisma.customerOrder.findUnique({ where: { id: p48.id } }))?.totalAmount === 175.09);
  conferir("sem WhatsApp configurado a resposta segue, e diz que não avisou", recusar.ok && recusar.clienteAvisado === false, recusar);

  console.log("\n6) O pedido sai antes de alguém responder");
  const r8 = await registrar("5522981119535", { pedido: 48, items: [{ name: "Coca-Cola 2L", quantity: 1 }] });
  await prisma.customerOrder.update({ where: { id: p48.id }, data: { status: "SAIU_ENTREGA" } });
  conferir("a tela não mostra mais o aviso", (await listarAcrescimosPendentes(loja.id)).length === 0);
  conferir("o pedido de acréscimo virou EXPIRADO", (await prisma.pedidoAcrescimo.findUnique({ where: { id: r8.registrado ? r8.acrescimoId : "" } }))?.status === "EXPIRADO");
  const r9 = await registrar("5522981119535", { pedido: 48, items: [{ name: "Coca-Cola 2L", quantity: 1 }] });
  conferir("com o pedido na rua, o robô nem registra", r9.registrado === false && !r9.registrado && r9.mensagemParaOCliente.includes("já saiu da cozinha"), r9);

  console.log("\n7) Aceitar quando o pedido já saiu (resposta atrasada)");
  await prisma.customerOrder.update({ where: { id: p48.id }, data: { status: "PREPARANDO" } });
  const r10 = await registrar("5522981119535", { pedido: 48, items: [{ name: "Coca-Cola 2L", quantity: 1 }] });
  await prisma.customerOrder.update({ where: { id: p48.id }, data: { status: "ENTREGUE" } });
  const tarde = await responderAcrescimo({ franchiseeId: loja.id, acrescimoId: r10.registrado ? r10.acrescimoId : "", decisao: "ACEITAR" });
  conferir("aceite tardio: PEDIDO_SAIU, nada incluído", tarde.ok === false && !tarde.ok && tarde.codigo === "PEDIDO_SAIU", tarde);
  conferir("total intacto", (await prisma.customerOrder.findUnique({ where: { id: p48.id } }))?.totalAmount === 175.09);

  console.log("\n8) Pedido pago online");
  const pago = await criarPedido({ customerPhone: "22955554444", dailyOrderNumber: 50, paymentMethod: "Pix (Pago Online)", paymentPaidAt: new Date(), totalAmount: 40 });
  const r11 = await registrar("5522955554444", { pedido: 50, items: [{ name: "Coca-Cola 2L", quantity: 1 }] });
  const listaPago = await listarAcrescimosPendentes(loja.id);
  conferir("a tela avisa que a diferença é cobrada na entrega", listaPago.some((p) => p.id === (r11.registrado ? r11.acrescimoId : "") && p.cobrarNaEntrega), listaPago);
  await responderAcrescimo({ franchiseeId: loja.id, acrescimoId: r11.registrado ? r11.acrescimoId : "", decisao: "ACEITAR" });
  const pagoDepois = await prisma.customerOrder.findUnique({ where: { id: pago.id } });
  conferir("observação manda cobrar a diferença na entrega", (pagoDepois?.notes || "").includes("cobrar R$ 12,00 na entrega"), pagoDepois?.notes);

  console.log("\n9) O que o robô lê no prompt");
  const prompt = await acrescimosDoPedidoParaOPrompt(p48.id);
  const linhas = prompt.split("\n");
  conferir("só os 3 mais recentes, para o prompt não crescer", linhas.length === 3, linhas.length);
  conferir("o mais recente vem primeiro (não deu tempo)", /NÃO DEU TEMPO/.test(linhas[0] || ""), linhas[0]);
  conferir("o recusado traz o motivo da loja", /RECUSADO pela cozinha — motivo: o pedido já está saindo/.test(prompt), prompt);
  conferir("pedido sem acréscimo não acrescenta nada ao prompt", (await acrescimosDoPedidoParaOPrompt(ifood.id)) === "");

  // Limpeza: o banco é descartável, mas o teste deixa tudo como encontrou.
  await prisma.pedidoAcrescimo.deleteMany({ where: { franchiseeId: loja.id } });
  await prisma.printRequest.deleteMany({ where: { franchiseeId: loja.id } });
  await prisma.customerOrder.deleteMany({ where: { franchiseeId: loja.id } });
  await prisma.menuProduct.deleteMany({ where: { franchiseeId: loja.id } });
  await prisma.user.delete({ where: { id: loja.id } });
  void ifood;
}

main()
  .catch((e) => { falhas++; console.error("ERRO", e); })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(falhas ? `\n❌ ${falhas} falha(s)\n` : "\n✅ tudo certo\n");
    process.exit(falhas ? 1 : 0);
  });
