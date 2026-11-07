/**
 * PUT /api/store/financeiro/fluxo-de-caixa
 *   { prazos?: { CREDITO: 30, IFOOD: 7, ... }, saldo?: { valor: 1234.5, dia: "AAAA-MM-DD" } | null }
 *
 * O que o Fluxo de caixa e o Contas a receber precisam que só o lojista sabe:
 *   • em quantos dias cada forma e cada app cai na conta (vazio = volta ao
 *     padrão, lib/relatorios/recebiveis.ts);
 *   • o saldo de caixa + banco de um dia, de onde a linha do saldo parte
 *     (null apaga).
 *
 * Mora em `User.financialGoals` (prazosDeRecebimento, saldoDoFluxo) — o Json
 * da configuração financeira que já guarda a comissão dos apps e a meta. NÃO
 * em `paymentFees`, que vai para o cardápio público. A gravação MESCLA: as
 * outras chaves ficam como estão. Grava na loja do DONO (lib/financeiro/contexto.ts:
 * o funcionário só entra com "Financeiro").
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextoDoFinanceiro } from "@/lib/financeiro/contexto";
import { CHAVES_DO_PRAZO, PRAZO_MAXIMO, lerPrazosDeRecebimento } from "@/lib/relatorios/recebiveis";
import { lerSaldoInformado } from "@/lib/relatorios/fluxo-de-caixa";

export const dynamic = "force-dynamic";

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PUT(req: NextRequest) {
  const r = await contextoDoFinanceiro(req.cookies.get("firehub_active_store")?.value);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
  const ctx = r.valor;

  const corpo = await req.json().catch(() => null);
  if (!corpo || typeof corpo !== "object") return NextResponse.json({ error: "Nada para gravar." }, { status: 400 });

  const atual = await prisma.user.findUnique({ where: { id: ctx.donoId }, select: { financialGoals: true } });
  const goals = atual?.financialGoals && typeof atual.financialGoals === "object" && !Array.isArray(atual.financialGoals)
    ? (atual.financialGoals as Record<string, unknown>)
    : {};
  const novo: Record<string, unknown> = { ...goals };

  if (corpo.prazos !== undefined) {
    if (!corpo.prazos || typeof corpo.prazos !== "object") return NextResponse.json({ error: "Prazos inválidos." }, { status: 400 });
    const limpo: Record<string, number> = {};
    for (const chave of CHAVES_DO_PRAZO) {
      const bruto = corpo.prazos[chave];
      if (bruto === undefined || bruto === null || String(bruto).trim() === "") continue;
      const n = Number(String(bruto).trim());
      if (!Number.isInteger(n) || n < 0 || n > PRAZO_MAXIMO) {
        return NextResponse.json({ error: `Prazo inválido: use dias inteiros de 0 a ${PRAZO_MAXIMO}.` }, { status: 400 });
      }
      limpo[chave] = n;
    }
    novo.prazosDeRecebimento = limpo;
  }

  if (corpo.saldo !== undefined) {
    if (corpo.saldo === null) {
      delete novo.saldoDoFluxo;
    } else {
      const valor = Number(corpo.saldo?.valor);
      const dia = String(corpo.saldo?.dia || "");
      if (!Number.isFinite(valor) || Math.abs(valor) > 100_000_000) return NextResponse.json({ error: "Saldo inválido." }, { status: 400 });
      if (!DIA_RE.test(dia) || dia > ctx.hoje) return NextResponse.json({ error: "O dia do saldo tem que ser hoje ou antes." }, { status: 400 });
      novo.saldoDoFluxo = { valor: Math.round(valor * 100) / 100, dia, em: new Date().toISOString() };
    }
  }

  await prisma.user.update({ where: { id: ctx.donoId }, data: { financialGoals: novo as any } });
  return NextResponse.json({ ok: true, prazos: lerPrazosDeRecebimento(novo), saldo: lerSaldoInformado(novo) });
}
