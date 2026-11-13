/**
 * A venda do caixa de mercado (lib/caixa-mercado/venda.ts).
 * POST  { itens, descontoCentavos?, pagamentos, pixTxid?, cpfCnpj?, itensCancelados? }
 *       — grava. Com desconto, a trava "Dar desconto" da senha do gerente.
 *       Com parte no pinpad (forma TEF): o pedido espera o Assistente.
 * PATCH { orderId, pagamentos } — o pinpad recusou: outra forma (ou outro valor no pinpad).
 *       { orderId, cancelar: true } — desiste da venda que esperava o pinpad.
 * GET   ?orderId= — a situação (o caixa consulta depois do "aprovado" do pinpad).
 */
import { NextResponse } from "next/server";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { turnoAberto } from "@/lib/caixa-mercado/turno";
import { cancelarVendaPendente, registrarVendaDoCaixa, situacaoDaVenda, trocarFormaDaVendaPendente } from "@/lib/caixa-mercado/venda";
import { exigirSenhaDoGerente } from "@/lib/senha-do-gerente";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await contextoDoCaixa({ exigirTerminal: true });
  if (ehResposta(ctx)) return ctx;
  const turno = await turnoAberto(ctx.terminal!.id);
  if (!turno) return NextResponse.json({ error: "Abra o turno deste caixa antes de vender." }, { status: 409 });
  const corpo: any = await req.json().catch(() => ({}));
  if (Math.round(Number(corpo?.descontoCentavos) || 0) > 0) {
    const semSenha = await exigirSenhaDoGerente(req, ctx.quem.lojaId, "darDesconto");
    if (semSenha) return semSenha;
  }
  const r = await registrarVendaDoCaixa({ quem: ctx.quem, terminal: ctx.terminal!, turno, corpo });
  return NextResponse.json(r.corpo, { status: r.status });
}

export async function PATCH(req: Request) {
  const ctx = await contextoDoCaixa({ exigirTerminal: true });
  if (ehResposta(ctx)) return ctx;
  const corpo: any = await req.json().catch(() => ({}));
  const orderId = String(corpo?.orderId || "");
  if (!orderId) return NextResponse.json({ error: "orderId obrigatório." }, { status: 400 });
  const r = corpo?.cancelar === true
    ? await cancelarVendaPendente(orderId, ctx.terminal!, ctx.quem)
    : await trocarFormaDaVendaPendente(orderId, ctx.terminal!, (Array.isArray(corpo?.pagamentos) ? corpo.pagamentos : []).map((p: any) => ({ forma: String(p?.forma || ""), valorCentavos: Math.round(Number(p?.valorCentavos)) })));
  return NextResponse.json(r.corpo, { status: r.status });
}

export async function GET(req: Request) {
  const ctx = await contextoDoCaixa({ exigirTerminal: true });
  if (ehResposta(ctx)) return ctx;
  const orderId = new URL(req.url).searchParams.get("orderId") || "";
  const s = await situacaoDaVenda(orderId, ctx.terminal!);
  return s ? NextResponse.json(s) : NextResponse.json({ error: "Venda não encontrada." }, { status: 404 });
}
