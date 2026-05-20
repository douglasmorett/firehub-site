import { NextResponse } from "next/server";
import { getAsaasKey } from "@/lib/asaas";

export async function GET() {
  const key = getAsaasKey();
  
  if (!key) {
    return NextResponse.json({
      status: "FALHA",
      error: "Nenhuma chave Asaas encontrada",
      env_direct_present: !!process.env.ASAAS_API_KEY,
      env_direct_length: process.env.ASAAS_API_KEY?.length ?? 0,
      env_direct_prefix: process.env.ASAAS_API_KEY?.substring(0, 15) ?? "VAZIO",
      env_b64_present: !!process.env.ASAAS_API_KEY_B64,
      env_b64_length: process.env.ASAAS_API_KEY_B64?.length ?? 0,
    });
  }

  // Testa com chamada real ao Asaas
  const BASE = key.startsWith("$aact_prod")
    ? "https://api.asaas.com/v3"
    : "https://sandbox.asaas.com/v3";

  try {
    const res = await fetch(`${BASE}/customers?limit=1`, {
      headers: {
        "access_token": key,
        "User-Agent": "hakim-portal/1.0",
        "Content-Type": "application/json",
      },
    });
    const data = await res.json();
    
    return NextResponse.json({
      status: res.ok ? "OK" : "ERRO_API",
      http_status: res.status,
      key_length: key.length,
      key_prefix: key.substring(0, 15),
      key_source: process.env.ASAAS_API_KEY_B64 ? "B64" : "DIRECT",
      base_url: BASE,
      asaas_response: res.ok ? { totalCount: data.totalCount } : data,
    });
  } catch (error: any) {
    return NextResponse.json({
      status: "ERRO_REDE",
      error: error.message,
      key_length: key.length,
      key_prefix: key.substring(0, 15),
    });
  }
}
