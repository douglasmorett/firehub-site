/**
 * As reservas no banco: ler o período, criar (conferindo a capacidade pela
 * regra pura de ./regras.ts), mudar o status, mover o horário, cancelar a do
 * cliente pelo telefone (o robô) e o consumo das mesas que vieram por reserva.
 *
 * Criar e mover rodam numa transação com trava por loja e dia
 * (pg_advisory_xact_lock): duas conversas do robô disputando a última vaga do
 * sábado não passam as duas. Dentro da transação, toda leitura vai pelo `tx`
 * (memória "conexao-dentro-da-transacao-trava").
 */
import { prisma } from "@/lib/prisma";
import { dataDaLoja, inicioDoDiaDaLoja, relogioDaLoja } from "@/lib/fuso";
import { mesmoTelefone } from "@/lib/telefone";
import { garantirEstruturaDasReservas } from "./estrutura";
import {
  avaliarReserva, lerConfig, minutos, normalizarHora, somarDias, sugerirHorarios,
  type Agora, type ConfigDasReservas, type MotivoDeRecusa, type OrigemDaReserva, type Sugestao, type StatusDaReserva,
} from "./regras";

export type Reserva = {
  id: string;
  nome: string;
  telefone: string | null;
  data: string;
  hora: string;
  pessoas: number;
  observacao: string | null;
  origem: OrigemDaReserva;
  status: StatusDaReserva;
  mesaId: string | null;
  criadaPor: string | null;
  criadoEm: string;
  chegouEm: string | null;
  canceladaEm: string | null;
};

const COLUNAS = `"id","nome","telefone","data","hora","pessoas","observacao","origem","status","mesaId","criadaPor","criadoEm","chegouEm","canceladaEm"`;

const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null);
function paraReserva(l: any): Reserva {
  return {
    id: l.id, nome: l.nome, telefone: l.telefone ?? null, data: l.data, hora: l.hora, pessoas: Number(l.pessoas) || 0,
    observacao: l.observacao ?? null, origem: l.origem, status: l.status, mesaId: l.mesaId ?? null, criadaPor: l.criadaPor ?? null,
    criadoEm: iso(l.criadoEm) || new Date().toISOString(), chegouEm: iso(l.chegouEm), canceladaEm: iso(l.canceladaEm),
  };
}

/** O "agora" no relógio da loja, para a regra pura. */
export function agoraNaLoja(timeZone: string | null | undefined, agora: Date = new Date()): Agora {
  return { data: dataDaLoja(timeZone, agora), minutos: relogioDaLoja(timeZone, agora).minutos };
}

/** O instante de "data hora" no relógio da loja. */
export function instanteDaReserva(data: string, hora: string, timeZone: string | null | undefined): Date {
  // Meio-dia UTC cai no mesmo dia do calendário em todo fuso do Brasil.
  const inicio = inicioDoDiaDaLoja(timeZone, new Date(`${data}T15:00:00Z`)).getTime();
  return new Date(inicio + minutos(hora) * 60_000);
}

export async function fusoDaLoja(franchiseeId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeTimezone: true } });
  return u?.storeTimezone || "America/Sao_Paulo";
}

/** As reservas de `de` a `ate` (inclusive), em ordem de dia e hora. */
export async function reservasEntre(franchiseeId: string, de: string, ate: string): Promise<Reserva[]> {
  if (!(await garantirEstruturaDasReservas())) return [];
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${COLUNAS} FROM "ReservaDeMesa" WHERE "franchiseeId" = $1 AND "data" >= $2 AND "data" <= $3 ORDER BY "data", "hora", "criadoEm"`,
    franchiseeId, de, ate,
  );
  return linhas.map(paraReserva);
}

export async function reservaPorId(franchiseeId: string, id: string): Promise<Reserva | null> {
  if (!(await garantirEstruturaDasReservas())) return null;
  const l = await prisma.$queryRawUnsafe<any[]>(`SELECT ${COLUNAS} FROM "ReservaDeMesa" WHERE "franchiseeId" = $1 AND "id" = $2`, franchiseeId, id);
  return l[0] ? paraReserva(l[0]) : null;
}

/** As próximas reservas confirmadas deste telefone (de hoje em diante), para o robô saber o que o cliente já tem. */
export async function reservasDoTelefone(franchiseeId: string, telefone: string, hoje: string): Promise<Reserva[]> {
  const digitos = String(telefone || "").replace(/\D/g, "");
  if (digitos.length < 8 || !(await garantirEstruturaDasReservas())) return [];
  const linhas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT ${COLUNAS} FROM "ReservaDeMesa" WHERE "franchiseeId" = $1 AND "data" >= $2 AND "status" = 'CONFIRMADA' AND "telefone" IS NOT NULL ORDER BY "data", "hora" LIMIT 200`,
    franchiseeId, hoje,
  );
  return linhas.map(paraReserva).filter((r) => mesmoTelefone(r.telefone, digitos));
}

