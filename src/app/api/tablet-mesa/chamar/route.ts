/**
 * POST /api/tablet-mesa/chamar { motivo: "GARCOM" | "CONTA" }
 *
 * O botão "Chamar garçom" / "Pedir a conta" do tablet da mesa. Fica marcado na
 * tela de Mesas até alguém atender, e toca no celular da loja (app FireHub).
 */
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { tabletEstaLigado } from "@/lib/tablet-da-mesa/assinatura";
import { chamarNaMesa } from "@/lib/tablet-da-mesa/tablets";
import { tabletDaRequisicao } from "@/lib/tablet-da-mesa/no-tablet";
import { avisarChamadoDaMesa } from "@/lib/app-firehub/aviso-de-pedido";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const t = await tabletDaRequisicao();
  if (!t) return NextResponse.json({ error: "Tablet não pareado." }, { status: 401 });
  if (!(await tabletEstaLigado(t.lojaId))) return NextResponse.json({ error: "Chame o garçom." }, { status: 409 });
  const corpo: any = await req.json().catch(() => ({}));
  const motivo = corpo?.motivo === "CONTA" ? "CONTA" : "GARCOM";
  // Criança apertando sem parar: um aviso a cada 30 s por mesa basta.
  if (!checkRateLimit(`tablet-chamar:${t.mesa.id}`, { windowMs: 30_000, maxRequests: 2 }).allowed) {
    return NextResponse.json({ ok: true, repetido: true });
  }
  await chamarNaMesa(t, motivo);
  void avisarChamadoDaMesa(t.lojaId, t.mesa.rotulo || t.mesa.numero, motivo);
  return NextResponse.json({ ok: true });
}
