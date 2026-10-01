/**
 * POST /api/loja/mesa/pedido — o pedido que o cliente faz pelo QR da mesa.
 *
 * Corpo: { codigo, slug, mesaId?, nome, observacao?, itens: [{ menuProductId, quantity, comboSelections, notes }] }
 *   codigo  o código assinado do QR (lib/mesa-qr.ts): de UMA mesa, ou "geral"
 *   mesaId  só no QR geral: a mesa que o cliente escolheu na tela
 *
 * O pedido entra NA CONTA da mesa, igual ao que o garçom lança
 * (lib/lancar-na-mesa.ts): sem pagamento agora, a conta fecha no fim com o
 * garçom. Mesa fechada abre sozinha, no nome de quem pediu.
 *
 * A loja e a mesa NUNCA vêm do corpo sem prova: a mesa do QR é a do código
 * assinado; a do QR geral tem que ser desta loja (a do código), ativa.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { caixaEstaAberto } from "@/lib/caixa-aberto-servidor";
import { lancarNaMesa } from "@/lib/lancar-na-mesa";
import { lerCodigo, valeParaALoja, valeParaAMesa } from "@/lib/mesa-qr";

export const dynamic = "force-dynamic";

const recusa = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return recusa("Pedido inválido.");

    const lido = lerCodigo(body.codigo);
    if (!lido) return recusa("Este QR Code não vale mais. Chame o garçom.", 404);

    // ── QUAL MESA ─────────────────────────────────────────────────────────
    let mesa: { id: string; number: number; franchiseeId: string; isActive: boolean } | null = null;
    if (lido.tipo === "mesa") {
      mesa = await prisma.table.findUnique({
        where: { id: lido.tableId },
        select: { id: true, number: true, franchiseeId: true, isActive: true },
      });
      if (!mesa || !valeParaAMesa(lido, mesa.franchiseeId)) return recusa("Este QR Code não vale mais. Chame o garçom.", 404);
    } else {
      const loja = await prisma.user.findUnique({ where: { slug: String(body.slug ?? "") }, select: { id: true } });
      if (!loja || !valeParaALoja(lido, loja.id)) return recusa("Este QR Code não vale mais. Chame o garçom.", 404);
      const mesaId = String(body.mesaId ?? "");
      if (!mesaId) return recusa("Escolha a sua mesa.");
      mesa = await prisma.table.findFirst({
        where: { id: mesaId, franchiseeId: loja.id },
        select: { id: true, number: true, franchiseeId: true, isActive: true },
      });
      if (!mesa) return recusa("Essa mesa não existe aqui. Escolha a sua mesa de novo.");
    }
    if (!mesa.isActive) return recusa("Esta mesa não está recebendo pedidos agora. Chame o garçom.", 409);
    const franchiseeId = mesa.franchiseeId;

    // ── TROTE E REPETIÇÃO ─────────────────────────────────────────────────
    // Por MESA, não por IP: no salão todo mundo sai pelo mesmo Wi-Fi. Seis
    // pedidos em 5 minutos na mesma mesa já é um a cada 50 s; e um IP sozinho
    // não derruba o salão inteiro.
    if (!checkRateLimit(`mesa-qr:${mesa.id}`, { windowMs: 5 * 60_000, maxRequests: 6 }).allowed
      || !checkRateLimit(`mesa-qr-ip:${getClientIp(req)}`, { windowMs: 60_000, maxRequests: 10 }).allowed) {
      return recusa("Muitos pedidos seguidos desta mesa. Espere um pouco ou chame o garçom.", 429);
    }

    const nome = String(body.nome ?? "").trim().slice(0, 60);
    if (!nome) return recusa("Qual é o seu nome?");
    const itens = Array.isArray(body.itens) ? body.itens.slice(0, 60) : [];
    if (itens.length === 0) return recusa("A sacola está vazia.");

    // ── CAIXA ─────────────────────────────────────────────────────────────
    // O dinheiro da mesa entra no caixa quando ela fecha: sem caixa aberto,
    // nem o garçom lança. Ao cliente, a frase é dele (a do painel manda
    // "avisar quem abre o caixa").
    if (!(await caixaEstaAberto(franchiseeId))) {
      return recusa("A cozinha ainda não está recebendo pedidos pelo QR. Chame o garçom.", 409);
    }

    // ── A CONTA DA MESA ───────────────────────────────────────────────────
    // A aberta, ou uma nova no nome de quem pediu. Serializável como a
    // abertura pelo garçom: dois celulares da mesma mesa pedindo no mesmo
    // instante não podem abrir duas contas — quem perde a corrida usa a do
    // outro.
    let sessao: { id: string; nova?: boolean } | null = await prisma.tableSession.findFirst({ where: { tableId: mesa.id, status: "OPEN" }, select: { id: true } });
    if (!sessao) {
      try {
        sessao = await prisma.$transaction(async (tx) => {
          const aberta = await tx.tableSession.findFirst({ where: { tableId: mesa!.id, status: "OPEN" }, select: { id: true } });
          if (aberta) return aberta;
          const nova = await tx.tableSession.create({
            data: { tableId: mesa!.id, franchiseeId, customerName: nome, status: "OPEN", openedAt: new Date() },
            select: { id: true },
          });
          return { ...nova, nova: true };
        }, { isolationLevel: "Serializable" });
      } catch {
        // Conflito da transação: o outro celular abriu primeiro.
        sessao = await prisma.tableSession.findFirst({ where: { tableId: mesa.id, status: "OPEN" }, select: { id: true } });
      }
    }
    if (!sessao) return recusa("Não consegui abrir a sua mesa. Tente de novo ou chame o garçom.", 503);

    const r = await lancarNaMesa({
      franchiseeId,
      tableSessionId: sessao.id,
      items: itens,
      notes: body.observacao,
      customerName: nome,
      origemDaImpressao: "FIREHUB",
      comoTentarDeNovo: "Atualize o cardápio e peça de novo.",
    });
    if (!r.ok) {
      // A conta que ESTE pedido abriu não fica aberta vazia (a mesa
      // apareceria ocupada no salão sem ninguém ter pedido nada) — só se
      // ainda não tiver pedido nenhum, de outro celular da mesa.
      if (sessao.nova) {
        await prisma.tableSession.deleteMany({ where: { id: sessao.id, orders: { none: {} } } }).catch(() => {});
      }
      // O lançamento fala com o garçom em inglês em dois casos internos; ao
      // cliente, uma frase só.
      const interno = r.error === "Session not found" || r.error === "Session is not open" || r.error === "Items are required";
      return recusa(interno ? "A conta da mesa acabou de ser fechada. Chame o garçom." : r.error, r.status);
    }

    return NextResponse.json({ ok: true, numero: r.order.dailyOrderNumber, mesa: mesa.number });
  } catch (err) {
    console.error("[Mesa QR] pedido:", err);
    return recusa("Não deu para enviar o pedido. Tente de novo ou chame o garçom.", 500);
  }
}
