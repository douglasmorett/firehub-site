import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-store-token",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "E-mail e senha são obrigatórios" }, { status: 400, headers: corsHeaders });
    }

    const cleanEmail = String(email).toLowerCase().trim();

    // ── FREIO DE FORÇA BRUTA ────────────────────────────────────────────────
    // Esta rota é aberta (CORS *) e não tinha limite nenhum: dava para testar
    // senha à vontade contra a conta de um lojista, sem passar pelo /login.
    const { verificarFreioDeLogin, registrarFalhaDeLogin, limparFreioDeLogin, origemDaRequisicao } =
      await import("@/lib/login-throttle");
    const origem = origemDaRequisicao(req.headers as any);
    const freio = verificarFreioDeLogin(cleanEmail, origem);
    if (freio.bloqueado) {
      return NextResponse.json(
        { error: `Muitas tentativas. Tente novamente em ${Math.ceil(freio.esperarSegundos / 60)} minuto(s).` },
        { status: 429, headers: corsHeaders }
      );
    }

    // ── E-MAIL EXATO ────────────────────────────────────────────────────────
    //
    // Havia um `startsWith(cleanEmail.split("@")[0])` aqui: mandando
    // "contato@qualquercoisa.com" o banco devolvia a PRIMEIRA conta cujo
    // e-mail começa com "contato" — a do dono, por exemplo. A senha ainda era
    // conferida, mas o alvo do teste passava a ser uma conta que o atacante
    // nem digitou, e sem freio dava para varrer prefixos curtos contra contas
    // de alto valor. E-mail é chave exata, não prefixo.
    const user = await prisma.user.findFirst({
      where: { email: { equals: cleanEmail, mode: "insensitive" } },
    });

    if (!user) {
      // Mesma resposta de senha errada: dizer "e-mail não cadastrado" entrega
      // quais e-mails existem na plataforma.
      registrarFalhaDeLogin(cleanEmail, origem);
      return NextResponse.json({ error: "E-mail ou senha inválidos" }, { status: 401, headers: corsHeaders });
    }

    let isValid = false;
    if (user.password) {
      isValid = await bcrypt.compare(password, user.password).catch(() => false);
    }

    // SEGURANÇA: Senha validada EXCLUSIVAMENTE via bcrypt — sem bypass

    if (!isValid) {
      registrarFalhaDeLogin(cleanEmail, origem);
      return NextResponse.json({ error: "E-mail ou senha inválidos" }, { status: 401, headers: corsHeaders });
    }

    limparFreioDeLogin(cleanEmail);

    const { criarTokenDeExtensao } = await import("@/lib/extensao-token");

    return NextResponse.json({
      success: true,
      // Token ASSINADO. Era o `user.id` cru — e o id da loja é público no
      // cardápio, então qualquer um o usava como credencial da extensão.
      token: criarTokenDeExtensao(user.id),
      storeName: user.storeName || user.name || "Hakim Centro",
      email: user.email,
    }, { headers: corsHeaders });
  } catch (err: any) {
    console.error("[Extension Login API Error]", err);
    return NextResponse.json({ error: "Erro ao autenticar no servidor" }, { status: 500, headers: corsHeaders });
  }
}
