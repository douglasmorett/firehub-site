import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Inscrições de quem quer ser embaixador — leitura e triagem, só para o admin.
 *
 * GET   → lista as inscrições (mais novas primeiro)
 * PATCH → muda o status de uma { id, status, notes? }
 *
 * Aprovar aqui NÃO cria embaixador. O cadastro de verdade continua manual, na
 * aba Embaixadores, porque é lá que se define código, comissão e carteira do
 * Asaas — coisas que decidem para onde vai dinheiro e que um formulário aberto
 * na internet não pode encostar. `APROVADO` aqui significa "essa pessoa serve,
 * pode cadastrar", e é por isso que o status vira um lembrete, não um gatilho.
 */

const STATUS_VALIDOS = ["NOVO", "EM_ANALISE", "APROVADO", "RECUSADO"] as const;

async function exigirAdmin() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  }
  if ((session.user as any)?.role !== "ADMIN") {
    return { erro: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { ok: true as const };
}

export async function GET() {
  const auth = await exigirAdmin();
  if ("erro" in auth) return auth.erro;

  try {
    const inscricoes = await prisma.$queryRaw<any[]>`
      SELECT "id","fullName","instagram","followers","whatsapp","email","message",
             "status","notes","createdAt","updatedAt"
      FROM "AmbassadorApplication"
      ORDER BY "createdAt" DESC
      LIMIT 500
    `;
    return NextResponse.json({ ok: true, inscricoes });
  } catch (err: any) {
    // Lista vazia com aviso, em vez de 500 seco: antes de alguém rodar a criação
    // da tabela este é o estado NORMAL, e a tela precisa saber dizer isso.
    console.warn("[Inscrições] Falha ao ler:", err?.message);
    return NextResponse.json({
      ok: false,
      inscricoes: [],
      aviso:
        "A tabela de inscrições ainda não existe. Abra /api/admin/tabela-inscricoes-embaixador?criar=sim uma vez.",
    });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await exigirAdmin();
  if ("erro" in auth) return auth.erro;

  const body = await req.json().catch(() => ({} as any));
  const id = String(body.id ?? "").trim();
  const status = String(body.status ?? "").trim().toUpperCase();
  const notes = body.notes === undefined ? null : String(body.notes ?? "").slice(0, 2000);

  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  if (!STATUS_VALIDOS.includes(status as any)) {
    return NextResponse.json(
      { error: `status inválido. Use um de: ${STATUS_VALIDOS.join(", ")}` },
      { status: 400 }
    );
  }

  const afetados = await prisma.$executeRaw`
    UPDATE "AmbassadorApplication"
    SET "status" = ${status},
        "notes" = COALESCE(${notes}, "notes"),
        "updatedAt" = NOW()
    WHERE "id" = ${id}
  `;
  if (!afetados) return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });

  return NextResponse.json({ ok: true, id, status });
}

/**
 * DELETE /api/admin/inscricoes-embaixador?id=…
 *
 * Formulário público recebe spam — é questão de tempo. Sem apagar, a única
 * saída seria marcar tudo como RECUSADO, e a aba viraria um depósito que ninguém
 * consegue limpar. Apagar aqui não desfaz nada: se a pessoa já virou embaixador,
 * o cadastro dela vive na tabela Ambassador, que é outra e não é tocada.
 */
export async function DELETE(req: NextRequest) {
  const auth = await exigirAdmin();
  if ("erro" in auth) return auth.erro;

  const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const afetados = await prisma.$executeRaw`
    DELETE FROM "AmbassadorApplication" WHERE "id" = ${id}
  `;
  if (!afetados) return NextResponse.json({ error: "Inscrição não encontrada" }, { status: 404 });

  return NextResponse.json({ ok: true, apagada: id });
}
