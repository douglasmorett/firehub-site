import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { garantirColunasWabiz } from "@/lib/garantir-colunas";
import { autenticarWabiz } from "@/lib/wabiz-api";

export const dynamic = "force-dynamic";

/**
 * /api/store/integracoes/wabiz — conexão da loja com a Wabiz (app com a marca
 * do restaurante). Mesmas regras da rota da Brendi:
 *
 *   1. A senha NUNCA volta ao navegador (GET devolve só `hasPassword`).
 *   2. Campo vazio no POST mantém o valor salvo.
 *   3. `wabizConnected=true` só depois de o login REAL na Wabiz dar certo.
 *
 * Usuário e senha são os "da API" que o suporte da Wabiz entrega para a loja
 * (não são os do painel de pedidos deles, embora o usuário costume ser o mesmo).
 */

interface LinhaWabiz {
  wabizUsername: string | null;
  wabizPassword: string | null;
  wabizConnected: boolean | null;
}

async function linhaWabiz(userId: string): Promise<LinhaWabiz | null> {
  try {
    const r = await prisma.$queryRaw<LinhaWabiz[]>`
      SELECT "wabizUsername", "wabizPassword", "wabizConnected" FROM "User" WHERE "id" = ${userId} LIMIT 1
    `;
    return Array.isArray(r) && r[0] ? r[0] : null;
  } catch {
    return null;
  }
}

async function resolverDono(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true } });
  return user ? user.ownerId || user.id : null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  await garantirColunasWabiz();
  const donoId = await resolverDono(session.user.email);
  if (!donoId) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const linha = await linhaWabiz(donoId);
  return NextResponse.json({
    ok: true,
    username: linha?.wabizUsername || "",
    hasPassword: !!linha?.wabizPassword,
    connected: !!linha?.wabizConnected,
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    await garantirColunasWabiz();
    const donoId = await resolverDono(session.user.email);
    if (!donoId) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password.trim() : "";

    const atual = await linhaWabiz(donoId);
    const novoUsuario = username || atual?.wabizUsername || null;
    const novaSenha = password || atual?.wabizPassword || null;

    if (!novoUsuario || !novaSenha) {
      return NextResponse.json(
        { error: "Informe o usuário e a senha da API da Wabiz — o suporte da Wabiz fornece os dois para a loja." },
        { status: 400 }
      );
    }

    // O mesmo usuário em duas contas puxaria os pedidos da loja para as duas cozinhas.
    const conflito = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User"
      WHERE LOWER("wabizUsername") = LOWER(${novoUsuario}) AND "id" <> ${donoId} AND "wabizConnected" = true
      LIMIT 1
    `;
    if (Array.isArray(conflito) && conflito.length > 0) {
      return NextResponse.json(
        { error: "Este usuário da Wabiz já está conectado a OUTRA conta do FireHub. Fale com o suporte." },
        { status: 409 }
      );
    }

    await prisma.$executeRaw`
      UPDATE "User"
      SET "wabizUsername" = ${novoUsuario}, "wabizPassword" = ${novaSenha}, "wabizConnected" = false
      WHERE "id" = ${donoId}
    `;

    const auth = await autenticarWabiz(donoId);
    if (auth.ok) {
      await prisma.$executeRaw`UPDATE "User" SET "wabizConnected" = true WHERE "id" = ${donoId}`;
    }

    return NextResponse.json({
      ok: true,
      autenticou: auth.ok,
      connected: auth.ok,
      message: auth.ok
        ? "Wabiz conectada — a Wabiz aceitou o login. Os pedidos do app entram no FireHub em até 30 segundos."
        : `Dados salvos, mas a integração ficou DESLIGADA: ${auth.erro}. Confira o usuário e a senha da API com o suporte da Wabiz.`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  await garantirColunasWabiz();
  const donoId = await resolverDono(session.user.email);
  if (!donoId) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  await prisma.$executeRaw`UPDATE "User" SET "wabizConnected" = false WHERE "id" = ${donoId}`;
  return NextResponse.json({
    ok: true,
    connected: false,
    message: "Wabiz desconectada. Os pedidos do app deixam de entrar no FireHub; os dados de acesso continuam salvos.",
  });
}
