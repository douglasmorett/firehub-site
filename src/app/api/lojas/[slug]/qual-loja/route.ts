import { NextRequest, NextResponse } from "next/server";
import { avaliarEntrega } from "@/lib/area-de-entrega";
import { lerPontoDaLoja } from "@/lib/ponto-da-loja";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { lojasDoGrupoPeloSlug } from "@/lib/vitrine-do-grupo";
import { distanciaRetaKm, escolherLoja, type ResultadoDaLoja } from "@/lib/escolha-de-loja-do-grupo";

/**
 * POST: qual loja do grupo atende o cliente. Corpo: `{ bairro?, endereco?, lat?, lng? }`.
 *
 * Cada loja responde pela própria área com `avaliarEntrega` — a mesma regra
 * do checkout e do robô (lib/escolha-de-loja-do-grupo.ts explica a escolha).
 * Rota pública que pode ir ao mapa uma vez por loja: limite por IP, e as
 * buscas contam no teto do IP e de cada loja (lib/geocodificacao-servidor.ts).
 */

const LIMITE_POR_IP = { windowMs: 60_000, maxRequests: 20 };
/** As lojas são avaliadas juntas; o cliente não espera o prazo inteiro do checkout. */
const PRAZO_MS = 9000;

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { slug } = await params;
  const ip = getClientIp(req);
  const limite = checkRateLimit(`qual-loja:ip:${ip}`, LIMITE_POR_IP);
  if (!limite.allowed) {
    return NextResponse.json({ error: "Muitas consultas seguidas. Espere alguns segundos." }, { status: 429 });
  }

  const corpo = await req.json().catch(() => ({}));
  const bairro = String(corpo?.bairro || "").trim().slice(0, 120);
  const endereco = String(corpo?.endereco || "").trim().slice(0, 300);
  const lat = Number(corpo?.lat);
  const lng = Number(corpo?.lng);
  const coords = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0) ? { lat, lng } : null;
  if (!bairro && !endereco && !coords) {
    return NextResponse.json({ error: "Diga o bairro, o endereço ou use a localização." }, { status: 400 });
  }

  const lojas = await lojasDoGrupoPeloSlug(slug);
  if (!lojas || lojas.length === 0) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  const resultados: ResultadoDaLoja[] = await Promise.all(
    lojas.map(async (loja) => {
      const v = await avaliarEntrega(
        loja,
        {
          endereco: endereco || bairro,
          bairro: bairro || null,
          coords,
          origemDasCoords: "gps",
          partes: { neighborhood: bairro || undefined, city: loja.city || "" },
        },
        { prazoMs: PRAZO_MS, donos: [`ip:${ip}`, `loja:${loja.id}`] },
      ).catch(() => ({ resultado: "DESCONHECIDO" as const, taxa: null, tempoMin: null }));
      const daLoja = lerPontoDaLoja(loja.storeLatLng);
      const doCliente = coords || ("ponto" in v && v.ponto ? { lat: v.ponto.lat, lng: v.ponto.lng } : null);
      return {
        lojaId: loja.id,
        veredicto: {
          resultado: v.resultado,
          taxa: v.taxa,
          tempoMin: v.tempoMin,
          distanciaKm: "distanciaKm" in v ? v.distanciaKm : undefined,
          bairro: "bairro" in v ? v.bairro : undefined,
        },
        distanciaRetaKm: daLoja && doCliente ? Math.round(distanciaRetaKm(daLoja, doCliente) * 10) / 10 : null,
      };
    }),
  );

  return NextResponse.json({ escolha: escolherLoja(resultados), resultados });
}
