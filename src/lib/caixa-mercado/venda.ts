/**
 * A VENDA DO CAIXA DE MERCADO → pedido do FireHub.
 *
 * O pedido nasce como o do balcão (`source PRESENCIAL`, `RETIRADA`), mas já
 * ENTREGUE: venda de mercado é concluída no caixa, não passa por cozinha nem
 * pelo quadro de pedidos (centenas por dia lotariam o quadro), e não imprime
 * comanda. Por isso não usa lib/venda-presencial.ts (que deixa o pedido
 * ACEITO e manda para a impressora da cozinha). O resto é o mesmo: produto da
 * loja, preço do canal SALÃO (com promoção), baixa de estoque pela ficha,
 * desconto registrado (a mensalidade é sobre o bruto) e a mesma régua dos
 * relatórios e do caixa da loja.
 *
 * ── Com cartão no pinpad (TEF) ──────────────────────────────────────────────
 *
 * O pedido nasce AGUARDANDO_PAGAMENTO (fora dos relatórios) com o estado de
 * pinpad do totem; o Assistente cobra e conta ao servidor
 * (/api/totem/tef/resultado → lib/tef-do-totem.ts). Lá, se o pedido é venda
 * do caixa, a parte esperada é a do cartão (`tefCentavos`) e quem conclui é
 * `concluirVendaComTef` daqui: grava, dá baixa e SÓ ENTÃO o motor confirma
 * (CNF) na PayGo. Recusado: o operador tenta de novo, troca a forma
 * (`trocarFormaDaVendaPendente`) ou cancela.
 */
import { prisma } from "@/lib/prisma";
import { precoDoCanal } from "@/lib/preco-por-canal";
import { generateDailyOrderNumber } from "@/lib/order-number";
import { lerDocumentoDoCliente, normalizarDocumento, problemaDoDocumento } from "@/lib/documento-do-cliente";
import { ESTADO_TEF_NO_PINPAD } from "@/lib/tef-do-totem";
import { garantirEstruturaDoCaixa, MENSAGEM_SEM_ESTRUTURA } from "./estrutura";
import {
  conferirPagamentos, kg3, liquidoPorForma, problemaDaQuantidade, reais, rotuloDaFormaNoPedido, valorDoItem,
  type FormaDoCaixa, type PagamentoDoCaixa, type Unidade,
} from "./conta";
import { marcarUso, type TerminalDoCaixa } from "./terminal";
import type { TurnoDoCaixa } from "./turno";
import type { QuemUsaOCaixa } from "./sessao";

export type ItemDoCorpo = {
  produtoId: string;
  /** UN: unidades (inteiro). KG: peso em kg (3 casas). */
  quantidade: number;
  /** Etiqueta de balança com PREÇO: o valor impresso na etiqueta vale. */
  valorDaEtiquetaCentavos?: number | null;
};

export type ItemCancelado = { nome: string; quantidade: number; valorCentavos: number; em: string; autorizadoPor: string | null };

export type CorpoDaVenda = {
  itens: ItemDoCorpo[];
  descontoCentavos?: number;
  pagamentos: PagamentoDoCaixa[];
  pixTxid?: string | null;
  cpfCnpj?: string | null;
  itensCancelados?: ItemCancelado[];
};

type Resposta = { status: number; corpo: Record<string, unknown> };
const erro = (status: number, mensagem: string): Resposta => ({ status, corpo: { error: mensagem } });

/** Unidade de cada produto (sem linha = UN). */
export async function unidadesDosProdutos(ids: string[]): Promise<Map<string, Unidade>> {
  const mapa = new Map<string, Unidade>();
  if (!ids.length || !(await garantirEstruturaDoCaixa())) return mapa;
  const linhas = await prisma.$queryRawUnsafe<{ menuProductId: string; unidade: string }[]>(
    `SELECT "menuProductId", "unidade" FROM "CaixaMercadoProduto" WHERE "menuProductId" = ANY($1::text[])`,
    ids,
  );
  for (const l of linhas) mapa.set(l.menuProductId, l.unidade === "KG" ? "KG" : "UN");
  return mapa;
}

