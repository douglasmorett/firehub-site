/**
 * GET /api/geocodificar/loja
 *
 * Onde fica ESTA loja, para um mapa do painel abrir no lugar certo. Responde o
 * pino salvo (storeLatLng) ou, quando ele nunca foi salvo, o ponto do endereço
 * cadastrado — a regra inteira está em lib/ponto-da-loja-servidor.
 *
 * Serve às telas que montam o mapa no navegador e não recebem o ponto pronto do
 * servidor (a área de entrega, em Minha Loja). Quem já recebe por prop não
 * precisa chamar.
 *
 * `origem` diz de onde veio: "cadastro" é o pino que o lojista arrastou;
 * "endereco"/"cidade" é palpite bom o bastante para mover a câmera e NÃO serve
 * para cobrar frete — quem cobra é o storeLatLng, e ele continua só sendo
 * escrito pelo mapa da área de entrega.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolverLojaNoMapa, lojaNoMapaPorId } from "@/lib/ponto-da-loja-servidor";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const usuario = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, storeLatLng: true, storeAddress: true, city: true },
  });
  if (!usuario) return NextResponse.json({ error: "usuário não encontrado" }, { status: 401 });

  // Funcionário não tem endereço próprio: a loja é a do dono.
  const noMapa = usuario.ownerId
    ? await lojaNoMapaPorId(usuario.ownerId)
    : await resolverLojaNoMapa(usuario);

  return NextResponse.json(noMapa);
}
