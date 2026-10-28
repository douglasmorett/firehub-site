import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ESTADOS_DA_COBRANCA, ehProvedorComApp } from "@/lib/terminal-app";
import { formaDaBaixa } from "@/lib/cobranca-da-mesa-na-maquininha";
import { resumoDividido } from "@/lib/pagamento-dividido";
import { empilharEdicao, type RegistroDeEdicao } from "@/lib/edicao-de-pedido";

/**
 * Cobrança da entrega na maquininha — o app FireHub Motoboy.
 *
 * O motoboy chega na porta, cobra o cartão (ou Pix/vale) na maquininha que leva
 * e informa a parte em dinheiro, se houver. Cada passada de cartão vira uma
 * linha aqui; no fim, `receberEntrega` grava no pedido as formas com os valores
 * e a marca "conferido na maquininha", que o acerto do motoboy e o caixa leem.
 *
 * Mesmo caminho do garçom: o app NÃO cobra sozinho — cria a cobrança endereçada
 * à PRÓPRIA maquininha e o serviço de cobrança pega da fila (`entrega:<id>`),
 * com marcador em disco, fila de resultados e recuperação depois de queda.
 *
 * Não marca gatewayProvider nem paymentPaidAt: esses fazem o pedido contar
 * como "pago online" no caixa, e cartão na porta é débito/crédito de verdade.
 *
 * Tabela criada no 1º uso (schema.prisma não muda), como a da mesa.
 */

export const PREFIXO_DA_ENTREGA = "entrega:";
const TOLERANCIA_CENTAVOS = 2;

export type CobrancaDaEntrega = {
  id: string;
  franchiseeId: string;
  orderId: string;
  motoboyId: string;
  terminalId: string;
  valorCentavos: number;
  status: string;
  tentativas: number;
  dados: any;
  criadaEm: Date;
  atualizadaEm: Date;
};

let pronta: Promise<void> | null = null;

function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CobrancaDaEntregaNaMaquininha" (
          "id"            TEXT PRIMARY KEY,
          "franchiseeId"  TEXT NOT NULL,
          "orderId"       TEXT NOT NULL,
          "motoboyId"     TEXT NOT NULL,
          "terminalId"    TEXT NOT NULL,
          "valorCentavos" INT NOT NULL,
          "status"        TEXT NOT NULL,
          "tentativas"    INT NOT NULL DEFAULT 0,
          "dados"         JSONB,
          "criadaEm"      TIMESTAMPTZ NOT NULL DEFAULT now(),
          "atualizadaEm"  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "CobrancaDaEntrega_pedido" ON "CobrancaDaEntregaNaMaquininha" ("orderId")`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "CobrancaDaEntrega_fila" ON "CobrancaDaEntregaNaMaquininha" ("terminalId","status","criadaEm")`,
      );
      // Uma cobrança viva por pedido: dois toques no "Cobrar" não abrem duas.
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "CobrancaDaEntrega_uma_viva" ON "CobrancaDaEntregaNaMaquininha" ("orderId")
         WHERE "status" IN ('AGUARDANDO_TERMINAL','NO_TERMINAL')`,
      );
    })().catch((e) => {
      pronta = null;
      throw e;
    });
  }
  return pronta;
}

function linha(l: any): CobrancaDaEntrega {
  return { ...l, valorCentavos: Number(l.valorCentavos), tentativas: Number(l.tentativas) };
}

const centavos = (reais: unknown) => Math.round((Number(reais) || 0) * 100);
const reais = (c: number) => Math.round(c) / 100;

export function idDaCobrancaDaEntrega(pedidoId: unknown): string | null {
  if (typeof pedidoId !== "string" || !pedidoId.startsWith(PREFIXO_DA_ENTREGA)) return null;
  return pedidoId.slice(PREFIXO_DA_ENTREGA.length).trim() || null;
}

/** "Crédito"/"Débito"/"Pix"/"Voucher" (vocabulário da mesa) → o da entrega. */
function formaDaEntrega(tipo: unknown): string {
  const f = formaDaBaixa(tipo);
  return f === "Débito" ? "Cartão Débito" : f === "Crédito" ? "Cartão Crédito" : f === "Voucher" ? "Vale-refeição" : "Pix";
}

export type Erro = { ok: false; status: number; mensagem: string };

async function pedidoDoMotoboy(lojaId: string, motoboyId: string, orderId: string) {
  const pedido = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, franchiseeId: true, motoboyId: true, totalAmount: true, status: true,
      paymentMethod: true, paymentMethods: true, changeAmount: true, editHistory: true, gatewayPaymentId: true,
    },
  });
  if (!pedido || pedido.franchiseeId !== lojaId) return null;
  if (pedido.motoboyId !== motoboyId) return null;
  return pedido;
}

async function aprovadasDoPedido(orderId: string): Promise<CobrancaDaEntrega[]> {
  await garantirTabela();
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "CobrancaDaEntregaNaMaquininha" WHERE "orderId" = $1 AND "status" = $2 ORDER BY "criadaEm" ASC`,
    orderId, ESTADOS_DA_COBRANCA.pago,
  );
  return r.map(linha);
}

