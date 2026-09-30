import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gerarSenhaTemporaria, percentualDoVendedor } from "@/lib/vendedores";
import { soltarContatosDoVendedor } from "@/lib/crm/contatos";

/**
 * PATCH: edita o vendedor. Lista fechada do que muda — `password` só por
 * `novaSenha: true`, que gera uma temporária e a devolve UMA vez.
 *
 * `sairDaEquipe: true` tira o vendedor da equipe e devolve as lojas dele para
 * "sem vendedor" (senão elas seguiriam pagando 3% a quem não acompanha mais).
 * A conta de embaixador, se houver, continua.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const atual = await prisma.ambassador.findUnique({ where: { id }, select: { id: true, isVendedor: true } });
  if (!atual?.isVendedor) return NextResponse.json({ error: "Vendedor não encontrado." }, { status: 404 });

  if (body.sairDaEquipe) {
    const [, soltas] = await prisma.$transaction([
      prisma.ambassador.update({ where: { id }, data: { isVendedor: false } }),
      prisma.user.updateMany({
        where: { vendedorId: id },
        data: { vendedorId: null, vendedorStatus: null, vendedorAtribuidoEm: null, vendedorAtendidoEm: null },
      }),
    ]);
    // Os contatos do CRM dele voltam para "sem vendedor" junto com as lojas —
    // senão continuariam na conversa de quem já não está na equipe.
    await soltarContatosDoVendedor(id);
    return NextResponse.json({ ok: true, lojasSoltas: soltas.count });
  }

  const data: any = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: "Nome não pode ficar vazio." }, { status: 400 });
    data.name = name;
  }
  if (body.email !== undefined) {
    const email = String(body.email).toLowerCase().trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
    const outro = await prisma.ambassador.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, NOT: { id } },
      select: { id: true },
    });
    if (outro) return NextResponse.json({ error: "Outro vendedor ou embaixador já usa este e-mail." }, { status: 400 });
    data.email = email;
  }
  if (body.phone !== undefined) {
    const phone = String(body.phone).replace(/\D/g, "");
    if (phone.length < 10) return NextResponse.json({ error: "Telefone incompleto: informe DDD e número." }, { status: 400 });
    data.phone = phone;
  }
  if (body.asaasWalletId !== undefined) data.asaasWalletId = String(body.asaasWalletId || "").trim() || null;
  if (body.active !== undefined) data.active = !!body.active;
  if (body.sellerPercent !== undefined) {
    const p = percentualDoVendedor(body.sellerPercent);
    if (p === null) return NextResponse.json({ error: "Comissão inválida: use um número entre 0 e 20." }, { status: 400 });
    data.sellerPercent = p;
  }

  let senhaTemporaria: string | null = null;
  if (body.novaSenha) {
    senhaTemporaria = gerarSenhaTemporaria();
    data.password = await bcrypt.hash(senhaTemporaria, 12);
  }

  const vendedor = await prisma.ambassador.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, phone: true, asaasWalletId: true, sellerPercent: true, active: true },
  });
  return NextResponse.json({ vendedor, senhaTemporaria });
}
