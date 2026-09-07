/**
 * /api/ifood/homologacao/webhook-status
 *
 * Cenário 2 de Logistics: "webhook configurado, respondendo 200, disponível,
 * teste de conectividade".
 *
 * GET  → a URL configurada e as últimas chamadas que o webhook de produção
 *        recebeu (os KEEPALIVE do iFood chegam a cada ~30s e são a prova viva
 *        de disponibilidade — ver src/lib/ifood-webhook-registro.ts).
 * POST → teste de conectividade: o servidor chama a própria URL PÚBLICA (o
 *        caminho que o iFood percorre, não um atalho interno) e devolve o
 *        status e a latência. O corpo de teste não tem orderId, então o
 *        processador o ignora — e a chamada aparece na lista logo em seguida,
 *        o que o vídeo mostra como confirmação.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { chamadasRecentesWebhook } from "@/lib/ifood-webhook-registro";

function urlPublicaDoWebhook(): string {
  const base = process.env.NEXTAUTH_URL?.startsWith("http")
    ? process.env.NEXTAUTH_URL
    : "https://firehubfood.com.br";
  return `${base.replace(/\/$/, "")}/api/ifood/webhook`;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
  }
  return NextResponse.json({
    url: urlPublicaDoWebhook(),
    chamadas: chamadasRecentesWebhook(),
  });
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Faça login para continuar." }, { status: 401 });
  }

  const url = urlPublicaDoWebhook();
  const inicio = Date.now();
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ code: "TST", fullCode: "CONNECTIVITY_TEST" }]),
      cache: "no-store",
    });
    return NextResponse.json({ ok: r.ok, status: r.status, ms: Date.now() - inicio, url });
  } catch {
    return NextResponse.json({ ok: false, status: 0, ms: Date.now() - inicio, url, error: "O endpoint não respondeu." });
  }
}
