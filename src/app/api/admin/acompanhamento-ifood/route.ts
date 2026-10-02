import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminDaSessao, estruturaPronta, lojasPorId } from "@/lib/acompanhamento-ifood/servidor";
import { situacaoDoRelatorio, limparNumeros } from "@/lib/acompanhamento-ifood/regras";
import { lerDadosDoCliente } from "@/lib/acompanhamento-ifood/dados-do-cliente";

/**
 * GET: os clientes do Acompanhamento iFood, cada um com o último relatório e a
 * situação do relatório do mês passado (lib/acompanhamento-ifood/regras.ts), e
 * as lojas do FireHub para o seletor "usa o FireHub".
 */
export async function GET() {
  if (!(await adminDaSessao())) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await estruturaPronta())) return NextResponse.json({ error: "As tabelas do acompanhamento não estão no banco. Veja o log do boot." }, { status: 503 });

  const [clientes, lojasDoSistema] = await Promise.all([
    prisma.acompanhamentoIfood.findMany({
      orderBy: [{ status: "asc" }, { nome: "asc" }],
      include: {
        relatorios: {
          orderBy: { mes: "desc" },
          select: { id: true, mes: true, status: true, numeros: true, enviadoEm: true },
        },
      },
    }),
    prisma.user.findMany({
      where: { role: "FRANCHISEE" },
      orderBy: { storeName: "asc" },
      select: { id: true, storeName: true, name: true, email: true, city: true, storePhone: true },
    }),
  ]);

  const lojas = await lojasPorId(clientes.map((c) => c.lojaId).filter((x): x is string => !!x));

  return NextResponse.json({
    clientes: clientes.map((c) => {
      const { relatorios, ...resto } = c;
      const ultimo = relatorios[0] || null;
      return {
        ...resto,
        loja: c.lojaId ? lojas.get(c.lojaId) || null : null,
        relatorios: relatorios.length,
        ultimoRelatorio: ultimo && { ...ultimo, numeros: limparNumeros(ultimo.numeros) },
        // Os "Total faturamento" dos relatórios, do mais antigo ao mais novo, para a minilinha.
        serie: relatorios
          .map((r) => ({ mes: r.mes, valor: limparNumeros(r.numeros).totalFaturamento ?? null }))
          .reverse(),
        situacao: situacaoDoRelatorio(c, relatorios),
      };
    }),
    lojasDoSistema: lojasDoSistema.map((l) => ({
      id: l.id, nome: l.storeName || l.name || l.email, cidade: l.city, telefone: l.storePhone,
    })),
  });
}

/** POST: põe um cliente no acompanhamento — loja do FireHub ou alguém de fora. */
export async function POST(req: NextRequest) {
  const admin = await adminDaSessao();
  if (!admin) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await estruturaPronta())) return NextResponse.json({ error: "As tabelas do acompanhamento não estão no banco." }, { status: 503 });

  const lido = await lerDadosDoCliente(await req.json().catch(() => ({})), true);
  if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });

  if (lido.dados.lojaId) {
    const ja = await prisma.acompanhamentoIfood.findUnique({ where: { lojaId: lido.dados.lojaId }, select: { nome: true } });
    if (ja) return NextResponse.json({ error: `Essa loja já está no acompanhamento (${ja.nome}).` }, { status: 409 });
  }

  const cliente = await prisma.acompanhamentoIfood.create({
    data: { ...lido.dados, nome: lido.dados.nome!, criadoPor: admin.email },
  });
  return NextResponse.json({ cliente });
}
