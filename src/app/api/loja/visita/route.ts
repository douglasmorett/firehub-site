/**
 * POST /api/loja/visita — o cardápio público avisa por onde a pessoa anda
 * (lib/funil-do-site.ts). Público e sem login, como o próprio cardápio.
 *
 * Corpo: { slug, sessao, etapa: "visita"|"produto"|"carrinho"|"checkout"|"pedido"|"batida", utm?, referrer? }
 * Chega por navigator.sendBeacon (text/plain), então o corpo é lido como texto.
 * Responde 204 sempre que o pedido é válido: o cardápio não espera nem mostra nada.
 */
import { NextRequest, NextResponse } from "next/server";
import { registrarVisita } from "@/lib/funil-do-site";
import { dispositivoDaVisita, ehEtapa, ehRobo, origemDaVisita } from "@/lib/funil-do-site-regras";

export const dynamic = "force-dynamic";

const SESSAO = /^[a-z0-9-]{8,64}$/i;
const SLUG = /^[a-z0-9-]{1,80}$/i;

export async function POST(req: NextRequest) {
  const ua = req.headers.get("user-agent");
  if (ehRobo(ua)) return new NextResponse(null, { status: 204 });

  let body: any = null;
  try { body = JSON.parse(await req.text()); } catch { /* corpo torto */ }
  const slug = String(body?.slug ?? "");
  const sessao = String(body?.sessao ?? "");
  const etapa = body?.etapa === "batida" ? "batida" : ehEtapa(body?.etapa) ? body.etapa : null;
  if (!SLUG.test(slug) || !SESSAO.test(sessao) || !etapa) return NextResponse.json({ error: "Visita inválida" }, { status: 400 });

  try {
    await registrarVisita({
      slug,
      sessao,
      etapa,
      origem: origemDaVisita({ utm: String(body?.utm ?? "").slice(0, 80), referrer: String(body?.referrer ?? "").slice(0, 300), host: req.headers.get("host") }),
      dispositivo: dispositivoDaVisita(ua),
    });
  } catch (err: any) {
    console.error("[Funil] visita não gravou:", err?.message || err);
  }
  return new NextResponse(null, { status: 204 });
}
