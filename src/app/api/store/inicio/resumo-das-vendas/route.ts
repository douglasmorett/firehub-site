import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { funcionarioAbre } from "@/lib/permissao-da-tela";
import { COOKIE_DA_LOJA_ATIVA, lojasDaVisao } from "@/lib/loja-ativa";
import { FUSO_PADRAO } from "@/lib/fuso";
import { emLotes, janelaDoPeriodo } from "@/lib/relatorios/servidor";
import { hojeNaLoja } from "@/lib/relatorios/base";
import { precisaDoDetalheDoCupom } from "@/lib/relatorios/formas-de-pagamento";
import { resumoDasVendas, type PedidoDoResumo } from "@/lib/resumo-das-vendas";

export const dynamic = "force-dynamic";

const DIA_MS = 24 * 60 * 60 * 1000;
/** O mesmo teto da Início: mais que isto é relatório. */
const MAIOR_PERIODO_EM_DIAS = 93;

/**
 * GET /api/store/inicio/resumo-das-vendas — o "Resumo das vendas" do quadro de
 * pedidos, contado no servidor pela régua dos Relatórios (lib/resumo-das-vendas.ts).
 *
 *   ?dia=AAAA-MM-DD          o dia de operação da loja (5h → 5h, no fuso DELA):
 *                            o período padrão do quadro. É a janela de
 *                            Relatórios › Vendas por período (`janelaDoPeriodo`).
 *   ?de=<ISO>&ate=<ISO>      o período que alguém escolheu nas datas do quadro.
 *
 * Por que no servidor: o quadro carrega no máximo 200 pedidos (o feed corta em
 * 200), e a loja grande lança mais que isso num sábado — o resumo somava só o
 * que coube. As lojas são as do quadro: a da sessão, ou o grupo em "Todas as
 * Lojas" (a mesma conta do feed, api/customer-order/poll). O funcionário
 * precisa da caixinha de Pedidos, a da tela onde o botão mora.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, permissions: true, storeTimezone: true },
  });
  if (!usuario) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  if (usuario.role !== "FRANCHISEE" && usuario.role !== "ADMIN" && usuario.role !== "STAFF") {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }
  if (usuario.role === "STAFF" && !funcionarioAbre("/store/pedidos-clientes", String(usuario.permissions ?? ""))) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  const lojaDona = usuario.ownerId || usuario.id;
  const tz = (usuario.ownerId
    ? (await prisma.user.findUnique({ where: { id: lojaDona }, select: { storeTimezone: true } }))?.storeTimezone
    : usuario.storeTimezone) || FUSO_PADRAO;

  // ── O período ─────────────────────────────────────────────────────────
  const geradoEm = new Date();
  const p = req.nextUrl.searchParams;
  const dia = p.get("dia");
  let inicio: Date, fim: Date;
  if (dia) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return NextResponse.json({ error: "Dia inválido" }, { status: 400 });
    ({ inicio, fim } = janelaDoPeriodo(dia, dia, tz));
  } else {
    inicio = new Date(p.get("de") || "");
    fim = new Date(p.get("ate") || "");
    if (isNaN(inicio.getTime()) || isNaN(fim.getTime()) || inicio >= fim) {
      return NextResponse.json({ error: "Período inválido" }, { status: 400 });
    }
  }
  if (fim.getTime() - inicio.getTime() > (MAIOR_PERIODO_EM_DIAS + 1) * DIA_MS) {
    return NextResponse.json({ error: `Período maior que ${MAIOR_PERIODO_EM_DIAS} dias: use Relatórios › Vendas por período.` }, { status: 400 });
  }

  // ── As lojas do quadro ────────────────────────────────────────────────
  const visao = await lojasDaVisao(usuario, req.cookies.get(COOKIE_DA_LOJA_ATIVA)?.value);
  const lojaIds = Array.from(new Set([lojaDona, usuario.id, usuario.ownerId, ...(visao.todas ? visao.lojaIds : [])].filter(Boolean))) as string[];

  const pedidos = await prisma.customerOrder.findMany({
    where: { franchiseeId: { in: lojaIds }, createdAt: { gte: inicio, lt: fim } },
    select: {
      id: true, createdAt: true, status: true, totalAmount: true, deliveryType: true, source: true,
      tableSessionId: true, parentOrderId: true, paymentMethods: true,
      ifoodOrderId: true, ifoodReference: true, openDeliveryOrderId: true, openDeliveryChannel: true,
      discountIfood: true, discountTotal: true, discountMerchant: true,
      items: { select: { quantity: true, price: true } },
    },
  });

  // As observações e o detalhe do desconto (pesados) só de quem precisa deles
  // para saber o cupom do app — a mesma conta do relatório Formas de pagamento.
  const candidatos = pedidos.filter((x) => precisaDoDetalheDoCupom(x as any)).map((x) => x.id);
  const detalhes = await emLotes(candidatos, 500, (lote) => prisma.customerOrder.findMany({
    where: { id: { in: lote }, franchiseeId: { in: lojaIds } },
    select: { id: true, notes: true, discountDetails: true },
  }));
  const detalheDe = new Map(detalhes.map((d) => [d.id, d]));
  const completos: PedidoDoResumo[] = pedidos.map((x) => {
    const d = detalheDe.get(x.id);
    return d ? { ...x, notes: d.notes, discountDetails: d.discountDetails } : x;
  });

  return NextResponse.json({
    de: inicio.toISOString(),
    ate: fim.toISOString(),
    dia: dia || null,
    hoje: hojeNaLoja(tz, geradoEm),
    tz,
    geradoEm: geradoEm.toISOString(),
    resumo: resumoDasVendas(completos),
  });
}
