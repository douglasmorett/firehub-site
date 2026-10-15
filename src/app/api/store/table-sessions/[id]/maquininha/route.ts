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
      provider: { in: [...PROVEDORES_COM_APP, "MERCADOPAGO_POINT"] },
    },
    select: { id: true, label: true, provider: true, lastSeenAt: true, operatingMode: true },
    orderBy: { label: "asc" },
  });
  const agora = Date.now();

  let cobrancas = await cobrancasDaMesa(id);
  const pendenteNoPoint = cobrancas.find((c) => c.provedor === "MERCADOPAGO_POINT" && c.status === "NO_TERMINAL");
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
      online:
        t.provider === "MERCADOPAGO_POINT"
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
  const valor = Number(corpo?.valor) || 0;
  const r = await criarCobrancaDaMesa({
    lojaId: ctx.lojaId!,
    tableSessionId: id,
    valorCentavos: Math.round(valor * 100),
    terminalId: String(corpo?.terminalId || ""),
    guestId: typeof corpo?.guestId === "string" && corpo.guestId ? corpo.guestId : null,
    por: rotuloDoOperador(ctx.operador!),
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
