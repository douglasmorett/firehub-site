/**
 * /src/lib/cobranca-da-mesa-na-maquininha.ts
 *
 * Cobrar a conta (ou parte dela) de uma MESA na maquininha integrada.
 *
 * Até aqui a maquininha só conhecia o totem: a fila do app (`pos/terminal/
 * pendente`) e o webhook do Point trabalhavam com `CustomerOrder`. Mesa é outra
 * coisa — a conta é a soma de vários pedidos e vai sendo paga aos poucos, baixa
 * a baixa, em `TableSession.paymentMethods` (lib/pagamentos-da-mesa.ts). Por
 * isso a cobrança da mesa é uma linha própria, e quando o cartão aprova ela vira
 * UMA baixa na mesa, igual à que o garçom lançaria à mão — só que com NSU.
 *
 * Dois caminhos, conforme a maquininha:
 *   - App na maquininha (PagBank, Stone, Cielo, Getnet): a cobrança entra na
 *     fila e o app pergunta por ela. Ela chega ao app com `pedidoId =
 *     "mesa:<id>"` — o app trata o id como texto opaco, então a versão que já
 *     está nas maquininhas cobra mesa sem atualização.
 *   - Mercado Pago Point: a cobrança vai pela nuvem do MP (`/v1/orders`) com
 *     `external_reference = "mesa:<id>"`, e o webhook do Point dá a baixa.
 *
 * Tabela própria, criada no primeiro uso: loja que não cobra mesa na maquininha
 * nunca toca nela, e não há migração manual em produção.
 */
import { prisma } from "@/lib/prisma";
import { ESTADOS_DA_COBRANCA, MINUTOS_ATE_DESTRAVAR, TENTATIVAS_ATE_SAIR_DA_FILA, ehProvedorComApp } from "@/lib/terminal-app";
import { lerPagamentos, somarPagamentos, emReais } from "@/lib/pagamentos-da-mesa";
import { criarOrdemPoint, consultarOrdem, cancelarOrdem } from "@/lib/mp-point";

export const PREFIXO_DA_MESA = "mesa:";

export type CobrancaDaMesa = {
  id: string;
  franchiseeId: string;
  tableSessionId: string;
  valorCentavos: number;
  status: string;
  terminalId: string | null;
  provedor: string | null;
  tentativas: number;
  mpOrderId: string | null;
  guestId: string | null;
  guestName: string | null;
  criadoPor: string | null;
  dados: any;
  pagamentoUid: string | null;
  criadaEm: Date;
  atualizadaEm: Date;
};

let pronta: Promise<void> | null = null;

function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CobrancaDaMesaNaMaquininha" (
          "id"             TEXT PRIMARY KEY,
          "franchiseeId"   TEXT NOT NULL,
          "tableSessionId" TEXT NOT NULL,
          "valorCentavos"  INT NOT NULL,
          "status"         TEXT NOT NULL,
          "terminalId"     TEXT,
          "provedor"       TEXT,
          "tentativas"     INT NOT NULL DEFAULT 0,
          "mpOrderId"      TEXT,
          "guestId"        TEXT,
          "guestName"      TEXT,
          "criadoPor"      TEXT,
          "dados"          JSONB,
          "pagamentoUid"   TEXT,
          "criadaEm"       TIMESTAMPTZ NOT NULL DEFAULT now(),
          "atualizadaEm"   TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "CobrancaDaMesa_fila" ON "CobrancaDaMesaNaMaquininha" ("franchiseeId","status","criadaEm")`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "CobrancaDaMesa_mesa" ON "CobrancaDaMesaNaMaquininha" ("tableSessionId")`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "CobrancaDaMesa_mp" ON "CobrancaDaMesaNaMaquininha" ("mpOrderId")`,
      );
      // Trava de verdade da "uma cobrança viva por mesa": dois toques no botão
      // ao mesmo tempo passam pela conferência de cima juntos; o índice não.
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "CobrancaDaMesa_uma_viva" ON "CobrancaDaMesaNaMaquininha" ("tableSessionId")
         WHERE "status" IN ('AGUARDANDO_TERMINAL','NO_TERMINAL')`,
      );
    })().catch((e) => {
      pronta = null;
      throw e;
    });
  }
  return pronta;
}

