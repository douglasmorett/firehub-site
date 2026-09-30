import { prisma } from "@/lib/prisma";

/**
 * Grava uma mensagem da conversa do número do FireHub e atualiza o resumo do
 * contato (última mensagem, não lidas, primeiro contato do vendedor).
 *
 * `waId` é o id da mensagem no WhatsApp e é único: o gateway pode entregar o
 * mesmo evento duas vezes (reconexão, reenvio do webhook) e a conversa não
 * pode ganhar a mensagem repetida. Duplicada volta `null`.
 */
export type NovaMensagem = {
  contatoId: string;
  waId?: string | null;
  direcao: "ENTRADA" | "SAIDA";
  autor: "CLIENTE" | "ROBO" | "ADMIN" | "VENDEDOR" | "CELULAR" | "SISTEMA";
  autorId?: string | null;
  autorNome?: string | null;
  tipo?: "TEXTO" | "AUDIO" | "IMAGEM" | "VIDEO" | "LOCALIZACAO";
  texto: string;
  status?: "OK" | "FALHOU";
  criadoEm?: Date;
};

export async function gravarMensagem(m: NovaMensagem) {
  const texto = String(m.texto || "").slice(0, 8000);
  let criada;
  try {
    criada = await prisma.crmMensagem.create({
      data: {
        contatoId: m.contatoId,
        waId: m.waId || null,
        direcao: m.direcao,
        autor: m.autor,
        autorId: m.autorId || null,
        autorNome: m.autorNome || null,
        tipo: m.tipo || "TEXTO",
        texto,
        status: m.status || "OK",
        ...(m.criadoEm ? { criadoEm: m.criadoEm } : {}),
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") return null;
    throw err;
  }

  const contato = await prisma.crmContato.findUnique({
    where: { id: m.contatoId },
    select: { etapa: true, vendedorId: true, primeiroContatoEm: true },
  });
  if (!contato) return criada;

  const saiuDeGente = m.direcao === "SAIDA" && (m.autor === "ADMIN" || m.autor === "VENDEDOR" || m.autor === "CELULAR");
  await prisma.crmContato.update({
    where: { id: m.contatoId },
    data: {
      ultimaMensagemEm: criada.criadoEm,
      ultimaMensagemTexto: texto.slice(0, 160),
      ultimaMensagemDe: m.autor,
      ...(m.direcao === "ENTRADA" ? { naoLidas: { increment: 1 } } : {}),
      // Alguém respondeu de fato: a conversa já não espera uma pessoa.
      ...(saiuDeGente ? { aguardandoHumanoDesde: null } : {}),
      // "Novo" é quem ainda não ouviu resposta nenhuma.
      ...(m.direcao === "SAIDA" && m.status !== "FALHOU" && contato.etapa === "NOVO" ? { etapa: "CONVERSANDO" } : {}),
      // O relógio do vendedor: a primeira mensagem DELE depois de receber o contato.
      ...(m.autor === "VENDEDOR" && m.status !== "FALHOU" && contato.vendedorId && m.autorId === contato.vendedorId && !contato.primeiroContatoEm
        ? { primeiroContatoEm: criada.criadoEm }
        : {}),
    },
  });
  return criada;
}

/** As últimas `limite` mensagens, da mais antiga para a mais nova. */
export async function mensagensDoContato(contatoId: string, limite = 200) {
  const ultimas = await prisma.crmMensagem.findMany({
    where: { contatoId },
    orderBy: { criadoEm: "desc" },
    take: limite,
  });
  return ultimas.reverse();
}
