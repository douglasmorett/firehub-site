/**
 * POST /api/store/escala/aceite { pessoaTipo, pessoaId } — o gerente pede o
 * aceite de novo ("📲 pedir aceite"): o WhatsApp da loja manda à pessoa os
 * turnos que faltam aceitar, com o link pessoal (lib/escala-da-equipe/aviso.ts).
 * Espera o envio para dizer na tela se saiu; no máximo uma vez por minuto.
 */
import { NextResponse } from "next/server";
import { pessoasDaLoja } from "@/lib/escala-da-equipe/banco";
import { avisarPessoa } from "@/lib/escala-da-equipe/aviso";
import { lerCorpo, respostaDoErro, sessaoDaEscala } from "@/lib/escala-da-equipe/sessao";

export const dynamic = "force-dynamic";

const FRASE: Record<string, string> = {
  enviado: "Mensagem enviada pelo WhatsApp da loja.",
  junto: "A pessoa recebeu a mensagem há pouco — o link dela já mostra tudo.",
  falhou: "O WhatsApp da loja não enviou. Confira se o robô está conectado.",
  "sem-whatsapp": "Esta pessoa não tem WhatsApp cadastrado. Ponha o telefone na aba Pessoas.",
  nada: "Não há turno esperando o aceite desta pessoa.",
  espera: "Acabou de sair uma mensagem. Espere um minuto para pedir de novo.",
};

export async function POST(req: Request) {
  try {
    const s = await sessaoDaEscala();
    const corpo = await lerCorpo(req);
    const pessoa = (await pessoasDaLoja(s.lojaId)).find((p) => p.tipo === corpo.pessoaTipo && p.id === corpo.pessoaId);
    if (!pessoa) return NextResponse.json({ error: "Pessoa não encontrada (ou desativada)." }, { status: 404 });
    const r = await avisarPessoa(s.lojaId, pessoa, "manual");
    const ok = r.status === "enviado" || r.status === "junto";
    return NextResponse.json({ ok, status: r.status, mensagem: FRASE[r.status] }, { status: ok || r.status === "nada" ? 200 : 409 });
  } catch (err) {
    return respostaDoErro(err, "POST aceite");
  }
}
