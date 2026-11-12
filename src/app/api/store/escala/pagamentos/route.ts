/**
 * O controle de pagamento da Escala da equipe — SÓ O DONO (como a diária).
 * Douglas, 12/11/2026: "pagou, ele bota que foi pago… o controle do que
 * pagou, do que não pagou, do que falta".
 *
 * GET  /api/store/escala/pagamentos?de=YYYY-MM-DD&ate=YYYY-MM-DD
 *      — cada inscrição dos turnos do período com o pagamento (ou o acerto do
 *        motoboy que já cobre o dia) e as pessoas com o Pix. As contas
 *        (devido, pago, pendente) a tela faz com resumoDosPagamentos — a mesma
 *        regra do teste.
 * POST { inscricaoIds: [...], valor?, forma?: "pix"|"dinheiro", obs? }
 *      — marca como pago (um turno, ou o "pagar tudo" de uma pessoa). Sem
 *        `valor`, vale a diária combinada de cada turno.
 */
import { NextResponse } from "next/server";
import { ErroDaEscala, itensDePagamento, marcarPago, pessoasDaLoja, turnosDoPeriodo } from "@/lib/escala-da-equipe/banco";
import { agoraDaLoja, dataValida, ehFormaDePagamento, numeroDoDia, periodoDaVisao } from "@/lib/escala-da-equipe/regras";
import { lerCorpo, respostaDoErro, sessaoDaEscala } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

/** Período maior que isto é engano (e pesa no banco). */
const MAX_DIAS = 93;

async function sessaoDoDono() {
  const s = await sessaoDaEscala();
  if (!s.ehDono) throw new ErroDaEscala("Só o dono vê e marca os pagamentos da escala.", 403);
  return s;
}

export async function GET(req: Request) {
  try {
    const s = await sessaoDoDono();
    const url = new URL(req.url);
    const hoje = agoraDaLoja(s.fuso).data;
    let de = url.searchParams.get("de") || "", ate = url.searchParams.get("ate") || "";
    if (!dataValida(de) || !dataValida(ate) || numeroDoDia(ate) < numeroDoDia(de) || numeroDoDia(ate) - numeroDoDia(de) > MAX_DIAS) {
      ({ de, ate } = periodoDaVisao("semana", hoje));
    }
    const [turnos, pessoas] = await Promise.all([turnosDoPeriodo(s.lojaId, de, ate), pessoasDaLoja(s.lojaId, { inativos: true })]);
    const itens = await itensDePagamento(s.lojaId, turnos, pessoas);
    return NextResponse.json({
      hoje, de, ate, fuso: s.fuso,
      itens,
      pessoas: pessoas.map((p) => ({
        tipo: p.tipo, id: p.id, nome: p.nome, funcao: p.funcao, diaria: p.diaria,
        pix: p.pix, pixTipo: p.pixTipo, pixOrigem: p.pixOrigem, pixAtualizadoEm: p.pixAtualizadoEm,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return respostaDoErro(err, "GET pagamentos");
  }
}

export async function POST(req: Request) {
  try {
    const s = await sessaoDoDono();
    const corpo = await lerCorpo(req);
    const ids = Array.isArray(corpo.inscricaoIds) ? corpo.inscricaoIds.map(String) : [];
    const valor = corpo.valor === null || corpo.valor === undefined || corpo.valor === "" ? null : Number(corpo.valor);
    if (valor !== null && !Number.isFinite(valor)) return NextResponse.json({ error: "Valor inválido." }, { status: 400 });
    const pagos = await marcarPago(s.lojaId, {
      inscricaoIds: ids, valor, forma: ehFormaDePagamento(corpo.forma) ? corpo.forma : null, obs: typeof corpo.obs === "string" ? corpo.obs : null,
    }, s.quem, agoraDaLoja(s.fuso).data);
    return NextResponse.json({ ok: true, pagos });
  } catch (err) {
    return respostaDoErro(err, "POST pagamento");
  }
}
