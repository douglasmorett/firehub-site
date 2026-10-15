/**
 * /src/lib/tef-do-totem.ts
 *
 * TEF (pinpad) no TOTEM, pela PayGo Web (PGWebLib.dll) que roda DENTRO do
 * Assistente do computador do totem (firehub-print-assistant/tef/).
 *
 * Quem fala com o cartão é o Assistente; o servidor só:
 *   1. liga o TEF numa licença do totem e gera DUAS credenciais (pareamento):
 *      - a CHAVE do Assistente (Bearer) — com ela o motor TEF diz "aprovou" em
 *        /api/totem/tef/resultado. Volta UMA vez; aqui fica só o hash.
 *      - o SEGREDO LOCAL — o totem manda ao Assistente no header
 *        `x-firehub-tef`, para as rotas /tef do Assistente não obedecerem a
 *        qualquer site aberto no computador. Precisa ser devolvido ao totem a
 *        cada abertura, por isso fica CIFRADO (lib/cofre.ts), não em hash.
 *   2. recebe o resultado da transação e decide se o motor CONFIRMA (CNF) ou
 *      DESFAZ na PayGo. Regra de ouro do TEF: a transação só é confirmada
 *      depois de a venda estar gravada aqui; qualquer dúvida é desfazer.
 *
 * Tabela própria, criada no primeiro uso (mesmo padrão de
 * lib/cobranca-da-mesa-na-maquininha.ts): loja sem TEF nunca toca nela e não
 * há migração manual em produção.
 *
 * `gatewayProvider` só é carimbado com o "aprovado" do pinpad em mãos: fora
 * daqui esse campo sozinho já conta como venda recebida.
 */
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/cofre";
import { ESTADOS_DA_COBRANCA } from "@/lib/terminal-app";

/** O que vai em `gatewayProvider` quando o pinpad aprovou. */
export const PROVEDOR_TEF = "PAYGO_TEF";

/**
 * Cobrança TEF em andamento no pinpad. NÃO é AGUARDANDO_TERMINAL de propósito:
 * esse estado é a FILA do app da maquininha (/api/pos/terminal/pendente pega
 * qualquer pedido da loja com ele), e uma maquininha com app na mesma loja
 * cobraria o pedido que está no pinpad do totem.
 */
export const ESTADO_TEF_NO_PINPAD = "TEF_NO_PINPAD";

export type Decisao = "CONFIRMAR" | "DESFAZER" | "NADA";

export type LinhaTef = {
  licencaId: string;
  franchiseeId: string;
  chaveHash: string;
  segredoLocalCifrado: string;
  ligadoEm: Date;
  ligadoPor: string | null;
  ultimoContato: Date | null;
};

let pronta: Promise<void> | null = null;

