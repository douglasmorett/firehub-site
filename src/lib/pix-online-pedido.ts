/**
 * O PEDIDO DO CARDÁPIO PAGO PELO SITE (PIX OU CARTÃO) NA CONTA ASAAS DA LOJA.
 *
 * Todos os caminhos que mexem no dinheiro passam por aqui — a tela do cliente
 * (gerar e conferir), o webhook do Asaas, o cron que expira e o cancelamento
 * pelo painel. Regra que vale em um caminho e não no outro é como nasce pedido
 * pago que não vai para a cozinha, ou cancelado que continua cobrável.
 *
 * O que decide "pagou" é SEMPRE a consulta ao Asaas com a chave da loja, nunca
 * o corpo de um webhook nem o navegador.
 *
 * Campos do pedido usados (os mesmos que o Mercado Pago usava):
 *   gatewayProvider  = "asaas"
 *   gatewayPaymentId = id da cobrança no Asaas (pay_...)
 *   pagarmePixQrCode = o copia e cola (Pix)
 *   pagarmePixExpiry = até quando pode pagar (criação + MINUTOS_PARA_PAGAR)
 *   pagarmeMethod    = pix | credit_card
 *   pagarmeStatus    = pending | approved | expired | refunded | refund_pending | refund_failed
 *   customerCpfCnpj  = CPF de quem paga (o Asaas exige)
 *   taxaOnline       = a taxa do pagamento online e o que houve com o split
 */
import { prisma } from "@/lib/prisma";
import { decifrar } from "@/lib/cofre";
import {
  ambienteDaChave,
  clienteSemAvisos,
  cobrancaEstornada,
  cobrancaPaga,
  consultarCobranca,
  criarCobranca,
  estornarCobranca,
  excluirCobranca,
  asaasDaLoja,
  mesmoDominio,
  walletDoFireHub,
} from "@/lib/asaas-da-loja";
import { MINUTOS_PARA_PAGAR, SPLIT_FIREHUB_PERCENTUAL, reais, splitDoFireHub, type FormaOnline } from "@/lib/pix-online";
import { cpfValido } from "@/lib/fiscal-validacao";
import { avisarDono, avisarAdminDoSistema } from "@/lib/alertas-do-dono";

export const PROVEDOR_ASAAS = "asaas";

export const referenciaDoPedido = (orderId: string) => `pedido:${orderId}`;
export const pedidoDaReferencia = (ref: string | null | undefined): string | null =>
  ref && ref.startsWith("pedido:") ? ref.slice("pedido:".length) : null;

export function prazoParaPagar(criadoEm: Date): Date {
  return new Date(criadoEm.getTime() + MINUTOS_PARA_PAGAR * 60_000);
}

/**
 * O endereço público do cardápio. Mesma guarda de `urlDoSite` (lib/meta-ads):
 * no Coolify o NEXTAUTH_URL já veio mascarado como "[SENSITIVE]".
 */
export function siteDoFireHub(): string {
  const bruto = (process.env.NEXTAUTH_URL || "").trim();
  const ok = Boolean(bruto) && !bruto.includes("[SENSITIVE]") && /^https?:\/\//i.test(bruto);
  return (ok ? bruto : "https://firehubfood.com.br").replace(/\/$/, "");
}

/** O cardápio da loja — o site que o lojista cadastra no Asaas para o cartão voltar sozinho. */
export function cardapioDaLoja(slug: string): string {
  return `${siteDoFireHub()}/loja/${encodeURIComponent(slug)}`;
}

/**
 * Para onde o Asaas devolve o cliente depois de pagar o cartão. O cardápio lê
 * `?pagamento=<pedido>` e reabre a tela do pagamento, que confirma sozinha
 * (CustomerStorePage). O que confirma o pagamento é a consulta ao Asaas, nunca
 * a chegada a esta URL.
 */
export function voltaDoCartao(slug: string, orderId: string): string {
  return `${cardapioDaLoja(slug)}?pagamento=${encodeURIComponent(orderId)}`;
}

/** Qual forma pelo site o pedido escolheu. null = não é pagamento pelo site. */
export function formaDoPedido(paymentMethod: string | null | undefined): FormaOnline | null {
  const pm = String(paymentMethod || "").toUpperCase().trim();
  if (pm === "PIX" || pm === "PIX_ONLINE") return "pix";
  if (pm === "CREDITO_ONLINE" || pm === "CARTAO_ONLINE") return "cartao";
  return null;
}

