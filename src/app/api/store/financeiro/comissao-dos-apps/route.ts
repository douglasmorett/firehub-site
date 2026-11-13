/**
 * PUT /api/store/financeiro/comissao-dos-apps
 *   { comissoes: { IFOOD: 23, "99FOOD": 12, ... },
 *     taxas?: { IFOOD: { pagamentoOnline: 3.2, outras: 0 }, ... } }
 *
 * O que cada app cobra DA LOJA — o DRE usa para a linha "(-) Comissão e
 * taxas dos apps": a comissão sobre os itens (todo pedido), o pagamento
 * online (só no pedido pago dentro do app) e outras taxas/antecipação (ver
 * "COMISSÃO DOS APPS" em lib/financeiro/dre.ts). Sem a comissão o DRE não
 * inventa um número: mostra "comissão não configurada" e o resultado como
 * incompleto.
 *
 * A comissão continua em `comissaoDosApps` (a loja que cadastrou o percentual
 * único antes de 13/11/2026 segue com a mesma conta); o pagamento online e as
 * outras moram em `taxasDosApps`. Sem `taxas` no corpo (tela antiga aberta),
 * `taxasDosApps` fica como está.
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
import { CANAIS_COM_COMISSAO, lerComissoesDosApps, lerTaxasDosApps } from "@/lib/financeiro/dre";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const r = await contextoDoFinanceiro(req.cookies.get("firehub_active_store")?.value);
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status });
  const ctx = r.valor;

  const corpo = await req.json().catch(() => null);
  const pedido = corpo?.comissoes && typeof corpo.comissoes === "object" ? corpo.comissoes : null;
  if (!pedido) return NextResponse.json({ error: "Informe os percentuais." }, { status: 400 });

  // Só canais de app; percentual de 0 a 100. Vazio = "não sei" (apaga).
  const lerPct = (bruto: unknown): number | null | "invalido" => {
    if (bruto === undefined || bruto === null || bruto === "") return null;
    const v = Number(String(bruto).replace(",", "."));
    if (!Number.isFinite(v) || v < 0 || v > 100) return "invalido";
    return Math.round(v * 100) / 100;
  };
  const taxasPedidas = corpo?.taxas && typeof corpo.taxas === "object" ? corpo.taxas : null;
  const limpo: Record<string, number> = {};
  const taxasLimpas: Record<string, { pagamentoOnline: number; outras: number }> = {};
  for (const { chave, nome } of CANAIS_COM_COMISSAO) {
    const v = lerPct(pedido[chave]);
    if (v === "invalido") return NextResponse.json({ error: `Percentual do ${nome} inválido: use um número de 0 a 100.` }, { status: 400 });
    if (v !== null) limpo[chave] = v;
    if (!taxasPedidas) continue;
    const t = taxasPedidas[chave] && typeof taxasPedidas[chave] === "object" ? taxasPedidas[chave] : {};
    const online = lerPct(t.pagamentoOnline);
    const outras = lerPct(t.outras);
    if (online === "invalido") return NextResponse.json({ error: `Pagamento online do ${nome} inválido: use um número de 0 a 100.` }, { status: 400 });
    if (outras === "invalido") return NextResponse.json({ error: `Outras taxas do ${nome} inválidas: use um número de 0 a 100.` }, { status: 400 });
    // App salvo pela tela nova com algum percentual = já separou (some o aviso
    // do percentual único); vazio em tudo = não usa o app.
    if (v !== null || online !== null || outras !== null) taxasLimpas[chave] = { pagamentoOnline: online ?? 0, outras: outras ?? 0 };
  }

  const atual = await prisma.user.findUnique({ where: { id: ctx.donoId }, select: { financialGoals: true } });
  const goals = atual?.financialGoals && typeof atual.financialGoals === "object" && !Array.isArray(atual.financialGoals)
    ? (atual.financialGoals as Record<string, unknown>)
    : {};
  const novo = taxasPedidas ? { ...goals, comissaoDosApps: limpo, taxasDosApps: taxasLimpas } : { ...goals, comissaoDosApps: limpo };
  await prisma.user.update({ where: { id: ctx.donoId }, data: { financialGoals: novo as any } });

  return NextResponse.json({ ok: true, comissoes: lerComissoesDosApps(novo), taxas: lerTaxasDosApps(novo) });
}
