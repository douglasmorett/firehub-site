import { NextResponse } from "next/server";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { lerFiltrosDoHistorico } from "@/lib/assessor/painel";
import { hojeNaLoja } from "@/lib/relatorios/base";
import { historicoDoBill } from "@/lib/assessor/painel-servidor";
import { desfazerRegistroDoBill } from "@/lib/assessor/ferramentas";
import { CompraRecusadaError } from "@/lib/cmv/lancar-compra";

/**
 * GET — o histórico do que o Bill lançou, do mais novo para o mais antigo.
 *   ?tipo=COMPRA,DESPESA  ?canal=WHATSAPP|PAINEL  ?periodo=hoje|ontem|7d|30d|mes|mesAnterior
 *   ou ?de=YYYY-MM-DD&ate=YYYY-MM-DD (dias de operação da loja, vira às 5h)  ?q=texto  ?desfeitos=nao  ?cursor=<proximo>  ?limite=30
 *   → { registros, proximo, ultimoDesfazivelId }
 *
 * POST { desfazer: "<id>" } — o "desfaz" do WhatsApp pelo painel: só o
 * lançamento mais novo ainda não desfeito (ferramentas.ts → desfazerRegistroDoBill).
 */
export async function GET(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja abre o Bill." }, { status: 403 });
  const filtros = lerFiltrosDoHistorico(new URL(req.url).searchParams, hojeNaLoja(s.loja.storeTimezone));
  try {
    return NextResponse.json(await historicoDoBill(s.franchiseeId, s.loja.storeTimezone, filtros));
  } catch (err: any) {
    console.error("[Bill] histórico falhou:", err?.message);
    return NextResponse.json({ error: "Não consegui carregar o histórico agora." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja desfaz lançamentos do Bill." }, { status: 403 });
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const id = typeof corpo?.desfazer === "string" ? corpo.desfazer.trim() : "";
  if (!id) return NextResponse.json({ error: "Diga qual lançamento desfazer." }, { status: 400 });
  try {
    const r = await desfazerRegistroDoBill(
      { franchiseeId: s.franchiseeId, usuarioId: s.usuarioId, timezone: s.loja.storeTimezone, canal: "PAINEL", telefone: null, autor: s.nome },
      id,
    );
    if (!r.ok) return NextResponse.json({ error: String(r.erro || "Não deu para desfazer.") }, { status: 409 });
    return NextResponse.json({ ok: true, desfeito: r.desfeito });
  } catch (err: any) {
    if (err instanceof CompraRecusadaError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error("[Bill] desfazer pelo painel falhou:", err);
    return NextResponse.json({ error: "Erro ao desfazer. Nada foi mexido." }, { status: 500 });
  }
}
