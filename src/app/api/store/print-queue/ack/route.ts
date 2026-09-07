/**
 * POST /api/store/print-queue/ack — "esta comanda saiu".
 *
 * O Assistente de Impressão confirma, job a job, o que já imprimiu pela fila
 * da nuvem (ou já tinha impresso: a marca local de "já impresso" também
 * conta). O servidor carimba `printedAt`, e o GET da fila nunca mais devolve
 * aquele pedido — para este Assistente, para o reinstalado, para o PC novo.
 *
 * Antes disto a única barreira contra comanda em dobro era o cache local do
 * Assistente. Cache morre com o processo (versões antigas), com a reinstalação
 * e com a troca de PC, e cada morte reimprimia as últimas 2 horas no meio do
 * serviço ("abre um prompt, reinicia e imprime tudo de novo" — Brasa Burguer,
 * 06/09/2026).
 *
 * Sem autenticação, como o GET que alimenta o Assistente (só o id da loja,
 * que está no HTML do cardápio). Quem forjar um ack só consegue calar a
 * comanda automática de um pedido daquela loja — e o pedido continua no
 * painel e no navegador; nada de dado sai daqui.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX_IDS = 200;

export async function POST(req: NextRequest) {
  let body: any = null;
  try { body = await req.json(); } catch { body = null; }
  const franchiseeId = typeof body?.franchiseeId === "string" ? body.franchiseeId.trim() : "";
  const brutos: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
  // O Assistente manda o id do JOB ("job_<id do pedido>"); aceita os dois.
  const ids = [...new Set(
    brutos
      .map((v) => String(v ?? "").trim().replace(/^job_/, ""))
      .filter((v) => /^[A-Za-z0-9_-]{6,64}$/.test(v))
  )].slice(0, MAX_IDS);

  if (!franchiseeId || ids.length === 0) {
    return NextResponse.json({ ok: false, error: "franchiseeId e ids são obrigatórios" }, { status: 400 });
  }

  try {
    const agora = new Date();
    const [pedidos, avulsas] = await Promise.all([
      prisma.customerOrder.updateMany({
        where: { id: { in: ids }, franchiseeId, printedAt: null },
        data: { printedAt: agora },
      }),
      prisma.printRequest.updateMany({
        where: { id: { in: ids }, franchiseeId, printedAt: null },
        data: { printedAt: agora },
      }).catch(() => ({ count: 0 })),
    ]);
    return NextResponse.json({ ok: true, pedidos: pedidos.count, avulsas: avulsas.count });
  } catch (err: any) {
    // Coluna ainda ausente (falta db push): responde 200 com ok:false para o
    // Assistente não ficar reenviando o mesmo lote a cada 3 s. Sem o carimbo
    // a fila volta a se comportar como sempre — o cache local segura.
    console.error("[PrintQueue ack]", err?.code || err?.message);
    return NextResponse.json({ ok: false, error: "carimbo indisponível" });
  }
}
