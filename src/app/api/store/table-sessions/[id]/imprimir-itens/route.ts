/**
 * POST /api/store/table-sessions/[id]/imprimir-itens
 *
 * "Selecionar itens para impressão" na mesa aberta. Corpo: { itens: string[] }
 * — os ids dos itens lançados (CustomerOrderItem) que o atendente marcou.
 *
 * Pedido do Douglas a partir da Delícia de Casa (02/10/2026): o garçom quer
 * mandar de novo para a cozinha só o que se perdeu, ou só a bebida, sem
 * reimprimir o pedido inteiro nem entender de impressora.
 *
 * ── O caminho é o da reimpressão que já existe ────────────────────────────
 *
 * Vira uma linha `REIMPRESSAO` em PrintRequest — a mesma do botão Imprimir da
 * tela de pedidos quando o Assistente do PC não responde (POST da
 * api/store/print-queue). A fila da nuvem entrega ao Assistente em até 3 s e
 * ROTEIA como comanda de produção (`destinosDoPedido`: categoria, módulo,
 * loja, modelo de cada impressora). O atendente não escolhe impressora.
 *
 * Cada envio tem id próprio (`job_<id da PrintRequest>` e `selecao_<...>` no
 * pedido): o cache de "já impresso" do Assistente não engole a segunda
 * seleção, e dois Assistentes não têm como transformar UM envio em dois
 * papéis por conta de id repetido (ver memória dois-assistentes-imprimem-em-dobro
 * — o caso de dois PCs continua sendo do PC, não deste botão).
 *
 * Só pela fila, sem tentar a impressora local antes (como a conta faz): a
 * impressão local e a da fila só deduplicam pelo id do pedido, e um erro aí
 * vira o papel dobrado na cozinha — justamente o que o atendente está
 * tentando consertar.
 *
 * ── Escolha explícita vence ───────────────────────────────────────────────
 *
 * Com "Não imprimir as bebidas lançadas na mesa" ligado (lib/bebida-da-mesa.ts),
 * a bebida MARCADA aqui imprime: o payload leva `selecaoManual: true`, e a
 * fila não aplica a opção à reimpressão. A opção decide o que sai sozinho; o
 * atendente que marcou a Coca quer a Coca no papel.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolverOperadorDaMesa, rotuloDoOperador } from "@/lib/garcom-auth";
import { escolherItensDaMesa } from "@/lib/selecao-de-impressao";
import { camposDaMesaParaImpressao, nomeDoClienteNaComanda } from "@/lib/mesa-na-comanda";
import { nomeDoItem, nomeDoItemParaComanda } from "@/lib/nome-do-item";
import { comboParaImpressao } from "@/lib/parse-combo";

export const dynamic = "force-dynamic";

/** O mesmo `kind` do POST de api/store/print-queue (a reimpressão do painel). */
const KIND_REIMPRESSAO = "REIMPRESSAO";

