import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";
import {
  MENSAGEM_CAIXA_FECHADO, ERRO_CAIXA_FECHADO, MENSAGEM_CAIXA_FECHADO_ONLINE, decidirCaixaDoPedidoOnline,
} from "@/lib/caixa-aberto";
import { lerBalcaoConfig } from "@/lib/balcao-config";
import { pegarVez } from "@/lib/vez";
import { gravarQuemAbriu } from "@/lib/quem-abriu-o-caixa";
import { avisarDono } from "@/lib/alertas-do-dono";

/**
 * A consulta ao banco da trava de caixa (lib/caixa-aberto.ts tem o porquê).
 *
 * Mora separado porque aquele arquivo é importado pela tela do PDV, que é
 * componente de cliente — o prisma aqui dentro iria junto para o navegador.
 */

/**
 * Tem caixa aberto nesta loja?
 *
 * Falha de banco devolve `true` de propósito: a trava existe para proteger o
 * fechamento, não para parar a operação. Se a consulta cair, recusar toda
 * venda do balcão seria trocar um furo de caixa por uma loja parada — e a
 * loja parada é o prejuízo maior e imediato.
 */
export async function caixaEstaAberto(franchiseeId: string): Promise<boolean> {
  try {
    const aberto = await prisma.cashSession.findFirst({
      where: { franchiseeId, status: "OPEN" },
      select: { id: true },
    });
    return Boolean(aberto);
  } catch (err) {
    console.error("[Caixa] não consegui conferir se está aberto:", (err as any)?.code || err);
    return true;
  }
}

/**
 * A recusa pronta quando o caixa está fechado, ou `null` para seguir.
 *
 * Existe para as rotas de MESA não repetirem o mesmo bloco quatro vezes — e,
 * pior, não repetirem com mensagens ligeiramente diferentes. O garçom que tenta
 * abrir a mesa e o que tenta fechar a conta leem a mesma frase.
 *
 * O caixa da mesa é o da LOJA: quem abre é o painel, não o garçom. Por isso a
 * mensagem manda "avise quem abre o caixa" em vez de mandar ele abrir — o
 * garçom logado pelo link não tem essa tela.
 */
export async function recusaSeCaixaFechado(
  franchiseeId: string,
  ondeEstava: "abrir a mesa" | "lançar o item" | "fechar a conta" | "registrar o pagamento",
): Promise<NextResponse | null> {
  if (await caixaEstaAberto(franchiseeId)) return null;
  return NextResponse.json(
    {
      error: `${MENSAGEM_CAIXA_FECHADO} (Não deu para ${ondeEstava}.)`,
      codigo: ERRO_CAIXA_FECHADO,
    },
    { status: 409 },
  );
}

// ─── PEDIDO DO SITE E DO ROBÔ COM O CAIXA FECHADO ───────────────────────────
//
// A escolha é da loja (lib/balcao-config.ts, `caixaParaPedidosOnline`) e a
// decisão pura está em lib/caixa-aberto.ts. Chamado pela rota do site
// (api/customer-order) e pelo robô (lib/chatbot-ai.ts) ANTES de gravar o
// pedido — só pedido novo para agora: o agendado é para quando a loja estiver
// operando, e alteração de pedido já enviado não é venda nova.

export type CaixaDoPedidoOnline = { ok: true } | { ok: false; mensagem: string };

/** Um aviso de "vendendo com o caixa fechado" por loja a cada 12 h (≈ um turno). */
const INTERVALO_DO_AVISO_MS = 12 * 60 * 60 * 1000;

const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

/**
 * Pode gravar este pedido do site/robô? Falha de banco deixa passar — mesma
 * filosofia de `caixaEstaAberto`: travar venda porque a consulta caiu é pior
 * do que o furo de caixa que a trava evita.
 */
