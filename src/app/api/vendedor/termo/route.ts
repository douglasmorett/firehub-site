import { NextRequest, NextResponse } from "next/server";
import { vendedorDaSessao } from "@/lib/perfil-da-loja/acesso";
import { registrarAceite } from "@/lib/parceiro/aceite-do-termo";

/**
 * POST { aceito: true }: o vendedor logado aceita a versão vigente do termo de
 * comissionamento (lib/parceiro/termo-de-comissionamento.ts). Grava versão,
 * data, IP e navegador. Libera o portal; o pagamento não depende disto.
 */
export async function POST(req: NextRequest) {
  const v = await vendedorDaSessao();
  if (!v.ok) return v.resposta;
  const body = await req.json().catch(() => ({}));
  if (body?.aceito !== true) return NextResponse.json({ error: "Marque que leu e concorda com o termo." }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || null;
  try {
    const aceite = await registrarAceite(v.id, ip, req.headers.get("user-agent"));
    return NextResponse.json({ ok: true, aceite });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "Não deu para registrar o aceite." }, { status: 500 });
  }
}
