/**
 * POST /api/webhooks/stone-connect
 *
 * Eventos da Stone pela nuvem (Connect 2.0 — webhooks da Pagar.me). O lojista
 * (ou a Stone, na ativação) cadastra esta URL no Dashboard Pagar.me em
 * Configurações > Webhooks, marcando charge.paid, charge.refunded,
 * charge.payment_failed, order.paid, order.canceled e order.closed.
 *
 * Formato (docs "Retorno Webhook"):
 *   { id: "hook_...", type: "charge.paid", account: { id }, data: { id: "ch_...",
 *     order: { id: "or_...", code }, metadata: { terminal_serial_number, ... } } }
 * Em evento order.*, `data` é o próprio pedido (data.id = "or_...").
 *
 * A REGRA deste arquivo: o corpo NUNCA prova pagamento. A documentação do
 * Connect não traz assinatura de webhook, então qualquer um que descubra a URL
 * consegue mandar um "charge.paid". O corpo serve só para dizer QUAL pedido
 * olhar; a decisão sai da consulta GET /orders/{id} feita com a chave da loja
 * dona daquele pedido (lib/cobranca-stone-do-totem.ts › processarPedidoStone).
 * Um corpo forjado, no máximo, faz o servidor conferir um pedido de verdade.
 *
 * Camada extra opcional: com STONE_CONNECT_WEBHOOK_TOKEN no servidor, a URL
 * cadastrada leva ?token=<valor> (ou Basic Auth com o valor como usuário ou
 * senha) e o resto é recusado com 401 antes de qualquer consulta.
 */
import { NextRequest, NextResponse } from "next/server";
import { mesmoSegredo } from "@/lib/cofre";
import { processarPedidoStone } from "@/lib/cobranca-stone-do-totem";
import { pedidoDoEventoStone } from "@/lib/stone-connect";

export const dynamic = "force-dynamic";

function tokenConfere(req: NextRequest): boolean {
  const esperado = (process.env.STONE_CONNECT_WEBHOOK_TOKEN || "").trim();
  if (!esperado) return true;
  if (mesmoSegredo(req.nextUrl.searchParams.get("token") || "", esperado)) return true;
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("basic ")) {
    try {
      const [usuario, ...resto] = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8").split(":");
      return mesmoSegredo(usuario, esperado) || mesmoSegredo(resto.join(":"), esperado);
    } catch {
      return false;
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    if (!tokenConfere(req)) {
      console.warn("[Stone Webhook] Token do webhook não confere — recusado.");
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const corpo = await req.json().catch(() => null);
    const { pedidoId, referencia, tipo } = pedidoDoEventoStone(corpo);
    if (!pedidoId) {
      return NextResponse.json({ received: true, ignorado: "evento sem pedido" });
    }

    const r = await processarPedidoStone(pedidoId, referencia);
    if (r.status >= 400) console.warn(`[Stone Webhook] ${tipo} ${pedidoId} -> ${r.status}`, r.corpo);
    return NextResponse.json(r.corpo, { status: r.status });
  } catch (err) {
    console.error("[Stone Webhook] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/** A Pagar.me/Stone pode testar a URL com GET ao cadastrar. */
export async function GET() {
  return NextResponse.json({ ok: true, servico: "stone-connect" });
}
