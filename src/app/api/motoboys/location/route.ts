import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { avisarSeEstaChegando } from "@/lib/entrega-ao-vivo";

// POST: Motoboy envia sua localização em tempo real
//
// A versão anterior aceitava QUALQUER motoboyId do banco inteiro, sem escopo
// de loja e sem conferir `active` — dava para sobrescrever a posição do
// entregador de outra loja sabendo só o id. E `parseFloat("abc")` gravava NaN
// no banco. A resposta ainda devolvia o NOME do entregador, virando um oráculo
// id→nome para quem quisesse enumerar.
export async function POST(req: NextRequest) {
  try {
    const corpo = await req.json();
    const { lat, lng } = corpo;
    // App nativo: a posição chega do serviço de localização com a tela apagada,
    // sempre com a sessão assinada — e é dela que sai quem está andando.
    const { temSessaoAssinada, exigirMotoboy } = await import("@/lib/motoboy-sessao");
    const daSessao = temSessaoAssinada(req) ? await exigirMotoboy(req) : null;
    if (temSessaoAssinada(req) && !daSessao) {
      return NextResponse.json({ error: "Sessão expirada. Entre de novo.", precisaLogin: true, precisaRelogar: true }, { status: 401 });
    }
    const motoboyId = daSessao?.id ?? corpo.motoboyId;
    const storeId = daSessao?.franchiseeId ?? corpo.storeId;

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

    // Fora do horário da loja o app desliga o GPS (lib/app-motoboy/gps-no-horario.ts).
    if (daSessao) {
      const { gpsForaDoHorario } = await import("@/lib/app-motoboy/gps-no-horario");
      if (await gpsForaDoHorario(daSessao.franchiseeId, daSessao.id)) {
        return NextResponse.json({ success: true, foraDoHorario: true });
      }
    }

    // Rota 100% automatizada: "chegou na loja?" (lib/roteirizacao-automatica/
    // motoboy-na-loja.ts). Só com a sessão assinada — o id do corpo não prova
    // quem está andando. ANTES de gravar a posição: o carimbo precisa saber
    // se a posição anterior já tinha esfriado (chegada nova, não a de ontem).
    // Chegou agora (e não "continua na loja"): a rota pronta chama quem chegou
    // primeiro, então o ciclo roda já, depois da resposta (empurrao.ts).
    if (daSessao) {
      const { carimbarChegadaNaLoja } = await import("@/lib/roteirizacao-automatica/motoboy-na-loja");
      const { chegouAgora } = await carimbarChegadaNaLoja(daSessao.id, daSessao.franchiseeId, latitude, longitude);
      if (chegouAgora) {
        const { empurrarRoteirizacao } = await import("@/lib/roteirizacao-automatica/empurrao");
        empurrarRoteirizacao(daSessao.franchiseeId, "motoboy chegou na loja");
      }
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

    // "Seu pedido está chegando" — sem esperar: o app só precisa do GPS gravado
    // (lib/entrega-ao-vivo.ts).
    void avisarSeEstaChegando(String(motoboyId), latitude, longitude);

    // Sem nome e sem coordenada de volta: quem mandou já sabe onde está.
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Motoboy Location POST Error]", err);
    return NextResponse.json({ error: "Erro ao atualizar localização" }, { status: 500 });
  }
}

// DELETE: o entregador apertou "Sair" — some do mapa da loja na hora
// (lib/motoboy-sair-do-mapa.ts). Quem sai é SEMPRE o da sessão assinada, nunca
// um id do corpo: senão qualquer um apagava o entregador de outra loja do mapa.
// Sessão vencida não é erro para quem está saindo — o app sai de qualquer jeito.
export async function DELETE(req: NextRequest) {
  try {
    const { exigirMotoboy } = await import("@/lib/motoboy-sessao");
    const { tirarMotoboyDoMapa } = await import("@/lib/motoboy-sair-do-mapa");
    const mb = await exigirMotoboy(req);
    const saiu = await tirarMotoboyDoMapa(prisma, mb);
    return NextResponse.json({ success: true, saiuDoMapa: saiu });
  } catch (err) {
    console.error("[Motoboy Location DELETE Error]", err);
    return NextResponse.json({ error: "Erro ao tirar do mapa" }, { status: 500 });
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

    // `naLojaDesde`: o 🏠 "na loja há X min" da Rota 100% automatizada
    // (lib/roteirizacao-automatica/motoboy-na-loja.ts). Coluna nova — o
    // `as any` é porque o client local ainda não a conhece.
    const motoboys = await (prisma.motoboy as any).findMany({
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
        lastLocationUpdate: true,
        naLojaDesde: true,
      }
    });

    return NextResponse.json({ success: true, motoboys });
  } catch (err) {
    console.error("[Motoboy Location GET Error]", err);
    return NextResponse.json({ error: "Erro ao buscar motoboys" }, { status: 500 });
  }
}