export type ConexaoAsaas = {
  ambiente?: "producao" | "sandbox";
  walletId?: string | null;
  nome?: string;
  cpfCnpj?: string | null;
  situacao?: string;
  chavePix?: string | null;
  webhookId?: string | null;
  webhookTokenCifrado?: string | null;
  webhookUrl?: string | null;
  conectadoEm?: string;
  conectadoPor?: string;
  regrasAceitasEm?: string;
  versaoDasRegras?: number;
  verificadoEm?: string;
  desligadoEm?: string | null;
  desligadoMotivo?: string | null;
  /** Último aviso ao FireHub de split que não aconteceu (um por dia por loja). */
  avisoSplitEm?: string | null;
  /**
   * O site dos dados comerciais da conta, lido ao conectar e no "Conferir de
   * novo". Ausente (conexão antiga) = não sabido: o cartão tenta voltar
   * sozinho e, recusado, grava null aqui para não tentar de novo à toa.
   */
  site?: string | null;
};

/** A chave da loja em claro, ou null se não houver ou não abrir. */
export async function chaveDaLoja(lojaId: string): Promise<{ chave: string; conexao: ConexaoAsaas; storeName: string } | null> {
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { asaasChaveCifrada: true, asaasConexao: true, storeName: true },
  });
  const chave = decifrar(loja?.asaasChaveCifrada);
  if (!chave) return null;
  return { chave, conexao: ((loja?.asaasConexao as any) || {}) as ConexaoAsaas, storeName: loja?.storeName || "" };
}

async function avisarLoja(lojaId: string, texto: string) {
  await avisarDono(lojaId, "pix_online", texto).catch(() => false);
}

/**
 * Avisa o FIREHUB (não a loja) que a taxa do pagamento online não foi por
 * split. Sai pela instância da conta matriz — nunca pelo robô da loja, que
 * mostraria o recado no WhatsApp do lojista. Um aviso por loja por dia: se o
 * split parar de vez, seriam dezenas por noite.
 */
async function avisarFireHub(lojaId: string, texto: string) {
  console.error(`[PagamentoOnline] Loja ${lojaId}: ${texto}`);
  try {
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { storeName: true, asaasConexao: true } });
    const conexao = ((loja?.asaasConexao as any) || {}) as ConexaoAsaas;
    if (Date.now() - (Date.parse(conexao.avisoSplitEm || "") || 0) < 24 * 60 * 60 * 1000) return;
    await prisma.user.update({
      where: { id: lojaId },
      data: { asaasConexao: { ...conexao, avisoSplitEm: new Date().toISOString() } as any },
    });
    const matriz = await prisma.user.findFirst({ where: { isFireHubSystem: true }, select: { id: true } });
    if (!matriz) return;
    await avisarAdminDoSistema(
      matriz.id,
      `💸 *Taxa do pagamento online sem split* — ${loja?.storeName || lojaId}\n${texto}\n\n(Próximo aviso desta loja só amanhã. Os pedidos ficam marcados em taxaOnline.)`,
    );
  } catch (err: any) {
    console.error("[PagamentoOnline] Falha ao avisar o FireHub:", err?.message);
  }
}

const numeroDoPedido = (o: { dailyOrderNumber: number | null; id: string }) =>
  o.dailyOrderNumber ? `#${o.dailyOrderNumber}` : `#${o.id.slice(-6).toUpperCase()}`;

// ─── GERAR ─────────────────────────────────────────────────────────────────

export type CobrancaDoPedido = {
  paymentId: string;
  forma: FormaOnline;
  /** Pix: copia e cola (o nome é o que a tela do Mercado Pago já esperava). */
  pixKey: string | null;
  qrCodeBase64: string | null;
  /** Cartão: a página do Asaas onde o cliente digita o cartão. */
  linkDePagamento: string | null;
  /**
   * Cartão: o Asaas devolve o cliente ao cardápio depois de pagar. Com isso a
   * página do Asaas abre na MESMA aba; sem, numa aba nova (senão o cliente
   * ficaria preso na página de "pago" do Asaas).
   */
  voltaSozinho: boolean;
  expiresAt: string;
  provedor: "asaas";
};
/** Nome antigo, do tempo em que só havia Pix. */
export type PixDoPedido = CobrancaDoPedido;

type Resultado<T> = { ok: true; dados: T } | { ok: false; status: number; erro: string; pago?: boolean };

const NOME_DA_FORMA: Record<FormaOnline, string> = { pix: "Pix", cartao: "cartão" };

/**
 * Gera (ou devolve a já gerada) cobrança do pedido — Pix ou cartão, pela forma
 * que o cliente escolheu. Idempotente: a tela de pagamento pode montar duas
 * vezes, o cliente pode recarregar — continua sendo UMA cobrança por pedido.
 */
