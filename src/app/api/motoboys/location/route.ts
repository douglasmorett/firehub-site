import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";

// POST: Motoboy envia sua localização em tempo real
//
// A versão anterior aceitava QUALQUER motoboyId do banco inteiro, sem escopo
// de loja e sem conferir `active` — dava para sobrescrever a posição do
// entregador de outra loja sabendo só o id. E `parseFloat("abc")` gravava NaN
// no banco. A resposta ainda devolvia o NOME do entregador, virando um oráculo
// id→nome para quem quisesse enumerar.
export async function POST(req: NextRequest) {
  try {
    const { motoboyId, storeId, lat, lng } = await req.json();

    if (!motoboyId || lat === undefined || lng === undefined) {
      return NextResponse.json({ error: "Dados incompletos" }, { status: 400 });
    }

    // GPS chega a cada ~12s por entregador; 20/min por id cobre com folga e
    // barra flood de escrita.
    const rl = checkRateLimit(`motoboy-gps:${String(motoboyId).slice(0, 40)}`, {
      windowMs: 60_000,
      maxRequests: 20,
    });
    if (!rl.allowed) {
      return NextResponse.json({ error: "Aguarde" }, { status: 429 });
    }

    const latitude = Number(lat);
    const longitude = Number(lng);
    if (
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    ) {
      return NextResponse.json({ error: "Coordenada inválida" }, { status: 400 });
    }

    // updateMany condicional: o escopo (loja + ativo) faz parte da ESCRITA.
    // App antigo ainda não manda storeId — aceita, mas `active: true` vale
    // sempre: entregador desativado no painel para de gravar posição na hora.
    const r = await prisma.motoboy.updateMany({
      where: {
        id: String(motoboyId),
        active: true,
        ...(storeId ? { franchiseeId: String(storeId) } : {}),
      },
      data: {
        lastLat: latitude,
        lastLng: longitude,
        lastLocationUpdate: new Date(),
      },
    });
    if (r.count === 0) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    // Sem nome e sem coordenada de volta: quem mandou já sabe onde está.
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Motoboy Location POST Error]", err);
    return NextResponse.json({ error: "Erro ao atualizar localização" }, { status: 500 });
  }
}

// GET: Painel de Roteirização consulta motoboys ativos da loja
//
// ⚠️ O atalho `?storeId=` foi REMOVIDO. Com ele presente, a sessão era pulada
// por inteiro — e o franchiseeId está no HTML público de todo cardápio, então
// qualquer pessoa na internet lia nome, TELEFONE e GPS ao vivo de todos os
// entregadores de qualquer loja. A loja agora sai SEMPRE da sessão do painel;
// ADMIN pode olhar outra loja para suporte, e é o único caso em que o
// parâmetro ainda significa algo.
export async function GET(req: NextRequest) {
  try {
    const { getServerSession } = await import("next-auth/next");
    const { authOptions } = await import("@/lib/auth");
    const session = await getServerSession(authOptions).catch(() => null);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const lojaDaSessao = user.ownerId || user.id;
    const pedido = req.nextUrl.searchParams.get("storeId");
    const storeId =
      user.role === "ADMIN" && pedido && pedido !== "all" ? pedido : lojaDaSessao;

    if (pedido && storeId !== pedido && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Esta loja não é sua" }, { status: 403 });
    }

    const motoboys = await prisma.motoboy.findMany({
      where: {
        franchiseeId: storeId,
        active: true
      },
      select: {
        id: true,
        name: true,
        phone: true,
        lastLat: true,
        lastLng: true,
        lastLocationUpdate: true
      }
    });

    return NextResponse.json({ success: true, motoboys });
  } catch (err) {
    console.error("[Motoboy Location GET Error]", err);
    return NextResponse.json({ error: "Erro ao buscar motoboys" }, { status: 500 });
  }
}
