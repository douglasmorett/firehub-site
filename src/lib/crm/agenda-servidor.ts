import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ANTECEDENCIA_MINIMA_MIN, dataDaAgenda, instanteDaAgenda, normalizarDisponibilidade, ocupaHorario, somarDias,
  sobrepoe, vagasDoDia, type Disponibilidade, type Horario,
} from "./agenda";
import { ROTULO_DO_TIPO_DE_REUNIAO, type TipoDeReuniao } from "./etapas";
import { registrarEvento, type Autor } from "./contatos";

/** A equipe que aparece na agenda: vendedores ativos. */
export async function vendedoresDaEquipe() {
  return prisma.ambassador.findMany({
    where: { isVendedor: true, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true },
  });
}

export async function disponibilidadesDos(vendedorIds: string[]): Promise<Map<string, Disponibilidade>> {
  const mapa = new Map<string, Disponibilidade>();
  if (vendedorIds.length === 0) return mapa;
  const linhas = await prisma.agendaDisponibilidade.findMany({ where: { vendedorId: { in: vendedorIds } } });
  for (const id of vendedorIds) {
    const linha = linhas.find((l) => l.vendedorId === id);
    mapa.set(id, normalizarDisponibilidade(linha?.config));
  }
  return mapa;
}

export async function salvarDisponibilidade(vendedorId: string, config: unknown): Promise<Disponibilidade> {
  const disp = normalizarDisponibilidade(config);
  await prisma.agendaDisponibilidade.upsert({
    where: { vendedorId },
    create: { vendedorId, config: disp as unknown as Prisma.InputJsonValue },
    update: { config: disp as unknown as Prisma.InputJsonValue },
  });
  return disp;
}

export async function reunioesEntre(de: Date, ate: Date, vendedorIds?: string[]) {
  return prisma.agendaReuniao.findMany({
    where: {
      inicio: { lt: ate },
      fim: { gt: de },
      ...(vendedorIds ? { vendedorId: { in: vendedorIds } } : {}),
    },
    orderBy: { inicio: "asc" },
    include: { contato: { select: { id: true, nome: true, nomeDaLoja: true, telefone: true, jid: true, etapa: true, vendedorId: true } } },
  });
}

