/**
 * /api/store/pos/stone-connect/maquininhas — POS Stone da loja pela nuvem.
 *
 * POST  — { serial, label, totemLicenseId? } cadastra a maquininha pelo número
 *         de série (é para ele que o pedido é endereçado: devices_serial_number).
 * PATCH — { id, label?, active?, totemLicenseId? } renomeia, liga/desliga e
 *         vincula ao totem ("" ou null desvincula).
 *
 * Só o responsável pela loja (STAFF não).
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PROVEDOR = "STONE_CONNECT";

async function dono(): Promise<{ erro: NextResponse; lojaId?: undefined } | { erro?: undefined; lojaId: string }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true },
  });
  if (!user) return { erro: NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 }) };
  if (user.role === "STAFF") {
    return { erro: NextResponse.json({ error: "Só o responsável pela loja pode mexer nas maquininhas." }, { status: 403 }) };
  }
  return { lojaId: user.ownerId || user.id };
}

/** Número de série como está na etiqueta da POS (ex.: 6C582505). */
function serialLimpo(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9-]{4,40}$/.test(s) ? s : null;
}

async function vincularTotem(lojaId: string, terminalId: string, totemLicenseId: unknown) {
  if (totemLicenseId === undefined) return;
  if (totemLicenseId === null || totemLicenseId === "") {
    await prisma.totemLicense.updateMany({
      where: { franchiseeId: lojaId, posTerminalId: terminalId },
      data: { posTerminalId: null },
    });
    return;
  }
  await prisma.totemLicense.updateMany({
    where: { id: String(totemLicenseId), franchiseeId: lojaId },
    data: { posTerminalId: terminalId },
  });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await dono();
    if (ctx.erro) return ctx.erro;
    const lojaId = ctx.lojaId;
    const corpo = await req.json().catch(() => ({}));
    const serial = serialLimpo(corpo?.serial);
    if (!serial) {
      return NextResponse.json(
        { error: "Número de série inválido. Ele está na etiqueta atrás da maquininha (ex.: 6C582505)." },
        { status: 400 },
      );
    }
    const label = String(corpo?.label || "").trim().slice(0, 60) || `Stone ${serial}`;

    const existente = await prisma.posTerminal.findUnique({
      where: { franchiseeId_externalId: { franchiseeId: lojaId, externalId: serial } },
      select: { id: true, provider: true },
    });
    let id: string;
    if (existente) {
      if (existente.provider !== PROVEDOR) {
        return NextResponse.json({ error: "Já existe outra maquininha com esse número nesta loja." }, { status: 409 });
      }
      await prisma.posTerminal.update({ where: { id: existente.id }, data: { active: true, label } });
      id = existente.id;
    } else {
      const criado = await prisma.posTerminal.create({
        data: { franchiseeId: lojaId, provider: PROVEDOR, externalId: serial, label, active: true },
        select: { id: true },
      });
      id = criado.id;
    }
    await vincularTotem(lojaId, id, corpo?.totemLicenseId || undefined);
    return NextResponse.json({ success: true, terminal: { id, label, serial } });
  } catch (err) {
    console.error("[Stone Connect maquininhas POST]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await dono();
    if (ctx.erro) return ctx.erro;
    const lojaId = ctx.lojaId;
    const corpo = await req.json().catch(() => ({}));
    const id = String(corpo?.id || "");
    const atual = await prisma.posTerminal.findFirst({
      where: { id, franchiseeId: lojaId, provider: PROVEDOR },
      select: { id: true },
    });
    if (!atual) return NextResponse.json({ error: "Maquininha não encontrada nesta loja." }, { status: 404 });

    const data: { label?: string; active?: boolean } = {};
    if (typeof corpo?.label === "string" && corpo.label.trim()) data.label = corpo.label.trim().slice(0, 60);
    if (typeof corpo?.active === "boolean") data.active = corpo.active;
    if (Object.keys(data).length) await prisma.posTerminal.update({ where: { id }, data });
    if (data.active === false) {
      // Desligada não pode continuar sendo a maquininha do totem.
      await vincularTotem(lojaId, id, null);
    } else {
      await vincularTotem(lojaId, id, corpo?.totemLicenseId);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Stone Connect maquininhas PATCH]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
