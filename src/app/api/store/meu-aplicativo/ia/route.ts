/**
 * POST /api/store/meu-aplicativo/ia  { objetivo, produtoId?, segmento?, rascunho? }
 *
 * "Escrever com IA" da tela Meu aplicativo: 3 variações curtas de
 * notificação (título + mensagem) com o nome da loja e o produto escolhido,
 * pelo mesmo Gemini do atendimento (lib/atendimento/gemini.ts). Cada
 * variação passa pela mesma conferência do envio (limites de letras). Só o
 * dono, com o plano ligado, e no máximo 20 pedidos por hora por loja.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { appDaConta } from "@/lib/app-da-loja/instalacoes";
import { clienteDoGemini } from "@/lib/atendimento/gemini";
import { OBJETIVOS } from "@/lib/app-da-loja/mensagem";
import { SEGMENTOS } from "@/lib/app-da-loja/segmentos";
import { conferirComposicao, MENSAGEM_MAX } from "@/lib/app-da-loja/regras-do-push";
import { TITULO_IDEAL } from "@/lib/app-da-loja/mensagem";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja usa o Meu aplicativo." }, { status: 403 });
  const app = await appDaConta(s.franchiseeId);
  if (!app?.ativo) return NextResponse.json({ error: "O aplicativo desta loja ainda não está ativo." }, { status: 403 });
  if (!checkRateLimit(`app-loja-ia:${s.franchiseeId}`, { windowMs: 60 * 60_000, maxRequests: 20 }).allowed) {
    return NextResponse.json({ error: "Muitos pedidos à IA nesta hora. Tente daqui a pouco ou use as sugestões prontas." }, { status: 429 });
  }
  const body = await req.json().catch(() => ({} as any));
  const objetivo = OBJETIVOS.find((o) => o.id === body.objetivo) || OBJETIVOS[1];
  const segmento = SEGMENTOS.find((x) => x.tipo === body.segmento) || SEGMENTOS[0];
  const produto = typeof body.produtoId === "string" && body.produtoId
    ? await prisma.menuProduct.findFirst({ where: { id: body.produtoId, franchiseeId: s.franchiseeId }, select: { name: true, price: true, description: true } })
    : null;
  const rascunho = String(body.rascunho || "").slice(0, 300);

  const ai = await clienteDoGemini();
  if (!ai) return NextResponse.json({ error: "A IA não está disponível agora. Use as sugestões prontas." }, { status: 503 });

  const pedido = `Você escreve notificações push de promoção para o aplicativo de delivery de um restaurante brasileiro.
Loja: ${app.nome}
Objetivo: ${objetivo.rotulo}
Para quem: ${segmento.rotulo} — ${segmento.explica}
${produto ? `Produto: ${produto.name} (R$ ${produto.price.toFixed(2).replace(".", ",")})${produto.description ? ` — ${String(produto.description).slice(0, 160)}` : ""}` : "Sem produto específico."}
${rascunho ? `Ideia do dono: ${rascunho}` : ""}
Escreva 3 variações diferentes entre si. Regras:
- título com no máximo ${TITULO_IDEAL} caracteres, começando com 1 emoji; mensagem com no máximo ${Math.min(150, MENSAGEM_MAX)} caracteres;
- um benefício claro e um prazo ("só hoje", "até as 23h"); termine chamando para pedir pelo app;
- português do Brasil, tom simpático, sem MAIÚSCULAS, no máximo 2 emojis no total;
- NÃO invente desconto, preço ou brinde que o dono não disse: se não houver ideia do dono, fale do produto, da novidade ou da saudade, sem prometer valor.
Responda só com JSON: [{"titulo": "...", "mensagem": "..."}, ...]`;

  for (const modelo of ["gemini-3.6-flash", "gemini-2.5-flash"]) {
    try {
      const r = await ai.models.generateContent({
        model: modelo,
        contents: [{ role: "user", parts: [{ text: pedido }] }],
        config: { temperature: 0.9, responseMimeType: "application/json" },
      });
      const lista = JSON.parse(String(r.text || "[]").replace(/^```json|```$/g, "").trim());
      const variacoes = (Array.isArray(lista) ? lista : [])
        .map((v: any) => conferirComposicao({ titulo: v?.titulo, mensagem: v?.mensagem }))
        .filter((v): v is { ok: true; texto: { titulo: string; mensagem: string } } => v.ok)
        .map((v) => v.texto)
        .slice(0, 3);
      if (variacoes.length) return NextResponse.json({ variacoes });
    } catch (err: any) {
      console.warn(`[Meu aplicativo] IA ${modelo} falhou: ${err?.message}`);
    }
  }
  return NextResponse.json({ error: "A IA não respondeu agora. Use as sugestões prontas ou tente de novo." }, { status: 502 });
}
