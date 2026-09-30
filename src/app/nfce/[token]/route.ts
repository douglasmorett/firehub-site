/**
 * GET /nfce/<pedidoId>-<selo> — o DANFE NFC-e para o CLIENTE, sem login.
 *
 * É o "envio em formato eletrônico" do DANFE, que a lei permite com a
 * concordância do consumidor (Ajuste SINIEF 19/16, cl. 10ª, §3º, I, "a" —
 * redação do Ajuste SINIEF 20/23; no PA, IN SEFA 11/2014, art. 7º, I). O link
 * nasce em lib/nfce/link-do-danfe.ts (linkPublicoDoDanfe) e vai pela tela ou
 * pelo WhatsApp.
 *
 * O que a rota mostra é SÓ o DANFE daquele pedido, montado do XML do cofre
 * (lib/nfce/danfe.ts) — nada do pedido além do que está na nota. O selo do
 * token é um HMAC do pedido + chave de acesso com a chave fiscal do servidor:
 *   - selo que não confere → 404, igual ao de pedido inexistente (a resposta
 *     não conta se o pedido existe);
 *   - nota cancelada (a chave do link ficou nas notas anteriores do pedido, ou
 *     o pedido está CANCELED) → 410 com a chave, para o cliente conferir na
 *     SEFAZ que ela não vale mais;
 *   - contingência ainda pendente → o DANFE com "EMITIDA EM CONTINGÊNCIA" e a
 *     "Via do Consumidor", que é o papel que ele recebeu.
 *
 * Sem cache compartilhado e fora dos buscadores: o DANFE da entrega traz CPF e
 * endereço do cliente.
 */
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { avisoDoDanfeHtml, CSP_DO_DANFE, danfeHtml } from "@/lib/nfce/danfe";
import { danfeDoPedido } from "@/lib/nfce/danfe-do-pedido";
import { lerTokenDoDanfe, tokenConfere } from "@/lib/nfce/link-do-danfe";

export const dynamic = "force-dynamic";

const CABECALHOS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": CSP_DO_DANFE,
};

const pagina = (status: number, titulo: string, linhas: string[]) =>
  new NextResponse(avisoDoDanfeHtml(titulo, linhas), { status, headers: CABECALHOS });

const naoAchei = () =>
  pagina(404, "Link de NFC-e inválido", [
    "Este link não abre nenhuma nota fiscal.",
    "Confira se ele chegou inteiro, ou peça o link de novo ao estabelecimento.",
  ]);

const emBlocos = (chave: string) => (chave.match(/.{4}/g) ?? [chave]).join(" ");

const cancelada = (chave: string) =>
  pagina(410, "NFC-e cancelada", [
    "Esta nota fiscal foi cancelada pelo estabelecimento e não tem mais valor fiscal.",
    `Chave de acesso: ${emBlocos(chave)}`,
    "A situação pode ser conferida no portal da SEFAZ da UF do estabelecimento, pela chave de acesso.",
  ]);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const lido = lerTokenDoDanfe(token);
    if (!lido) return naoAchei();

    const pedido = await prisma.customerOrder.findUnique({
      where: { id: lido.pedidoId },
      select: { id: true, fiscalStatus: true, fiscalInfo: true },
    });
    const info = (pedido?.fiscalInfo && typeof pedido.fiscalInfo === "object" ? pedido.fiscalInfo : {}) as Record<string, any>;
    const chaveAtual = String(info.nfceKey ?? "").toUpperCase();

    if (!pedido || !chaveAtual || !tokenConfere(token, chaveAtual)) {
      // O link é de uma nota que foi cancelada e substituída por outra: o
      // selo confere com a chave antiga, guardada em notasAnteriores.
      const anteriores: any[] = Array.isArray(info.notasAnteriores) ? info.notasAnteriores : [];
      const antiga = pedido ? anteriores.map((n) => String(n?.nfceKey ?? "").toUpperCase()).find((c) => c && tokenConfere(token, c)) : undefined;
      return antiga ? cancelada(antiga) : naoAchei();
    }

    const danfe = await danfeDoPedido(pedido);
    if (!danfe.ok) {
      if (danfe.erro === "cancelada") return cancelada(chaveAtual);
      // O selo é válido (quem abriu recebeu o link da loja), então a chave
      // pode ser mostrada: com ela o cliente consulta a nota na SEFAZ.
      return pagina(danfe.status === 404 ? 404 : 409, "DANFE indisponível", [
        "O cupom desta nota não pode ser mostrado aqui agora.",
        `Chave de acesso: ${emBlocos(chaveAtual)}`,
        "Com a chave, a nota pode ser consultada no portal da SEFAZ da UF do estabelecimento.",
      ]);
    }

    // A contingência pendente vai com a via DO CONSUMIDOR; a do
    // estabelecimento é papel da loja.
    const html = danfeHtml(danfe.dados, { largura: 80, via: danfe.dados.pendenteDeAutorizacao ? "consumidor" : null });
    return new NextResponse(html, { headers: CABECALHOS });
  } catch (err: any) {
    console.error("[NFC-e link] Erro:", String(err?.message ?? err).slice(0, 300));
    return pagina(500, "DANFE indisponível", ["Não foi possível abrir a nota agora. Tente de novo em alguns minutos."]);
  }
}
