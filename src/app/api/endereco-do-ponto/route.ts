/**
 * GET /api/endereco-do-ponto?franchiseeId=…&lat=…&lng=…
 *
 * Rua, número e bairro OFICIAIS do ponto do cliente (GPS do "usar minha
 * localização" ou pino), pela base do IBGE do município da loja
 * (lib/enderecos-ibge-servidor.ts, enderecoNoIbgePeloPonto).
 *
 *   { rua, numero, bairro, fonte: "ibge", municipioTemBase }
 *
 * `municipioTemBase` true = a tela NÃO usa o nome do OSM: campo sem resposta
 * do IBGE fica vazio para o cliente digitar. false = a cidade não tem base e
 * o checkout segue com o mapa, como antes.
 *
 * Divinos (Cabo Frio, pedido 29 de 07/11/2026): o reverse do OSM chama de
 * "Gamboa" quem mora no Monte Alegre, e esse nome ia para o pedido.
 *
 * Só lê o banco (sem serviço de terceiro); prazo de 2,5 s e limite por IP.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enderecoNoIbgePeloPonto } from "@/lib/enderecos-ibge-servidor";
import { estadoPeloEndereco } from "@/lib/geocodificacao";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const SEM_BASE = { rua: null, numero: null, bairro: null, fonte: "ibge", municipioTemBase: false } as const;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const franchiseeId = q.get("franchiseeId") || "";
  const lat = Number(q.get("lat"));
  const lng = Number(q.get("lng"));
  if (!franchiseeId || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json(SEM_BASE, { status: 400 });
  }
  const r = checkRateLimit(`endereco-do-ponto:ip:${getClientIp(req)}`, { windowMs: 60_000, maxRequests: 20 });
  if (!r.allowed) return NextResponse.json(SEM_BASE, { status: 429 });

  const loja = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { city: true, storeAddress: true } }).catch(() => null);
  if (!loja?.city) return NextResponse.json(SEM_BASE);
  const e = await enderecoNoIbgePeloPonto({ ponto: { lat, lng }, cidade: loja.city, uf: estadoPeloEndereco(loja.storeAddress) });
  return NextResponse.json({ ...e, fonte: "ibge" });
}
