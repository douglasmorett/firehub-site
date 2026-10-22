/**
 * POST /api/app-firehub/sessao
 *
 * O painel aberto DENTRO do app FireHub (apps/firehub) pede aqui, com o cookie
 * do login de sempre, o token do app — que o app guarda no celular e usa para
 * o que roda sem a página aberta: o aviso de pedido novo e a impressora
 * Bluetooth (lib/app-firehub/sessao.ts).
 *
 * O login continua sendo o do site (tela, trava de tentativas, 2º fator): o
 * app nunca vê a senha. Sessão de admin "acessando" a loja não ganha token —
 * senão o celular do suporte passaria a receber os pedidos da loja.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { criarSessaoDoApp } from "@/lib/app-firehub/sessao";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getServerSession(authOptions);
  const quem = session?.user as { id?: string; role?: string; impersonatedBy?: string | null } | undefined;
  if (!quem?.id) return NextResponse.json({ error: "Entre no painel primeiro." }, { status: 401 });
  if (quem.impersonatedBy) return NextResponse.json({ error: "Acesso de suporte não liga o app." }, { status: 403 });

  const u = await prisma.user.findUnique({
    where: { id: quem.id },
    select: { id: true, role: true, password: true, ownerId: true, name: true, storeName: true, slug: true },
  });
  if (!u || (u.role !== "FRANCHISEE" && u.role !== "STAFF")) {
    return NextResponse.json({ error: "Só a conta da loja usa o app." }, { status: 403 });
  }
  const lojaId = u.ownerId || u.id;
  const loja = u.ownerId
    ? await prisma.user.findUnique({ where: { id: lojaId }, select: { storeName: true, name: true, slug: true } })
    : u;

  return NextResponse.json({
    token: criarSessaoDoApp(u.id, u.password),
    lojaId,
    nomeDaLoja: loja?.storeName || loja?.name || "Minha loja",
    slug: loja?.slug || null,
  });
}
