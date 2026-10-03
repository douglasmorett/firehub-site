/**
 * POST /api/store/clientes/cashback — a loja dá ou tira saldo de cashback.
 *
 * Um cliente:
 *   { telefone, nome?, operacao: "dar" | "tirar", valor, motivo?, semVencimento? }
 *   → { ok, saldo } — tirar mais do que o cliente tem é recusado.
 *
 * Uma lista colada ("Importar saldos", lib/lote-de-saldo.ts):
 *   { lote: "<texto colado>", motivo?, semVencimento?, simular: true }  → as linhas lidas, sem gravar
 *   { lote: "<texto colado>", motivo?, semVencimento? }                 → grava as linhas válidas
 *
 * Cada lançamento é uma linha em CashbackAjuste com quem fez e o motivo; o
 * saldo continua calculado (lib/cashback-no-banco.ts).
 */
import { NextResponse } from "next/server";
import { lancarAjuste, lancarCreditosEmLote, VALOR_MAXIMO_DO_LANCAMENTO } from "@/lib/cashback-no-banco";
import { sessaoDosClientes } from "@/lib/clientes-da-loja";
import { lerLote, lerValorEmReais } from "@/lib/lote-de-saldo";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sessao = await sessaoDosClientes();
  if (!sessao) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const motivo = typeof body.motivo === "string" ? body.motivo : null;
  const semVencimento = body.semVencimento === true;

  // ── Lista colada
  if (typeof body.lote === "string") {
    const linhas = lerLote(body.lote, VALOR_MAXIMO_DO_LANCAMENTO);
    const validas = linhas.filter((l) => !l.erro);
    if (body.simular === true) {
      return NextResponse.json({
        linhas,
        validas: validas.length,
        total: Math.round(validas.reduce((t, l) => t + (l.valor || 0), 0) * 100) / 100,
      });
    }
    if (!validas.length) return NextResponse.json({ error: "Nenhuma linha com telefone e valor." }, { status: 400 });

    try {
      const gravadas = await lancarCreditosEmLote(
        sessao.lojaId,
        validas.map((l) => ({ telefone: l.telefone!, valor: l.valor!, nome: l.nome })),
        { motivo: motivo || "Saldo importado", semVencimento, criadoPor: sessao.quem },
      );
      return NextResponse.json({
        ok: true,
        gravadas,
        total: Math.round(validas.reduce((t, l) => t + (l.valor || 0), 0) * 100) / 100,
        ignoradas: linhas.length - validas.length,
      });
    } catch (err: any) {
      // Um INSERT por bloco de 500: se falhou, nada daquele bloco entrou.
      console.error("[clientes] lote falhou:", err?.message);
      return NextResponse.json({ error: "Não foi possível gravar a lista agora. Tente de novo." }, { status: 500 });
    }
  }

  // ── Um cliente
  const operacao = body.operacao === "tirar" ? "tirar" : body.operacao === "dar" ? "dar" : null;
  if (!operacao) return NextResponse.json({ error: "Diga se é para dar ou tirar saldo." }, { status: 400 });
  const valor = Math.round(lerValorEmReais(body.valor) * 100) / 100;
  if (!Number.isFinite(valor) || valor <= 0) return NextResponse.json({ error: "Informe um valor maior que zero." }, { status: 400 });
  if (operacao === "tirar" && !String(motivo || "").trim()) {
    return NextResponse.json({ error: "Diga o motivo de tirar o saldo — fica no extrato do cliente." }, { status: 400 });
  }

  try {
    const r = await lancarAjuste({
      lojaId: sessao.lojaId,
      storeLoyalty: sessao.storeLoyalty,
      telefone: String(body.telefone || ""),
      nome: typeof body.nome === "string" ? body.nome : null,
      valor: operacao === "dar" ? valor : -valor,
      semVencimento,
      motivo,
      criadoPor: sessao.quem,
    });
    if (!r.ok) return NextResponse.json({ error: r.erro, saldo: r.saldo }, { status: 400 });
    return NextResponse.json(r);
  } catch (err: any) {
    console.error("[clientes] lançamento falhou:", err?.message);
    return NextResponse.json({ error: "Não foi possível gravar agora. Tente de novo." }, { status: 500 });
  }
}