function linha(l: any): CobrancaDaMesa {
  return {
    ...l,
    valorCentavos: Number(l.valorCentavos),
    tentativas: Number(l.tentativas),
  };
}

async function buscar(id: string): Promise<CobrancaDaMesa | null> {
  await garantirTabela();
  const r = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "CobrancaDaMesaNaMaquininha" WHERE "id" = $1`, id);
  return r[0] ? linha(r[0]) : null;
}

/** "mesa:<id>" → "<id>"; qualquer outra coisa → null. */
export function idDaCobrancaDaMesa(pedidoId: unknown): string | null {
  if (typeof pedidoId !== "string" || !pedidoId.startsWith(PREFIXO_DA_MESA)) return null;
  const id = pedidoId.slice(PREFIXO_DA_MESA.length).trim();
  return id || null;
}

/**
 * Forma de pagamento da baixa, no MESMO vocabulário que o garçom escolhe na
 * tela da mesa ("Crédito", "Débito", "Pix", "Voucher") — é o que o fechamento
 * e o caixa já leem. O tipo vem do app em formatos diferentes por adquirente
 * ("CREDITO", "credit", "DEBIT", "credit_card"...).
 */
export function formaDaBaixa(tipo: unknown): string {
  const t = String(tipo || "").toLowerCase();
  if (/pix|qr|instant/.test(t)) return "Pix";
  if (/deb/.test(t)) return "Débito";
  if (/vale|voucher|refei|aliment/.test(t)) return "Voucher";
  return "Crédito";
}

export type ErroDeCobranca = { ok: false; status: number; codigo: string; mensagem: string };

/**
 * Cria a cobrança da mesa e, no caso do Point, já acende o visor.
 *
 * O valor não pode passar do que falta pagar: cobrar a mais no cartão vira
 * troco que não existe — ninguém devolve diferença de cartão em dinheiro.
 */
export async function criarCobrancaDaMesa(params: {
  lojaId: string;
  tableSessionId: string;
  valorCentavos: number;
  terminalId: string;
  guestId?: string | null;
  por: string;
}): Promise<{ ok: true; cobranca: CobrancaDaMesa } | ErroDeCobranca> {
  const { lojaId, tableSessionId, valorCentavos, terminalId, por } = params;
  await garantirTabela();

  if (!Number.isInteger(valorCentavos) || valorCentavos < 100) {
    return { ok: false, status: 400, codigo: "VALOR_INVALIDO", mensagem: "O valor mínimo na maquininha é R$ 1,00." };
  }

  const mesa = await prisma.tableSession.findUnique({
    where: { id: tableSessionId },
    select: {
      id: true, status: true, paymentMethods: true, waiterTip: true,
      table: { select: { franchiseeId: true, number: true } },
      orders: { select: { status: true, totalAmount: true } },
    },
  });
  if (!mesa || mesa.table?.franchiseeId !== lojaId) {
    return { ok: false, status: 404, codigo: "MESA_NAO_ENCONTRADA", mensagem: "Mesa não encontrada." };
  }
  if (mesa.status !== "OPEN") {
    return { ok: false, status: 400, codigo: "MESA_FECHADA", mensagem: "Esta mesa já foi fechada." };
  }

  const terminal = await prisma.posTerminal.findFirst({
    where: { id: terminalId, franchiseeId: lojaId, active: true },
    select: { id: true, label: true, provider: true, externalId: true, lastSeenAt: true },
  });
  if (!terminal) {
    return { ok: false, status: 404, codigo: "TERMINAL_NAO_ENCONTRADO", mensagem: "Maquininha não encontrada nesta loja." };
  }

  // Uma cobrança viva por mesa. Duas ao mesmo tempo é o caminho para o cliente
  // passar o cartão duas vezes pela mesma conta.
  const vivas = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "id" FROM "CobrancaDaMesaNaMaquininha"
     WHERE "tableSessionId" = $1 AND "status" IN ($2,$3) LIMIT 1`,
    tableSessionId, ESTADOS_DA_COBRANCA.aguardando, ESTADOS_DA_COBRANCA.noTerminal,
  );
  if (vivas.length) {
    return {
      ok: false, status: 409, codigo: "COBRANCA_EM_ANDAMENTO",
      mensagem: "Já tem uma cobrança desta mesa esperando na maquininha. Cancele ela antes de mandar outra.",
    };
  }

  // Teto de sanidade. O total exato da conta só existe no fechamento (a taxa
  // de serviço e a gorjeta são escolhidas lá), então aqui o limite é o consumo
  // com até 30% de taxa, mais a gorjeta gravada, menos o que já foi pago. Pega
  // o erro que importa — R$ 4.590 digitado no lugar de R$ 45,90 — sem travar
  // a mesa que paga a taxa cheia.
  const consumoCentavos = mesa.orders
    .filter((o) => o.status !== "CANCELADO")
    .reduce((s, o) => s + Math.round((Number(o.totalAmount) || 0) * 100), 0);
  const pagoCentavos = Math.round(somarPagamentos(lerPagamentos(mesa.paymentMethods)) * 100);
  const tetoCentavos =
    Math.round(consumoCentavos * 1.3) + Math.round((Number(mesa.waiterTip) || 0) * 100) - pagoCentavos;
  if (valorCentavos > tetoCentavos) {
    return {
      ok: false, status: 400, codigo: "VALOR_ACIMA_DA_CONTA",
      mensagem: "O valor é maior que a conta desta mesa. Confira o valor digitado.",
    };
  }

  let guestId: string | null = null;
  let guestName: string | null = null;
  if (params.guestId) {
    const pessoa = await prisma.tableGuest.findFirst({
      where: { id: params.guestId, tableSessionId },
      select: { id: true, name: true },
    });
    if (!pessoa) return { ok: false, status: 400, codigo: "PESSOA_INVALIDA", mensagem: "Essa pessoa não está nesta mesa." };
    guestId = pessoa.id;
    guestName = pessoa.name;
  }

  const ehPoint = terminal.provider === "MERCADOPAGO_POINT";
  if (!ehPoint && !ehProvedorComApp(terminal.provider)) {
    return { ok: false, status: 409, codigo: "TERMINAL_SEM_SUPORTE", mensagem: "Esta maquininha não aceita cobrança de mesa." };
  }
  if (!ehPoint) {
    const silencio = terminal.lastSeenAt ? (Date.now() - terminal.lastSeenAt.getTime()) / 60_000 : Infinity;
    if (silencio > 2) {
      return {
        ok: false, status: 409, codigo: "TERMINAL_OFFLINE",
        mensagem: `A maquininha "${terminal.label}" não está respondendo. Veja se ela está ligada, com o app FireHub aberto e com internet.`,
      };
    }
  }

  const id = crypto.randomUUID();
  try {
    await prisma.$executeRawUnsafe(
    `INSERT INTO "CobrancaDaMesaNaMaquininha"
       ("id","franchiseeId","tableSessionId","valorCentavos","status","terminalId","provedor","guestId","guestName","criadoPor","dados")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    id, lojaId, tableSessionId, valorCentavos,
    ehPoint ? ESTADOS_DA_COBRANCA.noTerminal : ESTADOS_DA_COBRANCA.aguardando,
    terminal.id, terminal.provider, guestId, guestName, por.slice(0, 120),
    JSON.stringify({ mesa: mesa.table?.number ?? null }),
    );
  } catch (e: any) {
    if (/unique|duplicate|23505/i.test(String(e?.message || e?.code || ""))) {
      return {
        ok: false, status: 409, codigo: "COBRANCA_EM_ANDAMENTO",
        mensagem: "Já tem uma cobrança desta mesa esperando na maquininha.",
      };
    }
    throw e;
  }

  if (ehPoint) {
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { mpAccessToken: true } });
    if (!loja?.mpAccessToken) {
      await mudarStatus(id, ESTADOS_DA_COBRANCA.cancelado, { motivo: "MP_NAO_CONECTADO" });
      return {
        ok: false, status: 409, codigo: "MP_NAO_CONECTADO",
        mensagem: "A loja ainda não conectou a conta Mercado Pago (Integrações > Mercado Pago).",
      };
    }
    const ordem = await criarOrdemPoint({
      accessToken: loja.mpAccessToken,
      terminalId: terminal.externalId,
      orderId: `${PREFIXO_DA_MESA}${id}`,
      valorEmCentavos: valorCentavos,
      descricao: `Mesa ${mesa.table?.number ?? ""}`.trim(),
      tentativa: 0,
    });
    if (!ordem.ok) {
      await mudarStatus(id, ESTADOS_DA_COBRANCA.cancelado, { motivo: ordem.erro });
      return { ok: false, status: 502, codigo: "POINT_RECUSOU", mensagem: ordem.erro };
    }
    await prisma.$executeRawUnsafe(
      `UPDATE "CobrancaDaMesaNaMaquininha" SET "mpOrderId" = $2, "atualizadaEm" = now() WHERE "id" = $1`,
      id, ordem.dados.id,
    );
  }

  return { ok: true, cobranca: (await buscar(id))! };
}

async function mudarStatus(id: string, status: string, extra?: Record<string, unknown>) {
  await prisma.$executeRawUnsafe(
    `UPDATE "CobrancaDaMesaNaMaquininha"
     SET "status" = $2, "dados" = COALESCE("dados",'{}'::jsonb) || $3::jsonb, "atualizadaEm" = now()
     WHERE "id" = $1`,
    id, status, JSON.stringify(extra ?? {}),
  );
}

/** Cobranças da mesa, mais nova primeiro — a tela da mesa acompanha por aqui. */
export async function cobrancasDaMesa(tableSessionId: string): Promise<CobrancaDaMesa[]> {
  await garantirTabela();
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "CobrancaDaMesaNaMaquininha" WHERE "tableSessionId" = $1 ORDER BY "criadaEm" DESC LIMIT 20`,
    tableSessionId,
  );
  return r.map(linha);
}