export async function gerarCobrancaDoPedido(orderId: string): Promise<Resultado<CobrancaDoPedido>> {
  const pedido = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, franchiseeId: true, status: true, paymentPaidAt: true, totalAmount: true, createdAt: true,
      customerName: true, customerPhone: true, customerCpfCnpj: true, dailyOrderNumber: true, paymentMethod: true,
      gatewayProvider: true, gatewayPaymentId: true, pagarmePixQrCode: true, taxaOnline: true,
      franchisee: { select: { storeName: true, slug: true, pixOnlineAtivo: true, cartaoOnlineAtivo: true } },
    },
  });
  if (!pedido) return { ok: false, status: 404, erro: "Pedido não encontrado." };
  const forma = formaDoPedido(pedido.paymentMethod);
  if (!forma) return { ok: false, status: 400, erro: "Este pedido não é de pagamento pelo site." };
  if (pedido.paymentPaidAt) return { ok: false, status: 409, erro: "Este pedido já está pago.", pago: true };
  if (pedido.status !== "AGUARDANDO_PAGAMENTO") {
    return { ok: false, status: 409, erro: "Este pedido não está mais esperando pagamento." };
  }

  const prazo = prazoParaPagar(pedido.createdAt);
  if (Date.now() > prazo.getTime()) {
    await conferirPagamentoDoPedido(orderId);
    return { ok: false, status: 410, erro: `O tempo para pagar (${MINUTOS_PARA_PAGAR} min) acabou e o pedido foi cancelado. Faça o pedido de novo.` };
  }

  const acesso = await chaveDaLoja(pedido.franchiseeId);
  const naoRecebe = {
    ok: false as const,
    status: 503,
    erro: `Esta loja não está recebendo ${NOME_DA_FORMA[forma]} pelo site agora. Escolha outra forma de pagamento.`,
  };
  if (!acesso) return naoRecebe;
  const { chave, conexao } = acesso;

  const resposta = (cobrancaId: string, extra: Partial<CobrancaDoPedido>): Resultado<CobrancaDoPedido> => ({
    ok: true,
    dados: {
      paymentId: cobrancaId,
      forma,
      pixKey: null,
      qrCodeBase64: null,
      linkDePagamento: null,
      voltaSozinho: false,
      expiresAt: prazo.toISOString(),
      provedor: "asaas",
      ...extra,
    },
  });

  // Já gerada: devolve a mesma (a imagem do QR e o link do cartão não ficam
  // no banco; são relidos do Asaas). Vale mesmo que a loja tenha desligado o
  // pagamento pelo site depois: o cliente que já está pagando termina de pagar.
  if (pedido.gatewayProvider === PROVEDOR_ASAAS && pedido.gatewayPaymentId) {
    const atual = await consultarCobranca(chave, pedido.gatewayPaymentId);
    if (atual.ok && cobrancaPaga(atual.dados?.status)) {
      await conferirPagamentoDoPedido(orderId);
      return { ok: false, status: 409, erro: "Este pedido já está pago.", pago: true };
    }
    if (atual.ok && !atual.dados?.deleted) {
      if (forma === "cartao") {
        return resposta(pedido.gatewayPaymentId, {
          linkDePagamento: atual.dados?.invoiceUrl ? String(atual.dados.invoiceUrl) : null,
          voltaSozinho: (pedido.taxaOnline as any)?.voltaSozinho === true,
        });
      }
      const qr = await asaasDaLoja(chave, `/payments/${pedido.gatewayPaymentId}/pixQrCode`);
      return resposta(pedido.gatewayPaymentId, {
        pixKey: String(qr.dados?.payload || pedido.pagarmePixQrCode || ""),
        qrCodeBase64: qr.dados?.encodedImage ? String(qr.dados.encodedImage) : null,
      });
    }
  }

  // Cobrança NOVA só com a forma ligada na loja.
  const ligada = forma === "pix" ? pedido.franchisee?.pixOnlineAtivo : pedido.franchisee?.cartaoOnlineAtivo;
  if (!ligada) return naoRecebe;

  const cpf = String(pedido.customerCpfCnpj || "").replace(/\D/g, "");
  if (!cpfValido(cpf)) {
    return { ok: false, status: 400, erro: `Para pagar com ${NOME_DA_FORMA[forma]} pelo site, informe um CPF válido na finalização do pedido.` };
  }

  // Trava: só UMA chamada cria a cobrança. A outra espera o id aparecer.
  // "creating" parado há mais de 1 minuto é chamada que morreu no meio: libera.
  const metodo = forma === "cartao" ? "credit_card" : "pix";
  const trava = await prisma.customerOrder.updateMany({
    where: {
      id: orderId,
      gatewayPaymentId: null,
      OR: [
        { pagarmeStatus: null },
        { pagarmeStatus: { not: "creating" } },
        { pagarmeStatus: "creating", updatedAt: { lt: new Date(Date.now() - 60_000) } },
      ],
    },
    data: { gatewayProvider: PROVEDOR_ASAAS, pagarmeStatus: "creating", pagarmeMethod: metodo },
  });
  if (trava.count === 0) {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const outro = await prisma.customerOrder.findUnique({
        where: { id: orderId },
        select: { gatewayPaymentId: true, pagarmeStatus: true },
      });
      if (outro?.gatewayPaymentId) return gerarCobrancaDoPedido(orderId);
      if (outro?.pagarmeStatus !== "creating") break;
    }
    return { ok: false, status: 409, erro: "A cobrança deste pedido está sendo gerada. Tente de novo em instantes." };
  }

  const liberarTrava = () =>
    prisma.customerOrder
      .updateMany({ where: { id: orderId, pagarmeStatus: "creating" }, data: { pagarmeStatus: null, gatewayProvider: null } })
      .catch(() => {});

  try {
    const cliente = await clienteSemAvisos(chave, {
      nome: pedido.customerName,
      cpf,
      telefone: pedido.customerPhone,
    });
    if (!cliente.ok || !cliente.dados?.id) {
      await liberarTrava();
      return { ok: false, status: 502, erro: `Não foi possível gerar a cobrança: ${cliente.erro || "cadastro do pagador recusado"}.` };
    }

    const ambiente = conexao.ambiente || ambienteDaChave(chave);
    const carteira = await walletDoFireHub(ambiente, conexao.walletId);
    const mesmaConta = !carteira && Boolean(conexao.walletId) && (await walletDoFireHub(ambiente, null)) === conexao.walletId;
    const valor = Math.round(Number(pedido.totalAmount) * 100) / 100;
    const taxa = splitDoFireHub(valor, forma);

    // Cartão volta sozinho ao cardápio quando o site da conta é do FireHub —
    // ou quando ainda não se sabe (conexão antiga): aí o Asaas decide.
    const slug = pedido.franchisee?.slug;
    const siteSabido = Object.prototype.hasOwnProperty.call(conexao, "site");
    const tentaVoltar = forma === "cartao" && Boolean(slug) && (!siteSabido || mesmoDominio(conexao.site, siteDoFireHub()));

    const cobranca = await criarCobranca(chave, {
      forma,
      clienteId: cliente.dados.id,
      valor,
      descricao: `Pedido ${numeroDoPedido(pedido)} — ${pedido.franchisee?.storeName || "cardápio"}`,
      referencia: referenciaDoPedido(orderId),
      walletDoSplit: carteira,
      valorDoSplit: taxa,
      voltarPara: tentaVoltar && slug ? voltaDoCartao(slug, orderId) : null,
    });
    if (!cobranca.ok || !cobranca.dados) {
      await liberarTrava();
      return { ok: false, status: 502, erro: `Não foi possível gerar a cobrança: ${cobranca.erro}` };
    }
    const c = cobranca.dados;

    // O que aconteceu com a taxa deste pedido — é o registro do que o FireHub
    // deveria receber, pedido a pedido.
    const situacaoDoSplit = c.split > 0 ? "ENVIADO" : c.splitRecusado ? "RECUSADO" : mesmaConta ? "MESMA_CONTA" : "SEM_CARTEIRA";
    const taxaOnline = {
      forma,
      percentual: SPLIT_FIREHUB_PERCENTUAL,
      valor: taxa,
      walletId: carteira,
      split: situacaoDoSplit,
      motivo: c.splitRecusado || null,
      criadoEm: new Date().toISOString(),
      // A página do Asaas abre na mesma aba só se ela devolve o cliente.
      voltaSozinho: c.voltaSozinho,
    };

    // O Asaas recusou a volta: o site da conta não é do FireHub. Fica anotado
    // para as próximas cobranças não tentarem à toa — o "Conferir de novo" em
    // Integrações relê o site.
    if (c.voltaRecusada) {
      console.warn(`[PagamentoOnline] Loja ${pedido.franchiseeId}: o Asaas recusou a volta do cartão (${c.voltaRecusada}).`);
      await prisma.user
        .update({ where: { id: pedido.franchiseeId }, data: { asaasConexao: { ...conexao, site: null } as any } })
        .catch(() => {});
    }

    await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        gatewayProvider: PROVEDOR_ASAAS,
        gatewayPaymentId: c.cobrancaId,
        pagarmePixQrCode: c.copiaECola,
        pagarmePixExpiry: prazo,
        pagarmeMethod: metodo,
        pagarmeStatus: "pending",
        taxaOnline,
      },
    });

    if (situacaoDoSplit === "RECUSADO") {
      await avisarFireHub(pedido.franchiseeId, `O Asaas recusou o split do pedido ${numeroDoPedido(pedido)} (${c.splitRecusado}). A cobrança saiu sem a taxa de ${reais(taxa)}.`);
    } else if (situacaoDoSplit === "SEM_CARTEIRA") {
      await avisarFireHub(pedido.franchiseeId, `Sem a carteira do FireHub para o split (${ambiente}). Confira ASAAS_WALLET_ID_FIREHUB ou a chave ASAAS_API_KEY do servidor.`);
    }

    return resposta(c.cobrancaId, {
      pixKey: c.copiaECola,
      qrCodeBase64: c.imagemBase64,
      linkDePagamento: c.linkDePagamento,
      voltaSozinho: c.voltaSozinho,
    });
  } catch (err: any) {
    await liberarTrava();
    console.error("[PagamentoOnline] Erro ao gerar a cobrança:", err?.message);
    return { ok: false, status: 500, erro: "Não foi possível gerar a cobrança agora. Tente de novo." };
  }
}