/** Os itens conferidos e precificados pelo servidor (o navegador só sugere). */
export async function precificarItens(lojaId: string, itens: ItemDoCorpo[]) {
  if (!Array.isArray(itens) || itens.length === 0) return { ok: false as const, erro: "A venda não tem itens." };
  if (itens.length > 990) return { ok: false as const, erro: "Uma venda aceita até 990 itens (limite da NFC-e)." };
  const ids = [...new Set(itens.map((i) => String(i?.produtoId || "")).filter(Boolean))];
  const produtos = await prisma.menuProduct.findMany({
    where: { id: { in: ids }, franchiseeId: lojaId },
    select: { id: true, name: true, price: true, priceSalao: true, priceDelivery: true, priceTotem: true, promoPrice: true },
  });
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const unidades = await unidadesDosProdutos(ids);
  const linhas: { produtoId: string; nome: string; unidade: Unidade; quantidade: number; precoCentavos: number; totalCentavos: number }[] = [];
  for (const i of itens) {
    const p = porId.get(String(i?.produtoId || ""));
    if (!p) return { ok: false as const, erro: "Um dos itens não é do cadastro desta loja." };
    const unidade = unidades.get(p.id) ?? "UN";
    const precoCentavos = Math.round(precoDoCanal(p as any, "salao") * 100);
    const etiqueta = Number(i.valorDaEtiquetaCentavos);
    if (unidade === "KG" && Number.isInteger(etiqueta) && etiqueta > 0) {
      // Etiqueta com preço: vale o que a balança imprimiu; o peso sai do preço
      // do quilo (para a nota em KG).
      if (precoCentavos <= 0) return { ok: false as const, erro: `"${p.name}" está sem preço do quilo no cadastro.` };
      const peso = kg3(etiqueta / precoCentavos) || 0.001;
      linhas.push({ produtoId: p.id, nome: p.name, unidade, quantidade: peso, precoCentavos, totalCentavos: etiqueta });
      continue;
    }
    const q = Number(i.quantidade);
    const problema = problemaDaQuantidade(unidade, q);
    if (problema) return { ok: false as const, erro: `${p.name}: ${problema}` };
    if (precoCentavos <= 0) return { ok: false as const, erro: `"${p.name}" está sem preço de venda. Corrija no cadastro.` };
    const quantidade = unidade === "KG" ? kg3(q) : Math.round(q);
    linhas.push({ produtoId: p.id, nome: p.name, unidade, quantidade, precoCentavos, totalCentavos: valorDoItem(unidade, quantidade, precoCentavos) });
  }
  return { ok: true as const, linhas };
}

/** O texto e as partes que o pedido grava (o que o caixa da loja e a nota leem). */
function pagamentoDoPedido(liquido: PagamentoDoCaixa[], tipoTef: "Crédito" | "Débito" | null) {
  const partes = liquido.map((p) => ({ method: rotuloDaFormaNoPedido(p.forma, tipoTef), amount: p.valorCentavos / 100 }));
  if (partes.length === 1) return { paymentMethod: partes[0].method, paymentMethods: null };
  return {
    paymentMethod: `Dividido: ${partes.map((p) => `${p.method} ${reais(Math.round(p.amount * 100))}`).join(" + ")}`,
    paymentMethods: partes,
  };
}