function garantirTabela(): Promise<void> {
  if (!pronta) {
    pronta = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "TefDoTotem" (
          "licencaId"           TEXT PRIMARY KEY,
          "franchiseeId"        TEXT NOT NULL,
          "chaveHash"           TEXT NOT NULL,
          "segredoLocalCifrado" TEXT NOT NULL,
          "ligadoEm"            TIMESTAMPTZ NOT NULL DEFAULT now(),
          "ligadoPor"           TEXT,
          "ultimoContato"       TIMESTAMPTZ
        )`);
      await prisma.$executeRawUnsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS "TefDoTotem_chave" ON "TefDoTotem" ("chaveHash")`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "TefDoTotem_loja" ON "TefDoTotem" ("franchiseeId")`,
      );
    })().catch((e) => {
      pronta = null;
      throw e;
    });
  }
  return pronta;
}

export function hashDaChaveTef(chave: string): string {
  return crypto.createHash("sha256").update(`firehub-tef:${chave}`).digest("hex");
}

function novoSegredo(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Liga (ou religa) o TEF numa licença. Religar TROCA as duas credenciais: o
 * Assistente pareado antes para de conseguir confirmar venda — um totem, um
 * computador com pinpad.
 */
export async function ligarTef(params: { licencaId: string; franchiseeId: string; por: string | null }) {
  await garantirTabela();
  const chave = novoSegredo();
  const segredoLocal = novoSegredo();
  await prisma.$executeRawUnsafe(
    `INSERT INTO "TefDoTotem" ("licencaId", "franchiseeId", "chaveHash", "segredoLocalCifrado", "ligadoEm", "ligadoPor", "ultimoContato")
     VALUES ($1, $2, $3, $4, now(), $5, NULL)
     ON CONFLICT ("licencaId") DO UPDATE SET "franchiseeId" = EXCLUDED."franchiseeId", "chaveHash" = EXCLUDED."chaveHash",
       "segredoLocalCifrado" = EXCLUDED."segredoLocalCifrado", "ligadoEm" = now(), "ligadoPor" = EXCLUDED."ligadoPor", "ultimoContato" = NULL`,
    params.licencaId,
    params.franchiseeId,
    hashDaChaveTef(chave),
    cifrar(segredoLocal),
    params.por,
  );
  return { chave, segredoLocal };
}

export async function desligarTef(licencaId: string, franchiseeId: string): Promise<boolean> {
  await garantirTabela();
  const n = await prisma.$executeRawUnsafe(
    `DELETE FROM "TefDoTotem" WHERE "licencaId" = $1 AND "franchiseeId" = $2`,
    licencaId,
    franchiseeId,
  );
  return Number(n) > 0;
}

export async function tefDaLoja(franchiseeId: string): Promise<{ licencaId: string; ligadoEm: Date; ultimoContato: Date | null }[]> {
  await garantirTabela();
  const linhas = await prisma.$queryRawUnsafe<LinhaTef[]>(
    `SELECT * FROM "TefDoTotem" WHERE "franchiseeId" = $1`,
    franchiseeId,
  );
  return linhas.map((l) => ({ licencaId: l.licencaId, ligadoEm: l.ligadoEm, ultimoContato: l.ultimoContato }));
}

/** O segredo local da licença, se ela tem TEF ligado (e o cofre abre). */
export async function tefDaLicenca(licencaId: string): Promise<{ segredoLocal: string } | null> {
  await garantirTabela();
  const [l] = await prisma.$queryRawUnsafe<LinhaTef[]>(
    `SELECT * FROM "TefDoTotem" WHERE "licencaId" = $1`,
    licencaId,
  );
  if (!l) return null;
  const segredoLocal = decifrar(l.segredoLocalCifrado);
  if (!segredoLocal) {
    console.error(`[TEF] O segredo local da licença ${licencaId} não abriu (chave do cofre trocada?). Religue o TEF no painel.`);
    return null;
  }
  return { segredoLocal };
}

/** Quem é o Assistente que chamou: a licença da chave Bearer, ou null. */
export async function licencaDaChaveTef(
  authorization: string | null | undefined,
): Promise<{ licencaId: string; franchiseeId: string } | null> {
  const m = /^Bearer\s+(\S{20,})$/i.exec(String(authorization || "").trim());
  if (!m) return null;
  await garantirTabela();
  const [l] = await prisma.$queryRawUnsafe<LinhaTef[]>(
    `SELECT * FROM "TefDoTotem" WHERE "chaveHash" = $1`,
    hashDaChaveTef(m[1]),
  );
  if (!l) return null;
  await prisma
    .$executeRawUnsafe(`UPDATE "TefDoTotem" SET "ultimoContato" = now() WHERE "licencaId" = $1`, l.licencaId)
    .catch(() => {});
  return { licencaId: l.licencaId, franchiseeId: l.franchiseeId };
}

// ── O resultado da transação ────────────────────────────────────────────────

export type CorpoDoResultado = {
  pedidoId?: unknown;
  /** Id da transação no Assistente — é o que torna o reenvio idempotente. */
  transacaoId?: unknown;
  aprovado?: unknown;
  cancelado?: unknown;
  valorCentavos?: unknown;
  nsu?: unknown;
  nsuHost?: unknown;
  autorizacao?: unknown;
  bandeira?: unknown;
  cartao?: unknown;
  tipo?: unknown;
  parcelas?: unknown;
  rede?: unknown;
  mensagem?: unknown;
  comprovanteLoja?: unknown;
  comprovanteCliente?: unknown;
};

export type Resposta = { status: number; corpo: Record<string, unknown> };

const texto = (v: unknown, max = 200): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** "credito"/"CREDITO"/"1" → "Crédito"; "debito"/"2" → "Débito". */
export function tipoDoCartao(v: unknown): "Crédito" | "Débito" | null {
  const s = String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (s === "1" || s.startsWith("cred")) return "Crédito";
  if (s === "2" || s.startsWith("deb")) return "Débito";
  return null;
}

export function formaDoPedidoTef(tipo: unknown): string {
  const t = tipoDoCartao(tipo);
  return t ? `Cartão ${t} (TEF)` : "Cartão (TEF)";
}

const DESFAZER = (status: number, motivo: string, mensagem: string): Resposta => ({
  status,
  corpo: { acao: "DESFAZER", podeConfirmar: false, motivo, mensagem },
});

const SELECAO = {
  id: true,
  franchiseeId: true,
  status: true,
  totalAmount: true,
  paymentPaidAt: true,
  gatewayProvider: true,
  posStatus: true,
  posDadosTransacao: true,
  dailyOrderNumber: true,
  totemLicenseId: true,
} as const;

function transacaoGravada(pedido: { posDadosTransacao: unknown }): string | null {
  const d = pedido.posDadosTransacao as any;
  return d && typeof d === "object" && d.provedor === PROVEDOR_TEF && d.aprovado !== false ? texto(d.transacaoId) : null;
}

/**
 * O que o motor TEF faz com uma transação que o pinpad devolveu.
 *
 * Aprovado → só responde CONFIRMAR (200) com a venda gravada e o pagamento
 * confirmado no pedido. Reenvio da MESMA transação (o Assistente perdeu a
 * resposta e mandou de novo) responde CONFIRMAR outra vez, sem efeito.
 * Pedido inexistente, de outra loja, cancelado, com valor diferente ou já pago
 * por OUTRO meio → DESFAZER: o cartão não pode ficar debitado sem venda.
 *
 * Recusado/cancelado no pinpad → registra para o totem oferecer "tentar de
 * novo"; nada a confirmar.
 */
export async function registrarResultadoTef(
  licenca: { licencaId: string; franchiseeId: string },
  corpo: CorpoDoResultado,
): Promise<Resposta> {
  const pedidoId = texto(corpo.pedidoId, 64);
  const transacaoId = texto(corpo.transacaoId, 64);
  if (!pedidoId || !transacaoId) {
    return { status: 400, corpo: { error: "pedidoId e transacaoId são obrigatórios." } };
  }
  const aprovado = corpo.aprovado === true;

  const pedido = await prisma.customerOrder.findUnique({ where: { id: pedidoId }, select: SELECAO });
  if (!pedido) return DESFAZER(404, "PEDIDO_INEXISTENTE", "Este pedido não existe no FireHub.");
  if (pedido.franchiseeId !== licenca.franchiseeId) {
    console.error(`[TEF] Licença ${licenca.licencaId} (loja ${licenca.franchiseeId}) mandou resultado do pedido ${pedidoId} de outra loja.`);
    return DESFAZER(403, "OUTRA_LOJA", "Este pedido não é desta loja.");
  }

  const dados = {
    provedor: PROVEDOR_TEF,
    licencaId: licenca.licencaId,
    transacaoId,
    aprovado,
    cancelado: corpo.cancelado === true,
    valorCentavos: Number.isFinite(Number(corpo.valorCentavos)) ? Math.round(Number(corpo.valorCentavos)) : null,
    nsu: texto(corpo.nsu, 64),
    nsuHost: texto(corpo.nsuHost, 64),
    autorizacao: texto(corpo.autorizacao, 32),
    bandeira: texto(corpo.bandeira, 64),
    cartao: texto(corpo.cartao, 32),
    tipo: tipoDoCartao(corpo.tipo),
    parcelas: Number.isFinite(Number(corpo.parcelas)) ? Number(corpo.parcelas) : null,
    rede: texto(corpo.rede, 64),
    mensagem: texto(corpo.mensagem, 200),
    comprovanteLoja: texto(corpo.comprovanteLoja, 6000),
    comprovanteCliente: texto(corpo.comprovanteCliente, 6000),
    em: new Date().toISOString(),
  };

  // ── Recusado / cancelado no pinpad ────────────────────────────────────────
  if (!aprovado) {
    if (pedido.paymentPaidAt || pedido.status === "CANCELADO") {
      return { status: 200, corpo: { acao: "NADA", podeConfirmar: false, jaEncerrado: true } };
    }
    await prisma.customerOrder.update({
      where: { id: pedido.id },
      data: {
        posStatus: dados.cancelado ? ESTADOS_DA_COBRANCA.cancelado : ESTADOS_DA_COBRANCA.recusado,
        posTentativas: { increment: 1 },
        // A recusa fica registrada: recusa em série no mesmo pedido é padrão
        // de cartão clonado, e quem fecha o caixa precisa enxergar.
        posDadosTransacao: dados as any,
      },
    });
    return { status: 200, corpo: { acao: "NADA", podeConfirmar: false, podeTentarDeNovo: true } };
  }

  // ── Aprovado ──────────────────────────────────────────────────────────────
  if (pedido.paymentPaidAt) {
    if (transacaoGravada(pedido) === transacaoId) {
      return {
        status: 200,
        corpo: { acao: "CONFIRMAR", podeConfirmar: true, jaConfirmado: true, numero: pedido.dailyOrderNumber ?? null },
      };
    }
    console.error(
      `[TEF] PAGAMENTO EM DOBRO EVITADO: pedido ${pedido.id} já estava pago e o pinpad aprovou outra transação (${transacaoId}). Mandando desfazer.`,
    );
    return DESFAZER(409, "JA_PAGO", "Este pedido já foi pago. A transação do pinpad será desfeita.");
  }
  if (pedido.status === "CANCELADO") {
    return DESFAZER(409, "PEDIDO_CANCELADO", "Este pedido foi cancelado. A transação do pinpad será desfeita.");
  }
  const esperado = Math.round((pedido.totalAmount || 0) * 100);
  if (dados.valorCentavos !== esperado) {
    console.error(`[TEF] Pedido ${pedido.id}: esperado ${esperado} centavos, o pinpad aprovou ${dados.valorCentavos}. Mandando desfazer.`);
    return DESFAZER(409, "VALOR_DIVERGENTE", "O valor aprovado no pinpad não é o valor do pedido.");
  }

  // Trava: só UMA transação aprovada vira o pagamento do pedido. Duas chegando
  // juntas (o cliente passou dois cartões? reenvio cruzado?) — a segunda acha
  // gatewayProvider preenchido e cai no "já pago / mesma transação" acima.
  const trava = await prisma.customerOrder.updateMany({
    where: { id: pedido.id, paymentPaidAt: null, gatewayProvider: null, status: { not: "CANCELADO" } },
    data: {
      posStatus: ESTADOS_DA_COBRANCA.pago,
      gatewayProvider: PROVEDOR_TEF,
      gatewayPaymentId: dados.nsuHost || dados.nsu || dados.autorizacao || transacaoId,
      paymentMethod: formaDoPedidoTef(dados.tipo),
      posDadosTransacao: dados as any,
    },
  });
  if (trava.count === 0) {
    const agora = await prisma.customerOrder.findUnique({ where: { id: pedido.id }, select: SELECAO });
    if (agora && transacaoGravada(agora) === transacaoId && agora.status !== "CANCELADO") {
      // A mesma transação chegou duas vezes ao mesmo tempo: a outra cuidou.
      const { confirmOrderPayment } = await import("@/lib/order-payment-confirm");
      const c = await confirmOrderPayment(pedido.id);
      return { status: 200, corpo: { acao: "CONFIRMAR", podeConfirmar: true, jaConfirmado: true, numero: c?.dailyOrderNumber ?? null } };
    }
    return DESFAZER(409, agora?.status === "CANCELADO" ? "PEDIDO_CANCELADO" : "JA_PAGO", "Este pedido já tem outro pagamento.");
  }

  const { confirmOrderPayment } = await import("@/lib/order-payment-confirm");
  const confirmado = await confirmOrderPayment(pedido.id);
  if (!confirmado || confirmado.status === "CANCELADO" || !confirmado.paymentPaidAt) {
    // Cancelaram o pedido entre a leitura e a confirmação: a venda NÃO existe,
    // então o cartão tem que voltar. Tira o carimbo de recebido.
    await prisma.customerOrder.update({
      where: { id: pedido.id },
      data: {
        gatewayProvider: null,
        gatewayPaymentId: null,
        posStatus: ESTADOS_DA_COBRANCA.cancelado,
        posDadosTransacao: { ...dados, desfeito: true } as any,
      },
    });
    return DESFAZER(409, "PEDIDO_CANCELADO", "O pedido foi cancelado durante o pagamento. A transação será desfeita.");
  }
  if (pedido.totemLicenseId && pedido.totemLicenseId !== licenca.licencaId) {
    console.warn(`[TEF] Pedido ${pedido.id} nasceu no totem ${pedido.totemLicenseId} e foi pago no pinpad da licença ${licenca.licencaId}.`);
  }
  return {
    status: 200,
    corpo: { acao: "CONFIRMAR", podeConfirmar: true, numero: confirmado.dailyOrderNumber ?? pedido.dailyOrderNumber ?? null },
  };
}

/**
 * Para o motor resolver a transação que ficou pendente em disco (Assistente
 * caiu entre o "aprovado" do pinpad e a confirmação): CONFIRMAR só se ESTA
 * transação é o pagamento gravado do pedido; qualquer outra coisa é desfazer.
 */
export async function situacaoParaPendencia(
  licenca: { licencaId: string; franchiseeId: string },
  pedidoId: string | null,
  transacaoId: string | null,
): Promise<Resposta> {
  if (!pedidoId || !transacaoId) return { status: 400, corpo: { error: "id e transacao são obrigatórios." } };
  const pedido = await prisma.customerOrder.findUnique({ where: { id: pedidoId }, select: SELECAO });
  if (!pedido) return DESFAZER(404, "PEDIDO_INEXISTENTE", "Este pedido não existe no FireHub.");
  if (pedido.franchiseeId !== licenca.franchiseeId) return DESFAZER(403, "OUTRA_LOJA", "Este pedido não é desta loja.");
  const pagoPorEsta = Boolean(pedido.paymentPaidAt) && transacaoGravada(pedido) === transacaoId && pedido.status !== "CANCELADO";
  return {
    status: 200,
    corpo: {
      existe: true,
      pago: Boolean(pedido.paymentPaidAt),
      pagoPorEstaTransacao: pagoPorEsta,
      cancelado: pedido.status === "CANCELADO",
      acao: pagoPorEsta ? "CONFIRMAR" : "DESFAZER",
      podeConfirmar: pagoPorEsta,
    },
  };
}
