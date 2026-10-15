import { NextRequest } from "next/server";
import { POST as tokenDoOpenDelivery } from "@/app/api/opendelivery/oauth/token/route";

// O mesmo token em <base>/v1/oauth/token, para quem monta a URL a partir da base da API.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return tokenDoOpenDelivery(req);
}
