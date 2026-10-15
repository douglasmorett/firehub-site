/**
 * A tela do totem falando com o TEF (pinpad PayGo) do Assistente DESTE
 * computador — firehub-print-assistant/tef/index.js.
 *
 * Toda rota /tef exige o segredo local da licença no header `x-firehub-tef`
 * (vem do /api/totem/auth e do /api/totem/payment/start). O Assistente sobe na
 * primeira porta livre da lista, a mesma escada de lib/print.ts.
 *
 * A tela usa o Assistente só para MOSTRAR o que o pinpad diz e para cancelar;
 * quem diz que o pedido está pago é sempre o servidor (/api/totem/payment-status).
 */
import { fetchAssistente } from "./fetch-assistente";

export const PORTAS_DO_ASSISTENTE = [7899, 7900, 7901, 7891];

export type EstadoTef = {
  id: string;
  pedidoId: string;
  fase: "iniciando" | "pinpad" | "pergunta" | "registrando" | "aprovado" | "recusado" | "cancelado" | "desfeito" | "erro";
  final: boolean;
  mensagem: string;
  pergunta: { tipo: "menu" | "digitar"; prompt: string; opcoes: { texto: string; valor: string }[]; minimo: number; maximo: number; ocultar: boolean } | null;
  podeCancelar: boolean;
};

export type RespostaTef = { ok: boolean; status: number; dados: any; foraDoAr: boolean };

export async function chamarTef(
  porta: number,
  segredo: string,
  caminho: string,
  opcoes: { metodo?: "GET" | "POST"; corpo?: unknown; prazoMs?: number } = {},
): Promise<RespostaTef> {
  const { metodo = "GET", corpo, prazoMs = 4000 } = opcoes;
  try {
    const r = await fetchAssistente(`http://127.0.0.1:${porta}${caminho}`, {
      method: metodo,
      cache: "no-store",
      headers: { "x-firehub-tef": segredo, ...(corpo === undefined ? {} : { "Content-Type": "application/json" }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(prazoMs),
    });
    const dados = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, dados, foraDoAr: false };
  } catch {
    return { ok: false, status: 0, dados: null, foraDoAr: true };
  }
}

/**
 * Acha a porta do Assistente com TEF e diz se o pinpad está pronto. `null` =
 * nenhum Assistente respondeu (fechado, ou o Chrome negou o acesso local).
 */
export async function acharTef(segredo: string): Promise<{ porta: number; status: any } | null> {
  const respostas = await Promise.all(
    PORTAS_DO_ASSISTENTE.map(async (porta) => ({ porta, r: await chamarTef(porta, segredo, "/tef/status", { prazoMs: 2500 }) })),
  );
  // Prefere a porta cujo TEF respondeu (200); depois qualquer uma que tenha
  // respondido (401 = Assistente de pé, mas pareado com outra licença).
  const certa = respostas.find((x) => x.r.ok) ?? respostas.find((x) => !x.r.foraDoAr);
  return certa ? { porta: certa.porta, status: certa.r.ok ? certa.r.dados : { pronto: false, erro: certa.r.dados?.error, status: certa.r.status } } : null;
}
