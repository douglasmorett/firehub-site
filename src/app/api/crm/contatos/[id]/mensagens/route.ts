import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { podeVerContato, quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { gravarMensagem } from "@/lib/crm/mensagens";
import { mensagemParaTela } from "@/lib/crm/serializar";
import { jidDoTelefone } from "@/lib/crm/telefone";
import { enviarTexto } from "@/lib/atendimento/whatsapp";

export const dynamic = "force-dynamic";

/** Quem responde pela tela assume a conversa: o robô fica quieto por 2 h (renova a cada resposta). */
const PAUSA_PELA_TELA_MS = 2 * 60 * 60_000;

/**
 * POST { texto }: responde o contato pelo número do FireHub, da tela.
 *
 * O vendedor assina com o primeiro nome ("*Victor:* ..."): o lead conversa
 * com o número do FireHub e precisa saber quem está do outro lado quando a
 * conversa passa do robô para uma pessoa. O admin (o dono do número) não assina.
 *
 * Falhou no gateway (número desconectado)? A mensagem fica gravada como
 * FALHOU e a tela mostra — nada some calado.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  const { id } = await params;
  const contato = await prisma.crmContato.findUnique({ where: { id } });
  if (!contato || !podeVerContato(quem, contato)) return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });

  const b = await req.json().catch(() => ({}));
  const texto = typeof b.texto === "string" ? b.texto.trim().slice(0, 4000) : "";
  if (!texto) return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 });

  const destino = contato.jid || jidDoTelefone(contato.telefone);
  if (!destino) return NextResponse.json({ error: "Este contato não tem número de WhatsApp." }, { status: 400 });

  const assinar = quem.tipo === "VENDEDOR" && b.assinar !== false;
  const final = assinar ? `*${quem.nome.split(/\s+/)[0]}:* ${texto}` : texto;

  const envio = await enviarTexto(destino, final);
  const gravada = await gravarMensagem({
    contatoId: id, direcao: "SAIDA", autor: quem.tipo, autorId: quem.id, autorNome: quem.nome,
    texto: final, status: envio.ok ? "OK" : "FALHOU",
  });
  if (envio.ok) {
    await prisma.crmContato.update({
      where: { id },
      data: {
        roboPausadoAte: new Date(Date.now() + PAUSA_PELA_TELA_MS),
        aguardandoHumanoDesde: null,
        naoLidas: 0,
        ...(!contato.jid ? { jid: destino } : {}),
      },
    });
  }
  return NextResponse.json(
    { ok: envio.ok, erro: envio.erro || null, mensagem: gravada ? mensagemParaTela(gravada) : null },
    { status: envio.ok ? 200 : 502 },
  );
}
