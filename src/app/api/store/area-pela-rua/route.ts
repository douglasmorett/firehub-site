import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { areaNoCache, areaPelaRua, kmsDaArea } from "@/lib/area-pela-rua";

export const dynamic = "force-dynamic";

/**
 * GET /api/store/area-pela-rua?km=1,3,5[&deLat=&deLng=]
 *
 * As manchas do km percorrido na tela de Entrega: até onde a moto chega pela
 * rua em cada faixa (lib/area-pela-rua.ts). `km` são as faixas que estão NA
 * TELA (podem não estar salvas); `deLat/deLng`, o pino da loja ainda não
 * salvo. Só para o painel, com freio por conta: o que já foi calculado sai do
 * cache e não conta.
 */
const ultimoCalculo = new Map<string, number>();
const INTERVALO_MS = 4000;

const numero = (v: string | null) => {
  const n = Number(v);
  return v != null && v !== "" && Number.isFinite(n) ? n : null;
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const quem = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, ownerId: true } });
  if (!quem) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const q = req.nextUrl.searchParams;
  const kms = kmsDaArea(String(q.get("km") || "").split(","));
  if (kms.length === 0) return NextResponse.json({ error: "Sem faixa de km." }, { status: 400 });

  let ponto: { lat: number; lng: number } | null = null;
  const deLat = numero(q.get("deLat"));
  const deLng = numero(q.get("deLng"));
  if (deLat != null && deLng != null) ponto = { lat: deLat, lng: deLng };
  else {
    const loja = await prisma.user.findUnique({ where: { id: quem.ownerId || quem.id }, select: { storeLatLng: true } });
    ponto = lerPontoDaLoja(loja?.storeLatLng);
  }
  if (!ponto) return NextResponse.json({ error: "Marque o ponto da loja no mapa primeiro." }, { status: 400 });

  // O freio só vale para cálculo novo: a mesma área de novo (voltar à tela,
  // trocar de aba) sai do cache sem esperar.
  const agora = Date.now();
  if (!areaNoCache(ponto, kms) && agora - (ultimoCalculo.get(quem.id) || 0) < INTERVALO_MS) {
    return NextResponse.json({ error: "Aguarde um instante para recalcular a área." }, { status: 429 });
  }
  const r = await areaPelaRua(ponto, kms);
  if (!r.ok) {
    console.warn("[area-pela-rua] sem área:", r.motivo);
    return NextResponse.json({ error: "Não consegui desenhar a área pelas ruas agora." }, { status: 503 });
  }
  if (!r.doCache) {
    ultimoCalculo.set(quem.id, agora);
    if (ultimoCalculo.size > 5000) ultimoCalculo.clear();
  }
  return NextResponse.json({ areas: r.areas }, { headers: { "Cache-Control": "no-store" } });
}
