import { NextRequest, NextResponse } from "next/server";
import { decifrar } from "@/lib/cofre";
import { emitirToken, lerPedidoDeToken, mesmoTexto } from "@/lib/open-delivery-saida/credenciais";
import { integracaoPorClientId } from "@/lib/open-delivery-saida/eventos";
import { chaveDoToken } from "@/lib/open-delivery-saida/acesso";

/**
 * POST /api/opendelivery/oauth/token — OAuth2 client_credentials do Open Delivery.
 *
 * A logística (Bem Dito) manda grant_type=client_credentials, client_id e
 * client_secret (form-urlencoded; JSON e Basic também valem) e recebe o
 * Bearer que abre /api/opendelivery/v1/* daquela loja.
 *
 * O mesmo handler responde em /api/opendelivery/v1/oauth/token.
 */
export const dynamic = "force-dynamic";

const erro = (status: number, error: string, title: string) =>
  NextResponse.json({ error, title, status }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  const corpo = await req.text().catch(() => "");
  const p = lerPedidoDeToken(req.headers.get("content-type") || "", corpo, req.headers.get("authorization"));

  if (p.grantType !== "client_credentials") {
    return erro(400, "unsupported_grant_type", "grant_type precisa ser client_credentials.");
  }
  if (!p.clientId || !p.clientSecret) return erro(401, "invalid_client", "client_id e client_secret são obrigatórios.");

  const integ = await integracaoPorClientId(p.clientId);
  const segredo = integ ? decifrar(integ.clientSecretCifrado) : null;
  if (!integ || !integ.ativo || !segredo || !mesmoTexto(segredo, p.clientSecret)) {
    return erro(401, "invalid_client", "Credenciais inválidas ou integração desligada.");
  }

  const { token, expiraEmS } = emitirToken(chaveDoToken(), integ.id, integ.clientSecretCifrado);
  return NextResponse.json(
    { access_token: token, token_type: "bearer", expires_in: expiraEmS },
    { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
  );
}
