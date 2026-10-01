import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { desenhoDaRota } from "@/lib/distancia-por-rota";

export const dynamic = "force-dynamic";

/**
 * GET /api/store/desenho-da-rota?lat=&lng=[&deLat=&deLng=]
 *
 * O caminho pelas ruas da loja até o ponto — o traçado que a tela de Entrega
 * desenha no simulador do modo "km percorrido" (lib/distancia-por-rota.ts,
 * desenhoDaRota). `deLat/deLng` é o pino da loja ainda não salvo na tela;
 * sem ele, vale o gravado.
 *
 * Só para o painel: a cota grátis do roteador é das cotações dos clientes, e
 * cada desenho é uma pergunta nova (não há cache). Um por segundo por conta.
 */
const ultimoPedido = new Map<string, number>();
const INTERVALO_MS = 1000;

const numero = (v: string | null) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : null;
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const quem = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!quem) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const agora = Date.now();
  if (agora - (ultimoPedido.get(quem.id) || 0) < INTERVALO_MS) {
    return NextResponse.json({ error: "Calma: um desenho por segundo." }, { status: 429 });
  }
  ultimoPedido.set(quem.id, agora);
  if (ultimoPedido.size > 5000) ultimoPedido.clear();

  const q = req.nextUrl.searchParams;
  const lat = numero(q.get("lat"));
  const lng = numero(q.get("lng"));
  if (lat == null || lng == null) return NextResponse.json({ error: "Ponto inválido" }, { status: 400 });

  let origem: { lat: number; lng: number } | null = null;
  const deLat = numero(q.get("deLat"));
  const deLng = numero(q.get("deLng"));
  if (deLat != null && deLng != null) {
    origem = { lat: deLat, lng: deLng };
  } else {
    const loja = await prisma.user.findUnique({ where: { id: quem.ownerId || quem.id }, select: { storeLatLng: true } });
    origem = lerPontoDaLoja(loja?.storeLatLng);
  }
  if (!origem) return NextResponse.json({ error: "Marque o ponto da loja no mapa primeiro." }, { status: 400 });

  const desenho = await desenhoDaRota(origem, { lat, lng });
  if (!desenho.ok) {
    console.warn("[desenho-da-rota] sem desenho:", desenho.motivo);
    return NextResponse.json({ error: "Não consegui desenhar o caminho agora." }, { status: 503 });
  }
  return NextResponse.json(desenho, { headers: { "Cache-Control": "no-store" } });
}
