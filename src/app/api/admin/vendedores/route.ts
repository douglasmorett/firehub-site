import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import bcrypt from "bcryptjs";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { atividadeDasLojas } from "@/lib/atividade-da-loja";
import { relatorioDoParceiro } from "@/lib/parceiro/relatorio";
import { gerarCodigoUnico, gerarSenhaTemporaria, percentualDoVendedor } from "@/lib/vendedores";

async function ehAdmin() {
  const session = await getServerSession(authOptions);
  return !!session && (session.user as any).role === "ADMIN";
}

/**
 * GET: a equipe de vendas com o placar de cada um — quantas lojas na
 * carteira, quantas já atendeu, quantas esperam contato, quantas pararam de
 * vender e a comissão prevista do mês. Vem junto a lista de embaixadores que
 * ainda não vendem, para o admin poder pôr qualquer um deles na equipe.
 */
export async function GET() {
  if (!(await ehAdmin())) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const vendedores = await prisma.ambassador.findMany({
    where: { isVendedor: true },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, email: true, phone: true, code: true, active: true,
      asaasWalletId: true, sellerPercent: true, commissionPercent: true,
      _count: { select: { referredStores: true } },
      carteira: { select: { id: true, vendedorStatus: true } },
    },
  });

  const atividade = await atividadeDasLojas(vendedores.flatMap((v) => v.carteira.map((l) => l.id)));

  const equipe = await Promise.all(
    vendedores.map(async (v) => {
      // A MESMA conta do portal dele (lib/parceiro/relatorio.ts): loja que ele
      // indicou conta como indicação, não soma os 3% de vendedor.
      const rel = await relatorioDoParceiro(v.id);
      return {
        id: v.id,
        name: v.name,
        email: v.email,
        phone: v.phone,
        code: v.code,
        active: v.active,
        asaasWalletId: v.asaasWalletId,
        sellerPercent: v.sellerPercent,
        // Também é embaixador quando indicou loja ou tem comissão de indicação própria.
        tambemEmbaixador: v.commissionPercent > 0 || v._count.referredStores > 0,
        clientes: v.carteira.length,
        atendidos: v.carteira.filter((l) => l.vendedorStatus === "ATENDIDO").length,
        aguardando: v.carteira.filter((l) => l.vendedorStatus !== "ATENDIDO").length,
        inativos: v.carteira.filter((l) => atividade.get(l.id)?.situacao !== "ATIVA").length,
        comissaoMes: rel?.resumo.mesAtual.porPapel.VENDEDOR.comissao ?? 0,
        comissaoTotal: rel?.resumo.mesAtual.comissao ?? 0,
      };
    })
  );

  const embaixadores = await prisma.ambassador.findMany({
    where: { isVendedor: false, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, asaasWalletId: true },
  });

  return NextResponse.json({ equipe, embaixadores });
}

/**
 * POST: põe alguém na equipe de vendas.
 *   { ambassadorId }                        → embaixador que passa a vender também
 *   { name, email, phone, asaasWalletId, sellerPercent } → vendedor novo
 *
 * O vendedor novo ganha senha temporária, devolvida em texto só nesta resposta
 * para o admin repassar. O embaixador continua com a senha que já tem.
 */
export async function POST(req: NextRequest) {
  if (!(await ehAdmin())) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const percentual = percentualDoVendedor(body.sellerPercent) ?? 3;

  if (body.ambassadorId) {
    const emb = await prisma.ambassador.findUnique({ where: { id: String(body.ambassadorId) }, select: { id: true, password: true } });
    if (!emb) return NextResponse.json({ error: "Embaixador não encontrado." }, { status: 404 });
    const senhaTemporaria = emb.password ? null : gerarSenhaTemporaria();
    const vendedor = await prisma.ambassador.update({
      where: { id: emb.id },
      data: {
        isVendedor: true,
        sellerPercent: percentual,
        active: true,
        ...(senhaTemporaria ? { password: await bcrypt.hash(senhaTemporaria, 12) } : {}),
      },
      select: { id: true, name: true, email: true },
    });
    return NextResponse.json({ vendedor, senhaTemporaria });
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").toLowerCase().trim();
  const phone = String(body.phone || "").replace(/\D/g, "");
  if (!name || !email || !phone) {
    return NextResponse.json({ error: "Nome, e-mail e telefone completo são obrigatórios." }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  if (phone.length < 10) return NextResponse.json({ error: "Telefone incompleto: informe DDD e número." }, { status: 400 });

  const existe = await prisma.ambassador.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, isVendedor: true },
  });
  if (existe) {
    return NextResponse.json(
      {
        error: existe.isVendedor
          ? "Já existe um vendedor com este e-mail."
          : "Este e-mail já é de um embaixador. Use \"Pôr embaixador na equipe\" para ele vender também.",
      },
      { status: 400 }
    );
  }

  const senhaTemporaria = gerarSenhaTemporaria();
  const vendedor = await prisma.ambassador.create({
    data: {
      name,
      email,
      phone,
      code: await gerarCodigoUnico(name),
      asaasWalletId: String(body.asaasWalletId || "").trim() || null,
      isVendedor: true,
      sellerPercent: percentual,
      // Só vendedor: não ganha comissão de indicação até o admin decidir.
      commissionPercent: 0,
      level2Percent: 0,
      password: await bcrypt.hash(senhaTemporaria, 12),
      active: true,
    },
    select: { id: true, name: true, email: true },
  });
  return NextResponse.json({ vendedor, senhaTemporaria });
}