/** Nome antigo, do tempo em que só havia Pix. */
export const gerarPixDoPedido = gerarCobrancaDoPedido;

/**
 * Lê no Asaas o que houve com o split da taxa deste pedido e grava em
 * `taxaOnline`. Cancelado, recusado ou bloqueado → avisa o FireHub. Seguro de
 * chamar de novo (webhook de split, confirmação, cron).
 */
export async function conferirSplitDoPedido(orderId: string, cobrancaJaLida?: any): Promise<void> {
  const pedido = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { id: true, franchiseeId: true, dailyOrderNumber: true, gatewayPaymentId: true, taxaOnline: true },
  });
  const taxa = (pedido?.taxaOnline as any) || null;
  if (!pedido?.gatewayPaymentId || !taxa?.walletId || !["ENVIADO", "PENDING", "AWAITING_CREDIT", "PROCESSING"].includes(taxa.split)) return;

  let cobranca = cobrancaJaLida;
  if (!cobranca) {
    const acesso = await chaveDaLoja(pedido.franchiseeId);
    if (!acesso) return;
    const r = await consultarCobranca(acesso.chave, pedido.gatewayPaymentId);
    if (!r.ok) return;
    cobranca = r.dados;
  }
  const item = (Array.isArray(cobranca?.split) ? cobranca.split : []).find((s: any) => s?.walletId === taxa.walletId);
  if (!item) return;
  const status = String(item.status || "").toUpperCase();
  if (!status || status === taxa.split) return;

  const motivo = item.cancellationReason || item.refusalReason || null;
  await prisma.customerOrder.update({
    where: { id: orderId },
    data: { taxaOnline: { ...taxa, split: status, motivo, conferidoEm: new Date().toISOString() } },
  });
  if (["CANCELLED", "REFUSED", "BLOCKED_BY_VALUE_DIVERGENCE"].includes(status) && motivo !== "PAYMENT_REFUNDED") {
    await avisarFireHub(
      pedido.franchiseeId,
      `O split de ${reais(Number(taxa.valor) || 0)} do pedido ${numeroDoPedido(pedido)} ficou ${status}${motivo ? ` (${motivo})` : ""}.`,
    );
  }
}

