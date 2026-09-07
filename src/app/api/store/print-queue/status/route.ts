/**
 * GET /api/store/print-queue/status
 *
 * Quando foi a última vez que o Assistente de Impressão desta loja consultou
 * a fila da nuvem — e o que ele contou de si nessa consulta. É o que o painel
 * usa para avisar "a impressão parou" e "3 comandas não saíram na ELGIN i8";
 * antes disso a loja só descobria pela comanda que não saiu, e o suporte só
 * conseguia saber indo ao PC do caixa.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const eu = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true },
  });
  if (!eu) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const lojaId = eu.ownerId || eu.id;

  // Tolerante à coluna nova ausente (falta db push): o aviso de "parou" não
  // pode sumir do painel porque o estado ainda não tem onde morar.
  type Loja = { printerConfig: unknown; printQueuePolledAt: Date | null; printQueueEstado?: unknown };
  let loja: Loja | null = null;
  try {
    loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { printerConfig: true, printQueuePolledAt: true, printQueueEstado: true },
    });
  } catch {
    loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { printerConfig: true, printQueuePolledAt: true },
    });
  }

  const pc: any = loja?.printerConfig || null;
  const impressoras: any[] = Array.isArray(pc?.printers) ? pc.printers.filter((p: any) => p?.name) : [];
  const ultimo = loja?.printQueuePolledAt ?? null;

  // A fila da nuvem só importa para quem lança pedido no servidor (mesa e
  // balcão); loja só de delivery imprime pelo navegador e nunca consultou a
  // fila — e não é problema nenhum. Sem esta distinção o aviso "nunca
  // consultou" ficaria aceso para sempre nessas lojas.
  const seteDias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [mesas, presenciais] = await Promise.all([
    prisma.table.count({ where: { franchiseeId: lojaId } }),
    prisma.customerOrder.count({ where: { franchiseeId: lojaId, source: "PRESENCIAL", createdAt: { gte: seteDias } } }),
  ]);

  // ── O que o Assistente contou (1.2.7+) ────────────────────────────────
  //
  // `impressoras` é a lista que o Windows daquele PC enxerga. Impressora
  // cadastrada aqui que não está lá é comanda que nunca vai sair: o Windows
  // renomeou ("ELGIN i8 (Copy 1)"), a loja trocou de PC, ou cadastrou pelo
  // nome errado. Só se compara quando o Assistente mandou a lista — vazia,
  // não se conclui nada.
  const estado: any = (loja as any)?.printQueueEstado || null;
  const locais = new Set<string>(
    (Array.isArray(estado?.impressoras) ? estado.impressoras : []).map((n: unknown) => String(n).toLowerCase().trim())
  );
  const cadastradas = impressoras.map((p: any) => String(p.name));
  const impressorasAusentes = locais.size > 0
    ? cadastradas.filter((n) => !locais.has(n.toLowerCase().trim()))
    : [];

  return NextResponse.json({
    temImpressora: impressoras.length > 0,
    usaSalao: mesas > 0 || presenciais > 0,
    ultimoPoll: ultimo ? ultimo.toISOString() : null,
    paradoHaSegundos: ultimo ? Math.max(0, Math.round((Date.now() - ultimo.getTime()) / 1000)) : null,
    versaoAssistente: estado?.versao ? String(estado.versao) : null,
    pendentes: Math.max(0, Number(estado?.pendentes) || 0),
    erroImpressao: estado?.erro ? String(estado.erro) : null,
    impressorasAusentes,
    impressorasNoPc: Array.isArray(estado?.impressoras) ? estado.impressoras.map((n: unknown) => String(n)) : [],
    estadoEm: estado?.em ? String(estado.em) : null,
  });
}
