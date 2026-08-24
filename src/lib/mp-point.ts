/**
 * FireHub — Mercado Pago Point (maquininha)
 *
 * Docs conferidas:
 *  - Listar terminais: GET   https://api.mercadopago.com/terminals/v1/list
 *  - Modo de operação: PATCH https://api.mercadopago.com/terminals/v1/setup
 *  - Criar cobrança:   POST  https://api.mercadopago.com/v1/orders  (type "point")
 *  - Consultar:        GET   https://api.mercadopago.com/v1/orders/{id}
 *  - Cancelar:         POST  https://api.mercadopago.com/v1/orders/{id}/cancel
 *
 * O accessToken SEMPRE vem por parâmetro, nunca de process.env: a maquininha é
 * da loja e o dinheiro precisa cair na conta dela. Usar o token global do
 * FireHub aqui faria a venda do lojista entrar na nossa conta.
 *
 * Nenhuma função aqui lança para o chamador nem devolve sucesso sem resposta do
 * MP. Quando dá errado, volta { ok: false } com o motivo — quem chama decide o
 * que mostrar no caixa.
 */

const MP_API = "https://api.mercadopago.com";

// A Point é assíncrona do lado do cliente: o POST só registra a cobrança no
// visor, não espera ninguém passar o cartão. 15s cobre a rede com folga sem
// deixar o caixa travado esperando.
const TIMEOUT_MS = 15_000;

// Sem prazo, uma cobrança abandonada (cliente desistiu, ninguém cancelou) fica
// presa no visor e o próximo cliente não consegue pagar naquela maquininha.
const EXPIRACAO_PADRAO = "PT15M";

export type ResultadoPoint<T> =
  | { ok: true; dados: T }
  | { ok: false; status: number; erro: string };

export interface TerminalPoint {
  id: string;               // terminal_id — é o que vai em config.point.terminal_id
  posId?: string;
  storeId?: string;
  externalPosId?: string;
  operatingMode?: string;   // PDV | STANDALONE | UNDEFINED
}

export interface OrdemPoint {
  id: string;               // "ORD01J..." — grava em CustomerOrder.posOrderId
  status: string;           // created | processed | canceled | refunded | failed | expired | action_required
  statusDetail: string;
  externalReference?: string;
  terminalId?: string;
  amount?: string;          // decimal em string, do jeito que o MP devolve
  paymentId?: string;       // "PAY01J..." do primeiro pagamento da ordem
  bruto: any;               // resposta crua, para diagnóstico e campos ainda não normalizados
}

/**
 * ÚNICO lugar do projeto que formata valor para a Point.
 *
 * A Orders API espera decimal em string ("15.00"); a API antiga de
 * payment-intents esperava inteiro em centavos (1500) — misturar as duas cobra
 * 100x errado do cliente. A conta é feita com inteiros em vez de dividir por
 * 100 em ponto flutuante, que produz coisas como "15.000000000000002".
 */
export function centavosParaAmount(centavos: number): string {
  if (!Number.isFinite(centavos)) {
    throw new Error(`Valor inválido para a maquininha: ${centavos}`);
  }
  const inteiro = Math.round(centavos);
  if (inteiro < 0) {
    throw new Error(`Valor negativo não pode ir para a maquininha: ${centavos}`);
  }
  const reais = Math.floor(inteiro / 100);
  const resto = inteiro % 100;
  return `${reais}.${String(resto).padStart(2, "0")}`;
}

/** Junta a mensagem de erro a partir dos formatos que o MP usa (errors[], cause[], message). */
function extrairErro(corpo: any, textoCru: string, status: number): string {
  if (corpo && Array.isArray(corpo.errors) && corpo.errors.length) {
    return corpo.errors
      .map((e: any) => [e?.code, e?.message || e?.description].filter(Boolean).join(": "))
      .filter(Boolean)
      .join(" | ");
  }
  if (corpo && Array.isArray(corpo.cause) && corpo.cause.length) {
    return corpo.cause
      .map((c: any) => [c?.code, c?.description || c?.message].filter(Boolean).join(": "))
      .filter(Boolean)
      .join(" | ");
  }
  if (corpo?.message) return String(corpo.message);
  if (corpo?.error) return String(corpo.error);
  return textoCru.slice(0, 500) || `HTTP ${status} sem corpo`;
}

/**
 * Chamada crua ao MP. No erro registra o corpo inteiro no console — sem isso um
 * 400 da Orders API vira só "deu erro" e ninguém descobre que o problema era a
 * maquininha fora do modo PDV.
 */
