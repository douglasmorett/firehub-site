/**
 * /api/ifood/review
 *
 * A aba Avaliações da homologação do módulo Review.
 *
 *   GET  ?acao=lista&page=&pageSize=&dateFrom=&dateTo=&sort=&sortBy=
 *   GET  ?acao=detalhe&reviewId=
 *   GET  ?acao=resumo
 *   POST {acao:"responder", reviewId, texto}
 *
 * Os erros do iFood (400 do pageSize, 404 do ID inexistente, 409/422 de quem já
 * foi publicada, 400 do texto) voltam com o status original em `ifood.status`
 * e a mensagem do iFood em `detalhe` — a tela mostra os dois.
 */
import { NextRequest, NextResponse } from "next/server";
import { comContextoIfood, responder } from "@/lib/ifood-rota";
import {
  listarAvaliacoes, detalheDaAvaliacao, responderAvaliacao, resumoDasAvaliacoes,
} from "@/lib/ifood-review";

export async function GET(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, params }) => {
    const acao = params.get("acao");
    if (acao === "lista") {
      const r = await listarAvaliacoes(ctx, {
        page: Number(params.get("page") || 1),
        pageSize: Number(params.get("pageSize") || 10),
        dateFrom: params.get("dateFrom"),
        dateTo: params.get("dateTo"),
        sort: (params.get("sort") as any) || undefined,
        sortBy: (params.get("sortBy") as any) || undefined,
      });
      return responder(r, { endpoint: "GET /review/v2.0/merchants/{merchantId}/reviews" });
    }
    if (acao === "detalhe") {
      const r = await detalheDaAvaliacao(ctx, params.get("reviewId") ?? "");
      return responder(r, { endpoint: "GET /review/v2.0/merchants/{merchantId}/reviews/{reviewId}" });
    }
    if (acao === "resumo") {
      const r = await resumoDasAvaliacoes(ctx);
      return responder(r, { endpoint: "GET /review/v2.0/merchants/{merchantId}/summary" });
    }
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  });
}

export async function POST(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx, corpo }) => {
    if (corpo?.acao !== "responder") {
      return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
    }
    const r = await responderAvaliacao(ctx, corpo?.reviewId ?? "", corpo?.texto ?? "");
    return responder(r, { endpoint: "POST /review/v2.0/merchants/{merchantId}/reviews/{reviewId}/answers" });
  });
}
