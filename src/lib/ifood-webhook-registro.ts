/**
 * /src/lib/ifood-webhook-registro.ts
 *
 * Memória curta das últimas chamadas que o webhook do iFood recebeu, para a
 * tela de homologação provar "endpoint configurado, respondendo 200" com
 * tráfego REAL — os KEEPALIVE chegam a cada meio minuto e são a melhor
 * testemunha de disponibilidade que existe.
 *
 * É memória de processo de propósito: o servidor standalone roda num processo
 * só, o vídeo precisa dos últimos minutos, e nenhum lojista depende disto.
 * Reiniciou o container, a lista recomeça — e o próximo KEEPALIVE a repovoa
 * em segundos. Vive em globalThis para o hot-reload de desenvolvimento não
 * zerar a lista a cada edição de arquivo.
 */
export type ChamadaWebhook = { quando: string; codigo: string; status: number };

const MAXIMO = 30;

const caixa = globalThis as unknown as { __ifoodWebhookChamadas?: ChamadaWebhook[] };
if (!caixa.__ifoodWebhookChamadas) caixa.__ifoodWebhookChamadas = [];
const chamadas = caixa.__ifoodWebhookChamadas;

export function registrarChamadaWebhook(codigo: string, status: number) {
  chamadas.unshift({ quando: new Date().toISOString(), codigo, status });
  if (chamadas.length > MAXIMO) chamadas.length = MAXIMO;
}

export function chamadasRecentesWebhook(): ChamadaWebhook[] {
  return chamadas.slice();
}
