/**
 * "Enviar para outra loja" (lib/transferencia-do-pedido.ts).
 *
 * GET                       → o que a tela mostra: pedidos que outra loja mandou
 *                             para cá (pop-up de aceitar) e a resposta dos que
 *                             esta mandou. Consultado em loop pelo AvisoDeTransferencia.
 * GET ?pedido=<id>          → o painel do Editar: as lojas do acesso, se o pedido
 *                             pode ir e se já está esperando a resposta de uma.
 * POST { acao: "enviar", pedidoId, paraLojaId, confirmacao }
 * POST { acao: "aceitar" | "recusar", id, motivo? }
 * POST { acao: "desfazer" | "visto", id }
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lojasDaVisao, lojasDoGrupo } from "@/lib/loja-ativa";
import { motivoQueImpede } from "@/lib/transferencia-do-pedido";
import {
  pedirTransferencia,
  responderTransferencia,
  desfazerTransferencia,
  marcarVisto,
  transferenciasDaVisao,
  transferenciaPendenteDoPedido,
} from "@/lib/transferencia-no-banco";

export const dynamic = "force-dynamic";

async function sessao() {
  const session = await getServerSession(authOptions).catch(() => null);
  const email = session?.user?.email || "";
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true, role: true, name: true } });
  if (!user) return null;
  const lojaId = user.ownerId || user.id;
  const cookieStore = await cookies();
  const visao = await lojasDaVisao(user, cookieStore.get("firehub_active_store")?.value);
  return {
    lojaId,
    lojaIds: [...new Set([...visao.lojaIds, lojaId])],
    funcionario: Boolean(user.ownerId) || String(user.role || "").toUpperCase() === "STAFF",
    quem: session?.user?.name || user.name || email,
  };
}

export async function GET(req: Request) {
  const s = await sessao();
  if (!s) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const pedidoId = new URL(req.url).searchParams.get("pedido");
  try {
    if (pedidoId) {
      const grupo = s.funcionario ? [] : await lojasDoGrupo(s.lojaId);
      const ids = grupo.map((l) => l.id);
      const pedido = ids.length > 1
        ? await prisma.customerOrder.findFirst({
            where: { id: pedidoId, franchiseeId: { in: ids } },
            select: {
              franchiseeId: true, status: true, source: true, tableSessionId: true, ifoodOrderId: true,
              openDeliveryOrderId: true, gatewayProvider: true, gatewayPaymentId: true, fiscalStatus: true,
            },
          })
        : null;
      return NextResponse.json({
        lojas: grupo.map((l) => ({ id: l.id, storeName: l.storeName })),
        lojaDoPedido: pedido?.franchiseeId || null,
        impede: ids.length > 1 ? motivoQueImpede(pedido as any, { grupo: ids }) : "Esta conta tem uma loja só.",
        pendente: pedido ? await transferenciaPendenteDoPedido(pedidoId) : null,
      });
    }
    return NextResponse.json(await transferenciasDaVisao(s.lojaIds));
  } catch (e: any) {
    // Sem a tabela ou com o banco fora: nada a mostrar, sem 500 em loop no console.
    console.error("[Transferência] Não consegui listar:", e?.message);
    return NextResponse.json({ paraEstaLoja: [], enviadas: [], erro: true });
  }
}

export async function POST(req: Request) {
  const s = await sessao();
  if (!s) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({} as any));
  const acao = String(body?.acao || "").trim();
  const id = String(body?.id || "").trim();

  if (acao === "enviar") {
    // Quem envia é quem enxerga as lojas do acesso: o dono (o funcionário fica
    // na loja dele e não tem a opção na tela).
    if (s.funcionario) return NextResponse.json({ error: "Só o acesso do dono envia pedido para outra loja." }, { status: 403 });
    const r = await pedirTransferencia({
      lojaId: s.lojaId,
      orderId: String(body?.pedidoId || "").trim(),
      paraLojaId: String(body?.paraLojaId || "").trim(),
      confirmacao: body?.confirmacao,
      quem: s.quem,
    });
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.erro }, { status: r.status });
  }

  if (!id) return NextResponse.json({ error: "Informe a transferência." }, { status: 400 });

  if (acao === "aceitar" || acao === "recusar") {
    const r = await responderTransferencia({ id, lojaIds: s.lojaIds, aceitar: acao === "aceitar", motivo: body?.motivo, quem: s.quem });
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.erro }, { status: r.status });
  }
  if (acao === "desfazer") {
    const r = await desfazerTransferencia({ id, lojaIds: s.lojaIds, quem: s.quem });
    return r.ok ? NextResponse.json(r) : NextResponse.json({ error: r.erro }, { status: r.status });
  }
  if (acao === "visto") {
    await marcarVisto({ id, lojaIds: s.lojaIds });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}
