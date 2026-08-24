import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { autenticarTotem, ipDaRequisicao } from "@/lib/totem-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { token, fingerprint } = await req.json().catch(() => ({}));

    const auth = await autenticarTotem(token);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.erro, code: auth.codigo }, { status: auth.status });
    }
    const { licenca } = auth;

    // Vínculo com o aparelho: a licença é de UM totem. Sem isso, o link vaza
    // por WhatsApp e vira cardápio de graça em qualquer celular.
    if (fingerprint) {
      if (licenca.deviceFingerprint && licenca.deviceFingerprint !== fingerprint) {
        return NextResponse.json(
          {
            error:
              "Este totem não está autorizado neste dispositivo. Desvincule o aparelho anterior no painel para usar aqui.",
            code: "DEVICE_MISMATCH",
          },
          { status: 403 }
        );
      }
    }

    // Uma escrita só: vincula o aparelho (na primeira vez) e marca o heartbeat.
    // Antes eram dois `update` seguidos no mesmo registro — o segundo desfazia
    // parte do trabalho do primeiro em ida e volta extra ao banco, e o totem
    // paga esse custo em toda abertura de tela.
    const loja = await prisma.totemLicense
      .update({
        where: { id: licenca.id },
        data: {
          lastHeartbeat: new Date(),
          lastIp: ipDaRequisicao(req),
          ...(fingerprint && !licenca.deviceFingerprint
            ? { deviceFingerprint: fingerprint, userAgent: req.headers.get("user-agent") || undefined }
            : {}),
        },
        select: {
          franchisee: {
            select: {
              id: true,
              storeName: true,
              name: true,
              slug: true,
              storeLogo: true,
              storeBanner: true,
              storeOpen: true,
              totemConfig: true,
              storeHours: true,
              paymentFees: true,
            },
          },
        },
      })
      .then((r) => r.franchisee);

    return NextResponse.json({
      success: true,
      license: { id: licenca.id, label: licenca.label },
      store: {
        id: loja.id,
        name: loja.storeName || loja.name,
        slug: loja.slug,
        logo: loja.storeLogo,
        banner: loja.storeBanner,
        isOpen: loja.storeOpen,
        config: loja.totemConfig,
        hours: loja.storeHours,
        paymentFees: loja.paymentFees,
      },
    });
  } catch (err) {
    console.error("[Totem Auth] Erro:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
