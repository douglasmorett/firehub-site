/**
 * lib/keeta/loja-na-keeta.ts — a loja do lado da Keeta: status, horário e contato.
 *
 * Tudo aqui é AÇÃO DO LOJISTA, nunca automático. O 99Food ensinou
 * (lib/food99-abertura.ts): amarrar o horário/pausa do FireHub na agenda do
 * app fecha a loja no horário errado e desfaz a pausa que o lojista fez lá.
 * Então o lojista vê o status na Keeta e decide: abrir, pausar, mandar o
 * horário do FireHub, mandar telefone e e-mail.
 *
 * Contrato (merchantUpdate / merchant/{id}/status, Keeta Open Delivery 1.0.7):
 *   - `merchantStatus` sozinho abre/fecha; não pode ir junto com entityType;
 *   - SERVICE: só o serviceType DELIVERY vale; horários em UTC+0, fim > início,
 *     24:00 vira 23:59; período que cruza a meia-noite vai em dois;
 *   - BASIC_INFO: só contactEmails (até 3) e contactPhones valem.
 */
import { prisma } from "@/lib/prisma";
import { fusoDaLoja } from "@/lib/fuso-da-loja";
import { normalizeStoreHours } from "@/lib/store-hours";
import { chamarKeeta, type ResultadoKeeta } from "./api";
import { lojaKeetaDoFranqueado } from "./lojas";

const DIAS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;

async function merchantAtivo(lojaId: string): Promise<string | null> {
  const v = await lojaKeetaDoFranqueado(lojaId);
  return v?.ativa ? v.merchantId : null;
}

const semVinculo: ResultadoKeeta = { ok: false, status: 0, erro: "Loja não está conectada na Keeta", repetir: false };

export async function statusNaKeeta(lojaId: string): Promise<ResultadoKeeta> {
  const m = await merchantAtivo(lojaId);
  if (!m) return semVinculo;
  return chamarKeeta("GET", `/v1/merchant/${encodeURIComponent(m)}/status`);
}

export async function abrirOuPausarNaKeeta(lojaId: string, aberta: boolean): Promise<ResultadoKeeta> {
  const m = await merchantAtivo(lojaId);
  if (!m) return semVinculo;
  return chamarKeeta("POST", `/v1/merchantUpdate/${encodeURIComponent(m)}`, { corpo: { merchantStatus: aberta ? "AVAILABLE" : "UNAVAILABLE" } });
}

/** Minutos que o fuso está à frente do UTC agora (Brasília = -180). */
export function deslocamentoDoFuso(fuso: string, agora = new Date()): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(agora)
      .map((x) => [x.type, x.value]),
  );
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((local - Math.floor(agora.getTime() / 60_000) * 60_000) / 60_000);
}

const hhmm = (s: string) => {
  const [h, m] = String(s || "").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
const hora = (min: number) =>
  min >= 1440 ? "23:59:00.000Z" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00.000Z`;

/**
 * storeHours do FireHub (hora local, turnos que podem virar a noite) →
 * weekHours da Keeta (UTC, cada período dentro de um dia). Períodos iguais em
 * dias diferentes saem juntos num só `dayOfWeek`.
 */
export function horarioParaKeeta(storeHours: unknown, deslocamentoMin: number) {
  const turnos: Array<{ dia: number; ini: number; fim: number }> = [];
  normalizeStoreHours(storeHours).forEach((dia, idx) => {
    if (!dia.active) return;
    for (const t of dia.shifts || []) {
      if (t.active === false || !t.open || !t.close) continue;
      const ini = hhmm(t.open);
      let fim = hhmm(t.close);
      if (fim === ini) continue;
      if (fim < ini) fim += 1440; // vira a noite
      turnos.push({ dia: idx, ini, fim });
    }
  });
  return semanaParaKeeta(turnos, deslocamentoMin);
}

/**
 * Turnos em hora local (dia 0 = segunda, minutos; `fim` pode passar de 1440
 * quando vira a noite) → weekHours da Keeta. Serve a loja e o horário do
 * produto (lib/keeta/cardapio.ts).
 */
export function semanaParaKeeta(turnos: Array<{ dia: number; ini: number; fim: number }>, deslocamentoMin: number) {
  const pedacos: Array<{ dia: number; ini: number; fim: number }> = [];
  const empurrar = (dia: number, ini: number, fim: number) => {
    // Desloca para UTC e corta onde passa da meia-noite.
    let a = ini - deslocamentoMin;
    let b = fim - deslocamentoMin;
    let d = dia;
    while (a < 0) { a += 1440; b += 1440; d = (d + 6) % 7; }
    while (a >= 1440) { a -= 1440; b -= 1440; d = (d + 1) % 7; }
    if (b <= 1440) pedacos.push({ dia: d, ini: a, fim: b });
    else {
      pedacos.push({ dia: d, ini: a, fim: 1440 });
      pedacos.push({ dia: (d + 1) % 7, ini: 0, fim: b - 1440 });
    }
  };
  for (const t of turnos) empurrar(t.dia, t.ini, t.fim);
  const porPeriodo = new Map<string, Set<number>>();
  for (const p of pedacos) {
    if (p.fim - p.ini < 1) continue;
    const k = `${p.ini}-${p.fim}`;
    if (!porPeriodo.has(k)) porPeriodo.set(k, new Set());
    porPeriodo.get(k)!.add(p.dia);
  }
  return [...porPeriodo.entries()].map(([k, dias]) => {
    const [ini, fim] = k.split("-").map(Number);
    return { dayOfWeek: [...dias].sort().map((d) => DIAS[d]), timePeriods: { startTime: hora(ini), endTime: hora(fim) } };
  });
}

export async function enviarHorarioParaKeeta(lojaId: string): Promise<ResultadoKeeta & { periodos?: number }> {
  const m = await merchantAtivo(lojaId);
  if (!m) return semVinculo;
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeHours: true } });
  const weekHours = horarioParaKeeta(loja?.storeHours, deslocamentoDoFuso(await fusoDaLoja(lojaId)));
  if (weekHours.length === 0) return { ok: false, status: 0, erro: "O horário da loja no FireHub está vazio (todos os dias fechados).", repetir: false };
  const r = await chamarKeeta("POST", `/v1/merchantUpdate/${encodeURIComponent(m)}`, {
    corpo: {
      entityType: "SERVICE",
      updatedObjects: [{ id: `${m}-delivery`, serviceType: "DELIVERY", menuId: `${m}-menu`, serviceHours: { id: `${m}-horario`, weekHours } }],
    },
  });
  return { ...r, periodos: weekHours.length };
}

export async function enviarContatoParaKeeta(lojaId: string): Promise<ResultadoKeeta> {
  const m = await merchantAtivo(lojaId);
  if (!m) return semVinculo;
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { email: true, storePhone: true } });
  const fone = String(loja?.storePhone || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (fone.length < 10) return { ok: false, status: 0, erro: "Cadastre o telefone da loja no FireHub (Configurações) antes de enviar.", repetir: false };
  return chamarKeeta("POST", `/v1/merchantUpdate/${encodeURIComponent(m)}`, {
    corpo: {
      entityType: "BASIC_INFO",
      updatedObjects: [{ contactEmails: loja?.email ? [loja.email] : [], contactPhones: { commercialNumber: `55-${fone}`, whatsappNumber: fone } }],
    },
  });
}
