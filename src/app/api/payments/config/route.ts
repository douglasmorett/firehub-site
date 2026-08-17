import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const orderId = url.searchParams.get("orderId");
    const franchiseeSlug = url.searchParams.get("franchiseeSlug");

    let franchiseePublicKey: string | null = null;

    if (orderId) {
      const order = await prisma.customerOrder.findUnique({
        where: { id: orderId },
        select: {
          franchisee: {
            select: { mpAccessToken: true }
          }
        }
      });
      // Se a loja tiver chave própria
    }

    const mpPublicKey =
      franchiseePublicKey ||
      process.env.NEXT_PUBLIC_MP_PUBLIC_KEY ||
      process.env.MP_PUBLIC_KEY ||
      "";

    const hasMp = Boolean(
      process.env.MP_ACCESS_TOKEN ||
      process.env.MERCADO_PAGO_ACCESS_TOKEN ||
      process.env.MERCADOPAGO_ACCESS_TOKEN
    );

    return NextResponse.json({
      mpPublicKey,
      hasMp,
      gateway: "mercadopago"
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