// ─── Criar ────────────────────────────────────────────────────────────────

export type DadosDaReserva = {
  nome: string;
  telefone?: string | null;
  data: string;
  hora: string;
  pessoas: number;
  observacao?: string | null;
  mesaId?: string | null;
  origem: OrigemDaReserva;
  criadaPor?: string | null;
};

export type ResultadoDaReserva =
  | { ok: true; reserva: Reserva; ocupacao: { reservas: number; pessoas: number }; config: ConfigDasReservas }
  | { ok: false; motivo: MotivoDeRecusa | "sem_nome" | "nao_achou" | "sem_estrutura"; explicacao: string; sugestoes: Sugestao[] };

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function configNoTx(tx: Tx, franchiseeId: string): Promise<ConfigDasReservas> {
  const l = await tx.$queryRawUnsafe<{ config: unknown }[]>(`SELECT "config" FROM "ReservasAssinatura" WHERE "franchiseeId" = $1`, franchiseeId);
  const bruto = l[0]?.config;
  return lerConfig(typeof bruto === "string" ? JSON.parse(bruto) : bruto);
}

async function doPeriodoNoTx(tx: Tx, franchiseeId: string, de: string, ate: string): Promise<Reserva[]> {
  const linhas = await tx.$queryRawUnsafe<any[]>(
    `SELECT ${COLUNAS} FROM "ReservaDeMesa" WHERE "franchiseeId" = $1 AND "data" >= $2 AND "data" <= $3`, franchiseeId, de, ate,
  );
  return linhas.map(paraReserva);
}

const trava = (tx: Tx, franchiseeId: string, data: string) =>
  tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `reserva:${franchiseeId}:${data}`);

/** Sugestões para quando não cabe: lê a semana a partir do dia pedido (pelo tx). */
async function sugestoesNoTx(tx: Tx, franchiseeId: string, config: ConfigDasReservas, pedido: { data: string; hora: string; pessoas: number; ignorarId?: string }, agora: Agora) {
  const de = pedido.data < agora.data ? agora.data : pedido.data;
  const semana = await doPeriodoNoTx(tx, franchiseeId, de, somarDias(de, 7));
  return sugerirHorarios(config, (d) => semana.filter((r) => r.data === d), pedido, agora);
}

/**
 * Cria a reserva se couber. `encaixar` (só o painel) grava mesmo lotado ou fora
 * do horário — é o dono decidindo apertar mais uma mesa; o que a regra não
 * deixa nem assim: data/hora inválida, sem pessoas, horário que já passou.
 */
export async function criarReserva(
  franchiseeId: string, dados: DadosDaReserva, agora: Agora, opcoes: { encaixar?: boolean } = {},
): Promise<ResultadoDaReserva> {
  const nome = String(dados.nome || "").trim().slice(0, 80);
  if (!nome) return { ok: false, motivo: "sem_nome", explicacao: "Falta o nome da reserva.", sugestoes: [] };
  if (!(await garantirEstruturaDasReservas())) return { ok: false, motivo: "sem_estrutura", explicacao: "As reservas ainda não estão disponíveis.", sugestoes: [] };
  const hora = normalizarHora(dados.hora) || dados.hora;
  const pessoas = Math.round(Number(dados.pessoas));
  return prisma.$transaction(async (tx) => {
    await trava(tx, franchiseeId, dados.data);
    const config = await configNoTx(tx, franchiseeId);
    const doDia = await doPeriodoNoTx(tx, franchiseeId, dados.data, dados.data);
    const a = avaliarReserva(config, doDia, { data: dados.data, hora, pessoas }, agora);
    const contornavel = !a.ok && ["lotado", "lotado_pessoas", "fora_do_horario", "dia_sem_reserva", "antecedencia", "grupo_grande", "longe_demais"].includes(a.motivo);
    if (!a.ok && !(opcoes.encaixar && contornavel)) {
      const sugestoes = ["lotado", "lotado_pessoas", "fora_do_horario", "dia_sem_reserva", "antecedencia"].includes(a.motivo)
        ? await sugestoesNoTx(tx, franchiseeId, config, { data: dados.data, hora, pessoas }, agora)
        : [];
      return { ok: false as const, motivo: a.motivo, explicacao: a.explicacao, sugestoes };
    }
    const id = crypto.randomUUID();
    const linhas = await tx.$queryRawUnsafe<any[]>(
      `INSERT INTO "ReservaDeMesa" ("id","franchiseeId","nome","telefone","data","hora","pessoas","observacao","origem","status","mesaId","criadaPor")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'CONFIRMADA',$10,$11) RETURNING ${COLUNAS}`,
      id, franchiseeId, nome, dados.telefone ? String(dados.telefone).replace(/\D/g, "").slice(0, 20) || null : null,
      dados.data, hora, pessoas, dados.observacao ? String(dados.observacao).trim().slice(0, 300) || null : null,
      dados.origem, dados.mesaId || null, dados.criadaPor ? String(dados.criadaPor).slice(0, 80) : null,
    );
    const pico = a.ok ? a.pico : { reservas: 0, pessoas: 0 };
    return { ok: true as const, reserva: paraReserva(linhas[0]), ocupacao: { reservas: pico.reservas + 1, pessoas: pico.pessoas + pessoas }, config };
  });
}