/** A reunião ativa que cruza este horário na agenda do vendedor, se houver. */
export async function conflitoNaAgenda(vendedorId: string, inicio: Date, fim: Date, ignorarId?: string) {
  const cruzam = await prisma.agendaReuniao.findMany({
    where: {
      vendedorId,
      status: { not: "CANCELADA" },
      inicio: { lt: fim },
      fim: { gt: inicio },
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    take: 1,
  });
  return cruzam[0] || null;
}

export type VagasDoVendedor = { vendedorId: string; nome: string; data: string; vagas: Horario[] };

/**
 * As vagas de cada vendedor nos próximos `dias` dias a partir de `desde`
 * (hoje, em Brasília). É o que a tela resume em "3 vagas" e o que o robô
 * oferece ao lead que quer ver o sistema funcionando.
 */
export async function vagasDaEquipe(opcoes: { desde?: string; dias?: number; vendedorIds?: string[]; agora?: Date } = {}) {
  const agora = opcoes.agora || new Date();
  const desde = opcoes.desde || dataDaAgenda(agora);
  const dias = Math.max(1, Math.min(opcoes.dias || 7, 31));
  const equipe = (await vendedoresDaEquipe()).filter((v) => !opcoes.vendedorIds || opcoes.vendedorIds.includes(v.id));
  const disp = await disponibilidadesDos(equipe.map((v) => v.id));
  const reunioes = await reunioesEntre(instanteDaAgenda(desde, "00:00"), instanteDaAgenda(somarDias(desde, dias), "00:00"), equipe.map((v) => v.id));

  const resultado: VagasDoVendedor[] = [];
  for (let i = 0; i < dias; i++) {
    const data = somarDias(desde, i);
    for (const v of equipe) {
      const doVendedor = reunioes.filter((r) => r.vendedorId === v.id);
      resultado.push({ vendedorId: v.id, nome: v.name, data, vagas: vagasDoDia(disp.get(v.id)!, data, doVendedor, agora, ANTECEDENCIA_MINIMA_MIN) });
    }
  }
  return resultado;
}

/**
 * Quem faz a demonstração deste horário: o vendedor do contato, se estiver
 * livre; senão o livre com menos reuniões no dia (divide a equipe sem regra
 * escondida). Livre = o horário cabe numa vaga dele.
 *
 * `somentePreferido`: contato que já tem vendedor fica com ELE — outro
 * vendedor apresentaria para um lead que não consegue nem abrir.
 */
export async function vendedorLivrePara(inicio: Date, preferido?: string | null, somentePreferido = false): Promise<string | null> {
  const data = dataDaAgenda(inicio);
  const vagas = await vagasDaEquipe({
    desde: data, dias: 1,
    agora: new Date(Math.min(Date.now(), inicio.getTime() - ANTECEDENCIA_MINIMA_MIN * 60_000)),
    ...(somentePreferido && preferido ? { vendedorIds: [preferido] } : {}),
  });
  const livres = vagas.filter((v) => v.vagas.some((h) => h.inicio.getTime() === inicio.getTime()));
  if (livres.length === 0) return null;
  if (preferido && livres.some((l) => l.vendedorId === preferido)) return preferido;
  if (somentePreferido) return null;

  const ids = livres.map((l) => l.vendedorId);
  const doDia = await reunioesEntre(instanteDaAgenda(data, "00:00"), instanteDaAgenda(somarDias(data, 1), "00:00"), ids);
  const carga = (id: string) => doDia.filter((r) => r.vendedorId === id && ocupaHorario(r)).length;
  ids.sort((a, b) => carga(a) - carga(b));
  return ids[0];
}

export type NovaReuniao = {
  vendedorId: string;
  contatoId?: string | null;
  tipo?: TipoDeReuniao;
  titulo?: string | null;
  inicio: Date;
  fim: Date;
  local?: string | null;
  observacao?: string | null;
};

export class HorarioOcupado extends Error {}

/**
 * Marca na agenda. Horário ocupado é recusado (a agenda é compartilhada: dois
 * vendedores marcando ao mesmo tempo não podem pôr duas pessoas na mesma hora
 * do Victor). Demonstração com contato leva o contato para "Demonstração
 * marcada" e, se ninguém cuidava dele, para quem vai apresentar — mas só
 * quando quem marca é o admin ou o robô: vendedor marcando não distribui lead.
 * A carteira da LOJA (os 3%) só o admin muda.
 */
export async function marcarReuniao(dados: NovaReuniao, autor: Autor) {
  if (!(dados.fim.getTime() > dados.inicio.getTime())) throw new Error("O fim precisa ser depois do começo.");
  const vendedor = await prisma.ambassador.findUnique({ where: { id: dados.vendedorId }, select: { id: true, name: true, isVendedor: true, active: true } });
  if (!vendedor?.isVendedor || !vendedor.active) throw new Error("Vendedor não encontrado ou inativo.");

  const contato = dados.contatoId ? await prisma.crmContato.findUnique({ where: { id: dados.contatoId } }) : null;
  if (dados.contatoId && !contato) throw new Error("Contato não encontrado.");

  const tipo: TipoDeReuniao = dados.tipo || "DEMONSTRACAO";
  const titulo = (dados.titulo || "").trim() ||
    (tipo === "BLOQUEIO" ? "Bloqueado" : `${ROTULO_DO_TIPO_DE_REUNIAO[tipo]}${contato ? ` — ${contato.nomeDaLoja || contato.nome || "contato"}` : ""}`);

  // Conferir e gravar sob a trava da agenda DESTE vendedor: sem ela, o admin e
  // o robô marcando no mesmo segundo passavam os dois pela conferência.
  const reuniao = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"agenda:" + dados.vendedorId}))`;
    const cruzam = await tx.agendaReuniao.findFirst({
      where: { vendedorId: dados.vendedorId, status: { not: "CANCELADA" }, inicio: { lt: dados.fim }, fim: { gt: dados.inicio } },
    });
    if (cruzam) throw new HorarioOcupado(`${vendedor.name} já tem "${cruzam.titulo}" nesse horário.`);
    return tx.agendaReuniao.create({
      data: {
        vendedorId: dados.vendedorId,
        contatoId: contato?.id || null,
        tipo,
        titulo: titulo.slice(0, 160),
        inicio: dados.inicio,
        fim: dados.fim,
        local: dados.local?.trim().slice(0, 300) || null,
        observacao: dados.observacao?.trim().slice(0, 2000) || null,
        criadoPorTipo: autor.tipo,
        criadoPorId: autor.id || null,
        criadoPorNome: autor.nome || null,
        // Quem marcou na própria agenda não precisa ser avisado disso.
        avisoVendedorEm: autor.tipo === "VENDEDOR" && autor.id === dados.vendedorId ? new Date() : null,
      },
    });
  });

  if (contato && tipo !== "BLOQUEIO") {
    const mudar: Prisma.CrmContatoUpdateInput = {};
    if (tipo === "DEMONSTRACAO" && (contato.etapa === "NOVO" || contato.etapa === "CONVERSANDO" || contato.etapa === "PERDIDO")) {
      mudar.etapa = "DEMO_MARCADA";
    }
    const distribui = autor.tipo === "ADMIN" || autor.tipo === "ROBO";
    if (!contato.vendedorId && distribui) {
      mudar.vendedorId = dados.vendedorId;
      mudar.vendedorAtribuidoEm = new Date();
    }
    if (Object.keys(mudar).length > 0) await prisma.crmContato.update({ where: { id: contato.id }, data: mudar });
    if (!contato.vendedorId && contato.userId && autor.tipo === "ADMIN") {
      await prisma.user.updateMany({
        where: { id: contato.userId, vendedorId: null },
        data: { vendedorId: dados.vendedorId, vendedorStatus: "AGUARDANDO", vendedorAtribuidoEm: new Date() },
      });
    }
    const quando = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(dados.inicio);
    await registrarEvento(contato.id, "REUNIAO", `${ROTULO_DO_TIPO_DE_REUNIAO[tipo]} marcada com ${vendedor.name}: ${quando}.`, autor, { reuniaoId: reuniao.id });
  }
  return reuniao;
}

export async function remarcarReuniao(id: string, inicio: Date, fim: Date, autor: Autor, vendedorId?: string) {
  const atual = await prisma.agendaReuniao.findUnique({ where: { id } });
  if (!atual) throw new Error("Reunião não encontrada.");
  const destino = vendedorId || atual.vendedorId;
  if (!(fim.getTime() > inicio.getTime())) throw new Error("O fim precisa ser depois do começo.");
  const conflito = await conflitoNaAgenda(destino, inicio, fim, id);
  if (conflito) throw new HorarioOcupado(`Já existe "${conflito.titulo}" nesse horário.`);
  const atualizada = await prisma.agendaReuniao.update({
    where: { id },
    data: {
      inicio, fim, vendedorId: destino,
      status: atual.status === "CANCELADA" ? "MARCADA" : atual.status,
      // Horário novo = lembrete novo; vendedor novo = aviso novo.
      lembreteEm: null,
      ...(destino !== atual.vendedorId ? { avisoVendedorEm: autor.tipo === "VENDEDOR" && autor.id === destino ? new Date() : null } : {}),
    },
  });
  if (atual.contatoId) {
    const quando = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    }).format(inicio);
    await registrarEvento(atual.contatoId, "REUNIAO", `Reunião remarcada para ${quando}.`, autor, { reuniaoId: id });
  }
  return atualizada;
}

/** Sobreposição com as reuniões já carregadas — a tela usa para avisar antes de salvar. */
export function cruzaAlguma(h: { inicio: Date; fim: Date }, reunioes: { inicio: Date; fim: Date; status: string }[]) {
  return reunioes.some((r) => ocupaHorario(r) && sobrepoe(h, r));
}
