/**
 * /api/admin/prazos — contas da extensão FireHub Prazos, para o admin.
 *
 * GET lista (sem hash de senha, com o último sinal da extensão para suporte).
 * POST cria (e-mail, senha, loja, WhatsApp, status, motoboys).
 * PATCH muda status, senha, motoboys, loja, WhatsApp, observações.
 *
 * Só ADMIN: é aqui que se dá e se tira acesso ao produto.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { STATUS_DE_CONTA } from "@/lib/prazos";

export const dynamic = "force-dynamic";

async function admin() {
  const session = await getServerSession(authOptions);
  const role = (session?.user as any)?.role;
  if (!session?.user || role !== "ADMIN") return null;
  return session.user as any;
}

const SELECAO = {
  id: true, email: true, nomeLoja: true, whatsapp: true, status: true, motoboys: true,
  config: true, ultimoEstado: true, caktoRef: true, observacoes: true, criadoPor: true,
  createdAt: true, updatedAt: true,
};

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  const contas = await prisma.prazoConta.findMany({ orderBy: { createdAt: "desc" }, select: SELECAO });
  return NextResponse.json({ contas });
}

export async function POST(req: NextRequest) {
  const quem = await admin();
  if (!quem) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  const email = String(body?.email || "").toLowerCase().trim();
  const senha = String(body?.senha || "");
  const nomeLoja = String(body?.nomeLoja || "").trim().slice(0, 80);
  const whatsapp = String(body?.whatsapp || "").replace(/\D/g, "").slice(0, 20) || null;
  const status = STATUS_DE_CONTA.includes(body?.status) ? body.status : "PILOTO";
  const motoboys = Number.isInteger(Number(body?.motoboys)) && Number(body.motoboys) >= 1 ? Number(body.motoboys) : 2;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
  if (senha.length < 6) return NextResponse.json({ error: "Senha com pelo menos 6 caracteres" }, { status: 400 });
  if (!nomeLoja) return NextResponse.json({ error: "Nome da loja é obrigatório" }, { status: 400 });

  const jaExiste = await prisma.prazoConta.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (jaExiste) return NextResponse.json({ error: "Já existe conta com este e-mail" }, { status: 409 });

  const conta = await prisma.prazoConta.create({
    data: {
      email, nomeLoja, whatsapp, status, motoboys,
      senhaHash: await bcrypt.hash(senha, 10),
      observacoes: String(body?.observacoes || "").slice(0, 500) || null,
      criadoPor: quem.email || quem.id || "admin",
    },
    select: SELECAO,
  });
  return NextResponse.json({ ok: true, conta });
}

export async function PATCH(req: NextRequest) {
  if (!(await admin())) return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  if (!id) return NextResponse.json({ error: "id é obrigatório" }, { status: 400 });

  const dados: any = {};
  if (body?.status !== undefined) {
    if (!STATUS_DE_CONTA.includes(body.status)) return NextResponse.json({ error: "status inválido" }, { status: 400 });
    dados.status = body.status;
  }
  if (body?.senha !== undefined) {
    if (String(body.senha).length < 6) return NextResponse.json({ error: "Senha com pelo menos 6 caracteres" }, { status: 400 });
    dados.senhaHash = await bcrypt.hash(String(body.senha), 10);
  }
  if (body?.motoboys !== undefined) {
    const m = Number(body.motoboys);
    if (!Number.isInteger(m) || m < 1 || m > 50) return NextResponse.json({ error: "motoboys entre 1 e 50" }, { status: 400 });
    dados.motoboys = m;
  }
  if (body?.nomeLoja !== undefined) dados.nomeLoja = String(body.nomeLoja).trim().slice(0, 80) || undefined;
  if (body?.whatsapp !== undefined) dados.whatsapp = String(body.whatsapp).replace(/\D/g, "").slice(0, 20) || null;
  if (body?.observacoes !== undefined) dados.observacoes = String(body.observacoes).slice(0, 500) || null;

  if (Object.keys(dados).length === 0) return NextResponse.json({ error: "Nada para alterar" }, { status: 400 });

  const conta = await prisma.prazoConta.update({ where: { id }, data: dados, select: SELECAO });
  return NextResponse.json({ ok: true, conta });
}
