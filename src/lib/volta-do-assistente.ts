/**
 * /src/lib/volta-do-assistente.ts
 *
 * QUANDO O ASSISTENTE VOLTA, O QUE ELE AINDA PODE IMPRIMIR SOZINHO.
 *
 * Regra do dono (24/09/2026, repetida em 27/09): "ativou o Assistente, ele só
 * imprime o que entrar depois dele ativo". O teto zero do 1.2.25 cumpria isso
 * — mas só para quem diz há quanto tempo está aberto (`abertoHaSeg`), e em
 * 27/09 só 1 das 13 lojas estava nessa versão. As outras (1.2.9 a 1.2.24)
 * reabriam e recebiam a última meia hora da fila de uma vez.
 *
 * O servidor sabe a hora da consulta anterior de cada PC (o Assistente pergunta
 * a cada 3 s), então enxerga a volta de qualquer versão:
 *
 *   • VOLTA RÁPIDA (reinício, atualização, internet que piscou — até 3 min):
 *     o corte é a consulta anterior. O que entrou DURANTE o reinício sai (não
 *     é cuspir, é o pedido novo que chegou no meio da atualização); o que já
 *     tinha sido entregue ao Assistente antes nunca volta, nem o que ficou
 *     pendurado sem confirmação.
 *   • VOLTA DEPOIS DE UM TEMPO FORA (PC desligado, Assistente fechado): o corte
 *     é a volta. Só o que entrar dali em diante.
 *
 * O Assistente 1.2.25+ informa a própria abertura, e com ela o servidor sabe
 * até que o processo é novo mesmo sem intervalo. O antigo só é reconhecido
 * pelo intervalo entre consultas (mais de 20 s sem perguntar).
 *
 * A memória é do processo do servidor: depois de um deploy ela começa vazia, e
 * a primeira consulta de cada PC não conta como volta — um deploy não pode
 * engolir as comandas que chegaram enquanto o servidor reiniciava. Nesse caso
 * vale o que já valia antes (o `abertoHaSeg` do 1.2.25+, ou o teto de 30 min).
 */

/** Sem perguntar por mais que isto, o Assistente antigo "voltou". Ele pergunta a cada 3 s. */
export const INTERVALO_QUE_E_VOLTA_MS = 20_000;
/** Até isto fora, foi reinício ou atualização: o corte é a consulta anterior. */
export const VOLTA_RAPIDA_MS = 3 * 60_000;
/** A decisão vale enquanto a fila ainda enxergaria o que ela corta (o teto de 30 min). */
export const VALIDADE_DA_DECISAO_MS = 30 * 60_000;
/** Folga da viagem da consulta, a mesma que o teto zero já usava. */
const FOLGA_MS = 10_000;

type Decisao = { abertura: number; corte: number };

const ultimaConsulta = new Map<string, number>();
const decisoes = new Map<string, Decisao>();
let ultimaFaxina = 0;

function faxina(agora: number) {
  if (agora - ultimaFaxina < 10 * 60_000) return;
  ultimaFaxina = agora;
  for (const [k, t] of ultimaConsulta) if (agora - t > 24 * 3600_000) ultimaConsulta.delete(k);
  for (const [k, d] of decisoes) if (agora - d.abertura > VALIDADE_DA_DECISAO_MS) decisoes.delete(k);
}

/**
 * Registra a consulta deste PC e devolve o CORTE: pedido criado até este
 * instante (ms) não entra na impressão automática. `null` = nenhum corte além
 * do que a fila já aplica.
 *
 * `chave` identifica o PC (loja + endereço). `abertoHaSeg` é o que o 1.2.25+
 * manda; `null` para o Assistente antigo.
 */
export function corteDaVolta(chave: string, abertoHaSeg: number | null, agora = Date.now()): number | null {
  faxina(agora);
  const antes = ultimaConsulta.get(chave);
  ultimaConsulta.set(chave, agora);

  let decisao = decisoes.get(chave);
  if (decisao && agora - decisao.abertura > VALIDADE_DA_DECISAO_MS) {
    decisoes.delete(chave);
    decisao = undefined;
  }

  let abertura: number | null = null;
  if (abertoHaSeg != null && Number.isFinite(abertoHaSeg) && abertoHaSeg >= 0) {
    const informada = agora - abertoHaSeg * 1000;
    // Mesmo processo de antes (a abertura informada não mudou): nada a decidir.
    const mesmoProcesso = decisao && Math.abs(informada - decisao.abertura) < 30_000;
    // Aberto há mais tempo que a validade: o teto de 30 min já basta.
    if (!mesmoProcesso && agora - informada <= VALIDADE_DA_DECISAO_MS) abertura = informada;
  } else if (antes != null && agora - antes > INTERVALO_QUE_E_VOLTA_MS) {
    abertura = agora;
  }

  if (abertura != null) {
    // A consulta anterior foi DESTE PC, pouco antes de ele abrir: foi reinício.
    // (Se ela é posterior à abertura, veio de outro PC no mesmo endereço.)
    const reinicio = antes != null && antes <= abertura && abertura - antes <= VOLTA_RAPIDA_MS;
    decisao = { abertura, corte: reinicio ? antes! : abertura - FOLGA_MS };
    decisoes.set(chave, decisao);
  }

  return decisao ? decisao.corte : null;
}

/** Só para os testes. */
export function esquecerAssistentes() {
  ultimaConsulta.clear();
  decisoes.clear();
  ultimaFaxina = 0;
}