export async function registrarVendaDoCaixa(opcoes: {
  quem: QuemUsaOCaixa;
  terminal: TerminalDoCaixa;
  turno: TurnoDoCaixa;
  corpo: CorpoDaVenda;
}): Promise<Resposta> {
  const { quem, terminal, turno, corpo } = opcoes;
  if (!(await garantirEstruturaDoCaixa())) return erro(503, MENSAGEM_SEM_ESTRUTURA);
  const lojaId = terminal.lojaId;

  const precos = await precificarItens(lojaId, corpo?.itens || []);
  if (!precos.ok) return erro(400, precos.erro);
  const subtotal = precos.linhas.reduce((s, l) => s + l.totalCentavos, 0);
  const desconto = Math.max(0, Math.round(Number(corpo?.descontoCentavos) || 0));
  if (desconto >= subtotal) return erro(400, "O desconto não pode ser o valor inteiro da venda.");
  const total = subtotal - desconto;

  const pagamentos: PagamentoDoCaixa[] = (Array.isArray(corpo?.pagamentos) ? corpo.pagamentos : []).map((p: any) => ({
    forma: String(p?.forma || "") as FormaDoCaixa,
    valorCentavos: Math.round(Number(p?.valorCentavos)),
  }));
  const conferencia = conferirPagamentos(total, pagamentos);
  if (!conferencia.ok) return erro(400, conferencia.erro);
  const { trocoCentavos, tefCentavos } = conferencia;
  const liquido = liquidoPorForma(pagamentos, trocoCentavos);

  if (normalizarDocumento(corpo?.cpfCnpj)) {
    const problema = problemaDoDocumento(corpo?.cpfCnpj);
    if (problema) return erro(400, problema);
  }
  const cpf = lerDocumentoDoCliente(corpo?.cpfCnpj);
  const pixTxid = pagamentos.some((p) => p.forma === "PIX") && corpo?.pixTxid && /^[A-Za-z0-9]{1,25}$/.test(corpo.pixTxid) ? corpo.pixTxid : null;
  const cancelados = Array.isArray(corpo?.itensCancelados) ? corpo.itensCancelados.slice(0, 200) : [];

  const comTef = tefCentavos > 0;
  const { paymentMethod, paymentMethods } = pagamentoDoPedido(liquido, null);
  const dinheiro = pagamentos.filter((p) => p.forma === "DINHEIRO").reduce((s, p) => s + p.valorCentavos, 0);
  const agora = new Date();

  const order = await prisma.customerOrder.create({
    data: {
      franchiseeId: lojaId,
      // Com TEF o número nasce na conclusão (como no totem): venda recusada não queima número.
      ...(comTef ? {} : { dailyOrderNumber: await generateDailyOrderNumber(lojaId) }),
      customerName: terminal.nome,
      customerPhone: "00000000000",
      customerAddress: "",
      deliveryType: "RETIRADA",
      source: "PRESENCIAL",
      status: comTef ? "AGUARDANDO_PAGAMENTO" : "ENTREGUE",
      ...(comTef ? { posStatus: ESTADO_TEF_NO_PINPAD } : {}),
      paymentMethod,
      ...(paymentMethods ? { paymentMethods } : {}),
      // "Troco para": o dinheiro que o cliente entregou (como o balcão grava).
      changeAmount: trocoCentavos > 0 ? dinheiro / 100 : null,
      notes: `Caixa de mercado — ${terminal.nome} · ${quem.nome}`,
      ...(cpf ? { customerCpfCnpj: cpf } : {}),
      totalAmount: total / 100,
      ...(desconto > 0
        ? {
            discountTotal: desconto / 100,
            discountMerchant: desconto / 100,
            editHistory: [{
              quando: agora.toISOString(),
              quem: `${quem.nome} (${quem.dono ? "dono" : "funcionário"})`,
              quemId: quem.usuarioId,
              acao: "DESCONTO",
              descricao: `desconto no caixa de mercado: ${reais(desconto)}`,
              totalAntes: subtotal / 100,
              totalDepois: total / 100,
            }] as any,
          }
        : {}),
      deliveryFee: 0,
      items: {
        create: precos.linhas.map((l) => l.unidade === "KG"
          ? { menuProductId: l.produtoId, productName: l.nome, quantity: 1, price: l.totalCentavos / 100, pesoKg: l.quantidade }
          : { menuProductId: l.produtoId, productName: l.nome, quantity: l.quantidade, price: l.precoCentavos / 100 }),
      },
    },
    select: { id: true, dailyOrderNumber: true },
  });

  await prisma.$executeRawUnsafe(
    `INSERT INTO "CaixaMercadoVenda" ("orderId", "lojaId", "turnoId", "terminalId", "operador", "operadorId", "situacao", "totalCentavos", "pagamentos", "trocoCentavos", "tefCentavos", "pixTxid", "pixConfirmadoPor", "itensCancelados", "criadoEm")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14::jsonb, (NOW() AT TIME ZONE 'UTC'))`,
    order.id, lojaId, turno.id, terminal.id, quem.nome, quem.usuarioId, comTef ? "AGUARDANDO_TEF" : "CONCLUIDA", total,
    JSON.stringify(liquido), trocoCentavos, tefCentavos, pixTxid, pixTxid ? quem.nome : null, JSON.stringify(cancelados),
  );

  if (!comTef) await depoisDeConcluir(order.id, terminal);
  return {
    status: 200,
    corpo: {
      ok: true,
      orderId: order.id,
      numero: order.dailyOrderNumber ?? null,
      totalCentavos: total,
      trocoCentavos,
      tefCentavos,
      situacao: comTef ? "AGUARDANDO_TEF" : "CONCLUIDA",
    },
  };
}

