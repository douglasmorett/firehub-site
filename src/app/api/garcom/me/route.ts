/**
 * GET /api/garcom/me
 *
 * Diz à tela do garçom se a sessão dele ainda vale e, se não, POR QUÊ. As
 * rotas de mesa respondem um 401 seco; é aqui que a tela descobre se foi
 * senha trocada, acesso desativado, caixa fechado ou sessão vencida — e leva
 * o motivo para a tela de login (?motivo=), em vez de um formulário mudo.
 */
import { NextResponse } from "next/server";
import { autenticarGarcom } from "@/lib/garcom-auth";
import { prisma } from "@/lib/prisma";
import { garcomPodePedirNota } from "@/lib/nota-pelo-garcom";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await autenticarGarcom();
  if (!auth.ok) {
    return NextResponse.json({ ok: false, codigo: auth.codigo, erro: auth.erro }, { status: auth.status });
  }
  // "Emitir nota fiscal?" no app da maquininha: só aparece com o titular
  // liberando e a NFC-e ligada (lib/nota-pelo-garcom). A rota da cobrança
  // barra igual.
  const loja = await prisma.user.findUnique({ where: { id: auth.garcom.franchiseeId }, select: { fiscalConfig: true } });
  return NextResponse.json({
    ok: true,
    garcom: {
      id: auth.garcom.id,
      name: auth.garcom.name,
      commissionRate: auth.garcom.commissionRate,
      // O app da maquininha esconde o que o garçom não pode fazer (o servidor
      // continua barrando com 403; isto é só para não oferecer o botão).
      podeFecharConta: auth.garcom.podeFecharConta,
      podeDarDesconto: auth.garcom.podeDarDesconto,
      podeLiberarMesa: auth.garcom.podeLiberarMesa,
      podeTirarTaxa: auth.garcom.podeTirarTaxa,
      podeRemoverItem: auth.garcom.podeRemoverItem,
      podeFazerBalcao: auth.garcom.podeFazerBalcao,
      podePedirNotaFiscal: garcomPodePedirNota(loja?.fiscalConfig),
    },
  });
}