export async function caixaParaPedidoOnline(lojaId: string): Promise<CaixaDoPedidoOnline> {
  try {
    const aberto = await prisma.cashSession.findFirst({ where: { franchiseeId: lojaId, status: "OPEN" }, select: { id: true } });
    if (aberto) return { ok: true };

    // A escolha é sempre a do DONO (ownerId || id), como na tela que grava
    // (api/store-settings/balcao).
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { ownerId: true, storeName: true } });
    const donoId = loja?.ownerId || lojaId;
    const dono = await prisma.user.findUnique({ where: { id: donoId }, select: { balcaoConfig: true } as any });
    const modo = lerBalcaoConfig((dono as any)?.balcaoConfig).caixaParaPedidosOnline;
    const nome = loja?.storeName || "sua loja";

    const decisao = decidirCaixaDoPedidoOnline(modo, false);
    if (decisao === "recusar") return { ok: false, mensagem: MENSAGEM_CAIXA_FECHADO_ONLINE };

    if (decisao === "abrir") {
      const troco = await abrirCaixaSozinho(lojaId);
      // null = outro pedido simultâneo abriu (ou o banco falhou): o aviso é dele.
      if (troco != null) {
        void avisarDono(
          lojaId,
          "vendendo_com_caixa_fechado",
          `🟢 *Caixa aberto sozinho*

Sua loja *${nome}* começou a vender com o caixa fechado — o caixa foi aberto sozinho com ${reais(troco)} do último fechamento.

_Ass: Seu Assistente FireHub 🔥_`,
        );
      }
      return { ok: true };
    }

    // "Como hoje": entra, e o dono fica sabendo — uma vez por turno. A vez
    // (lib/vez.ts) com dono novo a cada chamada é o intervalo entre avisos;
    // banco fora = sem aviso, para não virar um por pedido.
    if (await pegarVez(`aviso-vendendo-caixa-fechado:${lojaId}`, INTERVALO_DO_AVISO_MS, { dono: randomUUID(), seFalhar: false })) {
      void avisarDono(
        lojaId,
        "vendendo_com_caixa_fechado",
        `⚠️ *Vendendo com o caixa fechado*

Sua loja *${nome}* começou a vender com o caixa fechado (pedido do site ou do robô). Abra o caixa para essas vendas entrarem no fechamento do dia.

_Ass: Seu Assistente FireHub 🔥_`,
      );
    }
    return { ok: true };
  } catch (err) {
    console.error("[Caixa] pedido online: não consegui conferir o caixa:", (err as any)?.code || err);
    return { ok: true };
  }
}

/**
 * Abre o caixa sem ninguém: troco = o contado no último fechamento (0 se
 * nunca fechou), o mesmo que a tela de abrir sugere. Devolve o troco, ou null
 * se não abriu.
 *
 * Dois pedidos chegando juntos não podem abrir dois caixas: só quem pega a
 * vez (lib/vez.ts, compare-and-set no banco) abre, e ainda confere de novo
 * se já não há caixa aberto. Quem perde segue com o pedido sem abrir nada.
 */
async function abrirCaixaSozinho(lojaId: string): Promise<number | null> {
  if (!(await pegarVez(`abrir-caixa-sozinho:${lojaId}`, 60_000, { dono: randomUUID(), seFalhar: false }))) return null;
  const jaAberto = await prisma.cashSession.findFirst({ where: { franchiseeId: lojaId, status: "OPEN" }, select: { id: true } });
  if (jaAberto) return null;

  const ultimo = await prisma.cashSession.findFirst({
    where: { franchiseeId: lojaId, status: "CLOSED", closedAt: { not: null } },
    orderBy: { closedAt: "desc" },
    select: { closingCash: true },
  });
  const troco = Math.round((Number(ultimo?.closingCash) || 0) * 100) / 100;

  const caixa = await prisma.cashSession.create({ data: { franchiseeId: lojaId, openingAmount: troco, status: "OPEN" } });
  await gravarQuemAbriu(caixa.id, lojaId, { nome: "Aberto sozinho pelo FireHub (pedido do site/robô)", email: null, papel: "SISTEMA" });
  // O mesmo que a abertura pela tela faz (api/cash-session).
  await prisma.user.updateMany({ where: { OR: [{ id: lojaId }, { ownerId: lojaId }] }, data: { cashOpen: true } });
  console.log(`[Caixa] Loja ${lojaId}: caixa aberto sozinho pelo pedido do site/robô, troco ${reais(troco)}.`);
  return troco;
}
