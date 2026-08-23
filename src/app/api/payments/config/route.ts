import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PAGAMENTO_ONLINE_ATIVO } from "@/lib/pagamento-online";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const orderId = url.searchParams.get("orderId");
    const franchiseeSlug = url.searchParams.get("franchiseeSlug");

    let franchiseePublicKey: string | null = null;

    if (orderId) {
      const order = await prisma.customerOrder.findUnique({
        where: { id: orderId },
        select: {
          franchisee: {
            select: { mpAccessToken: true }
          }
        }
      });
      // Se a loja tiver chave própria
    }

    const mpPublicKey =
      franchiseePublicKey ||
      process.env.NEXT_PUBLIC_MP_PUBLIC_KEY ||
      process.env.MP_PUBLIC_KEY ||
      "";

    // `hasMp` é o que o cardápio consulta para decidir se mostra Pix/cartão.
    // Com o pagamento online desligado ele é sempre false — o front esconde,
    // e as rotas de cobrança recusam por conta própria.
    //
    // Nota para quando religar: este cálculo olhava SÓ as env vars globais,
    // ignorando loja com credencial própria. E logo acima há uma consulta a
    // order.franchisee.mpAccessToken cujo resultado é descartado —
    // `franchiseePublicKey` nunca é atribuída, então a chave devolvida é
    // sempre a do FireHub. Isso torna impossível cobrar cartão pela conta do
    // lojista: no Mercado Pago o token do cartão só pode ser cobrado com o
    // access token da MESMA conta que gerou a chave pública.
    const hasMp = PAGAMENTO_ONLINE_ATIVO && Boolean(
      process.env.MP_ACCESS_TOKEN ||
      process.env.MERCADO_PAGO_ACCESS_TOKEN ||
      process.env.MERCADOPAGO_ACCESS_TOKEN
    );

    return NextResponse.json({
      mpPublicKey,
      hasMp,
      gateway: "mercadopago"
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
