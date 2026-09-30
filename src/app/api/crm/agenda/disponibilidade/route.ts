import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { disponibilidadesDos, salvarDisponibilidade } from "@/lib/crm/agenda-servidor";

export const dynamic = "force-dynamic";

/**
 * GET ?vendedorId= / PUT { vendedorId?, config }: os horários da semana de um
 * vendedor (as faixas de onde saem as vagas). O vendedor edita os dele; o
 * admin, os de qualquer um.
 */
export async function GET(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });
  const vendedorId = quem.tipo === "VENDEDOR" ? quem.id : req.nextUrl.searchParams.get("vendedorId") || "";
  if (!vendedorId) return NextResponse.json({ error: "Informe o vendedor." }, { status: 400 });
  const disp = await disponibilidadesDos([vendedorId]);
  const linha = await prisma.agendaDisponibilidade.findUnique({ where: { vendedorId }, select: { atualizadoEm: true } });
  return NextResponse.json({ vendedorId, config: disp.get(vendedorId), personalizada: !!linha });
}

export async function PUT(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const vendedorId = quem.tipo === "VENDEDOR" ? quem.id : String(b.vendedorId || "");
  if (!vendedorId) return NextResponse.json({ error: "Informe o vendedor." }, { status: 400 });
  const v = await prisma.ambassador.findUnique({ where: { id: vendedorId }, select: { isVendedor: true } });
  if (!v?.isVendedor) return NextResponse.json({ error: "Vendedor não encontrado." }, { status: 404 });
  const config = await salvarDisponibilidade(vendedorId, b.config);
  return NextResponse.json({ vendedorId, config, personalizada: true });
}
