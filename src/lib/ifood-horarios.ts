/**
 * /src/lib/ifood-horarios.ts
 *
 * Tradução dos horários entre a tela e a Merchant API.
 *
 * A tela trabalha agrupada por dia — `[{ dayOfWeek, shifts: [{ start: "10:00",
 * duration }] }]` — porque é assim que o roteiro do iFood descreve ("sábado das
 * 10 às 19"). A API trabalha com a lista plana: `{ storeId, shifts: [{
 * dayOfWeek, start: "10:00:00", duration }] }`. Mandar o formato agrupado faz o
 * PUT voltar 400, e ler a resposta da API como se fosse agrupada mostra
 * "nenhum horário cadastrado" com a loja cheia de turnos.
 */

export type TurnoDaTela = { start: string; duration: number };
export type DiaDaTela = { dayOfWeek: string; shifts: TurnoDaTela[] };
export type TurnoDaApi = { dayOfWeek: string; start: string; duration: number };

const ORDEM = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

/** "10:00" ou "10:00:00" → "10:00:00" (o formato que a API devolve e aceita). */
function comSegundos(hora: string) {
  const [h = "00", m = "00", s = "00"] = String(hora).split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}:${s.padStart(2, "0")}`;
}

/** Corpo do PUT a partir do que a tela manda (agrupado ou já plano). */
export function corpoDoPut(merchantId: string, corpo: any): { storeId: string; shifts: TurnoDaApi[] } {
  const dias: any[] = Array.isArray(corpo?.openingHours) ? corpo.openingHours : [];
  const planos: any[] = Array.isArray(corpo?.shifts) ? corpo.shifts : Array.isArray(corpo) ? corpo : [];

  const shifts: TurnoDaApi[] = dias.length
    ? dias.flatMap((d) =>
        (d?.shifts ?? []).map((t: any) => ({
          dayOfWeek: String(d.dayOfWeek),
          start: comSegundos(t.start),
          duration: Number(t.duration),
        })),
      )
    : planos.map((t) => ({
        dayOfWeek: String(t.dayOfWeek),
        start: comSegundos(t.start),
        duration: Number(t.duration),
      }));

  return { storeId: merchantId, shifts };
}

/** Resposta da API (plana) → agrupada por dia, na ordem da semana. */
export function agruparPorDia(dados: any): DiaDaTela[] {
  const lista: any[] = Array.isArray(dados?.shifts) ? dados.shifts : Array.isArray(dados) ? dados : [];
  const porDia = new Map<string, TurnoDaTela[]>();
  for (const t of lista) {
    if (!t?.dayOfWeek) continue;
    const turnos = porDia.get(t.dayOfWeek) ?? [];
    turnos.push({ start: String(t.start ?? "").slice(0, 5), duration: Number(t.duration) });
    porDia.set(t.dayOfWeek, turnos);
  }
  return [...porDia.entries()]
    .sort((a, b) => ORDEM.indexOf(a[0]) - ORDEM.indexOf(b[0]))
    .map(([dayOfWeek, shifts]) => ({
      dayOfWeek,
      shifts: shifts.sort((x, y) => x.start.localeCompare(y.start)),
    }));
}
