import { NextResponse } from "next/server";
import { getAsaasKey } from "@/lib/asaas";

export async function GET() {
  // Test using the actual getAsaasKey function (includes hardcoded fallback)
  const key = getAsaasKey();
  
  if (!key) {
    return NextResponse.json({ status: "FALHA", error: "getAsaasKey() returned null" });
  }

  const BASE = key.startsWith("$aact_prod")
    ? "https://api.asaas.com/v3"
    : "https://sandbox.asaas.com/v3";

  try {
    const res = await fetch(`${BASE}/customers?limit=1`, {
      headers: {
        "access_token": key,
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();
    
    return NextResponse.json({
      status: res.ok ? "OK" : "ERRO",
      http_status: res.status,
      key_length: key.length,
      key_end: key.substring(key.length - 10),
      env_direct_present: !!process.env.ASAAS_API_KEY,
      env_b64_present: !!process.env.ASAAS_API_KEY_B64,
      used_fallback: !process.env.ASAAS_API_KEY_B64 && (
        !process.env.ASAAS_API_KEY || 
        key.substring(key.length - 10) !== (process.env.ASAAS_API_KEY?.substring((process.env.ASAAS_API_KEY?.length || 0) - 10) || "")
      ),
      asaas_response: res.ok ? { totalCount: data.totalCount, firstCustomer: data.data?.[0]?.name } : data,
    });
  } catch (error: any) {
    return NextResponse.json({ status: "ERRO_REDE", error: error.message });
  }
}
