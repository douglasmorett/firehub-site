import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { normalizarConfigFiscal } from "@/lib/fiscal-config";
import { documentoNoPedido, modoDaEmissao, porQueSemNota, type SemNotaPorque } from "@/lib/fiscal-modo";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

export const dynamic = "force-dynamic";

/**
 * O painel "Nota fiscal" do pedido (Pedidos → Ver pedido, e o 🧾 do card).
 *
 * GET sem `orderId`: só a loja — a emissão está ligada, em que modo, em que
 * ambiente, e o que o pedido faz com o CPF/CNPJ. É o que o painel de pedidos
 * lê uma vez para decidir se mostra o 🧾, e o que o balcão e o totem leem
 * para perguntar o documento.
 *
 * GET com `orderId`: a nota do pedido (autorizada, em contingência,
 * processando, falhou, cancelada ou nenhuma), o porquê de não ter
 * (lib/fiscal-modo → porQueSemNota) e se a emissão exige o CPF/CNPJ (a
 * entrega: sem ele a SEFAZ recusa — 787).
 *
 * POST { orderId, acao: "reimprimir" }: o cupom fiscal (DANFE) de novo na
 * impressora do caixa, pela fila do Assistente (lib/nfce/impressao-do-danfe).
 *
 * EMITIR continua em POST /api/store/fiscal/emitir — a mesma rota do botão da
 * tela fiscal, com as mesmas travas (desligada, cancelado, já emitida, mesa).
 * Esta rota não emite nada.
 *
 * Quem pode: qualquer pessoa da loja. O atendente do balcão é quem ouve "põe
 * o CPF na nota", e o pedido que ele vê no painel já traz o CPF do cliente —
 * o que a tela Fiscal guarda para quem tem "Financeiro" é a LISTA de todos os
 * clientes. O DANFE pelo navegador segue a regra da rota dele (só com
 * "Financeiro"); a reimpressão pela fila, não: é o papel que o balcão já
 * imprime sozinho.
 */
async function lojaDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) } as const;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, permissions: true, name: true, email: true },
  });
  if (!user) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) } as const;
  return { user, lojaId: user.ownerId || user.id } as const;
}

type EstadoDaNota = "autorizada" | "contingencia" | "processando" | "falhou" | "cancelada" | "sem_nota";

