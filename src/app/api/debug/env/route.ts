import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  // Verificar lojas JotaJá no banco
  let jotajaStores: any[] = [];
  try {
    jotajaStores = await prisma.user.findMany({
      where: { jotajaConnected: true },
      select: { 
        id: true, email: true, storeName: true,
        jotajaMerchantId: true,
        jotajaClientId: true,
      },
    });
  } catch (e: any) {
    jotajaStores = [{ error: e.message }];
  }

  return NextResponse.json({ 
    dbUrl: process.env.DATABASE_URL?.split('@')[1] || "none",
    jotaja: {
      envClientId: process.env.JOTAJA_CLIENT_ID ? `${process.env.JOTAJA_CLIENT_ID.substring(0, 8)}...` : "NOT_SET",
      envClientSecret: process.env.JOTAJA_CLIENT_SECRET ? "SET" : "NOT_SET",
      envMerchantId: process.env.JOTAJA_MERCHANT_ID || "NOT_SET",
      cronSecret: process.env.CRON_SECRET ? `SET (${process.env.CRON_SECRET.length} chars)` : "NOT_SET",
      storesInDb: jotajaStores.map((s: any) => ({
        email: s.email,
        storeName: s.storeName,
        merchantId: s.jotajaMerchantId,
        hasClientId: !!s.jotajaClientId,
      })),
    },
    nodeEnv: process.env.NODE_ENV,
  });
}
