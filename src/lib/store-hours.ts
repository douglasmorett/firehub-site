import { dataDaLoja, relogioDaLoja } from "@/lib/fuso";

export const DAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

export const DAY_MAP: Record<string, string> = {
  "Segunda": "MONDAY",
  "Terça": "TUESDAY",
  "Quarta": "WEDNESDAY",
  "Quinta": "THURSDAY",
  "Sexta": "FRIDAY",
  "Sábado": "SATURDAY",
  "Domingo": "SUNDAY",
};

export const DAY_KEY_MAP: Record<string, string> = {
  seg: "Segunda",
  segunda: "Segunda",
  "segunda-feira": "Segunda",
  mon: "Segunda",
  monday: "Segunda",
  ter: "Terça",
  terca: "Terça",
  terça: "Terça",
  "terça-feira": "Terça",
  "terca-feira": "Terça",
  tue: "Terça",
  tuesday: "Terça",
  qua: "Quarta",
  quarta: "Quarta",
  "quarta-feira": "Quarta",
  wed: "Quarta",
  wednesday: "Quarta",
  qui: "Quinta",
  quinta: "Quinta",
  "quinta-feira": "Quinta",
  thu: "Quinta",
  thursday: "Quinta",
  sex: "Sexta",
  sexta: "Sexta",
  "sexta-feira": "Sexta",
  fri: "Sexta",
  friday: "Sexta",
  sab: "Sábado",
  sabado: "Sábado",
  sábado: "Sábado",
  "sábado-feira": "Sábado",
  "sabado-feira": "Sábado",
  sat: "Sábado",
  saturday: "Sábado",
  dom: "Domingo",
  domingo: "Domingo",
  sun: "Domingo",
  sunday: "Domingo",
};

export interface StoreShift {
  open: string;
  close: string;
  active?: boolean;
}

export interface StoreDayHour {
  day: string;
  open: string;
  close: string;
  active: boolean;
  shifts: StoreShift[];
}

export function defaultHours(): StoreDayHour[] {
  return DAYS.map((d) => ({
    day: d,
    open: "18:00",
    close: "23:00",
    active: true,
    shifts: [{ open: "18:00", close: "23:00" }],
  }));
}

/**
 * Normaliza storeHours vindos do banco de dados (que podem ser array, JSON string, ou objeto legado { seg: ..., ter: ... })
 * para sempre retornar um StoreDayHour[] válido com 7 dias da semana.
 */
export function normalizeStoreHours(raw: any): StoreDayHour[] {
  let parsed = raw;

  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return defaultHours();
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return defaultHours();
  }

  // Se já for um Array
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return defaultHours();

    return DAYS.map((day, idx) => {
      const item =
        parsed.find((p: any) => {
          if (!p || typeof p !== "object") return false;
          const name = (p.day || p.dayName || "").toLowerCase().trim();
          return DAY_KEY_MAP[name] === day || name === day.toLowerCase();
        }) || parsed[idx];

      if (item && typeof item === "object") {
        const active = item.active !== false;
        const open = item.open || "18:00";
        const close = item.close || "23:00";
        const shifts: StoreShift[] =
          Array.isArray(item.shifts) && item.shifts.length > 0
            ? item.shifts
                .filter((s: any) => s && typeof s === "object")
                .map((s: any) => ({
                  open: s.open || open || "18:00",
                  close: s.close || close || "23:00",
                }))
            : [{ open, close }];

        return {
          day,
          open: shifts[0]?.open || open,
          close: shifts[shifts.length - 1]?.close || close,
          active,
          shifts: shifts.length > 0 ? shifts : [{ open, close }],
        };
      }

      return {
        day,
        open: "18:00",
        close: "23:00",
        active: true,
        shifts: [{ open: "18:00", close: "23:00" }],
      };
    });
  }

  // Se for um Objeto (ex: { seg: { open: "09:00", close: "22:00", active: true }, ... })
  return DAYS.map((day) => {
    let foundEntry: any = null;
    for (const [k, v] of Object.entries(parsed)) {
      const normalizedKey = DAY_KEY_MAP[k.toLowerCase().trim()] || k;
      if (normalizedKey.toLowerCase() === day.toLowerCase()) {
        foundEntry = v;
        break;
      }
    }

    if (foundEntry && typeof foundEntry === "object") {
      const active = foundEntry.active !== false;
      const open = foundEntry.open || "18:00";
      const close = foundEntry.close || "23:00";
      const shifts: StoreShift[] =
        Array.isArray(foundEntry.shifts) && foundEntry.shifts.length > 0
          ? foundEntry.shifts
              .filter((s: any) => s && typeof s === "object")
              .map((s: any) => ({
                open: s.open || open || "18:00",
                close: s.close || close || "23:00",
              }))
          : [{ open, close }];

      return {
        day,
        open: shifts[0]?.open || open,
        close: shifts[shifts.length - 1]?.close || close,
        active,
        shifts: shifts.length > 0 ? shifts : [{ open, close }],
      };
    }

    return {
      day,
      open: "18:00",
      close: "23:00",
      active: true,
      shifts: [{ open: "18:00", close: "23:00" }],
    };
  });
}

