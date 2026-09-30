import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nomesDaEquipe, quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { instanteDaAgenda, minutosDoHorario } from "@/lib/crm/agenda";
import { remarcarReuniao, HorarioOcupado } from "@/lib/crm/agenda-servidor";
import { registrarEvento, mudarEtapa } from "@/lib/crm/contatos";
import { ROTULO_DO_STATUS_DE_REUNIAO, STATUS_DE_REUNIAO, type StatusDeReuniao } from "@/lib/crm/etapas";
import { reuniaoParaTela } from "@/lib/crm/serializar";

export const dynamic = "force-dynamic";

async function reuniaoPermitida(id: string) {
  const quem = await quemEsta();
  if (!quem) return { erro: NextResponse.json(NAO_AUTORIZADO, { status: 401 }) } as const;
  const reuniao = await prisma.agendaReuniao.findUnique({ where: { id } });
  if (!reuniao) return { erro: NextResponse.json({ error: "Reunião não encontrada." }, { status: 404 }) } as const;
  if (quem.tipo === "VENDEDOR" && reuniao.vendedorId !== quem.id) {
    return { erro: NextResponse.json({ error: "Essa reunião é da agenda de outro vendedor." }, { status: 403 }) } as const;
  }
  return { quem, reuniao } as const;
}

/**
 * PATCH: muda a reunião — status (realizada, não compareceu, cancelada),
 * horário (data/hora/duração), vendedor (só admin), título, local, observação.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await reuniaoPermitida(id);
  if ("erro" in r) return r.erro;
  const { quem, reuniao } = r;
  const autor = { tipo: quem.tipo, id: quem.id, nome: quem.nome } as const;
  const b = await req.json().catch(() => ({}));

  try {
    const mudarHorario = typeof b.data === "string" || typeof b.hora === "string" || b.duracaoMin || (quem.tipo === "ADMIN" && b.vendedorId && b.vendedorId !== reuniao.vendedorId);
    if (mudarHorario) {
      const dataAtual = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(reuniao.inicio);
      const horaAtual = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(reuniao.inicio);
      const data = typeof b.data === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.data) ? b.data : dataAtual;
      const hora = typeof b.hora === "string" && minutosDoHorario(b.hora) !== null ? b.hora : horaAtual;
      const duracao = Number(b.duracaoMin) > 0 ? Math.min(Number(b.duracaoMin), 600) : Math.round((reuniao.fim.getTime() - reuniao.inicio.getTime()) / 60_000);
      const inicio = instanteDaAgenda(data, hora);
      await remarcarReuniao(id, inicio, new Date(inicio.getTime() + duracao * 60_000), autor, quem.tipo === "ADMIN" && b.vendedorId ? String(b.vendedorId) : undefined);
    }

    const dados: Record<string, string | null> = {};
    for (const campo of ["titulo", "local", "observacao"] as const) {
      if (campo in b) dados[campo] = typeof b[campo] === "string" && b[campo].trim() ? b[campo].trim().slice(0, campo === "observacao" ? 2000 : 300) : null;
    }
    if (dados.titulo === null) delete dados.titulo;
    if ("status" in b) {
      const status = (STATUS_DE_REUNIAO as readonly string[]).includes(b.status) ? (b.status as StatusDeReuniao) : null;
      if (!status) return NextResponse.json({ error: "Status inválido." }, { status: 400 });
      dados.status = status;
    }
    if (Object.keys(dados).length > 0) await prisma.agendaReuniao.update({ where: { id }, data: dados });

    if (dados.status && dados.status !== reuniao.status && reuniao.contatoId) {
      await registrarEvento(reuniao.contatoId, "REUNIAO", `${reuniao.titulo}: ${ROTULO_DO_STATUS_DE_REUNIAO[dados.status as StatusDeReuniao].toLowerCase()}.`, autor, { reuniaoId: id });
      // Demonstração cancelada ou sem comparecimento: o lead volta a "conversando".
      if ((dados.status === "CANCELADA" || dados.status === "FALTOU") && reuniao.tipo === "DEMONSTRACAO") {
        const c = await prisma.crmContato.findUnique({ where: { id: reuniao.contatoId }, select: { etapa: true } });
        if (c?.etapa === "DEMO_MARCADA") await mudarEtapa(reuniao.contatoId, "CONVERSANDO", autor);
      }
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Não foi possível salvar." }, { status: err instanceof HorarioOcupado ? 409 : 400 });
  }

  const atualizada = await prisma.agendaReuniao.findUnique({ where: { id }, include: { contato: true } });
  return NextResponse.json({ reuniao: reuniaoParaTela(atualizada, await nomesDaEquipe()) });
}

/** DELETE: cancela (a reunião fica no histórico do contato como cancelada). Bloqueio é apagado de vez. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await reuniaoPermitida(id);
  if ("erro" in r) return r.erro;
  const { quem, reuniao } = r;
  if (reuniao.tipo === "BLOQUEIO") {
    await prisma.agendaReuniao.delete({ where: { id } });
    return NextResponse.json({ ok: true, apagada: true });
  }
  await prisma.agendaReuniao.update({ where: { id }, data: { status: "CANCELADA" } });
  if (reuniao.contatoId) {
    const autor = { tipo: quem.tipo, id: quem.id, nome: quem.nome } as const;
    await registrarEvento(reuniao.contatoId, "REUNIAO", `${reuniao.titulo}: cancelada.`, autor, { reuniaoId: id });
    if (reuniao.tipo === "DEMONSTRACAO") {
      const c = await prisma.crmContato.findUnique({ where: { id: reuniao.contatoId }, select: { etapa: true } });
      if (c?.etapa === "DEMO_MARCADA") await mudarEtapa(reuniao.contatoId, "CONVERSANDO", autor);
    }
  }
  return NextResponse.json({ ok: true });
}