/** Assistente que não consulta a fila há mais que isto provavelmente está parado. */
const ASSISTENTE_PARADO_MS = 2 * 60_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Sessão do painel OU cookie do garçom pelo link (src/lib/garcom-auth.ts).
  const operador = await resolverOperadorDaMesa();
  if (!operador) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const lojaId = operador.franchiseeId;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const mesa = await prisma.tableSession.findUnique({
    where: { id },
    select: {
      id: true,
      customerName: true,
      waiterName: true,
      waiter: { select: { name: true } },
      table: { select: { number: true, franchiseeId: true } },
      orders: {
        select: {
          id: true,
          dailyOrderNumber: true,
          status: true,
          notes: true,
          createdAt: true,
          items: {
            select: {
              id: true,
              quantity: true,
              price: true,
              notes: true,
              productName: true,
              comboSelections: true,
              menuProduct: {
                select: {
                  name: true,
                  category: true,
                  isBeverage: true,
                  // Só o que resolve o "+R$ 3,00" do adicional, como a fila.
                  comboGroups: {
                    select: {
                      id: true,
                      items: { select: { additionalPrice: true, precoPorEscolha: true, menuProduct: { select: { name: true } } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!mesa || mesa.table.franchiseeId !== lojaId) {
    return NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 });
  }

  const escolha = escolherItensDaMesa(mesa.orders, body?.itens);
  if (!escolha.ok) return NextResponse.json({ error: escolha.erro }, { status: 400 });

  // A escolha dentro do combo ganha a categoria do produto dela: o suco do
  // combo sai na impressora do suco, igual à comanda original
  // (lib/categoria-do-item.ts). Falhar aqui não impede o papel.
  let crus: any[] = escolha.itens.map(({ item }) => item);
  try {
    const { resolverCategoriasDosPedidos } = await import("@/lib/categoria-do-item");
    const [resolvido] = await resolverCategoriasDosPedidos([{ franchiseeId: lojaId, items: crus as any }]);
    crus = (resolvido?.items as any[]) || crus;
  } catch { /* segue com a categoria do cadastro */ }

  const itens = crus.map((i: any) => ({
    id: i.id,
    // O nome que o Assistente imprime (ver a fila da nuvem): o do dia do
    // pedido, cortado no primeiro " | " quando as opções vão nas linhas de baixo.
    name: i.comboSelections ? nomeDoItemParaComanda(i, "Combo") : nomeDoItem(i, "Item"),
    productName: i.productName,
    quantity: i.quantity,
    qty: i.quantity,
    price: i.price,
    notes: i.notes || "",
    comboSelections: comboParaImpressao(i.comboSelections, i.menuProduct),
    category: i.menuProduct?.category || undefined,
    menuProduct: i.menuProduct
      ? { name: i.menuProduct.name, category: i.menuProduct.category, isBeverage: i.menuProduct.isBeverage === true }
      : null,
    ...(i.opcoesParaImpressao ? { opcoesParaImpressao: i.opcoesParaImpressao } : {}),
  }));

  // A mesa e o garçom no topo do papel, pela mesma regra dos três trilhos
  // (lib/mesa-na-comanda.ts).
  const comMesa = {
    deliveryType: "MESA",
    customerAddress: `Mesa ${mesa.table.number}`,
    tableSessionId: mesa.id,
    tableSession: { waiterName: mesa.waiterName, waiter: mesa.waiter, table: { number: mesa.table.number } },
    customerName: mesa.customerName || `Mesa ${mesa.table.number}`,
  };

  // A observação do pedido só quando a seleção é de UM pedido: juntar as de
  // vários confundiria qual vale para qual item (a do ITEM vai sempre).
  const obsDoPedido = escolha.pedidos.length === 1 ? String(escolha.pedidos[0].notes || "").trim() : "";
  const total = itens.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0);

  const pedidoDoPapel = {
    id: `selecao_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    // Ver o cabeçalho: a opção das bebidas da mesa não vale para isto.
    selecaoManual: true,
    dailyOrderNumber: escolha.numeros,
    customerName: nomeDoClienteNaComanda(comMesa),
    ...camposDaMesaParaImpressao(comMesa),
    tableSessionId: mesa.id,
    customerPhone: "",
    customerAddress: comMesa.customerAddress,
    deliveryType: "MESA",
    deliveryBy: "MERCHANT",
    paymentMethod: "N/A",
    isPrepaid: false,
    source: "PRESENCIAL",
    status: "ACEITO",
    franchiseeId: lojaId,
    // Sem acento e sem emoji: impressora térmica antiga troca por lixo.
    notes: ["IMPRESSAO MANUAL - itens selecionados na mesa", obsDoPedido].filter(Boolean).join(" | "),
    totalAmount: Math.round(total * 100) / 100,
    deliveryFee: 0,
    items: itens,
    createdAt: new Date().toISOString(),
  };

  try {
    await prisma.printRequest.create({
      data: {
        franchiseeId: lojaId,
        kind: KIND_REIMPRESSAO,
        payload: pedidoDoPapel as unknown as Prisma.InputJsonValue,
        requestedBy: rotuloDoOperador(operador),
        tableSessionId: mesa.id,
      },
    });
  } catch (err: any) {
    console.error("[Mesa imprimir-itens] PrintRequest:", err?.code || err?.message);
    return NextResponse.json({ error: "Não consegui mandar para a impressora. Tente de novo." }, { status: 500 });
  }

  // O Assistente está consultando a fila? Se não, o papel não sai agora — e o
  // atendente precisa saber disso na hora, não pela cozinha.
  let assistenteParado = false;
  try {
    const dono = await prisma.user.findUnique({ where: { id: lojaId }, select: { printQueuePolledAt: true } });
    const ultima = dono?.printQueuePolledAt?.getTime() ?? 0;
    assistenteParado = Date.now() - ultima > ASSISTENTE_PARADO_MS;
  } catch { /* coluna ausente: não dá para saber; não assusta ninguém */ }

  const quantidade = itens.reduce((s, i) => s + (Number(i.quantity) || 1), 0);
  return NextResponse.json({ ok: true, linhas: itens.length, quantidade, assistenteParado });
}
