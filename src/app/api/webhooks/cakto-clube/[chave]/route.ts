/**
 * POST /api/webhooks/cakto-clube/<chave>?s=<segredo> — a Cakto da LOJA avisa
 * cada evento da assinatura do Clube (lib/clube/cakto.ts).
 *
 * `<chave>` é a marca (principal do grupo). A URL inteira, com o `?s=`, é a
 * que o painel mostra para a loja colar na Cakto (Meu aplicativo › Clube).
 * Aceita também o segredo que a Cakto manda no corpo, quando a loja colou ele.
 *
 * Todo corpo fica guardado 30 dias (PayloadDoParceiro, canal "cakto-clube"):
 * no FireCheck a renovação "sumiu" e não havia como ver o que a Cakto mandou.
 * A Cakto não reenvia resposta não-2xx; 500 só em erro nosso, para reenviar à
 * mão pelo painel dela depois de corrigir.
 */
import { NextRequest, NextResponse } from "next/server";
import { lerEventoDaCakto } from "@/lib/clube/cakto";
import { aplicarEventoDaCakto, webhookAutentico } from "@/lib/clube/no-banco";
import { guardarPayloadCru } from "@/lib/open-delivery/payload-cru";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ chave: string }> }) {
  const { chave } = await ctx.params;
  if (!chave || chave.length > 64) return NextResponse.json({ error: "não encontrado" }, { status: 404 });

  const bruto = await req.text().catch(() => "");
  let body: any = null;
  try { body = bruto ? JSON.parse(bruto) : null; } catch { body = null; }

  const daUrl = (req.nextUrl.searchParams.get("s") || "").trim();
  const doCorpo = typeof body?.secret === "string" ? body.secret.trim() : "";
  if (!(await webhookAutentico(chave, daUrl, doCorpo))) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const evento = lerEventoDaCakto(body);
  // Guarda sem o segredo.
  const semSegredo = body && typeof body === "object" ? { ...body, secret: body.secret ? "***" : undefined } : body;
  await guardarPayloadCru({
    canal: "cakto-clube",
    tipo: "webhook",
    idNoParceiro: evento?.pedidoId || evento?.assinaturaId || null,
    franchiseeId: chave,
    payload: semSegredo,
  });
  if (!evento) return NextResponse.json({ ok: true, ignorado: "corpo vazio" });

  console.log(
    `[Clube Cakto] marca=${chave} evento="${evento.evento}" acao=${evento.acao ?? "-"} callback=${evento.callback ? "sim" : "não"} tel=${evento.telefone ? `…${evento.telefone.slice(-4)}` : "?"}`,
  );
  try {
    const r = await aplicarEventoDaCakto(chave, evento);
    return NextResponse.json(r);
  } catch (e: any) {
    console.error("[Clube Cakto] erro ao aplicar evento:", e?.message);
    return NextResponse.json({ error: "erro ao processar" }, { status: 500 });
  }
}
