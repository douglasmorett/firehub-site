import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lerBalcaoConfig, BALCAO_CONFIG_PADRAO } from "@/lib/balcao-config";

/**
 * As regras do lançamento presencial da loja (lib/balcao-config.ts).
 *
 * Sempre pelo DONO da loja (`ownerId || id`): funcionário logado configura e
 * lê a mesma coisa que o dono, como em toda tela de Minha Loja. Se cada
 * funcionário tivesse a sua, o atendente ligaria o pager obrigatório e o
 * colega ao lado continuaria lançando sem.
 */

async function donoDaLoja(email: string) {
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, ownerId: true } });
  if (!u) return null;
  return u.ownerId || u.id;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const targetId = await donoDaLoja(session.user.email);
  if (!targetId) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  try {
    const dono = await prisma.user.findUnique({ where: { id: targetId }, select: { balcaoConfig: true } });
    return NextResponse.json(lerBalcaoConfig((dono as any)?.balcaoConfig));
  } catch (err) {
    // Coluna ainda ausente (o boot não rodou o ADD COLUMN): a tela abre no
    // padrão em vez de dar erro. Nada obrigatório é exatamente o que vale
    // enquanto não há o que gravar.
    console.error("[Balcão] leitura da config:", (err as any)?.code || err);
    return NextResponse.json({ ...BALCAO_CONFIG_PADRAO });
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const targetId = await donoDaLoja(session.user.email);
  if (!targetId) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  // Passa pelo mesmo leitor da tela e do PDV: o que entra no banco é sempre
  // o objeto com as duas chaves booleanas, nunca o corpo cru do navegador.
  const config = lerBalcaoConfig(await req.json().catch(() => null));

  try {
    await prisma.user.update({ where: { id: targetId }, data: { balcaoConfig: config } as any });
  } catch (err) {
    console.error("[Balcão] gravação da config:", (err as any)?.code || err);
    return NextResponse.json(
      { error: "Não consegui salvar agora. Se acabou de sair uma atualização, tente de novo em um minuto." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, ...config });
}
