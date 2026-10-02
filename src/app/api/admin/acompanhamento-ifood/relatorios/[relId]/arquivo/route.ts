import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { adminDaSessao, estruturaPronta } from "@/lib/acompanhamento-ifood/servidor";

type Ctx = { params: Promise<{ relId: string }> };

/**
 * GET: abre o arquivo do relatório (?baixar=1 para baixar). O HTML do modelo
 * roda em sandbox SEM a origem do site — o CSP com o sandbox mora no
 * next.config.ts, porque lá o header global sobrescreveria o daqui.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  if (!(await adminDaSessao())) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await estruturaPronta())) return NextResponse.json({ error: "As tabelas do acompanhamento não estão no banco." }, { status: 503 });
  const { relId } = await params;

  const r = await prisma.acompanhamentoRelatorio.findUnique({
    where: { id: relId },
    select: { arquivo: true, arquivoNome: true, arquivoTipo: true },
  });
  if (!r?.arquivo) return NextResponse.json({ error: "Este relatório não tem arquivo." }, { status: 404 });

  const baixar = req.nextUrl.searchParams.get("baixar") === "1";
  const nome = (r.arquivoNome || "relatorio").replace(/["\\\r\n]/g, "");
  return new NextResponse(new Uint8Array(r.arquivo), {
    headers: {
      "Content-Type": r.arquivoTipo || "application/octet-stream",
      "Content-Disposition": `${baixar ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
