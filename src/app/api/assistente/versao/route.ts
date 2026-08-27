import { NextResponse } from "next/server";
import { VERSAO_ASSISTENTE_ATUAL } from "@/lib/print";

export const dynamic = "force-dynamic";

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
 * package.json do assistente → deploy. Quem estiver com o PC ligado atualiza
 * sozinho em até 6 horas.
 */
export async function GET() {
  return NextResponse.json({
    versao: VERSAO_ASSISTENTE_ATUAL,
    url: "https://firehubfood.com.br/downloads/FireHub-Assistente-Impressao-Setup.exe",
  });
}
