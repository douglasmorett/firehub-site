import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { custoMeta, lojaLiberada, precoPorDisparo } from "@/lib/disparo-oficial/regras";
import { ajustarCredito, garantirEstruturaDoDisparoOficial, saldoDaLoja } from "@/lib/disparo-oficial/servidor";
import { assinarWebhookDoApp, webhookDoApp } from "@/lib/disparo-oficial/meta";

export const dynamic = "force-dynamic";

/**
 * /api/admin/disparo-oficial — visão do FireHub sobre o Disparo oficial.
 *
 * GET: lojas conectadas, saldo, vendido e entregue no mês (o que a Meta vai
 * cobrar). POST { lojaId, disparos, motivo }: crédito à mão (teste na Hakim,
 * cortesia, acerto); negativo tira. POST { acao: "webhook" }: cadastra o
 * webhook do app na Meta pelo servidor (a chave secreta não sai daqui).
 */
async function exigirAdmin() {
  const session = await getServerSession(authOptions);
  if (!session || String((session.user as any)?.role || "").toUpperCase() !== "ADMIN") return null;
  return session;
}

export async function GET() {
  if (!(await exigirAdmin())) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  if (!(await garantirEstruturaDoDisparoOficial())) return NextResponse.json({ error: "Estrutura indisponível" }, { status: 503 });
  const db = prisma as any;
  const inicioDoMes = new Date();
  inicioDoMes.setDate(1);
  inicioDoMes.setHours(0, 0, 0, 0);

  const conexoes = await db.whatsappOficial.findMany({ orderBy: { conectadoEm: "desc" } });
  const lojas = await prisma.user.findMany({ where: { id: { in: conexoes.map((c: any) => c.franchiseeId) } }, select: { id: true, storeName: true, name: true } });
  const linhas = await Promise.all(
    conexoes.map(async (c: any) => {
      const [saldo, vendidoNoMes, entreguesNoMes] = await Promise.all([
        saldoDaLoja(c.franchiseeId),
        db.disparoRecarga.aggregate({ where: { franchiseeId: c.franchiseeId, status: "PAGA", tipo: "PIX", pagaEm: { gte: inicioDoMes } }, _sum: { valor: true, disparos: true } }),
        db.disparoEnvio.count({ where: { franchiseeId: c.franchiseeId, status: { in: ["ENTREGUE", "LIDO"] }, gratis: false, entregueEm: { gte: inicioDoMes } } }),
      ]);
      const loja = lojas.find((l) => l.id === c.franchiseeId);
      return {
        lojaId: c.franchiseeId,
        loja: loja?.storeName || loja?.name || c.franchiseeId,
        numero: c.numero,
        status: c.status,
        qualidade: c.qualidade,
        limite: c.limite,
        liberada: lojaLiberada(c.franchiseeId),
        saldo: saldo.saldo,
        vendidoNoMes: Number(vendidoNoMes?._sum?.valor || 0),
        entreguesNoMes,
        custoMetaNoMes: Math.round(entreguesNoMes * custoMeta() * 100) / 100,
      };
    })
  );
  return NextResponse.json({ preco: precoPorDisparo(), custoMeta: custoMeta(), lojas: linhas });
}

export async function POST(req: NextRequest) {
  const session = await exigirAdmin();
  if (!session) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });
  const body: any = await req.json().catch(() => ({}));
  if (body?.acao === "webhook") {
    try {
      const url = `${(process.env.NEXTAUTH_URL || "https://firehubfood.com.br").replace(/\/+$/, "")}/api/webhook/whatsapp-oficial`;
      const r = await assinarWebhookDoApp(url);
      return NextResponse.json({ ok: true, resposta: r, cadastrado: await webhookDoApp() });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "A Meta recusou" }, { status: 400 });
    }
  }
  if (body?.acao === "ver-webhook") {
    try {
      return NextResponse.json({ ok: true, cadastrado: await webhookDoApp() });
    } catch (e: any) {
      return NextResponse.json({ error: e?.message }, { status: 400 });
    }
  }
  const lojaId = String(body?.lojaId || "");
  const loja = lojaId ? await prisma.user.findUnique({ where: { id: lojaId }, select: { id: true } }) : null;
  if (!loja) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  try {
    const r = await ajustarCredito(lojaId, Number(body?.disparos), String(body?.motivo || ""), session.user?.email || "admin");
    return NextResponse.json({ ok: true, recargaId: r.id, saldo: (await saldoDaLoja(lojaId)).saldo });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Não deu certo" }, { status: 400 });
  }
}
