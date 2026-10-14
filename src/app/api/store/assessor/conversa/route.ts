import { NextResponse } from "next/server";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { assessorEstaLigado } from "@/lib/assessor/assinatura";
import { lerConversa } from "@/lib/assessor/conversa";

/**
 * GET ?depois=<ISO> — a conversa com o Bill, a MESMA do WhatsApp (lib/assessor/conversa.ts).
 * Com `depois`, só as falas novas: o balão do painel pergunta a cada poucos
 * segundos e mostra o que o dono mandou pelo celular.
 */
export async function GET(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja conversa com o Bill." }, { status: 403 });
  const ligado = await assessorEstaLigado(s.franchiseeId);
  if (!ligado) return NextResponse.json({ ligado: false, falas: [] });
  const depois = new URL(req.url).searchParams.get("depois");
  const quando = depois && !Number.isNaN(Date.parse(depois)) ? new Date(depois) : null;
  return NextResponse.json({ ligado: true, falas: await lerConversa(s.franchiseeId, 40, quando) });
}
