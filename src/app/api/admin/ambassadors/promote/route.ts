import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

/**
 * Promove um lojista a embaixador — o único caminho de entrada no programa.
 *
 * O programa "Indique e Ganhe" foi encerrado para o cliente comum; ele segue de
 * pé só para gente influente, e por isso a promoção é ato manual do admin, sem
 * auto-cadastro.
 *
 * O ponto delicado é o que este endpoint NÃO faz: ele não encosta em
 * `User.ambassadorId` da loja promovida. Esse campo continua apontando para
 * quem indicou a loja, que é o que preserva a comissão de nível 1 já
 * contratada — o embaixador antigo não perde a loja por ela virar embaixadora.
 * O mesmo embaixador vira o `parentAmbassador` da conta nova e passa a receber
 * o nível 2 (3%) das lojas que a promovida trouxer.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const { userId, asaasWalletId, commissionPercent, code, pixKey, email } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: "Informe a loja a promover." }, { status: 400 });
    }

    // A carteira do Asaas é obrigatória aqui de propósito: sem ela o split não
    // acontece e o embaixador acha que está ganhando enquanto nada é repassado.
    if (!asaasWalletId || !String(asaasWalletId).trim()) {
      return NextResponse.json(
        { error: "Asaas Wallet ID é obrigatório — sem carteira o Asaas não repassa a comissão." },
        { status: 400 }
      );
    }

    const loja = await prisma.user.findUnique({
      where: { id: userId },
      include: { ambassadorAccount: true },
    });

    if (!loja) {
      return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });
    }
    if (loja.ambassadorAccount) {
      return NextResponse.json(
        { error: `${loja.storeName || loja.name} já é embaixador (código ${loja.ambassadorAccount.code}).` },
        { status: 400 }
      );
    }

    const emailFinal = String(email || loja.email).toLowerCase().trim();

    // O e-mail é a chave do portal do embaixador. O login de embaixador é
    // separado do login da loja (`loginType=ambassador` em lib/auth.ts), então
    // repetir o e-mail da loja aqui é seguro — o que não pode é colidir com
    // OUTRO embaixador.
    const emailEmUso = await prisma.ambassador.findFirst({
      where: { email: { equals: emailFinal, mode: "insensitive" } },
    });
    if (emailEmUso) {
      return NextResponse.json(
        { error: `Já existe um embaixador com o e-mail ${emailFinal}. Informe outro e-mail para esta conta.` },
        { status: 400 }
      );
    }

    const codeFinal = await gerarCodigo(code, loja.storeName || loja.name);

    // Senha temporária para o primeiro acesso ao portal. Volta em texto UMA vez,
    // na resposta desta chamada, para o admin repassar por WhatsApp — depois só
    // o hash fica gravado.
    const senhaTemporaria = gerarSenha();

    const embaixador = await prisma.ambassador.create({
      data: {
        name: loja.storeName || loja.name,
        email: emailFinal,
        phone: loja.storePhone || null,
        code: codeFinal,
        commissionPercent: commissionPercent ? parseFloat(String(commissionPercent)) : 20,
        asaasWalletId: String(asaasWalletId).trim(),
        pixKey: pixKey || null,
        password: await bcrypt.hash(senhaTemporaria, 12),
        active: true,
        parentAmbassadorId: loja.ambassadorId || null,
        linkedUserId: loja.id,
      },
      include: { parentAmbassador: { select: { id: true, name: true, level2Percent: true } } },
    });

    return NextResponse.json({
      ambassador: embaixador,
      senhaTemporaria,
      inviteLink: `https://firehubfood.com.br/cadastro?ref=${embaixador.code}`,
    });
  } catch (error: any) {
    console.error("[Ambassadors API] promote error:", error);
    return NextResponse.json({ error: "Erro ao promover a embaixador" }, { status: 500 });
  }
}

/** Código do link de convite, único na tabela. */
async function gerarCodigo(codeInformado: string | undefined, nome: string) {
  if (codeInformado) {
    const limpo = String(codeInformado).toLowerCase().trim();
    const existe = await prisma.ambassador.findUnique({ where: { code: limpo } });
    if (existe) throw new Error(`Código ${limpo} já está em uso.`);
    return limpo;
  }

  const base =
    nome
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 20) || "embaixador";

  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const candidato = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    const existe = await prisma.ambassador.findUnique({ where: { code: candidato } });
    if (!existe) return candidato;
  }
  throw new Error("Não foi possível gerar um código único.");
}

function gerarSenha() {
  // Sem I/l/O/0/1: essa senha é ditada no WhatsApp.
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let senha = "";
  for (let i = 0; i < 10; i++) {
    senha += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  }
  return senha;
}
