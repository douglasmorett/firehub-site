/**
 * /api/ifood/conexao
 *
 * "Esta loja está pronta para operar pelo iFood?" — respondido pela camada nova.
 *
 * Existe porque o teste antigo (`/api/ifood/auth?step=test`) pergunta usando o
 * token do app CENTRALIZADO. Para uma loja conectada pelo distribuído isso
 * devolve 403 e a tela conclui "não conectada", quando na verdade a loja está
 * perfeitamente conectada — só foi perguntado pelo aplicativo errado.
 *
 * A distinção que esta rota faz, e que a antiga não fazia:
 *
 *   conectada  — existe loja e existe credencial utilizável. É o que habilita
 *                as telas de Catálogo e Entrega.
 *   moduloOk   — o iFood aceitou uma chamada do módulo Merchant. Um 403 aqui
 *                significa módulo não liberado no aplicativo, não credencial
 *                inválida — e isso precisa ser dito com essas palavras, porque
 *                a diferença decide se o problema se resolve reconectando a
 *                loja ou pedindo acesso no Portal do Desenvolvedor.
 */
import { NextRequest, NextResponse } from "next/server";
import { comContextoIfood } from "@/lib/ifood-rota";
import { chamarComContexto } from "@/lib/ifood-http";

export async function GET(req: NextRequest) {
  return comContextoIfood(req, async ({ ctx }) => {
    const r = await chamarComContexto(ctx, `/merchant/v1.0/merchants/${ctx.merchantId}`);

    const semModulo = r.status === 403;
    const nome =
      (r.data as any)?.name ||
      (r.data as any)?.shortName ||
      ctx.label ||
      null;

    return NextResponse.json({
      // A loja está conectada porque temos credencial para ela. Se o módulo
      // responde ou não é outra pergunta.
      connected: true,
      merchantId: ctx.merchantId,
      storeName: r.ok ? nome : ctx.label ?? null,
      origem: r.origem,
      credenciais: ctx.credenciais.map((c) => c.origem),
      moduloMerchant: {
        ok: r.ok,
        status: r.status,
        aviso: semModulo
          ? "O iFood recusou o módulo Merchant para este aplicativo (403). A loja está conectada — o que falta é liberar o módulo em Permissões, no Portal do Desenvolvedor."
          : r.ok
            ? null
            : "O módulo Merchant não respondeu como esperado.",
      },
      raw: r.data ?? null,
    });
  });
}
