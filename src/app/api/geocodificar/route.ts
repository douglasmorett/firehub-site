/**
 * POST /api/geocodificar
 *
 * O mapa da roteirização manda os endereços dos pedidos e recebe as
 * coordenadas. Quem fala com o geocodificador é o SERVIDOR — ver
 * lib/geocodificacao-servidor.ts para o motivo (o limite do Nominatim é por IP,
 * e o IP da loja é o do Wi-Fi, compartilhado com a rua inteira).
 *
 * Exige sessão de lojista: geocodificação é serviço de terceiro com limite, não
 * pode virar endpoint aberto.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { geocodificarNoServidor } from "@/lib/geocodificacao-servidor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const corpo = await req.json().catch(() => ({} as any));
  const enderecos = Array.isArray(corpo?.enderecos) ? corpo.enderecos : [];
  if (enderecos.length === 0) return NextResponse.json({ resultados: [] });

  // Teto por chamada: o painel manda os pedidos da tela, e um lote gigante
  // seguraria a fila do servidor inteiro. O modal pagina sozinho.
  const lote = enderecos
    .filter((e: any) => e && typeof e.id === "string" && typeof e.endereco === "string" && e.endereco.trim())
    .slice(0, 40);

  const usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, city: true, storeAddress: true, storeLatLng: true },
  });
  if (!usuario) return NextResponse.json({ error: "usuário não encontrado" }, { status: 401 });

  let cidade = usuario.city || "";
  let endereco = usuario.storeAddress || "";
  let centro = usuario.storeLatLng as any;
  if (usuario.ownerId) {
    const dono = await prisma.user.findUnique({
      where: { id: usuario.ownerId },
      select: { city: true, storeAddress: true, storeLatLng: true },
    });
    if (dono) {
      cidade = dono.city || cidade;
      endereco = dono.storeAddress || endereco;
      centro = (dono.storeLatLng as any) || centro;
    }
  }

  // Sem a coordenada da loja não há âncora: o raio de 30 km e o viés da busca
  // dependem dela. Melhor recusar do que devolver pino aleatório.
  const lat = Number(centro?.lat);
  const lng = Number(centro?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { error: "A loja está sem coordenada no cadastro. Salve o endereço em Minha Loja para o mapa funcionar." },
      { status: 409 },
    );
  }

  try {
    const resultados = await geocodificarNoServidor(lote, { cidade, endereco, centro: { lat, lng } });
    const doCache = resultados.filter((r) => r.doCache).length;
    console.log(`[Geocodificação] ${resultados.length} endereço(s) para ${cidade}: ${doCache} do cache, ${resultados.length - doCache} novos`);
    return NextResponse.json({ resultados });
  } catch (e: any) {
    console.error("[Geocodificação] falhou:", e?.message);
    return NextResponse.json({ error: e?.message || "erro" }, { status: 500 });
  }
}