// ─── CONFERIR ──────────────────────────────────────────────────────────────

export type Situacao = {
  pago: boolean;
  /** O pedido não vai mais ser pago: expirou, foi cancelado ou estornado. */
  encerrado: boolean;
  motivo?: "expirado" | "cancelado" | "estornado" | "analise";
};

/**
 * Consulta o Asaas e põe o pedido no estado certo. Seguro de chamar quantas
 * vezes for (tela a cada 3 s, webhook, cron): só confirma uma vez
 * (`confirmOrderPayment` tem trava) e só estorna uma vez.
 */
export async function conferirPagamentoDoPedido(orderId: string): Promise<Situacao> {
  const pedido = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, franchiseeId: true, status: true, paymentPaidAt: true, totalAmount: true, createdAt: true,
      dailyOrderNumber: true, gatewayProvider: true, gatewayPaymentId: true, pagarmeStatus: true, customerName: true,
    },
  });
  if (!pedido) return { pago: false, encerrado: true, motivo: "cancelado" };

  if (pedido.paymentPaidAt && pedido.status !== "CANCELADO") return { pago: true, encerrado: false };
  if (pedido.status === "CANCELADO" && !pedido.gatewayPaymentId) return { pago: false, encerrado: true, motivo: "cancelado" };

  const expirou = Date.now() > prazoParaPagar(pedido.createdAt).getTime();
  const acesso = await chaveDaLoja(pedido.franchiseeId);

  // Sem cobrança no Asaas (o cliente fechou a página antes de o QR sair).
  if (pedido.gatewayProvider !== PROVEDOR_ASAAS || !pedido.gatewayPaymentId) {
    if (expirou && pedido.status === "AGUARDANDO_PAGAMENTO") {
      await cancelarPorFaltaDePagamento(orderId);
      return { pago: false, encerrado: true, motivo: "expirado" };
    }
    return { pago: false, encerrado: false };
  }
  if (!acesso) return { pago: false, encerrado: false };

  const cobranca = await consultarCobranca(acesso.chave, pedido.gatewayPaymentId);
  if (!cobranca.ok) {
    // 404 = cobrança excluída do lado de lá. Qualquer outra falha: não decide nada agora.
    if (cobranca.status === 404 && pedido.status === "AGUARDANDO_PAGAMENTO" && expirou) {
      await cancelarPorFaltaDePagamento(orderId);
      return { pago: false, encerrado: true, motivo: "expirado" };
    }
    return { pago: false, encerrado: false };
  }

  const status = String(cobranca.dados?.status || "").toUpperCase();

  if (cobrancaEstornada(status)) {
    if (!["refunded", "refund_pending"].includes(String(pedido.pagarmeStatus))) {
      await prisma.customerOrder.update({
        where: { id: orderId },
        data: { pagarmeStatus: status === "REFUNDED" ? "refunded" : "refund_pending" },
      });
    }
    return { pago: false, encerrado: true, motivo: "estornado" };
  }

  if (cobrancaPaga(status)) {
    const valorPago = Number(cobranca.dados?.value || 0);
    if (Math.abs(valorPago - Number(pedido.totalAmount)) > 0.01) {
      // Não acontece com cobrança que o FireHub criou; se acontecer, é gente.
      console.error(`[PagamentoOnline] Pedido ${orderId}: Asaas diz ${valorPago}, pedido vale ${pedido.totalAmount}. Não confirmado.`);
      await avisarLoja(
        pedido.franchiseeId,
        `⚠️ *Pagamento pelo site: valor diferente* — pedido ${numeroDoPedido(pedido)} de ${pedido.customerName}.\n` +
          `O Asaas recebeu ${reais(valorPago)}, mas o pedido vale ${reais(Number(pedido.totalAmount))}. ` +
          "O pedido NÃO foi para a cozinha. Confira no Asaas e fale com o cliente.",
      );
      return { pago: false, encerrado: false };
    }

    // Pago DEPOIS do cancelamento (cliente pagou com o QR ainda aberto, ou a
    // loja cancelou enquanto ele pagava): não ressuscita o pedido — devolve.
    if (pedido.status === "CANCELADO") {
      await prisma.customerOrder.update({ where: { id: orderId }, data: { paymentPaidAt: new Date() } });
      await estornarPedidoPago(orderId, "Pagamento feito depois do cancelamento do pedido");
      return { pago: false, encerrado: true, motivo: "cancelado" };
    }

    const { confirmOrderPayment } = await import("@/lib/order-payment-confirm");
    await confirmOrderPayment(orderId);
    // A taxa do pagamento online: o split saiu? (Pix: já na hora; cartão:
    // fica pendente até o crédito, em até 2 dias úteis.)
    await conferirSplitDoPedido(orderId, cobranca.dados).catch(() => {});
    return { pago: true, encerrado: false };
  }

  // Cartão parado no antifraude do Asaas: ainda pode ser aprovado. Ganha mais
  // um prazo antes de o pedido ser cancelado; se for aprovado depois disso, a
  // conferência estorna (pedido cancelado não volta).
  const emAnalise = status === "AWAITING_RISK_ANALYSIS";
  if (emAnalise && pedido.status === "AGUARDANDO_PAGAMENTO" && Date.now() < prazoParaPagar(pedido.createdAt).getTime() + MINUTOS_PARA_PAGAR * 60_000) {
    return { pago: false, encerrado: false, motivo: "analise" };
  }

  if (pedido.status === "CANCELADO") {
    // Cancelado e ainda cobrável: fecha o QR. "expired" tira o pedido da ronda
    // do cron — cobrança excluída não recebe mais.
    const apagada = cobranca.dados?.deleted ? { ok: true } : await excluirCobranca(acesso.chave, pedido.gatewayPaymentId);
    if (apagada.ok && pedido.pagarmeStatus !== "expired") {
      await prisma.customerOrder.update({ where: { id: orderId }, data: { pagarmeStatus: "expired" } });
    }
    return { pago: false, encerrado: true, motivo: "cancelado" };
  }

  if (expirou && pedido.status === "AGUARDANDO_PAGAMENTO") {
    const apagada = cobranca.dados?.deleted ? { ok: true } : await excluirCobranca(acesso.chave, pedido.gatewayPaymentId);
    if (!apagada.ok) {
      // O Asaas recusa excluir cobrança paga: o pagamento pode ter caído agora.
      const denovo = await consultarCobranca(acesso.chave, pedido.gatewayPaymentId);
      if (denovo.ok && cobrancaPaga(denovo.dados?.status)) return conferirPagamentoDoPedido(orderId);
    }
    // Cobrança que não saiu do Asaas fica "pending": o cron segue conferindo
    // por 2 h e estorna se ela ainda for paga (cartão aprovado no antifraude).
    await cancelarPorFaltaDePagamento(orderId, apagada.ok ? "expired" : "pending");
    return { pago: false, encerrado: true, motivo: "expirado" };
  }

  return { pago: false, encerrado: false };
}

