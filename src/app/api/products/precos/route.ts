import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Preço ATUAL dos produtos que estão no carrinho.
 *
 * ── POR QUE ISTO PRECISOU EXISTIR ───────────────────────────────────────────
 *
 * O carrinho vive no localStorage e guarda o preço do momento em que o item foi
 * adicionado — e NUNCA atualizava. Quando um preço mudava, o cliente ficava com
 * o catálogo mostrando o valor novo e o carrinho mostrando o velho.
 *
 * No checkout o servidor recalcula pelo banco e recusa a divergência com
 * "os preços foram atualizados, recarregue a página e verifique seu carrinho".
 * Só que recarregar NÃO resolvia: o carrinho relê o mesmo localStorage e volta
 * com os mesmos preços velhos. O cliente ficava preso num laço — tentava,
 * tomava o mesmo erro, tentava de novo. Era assim que um reajuste travava o
 * pedido de quem já tinha o produto no carrinho.
 *
 * Com esta rota o carrinho se atualiza sozinho e mostra o que mudou, em vez de
 * mandar o cliente fazer uma coisa que não funciona.
 *
 * Devolve SÓ id, nome e preço de produto ativo — é o mesmo que a vitrine já
 * mostra a qualquer visitante, então não expõe nada novo.
 */
export async function POST(req: Request) {
  let corpo: any = {};
  try { corpo = await req.json(); } catch { }

  const ids: string[] = Array.isArray(corpo?.ids)
    ? corpo.ids.filter((i: any) => typeof i === "string").slice(0, 200)
    : [];
  if (ids.length === 0) return NextResponse.json({ produtos: [] });

  const produtos = await prisma.product.findMany({
    where: { id: { in: ids }, active: true },
    select: { id: true, name: true, price: true },
  });

  return NextResponse.json({ produtos });
}
