import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { CODIGO_DO_CURSO, COMISSAO_DO_CURSO, conferirCarteiraNoAsaas } from "@/lib/embaixador-do-curso";

export const dynamic = "force-dynamic";

/**
 * POST /api/embaixador/curso — o aluno do curso vira embaixador sozinho.
 * Só com o código do curso e com a carteira do Asaas aprovada pelo próprio
 * Asaas (lib/embaixador-do-curso.ts). Carteira errada = não cadastra.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({} as any));
  if (b.codigoDoCurso !== CODIGO_DO_CURSO) {
    return NextResponse.json({ error: "Link inválido. Use o link que está dentro do curso." }, { status: 403 });
  }

  const nome = String(b.nome ?? "").trim().slice(0, 120);
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 160);
  const whatsapp = String(b.whatsapp ?? "").replace(/\D/g, "").slice(0, 15);
  const senha = String(b.senha ?? "");
  const walletId = String(b.walletId ?? "").trim().toLowerCase();

  if (nome.length < 3) return NextResponse.json({ error: "Escreva seu nome completo." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "E-mail inválido." }, { status: 400 });
  if (whatsapp.length < 10) return NextResponse.json({ error: "WhatsApp com DDD, por favor." }, { status: 400 });
  if (senha.length < 6) return NextResponse.json({ error: "A senha precisa ter pelo menos 6 caracteres." }, { status: 400 });
  if (b.aceite !== true) return NextResponse.json({ error: "Aceite as regras da comissão para continuar." }, { status: 400 });

  const jaTem = await prisma.ambassador.findFirst({
    where: { OR: [{ email: { equals: email, mode: "insensitive" } }, { asaasWalletId: walletId }] },
    select: { email: true },
  });
  if (jaTem) {
    return NextResponse.json({
      error: jaTem.email.toLowerCase() === email
        ? "Esse e-mail já é embaixador. Entre em firehubfood.com.br/embaixador."
        : "Esse código do Asaas já está cadastrado em outro embaixador.",
    }, { status: 400 });
  }

  const conferencia = await conferirCarteiraNoAsaas(walletId);
  if (!conferencia.ok) return NextResponse.json({ error: conferencia.motivo }, { status: 400 });

  // Código do link de indicação: o primeiro nome + 4 números, como no admin.
  const base = nome.split(" ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "") || "parceiro";
  let code = "";
  for (let i = 0; i < 5 && !code; i++) {
    const tentativa = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await prisma.ambassador.findUnique({ where: { code: tentativa }, select: { id: true } }))) code = tentativa;
  }
  if (!code) return NextResponse.json({ error: "Não consegui gerar o seu link agora. Tente de novo." }, { status: 500 });

  await prisma.ambassador.create({
    data: {
      name: nome,
      email,
      phone: whatsapp,
      code,
      commissionPercent: COMISSAO_DO_CURSO,
      asaasWalletId: walletId,
      password: await bcrypt.hash(senha, 10),
      active: true,
      level2Percent: 0,
      origem: "CURSO",
    },
  });
  console.log(`[Embaixador do curso] ${nome} (${email}) cadastrado com o código ${code}.`);

  return NextResponse.json({ ok: true, link: `https://firehubfood.com.br/cadastro?ref=${code}` });
}
