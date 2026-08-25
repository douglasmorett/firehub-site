import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { gerarTokenDeTerminal } from "@/lib/terminal-app";

export const dynamic = "force-dynamic";

/**
 * Pareamento de maquininha com app próprio (PagBank).
 *
 * POST — cria (ou regera) o código que o app instalado no terminal usa para se
 *        identificar. É o equivalente à licença do totem, para o aparelho.
 * GET  — lista as maquininhas deste tipo com o estado de cada uma.
 *
 * Diferente do Mercado Pago Point, aqui não há nuvem da adquirente para
 * descobrir os aparelhos: quem se apresenta é o app. Então o cadastro nasce
 * aqui, o lojista digita o código no app uma única vez, e a partir daí o
 * aparelho aparece sozinho no painel.
 */

/** Depois de quanto tempo sem ping consideramos a maquininha fora do ar. */
const MINUTOS_PARA_OFFLINE = 2;

async function resolverLoja(email: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, ownerId: true, role: true },
  });
  if (!user) return null;
  return { lojaId: user.ownerId || user.id, role: user.role };
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const ctx = await resolverLoja(session.user.email);
    if (!ctx) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    const terminais = await prisma.posTerminal.findMany({
      where: { franchiseeId: ctx.lojaId, provider: "PAGBANK_APP" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, label: true, active: true, lastSeenAt: true, appVersion: true,
        createdAt: true, deviceToken: true,
        totemLicenses: { select: { id: true, label: true } },
      },
    });

    const agora = Date.now();

    return NextResponse.json({
      success: true,
      terminais: terminais.map((t) => ({
        id: t.id,
        label: t.label,
        active: t.active,
        appVersion: t.appVersion,
        lastSeenAt: t.lastSeenAt,
        online: t.lastSeenAt ? agora - t.lastSeenAt.getTime() < MINUTOS_PARA_OFFLINE * 60_000 : false,
        // Aparelho que nunca deu sinal ainda não foi pareado: a tela mostra o
        // código para digitar. Depois disso o código some — ele é credencial,
        // e ficar exposto no painel é convite para alguém fotografar.
        pareado: Boolean(t.lastSeenAt),
        codigoDePareamento: t.lastSeenAt ? null : t.deviceToken,
        totens: t.totemLicenses,
      })),
    });
  } catch (err) {
    console.error("[POS Parear GET]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

    const ctx = await resolverLoja(session.user.email);
    if (!ctx) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

    // Parear maquininha é decisão do responsável: o crachá gerado aqui autoriza
    // um aparelho a receber cobranças da loja inteira.
    if (ctx.role === "STAFF") {
      return NextResponse.json(
        { error: "Só o responsável pela loja pode parear uma maquininha." },
        { status: 403 },
      );
    }

    const { label, terminalId, totemLicenseId } = await req.json().catch(() => ({}));

    // Regerar o código de uma maquininha existente: usado quando o aparelho é
    // trocado ou o código vaza. O aparelho antigo para de funcionar na hora.
    if (terminalId) {
      const novo = gerarTokenDeTerminal();
      const alterados = await prisma.posTerminal.updateMany({
        where: { id: terminalId, franchiseeId: ctx.lojaId, provider: "PAGBANK_APP" },
        data: { deviceToken: novo, lastSeenAt: null, appVersion: null },
      });
      if (alterados.count === 0) {
        return NextResponse.json({ error: "Maquininha não encontrada nesta loja." }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        codigoDePareamento: novo,
        aviso: "O aparelho anterior parou de funcionar. Digite este código no app da maquininha.",
      });
    }

    const nome = String(label || "").trim().slice(0, 60) || "Maquininha PagBank";

    // `externalId` é único por loja e no PagBank não existe id vindo da nuvem —
    // o número de série só se conhece quando o app se apresenta. Usamos um id
    // próprio para não colidir com outra maquininha da mesma loja.
    const externalId = `pagbank-${gerarTokenDeTerminal().slice(0, 12)}`;

    const criado = await prisma.posTerminal.create({
      data: {
        franchiseeId: ctx.lojaId,
        provider: "PAGBANK_APP",
        externalId,
        label: nome,
        deviceToken: gerarTokenDeTerminal(),
        active: true,
      },
      select: { id: true, label: true, deviceToken: true },
    });

    if (totemLicenseId) {
      // Vincular ao totem é o que faz a cobrança sair no visor certo quando a
      // loja tem mais de uma maquininha.
      await prisma.totemLicense.updateMany({
        where: { id: totemLicenseId, franchiseeId: ctx.lojaId },
        data: { posTerminalId: criado.id },
      });
    }

    return NextResponse.json({
      success: true,
      terminal: { id: criado.id, label: criado.label },
      codigoDePareamento: criado.deviceToken,
      instrucoes: [
        "Abra o app FireHub na maquininha.",
        "Digite este código na tela de pareamento.",
        "A maquininha aparece como conectada aqui em poucos segundos.",
      ],
    });
  } catch (err) {
    console.error("[POS Parear POST]", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
