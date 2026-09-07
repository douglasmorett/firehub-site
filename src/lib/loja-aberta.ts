/**
 * A loja está aberta AGORA? E, se não, quando abre?
 *
 * ── Por que não dá para usar `isStoreOpen` ──────────────────────────────────
 * Aquela função (`store-hours.ts`) lê `new Date().getHours()`, que responde no
 * fuso do SERVIDOR. O container roda em UTC: às 21h de Brasília ele já acha que
 * é meia-noite, e uma loja aberta até 23h aparece como fechada no meio do
 * jantar. Ela continua servindo à tela do navegador, onde o fuso é o do
 * visitante; aqui, no servidor, precisa ser o fuso da LOJA.
 *
 * ── Por que o robô precisa disto ────────────────────────────────────────────
 * O prompt sabia dizer os horários ("hoje funciona das 18h às 23h") mas não
 * sabia que horas são. Com a loja fechada o robô anotava pedido normalmente —
 * pedido que ninguém ia preparar, feito por um cliente que só descobre no dia
 * seguinte. Agora ele recebe o estado pronto e a ordem de não vender.
 */
import { normalizeStoreHours, type StoreDayHour } from "@/lib/store-hours";
import { FUSO_PADRAO, relogioDaLoja } from "@/lib/fuso";

export { FUSO_PADRAO, relogioDaLoja };

/** Segunda = 0, como a lista de `normalizeStoreHours`. */
const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];

function paraMinutos(hhmm: string): number | null {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function turnosDoDia(dia: StoreDayHour | undefined): Array<{ open: string; close: string }> {
  if (!dia || !dia.active) return [];
  const lista = Array.isArray(dia.shifts) && dia.shifts.length > 0
    ? dia.shifts.filter((s) => s?.open && s?.close && s.active !== false)
    : dia.open && dia.close
      ? [{ open: dia.open, close: dia.close }]
      : [];
  return lista.map((s) => ({ open: s.open, close: s.close }));
}

export type EstadoDaLoja = {
  aberta: boolean;
  /** Por que está fechada. Ausente quando aberta. */
  motivo?: "fora_do_horario" | "fechada_hoje" | "pausa" | "fechada_manualmente";
  /** Quando aberta: a hora em que fecha ("23:30"). */
  fechaAs?: string;
  /** Quando fechada: quando volta a abrir, se der para saber. */
  proximaAbertura?: { dia: string; hora: string; ehHoje: boolean; ehAmanha: boolean };
  /** Frase pronta, do jeito que o cliente entende. */
  texto: string;
};

/**
 * O estado da loja, no fuso dela.
 *
 * Três coisas fecham uma loja, e todas contam aqui: o interruptor manual do
 * painel (`storeOpen`), a pausa programada (férias) e o horário do dia.
 */
export function estadoDaLoja(opts: {
  storeHours?: unknown;
  storePause?: any;
  storeOpen?: boolean | null;
  timezone?: string | null;
  agora?: Date;
}): EstadoDaLoja {
  const agora = opts.agora || new Date();
  const horas = normalizeStoreHours(opts.storeHours);
  const { minutos, diaIdx } = relogioDaLoja(opts.timezone, agora);

  // 1. Pausa programada (férias, reforma). Vence qualquer horário.
  const pausa = opts.storePause;
  if (pausa && typeof pausa === "object" && pausa.active) {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: opts.timezone || FUSO_PADRAO })
      .format(agora); // YYYY-MM-DD no fuso da loja
    if (pausa.from && pausa.to && hoje >= pausa.from && hoje <= pausa.to) {
      return {
        aberta: false,
        motivo: "pausa",
        texto: `A loja está temporariamente fechada${pausa.reason ? ` (${pausa.reason})` : ""} e volta a atender em ${formatarData(pausa.to)}.`,
      };
    }
  }

  // 2. Interruptor manual do painel. O lojista fecha na correria; se o robô
  //    continuasse vendendo, o pedido cairia numa loja que decidiu parar.
  if (opts.storeOpen === false) {
    return {
      aberta: false,
      motivo: "fechada_manualmente",
      texto: "A loja está fechada no momento.",
    };
  }

  // 3. Turno de hoje — inclusive o de ONTEM que atravessou a madrugada.
  //    Sem isso, uma loja que fecha às 02:00 aparece como fechada à 00:30, que
  //    é justamente quando ela está mais cheia.
  const ontemIdx = (diaIdx + 6) % 7;
  for (const t of turnosDoDia(horas[ontemIdx])) {
    const abre = paraMinutos(t.open);
    const fecha = paraMinutos(t.close);
    if (abre == null || fecha == null) continue;
    if (fecha < abre && minutos <= fecha) {
      return { aberta: true, fechaAs: t.close, texto: `Aberta agora, até as ${t.close}.` };
    }
  }

  for (const t of turnosDoDia(horas[diaIdx])) {
    const abre = paraMinutos(t.open);
    const fecha = paraMinutos(t.close);
    if (abre == null || fecha == null) continue;
    const dentro = fecha >= abre ? minutos >= abre && minutos <= fecha : minutos >= abre;
    if (dentro) {
      return { aberta: true, fechaAs: t.close, texto: `Aberta agora, até as ${t.close}.` };
    }
  }

  // 4. Fechada: quando abre de novo? Hoje mais tarde, ou o próximo dia ativo.
  const aindaHoje = turnosDoDia(horas[diaIdx])
    .map((t) => ({ hora: t.open, min: paraMinutos(t.open) }))
    .filter((t): t is { hora: string; min: number } => t.min != null && t.min > minutos)
    .sort((a, b) => a.min - b.min)[0];

  if (aindaHoje) {
    return {
      aberta: false,
      motivo: "fora_do_horario",
      proximaAbertura: { dia: DIAS[diaIdx], hora: aindaHoje.hora, ehHoje: true, ehAmanha: false },
      texto: `A loja está fechada agora e abre hoje às ${aindaHoje.hora}.`,
    };
  }

  for (let salto = 1; salto <= 7; salto++) {
    const idx = (diaIdx + salto) % 7;
    const primeiro = turnosDoDia(horas[idx])
      .map((t) => ({ hora: t.open, min: paraMinutos(t.open) }))
      .filter((t): t is { hora: string; min: number } => t.min != null)
      .sort((a, b) => a.min - b.min)[0];
    if (!primeiro) continue;

    const ehAmanha = salto === 1;
    const quando = ehAmanha ? "amanhã" : DIAS[idx];
    return {
      aberta: false,
      motivo: salto === 0 ? "fechada_hoje" : "fora_do_horario",
      proximaAbertura: { dia: DIAS[idx], hora: primeiro.hora, ehHoje: false, ehAmanha },
      texto: `A loja está fechada agora e abre ${quando} às ${primeiro.hora}.`,
    };
  }

  // Nenhum dia ativo na semana inteira: não invente um horário.
  return {
    aberta: false,
    motivo: "fechada_hoje",
    texto: "A loja está fechada no momento e não há horário de funcionamento cadastrado.",
  };
}

