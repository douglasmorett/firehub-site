import { NextResponse } from "next/server";
import { lerFaixasDoMotoboy } from "@/lib/faixas-do-motoboy";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { estaNaSenhaPadrao, hashDeSenha } from "@/lib/motoboy-senha";

// GET - listar motoboys do franqueado
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;

  // Aqui havia um updateMany que gravava "123456" em texto puro em todo mundo
  // que estivesse sem senha, a cada abertura da tela. Quem ainda não tem senha
  // continua entrando com a padrão — a diferença é que ela é conferida no login
  // e gravada como hash naquele momento, em vez de ser semeada no banco.

  // ── SÓ O CADASTRO ──────────────────────────────────────────────────────
  //
  // Esta lista trazia também o "Hoje: N entregas / Total: R$ X" de cada
  // entregador, e para isso lia os pedidos do dia de todos eles a cada
  // abertura — da tela de cadastro, do painel de pedidos e da roteirização.
  // No cadastro o número confundia (o dono, 23/09/2026: "aparece hoje 0 sempre,
  // se é área de cadastro não precisa aparecer quanto ele fez hoje"), e as
  // outras duas telas nunca o usaram. Quanto cada um fez e recebe mora no
  // relatório de pagamentos (api/motoboy-report) e no fechamento do caixa.
  const motoboys = await prisma.motoboy.findMany({
    where: { franchiseeId: targetFranchiseeId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  const result = await Promise.all(motoboys.map(async (mb) => ({
    ...mb,
    // A senha saía daqui em texto puro, para toda a lista, a cada carregamento
    // da tela — bastava abrir a aba de rede do navegador. O painel não precisa
    // dela: precisa saber quem ainda não trocou a padrão, e poder redefinir.
    password: undefined,
    senhaPadrao: await estaNaSenhaPadrao(mb.password),
  })));

  return NextResponse.json(result);
}

// POST - criar motoboy
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" } });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const targetFranchiseeId = user.ownerId || user.id;
  const body = await req.json();
  const { name, phone, password, paymentType, dailyRate, perDeliveryRate, perKmRate, faixasDeKm, notes, modeloDePagamento } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 });
  }

  const motoboy = await prisma.motoboy.create({
    data: {
      franchiseeId: targetFranchiseeId,
      name: name.trim(),
      phone: phone?.trim() || null,
      password: await hashDeSenha(password?.trim() || "123456"),
      paymentType: paymentType || "PER_DELIVERY",
      dailyRate: dailyRate ? Number(dailyRate) : null,
      perDeliveryRate: perDeliveryRate ? Number(perDeliveryRate) : null,
      perKmRate: perKmRate ? Number(perKmRate) : null,
      // Saneado na entrada: a tela manda o que o lojista digitou, e faixa com
      // distância zero ou valor negativo não pode virar acerto de pagamento.
      faixasDeKm: lerFaixasDoMotoboy(faixasDeKm),
      // De qual modelo o acerto veio, quando veio de um (lib/modelos-de-pagamento.ts).
      modeloDePagamento: modeloDePagamento?.trim() || null,
      notes: notes?.trim() || null,
    },
  });

  // A resposta devolvia o registro inteiro, com o campo password dentro.
  return NextResponse.json(
    { ...motoboy, password: undefined, senhaPadrao: !password?.trim() },
    { status: 201 }
  );
}
