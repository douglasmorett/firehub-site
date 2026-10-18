import { NextResponse } from "next/server";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { pausarOuReativar } from "@/lib/assessor/cardapio";

/**
 * POST { reativar: "<produtoId>" } — o "volta a esfirra" pelo painel do Bill,
 * no card "Pausados pelo Bill". O mesmo caminho do WhatsApp
 * (lib/assessor/cardapio.ts → pausarOuReativar): a meia pizza do sabor volta
 * junto, a vitrine atualiza e fica um registro REATIVADO no histórico (que o
 * "desfaz" alcança). Pausar continua pela conversa.
 */
export async function POST(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json({ error: "Só o dono da loja mexe no cardápio pelo Bill." }, { status: 403 });
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const id = typeof corpo?.reativar === "string" ? corpo.reativar.trim() : "";
  if (!id) return NextResponse.json({ error: "Diga qual item reativar." }, { status: 400 });
  try {
    const r: any = await pausarOuReativar(
      { produtoIds: [id], ativo: true },
      { franchiseeId: s.franchiseeId, usuarioId: s.usuarioId, timezone: s.loja.storeTimezone, canal: "PAINEL", telefone: null, autor: s.nome },
    );
    if (!r.ok) return NextResponse.json({ error: String(r.erro || "Não deu para reativar.") }, { status: 400 });
    return NextResponse.json({ ok: true, reativados: r.reativados || [], jaEstavam: r.jaEstavamAssim || [] });
  } catch (err: any) {
    console.error("[Bill] reativar pelo painel falhou:", err);
    return NextResponse.json({ error: "Erro ao reativar. Nada foi mexido." }, { status: 500 });
  }
}
