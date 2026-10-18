/**
 * /api/store/meu-aplicativo — a tela "Meu aplicativo" (app/store/meu-aplicativo).
 *
 * GET              números da base e do mês, plano, histórico de notificações,
 *                  quantas ainda cabem hoje e os produtos para o link do aviso.
 * POST             { titulo, mensagem, publico, comLink, produtoId?, agendarPara? }
 *                  manda agora ou agenda (lib/app-da-loja/notificacoes.ts).
 * DELETE ?id=      cancela um agendado.
 *
 * Só o dono (ou o ADMIN na loja que abriu) — a mesma regra do Bill
 * (lib/assessor/loja-da-sessao.ts) — e só com o plano do app ligado.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { ROTULO_DO_PLANO } from "@/lib/app-da-loja/plano";
import { appDaConta } from "@/lib/app-da-loja/instalacoes";
import { numerosDoApp } from "@/lib/app-da-loja/numeros";
import { cancelarAgendado, criarEnvio, historicoDeEnvios, marcosDaConta, restantesNoDia } from "@/lib/app-da-loja/notificacoes";
import {
  ATIVO_AGORA_MS,
  LIMITE_DE_ENVIOS_POR_DIA,
  MENSAGEM_MAX,
  ROTULO_DO_PUBLICO,
  TITULO_MAX,
} from "@/lib/app-da-loja/regras-do-push";

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

export async function GET() {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  const { s, app } = c;
  const hoje = marcosDaConta(app.tz).hoje;
  const [loja, numeros, envios, restantesHoje, produtos] = await Promise.all([
    prisma.user.findUnique({ where: { id: s.franchiseeId }, select: { storeName: true, name: true, slug: true, storeLogo: true } }),
    numerosDoApp(app),
    historicoDeEnvios(app.chave),
    restantesNoDia(app.chave, hoje),
    prisma.menuProduct.findMany({
      where: { franchiseeId: s.franchiseeId, active: true },
      select: { id: true, name: true, price: true, imageUrl: true },
      orderBy: { name: "asc" },
      take: 400,
    }),
  ]);
  return NextResponse.json({
    loja: { nome: loja?.storeName || loja?.name || app.nome, slug: loja?.slug || null, logo: loja?.storeLogo || null },
    plano: {
      plataformas: app.plano.plataformas,
      rotulo: app.plano.plataformas ? ROTULO_DO_PLANO[app.plano.plataformas] : null,
      valor: app.plano.valor,
      ativoDesde: app.plano.ativoDesde,
    },
    grupo: app.lojaIds.length > 1,
    numeros,
    envios,
    regras: {
      limitePorDia: LIMITE_DE_ENVIOS_POR_DIA,
      restantesHoje,
      tituloMax: TITULO_MAX,
      mensagemMax: MENSAGEM_MAX,
      ativoAgoraMin: Math.round(ATIVO_AGORA_MS / 60000),
      publicos: ROTULO_DO_PUBLICO,
    },
    produtos: produtos.map((p) => ({ id: p.id, nome: p.name, preco: p.price, foto: p.imageUrl })),
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
    publico: body.publico,
    comLink: body.comLink,
    produtoId: body.produtoId,
    agendarPara: body.agendarPara || undefined,
  });
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status || 400 });
  return NextResponse.json({ ok: true, envio: r.envio });
}

export async function DELETE(req: NextRequest) {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!(await cancelarAgendado(c.app.chave, id))) {
    return NextResponse.json({ error: "Esse envio já saiu ou não existe mais." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
