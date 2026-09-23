/**
 * POST /api/cash-session/imprimir  { sessionId, tipo?: "ABERTURA" | "FECHAMENTO" }
 *
 * Manda para a impressora, de novo, o papel de um caixa que já passou.
 *
 * O papel sai sozinho na abertura e no fechamento, mas papel some: acaba a
 * bobina, a impressora está desligada, alguém joga fora. Sem uma segunda via,
 * a única saída era a loja anotar à mão o que a tela mostra — e é justamente
 * a conferência do dinheiro que não pode depender de transcrição.
 *
 * O cupom é REMONTADO a partir da sessão gravada, não guardado pronto: assim a
 * segunda via nunca diverge do que está no banco, e sessões antigas — de antes
 * de a impressão existir — também podem ser impressas.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FUSO_PADRAO } from "@/lib/fuso";
import { cupomDeAberturaDeCaixa, cupomDeFechamentoDeCaixa } from "@/lib/cupom-do-caixa";
import { enfileirarCupomDoCaixa, assistenteOuvindoAFila } from "@/lib/imprimir-caixa";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, storeName: true, storeTimezone: true },
  });
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  const lojaId = user.ownerId || user.id;

  const body = await req.json().catch(() => ({} as any));
  const sessionId = String(body?.sessionId || "").trim();
  const tipo = String(body?.tipo || "FECHAMENTO").toUpperCase() === "ABERTURA" ? "ABERTURA" : "FECHAMENTO";
  if (!sessionId) return NextResponse.json({ error: "Informe o caixa a imprimir." }, { status: 400 });

  // A sessão TEM que ser desta loja: o id vem do navegador.
  const caixa = await prisma.cashSession.findFirst({
    where: { id: sessionId, franchiseeId: lojaId },
  });
  if (!caixa) return NextResponse.json({ error: "Caixa não encontrado." }, { status: 404 });

  const dono = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { storeName: true, storeTimezone: true },
  });
  const comum = {
    sessionId: caixa.id,
    loja: dono?.storeName || "",
    fuso: dono?.storeTimezone || FUSO_PADRAO,
    operador: session.user?.name || session.user?.email || "",
    abertoEm: caixa.openedAt,
    trocoInicial: Number(caixa.openingAmount || 0),
  };

  const cupom =
    tipo === "ABERTURA"
      ? cupomDeAberturaDeCaixa({ ...comum, fechamentoAnterior: null })
      : cupomDeFechamentoDeCaixa({
          ...comum,
          fechadoEm: caixa.closedAt || new Date(),
          valores: {
            esperado: {
              cash: Number(caixa.expectedCash || 0),
              debit: Number(caixa.expectedDebit || 0),
              credit: Number(caixa.expectedCredit || 0),
              pix: Number(caixa.expectedPix || 0),
              voucher: Number(caixa.expectedVoucher || 0),
              total: Number(caixa.expectedTotal || 0),
            },
            contado: {
              cash: Number(caixa.closingCash || 0),
              debit: Number(caixa.closingDebit || 0),
              credit: Number(caixa.closingCredit || 0),
              pix: Number(caixa.closingPix || 0),
              voucher: Number(caixa.closingVoucher || 0),
            },
            diferenca: Number(caixa.difference || 0),
            justificativa: caixa.justification || null,
          },
        });

  // A 2ª via diz que é 2ª via. Duas vias iguais na mesa do lojista, sem saber
  // qual é qual, é como conferência vira discussão.
  const marcado = {
    ...cupom,
    dailyOrderNumber: `2a VIA - ${cupom.dailyOrderNumber}`,
    id: `${cupom.id}_reimpressao_${Date.now()}`,
  };

  const ok = await enfileirarCupomDoCaixa(lojaId, marcado, session.user?.name || session.user?.email || "");
  if (!ok) return NextResponse.json({ error: "Não consegui enviar para a impressora." }, { status: 500 });

  return NextResponse.json({ ok: true, tipo, assistenteOuvindo: await assistenteOuvindoAFila(lojaId) });
}