/**
 * Rede de segurança do Point: se o webhook não chegou, a tela que acompanha a
 * cobrança reconsulta a ordem no MP. Sem isto o garçom veria "aguardando" num
 * cartão que já passou.
 */
export async function conferirCobrancaNoPoint(c: CobrancaDaMesa): Promise<void> {
  if (c.provedor !== "MERCADOPAGO_POINT" || !c.mpOrderId || c.status !== ESTADOS_DA_COBRANCA.noTerminal) return;
  if (Date.now() - new Date(c.atualizadaEm).getTime() < 8_000) return;
  await processarOrdemPointDaMesa(c.mpOrderId);
}

/**
 * Cancela a cobrança que ainda não foi paga. Na fila do app, só sai da fila se
 * o app ainda não pegou (`AGUARDANDO`); com o app já cobrando, cancelar aqui
 * não tira o cartão da mão do cliente — então recusa e manda cancelar na tela
 * da maquininha.
 */
export async function cancelarCobrancaDaMesa(lojaId: string, id: string): Promise<{ ok: true } | ErroDeCobranca> {
  const c = await buscar(id);
  if (!c || c.franchiseeId !== lojaId) {
    return { ok: false, status: 404, codigo: "NAO_ENCONTRADA", mensagem: "Cobrança não encontrada." };
  }
  if (c.status === ESTADOS_DA_COBRANCA.pago) {
    return { ok: false, status: 409, codigo: "JA_PAGA", mensagem: "Esta cobrança já foi paga." };
  }
  if (c.provedor === "MERCADOPAGO_POINT" && c.mpOrderId && c.status === ESTADOS_DA_COBRANCA.noTerminal) {
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { mpAccessToken: true } });
    const r = await cancelarOrdem(loja?.mpAccessToken || "", c.mpOrderId);
    if (!r.ok) {
      return { ok: false, status: 409, codigo: "POINT_NAO_CANCELOU", mensagem: `Cancele na maquininha: ${r.erro}` };
    }
    await mudarStatus(id, ESTADOS_DA_COBRANCA.cancelado, { canceladaEm: new Date().toISOString() });
    return { ok: true };
  }
  const r = await prisma.$executeRawUnsafe(
    `UPDATE "CobrancaDaMesaNaMaquininha" SET "status" = $2, "atualizadaEm" = now()
     WHERE "id" = $1 AND "status" = $3`,
    id, ESTADOS_DA_COBRANCA.cancelado, ESTADOS_DA_COBRANCA.aguardando,
  );
  if (r === 0) {
    return {
      ok: false, status: 409, codigo: "JA_NA_MAQUININHA",
      mensagem: "A maquininha já está cobrando. Cancele na tela dela.",
    };
  }
  return { ok: true };
}

