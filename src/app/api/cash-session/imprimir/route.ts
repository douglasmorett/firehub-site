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
import { secoesDoFechamento, type SecoesDoFechamento } from "@/lib/secoes-do-fechamento";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FUSO_PADRAO } from "@/lib/fuso";
import { cupomDeAberturaDeCaixa, cupomDeFechamentoDeCaixa } from "@/lib/cupom-do-caixa";
import { enfileirarCupomDoCaixa, assistenteOuvindoAFila } from "@/lib/imprimir-caixa";
import { calcularEsperadoDoTurno } from "@/lib/esperado-do-turno";
import { conferenciaGravada } from "@/lib/conferencia-do-caixa";
import type { CashSession } from "@prisma/client";

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
    select: { storeName: true, storeTimezone: true, printerConfig: true },
  });
  const comum = {
    sessionId: caixa.id,
    loja: dono?.storeName || "",
    fuso: dono?.storeTimezone || FUSO_PADRAO,
    operador: session.user?.name || session.user?.email || "",
    abertoEm: caixa.openedAt,
    trocoInicial: Number(caixa.openingAmount || 0),
    // O que a loja escolheu imprimir no fechamento (lib/secoes-do-fechamento.ts).
    secoes: secoesDoFechamento(dono?.printerConfig),
  };

  const cupom =
    tipo === "ABERTURA"
      ? cupomDeAberturaDeCaixa({ ...comum, fechamentoAnterior: null })
      : await segundaViaDoFechamento(lojaId, caixa, comum, session.user?.name || session.user?.email || "");

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

const centavos = (n: number) => Math.round(n * 100) / 100;

/**
 * O fechamento reimpresso.
 *
 * A CONFERÊNCIA é a gravada: esperado, contado e diferença são o registro do
 * que aconteceu na hora, e reapurar mudaria o resultado de um caixa já
 * encerrado. O RETRATO do turno (faturamento, canais, cupons, fiado,
 * entregadores, cancelados) não é gravado em lugar nenhum e é apurado de novo,
 * na mesma janela: da abertura ao fechamento. Até 23/09/2026 a 2ª via saía só
 * com a conferência — o papel reimpresso não dizia nada do turno.
 */
async function segundaViaDoFechamento(
  lojaId: string,
  caixa: CashSession,
  comum: { sessionId: string; loja: string; fuso: string; operador: string; abertoEm: Date; trocoInicial: number; secoes: SecoesDoFechamento },
  quemPediu: string
) {
  const esperado = {
    cash: Number(caixa.expectedCash || 0),
    debit: Number(caixa.expectedDebit || 0),
    credit: Number(caixa.expectedCredit || 0),
    pix: Number(caixa.expectedPix || 0),
    voucher: Number(caixa.expectedVoucher || 0),
    total: Number(caixa.expectedTotal || 0),
  };
  // A conferência como foi gravada, lida pela mesma função do Histórico
  // (lib/conferencia-do-caixa.ts). Caixa encerrado sozinho ao abrir outro, ou
  // fechado sem ninguém digitar a contagem: `difference` NULO — a 2ª via
  // imprimia "DIFERENCA R$ 0,00 (confere)". Forma deixada em branco: contado
  // nulo, "nao conferido". E o caixa antigo com as cinco formas em zero (ninguém
  // contou; a "falta" gravada não aconteceu) sai como sem conferência também.
  const conf = conferenciaGravada(caixa as unknown as Record<string, unknown>);
  const semConferencia = conf.situacao === "SEM_CONFERENCIA";
  const contadoDe = (chave: "cash" | "debit" | "credit" | "pix" | "voucher") => conf.linhas.find((l) => l.chave === chave)?.contado ?? null;
  const contado = { cash: contadoDe("cash"), debit: contadoDe("debit"), credit: contadoDe("credit"), pix: contadoDe("pix"), voucher: contadoDe("voucher") };

  // O pago online não tem coluna na sessão: é o que o total esperado tem além
  // das cinco formas. Ele é travado — o mesmo valor dos dois lados.
  const onlineEsperado = Math.max(0, centavos(conf.online));

  let doTurno: Awaited<ReturnType<typeof calcularEsperadoDoTurno>> | null = null;
  try {
    doTurno = await calcularEsperadoDoTurno(lojaId, caixa, { ate: caixa.closedAt || new Date(), retrato: true });
  } catch (e: any) {
    // Sem o retrato, a 2ª via ainda sai — com a conferência, como antes.
    console.error("[Caixa] 2ª via sem o retrato do turno:", e?.message);
  }

  return cupomDeFechamentoDeCaixa({
    ...comum,
    operador: caixa.closedBy || comum.operador,
    fechadoEm: caixa.closedAt || new Date(),
    segundaVia: { por: quemPediu, em: new Date() },
    valores: {
      esperado,
      contado,
      diferenca: Number(conf.diferenca ?? 0),
      semConferencia,
      motivoSemConferencia: conf.motivo,
      online: { ifood: onlineEsperado },
      onlineEsperado,
      justificativa: caixa.justification || null,
      ...(doTurno
        ? {
            movimentacoes: { entradas: doTurno.movimentacaoEntradas, saidas: doTurno.movimentacaoSaidas },
            foraDaConferencia: doTurno.foraDaConferencia,
            pendentes: { valor: doTurno.pendentesValor, quantidade: doTurno.pendentesQuantidade },
            detalhe: doTurno.detalhe,
          }
        : {}),
    },
  });
}
