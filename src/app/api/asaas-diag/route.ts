import { NextResponse } from "next/server";

export async function GET() {
  const rawDirect = process.env.ASAAS_API_KEY || "";
  const rawB64 = process.env.ASAAS_API_KEY_B64 || "";
  
  // Show character-level analysis
  const directChars = rawDirect.split('').map((c, i) => `${i}:${c.charCodeAt(0)}(${c === '$' ? 'DOLLAR' : c})`);
  
  // Check if B64 decodes properly
  let decodedB64 = "";
  let b64Error = "";
  try {
    if (rawB64) {
      decodedB64 = Buffer.from(rawB64, "base64").toString("utf8");
    }
  } catch (e: any) {
    b64Error = e.message;
  }

  // Test both keys against Asaas
  const testKey = async (label: string, key: string) => {
    if (!key) return { label, error: "empty" };
    const base = key.startsWith("$aact_prod") || key.startsWith("aact_prod")
      ? "https://api.asaas.com/v3"
      : "https://sandbox.asaas.com/v3";
    try {
      const finalKey = key.startsWith("aact_") ? "$" + key : key;
      const res = await fetch(`${base}/customers?limit=1`, {
        headers: { "access_token": finalKey, "Content-Type": "application/json" }
      });
      const data = await res.json();
      return { label, status: res.status, ok: res.ok, keyLen: finalKey.length, keyStart: finalKey.substring(0, 20), keyEnd: finalKey.substring(finalKey.length - 20), response: res.ok ? "SUCCESS" : data };
    } catch (e: any) {
      return { label, error: e.message };
    }
  };

  const directTest = await testKey("DIRECT", rawDirect);
  const b64Test = await testKey("B64_DECODED", decodedB64);

  return NextResponse.json({
    env_direct: {
      present: !!rawDirect,
      length: rawDirect.length,
      first20: rawDirect.substring(0, 20),
      last20: rawDirect.substring(rawDirect.length - 20),
      hasDollarAt0: rawDirect.charAt(0) === '$',
      dollarPositions: rawDirect.split('').reduce((acc: number[], c, i) => { if (c === '$') acc.push(i); return acc; }, []),
      containsColonColon: rawDirect.includes('::'),
    },
    env_b64: {
      present: !!rawB64,
      length: rawB64.length,
      first20: rawB64.substring(0, 20),
      decoded_length: decodedB64.length,
      decoded_first20: decodedB64.substring(0, 20),
      decoded_last20: decodedB64.substring(decodedB64.length - 20),
      decode_error: b64Error || null,
    },
    tests: { directTest, b64Test }
  });
}