/**
 * A próxima cobrança de mesa para o app desta maquininha, já reservada.
 * Mesma regra da fila do totem: endereçada a ela ou sem dono, a mais antiga,
 * e presa há mais de MINUTOS_ATE_DESTRAVAR volta para a fila.
 */
export async function reservarCobrancaDaMesa(terminal: { id: string; franchiseeId: string }): Promise<CobrancaDaMesa | null> {
  try {
    await garantirTabela();
  } catch {
    return null;
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "CobrancaDaMesaNaMaquininha" SET "status" = $3, "atualizadaEm" = now()
     WHERE "franchiseeId" = $1 AND "terminalId" = $2 AND "status" = $4
       AND "mpOrderId" IS NULL AND "atualizadaEm" < now() - ($5 || ' minutes')::interval`,
    terminal.franchiseeId, terminal.id, ESTADOS_DA_COBRANCA.aguardando, ESTADOS_DA_COBRANCA.noTerminal,
    String(MINUTOS_ATE_DESTRAVAR),
  );
  // Reserva numa instrução só: UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP
  // LOCKED). Duas maquininhas perguntando juntas nunca levam a mesma cobrança.
  const r = await prisma.$queryRawUnsafe<any[]>(
    `UPDATE "CobrancaDaMesaNaMaquininha" SET "status" = $3, "terminalId" = $2, "atualizadaEm" = now()
     WHERE "id" = (
       SELECT "id" FROM "CobrancaDaMesaNaMaquininha"
       WHERE "franchiseeId" = $1 AND "status" = $4 AND "mpOrderId" IS NULL
         AND ("terminalId" = $2 OR "terminalId" IS NULL)
       ORDER BY "criadaEm" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    terminal.franchiseeId, terminal.id, ESTADOS_DA_COBRANCA.noTerminal, ESTADOS_DA_COBRANCA.aguardando,
  );
  return r[0] ? linha(r[0]) : null;
}

export type DadosDaTransacao = {
  terminal?: string;
  terminalId?: string;
  provedor?: string;
  bandeira?: unknown;
  nsu?: unknown;
  autorizacao?: unknown;
  parcelas?: unknown;
  tipo?: unknown;
  referencia?: unknown;
  motivo?: unknown;
};

/**
 * Dá a baixa na mesa. Idempotente pelo `pagamentoUid`: o reenvio do app (rede
 * que caiu depois de aprovar) ou o webhook repetido do MP não lançam a mesma
 * passada de cartão duas vezes.
 *
 * A leitura e a escrita da lista de baixas ficam numa transação com a linha da
 * mesa travada: o garçom lançando dinheiro no mesmo instante não pode apagar a
 * baixa do cartão (ler-somar-gravar sem trava perde uma das duas).
 */
async function darBaixaNaMesa(c: CobrancaDaMesa, dados: DadosDaTransacao, por: string): Promise<void> {
  const uid = `maquininha-${c.id}`;
  await prisma.$transaction(async (tx) => {
    const travada = await tx.$queryRawUnsafe<any[]>(
      `SELECT "paymentMethods", "status" FROM "TableSession" WHERE "id" = $1 FOR UPDATE`,
      c.tableSessionId,
    );
    if (!travada[0]) throw new Error(`Mesa ${c.tableSessionId} sumiu`);
    const lista = lerPagamentos(travada[0].paymentMethods);
    if (!lista.some((p) => p.uid === uid)) {
      if (travada[0].status !== "OPEN") {
        // Dinheiro que já saiu do cartão não pode sumir porque alguém fechou a
        // mesa no meio. A baixa entra assim mesmo e fica no log para o caixa.
        console.warn(`[Mesa ${c.tableSessionId}] cartão aprovado com a mesa já fechada — baixa registrada assim mesmo.`);
      }
      lista.push({
        uid,
        method: formaDaBaixa(dados.tipo),
        amount: emReais(c.valorCentavos),
        guestId: c.guestId,
        guestName: c.guestName,
        at: new Date().toISOString(),
        por,
      });
      await tx.tableSession.update({
        where: { id: c.tableSessionId },
        data: { paymentMethods: lista as any, totalPaid: somarPagamentos(lista) },
      });
    }
    await tx.$executeRawUnsafe(
      `UPDATE "CobrancaDaMesaNaMaquininha"
       SET "status" = $2, "pagamentoUid" = $3, "dados" = COALESCE("dados",'{}'::jsonb) || $4::jsonb, "atualizadaEm" = now()
       WHERE "id" = $1`,
      c.id, ESTADOS_DA_COBRANCA.pago, uid, JSON.stringify({ ...dados, aprovado: true, em: new Date().toISOString() }),
    );
  });
}

/**
 * O app da maquininha devolveu o resultado de uma cobrança de mesa.
 * Mesmo contrato de resposta de `POST /api/pos/terminal/resultado` para pedido.
 */
export async function registrarResultadoDaMesa(params: {
  terminal: { id: string; franchiseeId: string; label: string; provider: string };
  cobrancaId: string;
  aprovado: boolean;
  dados: DadosDaTransacao;
}): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const { terminal, cobrancaId, aprovado, dados } = params;
  const c = await buscar(cobrancaId);
  if (!c) return { status: 404, corpo: { error: "Cobrança não encontrada" } };
  if (c.franchiseeId !== terminal.franchiseeId) return { status: 403, corpo: { error: "Esta cobrança não é desta loja" } };
  if (c.terminalId && c.terminalId !== terminal.id) {
    return { status: 409, corpo: { error: "Esta cobrança está com outra maquininha.", code: "COBRANCA_DE_OUTRO_TERMINAL" } };
  }
  if (c.status === ESTADOS_DA_COBRANCA.pago) {
    return { status: 200, corpo: { success: true, jaConfirmado: true, pedidoId: `${PREFIXO_DA_MESA}${c.id}` } };
  }

  if (!aprovado) {
    const tentativas = c.tentativas + 1;
    const saiu = tentativas >= TENTATIVAS_ATE_SAIR_DA_FILA;
    // Recusa na mesa NÃO volta para a fila. No totem o cliente está sozinho na
    // frente da máquina e tenta outro cartão; na mesa o garçom está do lado e
    // decide — mandar de novo, cobrar outro valor ou receber em dinheiro. Se a
    // cobrança voltasse sozinha, a maquininha ficaria pedindo o cartão de uma
    // conta que o garçom já resolveu de outro jeito.
    await prisma.$executeRawUnsafe(
      `UPDATE "CobrancaDaMesaNaMaquininha"
       SET "status" = $2, "tentativas" = $3, "dados" = COALESCE("dados",'{}'::jsonb) || $4::jsonb, "atualizadaEm" = now()
       WHERE "id" = $1 AND "status" <> $5`,
      c.id, ESTADOS_DA_COBRANCA.recusado, tentativas,
      JSON.stringify({ ...dados, aprovado: false, em: new Date().toISOString() }),
      ESTADOS_DA_COBRANCA.pago,
    );
    return {
      status: 200,
      corpo: {
        success: true, aprovado: false, podeTentarDeNovo: false, saiuDaFila: true, motivo: dados.motivo ?? null,
        mensagem: saiu
          ? "Várias recusas nesta mesa. Confira com o cliente antes de tentar de novo."
          : "Recusado. O garçom manda a cobrança de novo se o cliente quiser tentar outro cartão.",
      },
    };
  }

  await darBaixaNaMesa(c, dados, terminal.label ? `Maquininha ${terminal.label}` : "Maquininha");
  return { status: 200, corpo: { success: true, aprovado: true, pedidoId: `${PREFIXO_DA_MESA}${c.id}` } };
}

