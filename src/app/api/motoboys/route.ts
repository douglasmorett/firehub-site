import { NextResponse } from "next/server";
import { lerFaixasDoMotoboy } from "@/lib/faixas-do-motoboy";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { estaNaSenhaPadrao, hashDeSenha } from "@/lib/motoboy-senha";
import { inicioDoExpedienteDaLoja } from "@/lib/fuso";
import { ganhoDoPedido, lerAcerto } from "@/lib/ganho-do-entregador";
import { lerRegraDeRepasse } from "@/lib/repasse-do-entregador";
import { canalDoPedido } from "@/lib/canal-do-pedido";

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

  // Expediente da loja. Com `setHours(0,0,0,0)` (fuso do container = UTC) as
  // entregas e os ganhos do motoboy zeravam as 21:00 de Brasilia, no meio do
  // turno dele — o painel dizia "0 entregas" para quem tinha acabado de rodar a
  // noite inteira.
  // Com o fuso DA LOJA: sem argumento a função cai em São Paulo, e fora de SP
  // a tela da loja e o app do motoboy viravam o dia em instantes diferentes.
  const today = inicioDoExpedienteDaLoja(user.storeTimezone);

  // A tabela de repasse é do DONO da conta, como no fechamento — conta de
  // funcionário não tem cadastro de entrega próprio.
  const donoDaLoja = await prisma.user.findUnique({
    where: { id: targetFranchiseeId },
    select: { deliveryZones: true, deliveryConfig: true },
  }).catch(() => null);
  const regraDeRepasse = lerRegraDeRepasse(donoDaLoja?.deliveryConfig);

  const motoboys = await prisma.motoboy.findMany({
    where: { franchiseeId: targetFranchiseeId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      orders: {
        where: {
          createdAt: { gte: today },
          status: { notIn: ["CANCELADO"] },
        },
        // O canal sai de lib/canal-do-pedido.ts e precisa destes: sem eles todo
        // pedido parece do site e a regra do app nunca se aplicaria.
        select: {
          id: true, totalAmount: true, deliveryType: true, deliveryFee: true,
          motoboyFee: true, deliveryDistance: true, source: true,
          ifoodOrderId: true, ifoodReference: true,
          openDeliveryChannel: true, openDeliveryOrderId: true, openDeliveryReference: true,
        },
      },
    },
  });

  // Calculate earnings for each motoboy
  const result = await Promise.all(motoboys.map(async (mb) => {
    const todayOrders = mb.orders || [];
    const deliveryCount = todayOrders.length;

    // A MESMA conta do fechamento (lib/ganho-do-entregador.ts). Antes este
    // cartão fazia a sua própria: ignorava a escada de km e multiplicava
    // `perDeliveryRate × entregas` — inclusive o valor sobrando de um tipo de
    // pagamento antigo. O lojista via aqui um número e no relatório outro.
    const acerto = lerAcerto(mb as any);
    const daily = acerto.dailyRate;
    const deliveryFees =
      acerto.tipo === "DAILY_PLUS_FEE"
        ? todayOrders.reduce((sum, o) => sum + (o.deliveryFee || 0), 0)
        : todayOrders.reduce(
            (sum, o) => sum + ganhoDoPedido({ acerto, pedido: o, regraDaLoja: regraDeRepasse, zonas: donoDaLoja?.deliveryZones, ehMarketplace: canalDoPedido(o).ehMarketplace }).valor,
            0,
          );

    const totalEarnings = Math.round((daily + deliveryFees) * 100) / 100;

    return {
      ...mb,
      // A senha saía daqui em texto puro, para toda a lista, a cada carregamento
      // da tela — bastava abrir a aba de rede do navegador. O painel não precisa
      // dela: precisa saber quem ainda não trocou a padrão, e poder redefinir.
      password: undefined,
      senhaPadrao: await estaNaSenhaPadrao(mb.password),
      orders: undefined,
      todayDeliveryCount: deliveryCount,
      todayDeliveryFees: deliveryFees,
      todayDailyRate: daily,
      todayTotalEarnings: totalEarnings,
    };
  }));

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
