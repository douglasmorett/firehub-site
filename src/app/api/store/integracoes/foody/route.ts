/**
 * /api/store/integracoes/foody — a conexão da loja com a Foody Delivery (ou a
 * Voe Delivery, mesmo sistema). Tela: Integrações → Foody / Voe
 * (components/customer/FoodyDeliveryConfig.tsx).
 *
 *   GET                         estado (conectada, gatilho, marcarEntregue)
 *   POST { acao: "testar", token? }          testa o token colado (ou o salvo)
 *   POST { acao: "salvar", token?, gatilho, marcarEntregue }
 *   DELETE                      desconecta (apaga o token)
 *
 * O token nunca volta para a tela: é cifrado (lib/cofre.ts) e só é aberto no
 * servidor, na hora de falar com a Foody. Salvar com token novo TESTA antes —
 * token que a Foody recusa não é gravado. Só o titular mexe; funcionário vê.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lerGatilho, normalizarToken } from "@/lib/foody-delivery";
import { configDaFoody, salvarConfigDaFoody, testarTokenDaFoody, tokenDaFoody } from "@/lib/foody-no-banco";

export const dynamic = "force-dynamic";

async function quemPede() {
  const session = await getServerSession(authOptions).catch(() => null);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true },
  });
  if (!user) return null;
  return { lojaId: user.ownerId || user.id, titular: user.role !== "STAFF" };
}

async function fusoDa(lojaId: string) {
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeTimezone: true } });
  return loja?.storeTimezone || "America/Sao_Paulo";
}

async function estado(lojaId: string, titular: boolean) {
  const c = await configDaFoody(lojaId);
  return { ...c, podeEditar: titular };
}

export async function GET() {
  const q = await quemPede();
  if (!q) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  return NextResponse.json(await estado(q.lojaId, q.titular));
}

export async function POST(req: NextRequest) {
  const q = await quemPede();
  if (!q) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo?.acao || "");

  if (acao === "testar") {
    const colado = corpo?.token ? normalizarToken(corpo.token) : null;
    if (corpo?.token && !colado) return NextResponse.json({ ok: false, erro: "Esse token não parece certo. Copie de novo no painel da Foody." });
    const token = colado || (await tokenDaFoody(q.lojaId));
    if (!token) return NextResponse.json({ ok: false, erro: "Cole o token da Foody para testar." });
    const r = await testarTokenDaFoody(token, await fusoDa(q.lojaId));
    return NextResponse.json(r);
  }

  if (acao === "salvar") {
    if (!q.titular) return NextResponse.json({ error: "Só o dono da loja muda a integração." }, { status: 403 });
    let token: string | undefined;
    if (corpo?.token) {
      const t = normalizarToken(corpo.token);
      if (!t) return NextResponse.json({ error: "Esse token não parece certo. Copie de novo no painel da Foody." }, { status: 400 });
      const teste = await testarTokenDaFoody(t, await fusoDa(q.lojaId));
      if (!teste.ok) return NextResponse.json({ error: teste.erro || "A Foody não aceitou o token." }, { status: 400 });
      token = t;
    } else if (!(await configDaFoody(q.lojaId)).conectada) {
      return NextResponse.json({ error: "Cole o token da Foody para conectar." }, { status: 400 });
    }
    await salvarConfigDaFoody(q.lojaId, {
      token,
      gatilho: lerGatilho(corpo?.gatilho),
      marcarEntregue: Boolean(corpo?.marcarEntregue),
    });
    return NextResponse.json(await estado(q.lojaId, q.titular));
  }

  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}

export async function DELETE() {
  const q = await quemPede();
  if (!q) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!q.titular) return NextResponse.json({ error: "Só o dono da loja muda a integração." }, { status: 403 });
  await salvarConfigDaFoody(q.lojaId, { token: null });
  return NextResponse.json(await estado(q.lojaId, q.titular));
}