async function cancelarPorFaltaDePagamento(orderId: string, pagarmeStatus: "expired" | "pending" = "expired") {
  await prisma.customerOrder.updateMany({
    where: { id: orderId, status: "AGUARDANDO_PAGAMENTO", paymentPaidAt: null },
    data: {
      status: "CANCELADO",
      cancelledBy: "SYSTEM_PIX_NAO_PAGO",
      cancelReason: `Pagamento pelo site não feito em ${MINUTOS_PARA_PAGAR} minutos`,
      pagarmeStatus,
      kdsStage: "FINISHED",
    },
  });
}

// ─── CANCELAR E ESTORNAR ───────────────────────────────────────────────────

/**
 * O CLIENTE desistiu na tela do Pix. Antes de cancelar, confere: se o Pix caiu
 * no meio do caminho, o pedido segue pago (e a tela mostra isso).
 */
export async function cancelarPeloCliente(
  orderId: string,
  quem: { por: string; motivo: string } = { por: "CUSTOMER", motivo: "O cliente desistiu na tela de pagamento" },
): Promise<{ pago: boolean; cancelado: boolean; erro?: string }> {
  const antes = await conferirPagamentoDoPedido(orderId);
  if (antes.pago) return { pago: true, cancelado: false };

  const pedido = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { status: true, paymentPaidAt: true, gatewayProvider: true, gatewayPaymentId: true, franchiseeId: true },
  });
  if (!pedido) return { pago: false, cancelado: false, erro: "Pedido não encontrado." };
  if (pedido.status === "CANCELADO") return { pago: false, cancelado: true };
  if (pedido.status !== "AGUARDANDO_PAGAMENTO" || pedido.paymentPaidAt) {
    return { pago: false, cancelado: false, erro: "Este pedido já foi para a loja e não pode ser cancelado por aqui." };
  }

  if (pedido.gatewayProvider === PROVEDOR_ASAAS && pedido.gatewayPaymentId) {
    const acesso = await chaveDaLoja(pedido.franchiseeId);
    if (acesso) {
      const apagada = await excluirCobranca(acesso.chave, pedido.gatewayPaymentId);
      if (!apagada.ok) {
        const agora = await conferirPagamentoDoPedido(orderId);
        if (agora.pago) return { pago: true, cancelado: false };
      }
    }
  }

  await prisma.customerOrder.updateMany({
    where: { id: orderId, status: "AGUARDANDO_PAGAMENTO", paymentPaidAt: null },
    data: {
      status: "CANCELADO",
      cancelledBy: quem.por,
      cancelReason: quem.motivo,
      pagarmeStatus: pedido.gatewayPaymentId ? "expired" : null,
      kdsStage: "FINISHED",
    },
  });
  return { pago: false, cancelado: true };
}