/**
 * Webhook (ou conferência) de uma ordem do Point que pode ser de mesa.
 * Devolve `null` quando a ordem não é de mesa — o chamador segue o caminho do
 * pedido. Nunca confia no corpo do webhook: reconsulta a ordem no MP.
 */
export async function processarOrdemPointDaMesa(
  mpOrderId: string,
): Promise<{ status: number; corpo: Record<string, unknown> } | null> {
  try {
    await garantirTabela();
  } catch {
    return null;
  }
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "CobrancaDaMesaNaMaquininha" WHERE "mpOrderId" = $1 LIMIT 1`,
    mpOrderId,
  );
  if (!r[0]) return null;
  const c = linha(r[0]);
  if (c.status === ESTADOS_DA_COBRANCA.pago) return { status: 200, corpo: { received: true, jaConfirmado: true } };

  const loja = await prisma.user.findUnique({ where: { id: c.franchiseeId }, select: { mpAccessToken: true } });
  if (!loja?.mpAccessToken) return { status: 409, corpo: { error: "Loja não conectada ao Mercado Pago", code: "MP_NAO_CONECTADO" } };

  const consulta = await consultarOrdem(loja.mpAccessToken, mpOrderId);
  if (!consulta.ok) return { status: 502, corpo: { error: consulta.erro } };
  const ordem = consulta.dados;
  if (ordem.externalReference && ordem.externalReference !== `${PREFIXO_DA_MESA}${c.id}`) {
    console.error(`[MP Point Mesa] Ordem ${mpOrderId} referencia ${ordem.externalReference}, não a cobrança ${c.id}.`);
    return { status: 409, corpo: { error: "Ordem não confere com a cobrança" } };
  }

  if (ordem.status === "processed") {
    const pag = ordem.bruto?.transactions?.payments?.[0] || {};
    await darBaixaNaMesa(c, {
      provedor: "MERCADOPAGO_POINT",
      tipo: pag?.payment_method?.type || pag?.payment_method?.id || null,
      bandeira: pag?.payment_method?.id || null,
      autorizacao: ordem.paymentId || null,
      parcelas: pag?.payment_method?.installments ?? null,
    }, "Maquininha Mercado Pago");
  } else if (["canceled", "expired", "failed"].includes(ordem.status)) {
    await mudarStatus(c.id, ordem.status === "expired" ? ESTADOS_DA_COBRANCA.expirado : ESTADOS_DA_COBRANCA.cancelado, {
      mp: ordem.status, detalhe: ordem.statusDetail,
    });
  } else {
    await prisma.$executeRawUnsafe(
      `UPDATE "CobrancaDaMesaNaMaquininha" SET "atualizadaEm" = now() WHERE "id" = $1`, c.id,
    );
  }
  return { status: 200, corpo: { received: true, status: ordem.status } };
}