export async function GET(req: Request) {
  try {
    const sessao = await lojaDaSessao();
    if ("erro" in sessao) return sessao.erro;
    const { user, lojaId } = sessao;

    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { fiscalConfig: true } });
    const config = normalizarConfigFiscal(loja?.fiscalConfig);
    const daLoja = {
      ligada: config.enabled === true,
      modo: modoDaEmissao(config),
      emHomologacao: Number(config.ambiente) !== 1,
      // O que o balcão e o totem fazem com o CPF/CNPJ (lib/fiscal-modo): a
      // mesma regra que o cardápio do site recebe.
      documentoNoPedido: documentoNoPedido(config),
    };

    const orderId = new URL(req.url).searchParams.get("orderId");
    if (!orderId) return NextResponse.json(daLoja);

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true, franchiseeId: true, dailyOrderNumber: true, status: true, deliveryType: true, tableSessionId: true, createdAt: true,
        paymentMethod: true, paymentMethods: true, gatewayPaymentId: true, customerCpfCnpj: true,
        source: true, openDeliveryChannel: true, openDeliveryOrderId: true, ifoodOrderId: true, ifoodReference: true,
        fiscalStatus: true, fiscalInfo: true,
        tableSession: { select: { status: true } },
      },
    });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.franchiseeId !== lojaId) return NextResponse.json({ error: "Este pedido não é desta loja" }, { status: 403 });

    const fiscal = (order.fiscalInfo && typeof order.fiscalInfo === "object" ? order.fiscalInfo : {}) as Record<string, any>;
    const temChave = Boolean(fiscal.nfceKey);
    const estado: EstadoDaNota =
      order.fiscalStatus === "EMITTED" && temChave
        ? fiscal.contingencia === true ? "contingencia" : "autorizada"
        : order.fiscalStatus === "CANCELED" && temChave
          ? "cancelada"
          : fiscal.processando === true
            ? "processando"
            : order.fiscalStatus === "FAILED" || fiscal.ultimoErro
              ? "falhou"
              : "sem_nota";

    // A marca gravada pela automática (entrega sem CPF) vale mais que a conta
    // feita agora — é o que de fato aconteceu com o pedido.
    const marca = fiscal.semNotaAutomatica && typeof fiscal.semNotaAutomatica === "object" ? fiscal.semNotaAutomatica : null;
    const semNota: SemNotaPorque | { tipo: "outro"; texto: string } | null =
      estado !== "sem_nota"
        ? null
        : marca?.motivo
          ? { tipo: marca.falta === "documento" ? "falta_documento" : "outro", texto: String(marca.motivo) }
          : porQueSemNota(config, order);

    const entrega = String(order.deliveryType ?? "").trim().toUpperCase() === "DELIVERY";
    return NextResponse.json({
      ...daLoja,
      pedido: {
        id: order.id,
        numero: order.dailyOrderNumber ?? null,
        cancelado: String(order.status ?? "").toUpperCase().startsWith("CANCEL"),
        entrega,
        mesa: order.tableSessionId ? { contaFechada: String(order.tableSession?.status ?? "").toUpperCase() === "CLOSED" } : null,
      },
      nota: {
        estado,
        numero: fiscal.nfceNumber ?? null,
        serie: fiscal.serie ?? null,
        chave: temChave ? String(fiscal.nfceKey) : null,
        emitidaEm: fiscal.emittedAt ?? null,
        ambiente: fiscal.ambiente ?? null,
        erro: estado === "falhou" ? String(fiscal.ultimoErro ?? "") || null : null,
        pendencias:
          estado === "falhou" && Array.isArray(fiscal.pendencias)
            ? fiscal.pendencias.slice(0, 8).map((p: any) => ({ campo: String(p?.campo ?? ""), mensagem: String(p?.mensagem ?? "") }))
            : [],
      },
      semNota,
      // Presença 4 (entrega) exige o documento; a mesa e a loja que declara a
      // entrega como presencial, não (lib/fiscal-emissao → presença).
      documentoObrigatorio: entrega && !order.tableSessionId && config.entregaComoPresencial !== true,
      documento: order.customerCpfCnpj ?? null,
      // O DANFE pelo navegador segue a regra da rota dele (api/store/fiscal/danfe).
      podeAbrirODanfe: user.role !== "STAFF" || funcionarioAbre("/store/fiscal", user.permissions),
    });
  } catch (err: any) {
    console.error("[Nota do pedido GET]", String(err?.message ?? "").slice(0, 300));
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sessao = await lojaDaSessao();
    if ("erro" in sessao) return sessao.erro;
    const { user, lojaId } = sessao;

    const { orderId, acao } = await req.json().catch(() => ({}));
    if (!orderId || acao !== "reimprimir") return NextResponse.json({ error: "Pedido e ação obrigatórios" }, { status: 400 });

    const order = await prisma.customerOrder.findUnique({ where: { id: String(orderId) }, select: { id: true, franchiseeId: true, fiscalStatus: true, fiscalInfo: true } });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.franchiseeId !== lojaId) return NextResponse.json({ error: "Este pedido não é desta loja" }, { status: 403 });
    if (order.fiscalStatus !== "EMITTED" || !(order.fiscalInfo as any)?.nfceKey) {
      return NextResponse.json({ error: "sem_nota", mensagem: "Este pedido não tem nota autorizada para imprimir." }, { status: 409 });
    }

    const { enfileirarDanfe } = await import("@/lib/nfce/impressao-do-danfe");
    const r = await enfileirarDanfe(order.id, { forcar: true, operador: user.name || user.email || user.id });
    if (!r.ok) {
      // Nota da Focus não mora no cofre: o cupom dela abre pelo navegador.
      return NextResponse.json({ error: r.motivo, mensagem: r.mensagem }, { status: 409 });
    }
    return NextResponse.json({ ok: true, avisos: r.avisos, vias: r.vias });
  } catch (err: any) {
    console.error("[Nota do pedido POST]", String(err?.message ?? "").slice(0, 300));
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
