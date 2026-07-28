import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Cron job que pinga o WhatsApp Gateway no Render a cada 14 minutos
 * para evitar que o plano free desligue por inatividade.
 */
export async function GET() {
  const gatewayUrl = (process.env.EVOLUTION_API_URL || "https://firehub-whatsapp-gateway.onrender.com").replace(/\/$/, "");

  try {
    const res = await fetch(`${gatewayUrl}/`, {
      method: "GET",
      signal: AbortSignal.timeout(15000),
    });

    const status = res.status;
    console.log(`[Keep-Alive] Gateway ping: ${status} (${new Date().toISOString()})`);

    return NextResponse.json({
      status: "ok",
      gatewayStatus: status,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.warn(`[Keep-Alive] Gateway indisponível: ${err.message}`);
    return NextResponse.json({
      status: "error",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
}
