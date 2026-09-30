import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { podeVerContato, quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { registrarEvento } from "@/lib/crm/contatos";

export const dynamic = "force-dynamic";

/** POST { texto }: anotação na linha do tempo do contato ("ligou, pediu para retornar sexta"). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  const { id } = await params;
  const contato = await prisma.crmContato.findUnique({ where: { id }, select: { id: true, vendedorId: true } });
  if (!contato || !podeVerContato(quem, contato)) return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const texto = typeof b.texto === "string" ? b.texto.trim() : "";
  if (!texto) return NextResponse.json({ error: "Escreva a anotação." }, { status: 400 });
  await registrarEvento(id, "NOTA", texto.slice(0, 2000), { tipo: quem.tipo, id: quem.id, nome: quem.nome });
  return NextResponse.json({ ok: true });
}
