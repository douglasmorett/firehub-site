/**
 * /api/store/pos/stone-connect — conexão da loja com a Stone pela nuvem
 * (Connect 2.0: a POS Stone recebe a cobrança sem o app do FireHub).
 *
 * GET    — situação (conectada, final da chave, fluxo), URL do webhook e as
 *          maquininhas Stone cadastradas por número de série.
 * POST   — { chave?, fluxo, tipoDireto } cola a secret key (sk_...) — testada
 *          na Stone antes de gravar, e gravada CIFRADA — ou só troca o fluxo.
 * DELETE — desconecta (apaga a chave).
 *
 * Só o responsável pela loja mexe (STAFF não): a chave movimenta a conta da loja.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ehTipoDireto, serviceRefererName, testarChaveStone } from "@/lib/stone-connect";
import {
  chaveTemFormato,
  desconectarStone,
  gravarChaveStone,
  gravarFluxoStone,
  lojaStone,
  type FluxoStone,
} from "@/lib/stone-connect-loja";

export const dynamic = "force-dynamic";

async function contexto() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, email: true },
  });
  if (!user) return null;
  return { lojaId: user.ownerId || user.id, role: user.role, email: user.email };
}

function urlDoWebhook(req: NextRequest): string {
  const base = (process.env.NEXTAUTH_URL || req.nextUrl.origin).replace(/\/$/, "");
  return `${base}/api/webhooks/stone-connect`;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await contexto();
    if (!ctx) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const loja = await lojaStone(ctx.lojaId);
    const maquininhas = await prisma.posTerminal.findMany({
      where: { franchiseeId: ctx.lojaId, provider: "STONE_CONNECT" },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      select: { id: true, label: true, externalId: true, active: true, totemLicenses: { select: { id: true, label: true } } },
    });

    return NextResponse.json({
      success: true,
      conectada: !!loja,
      finalDaChave: loja?.finalDaChave ?? null,
      fluxo: loja?.fluxo ?? "LISTADO",
      tipoDireto: loja?.tipoDireto ?? "credit",
      conectadaEm: loja?.conectadaEm ?? null,
      // Sem o id de parceiro no servidor nenhum pedido chega à POS: a tela avisa.
      servidorPronto: Boolean(serviceRefererName()),
      webhookUrl: urlDoWebhook(req),
      podeEditar: ctx.role !== "STAFF",
      maquininhas: maquininhas.map((m) => ({
        id: m.id,
        label: m.label,
        serial: m.externalId,
        active: m.active,
        totens: m.totemLicenses,
      })),
    });
  } catch (err) {
    console.error("[Stone Connect GET]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await contexto();
    if (!ctx) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    if (ctx.role === "STAFF") {
      return NextResponse.json({ error: "Só o responsável pela loja pode conectar a Stone." }, { status: 403 });
    }

    const corpo = await req.json().catch(() => ({}));
    const fluxo: FluxoStone = corpo?.fluxo === "DIRETO" ? "DIRETO" : "LISTADO";
    const tipoDireto = ehTipoDireto(corpo?.tipoDireto) ? corpo.tipoDireto : "credit";
    const chave = typeof corpo?.chave === "string" ? corpo.chave.trim() : "";

    if (!chave) {
      const ok = await gravarFluxoStone(ctx.lojaId, fluxo, tipoDireto);
      if (!ok) return NextResponse.json({ error: "Cole a chave da Stone primeiro." }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    if (!chaveTemFormato(chave)) {
      return NextResponse.json(
        {
          error:
            "Essa não parece a secret key da Stone/Pagar.me. Ela começa com sk_ (Dashboard Pagar.me > Desenvolvimento > Chaves).",
        },
        { status: 400 },
      );
    }
    if (!serviceRefererName()) {
      return NextResponse.json(
        { error: "O servidor do FireHub ainda não está habilitado para a Stone pela nuvem. Fale com o suporte." },
        { status: 503 },
      );
    }

    // Testa antes de gravar: chave errada só apareceria na primeira venda.
    const teste = await testarChaveStone(chave);
    if (!teste.ok && (teste.status === 401 || teste.status === 403)) {
      return NextResponse.json({ error: "A Stone recusou esta chave. Confira se copiou a secret key inteira." }, { status: 400 });
    }

    await gravarChaveStone({ franchiseeId: ctx.lojaId, chave, fluxo, tipoDireto, por: ctx.email || ctx.lojaId });
    return NextResponse.json({
      success: true,
      // Falha que não é de chave (rede, 5xx) não impede gravar, mas a tela avisa.
      aviso: teste.ok ? null : `Chave gravada, mas não deu para testar agora (${teste.erro}).`,
    });
  } catch (err) {
    console.error("[Stone Connect POST]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const ctx = await contexto();
    if (!ctx) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    if (ctx.role === "STAFF") {
      return NextResponse.json({ error: "Só o responsável pela loja pode desconectar a Stone." }, { status: 403 });
    }
    await desconectarStone(ctx.lojaId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Stone Connect DELETE]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