/**
 * A LOJA cancelou pelo painel (a rota de status já gravou CANCELADO). Pedido
 * pago: estorna. Pedido esperando: exclui a cobrança para o QR não valer mais.
 */
export async function aoCancelarPedidoPelaLoja(orderId: string, motivo?: string | null): Promise<string | null> {
  const pedido = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: { franchiseeId: true, paymentPaidAt: true, gatewayProvider: true, gatewayPaymentId: true },
  });
  if (!pedido || pedido.gatewayProvider !== PROVEDOR_ASAAS || !pedido.gatewayPaymentId) return null;

  if (pedido.paymentPaidAt) {
    return estornarPedidoPago(orderId, motivo || "Pedido cancelado pela loja");
  }
  const acesso = await chaveDaLoja(pedido.franchiseeId);
  if (!acesso) return null;
  const apagada = await excluirCobranca(acesso.chave, pedido.gatewayPaymentId);
  if (apagada.ok) {
    await prisma.customerOrder.update({ where: { id: orderId }, data: { pagarmeStatus: "expired" } });
  } else {
    // Pode ter sido pago agora: a conferência estorna (pedido já está CANCELADO).
    await conferirPagamentoDoPedido(orderId);
  }
  return null;
}

/**
 * Devolve o Pix ao cliente. Uma vez só por pedido. Devolve o texto para a tela
 * quando o estorno não saiu na hora (null = tudo certo).
 */
