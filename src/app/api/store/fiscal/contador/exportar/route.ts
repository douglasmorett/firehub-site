import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { montarPacoteDoContador, zipDoPacote } from "@/lib/contador-pacote";
import { limiteDeDia } from "@/lib/timezone";

export const dynamic = "force-dynamic";
// Baixar os XMLs um a um do provedor leva tempo num mês cheio.
export const maxDuration = 120;

/**
 * GET /api/store/fiscal/contador/exportar?de=YYYY-MM-DD&ate=YYYY-MM-DD
 *
 * Baixa o pacote do contador do período: os XMLs das notas, a relação em CSV e
 * a lista das vendas que ficaram SEM nota.
 *
 * `?formato=json` devolve só o resumo — a tela usa isso para mostrar quantas
 * notas o período tem antes de o lojista gastar a espera do download.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const u = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, storeName: true, name: true, storeTimezone: true },
  });
  if (!u) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const lojaId = u.ownerId || u.id;

  const url = new URL(req.url);
  const de = String(url.searchParams.get("de") || "").trim();
  const ate = String(url.searchParams.get("ate") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) {
    return NextResponse.json({ error: "Informe o período (de/ate) no formato AAAA-MM-DD." }, { status: 400 });
  }
  if (de > ate) {
    return NextResponse.json({ error: "A data inicial está depois da final." }, { status: 400 });
  }

  // Dia ancorado no fuso da loja — o mesmo cuidado dos outros filtros. Sem
  // isso, o pacote de agosto começaria às 21:00 de 31 de julho e o contador
  // receberia uma nota que pertence ao mês anterior.
  const fuso = u.storeTimezone || "America/Sao_Paulo";
  const inicio = limiteDeDia(de, fuso, "inicio")!;
  const fim = limiteDeDia(ate, fuso, "fim")!;

  const pacote = await montarPacoteDoContador(lojaId, { de, ate }, { inicio, fim });

  if (url.searchParams.get("formato") === "json") {
    return NextResponse.json({ resumo: pacote.resumo });
  }

  const zip = zipDoPacote(pacote);
  const nomeDaLoja = String(u.storeName || u.name || "loja")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "loja";

  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="fiscal-${nomeDaLoja}-${de}_a_${ate}.zip"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  });
}
