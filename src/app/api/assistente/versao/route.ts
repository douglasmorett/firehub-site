import { NextRequest, NextResponse } from "next/server";
import { VERSAO_ASSISTENTE_ATUAL } from "@/lib/print";
import { getClientIp } from "@/lib/rateLimit";
import { lojaDoEndereco, podeAtualizarAgora } from "@/lib/assistente-da-loja";

export const dynamic = "force-dynamic";

const URL_DO_INSTALADOR = "https://firehubfood.com.br/downloads/FireHub-Assistente-Impressao-Setup.exe";

/**
 * GET /api/assistente/versao — o Assistente de Impressão pergunta por aqui se
 * existe versão mais nova.
 *
 * A fonte é a MESMA constante que a tela de Impressoras usa para avisar a loja
 * (VERSAO_ASSISTENTE_ATUAL em lib/print.ts) — um número só, sem chance de a
 * tela dizer uma coisa e o auto-update outra. A URL aponta para o mesmo
 * instalador do botão "Baixar": public/downloads, versionado no repositório e
 * publicado junto com cada deploy.
 *
 * O ciclo de release inteiro vira: mexeu no Assistente → build do instalador →
 * substitui o .exe em public/downloads → bump em VERSAO_ASSISTENTE_ATUAL e no
 * package.json do assistente → deploy.
 *
 * ── SÓ COM A LOJA PARADA (24/09/2026) ──────────────────────────────────────
 * A versão nova só é anunciada quando a loja que pergunta está fora de
 * operação (lib/assistente-da-loja.ts): fora do horário, sem pedido há 45 min
 * e sem abrir nos próximos 45. Enquanto isso a resposta vem sem versão e sem
 * URL — o Assistente já instalado lê isso como "tente de novo em 10 min", e o
 * 1.2.25+ lê o `adiada` e o motivo.
 *
 * `pedido=1` é o "procurar atualização agora" da bandeja ou do suporte: quem
 * pediu decidiu a hora, e a trava não vale.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const pedidoAMao = params.get("pedido") === "1";
  const franchiseeId = params.get("franchiseeId") || lojaDoEndereco(getClientIp(req));

  if (!pedidoAMao) {
    let decisao: { pode: boolean; motivo: string };
    try {
      decisao = await podeAtualizarAgora(franchiseeId);
    } catch (err) {
      // Banco fora do ar não é motivo para instalar no meio do serviço.
      console.error("[Assistente/versao] não consegui decidir; segurando a atualização:", (err as any)?.message || err);
      decisao = { pode: false, motivo: "não consegui consultar a loja" };
    }
    if (!decisao.pode) {
      return NextResponse.json({
        versao: null,
        url: null,
        adiada: true,
        motivo: decisao.motivo,
        versaoDisponivel: VERSAO_ASSISTENTE_ATUAL,
        tenteDeNovoEmSegundos: 600,
      });
    }
  }

  return NextResponse.json({
    versao: VERSAO_ASSISTENTE_ATUAL,
    url: URL_DO_INSTALADOR,
  });
}
