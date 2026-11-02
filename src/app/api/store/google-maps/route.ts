/**
 * /api/store/google-maps — a conta do Google DA LOJA (lib/google-maps-da-loja.ts).
 * A tela é o bloco "Mapa do Google" da roteirização (RoteirizacaoModal).
 *
 *   GET                     estado: conectada?, final da chave, buscas no mês
 *   GET ?mapa=1             { chaveDoMapa }: a chave para o FUNDO do mapa da
 *                           roteirização (Maps JavaScript API, no navegador do
 *                           painel — lib/mapa-do-google-no-leaflet.ts)
 *   POST { chave }          testa a chave no Geocoding API e, se funcionar, salva
 *   DELETE                  desconecta (apaga a chave; a loja volta ao mapa aberto)
 *
 * Só o titular da loja conecta ou desconecta (a conta e o cartão são dele).
 * Funcionário (STAFF) vê o estado. A chave é cifrada (lib/cofre.ts) e nunca
 * vai para o log. Ela só sai inteira no `?mapa=1`, para quem está logado no
 * painel da loja: a Maps JavaScript API roda no navegador e precisa dela (é
 * como o Google funciona). Por isso o passo a passo restringe a chave às duas
 * APIs (Geocoding e Maps JavaScript): quem a copiar do painel não usa para
 * mais nada. Nunca vai para o cardápio público.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cifrar } from "@/lib/cofre";
import {
  buscasNoMes,
  finalDaChave,
  formatoDeChaveValido,
  lerTesteDaChave,
  limparChave,
  urlDoTesteDaChave,
} from "@/lib/google-maps-da-loja";
import { chaveDoGoogleDaLoja, contarBuscaNoGoogle, esquecerChaveDaLoja } from "@/lib/google-maps-da-loja-servidor";

export const dynamic = "force-dynamic";

async function quemPede() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, email: true },
  });
  if (!user) return null;
  return { ...user, lojaId: user.ownerId || user.id, titular: user.role !== "STAFF" };
}

/** O que a tela mostra. Nada de segredo aqui. */
async function estadoDaLoja(lojaId: string, titular: boolean) {
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { googleMapsChaveCifrada: true, googleMapsConexao: true, googleMapsUso: true },
  });
  const conexao = ((loja?.googleMapsConexao as any) || {}) as { final?: string; conectadoEm?: string };
  const conectado = Boolean(loja?.googleMapsChaveCifrada);
  return {
    conectado,
    final: conectado ? conexao.final || null : null,
    conectadoEm: conectado ? conexao.conectadoEm || null : null,
    buscasNoMes: buscasNoMes(loja?.googleMapsUso),
    podeEditar: titular,
  };
}

export async function GET(req: NextRequest) {
  const quem = await quemPede();
  if (!quem) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (req.nextUrl.searchParams.get("mapa") === "1") {
    return NextResponse.json({ chaveDoMapa: await chaveDoGoogleDaLoja(quem.lojaId) }, { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(await estadoDaLoja(quem.lojaId, quem.titular));
}

export async function POST(req: NextRequest) {
  const quem = await quemPede();
  if (!quem) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!quem.titular) {
    return NextResponse.json({ error: "Só o titular da loja pode conectar a conta do Google." }, { status: 403 });
  }
  const corpo = await req.json().catch(() => ({}) as any);
  const chave = limparChave(corpo?.chave);
  if (!formatoDeChaveValido(chave)) {
    return NextResponse.json(
      { error: "Isso não parece uma chave do Google Maps. Ela começa com AIza e tem 39 letras e números — copie em Credenciais no Google Cloud." },
      { status: 400 },
    );
  }

  const loja = await prisma.user.findUnique({ where: { id: quem.lojaId }, select: { city: true } });
  let teste;
  try {
    const res = await fetch(urlDoTesteDaChave(chave, loja?.city), { signal: AbortSignal.timeout(8000) });
    teste = lerTesteDaChave(await res.json().catch(() => null));
  } catch {
    teste = { ok: false as const, erro: "O Google não respondeu a tempo. Tente de novo em instantes." };
  }
  if (!teste.ok) return NextResponse.json({ error: teste.erro }, { status: 400 });

  await prisma.user.update({
    where: { id: quem.lojaId },
    data: {
      googleMapsChaveCifrada: cifrar(chave),
      googleMapsConexao: { final: finalDaChave(chave), conectadoEm: new Date().toISOString(), conectadoPor: quem.email },
    },
  });
  // O teste foi uma busca na conta da loja.
  contarBuscaNoGoogle(quem.lojaId);
  esquecerChaveDaLoja(quem.lojaId);
  console.log(`[Google da loja] loja ${quem.lojaId} conectou a conta do Google`);
  return NextResponse.json(await estadoDaLoja(quem.lojaId, quem.titular));
}

export async function DELETE() {
  const quem = await quemPede();
  if (!quem) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!quem.titular) {
    return NextResponse.json({ error: "Só o titular da loja pode desconectar a conta do Google." }, { status: 403 });
  }
  await prisma.user.update({
    where: { id: quem.lojaId },
    data: { googleMapsChaveCifrada: null, googleMapsConexao: { desconectadoEm: new Date().toISOString(), desconectadoPor: quem.email } },
  });
  esquecerChaveDaLoja(quem.lojaId);
  console.log(`[Google da loja] loja ${quem.lojaId} desconectou a conta do Google`);
  return NextResponse.json(await estadoDaLoja(quem.lojaId, quem.titular));
}
