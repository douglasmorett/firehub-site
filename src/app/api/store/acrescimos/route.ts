/**
 * /api/store/acrescimos
 *
 * GET  — pedidos de acréscimo esperando a loja responder (o aviso da tela).
 * POST — a resposta: { id, decisao: "ACEITAR" | "RECUSAR", motivo? }.
 *
 * O cliente pede pelo robô do WhatsApp para acrescentar itens num pedido que
 * ainda está na cozinha; quem decide se dá tempo é a loja. A regra e os
 * efeitos (itens, total, comanda, WhatsApp) moram em lib/acrescimo-servidor.ts.
 *
 * A loja é a da SESSÃO (`ownerId || id`), e ela entra no WHERE de toda leitura
 * e escrita: o id de um acréscimo de outra loja não responde nada aqui.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listarAcrescimosPendentes, responderAcrescimo } from "@/lib/acrescimo-servidor";

export const dynamic = "force-dynamic";

async function lojaDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, email: true, name: true },
  });
  if (!u) return null;
  return { franchiseeId: u.ownerId || u.id, quem: u.name || u.email };
}

export async function GET() {
  const loja = await lojaDaSessao();
  if (!loja) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const pendentes = await listarAcrescimosPendentes(loja.franchiseeId);
    return NextResponse.json({ pendentes });
  } catch (err: any) {
    // Tabela ainda não criada (boot antigo) ou banco fora: o aviso é um extra,
    // não pode derrubar a tela — volta vazio e o log diz o que houve.
    console.error("[Acréscimo] GET falhou:", err?.message || err);
    return NextResponse.json({ pendentes: [] });
  }
}

export async function POST(req: NextRequest) {
  const loja = await lojaDaSessao();
  if (!loja) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const corpo = await req.json().catch(() => ({} as any));
  const id = String(corpo?.id || "").trim();
  const decisao = String(corpo?.decisao || "").toUpperCase();
  if (!id || (decisao !== "ACEITAR" && decisao !== "RECUSAR")) {
    return NextResponse.json({ error: "Informe o acréscimo e a decisão (ACEITAR ou RECUSAR)." }, { status: 400 });
  }

  const r = await responderAcrescimo({
    franchiseeId: loja.franchiseeId,
    acrescimoId: id,
    decisao: decisao as "ACEITAR" | "RECUSAR",
    motivo: typeof corpo?.motivo === "string" ? corpo.motivo : null,
    respondidoPor: loja.quem,
  });

  if (r.ok) return NextResponse.json(r);
  const status = r.codigo === "NAO_ENCONTRADO" ? 404 : r.codigo === "FALHOU" ? 500 : 409;
  return NextResponse.json(r, { status });
}
