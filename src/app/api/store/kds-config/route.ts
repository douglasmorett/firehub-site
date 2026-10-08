import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lerKdsConfig } from "@/lib/kds-telas";

/**
 * `User.kdsConfig` — as regras do KDS que não são de uma tela.
 *
 * São duas: `soNaFinalizacao`, as categorias que não aparecem na produção (a
 * bebida da NIK), e `prioridade`, os tipos de pedido que entram na frente da
 * fila (a mesa da Pizzaria 17). É irmã de `/api/store/kds-screens`, e separada
 * dela porque aquela devolve a LISTA de telas e todo leitor confia que é um
 * array — misturar a regra ali quebraria a tela da TV, o hub e a baixa.
 */
async function lojaDaSessao() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!user) return null;
  return user.ownerId || user.id;
}

export async function GET() {
  const lojaId = await lojaDaSessao();
  if (!lojaId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const dono = await prisma.user
    .findUnique({ where: { id: lojaId }, select: { kdsConfig: true } })
    .catch(() => null);

  return NextResponse.json(lerKdsConfig(dono?.kdsConfig), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(req: NextRequest) {
  const lojaId = await lojaDaSessao();
  if (!lojaId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const bruto = await req.json().catch(() => null);
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
  }
  // Cada tela do painel salva só a regra dela (o hub manda `soNaFinalizacao`,
  // a prioridade manda `prioridade`). Juntar com o que já está gravado é o que
  // impede uma de apagar a outra.
  const atual = await prisma.user
    .findUnique({ where: { id: lojaId }, select: { kdsConfig: true } })
    .catch(() => null);
  const gravado = lerKdsConfig(atual?.kdsConfig);
  const enviado = lerKdsConfig(bruto);
  const config = {
    soNaFinalizacao: "soNaFinalizacao" in bruto ? enviado.soNaFinalizacao : gravado.soNaFinalizacao,
    prioridade: "prioridade" in bruto ? enviado.prioridade : gravado.prioridade,
  };

  await prisma.user.update({
    where: { id: lojaId },
    data: { kdsConfig: config },
  });

  return NextResponse.json({ ok: true, ...config });
}