async function depoisDeConcluir(orderId: string, terminal: { id: string; lojaId: string }) {
  await marcarUso(terminal);
  const { deductStockForOrder } = await import("@/lib/stock");
  deductStockForOrder(orderId).catch((err) => console.error("[Caixa de mercado] baixa de estoque:", err));
}

type LinhaDaVenda = { orderId: string; lojaId: string; terminalId: string; situacao: string; totalCentavos: number; tefCentavos: number; pagamentos: unknown; trocoCentavos: number };

export async function vendaDoCaixa(orderId: string): Promise<LinhaDaVenda | null> {
  if (!(await garantirEstruturaDoCaixa())) return null;
  const [v] = await prisma.$queryRawUnsafe<LinhaDaVenda[]>(`SELECT * FROM "CaixaMercadoVenda" WHERE "orderId" = $1`, orderId);
  return v ?? null;
}

/**
 * Para lib/tef-do-totem.ts: a venda é do caixa de mercado? Devolve a parte do
 * cartão (o valor que o pinpad tem de ter aprovado). Nulo = não é (totem).
 */
export async function parteTefDaVendaDoCaixa(orderId: string): Promise<number | null> {
  try {
    const v = await vendaDoCaixa(orderId);
    return v ? Number(v.tefCentavos) : null;
  } catch {
    return null;
  }
}

/**
 * O pinpad aprovou e o pedido já tem o carimbo do TEF (gatewayProvider): a
 * venda é concluída aqui — ENTREGUE, paga, com número, forma "Cartão Crédito
 * (TEF)" na parte do cartão, baixa de estoque. Idempotente. Devolve o pedido
 * no formato que lib/tef-do-totem.ts confere (status, paymentPaidAt).
 */
export async function concluirVendaComTef(orderId: string) {
  const venda = await vendaDoCaixa(orderId);
  const pedido = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { id: true, franchiseeId: true, status: true, paymentPaidAt: true, dailyOrderNumber: true, createdAt: true, posDadosTransacao: true },
  });
  if (!venda || !pedido) return null;
  if (pedido.status === "CANCELADO") return pedido;
  if (pedido.paymentPaidAt && venda.situacao === "CONCLUIDA") return pedido;
  const tipo = ((pedido.posDadosTransacao as any)?.tipo as "Crédito" | "Débito" | null) ?? null;
  const pagamentos = (typeof venda.pagamentos === "string" ? JSON.parse(venda.pagamentos) : venda.pagamentos) as PagamentoDoCaixa[];
  const { paymentMethod, paymentMethods } = pagamentoDoPedido(pagamentos, tipo);
  const numero = pedido.dailyOrderNumber ?? (await generateDailyOrderNumber(pedido.franchiseeId, pedido.createdAt));
  const trava = await prisma.customerOrder.updateMany({
    where: { id: orderId, paymentPaidAt: null, status: { not: "CANCELADO" } },
    data: { paymentPaidAt: new Date(), status: "ENTREGUE", dailyOrderNumber: numero, paymentMethod, ...(paymentMethods ? { paymentMethods } : {}) },
  });
  if (trava.count > 0) {
    await prisma.$executeRawUnsafe(`UPDATE "CaixaMercadoVenda" SET "situacao" = 'CONCLUIDA' WHERE "orderId" = $1`, orderId);
    await depoisDeConcluir(orderId, { id: venda.terminalId, lojaId: venda.lojaId });
  }
  return prisma.customerOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true, paymentPaidAt: true, dailyOrderNumber: true } });
}

/** Ainda dá para mexer na venda que espera o pinpad? (não paga, não cancelada, sem carimbo do TEF) */
async function pendenteDoTerminal(orderId: string, terminalId: string) {
  const venda = await vendaDoCaixa(orderId);
  if (!venda || venda.terminalId !== terminalId) return { erro: erro(404, "Venda não encontrada neste caixa.") };
  if (venda.situacao !== "AGUARDANDO_TEF") return { erro: erro(409, "Esta venda já foi concluída ou cancelada.") };
  const pedido = await prisma.customerOrder.findUnique({ where: { id: orderId }, select: { paymentPaidAt: true, gatewayProvider: true, status: true } });
  if (!pedido || pedido.paymentPaidAt || pedido.gatewayProvider || pedido.status === "CANCELADO") {
    return { erro: erro(409, "O pinpad já aprovou esta venda: espere a confirmação.") };
  }
  return { venda };
}