/**
 * O motoboy pede para cobrar `valorCentavos` deste pedido na maquininha dele.
 * O valor não passa do que falta no cartão: cobrar a mais vira troco que não
 * existe (ninguém devolve diferença de cartão em dinheiro).
 */
export async function criarCobrancaDaEntrega(params: {
  lojaId: string; motoboyId: string; orderId: string; terminalId: string; valorCentavos: number;
}): Promise<{ ok: true; cobranca: CobrancaDaEntrega } | Erro> {
  const { lojaId, motoboyId, orderId, terminalId } = params;
  const valorCentavos = Math.round(params.valorCentavos);
  if (!(valorCentavos > 0)) return { ok: false, status: 400, mensagem: "Informe o valor a cobrar." };

  const terminal = await prisma.posTerminal.findUnique({
    where: { id: terminalId },
    select: { id: true, franchiseeId: true, active: true, provider: true },
  });
  if (!terminal || terminal.franchiseeId !== lojaId || !terminal.active || !ehProvedorComApp(terminal.provider)) {
    return { ok: false, status: 400, mensagem: "Esta maquininha não está ligada à loja. Gere o código em Motoboys › Maquininhas." };
  }
  const pedido = await pedidoDoMotoboy(lojaId, motoboyId, orderId);
  if (!pedido) return { ok: false, status: 404, mensagem: "Pedido não encontrado nas suas entregas." };
  if (pedido.status === "CANCELADO") return { ok: false, status: 409, mensagem: "Este pedido foi cancelado." };

  const jaPago = (await aprovadasDoPedido(orderId)).reduce((s, c) => s + c.valorCentavos, 0);
  const falta = centavos(pedido.totalAmount) - jaPago;
  if (valorCentavos > falta + TOLERANCIA_CENTAVOS) {
    return { ok: false, status: 400, mensagem: `Só falta R$ ${(falta / 100).toFixed(2).replace(".", ",")} neste pedido.` };
  }

  const id = `ent_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  try {
    const r = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO "CobrancaDaEntregaNaMaquininha" ("id","franchiseeId","orderId","motoboyId","terminalId","valorCentavos","status")
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      id, lojaId, orderId, motoboyId, terminalId, valorCentavos, ESTADOS_DA_COBRANCA.aguardando,
    );
    return { ok: true, cobranca: linha(r[0]) };
  } catch (e: any) {
    if (String(e?.message || "").includes("CobrancaDaEntrega_uma_viva")) {
      return { ok: false, status: 409, mensagem: "Já tem uma cobrança deste pedido na maquininha. Termine ou cancele antes." };
    }
    throw e;
  }
}

export async function buscarCobrancaDaEntrega(lojaId: string, motoboyId: string, id: string): Promise<CobrancaDaEntrega | null> {
  await garantirTabela();
  const r = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "CobrancaDaEntregaNaMaquininha" WHERE "id" = $1 AND "franchiseeId" = $2 AND "motoboyId" = $3`,
    id, lojaId, motoboyId,
  );
  return r[0] ? linha(r[0]) : null;
}

/** Desiste de uma cobrança que ainda não foi para o cartão. */
export async function cancelarCobrancaDaEntrega(lojaId: string, motoboyId: string, id: string): Promise<boolean> {
  await garantirTabela();
  const n = await prisma.$executeRawUnsafe(
    `UPDATE "CobrancaDaEntregaNaMaquininha" SET "status" = $4, "atualizadaEm" = now()
     WHERE "id" = $1 AND "franchiseeId" = $2 AND "motoboyId" = $3 AND "status" = $5`,
    id, lojaId, motoboyId, ESTADOS_DA_COBRANCA.cancelado, ESTADOS_DA_COBRANCA.aguardando,
  );
  return n === 1;
}

