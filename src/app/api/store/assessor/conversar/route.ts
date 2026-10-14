import { NextResponse } from "next/server";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { assessorEstaLigado } from "@/lib/assessor/assinatura";
import { conversarComOAssessor } from "@/lib/assessor/assessor";

export const runtime = "nodejs";

const MAX_BASE64 = 9 * 1024 * 1024; // o proxy corta acima de 10 MB

function midia(m: any, tipo: "audio" | "image") {
  if (!m || typeof m.base64 !== "string" || !m.base64) return null;
  const mimeType = String(m.mimeType || "").split(";")[0].trim();
  if (!mimeType.startsWith(`${tipo}/`)) return null;
  if (m.base64.length > MAX_BASE64) throw new Error(tipo === "audio" ? "Áudio grande demais: mande um mais curto." : "Foto grande demais.");
  return { base64: m.base64, mimeType };
}

/**
 * POST { texto?, audio?: {base64, mimeType}, imagem?: {base64, mimeType} }
 *
 * O mesmo assessor do WhatsApp, pela tela do painel — para o dono testar antes
 * e para usar do computador. Grava de verdade: é outro canal, não simulação.
 */
export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja usa o Bill." }, { status: 403 });
  if (!(await assessorEstaLigado(s.franchiseeId))) {
    return NextResponse.json({ error: "Ligue o Bill para conversar com ele.", desligado: true }, { status: 402 });
  }
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  try {
    const audio = midia(corpo?.audio, "audio");
    const imagem = midia(corpo?.imagem, "image");
    const texto = String(corpo?.texto || "").slice(0, 2000);
    if (!texto.trim() && !audio && !imagem) return NextResponse.json({ error: "Mande um texto, um áudio ou uma foto." }, { status: 400 });
    const r = await conversarComOAssessor(
      { franchiseeId: s.franchiseeId, usuarioId: s.usuarioId, timezone: s.loja.storeTimezone, canal: "PAINEL", telefone: null },
      { texto, audio, imagem },
    );
    return NextResponse.json({ ok: true, resposta: r.resposta, ouvi: r.ouvi, gravou: r.gravou });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Erro ao conversar." }, { status: 400 });
  }
}
