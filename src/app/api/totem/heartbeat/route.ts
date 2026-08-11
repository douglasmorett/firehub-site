import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || "fallback-secret");

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    if (!token) return NextResponse.json({ error: "Token obrigatório" }, { status: 400 });

    let payload: any;
    try {
      const result = await jwtVerify(token, secret);
      payload = result.payload;
    } catch {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    const license = await prisma.totemLicense.findUnique({
      where: { id: payload.licenseId },
      select: { id: true, active: true, franchisee: { select: { totemEnabled: true, storeOpen: true } } }
    });

    if (!license || !license.active) {
      return NextResponse.json({ error: "Licença inválida", active: false }, { status: 403 });
    }

    await prisma.totemLicense.update({
      where: { id: payload.licenseId },
      data: {
        lastHeartbeat: new Date(),
        lastIp: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown",
      }
    });

    return NextResponse.json({
      active: license.active,
      storeOpen: license.franchisee.storeOpen,
      totemEnabled: license.franchisee.totemEnabled,
    });
  } catch (err) {
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