async function chamarMp(
  caminho: string,
  init: { metodo: "GET" | "POST" | "PATCH"; accessToken: string; corpo?: any; idempotencyKey?: string },
): Promise<ResultadoPoint<any>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.accessToken}`,
    "Content-Type": "application/json",
  };
  if (init.idempotencyKey) headers["X-Idempotency-Key"] = init.idempotencyKey;

  let res: Response;
  let texto: string;
  try {
    res = await fetch(`${MP_API}${caminho}`, {
      method: init.metodo,
      headers,
      body: init.corpo === undefined ? undefined : JSON.stringify(init.corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    texto = await res.text();
  } catch (err: any) {
    const motivo =
      err?.name === "TimeoutError" || err?.name === "AbortError"
        ? `Mercado Pago não respondeu em ${TIMEOUT_MS / 1000}s`
        : `Falha de rede ao falar com o Mercado Pago: ${err?.message || err}`;
    console.error(`[MP Point] ${init.metodo} ${caminho} — ${motivo}`);
    return { ok: false, status: 0, erro: motivo };
  }

  let corpo: any = null;
  if (texto) {
    try {
      corpo = JSON.parse(texto);
    } catch {
      corpo = null;
    }
  }

  if (!res.ok) {
    const erro = extrairErro(corpo, texto, res.status);
    console.error(`[MP Point] ${init.metodo} ${caminho} -> HTTP ${res.status}`, texto.slice(0, 2000));
    return { ok: false, status: res.status, erro };
  }

  // 200 com corpo ilegível é resposta que não dá para confirmar; tratar como
  // sucesso aqui é exatamente o "sucesso falso" que não pode existir no caixa.
  if (texto && corpo === null) {
    console.error(`[MP Point] ${init.metodo} ${caminho} -> 200 com corpo não-JSON`, texto.slice(0, 2000));
    return { ok: false, status: res.status, erro: "Mercado Pago respondeu em formato inesperado." };
  }

  return { ok: true, dados: corpo ?? {} };
}

function normalizarTerminal(t: any): TerminalPoint {
  return {
    id: String(t?.id ?? ""),
    posId: t?.pos_id != null ? String(t.pos_id) : undefined,
    storeId: t?.store_id != null ? String(t.store_id) : undefined,
    externalPosId: t?.external_pos_id != null ? String(t.external_pos_id) : undefined,
    operatingMode: t?.operating_mode != null ? String(t.operating_mode) : undefined,
  };
}

function normalizarOrdem(d: any): OrdemPoint {
  const pagamento = d?.transactions?.payments?.[0];
  return {
    id: String(d?.id ?? ""),
    status: String(d?.status ?? ""),
    statusDetail: String(d?.status_detail ?? ""),
    externalReference: d?.external_reference != null ? String(d.external_reference) : undefined,
    terminalId: d?.config?.point?.terminal_id != null ? String(d.config.point.terminal_id) : undefined,
    amount: pagamento?.amount != null ? String(pagamento.amount) : undefined,
    paymentId: pagamento?.id != null ? String(pagamento.id) : undefined,
    bruto: d,
  };
}

const SEM_CONEXAO = "Loja não conectada ao Mercado Pago — refaça a conexão em Pagamentos.";

/**
 * Lista as maquininhas da conta do lojista.
 *
 * A resposta é paginada e percorremos até fechar o total: uma rede com mais de
 * 50 terminais na mesma conta veria só a primeira página, e justo a maquininha
 * que o lojista quer cadastrar não apareceria na tela.
 */
export async function listarTerminais(accessToken: string): Promise<ResultadoPoint<TerminalPoint[]>> {
  if (!accessToken) return { ok: false, status: 0, erro: SEM_CONEXAO };

  const limite = 50;
  const terminais: TerminalPoint[] = [];
  let offset = 0;

  // Trava de segurança: se o MP devolver um paging.total incoerente com o que
  // manda, é melhor parar em 500 terminais do que girar preso neste laço.
  for (let pagina = 0; pagina < 10; pagina++) {
    const r = await chamarMp(`/terminals/v1/list?limit=${limite}&offset=${offset}`, {
      metodo: "GET",
      accessToken,
    });
    if (!r.ok) return r;

    const lote: any[] = Array.isArray(r.dados?.data?.terminals) ? r.dados.data.terminals : [];
    terminais.push(...lote.map(normalizarTerminal));

    const total = Number(r.dados?.paging?.total ?? terminais.length);
    offset += limite;
    if (lote.length === 0 || !Number.isFinite(total) || terminais.length >= total) break;
  }

  return { ok: true, dados: terminais };
}

/**
 * Coloca a maquininha em modo PDV.
 *
 * Enquanto ela estiver em STANDALONE (o padrão de fábrica), o operador digita o
 * valor na mão e a cobrança enviada por API nem chega ao visor — o pedido ficaria
 * eternamente "aguardando pagamento" sem ninguém entender por quê.
 */
export async function definirModoPdv(
  accessToken: string,
  terminalId: string,
): Promise<ResultadoPoint<TerminalPoint>> {
  if (!accessToken) return { ok: false, status: 0, erro: SEM_CONEXAO };
  if (!terminalId) return { ok: false, status: 0, erro: "Maquininha não informada." };

  const r = await chamarMp("/terminals/v1/setup", {
    metodo: "PATCH",
    accessToken,
    corpo: { terminals: [{ id: terminalId, operating_mode: "PDV" }] },
  });
  if (!r.ok) return r;

  const lista: any[] = Array.isArray(r.dados?.terminals) ? r.dados.terminals : [];
  const devolvido = lista.find((t: any) => String(t?.id) === terminalId) ?? lista[0];
  if (!devolvido) {
    return { ok: false, status: 200, erro: "Mercado Pago não confirmou a troca de modo da maquininha." };
  }
  return { ok: true, dados: normalizarTerminal(devolvido) };
}

/**
 * Sobe a cobrança no visor da maquininha.
 *
 * `tentativa` deve vir de CustomerOrder.posTentativas: a X-Idempotency-Key vale
 * 24h no MP, então repetir a mesma chave devolve a ordem antiga em vez de acender
 * uma cobrança nova. Cada nova investida no mesmo pedido precisa de um número
 * diferente — e ele tem que vir do banco, não de um contador em memória, senão
 * um restart do servidor repete a chave e o cliente fica sem o visor aceso.
 */
export async function criarOrdemPoint(params: {
  accessToken: string;
  terminalId: string;
  orderId: string;
  valorEmCentavos: number;
  descricao: string;
  tentativa: number;
}): Promise<ResultadoPoint<OrdemPoint>> {
  const { accessToken, terminalId, orderId, valorEmCentavos, descricao, tentativa } = params;

  if (!accessToken) return { ok: false, status: 0, erro: SEM_CONEXAO };
  if (!terminalId) return { ok: false, status: 0, erro: "Nenhuma maquininha selecionada para esta cobrança." };
  if (!orderId) {
    return { ok: false, status: 0, erro: "Pedido sem identificador — não é possível cobrar na maquininha." };
  }
  if (!Number.isFinite(valorEmCentavos) || Math.round(valorEmCentavos) <= 0) {
    return { ok: false, status: 0, erro: `Valor inválido para cobrança na maquininha: ${valorEmCentavos}` };
  }
  if (!Number.isInteger(tentativa) || tentativa < 0) {
    return { ok: false, status: 0, erro: `Número de tentativa inválido: ${tentativa}` };
  }

  const r = await chamarMp("/v1/orders", {
    metodo: "POST",
    accessToken,
    idempotencyKey: `point:${orderId}:${tentativa}`,
    corpo: {
      type: "point",
      external_reference: orderId,
      description: (descricao || `Pedido ${orderId}`).slice(0, 255),
      expiration_time: EXPIRACAO_PADRAO,
      transactions: {
        payments: [{ amount: centavosParaAmount(valorEmCentavos) }],
      },
      config: {
        point: {
          terminal_id: terminalId,
          // A loja já imprime o pedido na impressora dela; deixar a Point
          // imprimir também gasta bobina e entrega duas vias ao mesmo cliente.
          print_on_terminal: "no_ticket",
        },
      },
    },
  });
  if (!r.ok) return r;

  const ordem = normalizarOrdem(r.dados);
  if (!ordem.id) {
    console.error("[MP Point] POST /v1/orders respondeu sem id", JSON.stringify(r.dados).slice(0, 2000));
    return { ok: false, status: 200, erro: "Mercado Pago aceitou a cobrança mas não devolveu o ID da ordem." };
  }
  return { ok: true, dados: ordem };
}

/**
 * Consulta a ordem no MP.
 *
 * O webhook é a via principal, mas ele pode não chegar (rede da loja, retry
 * perdido). Sem esta consulta o caixa ficaria olhando um pedido "aguardando
 * pagamento" que na verdade já foi pago no cartão.
 */
export async function consultarOrdem(
  accessToken: string,
  ordemId: string,
): Promise<ResultadoPoint<OrdemPoint>> {
  if (!accessToken) return { ok: false, status: 0, erro: SEM_CONEXAO };
  if (!ordemId) return { ok: false, status: 0, erro: "Cobrança sem identificador no Mercado Pago." };

  const r = await chamarMp(`/v1/orders/${encodeURIComponent(ordemId)}`, {
    metodo: "GET",
    accessToken,
  });
  if (!r.ok) return r;
  return { ok: true, dados: normalizarOrdem(r.dados) };
}

/**
 * Cancela a cobrança que está no visor.
 *
 * A chave de idempotência é fixa por ordem de propósito: cancelar é uma ação só,
 * e o operador clicando duas vezes no botão não pode virar dois cancelamentos.
 */
export async function cancelarOrdem(
  accessToken: string,
  ordemId: string,
): Promise<ResultadoPoint<OrdemPoint>> {
  if (!accessToken) return { ok: false, status: 0, erro: SEM_CONEXAO };
  if (!ordemId) return { ok: false, status: 0, erro: "Cobrança sem identificador no Mercado Pago." };

  const r = await chamarMp(`/v1/orders/${encodeURIComponent(ordemId)}/cancel`, {
    metodo: "POST",
    accessToken,
    idempotencyKey: `point-cancel:${ordemId}`,
  });
  if (!r.ok) return r;
  return { ok: true, dados: normalizarOrdem(r.dados) };
}