// ─── Mudar ────────────────────────────────────────────────────────────────

export type AcaoNaReserva =
  | { acao: "chegou"; mesaId?: string | null }
  | { acao: "nao_veio" }
  | { acao: "cancelar" }
  | { acao: "confirmar" }
  | { acao: "mesa"; mesaId: string | null }
  | { acao: "editar"; nome?: string; telefone?: string | null; pessoas?: number; observacao?: string | null }
  | { acao: "mover"; data: string; hora: string; encaixar?: boolean };

/** Muda uma reserva da loja. Mover confere a capacidade (sem contar a própria reserva). */
export async function mudarReserva(franchiseeId: string, id: string, a: AcaoNaReserva, agora: Agora): Promise<ResultadoDaReserva> {
  const atual = await reservaPorId(franchiseeId, id);
  if (!atual) return { ok: false, motivo: "nao_achou", explicacao: "Reserva não encontrada.", sugestoes: [] };
  const fim = async (sql: string, ...valores: unknown[]): Promise<ResultadoDaReserva> => {
    const linhas = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE "ReservaDeMesa" SET ${sql}, "atualizadoEm" = NOW() WHERE "franchiseeId" = $1 AND "id" = $2 RETURNING ${COLUNAS}`,
      franchiseeId, id, ...valores,
    );
    return { ok: true, reserva: paraReserva(linhas[0]), ocupacao: { reservas: 0, pessoas: 0 }, config: lerConfig(null) };
  };
  switch (a.acao) {
    case "chegou":
      return a.mesaId !== undefined
        ? fim(`"status" = 'CHEGOU', "chegouEm" = COALESCE("chegouEm", NOW()), "mesaId" = $3`, a.mesaId || null)
        : fim(`"status" = 'CHEGOU', "chegouEm" = COALESCE("chegouEm", NOW())`);
    case "nao_veio":
      return fim(`"status" = 'NAO_VEIO'`);
    case "cancelar":
      return fim(`"status" = 'CANCELADA', "canceladaEm" = NOW()`);
    case "confirmar":
      // Desfazer: volta a confirmada (e volta a ocupar lugar).
      return fim(`"status" = 'CONFIRMADA', "chegouEm" = NULL, "canceladaEm" = NULL`);
    case "mesa":
      return fim(`"mesaId" = $3`, a.mesaId || null);
    case "editar": {
      const pessoas = a.pessoas != null ? Math.max(1, Math.round(Number(a.pessoas)) || atual.pessoas) : atual.pessoas;
      return fim(`"nome" = $3, "telefone" = $4, "pessoas" = $5, "observacao" = $6`,
        String(a.nome ?? atual.nome).trim().slice(0, 80) || atual.nome,
        a.telefone !== undefined ? (String(a.telefone || "").replace(/\D/g, "").slice(0, 20) || null) : atual.telefone,
        pessoas,
        a.observacao !== undefined ? (String(a.observacao || "").trim().slice(0, 300) || null) : atual.observacao);
    }
    case "mover": {
      const hora = normalizarHora(a.hora);
      if (!hora) return { ok: false, motivo: "hora_invalida", explicacao: "Horário inválido.", sugestoes: [] };
      return prisma.$transaction(async (tx) => {
        await trava(tx, franchiseeId, a.data);
        const config = await configNoTx(tx, franchiseeId);
        const doDia = await doPeriodoNoTx(tx, franchiseeId, a.data, a.data);
        const av = avaliarReserva(config, doDia, { data: a.data, hora, pessoas: atual.pessoas, ignorarId: id }, agora);
        const contornavel = !av.ok && ["lotado", "lotado_pessoas", "fora_do_horario", "dia_sem_reserva", "antecedencia", "longe_demais"].includes(av.motivo);
        if (!av.ok && !(a.encaixar && contornavel)) {
          const sugestoes = await sugestoesNoTx(tx, franchiseeId, config, { data: a.data, hora, pessoas: atual.pessoas, ignorarId: id }, agora);
          return { ok: false as const, motivo: av.motivo, explicacao: av.explicacao, sugestoes };
        }
        const linhas = await tx.$queryRawUnsafe<any[]>(
          `UPDATE "ReservaDeMesa" SET "data" = $3, "hora" = $4, "status" = 'CONFIRMADA', "atualizadoEm" = NOW() WHERE "franchiseeId" = $1 AND "id" = $2 RETURNING ${COLUNAS}`,
          franchiseeId, id, a.data, hora,
        );
        const pico = av.ok ? av.pico : { reservas: 0, pessoas: 0 };
        return { ok: true as const, reserva: paraReserva(linhas[0]), ocupacao: { reservas: pico.reservas + 1, pessoas: pico.pessoas + atual.pessoas }, config };
      });
    }
  }
}

/**
 * O cliente pediu para cancelar pelo WhatsApp: só uma reserva DELE (pelo
 * telefone da conversa), confirmada, de hoje em diante. Com data/hora, a que
 * bate; sem, só se ele tiver uma só (com mais de uma o robô pergunta qual).
 */
export async function cancelarReservaDoCliente(
  franchiseeId: string, telefone: string, filtro: { data?: string | null; hora?: string | null; excetoId?: string }, hoje: string,
): Promise<{ ok: true; reserva: Reserva } | { ok: false; motivo: "nenhuma" | "varias"; reservas: Reserva[] }> {
  // `excetoId`: a reserva nova da mesma mensagem (mudança de horário) nunca é a que se cancela.
  const minhas = (await reservasDoTelefone(franchiseeId, telefone, hoje)).filter((r) => r.id !== filtro.excetoId);
  const hora = filtro.hora ? normalizarHora(filtro.hora) : null;
  const casam = minhas.filter((r) => (!filtro.data || r.data === filtro.data) && (!hora || r.hora === hora));
  if (casam.length === 0) return { ok: false, motivo: "nenhuma", reservas: minhas };
  if (casam.length > 1) return { ok: false, motivo: "varias", reservas: casam };
  const r = await mudarReserva(franchiseeId, casam[0].id, { acao: "cancelar" }, { data: hoje, minutos: 0 });
  return r.ok ? { ok: true, reserva: r.reserva } : { ok: false, motivo: "nenhuma", reservas: minhas };
}

// ─── Consumo das mesas que vieram por reserva ────────────────────────────

/**
 * Quanto cada reserva que VEIO consumiu: a conta fechada da mesa ligada a ela
 * (TableSession da mesa, aberta de 1h30 antes até 2h depois da hora marcada).
 * Sem mesa ligada não há como saber — a tela diz isso.
 */
export async function consumoDasReservas(franchiseeId: string, reservas: Reserva[], timeZone: string): Promise<Record<string, number>> {
  const vieram = reservas.filter((r) => r.status === "CHEGOU" && r.mesaId);
  if (!vieram.length) return {};
  const janelas = vieram.map((r) => {
    const t = instanteDaReserva(r.data, r.hora, timeZone).getTime();
    return { r, de: new Date(t - 90 * 60_000), ate: new Date(t + 120 * 60_000) };
  });
  const menor = new Date(Math.min(...janelas.map((j) => j.de.getTime())));
  const maior = new Date(Math.max(...janelas.map((j) => j.ate.getTime())));
  const sessoes = await prisma.tableSession.findMany({
    where: { franchiseeId, tableId: { in: [...new Set(vieram.map((r) => r.mesaId!))] }, openedAt: { gte: menor, lte: maior }, status: "CLOSED" },
    select: { id: true, tableId: true, openedAt: true, totalPaid: true },
    orderBy: { openedAt: "asc" },
  });
  const usadas = new Set<string>();
  const saida: Record<string, number> = {};
  for (const j of janelas) {
    // Cada conta conta uma vez só, para a primeira reserva que cai nela.
    const s = sessoes.find((x) => !usadas.has(x.id) && x.tableId === j.r.mesaId && x.openedAt >= j.de && x.openedAt <= j.ate);
    if (s && (s.totalPaid || 0) > 0) { usadas.add(s.id); saida[j.r.id] = s.totalPaid || 0; }
  }
  return saida;
}