export async function estornarPedidoPago(orderId: string, motivo: string): Promise<string | null> {
  const pedido = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, franchiseeId: true, totalAmount: true, dailyOrderNumber: true, customerName: true,
      gatewayProvider: true, gatewayPaymentId: true, pagarmeStatus: true,
    },
  });
  if (!pedido || pedido.gatewayProvider !== PROVEDOR_ASAAS || !pedido.gatewayPaymentId) return null;
  if (["refunded", "refund_pending"].includes(String(pedido.pagarmeStatus))) return null;

  // Marca antes de pedir, para duas chamadas simultâneas não pedirem dois estornos.
  // `notIn` sozinho deixaria de fora o pedido com status nulo (NULL NOT IN
  // ... é desconhecido no SQL, não verdadeiro): o nulo entra pelo OR.
  const trava = await prisma.customerOrder.updateMany({
    where: {
      id: orderId,
      OR: [{ pagarmeStatus: null }, { pagarmeStatus: { notIn: ["refunded", "refund_pending", "refunding"] } }],
    },
    data: { pagarmeStatus: "refunding" },
  });
  if (trava.count === 0) return null;

  const acesso = await chaveDaLoja(pedido.franchiseeId);
  const numero = numeroDoPedido(pedido);
  const valor = reais(Number(pedido.totalAmount));

  if (!acesso) {
    await prisma.customerOrder.update({ where: { id: orderId }, data: { pagarmeStatus: "refund_failed" } });
    const texto = `O estorno de ${valor} do pedido ${numero} não foi feito: a conta Asaas está desconectada. Devolva o valor pelo app do Asaas.`;
    await avisarLoja(pedido.franchiseeId, `⚠️ *Pagamento pelo site: estorno não feito*\n${texto}`);
    return texto;
  }

  const r = await estornarCobranca(acesso.chave, pedido.gatewayPaymentId, motivo);
  if (!r.ok) {
    await prisma.customerOrder.update({ where: { id: orderId }, data: { pagarmeStatus: "refund_failed" } });
    const texto = `O Asaas não estornou os ${valor} do pedido ${numero} (${pedido.customerName}): ${r.erro} Devolva o valor pelo app do Asaas.`;
    await avisarLoja(pedido.franchiseeId, `⚠️ *Pagamento pelo site: estorno não feito*\n${texto}`);
    return texto;
  }

  const estornos: any[] = Array.isArray(r.dados?.refunds) ? r.dados.refunds : [];
  const aguardandoAutorizacao = estornos.some((e) =>
    ["AWAITING_CRITICAL_ACTION_AUTHORIZATION", "AWAITING_CUSTOMER_EXTERNAL_AUTHORIZATION"].includes(String(e?.status)),
  );
  const concluido = String(r.dados?.status || "").toUpperCase() === "REFUNDED";

  await prisma.customerOrder.update({
    where: { id: orderId },
    data: { pagarmeStatus: concluido ? "refunded" : "refund_pending" },
  });

  if (aguardandoAutorizacao) {
    const texto = `O estorno de ${valor} do pedido ${numero} está esperando você AUTORIZAR no app do Asaas.`;
    await avisarLoja(pedido.franchiseeId, `⏳ *Pagamento pelo site: autorize o estorno*\n${texto}`);
    return texto;
  }
  return null;
}

// ─── A CHAVE DA LOJA ───────────────────────────────────────────────────────

/** Tira o pagamento pelo site (Pix e cartão) do cardápio e conta à loja por quê. */
export async function desligarPixOnline(lojaId: string, motivo: string) {
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { pixOnlineAtivo: true, cartaoOnlineAtivo: true, asaasConexao: true },
  });
  if (!loja) return;
  const conexao = { ...((loja.asaasConexao as any) || {}), desligadoEm: new Date().toISOString(), desligadoMotivo: motivo };
  await prisma.user.update({
    where: { id: lojaId },
    data: { pixOnlineAtivo: false, cartaoOnlineAtivo: false, asaasConexao: conexao },
  });
  if (loja.pixOnlineAtivo || loja.cartaoOnlineAtivo) {
    await avisarLoja(
      lojaId,
      `🔴 *Pagamento pelo site desligado*\n${motivo}\n\nO cardápio continua aceitando as outras formas de pagamento. ` +
        "Para voltar, gere uma chave nova no Asaas (Integrações → Chaves de API) e conecte de novo no FireHub, em Integrações → Asaas.",
    );
  }
}

/**
 * Usa a chave (o Asaas desativa chave parada há 3 meses) e confere se ainda
 * abre a conta. 401 = chave morta: desliga e avisa.
 */
export async function verificarChaveDaLoja(lojaId: string): Promise<"ok" | "recusada" | "sem_chave" | "falha"> {
  const acesso = await chaveDaLoja(lojaId);
  if (!acesso) return "sem_chave";
  const r = await asaasDaLoja(acesso.chave, "/myAccount/status/");
  if (r.status === 401) {
    await desligarPixOnline(lojaId, "O Asaas recusou a chave de API da loja (desativada, expirada ou excluída).");
    return "recusada";
  }
  if (!r.ok) return "falha";
  const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { asaasConexao: true } });
  const conexao = {
    ...((loja?.asaasConexao as any) || {}),
    verificadoEm: new Date().toISOString(),
    situacao: String(r.dados?.general || (loja?.asaasConexao as any)?.situacao || ""),
  };
  await prisma.user.update({ where: { id: lojaId }, data: { asaasConexao: conexao } });
  return "ok";
}
