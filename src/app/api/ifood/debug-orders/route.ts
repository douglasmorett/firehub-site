import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const log: string[] = [];
  
  try {
    const clientId = process.env.IFOOD_CLIENT_ID;
    const clientSecret = process.env.IFOOD_CLIENT_SECRET;
    const merchantUuid = process.env.IFOOD_MERCHANT_UUID;
    
    log.push(`CLIENT_ID: ${clientId ? clientId.slice(0, 10) + "..." : "MISSING"}`);
    log.push(`CLIENT_SECRET: ${clientSecret ? clientSecret.slice(0, 5) + "..." : "MISSING"}`);
    log.push(`MERCHANT_UUID: ${merchantUuid ?? "MISSING"}`);
    
    // 1. Get token
    const tokenRes = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grantType: "client_credentials",
        clientId: clientId || "",
        clientSecret: clientSecret || "",
      }),
    });
    const tokenData = await tokenRes.json();
    log.push(`Token status: ${tokenRes.status}`);
    
    if (!tokenData.accessToken) {
      log.push(`Token ERROR: ${JSON.stringify(tokenData)}`);
      return NextResponse.json({ log });
    }
    
    const token = tokenData.accessToken;
    log.push(`Token OK (expires in ${tokenData.expiresIn}s)`);
    
    // 2. Poll events
    const evRes = await fetch("https://merchant-api.ifood.com.br/events/v1.0/events:polling", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const evText = await evRes.text();
    const events = evText ? JSON.parse(evText) : [];
    log.push(`Events polling: ${evRes.status}, count: ${events.length}`);
    
    // Get first orderId
    const firstEvent = events.find((e: any) => e.orderId);
    if (firstEvent) {
      log.push(`First event: code=${firstEvent.code}, orderId=${firstEvent.orderId}`);
      
      // 3. Try to fetch order details
      const orderRes = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/${firstEvent.orderId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const orderText = await orderRes.text();
      log.push(`Order details status: ${orderRes.status}`);
      log.push(`Order details body: ${orderText.slice(0, 500)}`);
    } else {
      log.push("No events with orderId found");
      
      // Try fetching a known order
      if (merchantUuid) {
        const testOrderRes = await fetch(`https://merchant-api.ifood.com.br/order/v1.0/orders/e148bde2-7d05-4093-b512-be251ff5a8e5`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const testText = await testOrderRes.text();
        log.push(`Test order status: ${testOrderRes.status}`);
        log.push(`Test order body: ${testText.slice(0, 500)}`);
      }
    }
    
    // DON'T acknowledge events - just peek
    return NextResponse.json({ log, eventsCount: events.length });
  } catch (err: any) {
    log.push(`ERROR: ${err.message}`);
    return NextResponse.json({ log, error: err.message });
  }
}
