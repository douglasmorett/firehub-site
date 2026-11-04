import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDoAssessorDaSessao } from "@/lib/assessor/loja-da-sessao";
import { lerVitrine, salvarVitrine } from "@/lib/tablet-da-mesa/vitrine-no-banco";

/**
 * A tela do tablet que a loja monta (lib/tablet-da-mesa/vitrine.ts).
 *
 * GET — a vitrine salva e os produtos do salão (para escolher banner e recomendados).
 * PUT { banners, recomendados } — grava; os tablets pegam no próximo sinal (20 s).
 */
export const dynamic = "force-dynamic";

const SO_O_DONO = { error: "Só o dono da loja mexe no Tablet na mesa." };

export async function GET() {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json(SO_O_DONO, { status: 403 });
  const [vitrine, produtos] = await Promise.all([
    lerVitrine(s.franchiseeId),
    prisma.menuProduct.findMany({
      where: { franchiseeId: s.franchiseeId, active: true, activeGarcom: true, NOT: { apenasEmCombo: true } },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, imageUrl: true, category: true, price: true },
    }),
  ]);
  return NextResponse.json({ vitrine, produtos });
}

export async function PUT(req: Request) {
  const s = await lojaDoAssessorDaSessao();
  if (!s) return NextResponse.json(SO_O_DONO, { status: 403 });
  const corpo = await req.json().catch(() => null);
  try {
    return NextResponse.json({ vitrine: await salvarVitrine(s.franchiseeId, corpo) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Não deu para salvar." }, { status: 503 });
  }
}
