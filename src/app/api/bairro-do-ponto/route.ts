/**
 * GET /api/bairro-do-ponto?franchiseeId=…&lat=…&lng=…
 *
 * O bairro OFICIAL do ponto do cliente (GPS do "usar minha localização" ou
 * pino), pela base do IBGE do município da loja (lib/enderecos-ibge-servidor.ts,
 * bairroNoIbgePeloPonto). `{ bairro: null }` = município não importado ou
 * nenhum endereço do IBGE perto — o checkout segue com o nome do mapa.
 *
 * Divinos (Cabo Frio, pedido 29 de 07/11/2026): o reverse do OSM chama de
 * "Gamboa" quem mora no Monte Alegre, e esse nome ia para o pedido.
 *
 * Só lê o banco (sem serviço de terceiro); o limite por IP é o do frete.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bairroNoIbgePeloPonto } from "@/lib/enderecos-ibge-servidor";
import { estadoPeloEndereco } from "@/lib/geocodificacao";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const franchiseeId = q.get("franchiseeId") || "";
  const lat = Number(q.get("lat"));
  const lng = Number(q.get("lng"));
  if (!franchiseeId || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ bairro: null }, { status: 400 });
  }
  const r = checkRateLimit(`bairro-do-ponto:ip:${getClientIp(req)}`, { windowMs: 60_000, maxRequests: 20 });
  if (!r.allowed) return NextResponse.json({ bairro: null }, { status: 429 });

  const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { city: true, storeAddress: true } }).catch(() => null);
  if (!loja?.city) return NextResponse.json({ bairro: null });
  const bairro = await bairroNoIbgePeloPonto({ ponto: { lat, lng }, cidade: loja.city, uf: estadoPeloEndereco(loja.storeAddress) });
  return NextResponse.json({ bairro });
}
