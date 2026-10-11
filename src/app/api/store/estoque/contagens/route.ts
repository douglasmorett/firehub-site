/**
 * /api/store/estoque/contagens — as contagens de estoque da loja.
 *
 *   GET   as últimas contagens e o que está aberto. R$ só para quem vê dados
 *         sensíveis (lib/cmv/acesso.ts): a cozinha conta sem ver valor.
 *   POST  { dia, tipo: "COMPLETA" | "RAPIDA" } abre a contagem do dia (ou
 *         devolve a que já está aberta).
 *
 * A contagem é a base do CMV real (lib/cmv/cmv-real.ts).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirEstoque } from "@/lib/cmv/acesso";
import { ContagemRecusadaError, abrirContagem } from "@/lib/cmv/contagem-no-banco";
import { hojeNaLoja, naLoja, somarDias } from "@/lib/relatorios/base";
import { NOMES_DOS_DIAS_DA_SEMANA, diaQueAContagemFecha, lerSemanaDoCmv } from "@/lib/cmv/semana-do-cmv";

export const dynamic = "force-dynamic";
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const r = await exigirEstoque();
  if (!r.ok) return r.resposta;
  const { lojaId, tz, veDadosSensiveis, goals, storeHours } = r.acesso;

  const [contagens, marcadosNoDia, totalDeInsumos] = await Promise.all([
    prisma.contagemDeEstoque.findMany({
      where: { franchiseeId: lojaId },
      orderBy: { dia: "desc" },
      take: 60,
      include: { _count: { select: { itens: true } }, itens: { select: { contado: true } } },
    }),
    prisma.stockItem.count({ where: { franchiseeId: lojaId, NOT: { active: false }, contagemDiaria: true } }),
    prisma.stockItem.count({ where: { franchiseeId: lojaId, NOT: { active: false } } }),
  ]);

  const agora = new Date();
  const hoje = hojeNaLoja(tz, agora);
  const semana = lerSemanaDoCmv(goals);
  // Dia da semana pelo relógio (não pelo dia operacional): terça às 15h é terça.
  const diaDoRelogio = naLoja(agora, tz).hora < 5 ? somarDias(hoje, 1) : hoje;
  const diaDaSemanaAgora = new Date(`${diaDoRelogio}T12:00:00Z`).getUTCDay();
  return NextResponse.json({
    hoje,
    // O dia que a contagem de agora fecha: antes de abrir, o que está na
    // prateleira é o que sobrou de ontem (lib/cmv/semana-do-cmv.ts).
    diaSugerido: diaQueAContagemFecha(agora, tz, storeHours),
    diaDaCompleta: NOMES_DOS_DIAS_DA_SEMANA[semana.diaDaContagem],
    hojeEDiaDaCompleta: diaDaSemanaAgora === semana.diaDaContagem,
    veDadosSensiveis,
    marcadosNoDia,
    totalDeInsumos,
    contagens: contagens.map((c) => ({
      id: c.id,
      dia: c.dia,
      tipo: c.tipo,
      status: c.status,
      itens: c._count.itens,
      contados: c.itens.filter((i) => i.contado != null).length,
      valorTotal: veDadosSensiveis ? c.valorTotal : null,
      fechadaEm: c.fechadaEm,
    })),
  });
}

export async function POST(req: NextRequest) {
  try {
    const r = await exigirEstoque();
    if (!r.ok) return r.resposta;
    const body = await req.json().catch(() => ({}));
    const dia = String(body?.dia || "");
    const tipo = body?.tipo === "RAPIDA" ? "RAPIDA" : "COMPLETA";
    if (!DIA_RE.test(dia)) return NextResponse.json({ error: "Escolha o dia que a contagem fecha." }, { status: 400 });
    if (dia > hojeNaLoja(r.acesso.tz)) return NextResponse.json({ error: "Não dá para contar um dia que ainda não chegou." }, { status: 400 });

    const contagem = await abrirContagem({ lojaId: r.acesso.lojaId, usuarioId: r.acesso.usuarioId, dia, tipo });
    return NextResponse.json({ success: true, id: contagem.id, status: contagem.status });
  } catch (e: any) {
    if (e instanceof ContagemRecusadaError || e?.name === "ContagemRecusadaError") return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[Contagens POST]", e);
    return NextResponse.json({ error: e?.message || "Erro interno" }, { status: 500 });
  }
}