/**
 * Verifica se a loja está aberta no momento com base nos horários configurados.
 *
 * O relógio é o DA LOJA (`timezone`, padrão America/Sao_Paulo), nunca o do
 * processo. Esta função rodava com `new Date().getHours()`: no navegador dava
 * certo por sorte (cliente e loja no mesmo fuso), mas no servidor — que roda
 * em UTC — dizia "fechada" três horas antes da hora, e o checkout do site
 * recusou pedido de todas as lojas das 20:15 às 23:15, de 27/08 a 06/09/2026.
 * Agora ela responde igual no servidor, no SSR e no navegador, e ainda acerta
 * para um cliente em outro fuso pedindo de uma loja em Brasília.
 *
 * `agora` existe para teste; em produção não passe.
 */
export function isStoreOpen(
  rawHours: any,
  rawPause?: any,
  timezone?: string | null,
  agora: Date = new Date()
): { open: boolean; text: string } {
  // Verificar pausa programada
  if (rawPause && typeof rawPause === "object" && rawPause.active) {
    const today = dataDaLoja(timezone, agora);
    const from = rawPause.from || "";
    const to = rawPause.to || "";
    if (from && to && today >= from && today <= to) {
      return {
        open: false,
        text: `Loja em pausa (${rawPause.reason || "Férias"}) até ${to}`,
      };
    }
  }

  const hours = normalizeStoreHours(rawHours);
  const { minutos: nowMin, diaIdx: dayIdx } = relogioDaLoja(timezone, agora);
  const todayHour = hours[dayIdx];

  if (!todayHour || !todayHour.active) {
    return { open: false, text: "Fechado hoje" };
  }

  if (Array.isArray(todayHour.shifts) && todayHour.shifts.length > 0) {
    const activeShifts = todayHour.shifts.filter(
      (s) => s.open && s.close && s.active !== false
    );

    for (const shift of activeShifts) {
      const [oh, om] = (shift.open || "").split(":").map(Number);
      const [ch, cm] = (shift.close || "").split(":").map(Number);
      const startMin = (oh || 0) * 60 + (om || 0);
      const endMin = (ch || 0) * 60 + (cm || 0);

      // Horário normal (ex: 18:00 às 23:00)
      if (endMin >= startMin) {
        if (nowMin >= startMin && nowMin <= endMin) {
          return { open: true, text: `Aberto até as ${shift.close}` };
        }
      } else {
        // Vira a noite (ex: 18:00 às 02:00)
        if (nowMin >= startMin || nowMin <= endMin) {
          return { open: true, text: `Aberto até as ${shift.close}` };
        }
      }
    }

    const nextShift = activeShifts.find((s) => {
      const [oh, om] = (s.open || "").split(":").map(Number);
      return nowMin < (oh || 0) * 60 + (om || 0);
    });

    if (nextShift) {
      return { open: false, text: `Abre às ${nextShift.open}` };
    }

    return { open: false, text: "Fechado · Abre amanhã" };
  }

  if (todayHour.open && todayHour.close) {
    const [oh, om] = todayHour.open.split(":").map(Number);
    const [ch, cm] = todayHour.close.split(":").map(Number);
    const startMin = (oh || 0) * 60 + (om || 0);
    const endMin = (ch || 0) * 60 + (cm || 0);

    if (endMin >= startMin) {
      if (nowMin >= startMin && nowMin <= endMin) {
        return { open: true, text: `Aberto até as ${todayHour.close}` };
      }
    } else {
      if (nowMin >= startMin || nowMin <= endMin) {
        return { open: true, text: `Aberto até as ${todayHour.close}` };
      }
    }
    return { open: false, text: `Abre às ${todayHour.open}` };
  }

  return { open: true, text: "Aberto" };
}
