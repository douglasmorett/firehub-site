import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { jwtVerify } from "jose";
import { segredoObrigatorio } from "@/lib/segredos";

// Função, não constante: `segredoObrigatorio` lança quando a variável falta, e
// no topo do módulo isso quebraria o BUILD (o Next avalia os módulos ao gerar
// as páginas). Avaliado só no uso, falha apenas a requisição — e com mensagem.
const obterSegredo = () => new TextEncoder().encode(segredoObrigatorio("NEXTAUTH_SECRET"));

export async function POST(req: NextRequest) {
  try {
    const { token, fingerprint } = await req.json();
    if (!token) return NextResponse.json({ error: "Token obrigatório" }, { status: 400 });

    // Verify JWT
    let payload: any;
    try {
      const result = await jwtVerify(token, obterSegredo());
      payload = result.payload;
    } catch {
      return NextResponse.json({ error: "Token inválido ou expirado" }, { status: 401 });
    }

    const licenseId = payload.licenseId;
    if (!licenseId) return NextResponse.json({ error: "Token inválido" }, { status: 401 });

    // Find license
    const license = await prisma.totemLicense.findUnique({
      where: { id: licenseId },
      include: { franchisee: { select: {
        id: true, storeName: true, name: true, slug: true, storeLogo: true,
        storeBanner: true, storeOpen: true, totemEnabled: true, totemConfig: true,
        storeHours: true, paymentFees: true,
      }}}
    });

    if (!license) return NextResponse.json({ error: "Licença não encontrada" }, { status: 404 });
    if (!license.active) return NextResponse.json({ error: "Licença desativada" }, { status: 403 });
    if (!license.franchisee.totemEnabled) return NextResponse.json({ error: "Módulo Totem desativado" }, { status: 403 });

    // Fingerprint binding
    if (fingerprint) {
      if (license.deviceFingerprint && license.deviceFingerprint !== fingerprint) {
        return NextResponse.json({ 
          error: "Este totem não está autorizado neste dispositivo. Desvincule o dispositivo anterior no painel para usar aqui.",
          code: "DEVICE_MISMATCH" 
        }, { status: 403 });
      }

      // Bind fingerprint on first access
      if (!license.deviceFingerprint) {
        await prisma.totemLicense.update({
          where: { id: licenseId },
          data: {
            deviceFingerprint: fingerprint,
            lastHeartbeat: new Date(),
            lastIp: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown",
            userAgent: req.headers.get("user-agent") || undefined,
          }
        });
      }
    }

    // Update heartbeat
    await prisma.totemLicense.update({
      where: { id: licenseId },
      data: {
        lastHeartbeat: new Date(),
        lastIp: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown",
      }
    });

    return NextResponse.json({
      success: true,
      license: {
        id: license.id,
        label: license.label,
      },
      store: {
        id: license.franchisee.id,
        name: license.franchisee.storeName || license.franchisee.name,
        slug: license.franchisee.slug,
        logo: license.franchisee.storeLogo,
        banner: license.franchisee.storeBanner,
        isOpen: license.franchisee.storeOpen,
        config: license.franchisee.totemConfig,
        hours: license.franchisee.storeHours,
        paymentFees: license.franchisee.paymentFees,
      },
    });
  } catch (err) {
    console.error("[Totem Auth] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
