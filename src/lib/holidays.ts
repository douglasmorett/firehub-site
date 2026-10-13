function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getEasterMonthDay(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function getMoveableHolidays(year: number): Record<string, string> {
  const { month, day } = getEasterMonthDay(year);
  // Criar data da Páscoa em UTC
  const easter = new Date(Date.UTC(year, month - 1, day));
  
  // Sexta-feira Santa (2 dias antes)
  const goodFriday = new Date(easter.getTime() - 2 * 24 * 60 * 60 * 1000);
  // Carnaval (47 dias antes)
  const carnaval = new Date(easter.getTime() - 47 * 24 * 60 * 60 * 1000);
  // Corpus Christi (60 dias depois)
  const corpusChristi = new Date(easter.getTime() + 60 * 24 * 60 * 60 * 1000);

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  return {
    [fmt(goodFriday)]: "Sexta-feira Santa",
    [fmt(carnaval)]: "Carnaval",
    [fmt(corpusChristi)]: "Corpus Christi",
  };
}

const NATIONAL_FIXED: Record<string, string> = {
  "01-01": "Confraternização Universal (Ano Novo)",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "09-07": "Independência do Brasil",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "11-20": "Dia Nacional de Zumbi e da Consciência Negra",
  "12-25": "Natal",
};

const MUNICIPAL_HOLIDAYS: Record<string, Record<string, string>> = {
  "rio das ostras": {
    "04-10": "Aniversário de Rio das Ostras",
  },
  "macae": {
    "06-24": "Dia de São João Batista (Padroeiro)",
    "07-29": "Aniversário de Macaé",
    "09-08": "Dia de Nossa Senhora da Imaculada Conceição",
  },
  "casimiro de abreu": {
    "08-05": "Dia de Nossa Senhora da Saúde",
    "09-15": "Aniversário de Casimiro de Abreu",
  },
  "rio de janeiro": {
    "01-20": "Dia de São Sebastião (Padroeiro)",
    "04-23": "Dia de São Jorge",
  },
  "sao paulo": {
    "01-25": "Aniversário de São Paulo",
  },
  "cabo frio": {
    "08-15": "Dia de Nossa Senhora da Assunção",
    "11-13": "Aniversário de Cabo Frio",
  },
  "armacao dos buzios": {
    "09-15": "Dia de Nossa Senhora Desatadora dos Nós",
    "11-12": "Aniversário de Armação dos Búzios",
  },
  "buzios": {
    "09-15": "Dia de Nossa Senhora Desatadora dos Nós",
    "11-12": "Aniversário de Armação dos Búzios",
  },
  "campos dos goytacazes": {
    "01-15": "Dia de Santo Amaro",
    "03-28": "Aniversário de Campos dos Goytacazes",
    "08-06": "Dia de São Salvador",
  },
};

/**
 * O feriado do dia SÓ pelas tabelas daqui (nacionais fixos, os da Páscoa e os
 * municipais) — sem a brasilapi. É a do robô do WhatsApp, que roda a cada
 * mensagem: a consulta de fora espera até 2 s quando falha, e a falha não fica
 * em cache, então toda resposta atrasaria. `dateStr` é "AAAA-MM-DD" no fuso da
 * loja; devolve o nome do feriado ou null.
 */
export function feriadoLocal(dateStr: string, city: string | null | undefined): string | null {
  const [yearStr, monthStr, dayStr] = String(dateStr || "").split("-");
  const year = parseInt(yearStr, 10);
  if (!year || !monthStr || !dayStr) return null;
  const mmDd = `${monthStr}-${dayStr}`;
  if (NATIONAL_FIXED[mmDd]) return NATIONAL_FIXED[mmDd];
  const moveable = getMoveableHolidays(year);
  if (moveable[dateStr]) return moveable[dateStr];
  if (city) {
    const doMunicipio = MUNICIPAL_HOLIDAYS[normalizeString(city)];
    if (doMunicipio?.[mmDd]) return doMunicipio[mmDd];
  }
  return null;
}

/**
 * A linha de feriado dos DADOS DA LOJA no prompt do robô — vazia em dia comum,
 * para não gastar nada. Pizzaria 17, 12/10/2026 (Nossa Senhora Aparecida,
 * segunda-feira): o robô mandou o rodízio "de segunda a quinta" e a equipe teve
 * de corrigir — "hoje feriado não estamos funcionando com o rodízio".
 */
export function linhaDoFeriadoParaORobo(feriadoDeHoje: string | null, feriadoDeAmanha: string | null): string {
  const linhas: string[] = [];
  if (feriadoDeHoje) linhas.push(`- FERIADO: hoje é feriado (${feriadoDeHoje}). O que a loja diz que não funciona em feriado, hoje não funciona.`);
  if (feriadoDeAmanha) linhas.push(`- FERIADO: amanhã é feriado (${feriadoDeAmanha}).`);
  return linhas.length ? `${linhas.join("\n")}\n` : "";
}

const cachedHolidays: Record<number, any[]> = {};

async function fetchNationalHolidays(year: number): Promise<any[]> {
  if (cachedHolidays[year]) return cachedHolidays[year];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000); // 2s timeout
    const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      cachedHolidays[year] = data;
      return data;
    }
  } catch (e) {
    console.warn("[Holidays API] Erro ao buscar feriados nacionais, usando local fallback:", e);
  }
  return [];
}

export async function checkIsHoliday(
  dateStr: string,
  city: string | null
): Promise<{ isHoliday: boolean; name?: string }> {
  try {
    const [yearStr, monthStr, dayStr] = dateStr.split("-");
    const year = parseInt(yearStr, 10);
    const mmDd = `${monthStr}-${dayStr}`; // ex: "06-04"

    // 1. Verificar Feriados Nacionais via API (com fallback offline)
    const nationalHolidays = await fetchNationalHolidays(year);
    const onlineMatch = nationalHolidays.find((h) => h.date === dateStr);
    if (onlineMatch) {
      return { isHoliday: true, name: onlineMatch.name };
    }

    // Fallback Offline: Feriados Nacionais Fixos
    if (NATIONAL_FIXED[mmDd]) {
      return { isHoliday: true, name: NATIONAL_FIXED[mmDd] };
    }

    // Fallback Offline: Feriados Nacionais Movéis
    const moveable = getMoveableHolidays(year);
    if (moveable[dateStr]) {
      return { isHoliday: true, name: moveable[dateStr] };
    }

    // 2. Verificar Feriados Municipais
    if (city) {
      const normalizedCity = normalizeString(city);
      const cityHolidays = MUNICIPAL_HOLIDAYS[normalizedCity];
      if (cityHolidays && cityHolidays[mmDd]) {
        return { isHoliday: true, name: cityHolidays[mmDd] };
      }
    }

    return { isHoliday: false };
  } catch (err) {
    console.error("[checkIsHoliday] Erro:", err);
    return { isHoliday: false };
  }
}
