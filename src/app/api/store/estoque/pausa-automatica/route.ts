/**
 * O interruptor "Pausar sozinho o que usa um item quando ele acabar", do topo
 * da tela de Estoque (lib/pausa-pelo-estoque.ts).
 *
 *   GET → { ligado, pausados: [{ produto, faltando: [{ nome, saldo, unidade }] }], pausariaAoLigar, podeMudar }
 *   PUT { ligado } → liga/desliga. Ligar já pausa o que usa item zerado.
 *
 * Ver: quem tem "Estoque". Mudar: o dono (e o ADMIN) — mexe no cardápio da
 * loja inteira, em todos os canais.
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirEstoque } from "@/lib/cmv/acesso";
import { estadoDaPausaPeloEstoque, ligarPausaPeloEstoque } from "@/lib/pausa-pelo-estoque-no-banco";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await exigirEstoque();
  if (!r.ok) return r.resposta;
  try {
    const estado = await estadoDaPausaPeloEstoque(r.acesso.lojaId);
    return NextResponse.json({ ...estado, podeMudar: r.acesso.papel !== "STAFF" });
  } catch (err: any) {
    console.error("[PausaPeloEstoque GET]", err?.message);
    return NextResponse.json({ disponivel: false, ligado: false, pausados: [], pausariaAoLigar: [], podeMudar: false });
  }
}

export async function PUT(req: NextRequest) {
  const r = await exigirEstoque();
  if (!r.ok) return r.resposta;
  if (r.acesso.papel === "STAFF") {
    return NextResponse.json({ error: "Só o dono da loja liga ou desliga a pausa automática." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  if (typeof body?.ligado !== "boolean") return NextResponse.json({ error: "Diga se é para ligar ou desligar." }, { status: 400 });
  try {
    const resultado = await ligarPausaPeloEstoque(r.acesso.lojaId, body.ligado, r.acesso.usuarioId);
    const estado = await estadoDaPausaPeloEstoque(r.acesso.lojaId);
    return NextResponse.json({ ...estado, podeMudar: true, pausadosAgora: resultado.pausados, reativadosAgora: resultado.reativados });
  } catch (err: any) {
    console.error("[PausaPeloEstoque PUT]", err?.message);
    return NextResponse.json({ error: err?.message || "Não consegui salvar. Tente de novo." }, { status: 500 });
  }
}
