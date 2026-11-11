/**
 * /api/store/table-sessions/[id]/maquininha
 *
 * Cobrar a conta da mesa na maquininha integrada (lib/cobranca-da-mesa-na-maquininha.ts).
 *
 * GET    — maquininhas da loja que podem cobrar agora + cobranças desta mesa.
 *          A tela chama de poucos em poucos segundos enquanto há cobrança viva;
 *          no Point, é também a rede de segurança do webhook.
 * POST   — { valor, terminalId, guestId? } manda a cobrança para a maquininha.
 * DELETE — ?cobranca=<id> cancela a que ainda não foi paga.
 *
 * Mesma porta da rota `pagamentos`: sessão do painel ou garçom pelo link, e o
 * garçom precisa poder fechar conta para mandar cobrança.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lerContextoDaConta } from "@/lib/contexto-da-conta-da-mesa";
import { sanearTaxa } from "@/lib/conta-da-mesa";
import { contextoPagoDaMesa } from "@/lib/saldo-da-mesa";
import { exigirSenhaDoGerente } from "@/lib/senha-do-gerente";
import { resolverOperadorDaMesa, rotuloDoOperador } from "@/lib/garcom-auth";
import { recusaSeCaixaFechado } from "@/lib/caixa-aberto-servidor";
import { PROVEDORES_COM_APP, NOME_DO_PROVEDOR } from "@/lib/terminal-app";
import {
  criarCobrancaDaMesa,
  cobrancasDaMesa,
  cancelarCobrancaDaMesa,
  conferirCobrancaNoPoint,
} from "@/lib/cobranca-da-mesa-na-maquininha";

export const dynamic = "force-dynamic";

const MINUTOS_PARA_OFFLINE = 2;

async function abrirContexto(req: NextRequest, id: string) {
  const operador = await resolverOperadorDaMesa();
  if (!operador) return { erro: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
  if (req.method !== "GET" && operador.tipo === "garcom" && !operador.garcom.podeFecharConta) {
    return {
      erro: NextResponse.json(
        { error: "Este garçom não fecha conta. Peça ao caixa para cobrar pelo painel." },
        { status: 403 },
      ),
    };
  }
  const mesa = await prisma.tableSession.findUnique({
    where: { id },
    select: { id: true, table: { select: { franchiseeId: true } } },
  });
  if (!mesa || mesa.table?.franchiseeId !== operador.franchiseeId) {
    return { erro: NextResponse.json({ error: "Mesa não encontrada" }, { status: 404 }) };
  }
  return { operador, lojaId: operador.franchiseeId };
}

function resumo(c: Awaited<ReturnType<typeof cobrancasDaMesa>>[number]) {
  return {
    id: c.id,
    valor: c.valorCentavos / 100,
    status: c.status,
    provedor: NOME_DO_PROVEDOR[c.provedor || ""] ?? c.provedor,
    terminalId: c.terminalId,
    pessoa: c.guestName,
    por: c.criadoPor,
    motivo: c.dados?.motivo ?? null,
    bandeira: c.dados?.bandeira ?? null,
    criadaEm: c.criadaEm,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await abrirContexto(req, id);
  if (ctx.erro) return ctx.erro;

  const terminais = await prisma.posTerminal.findMany({
    where: {
      franchiseeId: ctx.lojaId,
      active: true,
      provider: { in: [...PROVEDORES_COM_APP, "MERCADOPAGO_POINT", "STONE_CONNECT"] },
    },
    select: { id: true, label: true, provider: true, lastSeenAt: true, operatingMode: true },
    orderBy: { label: "asc" },
  });
  const agora = Date.now();

  let cobrancas = await cobrancasDaMesa(id);
  // Point e Stone pela nuvem: a tela que acompanha é a rede de segurança do
  // webhook (na Stone a consulta é espaçada em 10s e derruba a abandonada).
  const pendenteNoPoint = cobrancas.find(
    (c) => (c.provedor === "MERCADOPAGO_POINT" || c.provedor === "STONE_CONNECT") && c.status === "NO_TERMINAL",
  );
  if (pendenteNoPoint) {
    await conferirCobrancaNoPoint(pendenteNoPoint).catch((e) =>
      console.error("[Mesa maquininha] conferência no Point falhou:", e?.message),
    );
    cobrancas = await cobrancasDaMesa(id);
  }

  return NextResponse.json({
    maquininhas: terminais.map((t) => ({
      id: t.id,
      label: t.label,
      adquirente: NOME_DO_PROVEDOR[t.provider] ?? t.provider,
      // No Point quem acende o visor é a nuvem do MP: não há "sinal" do app para
      // medir, então ela conta como disponível se estiver em modo PDV.
      // Stone pela nuvem também não manda sinal: o pedido vai pela Pagar.me.
      online:
        t.provider === "STONE_CONNECT"
          ? true
          : t.provider === "MERCADOPAGO_POINT"
          ? t.operatingMode !== "STANDALONE"
          : Boolean(t.lastSeenAt && agora - t.lastSeenAt.getTime() < MINUTOS_PARA_OFFLINE * 60_000),
    })),
    cobrancas: cobrancas.map(resumo),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await abrirContexto(req, id);
  if (ctx.erro) return ctx.erro;

  const semCaixa = await recusaSeCaixaFechado(ctx.lojaId!, "registrar o pagamento");
  if (semCaixa) return semCaixa;

  const corpo = await req.json().catch(() => ({}));
  const conta = lerContextoDaConta(corpo?.conta);
  if (corpo?.conta != null && !conta) return NextResponse.json({ error: "CONTA_INVALIDA" }, { status: 400 });
  if (conta && ctx.operador?.tipo === "garcom") {
    if (!ctx.operador.garcom.podeDarDesconto && (conta.desconto?.valor ?? 0) > 0) {
      return NextResponse.json({ error: "Este garçom não dá desconto." }, { status: 403 });
    }
    if (!ctx.operador.garcom.podeTirarTaxa) {
      const loja = await prisma.user.findUnique({ where: { id: ctx.lojaId! }, select: { taxaServicoPadrao: true } });
      if (conta.taxa < sanearTaxa(loja?.taxaServicoPadrao, 10)) return NextResponse.json({ error: "Este garçom não tira a taxa de serviço." }, { status: 403 });
    }
  }
  // ── DESCONTO NA COBRANÇA ("Dar desconto" da senha do gerente) ─────────
  // A conta com desconto vai junto da cobrança e, se a maquininha quita a
  // mesa, ela fecha sozinha (lib/fechamento-pos-da-mesa.ts) sem passar pelo
  // close — então a senha é pedida aqui. Uma vez por desconto: a 2ª cobrança
  // com o MESMO desconto já fixado por uma passada anterior não pede de novo.
  if (conta?.desconto && conta.desconto.valor > 0) {
    const mesa = await prisma.tableSession.findFirst({ where: { id, table: { franchiseeId: ctx.lojaId! } }, select: { paymentMethods: true } });
    const fixado = contextoPagoDaMesa(mesa?.paymentMethods)?.desconto;
    const mesmo = !!fixado && fixado.tipo === conta.desconto.tipo && Math.abs(fixado.valor - conta.desconto.valor) < 0.005;
    if (!mesmo) {
      const semSenha = await exigirSenhaDoGerente(req, ctx.lojaId!, "darDesconto");
      if (semSenha) return semSenha;
    }
  }
  const valor = Number(corpo?.valor) || 0;
  const r = await criarCobrancaDaMesa({
    lojaId: ctx.lojaId!,
    tableSessionId: id,
    valorCentavos: Math.round(valor * 100),
    terminalId: String(corpo?.terminalId || ""),
    guestId: typeof corpo?.guestId === "string" && corpo.guestId ? corpo.guestId : null,
    por: rotuloDoOperador(ctx.operador!),
    ...(conta ? { conta } : {}),
  });
  if (!r.ok) return NextResponse.json({ error: r.codigo, mensagem: r.mensagem }, { status: r.status });
  return NextResponse.json({ success: true, cobranca: resumo(r.cobranca) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await abrirContexto(req, id);
  if (ctx.erro) return ctx.erro;

  const cobrancaId = req.nextUrl.searchParams.get("cobranca");
  if (!cobrancaId) return NextResponse.json({ error: "cobranca_obrigatoria" }, { status: 400 });
  const r = await cancelarCobrancaDaMesa(ctx.lojaId!, cobrancaId);
  if (!r.ok) return NextResponse.json({ error: r.codigo, mensagem: r.mensagem }, { status: r.status });
  return NextResponse.json({ success: true });
}
