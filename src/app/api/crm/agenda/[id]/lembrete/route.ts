import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { gravarMensagem, jaEscreveuPeloWhatsApp, NUNCA_ESCREVEU } from "@/lib/crm/mensagens";
import { textoDoLembrete } from "@/lib/crm/lembretes";
import { jidDoTelefone } from "@/lib/crm/telefone";
import { enviarTexto } from "@/lib/atendimento/whatsapp";

export const dynamic = "force-dynamic";

/**
 * POST: manda AGORA o lembrete da reunião para o contato, pelo WhatsApp do
 * FireHub — quando uma pessoa clica. Não existe lembrete automático: o número
 * do FireHub não manda nada sozinho (lib/crm/lembretes.ts). O vendedor só
 * lembra reunião da agenda dele.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  const { id } = await params;
  const r = await prisma.agendaReuniao.findUnique({ where: { id }, include: { contato: true } });
  if (!r || !r.contato) return NextResponse.json({ error: "Reunião sem contato." }, { status: 404 });
  if (quem.tipo === "VENDEDOR" && r.vendedorId !== quem.id) return NextResponse.json({ error: "Essa reunião é da agenda de outro vendedor." }, { status: 403 });
  if (r.status !== "MARCADA" || r.inicio.getTime() < Date.now()) {
    return NextResponse.json({ error: "Só dá para lembrar uma reunião marcada que ainda não passou." }, { status: 400 });
  }
  const destino = r.contato.jid || jidDoTelefone(r.contato.telefone);
  if (!destino) return NextResponse.json({ error: "O contato não tem WhatsApp." }, { status: 400 });
  if (!(await jaEscreveuPeloWhatsApp(r.contato.id))) return NextResponse.json({ error: NUNCA_ESCREVEU }, { status: 400 });

  const vendedor = await prisma.ambassador.findUnique({ where: { id: r.vendedorId }, select: { name: true } });
  const texto = textoDoLembrete(r, r.contato, vendedor?.name || null);
  const envio = await enviarTexto(destino, texto);
  await gravarMensagem({
    contatoId: r.contato.id, direcao: "SAIDA", autor: quem.tipo, autorId: quem.id, autorNome: quem.nome,
    texto, status: envio.ok ? "OK" : "FALHOU",
  });
  if (!envio.ok) return NextResponse.json({ ok: false, error: envio.erro || "Não saiu." }, { status: 502 });
  const agora = new Date();
  await prisma.agendaReuniao.update({ where: { id }, data: { lembreteEm: agora } });
  return NextResponse.json({ ok: true, lembreteEm: agora.toISOString() });
}
