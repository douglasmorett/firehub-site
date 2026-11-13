/**
 * GET /api/contingencia/instalador — o botão "Baixar o FireHub para Windows"
 * da tela do Modo Contingência.
 *
 * O instalador COMPLETO (Assistente + Node + Postgres + o FireHub, centenas de
 * MB) não cabe no git nem em public/downloads: é montado à mão pelo
 * .github/workflows/instalador-completo.yml e publicado fora (R2/Release). O
 * endereço dele entra por FIREHUB_INSTALADOR_COMPLETO_URL. Enquanto não
 * houver, o botão entrega o Assistente de sempre — que baixa o mesmo FireHub
 * sozinho depois da ativação (só demora mais na primeira vez).
 */
import { NextRequest, NextResponse } from "next/server";
import { enderecoDoInstalador } from "@/lib/contingencia/instalador";

export const dynamic = "force-dynamic";

export function GET(_req: NextRequest) {
  // Location relativa para o arquivo do próprio site: atrás do proxy o req.url
  // é o endereço interno do container (https://0.0.0.0:3000/...), que o
  // navegador da loja não abre. O navegador resolve a relativa pelo site.
  return new NextResponse(null, { status: 302, headers: { Location: enderecoDoInstalador().url, "Cache-Control": "no-store" } });
}
