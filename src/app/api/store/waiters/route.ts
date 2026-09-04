import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { CAMPOS_DO_GARCOM, FORMATO_DO_LOGIN, normalizarLogin } from "@/lib/garcom-auth";

async function getFranchiseeId() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const dbUser = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true }
  });
  if (!dbUser) return null;
  return dbUser.ownerId || dbUser.id;
}

const TAMANHO_MINIMO_DA_SENHA = 6;

type Credenciais = { login?: string | null; passwordHash?: string | null; credentialsUpdatedAt?: Date };

/**
 * Valida login e senha vindos do formulário.
 *
 * Devolve `{ erro }` com a frase para o gerente, ou só os campos que precisam
 * mudar (campo ausente = não mexer). `atual` é o que está no banco — nulo no
 * cadastro novo. É ele que evita gravar senha sem login, carimbar
 * `credentialsUpdatedAt` num garçom que nunca teve acesso, ou aceitar login
 * novo sem senha (o gerente acharia que configurou e o garçom não entraria).
 */
async function credenciaisDoCorpo(
  data: any,
  atual: { login: string | null; passwordHash: string | null } | null
): Promise<{ erro: string } | Credenciais> {
  const temLogin = data.login !== undefined;
  const temSenha = typeof data.password === "string" && data.password.length > 0;
  const login = temLogin ? normalizarLogin(data.login) : undefined;
  // Como fica o login depois deste salvamento.
  const loginFinal = login === undefined ? atual?.login ?? null : login || null;

  if (login && !FORMATO_DO_LOGIN.test(login)) {
    return { erro: "Login: use de 3 a 30 caracteres, só letras minúsculas, números, ponto, traço ou sublinhado." };
  }
  if (temSenha && String(data.password).length < TAMANHO_MINIMO_DA_SENHA) {
    return { erro: `Senha: use pelo menos ${TAMANHO_MINIMO_DA_SENHA} caracteres.` };
  }
  if (temSenha && loginFinal && String(data.password).trim().toLowerCase() === loginFinal) {
    return { erro: "A senha não pode ser igual ao login." };
  }
  if (temSenha && !loginFinal) {
    return { erro: "Informe o login do garçom junto com a senha." };
  }
  if (loginFinal && !atual?.passwordHash && !temSenha) {
    return { erro: "Defina uma senha para o login do garçom." };
  }

  const out: Credenciais = {};
  if (login === "") {
    // Tirar o login tira o acesso inteiro — mas só há o que tirar se havia algo.
    if (atual?.login || atual?.passwordHash) {
      out.login = null;
      out.passwordHash = null;
      out.credentialsUpdatedAt = new Date();
    }
  } else if (login && login !== atual?.login) {
    out.login = login;
  }
  if (temSenha) {
    out.passwordHash = await bcrypt.hash(String(data.password), 12);
    // Sessão emitida antes deste instante é recusada (src/lib/garcom-auth.ts).
    out.credentialsUpdatedAt = new Date();
  }
  return out;
}

function ehLoginDuplicado(error: any): boolean {
  return error?.code === "P2002";
}

export async function GET(req: Request) {
  try {
    const franchiseeId = await getFranchiseeId();
    if (!franchiseeId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const waiters = await prisma.waiter.findMany({
      where: { franchiseeId },
      orderBy: { name: "asc" },
      select: CAMPOS_DO_GARCOM,
    });
    return NextResponse.json(waiters);
  } catch (error: any) {
    console.error("GET Waiters Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const franchiseeId = await getFranchiseeId();
    if (!franchiseeId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const data = await req.json();
    if (!data.name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const credenciais = await credenciaisDoCorpo(data, null);
    if ("erro" in credenciais) return NextResponse.json({ error: credenciais.erro }, { status: 400 });

    const waiter = await prisma.waiter.create({
      data: {
        franchiseeId,
        name: data.name,
        phone: data.phone || null,
        commissionRate: data.commissionRate !== undefined ? Number(data.commissionRate) : 10,
        active: data.active !== undefined ? data.active : true,
        login: credenciais.login ?? null,
        passwordHash: credenciais.passwordHash ?? null,
      },
      select: CAMPOS_DO_GARCOM,
    });
    return NextResponse.json(waiter);
  } catch (error: any) {
    if (ehLoginDuplicado(error)) {
      return NextResponse.json({ error: "Este login já está sendo usado por outro garçom desta loja." }, { status: 409 });
    }
    console.error("POST Waiter Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const franchiseeId = await getFranchiseeId();
    if (!franchiseeId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const data = await req.json();
    if (!data.id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    const atual = await prisma.waiter.findFirst({
      where: { id: data.id, franchiseeId },
      select: { id: true, login: true, passwordHash: true },
    });
    if (!atual) return NextResponse.json({ error: "Garçom não encontrado" }, { status: 404 });

    const credenciais = await credenciaisDoCorpo(data, atual);
    if ("erro" in credenciais) return NextResponse.json({ error: credenciais.erro }, { status: 400 });

    const waiter = await prisma.waiter.update({
      where: { id: data.id, franchiseeId },
      data: {
        name: data.name,
        phone: data.phone,
        commissionRate: data.commissionRate !== undefined ? Number(data.commissionRate) : undefined,
        active: data.active,
        ...credenciais,
      },
      select: CAMPOS_DO_GARCOM,
    });
    return NextResponse.json(waiter);
  } catch (error: any) {
    if (ehLoginDuplicado(error)) {
      return NextResponse.json({ error: "Este login já está sendo usado por outro garçom desta loja." }, { status: 409 });
    }
    console.error("PUT Waiter Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const franchiseeId = await getFranchiseeId();
    if (!franchiseeId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID is required" }, { status: 400 });

    await prisma.waiter.delete({
      where: { id, franchiseeId },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE Waiter Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
