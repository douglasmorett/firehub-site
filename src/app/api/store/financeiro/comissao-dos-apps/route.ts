/**
 * PUT /api/store/financeiro/comissao-dos-apps  { comissoes: { IFOOD: 23, "99FOOD": 12, ... } }
 *
 * O percentual de comissão + taxas que cada app cobra DA LOJA — o DRE usa
 * para a linha "(-) Comissão e taxas dos apps". Sem ele o DRE não inventa um
 * número: mostra "comissão não configurada" e o resultado como incompleto.
 *
 * Mora em `User.financialGoals.comissaoDosApps` (campo JSON que já existe: a
 * configuração financeira da loja). NÃO em `paymentFees` nem em
 * `deliveryConfig`: esses dois vão para o cardápio público, e a comissão que a
 * loja negociou com o iFood não é assunto do cliente.
 *
 * A gravação MESCLA: as outras chaves de `financialGoals` (a meta de
 * faturamento do relatório Faturamento por dia) ficam como estão. Grava na
 * loja do DONO — o funcionário com "Financeiro" mexe na loja, não na conta dele.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextoDoFinanceiro } from "@/lib/financeiro/contexto";
import { CANAIS_COM_COMISSAO, lerComissoesDosApps } from "@/lib/financeiro/dre";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const r = await contextoDoFinanceiro(req.cookies.get("firehub_active_store")?.value);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
  const ctx = r.valor;

  const corpo = await req.json().catch(() => null);
  const pedido = corpo?.comissoes && typeof corpo.comissoes === "object" ? corpo.comissoes : null;
  if (!pedido) return NextResponse.json({ error: "Informe os percentuais." }, { status: 400 });

  // Só canais de app; percentual de 0 a 100. Vazio = "não sei" (apaga).
  const limpo: Record<string, number> = {};
  for (const { chave, nome } of CANAIS_COM_COMISSAO) {
    const bruto = pedido[chave];
    if (bruto === undefined || bruto === null || bruto === "") continue;
    const v = Number(String(bruto).replace(",", "."));
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return NextResponse.json({ error: `Percentual do ${nome} inválido: use um número de 0 a 100.` }, { status: 400 });
    }
    limpo[chave] = Math.round(v * 100) / 100;
  }

  const atual = await prisma.user.findUnique({ where: { id: ctx.donoId }, select: { financialGoals: true } });
  const goals = atual?.financialGoals && typeof atual.financialGoals === "object" && !Array.isArray(atual.financialGoals)
    ? (atual.financialGoals as Record<string, unknown>)
    : {};
  const novo = { ...goals, comissaoDosApps: limpo };
  await prisma.user.update({ where: { id: ctx.donoId }, data: { financialGoals: novo as any } });

  return NextResponse.json({ ok: true, comissoes: lerComissoesDosApps(novo) });
}
