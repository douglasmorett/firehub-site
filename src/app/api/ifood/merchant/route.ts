/**
 * /api/ifood/merchant
 * Cenário 1 da homologação de Merchant: as lojas vinculadas, os detalhes de uma
 * delas e a disponibilidade.
 *
 * O campo `escopo` existe por um motivo específico: sem o módulo Merchant
 * liberado no aplicativo, `GET /merchants` responde 200 com uma lista VAZIA em
 * vez de 403. O erro não se anuncia, e já custou dias de diagnóstico procurando
 * bug onde havia falta de permissão. Aqui isso é dito em voz alta.
 */
import { NextRequest, NextResponse } from "next/server";
import { comContextoIfood } from "@/lib/ifood-rota";
import { chamarComContexto } from "@/lib/ifood-http";

export async function GET(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx }) => {
    const merchantId = ctx.merchantId;

    const [detalhe, disponibilidade, lista] = await Promise.all([
      chamarComContexto(ctx, `/merchant/v1.0/merchants/${merchantId}`),
      chamarComContexto(ctx, `/merchant/v1.0/merchants/${merchantId}/status`),
      chamarComContexto(ctx, `/merchant/v1.0/merchants`),
    ]);

    const listaVazia = lista.ok && Array.isArray(lista.data) && lista.data.length === 0;

    return NextResponse.json({
      merchantId,
      loja: ctx.label ?? null,
      // Nomes preservados: a tela de homologação já lê estes campos.
      detail: detalhe.data ?? null,
      status: disponibilidade.data ?? null,
      list: Array.isArray(lista.data) ? lista.data : [lista.data].filter(Boolean),
      ifood: {
        origem: detalhe.origem,
        detalhe: detalhe.status,
        disponibilidade: disponibilidade.status,
        lista: lista.status,
      },
      escopo: listaVazia
        ? "O iFood devolveu a lista de lojas vazia. Normalmente isso quer dizer que o módulo Merchant não está liberado para este aplicativo — peça o acesso em Permissões, no Portal do Desenvolvedor."
        : null,
    });
  });
}