/** A venda do pinpad recusado vai para outra forma (ou volta ao pinpad com outro valor). */
export async function trocarFormaDaVendaPendente(orderId: string, terminal: TerminalDoCaixa, novos: PagamentoDoCaixa[]): Promise<Resposta> {
  const r = await pendenteDoTerminal(orderId, terminal.id);
  if (r.erro) return r.erro;
  const venda = r.venda!;
  const conferencia = conferirPagamentos(Number(venda.totalCentavos), novos);
  if (!conferencia.ok) return erro(400, conferencia.erro);
  const liquido = liquidoPorForma(novos, conferencia.trocoCentavos);
  const { paymentMethod, paymentMethods } = pagamentoDoPedido(liquido, null);
  const dinheiro = novos.filter((p) => p.forma === "DINHEIRO").reduce((s, p) => s + p.valorCentavos, 0);
  await prisma.$executeRawUnsafe(
    `UPDATE "CaixaMercadoVenda" SET "pagamentos" = $2::jsonb, "trocoCentavos" = $3, "tefCentavos" = $4 WHERE "orderId" = $1`,
    orderId, JSON.stringify(liquido), conferencia.trocoCentavos, conferencia.tefCentavos,
  );
  const comTef = conferencia.tefCentavos > 0;
  const pedido = await prisma.customerOrder.findUnique({ where: { id: orderId }, select: { franchiseeId: true, createdAt: true, dailyOrderNumber: true } });
  await prisma.customerOrder.update({
    where: { id: orderId },
    data: {
      paymentMethod,
      paymentMethods: paymentMethods ?? undefined,
      changeAmount: conferencia.trocoCentavos > 0 ? dinheiro / 100 : null,
      ...(comTef ? {} : {
        status: "ENTREGUE",
        posStatus: null,
        dailyOrderNumber: pedido?.dailyOrderNumber ?? (await generateDailyOrderNumber(pedido!.franchiseeId, pedido!.createdAt)),
      }),
    },
  });
  if (!comTef) {
    await prisma.$executeRawUnsafe(`UPDATE "CaixaMercadoVenda" SET "situacao" = 'CONCLUIDA' WHERE "orderId" = $1`, orderId);
    await depoisDeConcluir(orderId, terminal);
  }
  const final = await prisma.customerOrder.findUnique({ where: { id: orderId }, select: { dailyOrderNumber: true } });
  return { status: 200, corpo: { ok: true, orderId, numero: final?.dailyOrderNumber ?? null, trocoCentavos: conferencia.trocoCentavos, tefCentavos: conferencia.tefCentavos, situacao: comTef ? "AGUARDANDO_TEF" : "CONCLUIDA" } };
}

/** Desiste da venda que esperava o pinpad (nada foi cobrado). */
export async function cancelarVendaPendente(orderId: string, terminal: TerminalDoCaixa, quem: QuemUsaOCaixa): Promise<Resposta> {
  const r = await pendenteDoTerminal(orderId, terminal.id);
  if (r.erro) return r.erro;
  const trava = await prisma.customerOrder.updateMany({
    where: { id: orderId, paymentPaidAt: null, gatewayProvider: null, status: "AGUARDANDO_PAGAMENTO" },
    data: { status: "CANCELADO", posStatus: null, notes: `Caixa de mercado — ${terminal.nome} · venda desistida no pinpad por ${quem.nome}` },
  });
  if (trava.count === 0) return erro(409, "O pinpad já aprovou esta venda: espere a confirmação.");
  await prisma.$executeRawUnsafe(`UPDATE "CaixaMercadoVenda" SET "situacao" = 'CANCELADA' WHERE "orderId" = $1`, orderId);
  return { status: 200, corpo: { ok: true } };
}

/** A situação da venda para o caixa (depois do pinpad). */
export async function situacaoDaVenda(orderId: string, terminal: TerminalDoCaixa) {
  const venda = await vendaDoCaixa(orderId);
  if (!venda || venda.terminalId !== terminal.id) return null;
  const pedido = await prisma.customerOrder.findUnique({ where: { id: orderId }, select: { status: true, paymentPaidAt: true, dailyOrderNumber: true, paymentMethod: true, posStatus: true } });
  return { situacao: venda.situacao, numero: pedido?.dailyOrderNumber ?? null, pago: Boolean(pedido?.paymentPaidAt), status: pedido?.status ?? null, forma: pedido?.paymentMethod ?? null, posStatus: pedido?.posStatus ?? null };
}