/** "2026-09-15" → "15/09". */
function formatarData(iso: string): string {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}` : String(iso);
}

/**
 * O bloco que entra no prompt do robô.
 *
 * Escrito como ordem, não como informação: um modelo que recebe "a loja está
 * fechada" no meio de um cardápio inteiro continua vendendo, porque vender é o
 * que o resto do prompt pede. O que segura é a proibição explícita.
 */
export function instrucaoDeHorario(estado: EstadoDaLoja): string {
  if (estado.aberta) {
    return `SITUAÇÃO DA LOJA AGORA: ABERTA${estado.fechaAs ? ` (fecha às ${estado.fechaAs})` : ""}. Pode anotar pedidos normalmente.`;
  }

  const quando = estado.proximaAbertura
    ? estado.proximaAbertura.ehHoje
      ? `hoje às ${estado.proximaAbertura.hora}`
      : estado.proximaAbertura.ehAmanha
        ? `amanhã às ${estado.proximaAbertura.hora}`
        : `${estado.proximaAbertura.dia} às ${estado.proximaAbertura.hora}`
    : null;

  return `
🔴 SITUAÇÃO DA LOJA AGORA: **FECHADA**. ${estado.texto}
REGRA OBRIGATÓRIA ENQUANTO A LOJA ESTIVER FECHADA:
- É PROIBIDO anotar pedido, fechar pedido, somar total, pedir endereço ou forma de pagamento. NÃO mande o link do site para finalizar compra.
- NUNCA diga "já vou anotar", "seu pedido foi registrado" ou "vai sair em X minutos". Ninguém vai preparar nada agora.
- SEMPRE avise, logo na primeira resposta, que a loja está fechada${quando ? ` e que abre ${quando}` : ""}.
- VOCÊ PODE e DEVE continuar ajudando: tirar dúvidas, falar dos produtos, dos preços e das promoções, e enviar o cardápio se ele pedir.
- Se o cliente insistir em pedir, seja gentil e firme: explique que só dá para registrar quando a loja abrir${quando ? `, ${quando}` : ""}, e convide a voltar nesse horário.
- Modelo de tom: "No momento a gente está fechado${quando ? `, abrimos ${quando}` : ""}! 😊 Mas posso te falar tudo sobre o cardápio e já te mando ele aqui, aí é só chegar na hora e pedir!"
`.trim();
}
