/**
 * /api/store/meu-aplicativo — a tela "Meu aplicativo" (app/store/meu-aplicativo).
 *
 * GET ?periodo=7d|30d|90d|mes|mesAnterior
 *        base, resultado por canal (contra o período anterior), antes × depois,
 *        horários, notificações (histórico com resultado, segmentos,
 *        sugestões, o que funciona) — lib/app-da-loja/painel.ts.
 * POST   { titulo, mensagem, segmento: {tipo, valor?}, comLink, produtoId?, agendarPara? }
 *        manda agora ou agenda (lib/app-da-loja/notificacoes.ts).
 * DELETE ?id=   cancela um agendado.
 *
 * Só o dono (ou o ADMIN na loja que abriu) — a mesma regra do Bill
 * (lib/assessor/loja-da-sessao.ts) — e só com o plano do app ligado.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { ROTULO_DO_PLANO } from "@/lib/app-da-loja/plano";
import { appDaConta } from "@/lib/app-da-loja/instalacoes";
import { PERIODOS, esquecerPainel, painelDoApp, type Periodo } from "@/lib/app-da-loja/painel";
import { cancelarAgendado, criarEnvio } from "@/lib/app-da-loja/notificacoes";
import { AVISAR_A_PARTIR_DE, ATIVO_AGORA_MS, MENSAGEM_MAX, TITULO_MAX } from "@/lib/app-da-loja/regras-do-push";
import { SEGMENTOS } from "@/lib/app-da-loja/segmentos";
import { OBJETIVOS } from "@/lib/app-da-loja/mensagem";
import { TAXA_DE_MARKETPLACE_PADRAO } from "@/lib/app-da-loja/analise";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function contexto() {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return { erro: NextResponse.json({ error: "Só o dono da loja abre o Meu aplicativo." }, { status: 403 }) };
  const app = await appDaConta(s.franchiseeId);
  if (!app?.ativo) {
    return { erro: NextResponse.json({ error: "O aplicativo desta loja ainda não está ativo.", irPara: "/store/aplicativo" }, { status: 403 }) };
  }
  return { s, app };
}

export async function GET(req: NextRequest) {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  const { s, app } = c;
  const pedido = req.nextUrl.searchParams.get("periodo") as Periodo;
  const periodo: Periodo = PERIODOS.includes(pedido) ? pedido : "30d";
  const [loja, painel, produtos, unidades] = await Promise.all([
    prisma.user.findUnique({ where: { id: s.franchiseeId }, select: { storeName: true, name: true, slug: true, storeLogo: true } }),
    painelDoApp(app, periodo),
    prisma.menuProduct.findMany({
      where: { franchiseeId: s.franchiseeId, active: true },
      select: { id: true, name: true, price: true, imageUrl: true, category: true },
      orderBy: { name: "asc" },
      take: 400,
    }),
    app.lojaIds.length > 1 ? prisma.user.findMany({ where: { id: { in: app.lojaIds } }, select: { storeName: true, name: true } }) : Promise.resolve([]),
  ]);
  return NextResponse.json({
    loja: { nome: loja?.storeName || loja?.name || app.nome, slug: loja?.slug || null, logo: loja?.storeLogo || null },
    plano: {
      plataformas: app.plano.plataformas,
      rotulo: app.plano.plataformas ? ROTULO_DO_PLANO[app.plano.plataformas] : null,
      valor: app.plano.valor,
      ativoDesde: app.plano.ativoDesde,
    },
    unidades: unidades.map((u) => (u.storeName || u.name || "Loja").trim()),
    painel,
    regras: {
      avisarAPartirDe: AVISAR_A_PARTIR_DE,
      tituloMax: TITULO_MAX,
      mensagemMax: MENSAGEM_MAX,
      ativoAgoraMin: Math.round(ATIVO_AGORA_MS / 60000),
      segmentos: SEGMENTOS,
      objetivos: OBJETIVOS,
      taxaMarketplacePadrao: TAXA_DE_MARKETPLACE_PADRAO,
    },
    produtos: produtos.map((p) => ({ id: p.id, nome: p.name, preco: p.price, foto: p.imageUrl, categoria: p.category })),
  });
}

export async function POST(req: NextRequest) {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  const body = await req.json().catch(() => ({} as any));
  const r = await criarEnvio({
    franchiseeId: c.s.franchiseeId,
    quem: c.s.nome,
    titulo: body.titulo,
    mensagem: body.mensagem,
    segmento: body.segmento,
    comLink: body.comLink,
    produtoId: body.produtoId,
    agendarPara: body.agendarPara || undefined,
  });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status || 400 });
  esquecerPainel(c.app.chave);
  return NextResponse.json({ ok: true, envio: r.envio });
}

export async function DELETE(req: NextRequest) {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!(await cancelarAgendado(c.app.chave, id))) {
    return NextResponse.json({ error: "Esse envio já saiu ou não existe mais." }, { status: 404 });
  }
  esquecerPainel(c.app.chave);
  return NextResponse.json({ ok: true });
}
