import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirCotacao } from "@/lib/cotacao/sessao";
import { conferirFornecedor, type FornecedorConferido } from "@/lib/cotacao/cadastro";
import { fornecedoresDaLoja } from "@/lib/cotacao/no-banco";
import { esquecerFornecedoresDaLoja } from "@/lib/cotacao/do-fornecedor";

/**
 * Os fornecedores da loja.
 *   GET                         a lista
 *   POST { fornecedor }         cadastra um
 *   POST { lista: [...] }       cadastra vários (o "colar lista" da tela)
 *   PUT  { id, ...campos }      edita
 *   DELETE ?id=                 apaga o fornecedor e os preços dele
 *
 * O WhatsApp é único por loja: é por ele que o robô sabe que a mensagem é de
 * fornecedor, e dois cadastros com o mesmo número deixariam a dúvida de quem é.
 */
export const dynamic = "force-dynamic";

async function telefoneEmUso(franchiseeId: string, canonico: string | null, menosId?: string) {
  if (!canonico) return null;
  return prisma.fornecedor.findFirst({ where: { franchiseeId, telefoneCanonico: canonico, ...(menosId ? { id: { not: menosId } } : {}) }, select: { nome: true } });
}

export async function GET() {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  return NextResponse.json({ fornecedores: await fornecedoresDaLoja(r.s.franchiseeId) });
}

export async function POST(req: NextRequest) {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const entradas: any[] = Array.isArray(corpo?.lista) ? corpo.lista.slice(0, 200) : [corpo?.fornecedor];

  const conferidos: FornecedorConferido[] = [];
  const recusados: string[] = [];
  const vistos = new Set<string>();
  for (const e of entradas) {
    const c = conferirFornecedor(e);
    if (!c.ok) { recusados.push(c.erro); continue; }
    if (c.dados.telefoneCanonico) {
      const dono = vistos.has(c.dados.telefoneCanonico) ? { nome: "outro da lista" } : await telefoneEmUso(loja, c.dados.telefoneCanonico);
      if (dono) { recusados.push(`O WhatsApp de ${c.dados.nome} já está no fornecedor ${dono.nome}.`); continue; }
      vistos.add(c.dados.telefoneCanonico);
    }
    conferidos.push(c.dados);
  }
  if (!conferidos.length) return NextResponse.json({ error: recusados[0] || "Nada para cadastrar.", recusados }, { status: 400 });
  await prisma.fornecedor.createMany({ data: conferidos.map((d) => ({ ...d, franchiseeId: loja })) });
  esquecerFornecedoresDaLoja(loja);
  return NextResponse.json({ ok: true, cadastrados: conferidos.length, recusados, fornecedores: await fornecedoresDaLoja(loja) });
}

export async function PUT(req: NextRequest) {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  let corpo: any = {};
  try { corpo = await req.json(); } catch {}
  const id = String(corpo?.id || "");
  const atual = id ? await prisma.fornecedor.findFirst({ where: { id, franchiseeId: loja } }) : null;
  if (!atual) return NextResponse.json({ error: "Fornecedor não encontrado." }, { status: 404 });
  const c = conferirFornecedor(corpo);
  if (!c.ok) return NextResponse.json({ error: c.erro }, { status: 400 });
  const dono = await telefoneEmUso(loja, c.dados.telefoneCanonico, id);
  if (dono) return NextResponse.json({ error: `Esse WhatsApp já está no fornecedor ${dono.nome}.` }, { status: 400 });
  await prisma.fornecedor.update({ where: { id }, data: { ...c.dados, atualizadoEm: new Date() } });
  esquecerFornecedoresDaLoja(loja);
  return NextResponse.json({ ok: true, fornecedores: await fornecedoresDaLoja(loja) });
}

export async function DELETE(req: NextRequest) {
  const r = await exigirCotacao();
  if (!r.ok) return r.resposta;
  const loja = r.s.franchiseeId;
  const id = req.nextUrl.searchParams.get("id") || "";
  const atual = id ? await prisma.fornecedor.findFirst({ where: { id, franchiseeId: loja }, select: { id: true } }) : null;
  if (!atual) return NextResponse.json({ error: "Fornecedor não encontrado." }, { status: 404 });
  // Os pedidos de compra ficam (são histórico da loja); preços e fila saem com ele.
  await prisma.$transaction([
    prisma.cotacaoPreco.deleteMany({ where: { franchiseeId: loja, fornecedorId: id } }),
    prisma.cotacaoEnvio.updateMany({ where: { franchiseeId: loja, fornecedorId: id, status: "FILA" }, data: { status: "CANCELADO", erro: "fornecedor apagado" } }),
    prisma.fornecedor.delete({ where: { id } }),
  ]);
  esquecerFornecedoresDaLoja(loja);
  return NextResponse.json({ ok: true, fornecedores: await fornecedoresDaLoja(loja) });
}
