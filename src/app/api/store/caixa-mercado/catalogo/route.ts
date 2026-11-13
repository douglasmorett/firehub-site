/**
 * GET — o que o caixa carrega ao abrir: os produtos (preço do salão, unidade,
 * EAN e PLU), a etiqueta da balança, se a loja tem chave Pix e se emite NFC-e.
 * `?todos=1` traz também os inativos (a tela de importação/conferência).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { catalogoDoCaixa } from "@/lib/caixa-mercado/catalogo";
import { configDoCaixa, pixDoCaixa } from "@/lib/caixa-mercado/assinatura";
import { normalizarConfigFiscal } from "@/lib/fiscal-config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const todos = new URL(req.url).searchParams.get("todos") === "1";
  const ctx = await contextoDoCaixa(todos ? { tela: "/store/caixa-mercado/importar" } : {});
  if (ehResposta(ctx)) return ctx;
  const loja = await prisma.user.findUnique({ where: { id: ctx.quem.lojaId }, select: { chatbotConfig: true, fiscalConfig: true, storeName: true } });
  const pix = await pixDoCaixa(ctx.quem.lojaId, loja?.chatbotConfig);
  return NextResponse.json({
    produtos: await catalogoDoCaixa(ctx.quem.lojaId, { incluirInativos: todos }),
    config: await configDoCaixa(ctx.quem.lojaId),
    pix: pix ? { titular: pix.titular, tipo: pix.tipo } : null,
    fiscalLigado: normalizarConfigFiscal(loja?.fiscalConfig as any)?.enabled === true,
    loja: loja?.storeName || "",
  });
}
