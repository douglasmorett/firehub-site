/**
 * POST /api/garcom/login
 *
 * Entrada do garçom pelo link da loja. Corpo: { slug, login, senha }.
 *
 * O freio de força bruta é o mesmo do painel (src/lib/login-throttle.ts),
 * contando por "loja + login": é o que o atacante precisa manter fixo para
 * invadir um acesso específico. Usuário inexistente e senha errada respondem
 * a mesma coisa, para não entregar quais logins existem.
 */
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  COOKIE_DO_GARCOM,
  emitirTokenDoGarcom,
  normalizarLogin,
  opcoesDoCookieDoGarcom,
} from "@/lib/garcom-auth";
import {
  verificarFreioDeLogin,
  registrarFalhaDeLogin,
  limparFreioDeLogin,
  origemDaRequisicao,
} from "@/lib/login-throttle";

const RECUSA = "Usuário ou senha incorretos.";

// Comparado quando o login não existe, para o tempo de resposta ser o mesmo
// de "senha errada". Sem isto a mensagem era única mas a demora do bcrypt
// (~250 ms) entregava quais logins existem na loja.
const HASH_FALSO = bcrypt.hashSync("senha-que-nunca-bate", 12);

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
  }

  const slug = String(body?.slug ?? "").trim();
  const login = normalizarLogin(body?.login);
  const senha = String(body?.senha ?? "");

  if (!slug || !login || !senha) {
    return NextResponse.json({ error: "Informe usuário e senha." }, { status: 400 });
  }

  const chaveDoFreio = `garcom:${slug}:${login}`;
  const origem = origemDaRequisicao(req.headers);
  const freio = verificarFreioDeLogin(chaveDoFreio, origem);
  if (freio.bloqueado) {
    const minutos = Math.ceil(freio.esperarSegundos / 60);
    return NextResponse.json(
      {
        error:
          minutos > 1
            ? `Muitas tentativas. Tente novamente em ${minutos} minutos.`
            : "Muitas tentativas. Tente novamente em 1 minuto.",
      },
      { status: 429 }
    );
  }

  const loja = await prisma.user.findUnique({ where: { slug }, select: { id: true } });
  if (!loja) {
    // Loja errada no link não é tentativa de senha; não conta no freio.
    return NextResponse.json({ error: "Esta loja não foi encontrada. Confira o link com o gerente." }, { status: 404 });
  }

  const garcom = await prisma.waiter.findUnique({
    where: { franchiseeId_login: { franchiseeId: loja.id, login } },
    select: { id: true, name: true, active: true, passwordHash: true, franchiseeId: true },
  });

  const confere = await bcrypt.compare(senha, garcom?.passwordHash || HASH_FALSO);
  if (!garcom || !garcom.passwordHash || !confere) {
    registrarFalhaDeLogin(chaveDoFreio, origem);
    return NextResponse.json({ error: RECUSA }, { status: 401 });
  }

  if (!garcom.active) {
    // Senha certa, acesso desligado: aqui pode dizer o motivo — quem sabe a
    // senha é o próprio garçom, e o que ele precisa é falar com o gerente.
    return NextResponse.json({ error: "Seu acesso está desativado. Fale com o gerente." }, { status: 403 });
  }

  limparFreioDeLogin(chaveDoFreio);

  const token = await emitirTokenDoGarcom({ id: garcom.id, franchiseeId: garcom.franchiseeId });
  prisma.waiter
    .update({ where: { id: garcom.id }, data: { lastLoginAt: new Date() } })
    .catch((err) => console.error("[garcom/login] lastLoginAt:", err));

  const res = NextResponse.json({
    ok: true,
    garcom: { id: garcom.id, name: garcom.name },
    destino: `/garcom/${encodeURIComponent(slug)}/mesas`,
  });
  res.cookies.set(COOKIE_DO_GARCOM, token, opcoesDoCookieDoGarcom());
  return res;
}
