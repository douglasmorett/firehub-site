import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nomesDaEquipe, podeVerContato, quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { registrarEvento } from "@/lib/crm/contatos";
import { contatoCompleto } from "@/lib/crm/serializar";
import { agendarRespostaDoRobo } from "@/lib/atendimento/robo";

export const dynamic = "force-dynamic";

/** "Pausar" na tela é até alguém devolver — uma semana é o teto para ninguém esquecer o robô mudo para sempre. */
const PAUSA_DA_TELA_MS = 7 * 24 * 60 * 60_000;

/**
 * POST { acao }: o robô NESTA conversa.
 *   pausar    — robô quieto aqui até devolver (teto de 7 dias)
 *   devolver  — robô volta a responder (e responde já, se a última é do contato)
 *   resolvido — tira o "aguardando pessoa" sem devolver ao robô
 *   desligar  — nunca responder este número (contato pessoal, fornecedor)
 *   religar   — desfaz o desligar
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  const { id } = await params;
  const contato = await prisma.crmContato.findUnique({ where: { id } });
  if (!contato || !podeVerContato(quem, contato)) return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const autor = { tipo: quem.tipo, id: quem.id, nome: quem.nome } as const;
  const acao = String(b.acao || "");
  switch (acao) {
    case "pausar":
      await prisma.crmContato.update({ where: { id }, data: { roboPausadoAte: new Date(Date.now() + PAUSA_DA_TELA_MS) } });
      await registrarEvento(id, "ROBO", "Pausou o robô nesta conversa.", autor);
      break;
    case "devolver":
      await prisma.crmContato.update({ where: { id }, data: { roboPausadoAte: null, aguardandoHumanoDesde: null, roboDesligado: false } });
      await registrarEvento(id, "ROBO", "Devolveu a conversa para o robô.", autor);
      agendarRespostaDoRobo(id);
      break;
    case "resolvido":
      await prisma.crmContato.update({ where: { id }, data: { aguardandoHumanoDesde: null } });
      break;
    case "desligar":
      await prisma.crmContato.update({ where: { id }, data: { roboDesligado: true } });
      await registrarEvento(id, "ROBO", "Robô desligado para este número.", autor);
      break;
    case "religar":
      await prisma.crmContato.update({ where: { id }, data: { roboDesligado: false } });
      await registrarEvento(id, "ROBO", "Robô religado para este número.", autor);
      break;
    default:
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }
  const atualizado = await prisma.crmContato.findUnique({ where: { id } });
  return NextResponse.json({ contato: contatoCompleto(atualizado, await nomesDaEquipe()) });
}
