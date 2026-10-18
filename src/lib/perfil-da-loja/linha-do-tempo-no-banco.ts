/**
 * A linha do tempo da loja — a leitura do banco (as regras estão em
 * linha-do-tempo.ts). Os contatos do CRM ligados à loja (CrmContato.userId) e,
 * deles, as últimas mensagens, eventos e reuniões. Colunas pequenas, com teto.
 * No modo VENDEDOR o texto das mensagens nem sai do banco.
 */
import { prisma } from "@/lib/prisma";
import { montarLinhaDoTempo, type EntradaDaLinhaDoTempo, type LinhaDoTempo } from "@/lib/perfil-da-loja/linha-do-tempo";

const TETO_DE_MENSAGENS = 300;
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function linhaDoTempoDaLoja(lojaId: string, modo: "ADMIN" | "VENDEDOR"): Promise<LinhaDoTempo> {
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { vendedorAtendidoEm: true, vendedor: { select: { name: true } } } });
  let contatos: { id: string; nome: string | null; notas: string | null; aguardandoHumanoDesde: Date | null; atualizadoEm: Date }[] = [];
  try {
    contatos = await prisma.crmContato.findMany({ where: { userId: lojaId }, select: { id: true, nome: true, notas: true, aguardandoHumanoDesde: true, atualizadoEm: true } });
  } catch {
    contatos = [];
  }
  const ids = contatos.map((c) => c.id);
  const [mensagens, eventos, reunioes] = ids.length
    ? await Promise.all([
        prisma.crmMensagem.findMany({
          where: { contatoId: { in: ids } },
          orderBy: { criadoEm: "desc" },
          take: TETO_DE_MENSAGENS,
          select: { id: true, contatoId: true, direcao: true, autor: true, autorNome: true, tipo: true, canal: true, status: true, criadoEm: true, ...(modo === "ADMIN" ? { texto: true } : {}) },
        }).catch(() => []),
        prisma.crmEvento.findMany({ where: { contatoId: { in: ids } }, orderBy: { criadoEm: "desc" }, take: 200 }).catch(() => []),
        prisma.agendaReuniao.findMany({ where: { contatoId: { in: ids } }, orderBy: { inicio: "desc" }, take: 50 }).catch(() => []),
      ])
    : [[], [], []];

  const vendedores = reunioes.length
    ? new Map((await prisma.ambassador.findMany({ where: { id: { in: [...new Set(reunioes.map((r) => r.vendedorId))] } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]))
    : new Map<string, string>();

  const entrada: EntradaDaLinhaDoTempo = {
    contatos: contatos.map((c) => ({ id: c.id, nome: c.nome, notas: c.notas, aguardandoHumanoDesde: iso(c.aguardandoHumanoDesde), atualizadoEm: iso(c.atualizadoEm)! })),
    mensagens: (mensagens as any[]).map((m) => ({
      id: m.id, contatoId: m.contatoId, direcao: m.direcao, autor: m.autor, autorNome: m.autorNome ?? null, texto: modo === "ADMIN" ? (m.texto ?? null) : null,
      tipo: m.tipo ?? null, canal: m.canal ?? null, status: m.status ?? null, criadoEm: iso(m.criadoEm)!,
    })),
    eventos: (eventos as any[]).map((ev) => ({ id: ev.id, contatoId: ev.contatoId, tipo: ev.tipo, texto: ev.texto, autorNome: ev.autorNome ?? null, autorTipo: ev.autorTipo ?? null, criadoEm: iso(ev.criadoEm)! })),
    reunioes: (reunioes as any[]).map((r) => ({ id: r.id, tipo: r.tipo, titulo: r.titulo ?? null, inicio: iso(r.inicio)!, status: r.status, observacao: r.observacao ?? null, vendedor: vendedores.get(r.vendedorId) ?? null })),
    marcadoAtendidoEm: iso(loja?.vendedorAtendidoEm),
    vendedorDaLoja: loja?.vendedor?.name ?? null,
  };
  return montarLinhaDoTempo(entrada, modo);
}
