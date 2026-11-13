import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { formaFechadaAgora } from "@/lib/forma-fechada";
import { caixaAbertoPara, caixaPorUsuarioLigado } from "@/lib/caixa-por-usuario";

// GET - retorna status da loja (público, por slug)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug");

  if (slug) {
    const user = await prisma.user.findUnique({
      where: { slug },
      select: { storeOpen: true, cashOpen: true, storeName: true },
    });
    if (!user) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
    return NextResponse.json(user);
  }

  // Autenticado: retorna status do próprio usuário / loja principal
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const currentUser = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true, storeOpen: true, cashOpen: true },
  });
  if (!currentUser) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  const targetId = currentUser.ownerId || currentUser.id;
  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { storeOpen: true, cashOpen: true, deliveryConfig: true },
  });
  if (!user) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  // Caixa por usuário: o botão "Caixa" da barra é o caixa DESTE login (o
  // `cashOpen` da loja continua dizendo "algum caixa aberto", para o robô e
  // o site). Desligado, é o da loja, como sempre.
  const cashOpen = (await caixaPorUsuarioLigado(targetId))
    ? Boolean(await caixaAbertoPara(targetId, currentUser.id, true).catch(() => null))
    : user.cashOpen;
  return NextResponse.json({ storeOpen: user.storeOpen, cashOpen, formaFechada: formaFechadaAgora(user.deliveryConfig) });
}

// PATCH - toggle loja/caixa
export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const data: any = {};
  if (body.storeOpen !== undefined) data.storeOpen = body.storeOpen;
  if (body.cashOpen !== undefined) data.cashOpen = body.cashOpen;

  const currentUser = await prisma.user.findUnique({
    where: { email: session.user?.email || "" },
    select: { id: true, ownerId: true },
  });
  if (!currentUser) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  const targetId = currentUser.ownerId || currentUser.id;

  // Fechar só a entrega ou só a retirada (lib/forma-fechada.ts): mesclado no
  // deliveryConfig, que guarda frete, mínimo e roteirização de outras telas.
  if (body.formaFechada !== undefined) {
    const f = body.formaFechada;
    let nova: any = null;
    if (f) {
      if (f.forma !== "ENTREGA" && f.forma !== "RETIRADA") return NextResponse.json({ error: "Forma inválida" }, { status: 400 });
      const ate = new Date(f.ate);
      if (!Number.isFinite(ate.getTime()) || ate.getTime() <= Date.now()) return NextResponse.json({ error: "Escolha até quando fica fechado" }, { status: 400 });
      nova = { forma: f.forma, ate: ate.toISOString(), motivo: typeof f.motivo === "string" ? f.motivo.slice(0, 60) : undefined };
    }
    const atual = await prisma.user.findUnique({ where: { id: targetId }, select: { deliveryConfig: true, storeDeliveryOnly: true } });
    if (nova?.forma === "ENTREGA" && atual?.storeDeliveryOnly) {
      return NextResponse.json({ error: "Sua loja não faz retirada: para parar a entrega, feche o site todo." }, { status: 400 });
    }
    const cfg = atual?.deliveryConfig && typeof atual.deliveryConfig === "object" && !Array.isArray(atual.deliveryConfig)
      ? (atual.deliveryConfig as Record<string, unknown>)
      : {};
    data.deliveryConfig = { ...cfg, formaFechada: nova };
  }

  const user = await prisma.user.update({
    where: { id: targetId },
    data,
    select: { storeOpen: true, cashOpen: true, deliveryConfig: true },
  });
  return NextResponse.json({ storeOpen: user.storeOpen, cashOpen: user.cashOpen, formaFechada: formaFechadaAgora(user.deliveryConfig) });
}
