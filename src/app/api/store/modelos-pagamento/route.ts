import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  lerModelosDePagamento, problemasDoModelo, aplicarModelo, type ModeloDePagamento,
} from "@/lib/modelos-de-pagamento";

/**
 * Os acertos de entregador que a loja cadastrou uma vez para reusar.
 *
 * A lista mora em `User.modelosDePagamento`, na conta DONA — funcionário e dono
 * veem e editam a mesma lista, como acontece com o resto da configuração da
 * loja. Sem isso, cada funcionário montaria a sua própria "Tabela padrão".
 */

async function loja() {
  const session = await getServerSession(authOptions);
  if (!session) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true },
  });
  if (!user) return null;
  return user.ownerId || user.id;
}

export async function GET() {
  const id = await loja();
  if (!id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const dono = await prisma.user.findUnique({
    where: { id },
    select: { modelosDePagamento: true },
  });
  return NextResponse.json({ modelos: lerModelosDePagamento(dono?.modelosDePagamento) });
}

/**
 * Grava a lista inteira.
 *
 * A tela manda o conjunto completo porque a lista é curta e o lojista mexe nela
 * de vez em quando: mandar a lista toda evita a corrida de dois formulários
 * abertos criando modelos com o mesmo nome em ordens diferentes.
 */
export async function PUT(req: NextRequest) {
  const id = await loja();
  if (!id) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const modelos = lerModelosDePagamento(body?.modelos);

  // Modelo com defeito não entra: ele vira pagamento de gente de verdade no
  // momento em que alguém o escolher, e aí o defeito já está dentro do acerto.
  const problemas: string[] = [];
  modelos.forEach((m: ModeloDePagamento, i: number) => {
    problemasDoModelo(m, modelos.filter((_, k) => k !== i)).forEach((p) => problemas.push(`${m.nome}: ${p}`));
  });
  if (problemas.length) {
    return NextResponse.json({ error: problemas.join(" "), problemas }, { status: 400 });
  }

  await prisma.user.update({
    where: { id },
    data: { modelosDePagamento: modelos as any },
  });

  // ── REAPLICAR NOS ENTREGADORES QUE USAM O MODELO ────────────────────────
  //
  // Só quando a tela pede (`reaplicarEm`), nunca por tabela: o modelo é COPIADO
  // para dentro do entregador justamente para que mexer nele não mude, calado,
  // quanto dez pessoas recebem. Quando a loja mandar, aí sim vale para todos
  // que ainda seguem aquele modelo.
  const reaplicar: string[] = Array.isArray(body?.reaplicarEm) ? body.reaplicarEm.map(String) : [];
  let atualizados = 0;
  for (const modeloId of reaplicar) {
    const modelo = modelos.find((m: ModeloDePagamento) => m.id === modeloId);
    if (!modelo) continue;
    const { modeloDePagamento, faixasDeKm, ...resto } = aplicarModelo(modelo);
    const r = await prisma.motoboy.updateMany({
      where: { franchiseeId: id, modeloDePagamento: modeloId },
      data: { ...resto, faixasDeKm: faixasDeKm as any, modeloDePagamento: modeloId },
    });
    atualizados += r.count;
  }

  return NextResponse.json({ modelos, atualizados });
}