/** A fila do app do motoboy: só o que foi endereçado a esta maquininha. */
export async function reservarCobrancaDaEntrega(terminal: { id: string; franchiseeId: string }): Promise<CobrancaDaEntrega | null> {
  try {
    await garantirTabela();
  } catch {
    return null;
  }
  const r = await prisma.$queryRawUnsafe<any[]>(
    `UPDATE "CobrancaDaEntregaNaMaquininha" SET "status" = $3, "atualizadaEm" = now()
     WHERE "id" = (
       SELECT "id" FROM "CobrancaDaEntregaNaMaquininha"
       WHERE "franchiseeId" = $1 AND "terminalId" = $2 AND "status" = $4
       ORDER BY "criadaEm" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    terminal.franchiseeId, terminal.id, ESTADOS_DA_COBRANCA.noTerminal, ESTADOS_DA_COBRANCA.aguardando,
  );
  return r[0] ? linha(r[0]) : null;
}

/**
 * O app devolveu o resultado do cartão. Mesmo contrato de resposta de
 * `POST /api/pos/terminal/resultado`. Recusa não volta para a fila: o motoboy
 * está do lado e decide (outro cartão, outro valor, dinheiro).
 */
export async function registrarResultadoDaEntrega(params: {
  terminal: { id: string; franchiseeId: string; label: string };
  cobrancaId: string;
  aprovado: boolean;
  dados: Record<string, unknown>;
}): Promise<{ status: number; corpo: Record<string, unknown> }> {
  const { terminal, cobrancaId, aprovado, dados } = params;
  await garantirTabela();
  const r = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "CobrancaDaEntregaNaMaquininha" WHERE "id" = $1`, cobrancaId);
  const c = r[0] ? linha(r[0]) : null;
  const pedidoId = `${PREFIXO_DA_ENTREGA}${cobrancaId}`;
  if (!c) return { status: 404, corpo: { error: "Cobrança não encontrada" } };
  if (c.franchiseeId !== terminal.franchiseeId) return { status: 403, corpo: { error: "Esta cobrança não é desta loja" } };
  if (c.terminalId !== terminal.id) {
    return { status: 409, corpo: { error: "Esta cobrança está com outra maquininha.", code: "COBRANCA_DE_OUTRO_TERMINAL" } };
  }
  if (c.status === ESTADOS_DA_COBRANCA.pago) return { status: 200, corpo: { success: true, jaConfirmado: true, pedidoId } };

  const carimbo = JSON.stringify({ ...dados, aprovado, em: new Date().toISOString() });
  if (!aprovado) {
    await prisma.$executeRawUnsafe(
      `UPDATE "CobrancaDaEntregaNaMaquininha"
       SET "status" = $2, "tentativas" = "tentativas" + 1, "dados" = COALESCE("dados",'{}'::jsonb) || $3::jsonb, "atualizadaEm" = now()
       WHERE "id" = $1 AND "status" <> $4`,
      c.id, ESTADOS_DA_COBRANCA.recusado, carimbo, ESTADOS_DA_COBRANCA.pago,
    );
    return {
      status: 200,
      corpo: {
        success: true, aprovado: false, podeTentarDeNovo: false, saiuDaFila: true, motivo: dados.motivo ?? null,
        mensagem: "Recusado. O motoboy cobra de novo se o cliente quiser tentar outro cartão.",
      },
    };
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "CobrancaDaEntregaNaMaquininha"
     SET "status" = $2, "dados" = COALESCE("dados",'{}'::jsonb) || $3::jsonb, "atualizadaEm" = now()
     WHERE "id" = $1 AND "status" <> $2`,
    c.id, ESTADOS_DA_COBRANCA.pago, carimbo,
  );
  return { status: 200, corpo: { success: true, aprovado: true, pedidoId } };
}

/** O que o app mostra na tela de receber: total, já passado na maquininha e o que falta. */
export async function situacaoDoRecebimento(lojaId: string, motoboyId: string, orderId: string) {
  const pedido = await pedidoDoMotoboy(lojaId, motoboyId, orderId);
  if (!pedido) return null;
  const aprovadas = await aprovadasDoPedido(orderId);
  const total = centavos(pedido.totalAmount);
  const naMaquininha = aprovadas.reduce((s, c) => s + c.valorCentavos, 0);
  return {
    totalCentavos: total,
    naMaquininhaCentavos: naMaquininha,
    faltaCentavos: Math.max(0, total - naMaquininha),
    partes: aprovadas.map((c) => ({
      cobrancaId: c.id, valorCentavos: c.valorCentavos, forma: formaDaEntrega(c.dados?.tipo), bandeira: c.dados?.bandeira ?? null,
    })),
  };
}

/**
 * Fecha o pagamento da entrega: o que passou na maquininha (conferido) mais a
 * parte em dinheiro que o motoboy informa. A soma tem que fechar com o total.
 *
 * Grava no pedido:
 * - `paymentMethod`: a forma (uma só) ou "Dividido: ..." (duas ou mais) — o
 *   mesmo texto que o painel grava ao dividir;
 * - `paymentMethods`: as partes, quando são duas ou mais — o caixa e o acerto
 *   já mandam cada parte para a sua linha;
 * - `posDadosTransacao.maquininha`: a prova de cada passada (bandeira, NSU,
 *   autorização), que é o "conferido na maquininha" do acerto e do caixa.
 */
export async function receberEntrega(params: {
  lojaId: string; motoboy: { id: string; name: string }; orderId: string; dinheiroCentavos: number; trocoPara?: number | null;
}): Promise<{ ok: true; paymentMethod: string } | Erro> {
  const { lojaId, motoboy, orderId } = params;
  const dinheiroCentavos = Math.max(0, Math.round(params.dinheiroCentavos || 0));
  const pedido = await pedidoDoMotoboy(lojaId, motoboy.id, orderId);
  if (!pedido) return { ok: false, status: 404, mensagem: "Pedido não encontrado nas suas entregas." };

  const aprovadas = await aprovadasDoPedido(orderId);
  if (aprovadas.length === 0) {
    return { ok: false, status: 400, mensagem: "Nenhum cartão passou na maquininha neste pedido." };
  }
  const total = centavos(pedido.totalAmount);
  const soma = aprovadas.reduce((s, c) => s + c.valorCentavos, 0) + dinheiroCentavos;
  if (Math.abs(soma - total) > TOLERANCIA_CENTAVOS) {
    return {
      ok: false, status: 400,
      mensagem: `Maquininha + dinheiro dá R$ ${(soma / 100).toFixed(2).replace(".", ",")}, e o pedido é R$ ${(total / 100).toFixed(2).replace(".", ",")}.`,
    };
  }

  const partes = [
    ...aprovadas.map((c) => ({ method: formaDaEntrega(c.dados?.tipo), amount: reais(c.valorCentavos) })),
    ...(dinheiroCentavos > 0 ? [{ method: "Dinheiro", amount: reais(dinheiroCentavos) }] : []),
  ];
  const dividido = partes.length >= 2;
  const paymentMethod = dividido ? resumoDividido(partes) : partes[0].method;
  const trocoPara = dinheiroCentavos > 0 && Number(params.trocoPara) * 100 > dinheiroCentavos ? Number(params.trocoPara) : null;

  const maquininha = {
    conferidoEm: new Date().toISOString(),
    motoboy: motoboy.name,
    passadas: aprovadas.map((c) => ({
      cobrancaId: c.id,
      forma: formaDaEntrega(c.dados?.tipo),
      valor: reais(c.valorCentavos),
      bandeira: c.dados?.bandeira ?? null,
      nsu: c.dados?.nsu ?? null,
      autorizacao: c.dados?.autorizacao ?? null,
      terminal: c.dados?.terminal ?? null,
    })),
    dinheiroInformado: reais(dinheiroCentavos),
  };

  const registro: RegistroDeEdicao = {
    quando: new Date().toISOString(),
    quem: `${motoboy.name} (maquininha)`,
    acao: "PAGAMENTO",
    descricao: `Pagamento na entrega: ${pedido.paymentMethod || "não informado"} → ${paymentMethod} (conferido na maquininha)`,
    totalAntes: pedido.totalAmount,
    totalDepois: pedido.totalAmount,
  };

  await prisma.customerOrder.update({
    where: { id: orderId },
    data: {
      paymentMethod,
      changeAmount: trocoPara,
      paymentMethods: dividido ? (partes as any) : Prisma.DbNull,
      posDadosTransacao: { maquininha } as any,
      editHistory: empilharEdicao(pedido.editHistory, registro) as any,
    },
  });
  return { ok: true, paymentMethod };
}

export type ConferidoNaMaquininha = Record<"debit" | "credit" | "pix" | "voucher", { valor: number; qtd: number }>;

/**
 * O que passou na maquininha do motoboy nos pedidos do turno, por forma do
 * fechamento do caixa: a linha "✓ conferido na maquininha" embaixo de Débito,
 * Crédito, Pix e Vale. Informação — o esperado continua o mesmo.
 */
export function somarConferidoNaMaquininha(pedidos: { posDadosTransacao?: unknown }[]): ConferidoNaMaquininha {
  const soma: ConferidoNaMaquininha = { debit: { valor: 0, qtd: 0 }, credit: { valor: 0, qtd: 0 }, pix: { valor: 0, qtd: 0 }, voucher: { valor: 0, qtd: 0 } };
  for (const p of pedidos) {
    if (!conferidoNaMaquininha(p.posDadosTransacao)) continue;
    for (const passada of (p.posDadosTransacao as any).maquininha.passadas) {
      const forma = passada?.forma;
      const chave = forma === "Cartão Débito" ? "debit" : forma === "Cartão Crédito" ? "credit" : forma === "Vale-refeição" ? "voucher" : "pix";
      soma[chave].valor = Math.round((soma[chave].valor + (Number(passada?.valor) || 0)) * 100) / 100;
      soma[chave].qtd += 1;
    }
  }
  return soma;
}

/** O pedido foi conferido na maquininha? (acerto do motoboy e caixa) */
export function conferidoNaMaquininha(posDadosTransacao: unknown): boolean {
  const m = (posDadosTransacao as any)?.maquininha;
  return Boolean(m && Array.isArray(m.passadas) && m.passadas.length > 0);
}
