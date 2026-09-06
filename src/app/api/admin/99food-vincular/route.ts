import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listarLojasAutorizadas } from "@/lib/food99-api";
import { donosPorShopId } from "@/lib/food99-lojas";
import { vincularParaConta, adotarVinculo } from "@/lib/food99-vinculo";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/99food-vincular  { lojaId, shopId }
 *
 * O operador do FireHub fecha a etapa 2 (shopBind) para a loja de um cliente,
 * sem precisar da sessão do cliente.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * O caminho normal é o próprio lojista: ele autoriza no 99Food e a tela de
 * Integrações vincula sozinha. Mas numa migração (loja saindo do Saipos, do
 * Brendi…) quem está no painel do 99Food desautorizando o sistema antigo é o
 * operador, com a conta do cliente, e ele não tem a sessão do cliente no
 * FireHub. Esperar o cliente abrir a tela dele para o vínculo fechar deixa a
 * loja sem integração nenhuma nesse intervalo — em plena operação.
 *
 * GET lista o que o 99Food vê (quem autorizou, vinculado ou não) para o
 * operador saber o que pode vincular.
 */

async function exigirAdmin() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return NextResponse.json({ error: "Faça login no painel primeiro." }, { status: 401 });
  if ((session.user as any)?.role !== "ADMIN") {
    return NextResponse.json({ error: "Só o admin do FireHub usa isto." }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  const autorizadas = await listarLojasAutorizadas();
  if (!autorizadas.ok) return NextResponse.json({ ok: false, erro: autorizadas.erro, errno: autorizadas.errno });

  const donos = await donosPorShopId();
  return NextResponse.json({
    ok: true,
    lojas: autorizadas.lojas.map((l) => ({ ...l, donoNoFireHub: donos.get(l.shopId) ?? null })),
  });
}

export async function POST(req: NextRequest) {
  const bloqueio = await exigirAdmin();
  if (bloqueio) return bloqueio;

  const corpo = await req.json().catch(() => ({} as any));
  const lojaId = String(corpo?.lojaId || "").trim();
  const shopId = String(corpo?.shopId || "").trim();
  if (!lojaId || !shopId) return NextResponse.json({ error: "Informe lojaId e shopId." }, { status: 400 });

  const conta = await prisma.user.findUnique({ where: { id: lojaId }, select: { id: true, storeName: true } });
  if (!conta) return NextResponse.json({ error: "Loja do FireHub não encontrada." }, { status: 404 });

  const autorizadas = await listarLojasAutorizadas();
  if (!autorizadas.ok) return NextResponse.json({ error: autorizadas.erro }, { status: 502 });
  const alvo = autorizadas.lojas.find((l) => l.shopId === shopId);
  if (!alvo) return NextResponse.json({ error: "Essa loja não autorizou o FireHub no 99Food." }, { status: 404 });

  // Loja de OUTRA conta do FireHub não é vinculável daqui: seria mover os
  // pedidos dela de cozinha por um POST.
  const dono = (await donosPorShopId()).get(shopId);
  if (dono && dono !== lojaId) {
    return NextResponse.json({ error: `Essa loja do 99Food já pertence à conta ${dono} no FireHub.` }, { status: 409 });
  }

  // Vinculada por outro app: só o lojista libera (desautorizando o app antigo
  // no painel do 99Food). Vinculada e com token para nós: adota. Livre: vincula.
  const r = alvo.vinculada ? await adotarVinculo(lojaId, alvo) : await vincularParaConta(lojaId, alvo);
  if (!r.ok) return NextResponse.json({ ok: false, loja: alvo, erro: r.erro }, { status: 502 });

  return NextResponse.json({ ok: true, conta: conta.storeName, vinculo: r });
}
